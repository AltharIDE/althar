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
  /** The host this pull request is on, and whether Althar is connected to it; null where that can't be told. */
  readonly host: Host | null
}

/** A code host, and whether Althar is connected to it. */
export interface Host {
  readonly name: string
  readonly connected: boolean
}

/** A repository merged into its default branch on this Mac, with no pull request. */
export interface MergedHere {
  readonly name: string
  readonly branch: string
  readonly remote: string | null
  readonly ahead: number
}

/** A task's pull requests, and the repositories with work that is in neither a pull request nor merged. */
export interface PullRequestFacts {
  readonly changes: ReadonlyArray<SeenChange>
  readonly merged: ReadonlyArray<MergedHere>
  /** How many repositories hold work of the task that is neither merged nor in a pull request: the task isn't done while any does. */
  readonly unmerged: number
  /**
   * How many commits are on its branches after their last pull request merged
   * or closed, in none yet (ADR-034): the person opens a new pull request for
   * them, and the task isn't done while there are any.
   */
  readonly unshipped?: number
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

/**
 * Why a pull request's state may not be today's: its host isn't connected or
 * isn't known, nothing asks it for news, or it was closed, which stops that
 * (it can be reopened). A merged one doesn't change again.
 */
const staleWords = (seen: SeenChange) => {
  const { change, host } = seen
  if (change.state === 'merged') return null
  if (host === null) return 'its host is not known'
  if (!host.connected) return `${host.name} is not connected`
  // Althar stops asking after it sees a pull request closed, connected or not: a reopened one wouldn't show.
  if (change.state === 'closed') return 'not watched since it closed'
  if (!change.listening) return 'not being watched'
  return null
}

/** One pull request in a few words: `PR #113 draft, checks passing, 2 unpushed`. */
export const changeWords = (seen: SeenChange, several: boolean): string => {
  const { change } = seen
  const stale = staleWords(seen)
  const parts = [
    change.state === 'open' ? (change.draft ? 'draft' : 'ready for review') : change.state,
    checksWords(change),
    change.state === 'open' && change.unpushed > 0 ? `${change.unpushed} unpushed` : null,
    change.state === 'open' && change.diverged !== null ? `diverged from ${change.short}` : null,
    stale === null ? null : `as last seen (${stale})`,
  ].filter((part): part is string => part !== null)
  const where = several ? whereOf(change) : null
  return `${where === null ? '' : `${where}: `}${labelOf(change)} ${parts.join(', ')}`
}

const mergedWords = (merged: MergedHere, several: boolean) =>
  `${several ? `${merged.name}: ` : ''}merged locally into ${merged.branch}, no pull request${
    merged.remote !== null && merged.ahead > 0 ? `; ${plural(merged.ahead, 'commit')} not on ${merged.remote} yet` : ''
  }`

const unmergedWords = (n: number) => `${n === 1 ? '1 repository' : `${n} repositories`} with work not merged or in a pull request yet`

/** The repository a pull request is in, by its folder here where known. */
const repositoryOf = (change: ChangeSummary) => change.slug ?? change.repository

const unshippedWords = (n: number) => `${plural(n, 'commit')} after its last pull request, in none yet`

/**
 * A task's pull requests in the order they're told: in each repository its
 * latest (the open one, else the newest) first, then those of its earlier
 * rounds of work, newest first (ADR-034).
 */
const inOrder = (changes: ReadonlyArray<SeenChange>) => {
  const byRepository = new Map<string, Array<SeenChange>>()
  for (const seen of changes) {
    const where = repositoryOf(seen.change)
    byRepository.set(where, [...(byRepository.get(where) ?? []), seen])
  }
  return [...byRepository.values()].flatMap((all) => {
    const latest = all.find((seen) => seen.change.state === 'open') ?? all.at(-1)
    return [
      ...(latest === undefined ? [] : [{ seen: latest, earlier: false }]),
      ...all
        .filter((seen) => seen !== latest)
        .toReversed()
        .map((seen) => ({ seen, earlier: true })),
    ]
  })
}

/** Everything a task's pull requests come to, for its line in the list; empty for a task with none. */
export const listWords = (facts: PullRequestFacts): string => {
  const several = new Set(facts.changes.map(({ change }) => repositoryOf(change))).size + facts.merged.length > 1
  const words = [
    ...inOrder(facts.changes).map(({ seen, earlier }) => `${earlier ? 'earlier ' : ''}${changeWords(seen, several)}`),
    ...facts.merged.map((merged) => mergedWords(merged, several)),
  ]
  if (words.length === 0) return ''
  return [
    ...words,
    ...(facts.unmerged > 0 ? [unmergedWords(facts.unmerged)] : []),
    ...((facts.unshipped ?? 0) > 0 ? [unshippedWords(facts.unshipped ?? 0)] : []),
  ].join('; ')
}

/**
 * How a task whose pull requests have all been merged or closed ends, so
 * `ready` doesn't suggest it still waits on the person; none while any is
 * open, while a repository's work is in none, when it has none, or when any
 * is closed, which may have been reopened since without Althar seeing it.
 */
export const finishedBy = (facts: PullRequestFacts): 'merged' | null => {
  if (facts.unmerged > 0 || (facts.unshipped ?? 0) > 0) return null
  const states = [...facts.changes.map(({ change }) => change.state), ...facts.merged.map(() => 'merged' as const)]
  if (states.length === 0 || states.includes('open')) return null
  // A closed one may have been reopened, and nothing watches it any more: not finished.
  if (facts.changes.some(({ change }) => change.state === 'closed')) return null
  return 'merged'
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

/** How the task's branch parted from its pull request, so no plain push would be taken: rewritten here, or moved on there. */
const divergedWords = (change: ChangeSummary): string | null => {
  if (change.diverged === null) return null
  if (change.diverged.kind === 'rewritten')
    return `The task's branch was rewritten since it was pushed: ${plural(change.diverged.local, 'commit')} in place of ${plural(Number(change.diverged.onPullRequest), 'commit')} on the ${change.noun}, so it takes no plain push. The person replaces its commits from the task's outputs, or has the lead merge instead.`
  return `The ${change.noun} has commits pushed from elsewhere that the task's branch doesn't, so it takes no plain push. The person has the lead merge them in, from the task's outputs.`
}

const changeSection = (seen: SeenChange, several: boolean): string => {
  const { change } = seen
  const stale = staleWords(seen)
  const when = seen.seenAt === null ? '' : `; last updated ${seen.seenAt}`
  return [
    `${changeWords(seen, several)}${change.title === '' ? '' : `: ${change.title}`}`,
    change.url === '' ? null : `URL: ${change.url}`,
    change.state === 'merged' ? `Merged${when}.` : null,
    change.state === 'closed'
      ? `Closed without merging${when}. Althar stopped watching it then, so it may have been reopened since.`
      : null,
    checkSection(change),
    change.state === 'open' && change.unpushed > 0
      ? `${plural(change.unpushed, 'commit')} on the task's branch ${change.unpushed === 1 ? 'is' : 'are'} not on the ${change.noun} yet; the person pushes them.`
      : null,
    change.state === 'open' ? divergedWords(change) : null,
    // The host snapshot doesn't carry whether it merges cleanly: Althar finds out only when it merges the task here.
    change.state === 'open' ? 'Conflicts with the base: not known (Althar does not ask the host).' : null,
    stale === null ? null : `Possibly out of date: ${stale}, so this is as last seen.`,
  ]
    .filter((line): line is string => line !== null)
    .join('\n')
}

/** The "Pull request" section of a task, for reading it; empty for a task with none. */
export const sectionWords = (facts: PullRequestFacts): string => {
  const repositories = new Set(facts.changes.map(({ change }) => repositoryOf(change))).size + facts.merged.length
  const several = repositories > 1
  const sections = [
    ...inOrder(facts.changes).map(({ seen, earlier }) => `${earlier ? 'Earlier: ' : ''}${changeSection(seen, several)}`),
    ...facts.merged.map((merged) => mergedWords(merged, several)),
  ]
  if (sections.length === 0) return ''
  const finished = finishedBy(facts)
  const unshipped = facts.unshipped ?? 0
  return [
    `Pull request${sections.length > 1 ? 's' : ''}${facts.changes.length > repositories ? ', the latest first' : ''}:\n${sections.join('\n\n')}`,
    facts.unmerged > 0 ? `${unmergedWords(facts.unmerged)}: the task is not done.` : null,
    unshipped > 0
      ? `${plural(unshipped, 'commit')} on the task's branch ${unshipped === 1 ? 'is' : 'are'} after its last pull request, which merged or closed, and in none yet: the person opens a new pull request for ${unshipped === 1 ? 'it' : 'them'} from the task.`
      : null,
    finished === null ? null : `The task is finished (${finished}): nothing waits on the person.`,
  ]
    .filter((part): part is string => part !== null)
    .join('\n\n')
}
