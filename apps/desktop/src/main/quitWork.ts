/*
 * What Quit would stop (DEV-118), as the runtime counts it (runtime/atWork.ts)
 * and the main process checks it: counts alone, from another process, so
 * anything that isn't a whole number is not an answer.
 */

export interface Work {
  /** Leads in a turn. */
  readonly leads: number
  /** Reviewers in a turn. */
  readonly reviews: number
  /** Project runs still going. */
  readonly runs: number
  /** What agents left running in the background, such as a dev server. */
  readonly left: number
}

const count = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0

/** The runtime's answer as work; null where it is anything else. */
export const workIn = (value: unknown): Work | null => {
  if (typeof value !== 'object' || value === null) return null
  const { leads, reviews, runs, left } = value as Record<string, unknown>
  return count(leads) && count(reviews) && count(runs) && count(left) ? { leads, reviews, runs, left } : null
}

/** Nothing would stop, so Quit has nothing to ask. */
export const idle = (work: Work): boolean => work.leads + work.reviews + work.runs + work.left === 0

/** What the person answers: quit and stop the work, keep it working with the windows closed, or carry on as they were. */
export type QuitAnswer = 'quit' | 'background' | 'cancel'

export const isQuitAnswer = (value: unknown): value is QuitAnswer => value === 'quit' || value === 'background' || value === 'cancel'

/** What the window asks the person: the work, whether keeping it working is on offer, and the update that waits, by version. */
export interface QuitQuestion {
  readonly work: Work
  readonly background: boolean
  readonly update: string | null
}
