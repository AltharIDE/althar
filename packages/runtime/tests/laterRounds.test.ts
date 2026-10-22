import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { Instance } from '../src/Instance'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { repository, runtime, until } from './support'

/*
 * A later round of review whose lead's server still runs (Busy.ts), where
 * placesKept.test.ts and busy.test.ts don't go: it starts at once in its
 * task's place, the server running on in it (ADR-032's follow-up of 21
 * October), with what the lead settled before it.
 */

const GB = 1024 ** 3

/** The runtime on a machine that runs one agent at once, with the queries the screens read. */
const oneAtOnce = () => Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', {}, { busy: { machine: { cores: 3, memory: 7 * GB } } })))

/** The task's step attempts, oldest first. */
const attempts = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ id: string; step: string; iteration: number; state: string; holdReason: string | null; output: string | null }>`
      SELECT a.id, n.node_key AS step, n.iteration, a.state, a.hold_reason, a.output FROM node_attempts a JOIN nodes n ON n.id = a.node_id
      JOIN workflow_executions e ON e.id = n.execution_id JOIN runs r ON r.id = e.run_id
      WHERE r.task_id = ${taskId} ORDER BY a.admitted_at, a.rowid`
  })

/** A task whose lead serves what it built, then finishes, and whose review finds something in its first round; started now. */
const served = Effect.gen(function* () {
  const projects = yield* Projects
  const plans = yield* Plans
  const instance = yield* Instance
  const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
  const task = yield* projects.createTask({
    envelope: yield* Runtime.envelope('task.create', {}),
    projectId: project.projectId,
    title: 'Fix the heading',
    description: 'Serve it, then finish. [lead:serve] [lead:finish] [review:findings]',
    draft: true,
  })
  const planId = yield* plans.propose({
    projectId: project.projectId as ProjectId,
    taskId: task.taskId,
    steps: [
      { key: 'implement', agentId: 'claude-code', model: null, skipped: false },
      { key: 'review', agentId: 'codex', model: null, skipped: false },
    ],
    reason: null,
    actorId: instance.personId,
    end: null,
    held: true,
  })
  yield* plans.start(planId, instance.personId)
  return task
})

/** What the review was told for a later round. */
const toldLater = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [told] = yield* until(
      sql<{ body: string }>`
        SELECT i.body FROM user_inputs i JOIN threads t ON t.id = i.thread_id
        WHERE t.task_id = ${taskId} AND t.kind = 'step' AND i.body LIKE 'Round 2.%'`,
      (rows) => rows.length === 1,
      Duration.seconds(20),
    )
    return told?.body ?? ''
  })

/** Waits until the task's run is over, its later round passed. */
const passed = (taskId: string) =>
  until(
    attempts(taskId),
    (rows) => rows.some((row) => row.step === 'review' && row.iteration === 1 && row.state === 'succeeded'),
    Duration.seconds(20),
  )

describe('a later round of review, its lead’s server still running', () => {
  it.live('starts at once in its task’s place, with what the lead settled', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const sessions = yield* Sessions
      const task = yield* served
      assert.include(yield* toldLater(task.taskId), 'The lead settled your findings:\n\nFixed the heading.')
      yield* passed(task.taskId)
      // No round waited for a place, and the server ran on all the while.
      assert.deepStrictEqual(
        (yield* attempts(task.taskId)).flatMap((row) => (row.holdReason === null ? [] : [row.holdReason])),
        [],
      )
      assert.lengthOf(
        yield* sql`SELECT sequence FROM record_events WHERE aggregate_type = 'node_attempt' AND type = 'node_attempt.held'`,
        0,
      )
      const left = Option.getOrUndefined(yield* sessions.running(task.threadId))?.background ?? []
      assert.lengthOf(
        left.filter((one) => one.ended === null),
        1,
      )
    }).pipe(Effect.provide(oneAtOnce())),
  )
})
