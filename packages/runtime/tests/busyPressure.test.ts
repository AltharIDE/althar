import { assert, describe, it } from '@effect/vitest'
import type { ProjectId } from '@althar/domain'
import { Clock, Duration, Effect } from 'effect'
import { SqlClient } from 'effect/sql'
import { TestClock } from 'effect/testing'

import { Busy, type Waiter } from '../src/Busy'
import { Connectivity } from '../src/Connectivity'
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
  it.effect('uses all five configured places when four tasks are waiting behind one active turn', () => {
    const read = Effect.map(Clock.currentTimeMillis, (at): PressureReading => ({
      at,
      cores: { busy: at, total: at * 4, count: 10 },
      memory: { used: 95, total: 100 },
      pressure: 'critical',
      contention: 3,
    }))
    return onTestClock(
      Effect.gen(function* () {
        const busy = yield* Busy
        const connection = yield* Connectivity
        yield* Effect.forkChild(busy.enter('coverage', (room) => Effect.succeed(room), { order: 'person', next: () => Effect.never }))
        yield* until(busy.now, (value) => value.busy === 1)

        // Keep all four in line while the automatic scheduler reads the pressure.
        yield* connection.set(false)
        const started = new Set<string>()
        const waiting = ['mock-mode', 'design-pass', 'queue-fix', 'usage-prototype'].map((taskId): Waiter => ({
          taskId,
          order: 'new',
          since: new Date(0).toISOString(),
          start: Effect.andThen(
            Effect.sync(() => started.add(taskId)),
            Effect.never,
          ),
        }))
        yield* busy.queue(Effect.sync(() => waiting.filter((waiter) => !started.has(waiter.taskId))))
        yield* TestClock.adjust(Duration.seconds(5))
        yield* until(busy.now, (value) => value.atOnce === 1)
        yield* connection.set(true)
        assert.strictEqual(started.size, 0)

        yield* busy.set(5)
        assert.strictEqual((yield* busy.now).atOnce, 5)
        // The settings change wakes the existing queue without advancing its poll clock.
        yield* until(
          Effect.sync(() => started.size),
          (count) => count === 4,
        )
        assert.strictEqual((yield* busy.now).busy, 5)
      }).pipe(
        Effect.provide(runtime(':memory:', {}, { busy: { machine: { cores: 8, memory: 16 * 2 ** 30 }, quick: 0, pressure: { read } } })),
      ),
    )
  })

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
          const first = yield* start(project.projectId as ProjectId, 'First')
          yield* running(first.taskId)
          yield* tick
          yield* until(busy.now, (value) => value.atOnce === 1)
          assert.strictEqual((yield* busy.atOnce).count, 3, 'the machine’s default is not rewritten')
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
        }).pipe(
          Effect.provide(runtime(':memory:', {}, { busy: { machine: { cores: 8, memory: 16 * 2 ** 30 }, quick: 0, pressure: { read } } })),
        ),
      )
    })
  }
})
