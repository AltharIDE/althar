import type { AccountUsage, ModelRoom as Room, PlanUsage, UsageWindow } from '@althar/contracts'
import type { ModelInfo, ModelRoom, PlanAccount, PlanAgent, PlanWindow } from '@althar/ui'

import { brandOf } from '../../shared/agents'
import { choiceOf } from '../../shared/models'
import { ago, clock } from '../../shared/time'

/*
 * Plan usage as the window shows it (docs/plans/plan-usage.md): a gauge in
 * the bar after CPU and memory, its peek a row per agent, and each model's
 * room in the pickers. An agent's figure is the tightest window of the
 * account with the most room, as work on it would start there, of those
 * signed in: one signed out keeps its last numbers in the peek but runs
 * nothing, and an agent with no other says so in place of a figure. A model's is
 * the runtime's own (`GetModelRooms`), which knows the project's rule for
 * moving work through accounts and a model's own window, such as Opus's week.
 * A window whose reset has passed is unknown until it is read again, as the
 * runtime has it: the window leaves it out by its own clock, as one passes
 * while it shows, rather than show it with the use it had before.
 */

export const text = {
  fiveHours: '5 hours',
  week: 'Week',
  month: 'Month',
  /** A model's own window: Opus week. */
  named: (label: string, kind: string) => `${label} ${kind.toLowerCase()}`,
  limitOf: { five_hour: 'five-hour', weekly: 'weekly', monthly: 'monthly', other: '' },
  read: (age: string) => `read ${age}`,
  /** An agent all of whose accounts read are signed out: no work starts on it. */
  signedOut: 'Signed out',
}

/** Numbers older than this say how old they are. */
const OLD = 15 * 60_000

const leftOf = (window: UsageWindow) => Math.max(0, Math.min(100, Math.round(100 - window.usedPercent)))

/** Whether a reset time has passed: its window has started again, and how much of it is used no one has said yet. */
const past = (resetsAt: string | null, now: Date) => resetsAt !== null && Date.parse(resetsAt) <= now.getTime()

/** The account with only the windows that haven't reset since they were read. */
const current = (account: AccountUsage, now: Date): AccountUsage => {
  const windows = account.windows.filter((window) => !past(window.resetsAt, now))
  return windows.length === account.windows.length ? account : { ...account, windows }
}

/** A window as a row names it: 5 hours, Week, Opus week, or its own name. */
export const windowName = (window: Pick<UsageWindow, 'kind' | 'label'>): string => {
  const kind =
    window.kind === 'five_hour' ? text.fiveHours : window.kind === 'weekly' ? text.week : window.kind === 'monthly' ? text.month : null
  if (kind === null) return window.label ?? ''
  return window.label === null ? kind : text.named(window.label, kind)
}

/** A window as a sentence names it: five-hour limit, weekly Opus limit. */
export const limitWords = (window: Pick<UsageWindow, 'kind' | 'label'>): string =>
  [text.limitOf[window.kind], window.label ?? '', 'limit'].filter((word) => word !== '').join(' ')

/** The window an account runs out of first: the plan's own, where it has any, before a model's or extra usage. */
const tightest = (account: AccountUsage): UsageWindow | undefined => {
  const own = account.windows.filter((window) => window.label === null)
  return (own.length > 0 ? own : account.windows).reduce<UsageWindow | undefined>(
    (low, window) => (low === undefined || leftOf(window) < leftOf(low) ? window : low),
    undefined,
  )
}

/** A read that failed for a moment (a rate limit, no answer, an error) and will pass on its own: nothing the person can do, so the peek keeps to the last numbers and how old they are. */
const passing = (account: AccountUsage) => account.fault?.kind === 'unreachable'

const accountOf = (account: AccountUsage, several: boolean, now: Date): PlanAccount => ({
  id: account.accountId,
  name: several ? account.accountName : null,
  // Old numbers say how old; so do any that a passing fault left unrefreshed, as the fault itself isn't shown.
  age:
    account.observedAt !== null && (passing(account) || now.getTime() - Date.parse(account.observedAt) > OLD)
      ? text.read(ago(account.observedAt, now))
      : null,
  fault: passing(account) ? null : (account.fault?.message ?? null),
  windows: account.windows.map((window): PlanWindow => ({
    id: window.label === null ? window.kind : `${window.kind}:${window.label}`,
    label: windowName(window),
    left: leftOf(window),
    until: window.resetsAt === null ? null : clock(window.resetsAt, now),
  })),
})

/** Every agent read, least room first. */
export const planOf = (usage: PlanUsage | null, now: Date): { readonly agents: PlanAgent[] } => {
  const agents: PlanAgent[] = []
  const byAgent = new Map<string, AccountUsage[]>()
  for (const read of usage?.accounts ?? []) {
    const account = current(read, now)
    byAgent.set(account.agentId, [...(byAgent.get(account.agentId) ?? []), account])
  }
  for (const [agentId, accounts] of byAgent) {
    const read = accounts.flatMap((account) => {
      const window = tightest(account)
      return window === undefined ? [] : [{ account, window }]
    })
    const [first] = accounts
    if (first === undefined) continue
    if (read.length === 0) continue
    const several = accounts.length > 1
    const brand = brandOf(agentId)
    const each = read.toSorted((a, b) => leftOf(a.window) - leftOf(b.window)).map(({ account }) => accountOf(account, several, now))
    // The figure is of the account new work would start on: one signed out keeps its last numbers in the peek, but runs nothing, as the runtime skips it.
    const usable = read.filter(({ account }) => account.fault?.kind !== 'sign_in_again')
    if (usable.length === 0) {
      // None signed in: no room to give it, only why, with its saved numbers in the detail.
      agents.push({
        id: agentId,
        name: first.agentName,
        ...(brand === undefined ? {} : { brand }),
        left: 0,
        limit: '',
        until: null,
        account: null,
        accounts: each,
        stopped: text.signedOut,
      })
      continue
    }
    const route = usable.reduce((most, one) => (leftOf(one.window) > leftOf(most.window) ? one : most))
    agents.push({
      id: agentId,
      name: first.agentName,
      ...(brand === undefined ? {} : { brand }),
      left: leftOf(route.window),
      limit: limitWords(route.window),
      until: route.window.resetsAt === null ? null : clock(route.window.resetsAt, now),
      account: several ? route.account.accountName : null,
      accounts: each,
    })
  }
  // Least room first, an agent that can't run after every one that can.
  const stopped = (agent: PlanAgent) => (agent.stopped === undefined ? 0 : 1)
  return { agents: agents.toSorted((a, b) => stopped(a) - stopped(b) || a.left - b.left) }
}

/**
 * A model's room in a picker: the runtime's for that model; an agent's own
 * default model, which the runtime has none for, the agent's figure; null
 * ("no reading") for a model on a plan Althar reads nothing of; undefined
 * where there is nothing to say, as for a model paid per use.
 */
export const roomOf = (
  info: Pick<ModelInfo, 'id'>,
  rooms: ReadonlyArray<Room>,
  usage: PlanUsage | null,
  now: Date,
): ModelRoom | null | undefined => {
  const { agentId, model } = choiceOf(info.id)
  // The runtime's, unless its window has reset since: what's known of the agent's accounts then, until the rooms are read again.
  const found = rooms.find((room) => room.agentId === agentId && room.model === model && !past(room.resetsAt, now))
  if (found !== undefined)
    return {
      left: Math.max(0, Math.min(100, Math.round(found.leftPercent))),
      until: found.resetsAt === null ? null : clock(found.resetsAt, now),
      account: found.several ? found.accountName : null,
    }
  const accounts = (usage?.accounts ?? [])
    .filter((account) => account.agentId === agentId && account.paidBy !== 'key')
    .map((account) => current(account, now))
  if (accounts.length === 0) return undefined
  if (model === null) {
    const agent = planOf({ accounts }, now).agents[0]
    // Signed out, it has no room to give: the picker says nothing of it, as the runtime starts nothing there.
    if (agent?.stopped !== undefined) return undefined
    if (agent !== undefined) return { left: agent.left, until: agent.until, account: agent.account }
  }
  return accounts.every((account) => account.windows.length === 0) ? null : undefined
}
