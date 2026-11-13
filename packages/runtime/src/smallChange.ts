import type { AfterMergeRule } from '@althar/contracts'

import type { PlanStep } from './Runs'

/*
 * The fast lane: a change of a few lines takes one step, on a lighter model,
 * starts without the plan's countdown, and keeps its configured review
 * before Ship unless the person explicitly chose another timing (README section 6, the person's note of 6 November: a
 * one-line fix took about 40 minutes).
 *
 * A small change is what its plan says: `smallChange`, independently of its
 * reviewer. Older explicit after-merge plans are still recognized. The card the thread shows
 * is read from the task as it stands, so it never goes stale: its steps are
 * the plan's start, the lead's report, the pull request's checks and merge,
 * and the review task its merge starts.
 */

/** Whether a plan parameters JSON says its task is a small change. */
export const smallChangeOf = (parameters: string | null | undefined) => {
  if (parameters === null || parameters === undefined) return undefined
  let read: unknown
  try {
    read = JSON.parse(parameters)
  } catch {
    return undefined
  }
  if (typeof read !== 'object' || read === null) return undefined
  const kept = read as { readonly smallChange?: unknown; readonly reviewAfterMerge?: unknown; readonly steps?: unknown }
  // Older explicit after-merge configurations retain their card. New size labels carry no timing decision.
  if ((kept.smallChange !== true && !(kept.smallChange === undefined && kept.reviewAfterMerge === true)) || !Array.isArray(kept.steps))
    return undefined
  const steps = kept.steps.filter(
    (step): step is PlanStep =>
      typeof step === 'object' && step !== null && 'key' in step && (step.key === 'implement' || step.key === 'review'),
  )
  const implement = steps.find((step) => step.key === 'implement' && step.skipped !== true)
  if (implement === undefined) return undefined
  const review = steps.find((step) => step.key === 'review')
  return { implement, review: review ?? null, afterMerge: kept.reviewAfterMerge === true }
}

/**
 * A small change keeps its configured reviewer before Ship. Size changes neither the reviewer nor when it reads.
 */
export const smallChangeSteps = (input: {
  readonly lead: Omit<PlanStep, 'key' | 'skipped'>
  readonly review: Omit<PlanStep, 'key' | 'skipped'> | null
}): ReadonlyArray<PlanStep> => [
  { key: 'implement', ...input.lead, skipped: false },
  ...(input.review === null ? [] : [{ key: 'review' as const, ...input.review, skipped: false }]),
]

/**
 * Its card's short lines: no countdown and its configured review timing. An explicitly chosen after-merge review keeps
 * the project's rule and the task's own override.
 */
export const smallChangeSkips = (
  review: PlanStep | null,
  holds: AfterMergeRule = 'major',
  afterMerge = review?.skipped === true,
): ReadonlyArray<string> => [
  afterMerge ? 'no plan' : 'no countdown',
  ...(review === null
    ? []
    : [
        afterMerge
          ? holds === 'none'
            ? 'no review'
            : holds === 'all'
              ? 'reviewed after it merges'
              : 'reviewed after it merges, major findings only'
          : review.skipped
            ? 'no review'
            : 'reviewed before it ships',
      ]),
]

/**
 * What a change is, in a line, from its size: one file and one line reads
 * "1 line in RunMenu.tsx", several files "3 files", and a size the lead
 * didn't give is left to the pull request's numbers.
 */
export const changedWords = (input: {
  readonly files: ReadonlyArray<{ readonly path: string; readonly add: number; readonly del: number }>
  readonly additions: number | null
  readonly deletions: number | null
  readonly changedFiles: number | null
}): string => {
  const [file] = input.files
  const lines = input.additions === null ? null : input.additions + (input.deletions ?? 0)
  const one = (count: number, what: string) => `${count} ${what}${count === 1 ? '' : 's'}`
  if (input.files.length === 1 && file !== undefined) return `${lines === null ? 'A file' : one(lines, 'line')} in ${file.path}`
  const count = input.files.length > 1 ? input.files.length : input.changedFiles
  if (count !== null && count > 1) return one(count, 'file')
  if (lines !== null && lines > 0) return one(lines, 'line')
  return 'the code'
}

/** The actual outcome of a before-Ship pass, without treating a skipped or stopped pass as a completed review. */
export const beforeShipReviewStep = (
  review:
    | { readonly state: string; readonly endedAt: string | null; readonly verdict: string | null; readonly skipped: number | null }
    | undefined,
) => {
  const done = review?.state === 'succeeded' && review.verdict !== null
  const what = done
    ? 'Reviewed before Ship'
    : review === undefined
      ? 'Review before Ship'
      : review.state === 'admitted' || review.state === 'running'
        ? 'Reviewing before Ship'
        : review.state === 'held'
          ? 'Review waiting'
          : review.state === 'waiting_attention'
            ? 'Review needs attention'
            : review.state === 'failed'
              ? 'Review failed'
              : review.state === 'cancelled' && review.skipped === 1
                ? 'Review skipped'
                : review.state === 'succeeded'
                  ? 'Review ended'
                  : 'Review stopped'
  return { key: 'review' as const, what, at: review?.endedAt ?? null, done }
}
