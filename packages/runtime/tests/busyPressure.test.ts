import { assert, describe, it } from '@effect/vitest'
import type { ProjectId } from '@althar/domain'
import { Clock, Duration, Effect } from 'effect'
import { SqlClient } from 'effect/sql'
import { TestClock } from 'effect/testing'

import { Busy } from '../src/Busy'
import { Instance } from '../src/Instance'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { Tasks } from '../src/Tasks'
import type { PressureReading } from '../src/resourcePressure'
import { onTestClock, repository, runtime, until } from './support'

const attempt = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ state: string; holdReason: string | null }>`SELECT a.state,a.hold_reason FROM node_attempts a
    JOIN nodes n ON n.id=a.node_id JOIN workflow_executions e ON e.id=n.execution_id
    JOIN runs r ON r.id=e.run_id WHERE r.task_id=${taskId} ORDER BY a.rowid`
  })
const start = (projectId: ProjectId, title: string) =>
  Effect.gen(function* () {
    const created = yield* (yield* Projects).createTask({
      envelope: yield* Runtime.envelope('task.create', { title }),
      projectId,
      title,
      description: 'Work on this. [lead:wait]',
      draft: true,
    })
    const plans = yield* Plans
    const actor = (yield* Instance).personId
    const plan = yield* plans.propose({
      projectId,
      taskId: created.taskId,
      steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
      reason: null,
      actorId: actor,
      end: null,
      held: true,
    })
    yield* plans.start(plan, actor)
    return created
  })
const running = (id: string) => until(attempt(id), (rows) => rows.at(-1)?.state === 'running')
const queued = (id: string) => until(attempt(id), (rows) => rows.at(-1)?.state === 'held' && rows.at(-1)?.holdReason === 'machine_busy')

describe('pressure and the real admission queue', () => {
  for (const recover of ['healthy', 'unavailable'] as const) {
    it.effect(`keeps running work, direct actions and stop intact, then wakes queued work when pressure becomes ${recover}`, () => {
      let level: 'critical' | 'normal' | 'unavailable' = 'critical'
      let reads = 0
      const read = Effect.gen(function* () {
        const at = yield* Clock.currentTimeMillis
        reads++
        if (level === 'unavailable') return yield* Effect.fail(new Error('pressure sensor unavailable'))
        return {
          at,
          cores: { busy: at, total: at * 4, count: 4 },
          memory: { used: 50, total: 100 },
          pressure: level,
          contention: 0.5,
        } satisfies PressureReading
      })
      const tick = Effect.gen(function* () {
        const before = reads
        yield* TestClock.adjust(Duration.seconds(5))
        yield* until(
          Effect.sync(() => reads),
          (count) => count > before,
        )
      })
      return onTestClock(
        Effect.gen(function* () {
          const projects = yield* Projects
          const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
          const busy = yield* Busy
          yield* busy.set(3)
          const first = yield* start(project.projectId as ProjectId, 'First')
          yield* running(first.taskId)
          yield* tick
          yield* until(busy.now, (value) => value.atOnce === 1)
          assert.strictEqual((yield* busy.atOnce).count, 3, 'the saved setting is not rewritten')
          const second = yield* start(project.projectId as ProjectId, 'Second')
          const cancelled = yield* start(project.projectId as ProjectId, 'Cancelled')
          yield* queued(second.taskId)
          yield* queued(cancelled.taskId)
          let direct = false
          assert.isTrue(
            yield* busy.turn(
              { taskId: first.taskId, threadId: first.threadId, sessionId: 'direct-action', review: false, byPerson: true },
              (begun) =>
                Effect.andThen(
                  Effect.sync(() => {
                    direct = true
                  }),
                  begun,
                ),
            ),
          )
          assert.isTrue(direct)
          yield* (yield* Tasks).stop({ envelope: yield* Runtime.envelope('task.stop', {}), taskId: cancelled.taskId })
          level = recover === 'healthy' ? 'normal' : 'unavailable'
          if (recover === 'healthy') for (let n = 0; n < 7; n++) yield* tick
          else yield* tick
          yield* running(second.taskId)
          assert.strictEqual((yield* busy.now).atOnce, recover === 'healthy' ? 2 : 3)
          const sql = yield* SqlClient.SqlClient
          const sessions = yield* sql`SELECT id FROM provider_sessions WHERE thread_id=${cancelled.threadId}`
          assert.strictEqual(sessions.length, 0, 'cancelled work never starts when capacity returns')
          assert.strictEqual((yield* attempt(first.taskId)).at(-1)?.state, 'running', 'pressure never kills the current build')
        }).pipe(Effect.provide(runtime(':memory:', {}, { busy: { quick: 0, pressure: { read } } }))),
      )
    })
  }
})
