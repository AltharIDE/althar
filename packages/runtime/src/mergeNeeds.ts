import type { HostNeed, MergeRules } from '@althar/connectors'
import type { ChangeSummary, MergeNeed } from '@althar/contracts'

/*
 * What merging a change needs, each as it stands (DEV-204): its host's
 * requirements as last read (`MergeRules`), and what Althar knows of it
 * itself, its checks, its conflict, whether it is a draft and what is left to
 * push, in one list, in the same order on every host. A line the host can't
 * tell is unknown, never met; one its branch doesn't require is left out.
 */

type Seen = Omit<ChangeSummary, 'needs'>
type Ran = NonNullable<ChangeSummary['checks']>['list'][number]

const failed = (check: Ran) => check.state === 'failed' || check.state === 'cancelled'
const running = (check: Ran) => check.state === 'queued' || check.state === 'running'

/**
 * Its required checks: all passed, one failed, or some still to finish,
 * named; a required one that hasn't started is still to finish. Where the
 * host names the required ones, the others are apart and hold nothing back;
 * where it says all of them, or can't say, every check counts.
 */
export const checksNeedOf = (checks: Seen['checks'], required: MergeRules['requiredChecks']): MergeNeed => {
  if (checks === null) return { kind: 'checks', state: 'unknown' }
  const named = Array.isArray(required) ? (required as ReadonlyArray<string>) : null
  const counted = named === null ? checks.list : checks.list.filter((check) => named.includes(check.name))
  const missing = named === null ? [] : named.filter((name) => !checks.list.some((check) => check.name === name))
  const failing = counted.filter(failed).map((check) => check.name)
  const pending = [...counted.filter(running).map((check) => check.name), ...missing]
  const need = named === null ? counted.length : named.length
  const have = counted.filter((check) => !failed(check) && !running(check)).length
  const others = named === null ? [] : checks.list.filter((check) => !named.includes(check.name))
  const apart =
    others.length === 0
      ? {}
      : {
          apart: {
            passed: others.filter((check) => !failed(check) && !running(check)).length,
            failed: others.filter(failed).map((check) => check.name),
            running: others.filter(running).length,
          },
        }
  // None run yet: every check that will run is to come, if the host holds it to them; where it can't say, Althar can't either.
  const none = named === null && counted.length === 0
  return {
    kind: 'checks',
    state:
      failing.length > 0
        ? 'unmet'
        : pending.length > 0 || (none && required === 'all')
          ? 'waiting'
          : none && checks.outcome !== 'passed'
            ? 'unknown'
            : 'met',
    have,
    need,
    ...(failing.length > 0 ? { who: failing } : pending.length > 0 ? { who: pending } : {}),
    ...(named === null ? {} : { required: named }),
    ...apart,
  }
}

/**
 * What of its lead's is left to push: nothing; commits, waiting where they go
 * up on their own as its lead's turn ends (ADR-072), else the person's to
 * push; or, where its branch and it have parted, a push that would be refused.
 */
export const pushedNeedOf = (change: Pick<Seen, 'localHead' | 'unpushed' | 'diverged' | 'pushing'>): MergeNeed =>
  change.diverged !== null
    ? { kind: 'pushed', state: 'unmet' }
    : change.localHead !== null && change.unpushed > 0
      ? { kind: 'pushed', state: change.pushing !== undefined && change.pushing.held === null ? 'waiting' : 'unmet', have: change.unpushed }
      : { kind: 'pushed', state: 'met' }

const host = (one: HostNeed): MergeNeed => one

/**
 * The whole list for an open change whose host said what merging it needs:
 * its checks, then its reviews and conversations, being up to date, its
 * conflict, draft and push, then the rest its branch requires. None for one
 * that isn't open, or whose host hasn't said.
 */
export const mergeNeedsOf = (change: Seen, rules: MergeRules | null | undefined): ReadonlyArray<MergeNeed> | undefined => {
  if (rules == null || change.state !== 'open') return undefined
  const of = (...kinds: ReadonlyArray<HostNeed['kind']>) => rules.needs.filter((one) => kinds.includes(one.kind)).map(host)
  return [
    checksNeedOf(change.checks, rules.requiredChecks),
    ...of('approvals', 'code_owners', 'changes_requested', 'conversations', 'up_to_date'),
    { kind: 'conflicts', state: change.conflicts === true ? 'unmet' : change.conflicts === false ? 'met' : 'unknown' },
    { kind: 'draft', state: change.draft ? 'unmet' : 'met' },
    pushedNeedOf(change),
    ...of('signatures', 'linear_history', 'merge_queue', 'other'),
  ]
}

/** Its list again once what is left to push here is known: only that line changes. */
export const withPushed = <A extends ChangeSummary>(change: A): A =>
  change.needs === undefined
    ? change
    : { ...change, needs: change.needs.map((one) => (one.kind === 'pushed' ? pushedNeedOf(change) : one)) }

/** Whether anything on the list holds a merge back now: unmet, or waiting on someone. Its merge queue is how it merges, not a hold. */
export const heldBack = (needs: ReadonlyArray<MergeNeed> | undefined): boolean =>
  (needs ?? []).some((one) => one.kind !== 'merge_queue' && (one.state === 'unmet' || one.state === 'waiting'))
