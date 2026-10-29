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
 * its button. Both say them in the same words, and both do the person's own
 * (push, merge) right there; the lead's (resolve, fix) the card leaves to its
 * task. Where the project's rules push the lead's commits on their own
 * (ADR-071), commits here are the person's to push only where Althar held
 * them, and the card says why; the others are on their way, and nothing is
 * accepted until they're on it.
 */

export type Blocker =
  /** The branch here and the pull request have parted, so a plain push would be refused. */
  | { readonly kind: 'parted' }
  /** `held`: why they didn't go up on their own, where the project's rules push them so. */
  | { readonly kind: 'unpushed'; readonly commits: number; readonly held: string | null }
  /** Going up on their own as the lead's turn ends (ADR-071): not the person's to push, but not on it to accept yet either. */
  | { readonly kind: 'going'; readonly commits: number }
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
  going: (n: number, short: string) => `${standingText.commits(n)} going up to the ${short}`,
  /** Commits to push that bring the branch up to date with the one the pull request conflicts with: pushing them clears the conflict. */
  pushResolves: (target: string | null) => `The push should resolve the conflict${target === null ? '' : ` with ${target}`}`,
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
  /** While a next thing done from where it is shown is under way. */
  doing: {
    merge: 'Merging',
    push: (n: number) => (n === 1 ? 'Pushing 1 commit' : `Pushing ${n} commits`),
  },
  /** After one failed: what happened, and the button that tries it again. */
  nextFailed: {
    merge: (why: string) => `Merge failed: ${why}`,
    push: (why: string) => `Push failed: ${why}`,
    again: 'Try again',
  },
  /** What a screen reader hears of the button for a next thing, naming the pull request it acts on. */
  label: {
    merge: (where: string) => `Accept and merge ${where}`,
    push: (n: number, where: string) => `${n === 1 ? 'Push 1 commit' : `Push ${n} commits`} to ${where}`,
    mergeAgain: (where: string) => `Try merging ${where} again`,
    pushAgain: (n: number, where: string) => `Try pushing ${n === 1 ? '1 commit' : `${n} commits`} to ${where} again`,
  },
}

/**
 * Whether the commits here are the person's to push: always, unless the
 * project's rules push them on their own and nothing held them (ADR-071).
 */
export const personPushes = (change: Pick<ChangeSummary, 'pushing'>): boolean =>
  change.pushing === undefined || change.pushing.held !== null

export const standingOf = (change: ChangeSummary): Standing => {
  const checks = change.checks
  const blockers: Blocker[] = []
  // Commits here count only once the branch's head here is known, as the task's own Push does; going up on their own, they wait.
  if (change.diverged !== null) blockers.push({ kind: 'parted' })
  else if (change.localHead !== null && change.unpushed > 0)
    blockers.push(
      personPushes(change)
        ? { kind: 'unpushed', commits: change.unpushed, held: change.pushing?.held ?? null }
        : { kind: 'going', commits: change.unpushed },
    )
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
    // Parted, it is sorted out in the task; going up or running, there's nothing to do but wait; cancelled, they're run again on the host.
    case 'parted':
    case 'going':
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
      return { words: blocker.held ?? t.unpushed(blocker.commits, change.short), icon: 'up', tone: 'warm' }
    case 'going':
      return { words: t.going(blocker.commits, change.short), icon: 'up', tone: 'live' }
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

/**
 * Whether pushing the commits here is what clears the conflict: the lead
 * brings the branch it conflicts with into its own, and that merge is among
 * the commits not on the pull request yet, so the host's word on the
 * conflict is out of date until they are. Althar can't see the commits'
 * content from here, so any commits beside a conflict are taken to be that.
 */
export const pushResolves = (standing: Standing): boolean =>
  standing.blockers.some((one) => one.kind === 'conflict') &&
  standing.blockers.some((one) => one.kind === 'unpushed' || one.kind === 'going')

/** Whether the change is not ready to accept as it stands, and pushing won't make it so: a conflict nothing here resolves, a failed or cancelled check, a branch that parted. */
export const isBlocked = (standing: Standing): boolean =>
  standing.blockers.some((one) =>
    one.kind === 'conflict' ? !pushResolves(standing) : one.kind !== 'unpushed' && one.kind !== 'going' && one.kind !== 'running',
  )

/** How facts read, top to bottom: what blocks, then what to do, then what is fine or on its way. */
const readOrder: Record<Blocker['kind'], number> = { parted: 0, conflict: 0, failed: 0, cancelled: 0, unpushed: 1, going: 2, running: 2 }

/**
 * What stands, as facts: what blocks first (a conflict, failed checks), then
 * checks running, or, where nothing is in the way, how its checks went.
 * Commits to push aren't a fact of their own, as the button that pushes them
 * says their count, unless Althar held them where it pushes a lead's commits
 * on its own: then why (ADR-071). Only that pushing clears a conflict is said,
 * in place of it. Where they were all that was in the way, how the checks
 * went stands.
 */
export const factsOf = (change: ChangeSummary, standing: Standing = standingOf(change)): ReadonlyArray<Said> => {
  const together = pushResolves(standing)
  const facts = standing.blockers
    .filter((one) => one.kind !== 'unpushed' || one.held !== null)
    .sort((a, b) => readOrder[a.kind] - readOrder[b.kind])
    .map((one): Said => {
      if (together && one.kind === 'conflict') return { words: standingText.pushResolves(one.target), icon: 'up', tone: 'warm' }
      return saidOf(one, change)
    })
  return facts.length === 0 ? [clearOf(change)] : facts
}

/** Whether the next thing is the person's own, done from where it is shown: pushing and merging. The others are the lead's, and open the task. */
export type DoneHere = Extract<Next, { kind: 'merge' | 'push' }>

export const doneHere = (next: Next): next is DoneHere => next.kind === 'merge' || next.kind === 'push'

/** The next thing while it is under way. */
export const doingWords = (next: Extract<Next, { kind: 'merge' | 'push' }>): string =>
  next.kind === 'merge' ? standingText.doing.merge : standingText.doing.push(next.commits)

/** The next thing's button, for a screen reader: what it does and to which pull request; or, after it failed, that it tries again. */
export const labelWords = (next: Extract<Next, { kind: 'merge' | 'push' }>, where: string, failed = false): string => {
  const t = standingText.label
  return next.kind === 'merge'
    ? failed
      ? t.mergeAgain(where)
      : t.merge(where)
    : failed
      ? t.pushAgain(next.commits, where)
      : t.push(next.commits, where)
}

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
