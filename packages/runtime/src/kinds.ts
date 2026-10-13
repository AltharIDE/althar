import type { Handed, ReviewBrief, TaskKind } from '@althar/contracts'

import { evidenceOf } from './evidence'
import { filesOf } from './handed'

/*
 * What a task makes, read from what it has and never stored (DEV-96, the
 * plan in docs/plans/task-as-container.md). A change ends in a pull request
 * of its own, or its branch pushed (its plan's end is draft, ready or none),
 * or has one, or has commits or changes on its branch. A review reads
 * someone else's pull request, with nothing of its own. Anything else is
 * plain: a question, a prototype, a release from this Mac. Since what a
 * task has only grows, a task only moves toward change: a plain task that
 * writes is one, and so is a review the person takes over.
 */

/** A field of something parsed from the store, if it is an object with one. */
const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Readonly<Record<string, unknown>>)[key] : undefined

/** What a task's kind is read from. */
export interface KindFacts {
  /** The pull request it reviews, if it reviews one. */
  readonly reviewing: ReviewBrief | null
  /** How its plan ends; null where nothing of it reaches a host, or it has no plan. */
  readonly end: string | null
  /** How many pull requests of its own it has, open, merged or closed. */
  readonly changes: number
  /** It has commits on its branch, or changes there not committed yet. */
  readonly made: boolean
}

/** Whether a plan's end makes a task a change by itself: a pull request, or its branch pushed. */
export const endsInChange = (end: string | null): boolean => end === 'draft' || end === 'ready' || end === 'none'

/** A task's kind, from what it has now. */
export const kindOf = (facts: KindFacts): TaskKind => {
  const own = facts.changes > 0 || facts.made
  if (facts.reviewing !== null && !own) return 'review'
  return own || endsInChange(facts.end) ? 'change' : 'plain'
}

/**
 * What a plain task handed back, for its card: the pictures its lead showed
 * as evidence when it last reported, kept ones only, and the files it wrote
 * or pointed at in what it said since its latest run began, each once, in
 * the order it named them. Neither is in git (a plain task has nothing
 * there), so no file says how many lines it added. Null with neither.
 */
export const handedOf = (report: unknown, messages: ReadonlyArray<unknown>): Handed | null => {
  const pictures = evidenceOf(field(report, 'evidence')).flatMap((piece) =>
    piece.picture !== null && piece.picture.digest !== null ? [piece.picture] : [],
  )
  const paths = [...new Set(messages.flatMap((message) => filesOf(field(message, 'files')).map((file) => file.path)))]
  if (pictures.length === 0 && paths.length === 0) return null
  return { pictures, files: paths.map((path) => ({ path, add: null })) }
}
