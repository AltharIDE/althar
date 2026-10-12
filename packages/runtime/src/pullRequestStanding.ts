import type { ChangeSummary } from '@althar/contracts'

/*
 * What the coordinator is told of a task's pull requests: the facts the
 * task's card is built from (Queries.pullRequestsOf), in a few words for the
 * list and a short section for reading one task. Nothing here asks a host:
 * what Althar last saw is said as last seen, and what it can't tell is said
 * so, not guessed.
 */

/** A pull request as last seen, and when its link was last updated. */
export interface SeenChange {
  readonly change: ChangeSummary
  readonly seenAt: string | null
}

/** A repository merged into its default branch on this Mac, with no pull request. */
export interface MergedHere {
  readonly name: string
  readonly branch: string
  readonly remote: string | null
  readonly ahead: number
}

/** A task's pull requests, and where its repositories are hosted. */
export interface PullRequestFacts {
  readonly changes: ReadonlyArray<SeenChange>
  readonly merged: ReadonlyArray<MergedHere>
  /** The project's host, and whether Althar is connected to it; null where its remotes name none it knows. */
  readonly host: { readonly name: string; readonly connected: boolean } | null
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

const labelOf = (change: ChangeSummary) => `${change.short} ${change.prefix}${change.number}`

/** Which repository a pull request is in, said only where the task has several. */
const whereOf = (change: ChangeSummary) => (change.slug ?? change.repository) || null

const checksWords = (change: ChangeSummary) => {
  const checks = change.checks
  if (change.state !== 'open' || checks === null || checks.outcome === 'none') return null
  if (checks.outcome === 'passed') return 'checks passing'
  if (checks.outcome === 'running') return 'checks pending'
  return 'checks failing'
}

/** Why an open pull request's state may not be today's: its host isn't connected, or nothing is asking it for news. */
const staleWords = (change: ChangeSummary, host: PullRequestFacts['host']) => {
  if (change.state !== 'open') return null
  if (host !== null && !host.connected) return `${host.name} is not connected`
  if (!change.listening) return 'not being watched'
  return null
}

/** One pull request in a few words: `PR #113 draft, checks passing, 2 unpushed`. */
export const changeWords = (change: ChangeSummary, host: PullRequestFacts['host'], several: boolean): string => {
  const stale = staleWords(change, host)
  const parts = [
    change.state === 'open' ? (change.draft ? 'draft' : 'ready for review') : change.state,
    checksWords(change),
    change.state === 'open' && change.unpushed > 0 ? `${change.unpushed} unpushed` : null,
    stale === null ? null : `as last seen (${stale})`,
  ].filter((part): part is string => part !== null)
  const where = several ? whereOf(change) : null
  return `${where === null ? '' : `${where}: `}${labelOf(change)} ${parts.join(', ')}`
}

const mergedWords = (merged: MergedHere, several: boolean) =>
  `${several ? `${merged.name}: ` : ''}merged locally into ${merged.branch}, no pull request${
    merged.remote !== null && merged.ahead > 0 ? `; ${plural(merged.ahead, 'commit')} not on ${merged.remote} yet` : ''
  }`

/** Everything a task's pull requests come to, for its line in the list; empty for a task with none. */
export const listWords = (facts: PullRequestFacts): string => {
  const several = facts.changes.length + facts.merged.length > 1
  return [
    ...facts.changes.map(({ change }) => changeWords(change, facts.host, several)),
    ...facts.merged.map((merged) => mergedWords(merged, several)),
  ].join('; ')
}

/**
 * How a task whose pull requests have all been merged or closed ends, so
 * `ready` doesn't suggest it still waits on the person; none while any is
 * open, or when it has none.
 */
export const finishedBy = (facts: PullRequestFacts): 'merged' | 'closed' | null => {
  const states = [...facts.changes.map(({ change }) => change.state), ...facts.merged.map(() => 'merged' as const)]
  if (states.length === 0 || states.includes('open')) return null
  return states.includes('merged') ? 'merged' : 'closed'
}

const checkSection = (change: ChangeSummary): string | null => {
  const checks = change.checks
  if (change.state !== 'open') return null
  if (checks === null) return 'Checks: not fetched yet.'
  if (checks.outcome === 'none' || checks.total === 0) return 'Checks: none reported.'
  if (checks.outcome === 'failed') {
    const names = checks.failing.length > 0 ? checks.failing : checks.list.filter((one) => one.state === 'failed').map((one) => one.name)
    return `Checks: failing${names.length > 0 ? ` (${names.join(', ')})` : ''}; ${checks.passed} of ${checks.total} passed${
      checks.running > 0 ? `, ${checks.running} pending` : ''
    }.`
  }
  if (checks.outcome === 'running') return `Checks: pending (${checks.running} of ${checks.total} still running; ${checks.passed} passed).`
  return `Checks: passing (${checks.passed} of ${checks.total}).`
}

const changeSection = (seen: SeenChange, host: PullRequestFacts['host'], several: boolean): string => {
  const { change } = seen
  const stale = staleWords(change, host)
  return [
    `${changeWords(change, host, several)}${change.title === '' ? '' : `: ${change.title}`}`,
    change.url === '' ? null : `URL: ${change.url}`,
    change.state === 'open'
      ? null
      : `${change.state === 'merged' ? 'Merged' : 'Closed without merging'}${seen.seenAt === null ? '' : `; last updated ${seen.seenAt}`}. The task is finished on the host: nothing waits on the person.`,
    checkSection(change),
    change.state === 'open' && change.unpushed > 0
      ? `${plural(change.unpushed, 'commit')} on the task's branch ${change.unpushed === 1 ? 'is' : 'are'} not on the ${change.noun} yet; the person pushes them.`
      : null,
    // The host snapshot doesn't carry whether it merges cleanly: Althar finds out only when it merges the task here.
    change.state === 'open' ? 'Conflicts with the base: not known (Althar does not ask the host).' : null,
    stale === null ? null : `Possibly out of date: ${stale}, so this is as last seen.`,
  ]
    .filter((line): line is string => line !== null)
    .join('\n')
}

/** The "Pull request" section of a task, for reading it; empty for a task with none. */
export const sectionWords = (facts: PullRequestFacts): string => {
  const several = facts.changes.length + facts.merged.length > 1
  const sections = [
    ...facts.changes.map((seen) => changeSection(seen, facts.host, several)),
    ...facts.merged.map((merged) => mergedWords(merged, several)),
  ]
  return sections.length === 0 ? '' : `Pull request${several ? 's' : ''}:\n${sections.join('\n\n')}`
}
