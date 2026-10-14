import type { BoardTask } from '@althar/contracts'

/*
 * What stands between a ready change and merging it, read from its card.
 * Checks, draft and unpushed commits are on the change data today
 * (`ChangeSummary`). The rest are `Facts`, kept beside the task here,
 * because the card doesn't carry them yet:
 *
 *   conflict   The runtime finds it (Changes.conflictsNow, and the host's
 *              mergeable state as it listens) but only keeps it as a conflict
 *              round when the lead resolves; a card sees `handedBack`, or a
 *              running task on step `conflict`. Needs: `conflict: { files,
 *              lead: 'none' | 'resolving' | 'handed_back' }` on TaskCard, and a
 *              ready task to stay ready while its lead resolves.
 *   changes requested, behind main
 *              Not read at all yet: the host's review decision and how far
 *              its base moved, on the change's snapshot.
 */

export interface Facts {
  readonly conflict?: { readonly files: ReadonlyArray<string>; readonly lead: 'none' | 'resolving' }
  readonly changesRequested?: { readonly by: string }
  /** Commits on main since the branch left it. */
  readonly behind?: number
}

export type Blocker =
  | { readonly kind: 'unpushed'; readonly commits: number }
  | { readonly kind: 'conflict'; readonly files: ReadonlyArray<string> }
  | { readonly kind: 'failed'; readonly failing: ReadonlyArray<string>; readonly failed: number; readonly total: number }
  | { readonly kind: 'changes'; readonly by: string }
  | { readonly kind: 'draft' }
  | { readonly kind: 'running'; readonly running: number; readonly passed: number; readonly total: number }
  | { readonly kind: 'resolving'; readonly files: ReadonlyArray<string> }
  | { readonly kind: 'behind'; readonly commits: number }

/** Who has the next move: the person (blocked), someone else (CI or the lead: waiting), or nobody (good to merge). */
export type Group = 'merge' | 'blocked' | 'waiting'

export interface Standing {
  /** Most pressing first: what the person does next leads. */
  readonly blockers: ReadonlyArray<Blocker>
  readonly group: Group
  /** Checks that passed, of how many, where any ran. */
  readonly checks: { readonly passed: number; readonly total: number } | null
  /** The one next thing to do, in the app's words where it has them. */
  readonly next: Next
}

export type Next =
  | { readonly kind: 'merge'; readonly label: string }
  | { readonly kind: 'push'; readonly label: string }
  | { readonly kind: 'fix'; readonly label: string }
  | { readonly kind: 'resolve'; readonly label: string }
  | { readonly kind: 'ready'; readonly label: string }
  /** DEV-91: merge on its own once the checks pass. */
  | { readonly kind: 'auto'; readonly label: string }
  | { readonly kind: 'none'; readonly label: string }

/** What only the person can clear; the rest is someone else's move, or doesn't stop a merge. */
const yours = new Set<Blocker['kind']>(['unpushed', 'conflict', 'failed', 'changes', 'draft'])
const theirs = new Set<Blocker['kind']>(['running', 'resolving'])
/** The order they're said in: what to do first leads. Pushing goes first, as new commits run the checks again. */
const order: ReadonlyArray<Blocker['kind']> = ['unpushed', 'conflict', 'failed', 'changes', 'draft', 'resolving', 'running', 'behind']

export const commits = (n: number) => (n === 1 ? '1 commit' : `${n} commits`)

const nextOf = (first: Blocker | undefined): Next => {
  switch (first?.kind) {
    case undefined:
    case 'behind':
      return { kind: 'merge', label: 'Accept and merge' }
    case 'unpushed':
      return { kind: 'push', label: `Push ${commits(first.commits)}` }
    case 'conflict':
      return { kind: 'resolve', label: 'Ask the lead to resolve it' }
    case 'failed':
      return { kind: 'fix', label: 'Ask the lead to fix it' }
    case 'changes':
      return { kind: 'fix', label: 'Send the review to the lead' }
    case 'draft':
      return { kind: 'ready', label: 'Mark ready for review' }
    case 'running':
      return { kind: 'auto', label: 'Merge when checks pass' }
    case 'resolving':
      return { kind: 'none', label: 'Open' }
  }
}

export const standingOf = (task: BoardTask, facts: Facts = {}): Standing => {
  const change = task.change
  const checks = change?.checks ?? null
  const found: Blocker[] = []
  if (change !== null && change.localHead !== null && change.unpushed > 0) found.push({ kind: 'unpushed', commits: change.unpushed })
  if (facts.conflict !== undefined)
    found.push(
      facts.conflict.lead === 'resolving'
        ? { kind: 'resolving', files: facts.conflict.files }
        : { kind: 'conflict', files: facts.conflict.files },
    )
  if (checks !== null && checks.failed > 0)
    found.push({ kind: 'failed', failing: checks.failing, failed: checks.failed, total: checks.total })
  else if (checks !== null && checks.running > 0)
    found.push({ kind: 'running', running: checks.running, passed: checks.passed, total: checks.total })
  if (facts.changesRequested !== undefined) found.push({ kind: 'changes', by: facts.changesRequested.by })
  if (change?.draft === true) found.push({ kind: 'draft' })
  if (facts.behind !== undefined && facts.behind > 0) found.push({ kind: 'behind', commits: facts.behind })
  const blockers = found.toSorted((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
  const group: Group = blockers.some((one) => yours.has(one.kind))
    ? 'blocked'
    : blockers.some((one) => theirs.has(one.kind))
      ? 'waiting'
      : 'merge'
  return {
    blockers,
    group,
    checks: checks === null || checks.total === 0 ? null : { passed: checks.passed, total: checks.total },
    next: nextOf(blockers[0]),
  }
}

/** Only what stops a merge: being behind main doesn't, unless the repository asks branches to be up to date. */
export const stopping = (standing: Standing) => standing.blockers.filter((one) => one.kind !== 'behind')

/** A file's name, without its folders. */
export const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1)
