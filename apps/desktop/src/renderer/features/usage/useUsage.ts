import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useState } from 'react'

import type { AccountUsage, PlanUsage, UsageWarning, UsageWindow } from '@althar/contracts'
import type { UsageAccountRow, UsageGroup, UsageMeterRow } from '@althar/ui'

import { messageOf } from '../../data/client'
import { keys, reads } from '../../data/reads'
import { useServices } from '../../data/services'
import { ago, clock, useNow } from '../../shared/time'

/*
 * Plan usage (Ctrl or ⌘ U): how much of each account's plan is left, by
 * window, and the warnings the person has not yet seen. The runtime sends
 * all of it whole whenever it changes (`feed.ts` puts it in the cache), so
 * the window reads it once and shows what the cache holds. Read again asks
 * every account's source anew. Seeing a warning, here or in a Talk room,
 * tells the runtime, which then drops it everywhere.
 */

export const text = {
  fiveHours: '5 hours',
  week: 'Week',
  month: 'Month',
  other: 'Other',
  /** A window of a kind with its own name: the week of one model. */
  named: (kind: string, label: string) => `${kind} · ${label}`,
  windowOf: { five_hour: '5-hour window', weekly: 'weekly window', monthly: 'monthly window', other: 'window' },
  reportedBy: (agent: string) => `Reported by ${agent}`,
  lastReportOf: (agent: string) => `From ${agent}’s last report`,
  provider: 'From the provider',
  readAt: (source: string, age: string) => `${source} · ${age}`,
}

/** A window's name on a meter: 5 hours, Week, Month, or its own name beside the kind it is of. */
export const windowName = (window: UsageWindow): string => {
  const kind =
    window.kind === 'five_hour' ? text.fiveHours : window.kind === 'weekly' ? text.week : window.kind === 'monthly' ? text.month : null
  if (kind === null) return window.label ?? text.other
  return window.label === null ? kind : text.named(kind, window.label)
}

/** Which window a warning is about, as words follow "the": 5-hour window, weekly Opus window. */
export const windowWords = (warning: Pick<UsageWarning, 'kind' | 'label'>): string => {
  const kind = text.windowOf[warning.kind]
  if (warning.label === null) return kind
  return warning.kind === 'other' ? `${warning.label} ${kind}` : `${kind.replace(/ window$/, '')} ${warning.label} window`
}

/** Where an account's numbers came from, in words, with how old they are. */
export const sourceWords = (account: AccountUsage, now: Date): string | null => {
  if (account.source === null) return null
  const from =
    account.source === 'agent'
      ? text.reportedBy(account.agentName)
      : account.source === 'endpoint'
        ? text.provider
        : text.lastReportOf(account.agentName)
  return account.observedAt === null ? from : text.readAt(from, ago(account.observedAt, now))
}

const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)

/** The windows an account has, as the kit's meters: the share left, not used. */
export const meterOf = (window: UsageWindow, now: Date): UsageMeterRow => ({
  id: window.label === null ? window.kind : `${window.kind}:${window.label}`,
  label: windowName(window),
  left: Math.min(100, Math.max(0, 100 - window.usedPercent)),
  resets: window.resetsAt === null ? null : clock(window.resetsAt, now),
})

export const rowOf = (account: AccountUsage, now: Date): UsageAccountRow => ({
  id: account.accountId,
  name: account.accountName,
  plan: account.plan === null ? null : capital(account.plan),
  paidBy: account.paidBy,
  meters: account.windows.map((window) => meterOf(window, now)),
  source: sourceWords(account, now),
  fault: account.fault,
  noReading: account.noReading,
})

/** Every account under its agent, the agents in the order the runtime lists them. */
export const groupsOf = (usage: PlanUsage, now: Date): ReadonlyArray<UsageGroup> => {
  const groups = new Map<string, { id: string; name: string; accounts: Array<UsageAccountRow> }>()
  for (const account of usage.accounts) {
    const group = groups.get(account.agentId) ?? { id: account.agentId, name: account.agentName, accounts: [] }
    group.accounts.push(rowOf(account, now))
    groups.set(account.agentId, group)
  }
  return [...groups.values()]
}

/** Whether a warning is the one an account's window names. */
const same = (
  one: { readonly accountId: string; readonly windowKey: string },
  other: { readonly accountId: string; readonly windowKey: string },
) => one.accountId === other.accountId && one.windowKey === other.windowKey

/** What the window has of plan usage: null before it is first read, or if that failed. */
export const usePlanUsage = (): PlanUsage | null => {
  const { client } = useServices()
  return useQuery(reads(client).planUsage()).data ?? null
}

/** Marks warnings seen: gone from the cache at once, and for good once the runtime says so; read again if it couldn't. */
export const useSeen = () => {
  const { client } = useServices()
  const cache = useQueryClient()
  return useCallback(
    (warnings: ReadonlyArray<Pick<UsageWarning, 'accountId' | 'windowKey'>>) => {
      const seen = warnings.map(({ accountId, windowKey }) => ({ accountId, windowKey }))
      cache.setQueryData<PlanUsage>(keys.planUsage, (usage) =>
        usage === undefined ? usage : { ...usage, warnings: usage.warnings.filter((one) => !seen.some((each) => same(each, one))) },
      )
      return client.acknowledgeUsageWarnings(seen).catch(() => void cache.invalidateQueries({ queryKey: keys.planUsage, exact: true }))
    },
    [client, cache],
  )
}

/** Opens the usage view over the window; outside the tabs, as a screen is in a test, there is none to open. */
export const UsageOpenContext = createContext<() => void>(() => undefined)
export const useOpenUsage = (): (() => void) => useContext(UsageOpenContext)

export interface UsageModel {
  /** Every agent with its accounts; null before the first read. */
  readonly groups: ReadonlyArray<UsageGroup> | null
  /** Every account is being read again. */
  readonly reading: boolean
  /** Why the last read again failed. */
  readonly error: string | null
  readonly refresh: () => void
}

export const useUsage = (): UsageModel => {
  const { client } = useServices()
  const cache = useQueryClient()
  const read = useQuery(reads(client).planUsage())
  // The ages say minutes and hours: written again each minute.
  const now = useNow(true, 60_000)
  const [reading, setReading] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const refresh = useCallback(() => {
    setReading(true)
    setFailed(null)
    client
      .getPlanUsage({ refresh: true })
      .then((fresh) => void cache.setQueryData(keys.planUsage, fresh))
      .catch((failure: unknown) => setFailed(messageOf(failure)))
      .finally(() => setReading(false))
  }, [client, cache])
  const usage = read.data
  return {
    groups: usage === undefined ? null : groupsOf(usage, new Date(now)),
    reading,
    error: failed ?? (read.isError ? messageOf(read.error) : null),
    refresh,
  }
}
