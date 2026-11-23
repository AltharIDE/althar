import { assert, describe, it } from '@effect/vitest'
import { Ids, newId } from '@althar/domain'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { taskWaitStatus } from '../src/errandTaskWaits'
import { timestamp } from '../src/records'
import { runtime, task } from './support'

describe('task results an errand waits for', () => {
  it.live('keeps work pending until it has a result, and reports a task that is missing or closed without one', () =>
    Effect.gen(function* () {
      const { project, task: created } = yield* task('Retry checkout')
      const { projectId } = project
      const { taskId } = created
      assert.deepStrictEqual(yield* taskWaitStatus(projectId, [{ kind: 'release_approval', target: 'elsewhere' }]), {
        state: 'ready',
      })
      const waitingForLead = [{ kind: 'lead_done', target: taskId }]
      const waitingForReview = [{ kind: 'review_settled', target: 'retry-checkout' }]
      const waitingForChecks = [{ kind: 'checks_passed', target: taskId }]
      for (const waits of [waitingForLead, waitingForReview, waitingForChecks]) {
        assert.deepStrictEqual(yield* taskWaitStatus(projectId, waits), { state: 'waiting' })
      }
      assert.deepStrictEqual(yield* taskWaitStatus(projectId, [{ kind: 'checks_passed', target: 'unregistered-task' }]), {
        state: 'unreachable',
        reason: 'There is no task “unregistered-task” in this project.',
      })

      const sql = yield* SqlClient.SqlClient
      yield* sql`UPDATE tasks SET state = 'abandoned' WHERE id = ${taskId}`
      assert.deepStrictEqual(yield* taskWaitStatus(projectId, waitingForLead), {
        state: 'unreachable',
        reason: 'Task “retry-checkout” was discarded without a record of a finished lead step.',
      })
      yield* sql`UPDATE tasks SET state = 'done' WHERE id = ${taskId}`
      assert.deepStrictEqual(yield* taskWaitStatus(projectId, waitingForReview), {
        state: 'unreachable',
        reason: 'Task “retry-checkout” was settled without a record of a settled review.',
      })
      assert.deepStrictEqual(yield* taskWaitStatus(projectId, waitingForChecks), {
        state: 'unreachable',
        reason: 'Task “retry-checkout” was settled without a record of passing checks.',
      })
    }).pipe(Effect.provide(runtime())),
  )

  it.live('accepts checks for the current pull request head and can read the recorded result after a merge', () =>
    Effect.gen(function* () {
      const { project, task: created } = yield* task('Retry checkout')
      const { projectId } = project
      const { taskId } = created
      const sql = yield* SqlClient.SqlClient
      const id = yield* newId(Ids.externalLink)
      const at = yield* timestamp
      const headSha = 'a'.repeat(40)
      const oldHead = 'b'.repeat(40)
      const draw = (state: string, sha: string | null) =>
        JSON.stringify({ state, repository: ['meridian', 'api'], headSha, ...(sha === null ? {} : { checks: { sha, outcome: 'passed' } }) })
      yield* sql`INSERT INTO external_links ${sql.insert({
        id,
        projectId,
        taskId,
        product: 'github',
        kind: 'change',
        externalId: '42',
        ref: '#42',
        key: '#42',
        url: 'https://github.com/meridian/api/pull/42',
        snapshot: draw('open', oldHead),
        createdAt: at,
        updatedAt: at,
      })}`
      const wait = taskWaitStatus(projectId, [{ kind: 'checks_passed', target: taskId }])
      assert.deepStrictEqual(yield* wait, { state: 'waiting' })
      yield* sql`UPDATE external_links SET snapshot = ${draw('open', headSha)} WHERE id = ${id}`
      assert.deepStrictEqual(yield* wait, { state: 'ready' })

      yield* sql`UPDATE external_links SET snapshot = ${draw('merged', null)} WHERE id = ${id}`
      assert.deepStrictEqual(yield* wait, {
        state: 'unreachable',
        reason: 'Task “retry-checkout” merged without a record of passing checks.',
      })
      yield* sql`INSERT INTO observations ${sql.insert({
        id: yield* newId(Ids.observation),
        projectId,
        subjectType: 'external_link',
        subjectId: id,
        kind: 'checks',
        payload: JSON.stringify({ sha: headSha, outcome: 'passed' }),
        source: 'github',
        observedAt: at,
      })}`
      assert.deepStrictEqual(yield* wait, { state: 'ready' })
    }).pipe(Effect.provide(runtime())),
  )
})
