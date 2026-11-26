/**
 * The limits on agents messaging and waking each other across people. Between one person's own agents (their
 * coordinator and their leads) none of this applies. Across people a message can wake the other agent, which then runs
 * on its own person's plan, so these keep that from becoming a way to spend someone else's plan or to loop.
 *
 * A message is never lost to a limit: past one, it waits for the other agent's next run instead of waking it. Only a
 * duplicate, an over-long message or one past the hop limit is refused.
 */

export interface WakeLimits {
  /** Wakes from one agent to the same person's agents in an hour. */
  readonly perPairPerHour: number
  /** Wakes from teammates' agents a person's agents take in a day. */
  readonly perPersonPerDay: number
  /** How many agents a chain of wakes may pass through before it stops. */
  readonly maxHops: number
  readonly maxLength: number
  /** The same text from the same agent to the same person within this is one message. */
  readonly duplicateWindowMs: number
}

export const defaultWakeLimits: WakeLimits = {
  perPairPerHour: 6,
  perPersonPerDay: 30,
  maxHops: 3,
  maxLength: 2_000,
  duplicateWindowMs: 10 * 60_000,
}

export interface AgentRef {
  readonly person: string
  /** The coordinator's or a lead's session, as the home names it. */
  readonly agent: string
}

export interface Message {
  readonly from: AgentRef
  readonly to: AgentRef
  readonly text: string
  /** How many agents woke one another before this one: zero for a message an agent starts on its own. */
  readonly hops: number
  readonly at: number
}

/** A wake already delivered, as the home keeps it. */
export interface Delivered {
  readonly fromAgent: string
  readonly toPerson: string
  readonly text: string
  readonly at: number
}

export interface Receiver {
  /** People whose agents this person has muted. */
  readonly muted: ReadonlySet<string>
  /** The person has a cap on how much of their plan teammates' agents may use, and it is reached. */
  readonly capReached: boolean
}

export type WakeDecision =
  | { readonly deliver: 'wake' }
  | { readonly deliver: 'wait'; readonly reason: 'pair_limit' | 'daily_limit' | 'muted' | 'cap_reached' }
  | { readonly deliver: 'refuse'; readonly reason: 'duplicate' | 'too_long' | 'too_many_hops' | 'empty' }

const HOUR = 60 * 60_000
const DAY = 24 * HOUR

const same = (text: string): string => text.trim().replace(/\s+/g, ' ').toLowerCase()

export const decideWake = (
  message: Message,
  history: ReadonlyArray<Delivered>,
  receiver: Receiver,
  limits: WakeLimits = defaultWakeLimits,
): WakeDecision => {
  if (message.text.trim() === '') return { deliver: 'refuse', reason: 'empty' }
  if (message.from.person === message.to.person) return { deliver: 'wake' }
  if (message.text.length > limits.maxLength) return { deliver: 'refuse', reason: 'too_long' }
  if (message.hops >= limits.maxHops) return { deliver: 'refuse', reason: 'too_many_hops' }
  const toPerson = history.filter((entry) => entry.toPerson === message.to.person)
  const fromThis = toPerson.filter((entry) => entry.fromAgent === message.from.agent)
  const text = same(message.text)
  if (fromThis.some((entry) => message.at - entry.at < limits.duplicateWindowMs && same(entry.text) === text))
    return { deliver: 'refuse', reason: 'duplicate' }
  if (receiver.muted.has(message.from.person)) return { deliver: 'wait', reason: 'muted' }
  if (receiver.capReached) return { deliver: 'wait', reason: 'cap_reached' }
  if (fromThis.filter((entry) => message.at - entry.at < HOUR).length >= limits.perPairPerHour)
    return { deliver: 'wait', reason: 'pair_limit' }
  if (toPerson.filter((entry) => message.at - entry.at < DAY).length >= limits.perPersonPerDay)
    return { deliver: 'wait', reason: 'daily_limit' }
  return { deliver: 'wake' }
}

/** What an agent woken by a teammate's agent may do on that request alone, without its own person's word. */
export type OnRequest = 'answer' | 'share' | 'agree_order' | 'change_work'

/**
 * Answering and sharing are free. Agreeing on order (holding its own next start, waiting for the other task) is
 * allowed unless the person turned it off, because it is easy to undo. Changing the person's work never is.
 */
export const mayOnRequest = (action: OnRequest, person: { readonly agentsAgreeOrder: boolean }): boolean =>
  action === 'answer' || action === 'share' || (action === 'agree_order' && person.agentsAgreeOrder)
