import { useQueries } from '@tanstack/react-query'

import type { TaskFinding, ThreadItem } from '@althar/contracts'

import { useServices } from '../../data/services'

/*
 * What became of each review's findings, for its line in the task's thread
 * ("2 fixed, 1 declined"): read from what the reviews found, as the Changes
 * view reads them, one review at a time, and again each time a step reports,
 * as settling a review changes them.
 */

export const outcomeText = {
  fixed: (n: number) => `${n} fixed`,
  declined: (n: number) => `${n} declined`,
  open: (n: number) => `${n} open`,
}

/** A review's findings, settled, in words: none until the lead has settled one, then what became of each, and what is left open. */
export const outcomeOf = (findings: ReadonlyArray<Pick<TaskFinding, 'state'>>): string | undefined => {
  const count = (state: TaskFinding['state']) => findings.filter((finding) => finding.state === state).length
  const fixed = count('fixed')
  const declined = count('set_aside')
  const open = count('open')
  if (fixed + declined === 0) return undefined
  return [
    ...(fixed > 0 ? [outcomeText.fixed(fixed)] : []),
    ...(declined > 0 ? [outcomeText.declined(declined)] : []),
    ...(open > 0 ? [outcomeText.open(open)] : []),
  ].join(', ')
}

/** The reviews in a task's thread that found something, by their report: whose findings may have been settled. */
export const reviewsIn = (items: ReadonlyArray<ThreadItem>): ReadonlyArray<string> =>
  items.flatMap((item) =>
    item.kind === 'step_result' && item.content.step === 'review' && item.content.findings.length > 0 ? [item.id] : [],
  )

/** What the latest report in a task's thread is: what became of its reviews' findings is read again when it changes. */
export const latestReport = (items: ReadonlyArray<ThreadItem>): string => items.findLast((item) => item.kind === 'step_result')?.id ?? ''

/**
 * What became of each review's findings, in words, by its report. `moved`
 * is what the latest report says: read again when it changes.
 */
export const useReviewOutcomes = (
  taskId: string,
  reviews: ReadonlyArray<string>,
  moved: string,
): ((review: string) => string | undefined) => {
  const { client } = useServices()
  const read = useQueries({
    queries: reviews.map((review) => ({
      queryKey: ['review-outcome', taskId, review, moved],
      queryFn: async () => {
        const found = await client.getTaskFindings(taskId, review)
        return outcomeOf(found.findings.filter((finding) => finding.review === found.review))
      },
      // What it said last stands while it is read again.
      placeholderData: (before: string | undefined) => before,
      staleTime: Number.POSITIVE_INFINITY,
    })),
  })
  const words = new Map(reviews.map((review, at) => [review, read[at]?.data]))
  return (review: string) => words.get(review)
}
