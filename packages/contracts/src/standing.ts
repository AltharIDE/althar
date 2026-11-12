import type { ChangeSummary } from './Api'

/*
 * What stands between a ready change's open pull request and merging it,
 * read from the change as Althar last saw it, most pressing first: commits
 * not on it yet (pushing them runs the checks again, so they go first), a
 * conflict with the branch it merges into, checks that failed, checks still
 * running, and checks that were cancelled (a host holds a merge on one as on
 * a failure). A draft isn't in the way: merging marks it ready first.
 * Then the one next thing to do. Where the project's rules push the lead's
 * commits on their own (ADR-072), commits here are the person's to push only
 * where Althar held them; the others are on their way, and nothing is
 * accepted until they're on it. The window says it in its words
 * (`shared/standing.ts`); every place, the runtime's notifications too, reads
 * where a change stands from here (`waiting.ts`).
 */

export type Blocker =
  /** The branch here and the pull request have parted, so a plain push would be refused. */
  | { readonly kind: 'parted' }
  /** `held`: why they didn't go up on their own, where the project's rules push them so. */
  | { readonly kind: 'unpushed'; readonly commits: number; readonly held: string | null }
  /** Going up on their own as the lead's turn ends (ADR-072): not the person's to push, but not on it to accept yet either. */
  | { readonly kind: 'going'; readonly commits: number }
  /** Waiting on a branch held for Ship: Ship sends them up, after its review, and no push does. */
  | { readonly kind: 'shipping'; readonly commits: number }
  | { readonly kind: 'conflict'; readonly target: string | null }
  | { readonly kind: 'failed'; readonly failing: ReadonlyArray<string>; readonly failed: number }
  | { readonly kind: 'running'; readonly passed: number; readonly total: number }
  | { readonly kind: 'cancelled'; readonly cancelled: ReadonlyArray<string> }

/** The one next thing, where there is one the person can do from where they are; none while checks run, or where it needs the task. */
export type NextThing =
  | { readonly kind: 'merge' }
  | { readonly kind: 'push'; readonly commits: number }
  /** What waits on its branch for Ship goes up, its review first where its plan has one (a task is a conversation plus parts). */
  | { readonly kind: 'ship'; readonly commits: number }
  | { readonly kind: 'resolve' }
  | { readonly kind: 'fix'; readonly failing: ReadonlyArray<string> }
  /** What a review after a merge found goes to the lead, its fix shipping after the merged pull request (a task is a conversation plus parts). */
  | { readonly kind: 'fix_after_merge'; readonly words: string }

export interface ChangeStanding {
  /** Most pressing first. */
  readonly blockers: ReadonlyArray<Blocker>
  readonly next: NextThing | null
}

/**
 * Whether the commits here are the person's to push: always, unless the
 * project's rules push them on their own and nothing held them (ADR-072),
 * or they wait for Ship, which alone sends them up (`forShip`).
 */
export const personPushes = (change: Pick<ChangeSummary, 'pushing'>): boolean =>
  !forShip(change) && (change.pushing === undefined || change.pushing.held !== null)

/** Whether the commits here go up on their own as the lead's turn ends (ADR-072): not the person's, and on their way. */
export const goingUp = (change: Pick<ChangeSummary, 'pushing'>): boolean =>
  change.pushing !== undefined && change.pushing.held === null && !forShip(change)

/** Whether the commits here wait on a branch held for Ship: Ship sends them up, after its review; no Push does. */
export const forShip = (change: Pick<ChangeSummary, 'pushing'>): boolean => change.pushing?.ship === true

/** A head's checks without the skipped ones: they never ran, so they are neither passed nor missing from the total. */
export const ranChecks = (checks: NonNullable<ChangeSummary['checks']>): { readonly passed: number; readonly total: number } => ({
  passed: checks.passed,
  total: checks.total - checks.list.filter((check) => check.state === 'skipped').length,
})

export const standingOf = (change: ChangeSummary): ChangeStanding => {
  const checks = change.checks
  const blockers: Blocker[] = []
  // Commits here count only once the branch's head here is known, as the task's own Push does; going up on their own, they wait.
  if (change.diverged !== null) blockers.push({ kind: 'parted' })
  else if (change.localHead !== null && change.unpushed > 0)
    blockers.push(
      forShip(change)
        ? { kind: 'shipping', commits: change.unpushed }
        : personPushes(change)
          ? { kind: 'unpushed', commits: change.unpushed, held: change.pushing?.held ?? null }
          : { kind: 'going', commits: change.unpushed },
    )
  if (change.conflicts === true) blockers.push({ kind: 'conflict', target: change.target ?? null })
  // The checks say one thing: one failed, or they're still running, or, once done, one was cancelled.
  const cancelled = checks === null ? [] : checks.list.filter((check) => check.state === 'cancelled').map((check) => check.name)
  if (checks !== null && checks.failed > 0) blockers.push({ kind: 'failed', failing: checks.failing, failed: checks.failed })
  // Run again by Althar, a cancelled check is running before its host shows it so.
  else if (checks !== null && (checks.running > 0 || checks.outcome === 'running')) blockers.push({ kind: 'running', ...ranChecks(checks) })
  else if (cancelled.length > 0) blockers.push({ kind: 'cancelled', cancelled })
  return { blockers, next: nextOf(blockers[0]) }
}

const nextOf = (first: Blocker | undefined): NextThing | null => {
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
    // Held for Ship, Ship is offered where the task's hold is, with what it reviews.
    case 'parted':
    case 'going':
    case 'shipping':
    case 'running':
    case 'cancelled':
      return null
  }
}

/**
 * Whether pushing the commits here is what clears the conflict: the lead
 * brings the branch it conflicts with into its own, and that merge is among
 * the commits not on the pull request yet, so the host's word on the
 * conflict is out of date until they are. Althar can't see the commits'
 * content from here, so any commits beside a conflict are taken to be that.
 */
export const pushResolves = (standing: ChangeStanding): boolean =>
  standing.blockers.some((one) => one.kind === 'conflict') &&
  standing.blockers.some((one) => one.kind === 'unpushed' || one.kind === 'going' || one.kind === 'shipping')

/** Whether the change is not ready to accept as it stands, and pushing won't make it so: a conflict nothing here resolves, a failed or cancelled check, a branch that parted. */
export const isBlocked = (standing: ChangeStanding): boolean =>
  standing.blockers.some((one) =>
    one.kind === 'conflict'
      ? !pushResolves(standing)
      : one.kind !== 'unpushed' && one.kind !== 'going' && one.kind !== 'shipping' && one.kind !== 'running',
  )
