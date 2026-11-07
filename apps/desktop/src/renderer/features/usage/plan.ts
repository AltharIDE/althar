import type { AccountUsage, ModelRoom as Room, PlanUsage, UsageWindow } from '@althar/contracts'
import type { ModelInfo, ModelRoom, PlanAccount, PlanAgent, PlanWindow } from '@althar/ui'

import { brandOf } from '../../shared/agents'
import { choiceOf } from '../../shared/models'
import { ago, clock, timeLeft } from '../../shared/time'

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
  /** An agent every window read of which has reset since: how much is used no one has said yet. */
  unread: 'Not read since reset',
  /** A plan signed in and able to run, whose usage nothing reads (OpenCode Go without a Console sign-in). */
  connected: 'Connected',
  /** A window's reset, with the time left: resets 14:00 · in 2 h 10 m. */
  resets: (at: string, left: string | null) => (left === null ? `resets ${at}` : `resets ${at} · ${left}`),
  /** A window that has reset since it was read, and not been read again. */
  resetUnread: (at: string) => `reset at ${at} · not read since`,
  /** The provider gave no reset time for the window. */
  noReset: 'no reset time given',
}

/** The providers within an agent that are a plan of their own, as the registry has them: a model through one is on it. */
const PLAN_PROVIDERS: Readonly<Record<string, ReadonlyArray<string>>> = { opencode: ['opencode-go'] }

/** An agent's row, by its plan where the plan is named for it (OpenCode Go), else by the agent. */
const nameOf = (account: AccountUsage) =>
  account.plan !== null && account.plan.startsWith(`${account.agentName} `) ? account.plan : account.agentName

/**
 * A plan Althar names but reads nothing of (OpenCode Go with its key alone, or a first read that failed): shown connected,
 * or as needing its sign-in.
 */
const namedUnread = (account: AccountUsage) =>
  account.paidBy === 'plan' &&
  account.plan !== null &&
  account.windows.length === 0 &&
  !account.resetSince &&
  (account.noReading !== null || account.fault?.kind === 'sign_in_again')

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

/** A window by what names it within its account. */
const keyOf = (window: Pick<UsageWindow, 'kind' | 'label'>) => `${window.kind}:${window.label ?? ''}`

/**
 * The windows last read of each account, by its id: the runtime leaves out a window once it has reset, and sends none at all
 * once every one has, so what was read of them is kept until that window is read again.
 */
export type WindowMemory = Map<string, ReadonlyArray<UsageWindow>>

/** Keeps each window as it is read, those the runtime leaves out after (a reset) as last read; an account sent with none keeps all of its. */
export const remember = (memory: WindowMemory, usage: PlanUsage | null): void => {
  for (const account of usage?.accounts ?? []) {
    if (account.windows.length === 0) continue
    const read = new Set(account.windows.map(keyOf))
    memory.set(account.accountId, [
      ...account.windows,
      ...(memory.get(account.accountId) ?? []).filter((window) => !read.has(keyOf(window))),
    ])
  }
}

/** What a window says of when it resets: the time and the time left, that it reset and wasn't read since, or that no time is known. */
const resetsOf = (window: UsageWindow, now: Date): string => {
  if (window.resetsAt === null) return text.noReset
  const at = clock(window.resetsAt, now)
  if (at === '') return text.noReset
  return text.resets(at, timeLeft(window.resetsAt, now))
}

/** A window that has reset and not been read since: the time it reset, or that none is known. */
const resetUnreadOf = (window: UsageWindow, now: Date): string => {
  const at = window.resetsAt === null ? '' : clock(window.resetsAt, now)
  return at === '' ? text.noReset : text.resetUnread(at)
}

/** `account` has only the windows not reset since; `read` is as it was read, to show those that have, as not read since. */
const accountOf = (
  account: AccountUsage,
  several: boolean,
  now: Date,
  read: AccountUsage = account,
  /** The windows are those remembered of an account the runtime sent none of, as it says all have reset. */
  remembered = false,
): PlanAccount => ({
  id: account.accountId,
  name: several ? account.accountName : null,
  // Old numbers say how old; so do any that a passing fault left unrefreshed, as the fault itself isn't shown.
  age:
    account.observedAt !== null && (passing(account) || now.getTime() - Date.parse(account.observedAt) > OLD)
      ? text.read(ago(account.observedAt, now))
      : null,
  fault: passing(account) ? null : (account.fault?.message ?? null),
  windows: read.windows.map((window): PlanWindow => {
    const reset = remembered || past(window.resetsAt, now)
    return {
      id: window.label === null ? window.kind : `${window.kind}:${window.label}`,
      label: windowName(window),
      left: reset ? 0 : leftOf(window),
      until: window.resetsAt === null ? null : clock(window.resetsAt, now),
      resets: reset ? resetUnreadOf(window, now) : resetsOf(window, now),
      ...(reset ? { unread: true } : {}),
    }
  }),
})

/** Every agent read, least room first. */
export const planOf = (usage: PlanUsage | null, now: Date, memory?: WindowMemory): { readonly agents: PlanAgent[] } => {
  const agents: PlanAgent[] = []
  const byAgent = new Map<string, AccountUsage[]>()
  // The accounts that had windows when they were read, though every one may have reset since: by the runtime's clock, which
  // then sends none, or by the window's own, which leaves out what has reset since it was sent.
  const wasRead = new Set<string>()
  const asRead = new Map<string, AccountUsage>()
  // Accounts the runtime sent no windows of, as every one has reset: shown with the windows last read of them, as reset.
  const forgotten = new Set<string>()
  for (const read of usage?.accounts ?? []) {
    const last = memory?.get(read.accountId)
    if (last !== undefined && read.resetSince && read.windows.length === 0) {
      // Every window has reset, by the runtime's clock: all that were read of it, as reset.
      forgotten.add(read.accountId)
      asRead.set(read.accountId, { ...read, windows: last })
    } else if (last !== undefined && read.windows.length > 0) {
      // One reset and the rest haven't: it is read no more, and shows as reset once its own time has passed.
      const sent = new Set(read.windows.map(keyOf))
      const gone = last.filter((window) => !sent.has(keyOf(window)) && past(window.resetsAt, now))
      asRead.set(read.accountId, gone.length === 0 ? read : { ...read, windows: [...read.windows, ...gone] })
    } else asRead.set(read.accountId, read)
    const account = current(read, now)
    if (read.resetSince || read.windows.length > 0) wasRead.add(account.accountId)
    byAgent.set(account.agentId, [...(byAgent.get(account.agentId) ?? []), account])
  }
  for (const [agentId, accounts] of byAgent) {
    const read = accounts.flatMap((account) => {
      const window = tightest(account)
      return window === undefined ? [] : [{ account, window }]
    })
    const [first] = accounts
    if (first === undefined) continue
    const several = accounts.length > 1
    const brand = brandOf(agentId)
    if (read.length === 0) {
      // Every window read has reset since: no figure, never all of its plan left, and each account says how old and why.
      const reset = accounts.filter((account) => wasRead.has(account.accountId))
      // A plan named but never read: connected, or needing its sign-in, each account saying why in the detail.
      const named = accounts.filter((account) => !wasRead.has(account.accountId) && namedUnread(account))
      const shown = [...reset, ...named]
      if (shown.length === 0) continue
      const out = shown.every((account) => account.fault?.kind === 'sign_in_again')
      agents.push({
        id: agentId,
        name: nameOf(first),
        ...(brand === undefined ? {} : { brand }),
        left: 0,
        limit: '',
        until: null,
        account: null,
        accounts: shown.map((account) => ({
          ...accountOf(account, several, now, asRead.get(account.accountId), forgotten.has(account.accountId)),
          fault: account.fault?.message ?? account.noReading ?? null,
        })),
        ...(out ? { stopped: text.signedOut, signIn: true } : reset.length > 0 ? { unread: text.unread } : { connected: text.connected }),
      })
      continue
    }
    // Another account on the plan, connected but unread (a fresh OpenCode Go key in a new account), is in the detail too.
    const named = accounts.filter((account) => !wasRead.has(account.accountId) && namedUnread(account))
    const each = [
      ...read
        .toSorted((a, b) => leftOf(a.window) - leftOf(b.window))
        .map(({ account }) => accountOf(account, several, now, asRead.get(account.accountId), forgotten.has(account.accountId))),
      ...named.map((account) => ({
        ...accountOf(account, several, now, asRead.get(account.accountId), forgotten.has(account.accountId)),
        fault: account.fault?.message ?? account.noReading ?? null,
      })),
    ]
    // The figure is of the account new work would start on: one signed out keeps its last numbers in the peek, but runs nothing, as the runtime skips it.
    const usable = read.filter(({ account }) => account.fault?.kind !== 'sign_in_again')
    // None read can run, but one unread can: the runtime starts work there, so the plan is connected, with no figure.
    if (usable.length === 0 && named.some((account) => account.fault?.kind !== 'sign_in_again')) {
      agents.push({
        id: agentId,
        name: nameOf(first),
        ...(brand === undefined ? {} : { brand }),
        left: 0,
        limit: '',
        until: null,
        account: null,
        accounts: each,
        connected: text.connected,
      })
      continue
    }
    if (usable.length === 0) {
      // None signed in: no room to give it, only why, with its saved numbers in the detail.
      agents.push({
        id: agentId,
        name: nameOf(first),
        ...(brand === undefined ? {} : { brand }),
        left: 0,
        limit: '',
        until: null,
        account: null,
        accounts: each,
        stopped: text.signedOut,
        signIn: true,
      })
      continue
    }
    const route = usable.reduce((most, one) => (leftOf(one.window) > leftOf(most.window) ? one : most))
    agents.push({
      id: agentId,
      name: nameOf(first),
      ...(brand === undefined ? {} : { brand }),
      left: leftOf(route.window),
      limit: limitWords(route.window),
      until: route.window.resetsAt === null ? null : clock(route.window.resetsAt, now),
      account: several ? route.account.accountName : null,
      accounts: each,
    })
  }
  // Least room first, an agent that can't run, or has no figure, after every one that can.
  const stopped = (agent: PlanAgent) => (agent.stopped === undefined && agent.unread === undefined && agent.connected === undefined ? 0 : 1)
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
  // A model through a provider that isn't the agent's plan (OpenCode Zen beside Go) is paid per use: nothing to say.
  const plans = PLAN_PROVIDERS[agentId]
  // Its own default may be any provider's, Zen's as well as Go's: nothing to say of it either.
  if (plans !== undefined && (model === null || !plans.some((provider) => model.startsWith(`${provider}/`)))) return undefined
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
    if (agent !== undefined && agent.unread === undefined) return { left: agent.left, until: agent.until, account: agent.account }
  }
  return accounts.every((account) => account.windows.length === 0) ? null : undefined
}
