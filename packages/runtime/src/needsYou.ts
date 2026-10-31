import type { ChangeSummary } from '@althar/contracts'

/*
 * A card is in Needs you only where the person has a decision to make, never
 * for a moment while Althar or the lead is on its way to the next thing
 * (DEV-173). These say when a task that would wait on the person goes on by
 * itself instead, so its card stays under way: a ready change whose commits
 * go up on their own, or whose checks still run with nothing in their way;
 * and a task no agent is on, with nothing that says why, for a moment after
 * its last agent went, as the next one is on its way.
 */

/** What a ready change's open pull request is doing by itself, where it is: its commits going up, then its checks running. */
export type ByItself = 'pushing' | 'checks_running'

/**
 * What the open pull request goes on to by itself, before anything is the
 * person's, as the desktop's standing reads it (shared/standing.ts): null
 * where the first thing in its way is theirs, or nothing is. Commits Althar
 * pushes on its own, unheld (ADR-072), are on their way, whatever is behind
 * them; checks running are, only with no parted branch, commits of the
 * person's, conflict or failure before them.
 */
export const byItself = (change: ChangeSummary | null): ByItself | null => {
  if (change === null || change.state !== 'open' || change.diverged !== null) return null
  const unpushed = change.localHead !== null && change.unpushed > 0
  if (unpushed) return change.pushing !== undefined && change.pushing.held === null ? 'pushing' : null
  const checks = change.checks
  if (change.conflicts === true || checks === null || checks.failed > 0) return null
  // Run again by Althar (a cancelled check), they are running before its host shows them so.
  return checks.running > 0 || checks.outcome === 'running' ? 'checks_running' : null
}

/** How long a task no agent is on, with nothing that says why, is taken to be between agents rather than stopped. */
export const BETWEEN_AGENTS_MS = 30_000

/** Whether a task its last agent left at `since`, with nothing that says why, is still between agents at `now`, for `within` ms. */
export const betweenAgents = (since: string | null, now: number, within: number = BETWEEN_AGENTS_MS): boolean =>
  since !== null && now - Date.parse(since) < within
