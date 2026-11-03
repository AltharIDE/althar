import type { AccountUse } from '@althar/contracts'
import type { UsageLine } from '@althar/ui'
import { useSyncExternalStore } from 'react'

import { brandOf } from './agents'
import type { NameModel } from './modelNames'

/*
 * What a task, or the coordinator's day, used of each account its agents ran
 * on (ADR-084), as the kit's lines: an account named as the plan gauge's
 * peek names it, with its plan, and its own name where the agent has several.
 *
 * Whether Outputs' Usage is open is the person's, kept by this window across
 * launches for every task alike, as the board keeps its folded lanes: closed
 * until they open it, then open on every task until they close it.
 */

const planWord = (plan: string) => plan.charAt(0).toUpperCase() + plan.slice(1)

/** An account as its line names it: Claude Code Max, or Codex · Work where the agent has several. */
export const accountWords = (use: Pick<AccountUse, 'agentName' | 'accountName' | 'several' | 'plan'>) => {
  const agent = use.plan === null ? use.agentName : `${use.agentName} ${planWord(use.plan)}`
  return use.several ? `${agent} · ${use.accountName}` : agent
}

/** The kit's lines, from what a snapshot says each account was used. */
export const usageLines = (usage: ReadonlyArray<AccountUse> | undefined, named: NameModel): ReadonlyArray<UsageLine> =>
  (usage ?? []).map((use) => {
    const mark = brandOf(use.agentId)
    return {
      id: use.accountId,
      name: accountWords(use),
      ...(mark === undefined ? {} : { mark }),
      ...(use.paidBy === 'plan' ? { took: use.took } : { spent: use.spent }),
      estimated: use.estimated,
      models: use.models.map((model) => named(use.agentId, model).name),
      tokens: use.tokens,
    }
  })

const STORED = 'althar.usage'
const listeners = new Set<() => void>()
let last = false

/** What storage holds. Storage that can't be read keeps what this window last chose. */
const read = (): boolean => {
  try {
    return window.localStorage.getItem(STORED) === 'open'
  } catch {
    return last
  }
}

const write = (open: boolean) => {
  last = open
  try {
    if (open) window.localStorage.setItem(STORED, 'open')
    else window.localStorage.removeItem(STORED)
  } catch {
    // Kept for this window only, until storage can be written.
  }
  listeners.forEach((listener) => listener())
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

/** Whether Outputs' Usage is open, and how to keep what the person chooses next. */
export const useUsageOpen = (): readonly [boolean, (open: boolean) => void] => [useSyncExternalStore(subscribe, read), write]

/** Forgets the choice this window kept, as each test starts. */
export const forgetUsageOpen = () => {
  last = false
}
