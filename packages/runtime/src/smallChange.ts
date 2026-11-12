import type { AfterMergeRule } from '@althar/contracts'

import type { PlanStep } from './Runs'

/*
 * The fast lane: a change of a few lines takes one step, on a lighter model,
 * starts without the plan's countdown, and is reviewed after it merges
 * instead of before (README section 6, the person's note of 6 November: a
 * one-line fix took about 40 minutes).
 *
 * A small change is what its plan says: `reviewAfterMerge`, one step to
 * implement, and a review step that names who reviews it once it merged,
 * skipped so nothing waits on it before the merge. The card the thread shows
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
  const kept = read as { readonly reviewAfterMerge?: unknown; readonly steps?: unknown }
  if (kept.reviewAfterMerge !== true || !Array.isArray(kept.steps)) return undefined
  const steps = kept.steps.filter(
    (step): step is PlanStep =>
      typeof step === 'object' && step !== null && 'key' in step && (step.key === 'implement' || step.key === 'review'),
  )
  const implement = steps.find((step) => step.key === 'implement' && step.skipped !== true)
  if (implement === undefined) return undefined
  const review = steps.find((step) => step.key === 'review')
  return { implement, review: review ?? null }
}

/**
 * The steps a small change's plan holds: one to implement it, on the model
 * and effort the coordinator picked, and the reviewer its merge starts, which
 * it names and skips (nothing waits on it first).
 */
export const smallChangeSteps = (input: {
  readonly lead: Omit<PlanStep, 'key' | 'skipped'>
  readonly review: Omit<PlanStep, 'key' | 'skipped'> | null
}): ReadonlyArray<PlanStep> => [
  { key: 'implement', ...input.lead, skipped: false },
  ...(input.review === null ? [] : [{ key: 'review' as const, ...input.review, skipped: true }]),
]

/**
 * What a small change leaves out, in the short lines its card says: no plan to read, and the review after the merge, as what
 * holds of its project's rule and its own word says it (afterMergeReview.ts): only major findings back, any, or no review.
 */
export const smallChangeSkips = (review: PlanStep | null, holds: AfterMergeRule = 'major'): ReadonlyArray<string> => [
  'no plan',
  ...(review === null
    ? []
    : [holds === 'none' ? 'no review' : holds === 'all' ? 'reviewed after it merges' : 'reviewed after it merges, major findings only']),
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
