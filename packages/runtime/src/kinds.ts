import type { Handed, ReviewBrief, TaskKind } from '@althar/contracts'

import { evidenceOf } from './evidence'
import { filesOf } from './handed'

/*
 * What a task makes, read from what it has and never stored (DEV-96, the
 * plan in docs/plans/task-as-container.md). Whether a task ends in a pull
 * request is the person's intent, never a side effect of the files its lead
 * writes (14 October). A plain task is a quick task: one the coordinator
 * started at once with start_task, whose plan says it stays on this Mac
 * (`PlanParameters.here`) and ends in nothing, with no pull request of its
 * own, whatever it wrote or committed and whether or not it has a branch. It
 * stays plain until the person asks its lead to make it a change
 * (make_it_a_change), which gives its plan a review and an ending. A review
 * reads someone else's pull request, with nothing of its own. A change is
 * everything else: every planned task, a quick task made one, and any task
 * with a pull request; a task with no `here` is never a quick one, as a quick
 * task started before Althar wrote it was a change once it had a branch.
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
  /** It has commits on its branch, or changes there not committed yet: what makes a review the person took over a change. */
  readonly made: boolean
  /** Its plan says it stays on this Mac (`here`): a task the coordinator started at once, not made a change since. */
  readonly quick: boolean
}

/** Whether a plan's end makes a task a change by itself: a pull request, or its branch pushed. */
export const endsInChange = (end: string | null): boolean => end === 'draft' || end === 'ready' || end === 'none'

/** A task's kind, from what it has now. A quick task stays plain whatever it writes; a review is a change once it has work of its own. */
export const kindOf = (facts: KindFacts): TaskKind => {
  if (facts.reviewing !== null && facts.changes === 0 && !facts.made) return 'review'
  return facts.quick && facts.changes === 0 && !endsInChange(facts.end) ? 'plain' : 'change'
}

/**
 * Whether the task `task` (a table alias) is a review whose review was
 * posted, with nothing drafted since that waits on the person or is being
 * posted, as SQL: written to again, its lead answered, it is finished as a
 * quick task is, the person's to settle (ADR-051).
 */
export const answeredIn = (task: string) =>
  `(EXISTS (SELECT 1 FROM review_drafts ad WHERE ad.task_id = ${task}.id AND ad.state = 'posted')
    AND NOT EXISTS (SELECT 1 FROM review_drafts ad WHERE ad.task_id = ${task}.id AND ad.state IN ('pending', 'posting', 'failed', 'uncertain')))`

/**
 * Whether the task `task` (a table alias) is a quick task still, as SQL:
 * its latest plan says it stays on this Mac and ends in nothing, and it has
 * no pull request of its own. What makes it plain, as `kindOf` reads it.
 */
export const quickIn = (task: string) =>
  `(coalesce((SELECT json_extract(qp.parameters, '$.here') = 1
      AND coalesce(json_extract(qp.parameters, '$.end'), '') NOT IN ('draft', 'ready', 'none')
    FROM task_plans qp WHERE qp.task_id = ${task}.id AND qp.state IN ('proposed', 'accepted') ORDER BY qp.proposed_at DESC LIMIT 1), 0) = 1
    AND NOT EXISTS (SELECT 1 FROM external_links ql WHERE ql.task_id = ${task}.id AND ql.kind = 'change'))`

/**
 * How many issues its lead drafted wait on the person for the task `task` (a
 * table alias), as SQL: drafted and not filed or discarded, or not filed the
 * last time. Each is a call on the person, as an open one is
 * (`attention_requests`), though no row of that table stands for it.
 */
export const issueDraftsWaiting = (task: string) =>
  `(SELECT count(*) FROM issue_drafts wd JOIN threads wt ON wt.id = wd.thread_id
    WHERE wt.task_id = ${task}.id AND wd.state IN ('pending', 'failed', 'uncertain'))`

/**
 * What a plain task handed back, for its card: the pictures its lead showed
 * as evidence when it last reported, kept ones only, and the files it wrote
 * or pointed at in what it said since its latest run began, each once, in
 * the order it named them. Neither is read from git, so no file says how
 * many lines it added. Null with neither.
 */
export const handedOf = (report: unknown, messages: ReadonlyArray<unknown>): Handed | null => {
  const pictures = evidenceOf(field(report, 'evidence')).flatMap((piece) =>
    piece.picture !== null && piece.picture.digest !== null ? [piece.picture] : [],
  )
  const paths = [...new Set(messages.flatMap((message) => filesOf(field(message, 'files')).map((file) => file.path)))]
  if (pictures.length === 0 && paths.length === 0) return null
  return { pictures, files: paths.map((path) => ({ path, add: null })) }
}
