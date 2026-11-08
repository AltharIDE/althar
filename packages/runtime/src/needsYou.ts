import type { ChangeSummary } from '@althar/contracts'

import { heldBack } from './mergeNeeds'

/*
 * A card is in Needs you only where the person has a decision to make, never
 * for a moment while Althar or the lead is on its way to the next thing
 * (DEV-173). These say when a task that would wait on the person goes on by
 * itself instead, so its card stays under way: a ready change whose commits
 * go up on their own, or whose checks still run with nothing in their way;
 * and a task no agent is on, with nothing that says why, for a moment after
 * its last agent went, as the next one is on its way; and a task just drafted,
 * before its plan is proposed, off the board until the plan comes.
 */

/** What a ready change's open pull request is doing by itself, where it is: its commits going up, then its checks running. */
export type ByItself = 'pushing' | 'checks_running'

/**
 * What the open pull request goes on to by itself, before anything is the
 * person's, as the desktop's standing reads it (shared/standing.ts): null
 * where the first thing in its way is theirs, or nothing is. Commits Althar
 * pushes on its own, unheld (ADR-072), are on their way, whatever is behind
 * them; checks running are, only with no parted branch, commits of the
 * person's, conflict or failure before them. Where failures go to the lead
 * once the checks end (`failuresGo`), some failed while the rest still run
 * are on their way too: nothing is the person's yet.
 */
export const byItself = (change: ChangeSummary | null, how: { readonly failuresGo?: boolean } = {}): ByItself | null => {
  if (change === null || change.state !== 'open' || change.diverged !== null) return null
  const unpushed = change.localHead !== null && change.unpushed > 0
  if (unpushed) return change.pushing !== undefined && change.pushing.held === null ? 'pushing' : null
  const checks = change.checks
  if (change.conflicts === true || checks === null || (checks.failed > 0 && how.failuresGo !== true)) return null
  // Run again by Althar (a cancelled check), they are running before its host shows them so.
  return checks.running > 0 || checks.outcome === 'running' ? 'checks_running' : null
}

/**
 * Whether an open pull request can be merged as it stands: not a draft, nothing of the lead's still to push, no conflict,
 * checks that all passed, and nothing its host requires still missing or waited on, as far as it says (DEV-204). A stopped
 * task with one is no less the person's to merge: stopped never hides the way to it.
 */
export const isMergeable = (change: ChangeSummary | null): boolean => {
  if (change === null || change.state !== 'open' || change.draft || change.queued === true) return false
  if (change.diverged !== null || change.conflicts === true || (change.localHead !== null && change.unpushed > 0)) return false
  const checks = change.checks
  return checks !== null && checks.outcome === 'passed' && checks.failed === 0 && checks.running === 0 && !heldBack(change.needs)
}

/** How long a task no agent is on, with nothing that says why, is taken to be between agents rather than stopped. */
export const BETWEEN_AGENTS_MS = 30_000

/** Whether a task its last agent left at `since`, with nothing that says why, is still between agents at `now`, for `within` ms. */
export const betweenAgents = (since: string | null, now: number, within: number = BETWEEN_AGENTS_MS): boolean =>
  since !== null && now - Date.parse(since) < within

/**
 * How long a task drafted with no plan stays off the board when no turn covers it: its plan is on its way if it was
 * just made. The turn that made it is the better sign (its plan comes in that turn, or it is the person's when it
 * ends); this is the fallback, for a draft made outside a turn, or a turn that never ended.
 */
export const DRAFTING_MS = 5 * 60_000

/** Whether a task made at `createdAt` is still within `within` ms of being drafted, at `now`. */
export const stillDrafting = (createdAt: string | null, now: number, within: number = DRAFTING_MS): boolean =>
  createdAt !== null && now - Date.parse(createdAt) < within
