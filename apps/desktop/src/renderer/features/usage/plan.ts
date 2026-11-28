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
  read: (age: string) => `Last read ${age}`,
  /** An agent all of whose accounts read are signed out: no work starts on it. */
  signedOut: 'Signed out',
  /** An agent every window read of which has reset since: how much is used no one has said yet. */
  unread: 'Not read since reset',
  /** A plan signed in and able to run, whose usage nothing reads (OpenCode Go without a Console sign-in). */
  connected: 'Connected',
  /** Hover on it: when the window resets, and the time left. */
  resetsAt: (at: string, left: string | null) => (left === null ? `Resets ${at}` : `Resets ${at} · ${left}`),
  /** Where a bar would be, for a window that has reset since it was read and not been read again. */
  notRead: 'not read since',
  /** The end of such a row: when it reset, short; and in full on hover. */
  resetAt: (at: string) => `reset ${at}`,
  resetAtFull: (at: string) => `Reset at ${at} · not read since`,
  /** The provider gave no reset time for the window. */
  noReset: 'no reset time',
  noResetFull: 'The provider gave no reset time for this window.',
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

/** Why an account's numbers are missing or old, in the runtime's one short line (`usageSaid`), or why nothing reads them. */
const faultOf = (account: AccountUsage) => account.fault?.message ?? null

/**
 * Accounts of one agent that all failed for the same reason say it once, for the agent, rather than under each: the
 * line, and the accounts without it. One alone says it under itself, as it is the agent's anyway.
 */
const collapsed = (accounts: PlanAccount[]): { fault?: string; accounts: PlanAccount[] } => {
  const [first] = accounts
  const same = first?.fault ?? null
  if (accounts.length < 2 || same === null || accounts.some((account) => account.fault !== same)) return { accounts }
  return { fault: same, accounts: accounts.map((account) => ({ ...account, fault: null })) }
}

/**
 * How far through its window now is, 0 to 100, where the window's start is known: it ends at `resetsAt` and runs the length
 * of its kind (five hours, a week, a calendar month). A window of another kind has no known length, so no tick.
 */
export const elapsedOf = (window: UsageWindow, now: Date): number | undefined => {
  if (window.resetsAt === null) return undefined
  const end = Date.parse(window.resetsAt)
  if (Number.isNaN(end)) return undefined
  let start: number
  if (window.kind === 'five_hour') start = end - 5 * 3_600_000
  else if (window.kind === 'weekly') start = end - 7 * 86_400_000
  else if (window.kind === 'monthly') {
    // In UTC, on the same day of the month before, or its last day where that has none (31 May starts 30 April).
    const d = new Date(end)
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0)).getUTCDate()
    start = Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth() - 1,
      Math.min(d.getUTCDate(), last),
      d.getUTCHours(),
      d.getUTCMinutes(),
      d.getUTCSeconds(),
      d.getUTCMilliseconds(),
    )
  } else return undefined
  const share = ((now.getTime() - start) / (end - start)) * 100
  return share < 0 || share > 100 ? undefined : Math.round(share)
}

/** What the end of a window's row says of when it resets, and in full on hover: the time left, that it reset and wasn't read since, or that no time is known. */
const resetsOf = (window: UsageWindow, now: Date, reset: boolean): Pick<PlanWindow, 'resets' | 'resetsTitle' | 'note'> => {
  const at = window.resetsAt === null ? '' : clock(window.resetsAt, now)
  if (at === '' || window.resetsAt === null)
    return { resets: text.noReset, resetsTitle: text.noResetFull, ...(reset ? { note: text.notRead } : {}) }
  if (reset) return { resets: text.resetAt(at), resetsTitle: text.resetAtFull(at), note: text.notRead }
  const left = timeLeft(window.resetsAt, now)
  return { resets: left ?? at, resetsTitle: text.resetsAt(at, left) }
}

/** `account` has only the windows not reset since; `read` is as it was read, to show those that have, as not read since. */
const accountOf = (account: AccountUsage, several: boolean, now: Date, read: AccountUsage = account): PlanAccount => {
  // Numbers a failed read left are the last good ones, not now's: they say how old, drawn quieter, with no tick for the time.
  const stale = account.fault !== null
  return {
    id: account.accountId,
    name: several ? account.accountName : null,
    age:
      account.observedAt !== null && (stale || now.getTime() - Date.parse(account.observedAt) > OLD)
        ? text.read(ago(account.observedAt, now))
        : null,
    fault: faultOf(account),
    ...(stale && read.windows.length > 0 ? { stale: true } : {}),
    // Its sign-in gone: no work starts on it, and its card in the peek says so, with its own Sign in.
    ...(account.fault?.kind === 'sign_in_again' ? { signedOut: true } : {}),
    windows: [...read.windows, ...(read.resetWindows ?? [])].map((window): PlanWindow => {
      // Reset by the runtime's clock (sent apart), or by this one, which has moved on since it was sent.
      const reset = (read.resetWindows ?? []).includes(window) || past(window.resetsAt, now)
      return {
        id: window.label === null ? window.kind : `${window.kind}:${window.label}`,
        label: windowName(window),
        left: reset ? 0 : leftOf(window),
        until: window.resetsAt === null ? null : clock(window.resetsAt, now),
        ...resetsOf(window, now, reset),
        ...(reset || stale || elapsedOf(window, now) === undefined ? {} : { elapsed: elapsedOf(window, now) }),
        ...(reset ? { unread: true } : {}),
      }
    }),
  }
}

/** Every agent read, least room first. */
export const planOf = (usage: PlanUsage | null, now: Date): { readonly agents: PlanAgent[] } => {
  const agents: PlanAgent[] = []
  const byAgent = new Map<string, AccountUsage[]>()
  // The accounts that had windows when they were read, though every one may have reset since: by the runtime's clock, which
  // then sends none, or by the window's own, which leaves out what has reset since it was sent.
  const wasRead = new Set<string>()
  const asRead = new Map<string, AccountUsage>()
  for (const read of usage?.accounts ?? []) {
    asRead.set(read.accountId, read)
    const account = current(read, now)
    if (read.resetSince || (read.resetWindows?.length ?? 0) > 0 || read.windows.length > 0) wasRead.add(account.accountId)
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
        ...collapsed(
          shown.map((account) => ({
            ...accountOf(account, several, now, asRead.get(account.accountId)),
            fault: faultOf(account) ?? account.noReading,
          })),
        ),
        ...(out ? { stopped: text.signedOut, signIn: true } : reset.length > 0 ? { unread: text.unread } : { connected: text.connected }),
      })
      continue
    }
    // An account read before, every window of which has reset since: its rows say so, beside the accounts still read.
    const reset = accounts.filter((account) => wasRead.has(account.accountId) && !read.some((one) => one.account === account))
    // Another account on the plan, connected but unread (a fresh OpenCode Go key in a new account), is in the detail too.
    const named = accounts.filter((account) => !wasRead.has(account.accountId) && namedUnread(account))
    // The figure is of the account new work would start on: one signed out keeps its last numbers in the peek, but runs nothing, as the runtime skips it.
    const runs = (account: AccountUsage) => account.fault?.kind !== 'sign_in_again'
    const usable = read.filter(({ account }) => runs(account))
    const route = usable.length === 0 ? undefined : usable.reduce((most, one) => (leftOf(one.window) > leftOf(most.window) ? one : most))
    // With no figure of its own, an account says why: its fault, or why nothing reads it.
    const unnumbered = (account: AccountUsage) => ({
      ...accountOf(account, several, now, asRead.get(account.accountId)),
      fault: faultOf(account) ?? account.noReading,
    })
    // The peek lists that account first, then the rest tightest first, then those with no figure, and those signed out last.
    const each = [
      ...[
        ...(route === undefined ? [] : [route]),
        ...read.filter((one) => one !== route).toSorted((a, b) => leftOf(a.window) - leftOf(b.window)),
      ].map(({ account }) => accountOf(account, several, now, asRead.get(account.accountId))),
      ...reset.map(unnumbered),
      ...named.map(unnumbered),
    ].toSorted((a, b) => Number(a.signedOut === true) - Number(b.signedOut === true))
    const detail = collapsed(each)
    if (route === undefined) {
      // None read can run. One reset since, or never read, that can is where the runtime starts work: no figure, and the
      // row says why (not read since reset, or connected). Only where none can is it signed out, with its saved numbers.
      const instead = reset.some(runs)
        ? { unread: text.unread }
        : named.some(runs)
          ? { connected: text.connected }
          : { stopped: text.signedOut, signIn: true }
      agents.push({
        id: agentId,
        name: nameOf(first),
        ...(brand === undefined ? {} : { brand }),
        left: 0,
        limit: '',
        until: null,
        account: null,
        ...detail,
        ...instead,
      })
      continue
    }
    agents.push({
      id: agentId,
      name: nameOf(first),
      ...(brand === undefined ? {} : { brand }),
      left: leftOf(route.window),
      limit: limitWords(route.window),
      until: route.window.resetsAt === null ? null : clock(route.window.resetsAt, now),
      ...(elapsedOf(route.window, now) === undefined ? {} : { elapsed: elapsedOf(route.window, now) }),
      account: several ? route.account.accountName : null,
      ...detail,
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
