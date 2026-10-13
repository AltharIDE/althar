import type { BoardTask } from '@althar/contracts'

import { type Extra, extraOf } from './scenario'

/*
 * What stands between the person and accepting a task, worked out once for
 * every direction: each thing in the way, in the order to deal with it, and
 * where the task stands overall. Good to merge: nothing in the way. Waiting:
 * only what is under way without the person (checks running, the lead
 * resolving a conflict). Yours: something only the person can move.
 */

export type Verdict = 'good' | 'waiting' | 'yours'

/** How a thing in the way reads: broken (red), the person's move (violet), under way (cobalt), or only so you know (grey). */
export type Tone = 'danger' | 'signal' | 'live' | 'quiet'

export interface Blocker {
  readonly kind: 'push' | 'conflict' | 'resolving' | 'failing' | 'changes' | 'draft' | 'running' | 'behind'
  /** In a couple of words, for a line of several. */
  readonly short: string
  /** In a sentence's worth, for a list. */
  readonly says: string
  /** What it concerns: the checks that failed, the files that conflict. */
  readonly detail?: string
  /** The one thing that moves it, where the person can. */
  readonly action?: string
  readonly tone: Tone
}

export interface Readiness {
  readonly verdict: Verdict
  /** In the order to deal with them; behind main is said, but blocks nothing. */
  readonly blockers: ReadonlyArray<Blocker>
  /** How its checks went, when nothing is wrong with them: All 5 checks passed. */
  readonly passed: string
  readonly checks: { readonly passed: number; readonly failed: number; readonly running: number; readonly total: number }
  readonly unpushed: number
  /** The first thing the person can do about it, or nothing: then it is Review. */
  readonly next: Blocker | undefined
}

export const commitsWord = (n: number) => (n === 1 ? '1 commit' : `${n} commits`)
const and = (names: ReadonlyArray<string>) =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
const base = (path: string) => path.slice(path.lastIndexOf('/') + 1)

export const words = {
  good: 'Good to merge',
  waiting: 'Waiting on checks',
  yours: 'Needs you',
  review: 'Review',
  passed: (n: number) => (n === 0 ? 'No checks ran' : n === 1 ? '1 check passed' : `All ${n} checks passed`),
  clear: {
    checks: (n: number) => (n === 1 ? 'Its check passed' : `All ${n} checks passed`),
    conflict: 'No conflicts with main',
    push: 'Everything is on the PR',
  },
}

export const readinessOf = (task: BoardTask, extra: Extra = extraOf(task.slug) ?? {}): Readiness => {
  const change = task.change
  const checks = change?.checks ?? null
  const counts = {
    passed: checks?.passed ?? 0,
    failed: checks?.failed ?? 0,
    running: checks?.running ?? 0,
    total: checks?.total ?? 0,
  }
  const unpushed = change?.unpushed ?? 0
  const noun = change === null ? 'branch' : change.short
  const blockers: Blocker[] = []
  if (unpushed > 0)
    blockers.push({
      kind: 'push',
      short: `${commitsWord(unpushed)} to push`,
      says: `${commitsWord(unpushed)} not on the ${noun}`,
      action: `Push ${commitsWord(unpushed)}`,
      tone: 'signal',
    })
  if (extra.conflict && !extra.conflict.resolving)
    blockers.push({
      kind: 'conflict',
      short: 'Conflicts with main',
      says: 'Conflicts with main',
      detail: `in ${and(extra.conflict.files.map(base))}`,
      action: 'Ask the lead to resolve',
      tone: 'danger',
    })
  if (extra.conflict?.resolving)
    blockers.push({
      kind: 'resolving',
      short: 'Lead resolving a conflict',
      says: 'The lead is resolving a conflict with main',
      detail: `in ${and(extra.conflict.files.map(base))}`,
      tone: 'live',
    })
  if (counts.failed > 0)
    blockers.push({
      kind: 'failing',
      short: `${and(checks?.failing ?? [])} failed`,
      says: counts.failed === 1 ? `${checks?.failing[0]} failed` : `${counts.failed} checks failed`,
      detail: counts.failed === 1 ? `${checks?.list.find((one) => one.state === 'failed')?.summary ?? ''}` : and(checks?.failing ?? []),
      // With commits to push, those may be the fix: push first, then look again.
      action: 'Ask the lead to fix',
      tone: 'danger',
    })
  if (extra.changesBy)
    blockers.push({
      kind: 'changes',
      short: 'Changes requested',
      says: `${extra.changesBy} asked for changes`,
      action: 'Send to the lead',
      tone: 'signal',
    })
  if (change?.draft)
    blockers.push({ kind: 'draft', short: 'Draft', says: `The ${noun} is still a draft`, action: 'Mark ready for review', tone: 'signal' })
  if (counts.running > 0)
    blockers.push({
      kind: 'running',
      short: `Checks running, ${counts.total - counts.running} of ${counts.total}`,
      says: `Checks running: ${counts.total - counts.running} of ${counts.total} done`,
      tone: 'live',
    })
  if (extra.behind)
    blockers.push({ kind: 'behind', short: `${extra.behind} behind main`, says: `${commitsWord(extra.behind)} behind main`, tone: 'quiet' })

  const blocking = blockers.filter((one) => one.kind !== 'behind')
  const verdict: Verdict = blocking.some((one) => one.tone === 'danger' || one.tone === 'signal')
    ? 'yours'
    : blocking.length > 0
      ? 'waiting'
      : 'good'
  return {
    verdict,
    blockers,
    passed: words.passed(counts.passed),
    checks: counts,
    unpushed,
    next: blockers.find((one) => one.action !== undefined),
  }
}

/** Readiness, as the board sorts it: good to merge first, then what needs you, then what waits on checks. */
export const rank: Record<Verdict, number> = { good: 0, yours: 1, waiting: 2 }
