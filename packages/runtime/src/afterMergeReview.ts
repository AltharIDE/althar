import type { AfterMergeRule } from '@althar/contracts'
import { Effect, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { afterMergeReviewOf, ProjectRules } from './Policies'

/*
 * What an explicitly configured review after merge brings back (docs/decisions/reviews.md, "An explicit review after merge"). The project's rule (`afterMergeReview`, set on its Tasks settings, new projects starting from the person's default)
 * says it: `major`, the reviewer reads what merged and only blocking and major findings put the task in Needs you, the rest
 * a quiet line in its thread; `all`, any finding does; `none`, no review is owed after the merge.
 *
 * One task may explicitly say otherwise (`task.after_merge_review_set`): `review`, it is reviewed after its merge where the
 * project's rule has none (bringing back what `major` does); `none`, it isn't, whatever the rule. Null goes back to the
 * project's. Both are read when the merge is heard (MergeReviews.merged), and what the review brings back is kept on it then.
 */

/** The person's explicit choice of review after merge. */
export const TaskAfterMerge = Schema.Literals(['review', 'none'])
export type TaskAfterMerge = typeof TaskAfterMerge.Type

/** The fact a task's own word is kept as, its payload `{ review: 'review' | 'none' | null }`. */
export const TASK_AFTER_MERGE_SET = 'task.after_merge_review_set'

const decodeSet = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Struct({ review: Schema.NullOr(TaskAfterMerge) })))
const decodeRules = Schema.decodeUnknownOption(Schema.fromJsonString(ProjectRules))

/** What the task says of its review after the merge, its latest word; null where it leaves it to its project. */
export const taskAfterMergeOf = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [set] = yield* sql<{ payload: string }>`
      SELECT payload FROM record_events WHERE aggregate_type = 'task' AND aggregate_id = ${taskId} AND type = ${TASK_AFTER_MERGE_SET}
      ORDER BY sequence DESC LIMIT 1`
    if (set === undefined) return null
    const read = decodeSet(set.payload)
    return read._tag === 'Some' ? read.value.review : null
  })

/** The project's rule now, from its latest revision: `major` where it has none, or says none. */
export const projectAfterMergeOf = (projectId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{ rules: string }>`
      SELECT rules FROM policies WHERE project_id = ${projectId} ORDER BY revision DESC LIMIT 1`
    const read = row === undefined ? undefined : decodeRules(row.rules)
    return read?._tag === 'Some' ? afterMergeReviewOf(read.value) : ('major' satisfies AfterMergeRule)
  })

/** What holds for one task: its own word over its project's rule; `review` over a rule of none brings back what `major` does. */
export const afterMergeFor = (project: AfterMergeRule, task: TaskAfterMerge | null): AfterMergeRule =>
  task === 'none' ? 'none' : task === 'review' && project === 'none' ? 'major' : project

/** What holds for the task now. */
export const afterMergeNow = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [task] = yield* sql<{ projectId: string }>`SELECT project_id AS projectId FROM tasks WHERE id = ${taskId}`
    const project = task === undefined ? 'major' : yield* projectAfterMergeOf(task.projectId)
    const own = yield* taskAfterMergeOf(taskId)
    return { project, task: own, holds: afterMergeFor(project, own) }
  })

/** What a review after a merge brings back to the person: under `all` any finding, else only a blocking or major one. */
export const bringsBack = (
  rule: Exclude<AfterMergeRule, 'none'>,
  findings: ReadonlyArray<{ readonly severity: 'blocking' | 'major' | 'minor' | 'nit' }>,
): boolean => (rule === 'all' ? findings.length > 0 : findings.some((one) => one.severity === 'blocking' || one.severity === 'major'))
