import type { ChangeSummary } from '@althar/contracts'
import type { IconName } from '@althar/ui'

/*
 * What stands between a ready change's open pull request and merging it,
 * read from the change as Althar last saw it, most pressing first: commits
 * not on it yet (pushing them runs the checks again, so they go first), a
 * conflict with the branch it merges into, checks that failed, checks still
 * running, and checks that were cancelled (a host holds a merge on one as on
 * a failure). A draft isn't in the way: merging marks it ready first.
 * Then the one next thing to do. The board's card says them as one line with
 * that thing at its end; the home's line, as its brief with that thing as
 * its button. Both say them in the same words.
 */

export type Blocker =
  /** The branch here and the pull request have parted, so a plain push would be refused. */
  | { readonly kind: 'parted' }
  | { readonly kind: 'unpushed'; readonly commits: number }
  | { readonly kind: 'conflict'; readonly target: string | null }
  | { readonly kind: 'failed'; readonly failing: ReadonlyArray<string>; readonly failed: number }
  | { readonly kind: 'running'; readonly passed: number; readonly total: number }
  | { readonly kind: 'cancelled'; readonly cancelled: ReadonlyArray<string> }

/** The one next thing, where there is one the person can do from where they are; none while checks run, or where it needs the task. */
export type Next =
  | { readonly kind: 'merge' }
  | { readonly kind: 'push'; readonly commits: number }
  | { readonly kind: 'resolve' }
  | { readonly kind: 'fix'; readonly failing: ReadonlyArray<string> }

export interface Standing {
  /** Most pressing first. */
  readonly blockers: ReadonlyArray<Blocker>
  readonly next: Next | null
}

export const standingText = {
  commits: (n: number) => (n === 1 ? '1 commit' : `${n} commits`),
  parted: (short: string) => `Branch and ${short} have parted`,
  unpushed: (n: number, short: string) => `${standingText.commits(n)} not on the ${short}`,
  conflict: (target: string | null) => (target === null ? 'Has a merge conflict' : `Conflicts with ${target}`),
  failed: (failing: ReadonlyArray<string>, failed: number) =>
    failing.length === 1 ? `${failing[0]} failed` : failed === 1 ? '1 check failed' : `${failed} checks failed`,
  running: (passed: number, total: number) => `Checks running, ${passed} of ${total} passed`,
  cancelled: (cancelled: ReadonlyArray<string>) =>
    cancelled.length === 1 ? `${cancelled[0]} cancelled` : `${cancelled.length} checks cancelled`,
  passed: (n: number) => (n === 1 ? '1 check passed' : `All ${n} checks passed`),
  /** Some skipped, or said nothing: not all passed, though none is in the way. */
  soFar: (passed: number, total: number) => `${passed} of ${total} checks passed`,
  none: 'No checks ran',
  next: {
    merge: 'Accept and merge',
    push: (n: number) => (n === 1 ? 'Push 1 commit' : `Push ${n} commits`),
    resolve: 'Ask the lead to resolve it',
    fix: 'Ask the lead to fix it',
  },
  /** What asking the lead to fix the checks says to it. */
  fixNote: (where: string, failing: ReadonlyArray<string>) =>
    failing.length === 0
      ? `The checks on ${where} failed. Fix what made them fail, then ask to push.`
      : `${failing.length === 1 ? 'A check' : 'Checks'} on ${where} failed: ${failing.join(', ')}. Fix what made ${failing.length === 1 ? 'it' : 'them'} fail, then ask to push.`,
  /** What asking the lead to resolve a conflict says to it, as the task's own Resolve does. */
  resolveNote: (where: string, target: string | null) => {
    const branch = target ?? 'the branch it merges into'
    return `${where} conflicts with ${branch}. Bring the branch up to date: merge ${branch} into it, settle each conflict so both sides' changes hold, run the checks, and commit the merge. Merge, don't rebase: a branch that was pushed can't be rewritten. Then say it's ready to merge again.`
  },
}

export const standingOf = (change: ChangeSummary): Standing => {
  const checks = change.checks
  const blockers: Blocker[] = []
  // Commits here count only once the branch's head here is known, as the task's own Push does.
  if (change.diverged !== null) blockers.push({ kind: 'parted' })
  else if (change.localHead !== null && change.unpushed > 0) blockers.push({ kind: 'unpushed', commits: change.unpushed })
  if (change.conflicts === true) blockers.push({ kind: 'conflict', target: change.target ?? null })
  // The checks say one thing: one failed, or they're still running, or, once done, one was cancelled.
  const cancelled = checks === null ? [] : checks.list.filter((check) => check.state === 'cancelled').map((check) => check.name)
  if (checks !== null && checks.failed > 0) blockers.push({ kind: 'failed', failing: checks.failing, failed: checks.failed })
  else if (checks !== null && checks.running > 0) blockers.push({ kind: 'running', passed: checks.passed, total: checks.total })
  else if (cancelled.length > 0) blockers.push({ kind: 'cancelled', cancelled })
  return { blockers, next: nextOf(blockers[0]) }
}

const nextOf = (first: Blocker | undefined): Next | null => {
  switch (first?.kind) {
    case undefined:
      return { kind: 'merge' }
    case 'unpushed':
      return { kind: 'push', commits: first.commits }
    case 'conflict':
      return { kind: 'resolve' }
    case 'failed':
      return { kind: 'fix', failing: first.failing }
    // Parted, it is sorted out in the task; running, there's nothing to do but wait; cancelled, they're run again on the host.
    case 'parted':
    case 'running':
    case 'cancelled':
      return null
  }
}

/** A thing in the way, as a fact says it: its words, its glyph and its tone. */
export interface Said {
  readonly words: string
  readonly icon?: IconName
  readonly tone: 'quiet' | 'ok' | 'warm' | 'danger' | 'live'
}

export const saidOf = (blocker: Blocker, change: Pick<ChangeSummary, 'short'>): Said => {
  const t = standingText
  switch (blocker.kind) {
    case 'parted':
      return { words: t.parted(change.short), icon: 'branch', tone: 'warm' }
    case 'unpushed':
      return { words: t.unpushed(blocker.commits, change.short), icon: 'up', tone: 'warm' }
    case 'conflict':
      return { words: t.conflict(blocker.target), icon: 'branch', tone: 'warm' }
    case 'failed':
      return { words: t.failed(blocker.failing, blocker.failed), icon: 'close', tone: 'danger' }
    case 'running':
      return { words: t.running(blocker.passed, blocker.total), tone: 'live' }
    case 'cancelled':
      return { words: t.cancelled(blocker.cancelled), icon: 'stop', tone: 'warm' }
  }
}

/** Nothing in the way: how its checks went, green only where every one passed, or that none ran. */
export const clearOf = (change: Pick<ChangeSummary, 'checks'>): Said => {
  const checks = change.checks
  if (checks === null || checks.total === 0) return { words: standingText.none, tone: 'quiet' }
  return checks.passed === checks.total
    ? { words: standingText.passed(checks.total), icon: 'check', tone: 'ok' }
    : { words: standingText.soFar(checks.passed, checks.total), tone: 'quiet' }
}

/** What stands, as facts: each thing in the way, or how its checks went where nothing is. */
export const factsOf = (change: ChangeSummary, standing: Standing = standingOf(change)): ReadonlyArray<Said> =>
  standing.blockers.length === 0 ? [clearOf(change)] : standing.blockers.map((one) => saidOf(one, change))

/** The next thing, in its words. */
export const nextWords = (next: Next): string => {
  const t = standingText.next
  switch (next.kind) {
    case 'merge':
      return t.merge
    case 'push':
      return t.push(next.commits)
    case 'resolve':
      return t.resolve
    case 'fix':
      return t.fix
  }
}
