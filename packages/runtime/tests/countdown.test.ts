import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Stream } from 'effect'
import { SqlClient } from 'effect/sql'

import { type Failure, failureOf, Failures } from '../src/Failures'
import { Instance } from '../src/Instance'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { repository, runtime, until } from './support'

/*
 * The plans' countdown: each plan starts when its time comes. One that
 * can't start is kept to itself (ADR-047): it waits a while before it is
 * tried again, and the plans after it start in their time meanwhile.
 */

describe('the countdown', () => {
  it.live('starts the plans after one that can’t start, which waits a while before it is tried again', () => {
    const reported: Array<Failure> = []
    return Effect.gen(function* () {
      const projects = yield* Projects
      const plans = yield* Plans
      const instance = yield* Instance
      const sql = yield* SqlClient.SqlClient
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const planned = (title: string) =>
        Effect.gen(function* () {
          const task = yield* projects.createTask({
            envelope: yield* Runtime.envelope('task.create', {}),
            projectId: project.projectId,
            title,
            draft: true,
          })
          return yield* plans.propose({
            projectId: project.projectId as ProjectId,
            taskId: task.taskId,
            steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
            reason: null,
            actorId: instance.personId,
          })
        })
      const stateOf = (planId: string) => sql<{ state: string }>`SELECT state FROM task_plans WHERE id = ${planId}`
      const stuck = yield* planned('Stuck')
      // The store won't change it, so it can't start.
      yield* sql.unsafe(
        `CREATE TRIGGER stuck_plan BEFORE UPDATE ON task_plans WHEN OLD.id = '${stuck}' BEGIN SELECT RAISE(ABORT, 'The plan is stuck'); END`,
      )
      const next = yield* planned('Next')
      yield* until(stateOf(next), (rows) => rows[0]?.state === 'accepted')
      yield* Effect.sleep('500 millis')
      assert.deepStrictEqual(yield* stateOf(stuck), [{ state: 'proposed' }])
      // Tried once, and not again at once: it waits.
      assert.deepStrictEqual(
        reported.map((failure) => failure.where),
        ['Plans.start'],
      )
    }).pipe(
      Effect.provide(runtime()),
      Effect.provideService(Failures, {
        report: (cause, where, agent) => Effect.sync(() => void reported.push(failureOf(cause, where, agent ?? null))),
        events: Stream.empty,
      }),
    )
  })
})
