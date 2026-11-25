import { assert, describe, it } from '@effect/vitest'
import type { ProjectId } from '@althar/domain'
import { Clock, Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'
import { TestClock } from 'effect/testing'

import { Busy } from '../src/Busy'
import { Instance } from '../src/Instance'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
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
  it.effect('says which waiting tasks are held back, and starts one anyway as the person’s own start', () => {
    const read = Effect.gen(function* () {
      const at = yield* Clock.currentTimeMillis
      return {
        at,
        cores: { busy: at, total: at * 4, count: 4 },
        memory: { used: 50, total: 100 },
        pressure: 'critical',
        contention: 0.5,
      } satisfies PressureReading
    })
    return onTestClock(
      Effect.gen(function* () {
        const projects = yield* Projects
        const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
        const projectId = project.projectId as ProjectId
        const busy = yield* Busy
        yield* busy.set(3)
        const first = yield* start(projectId, 'First')
        yield* running(first.taskId)
        yield* TestClock.adjust(Duration.seconds(5))
        yield* until(busy.now, (value) => value.atOnce === 1)
        const second = yield* start(projectId, 'Second')
        const third = yield* start(projectId, 'Third')
        const fourth = yield* start(projectId, 'Fourth')
        for (const task of [second, third, fourth]) yield* queued(task.taskId)
        // With the person's 3, two more would be at work: the first two in line are held back by memory; the third waits anyway.
        const held = yield* until(busy.held, (now) => now.size === 2)
        assert.deepStrictEqual(
          [...held],
          [
            [second.taskId, 'memory'],
            [third.taskId, 'memory'],
          ],
        )
        // The board's cards say so, and why: the window reads it there.
        const cards = (yield* Effect.orDie((yield* Queries).board(projectId))).tasks
        const heldOf = (taskId: string) => cards.find((card) => card.taskId === taskId)?.queued?.held
        assert.deepStrictEqual([heldOf(second.taskId), heldOf(third.taskId), heldOf(fourth.taskId)], ['memory', 'memory', undefined])
        // Started anyway, it takes a place past the lowered number at once; the next in line is the one held back now.
        assert.isTrue(yield* busy.startNow(second.taskId))
        yield* running(second.taskId)
        yield* until(busy.held, (now) => now.size === 1 && now.get(third.taskId) === 'memory')
        assert.strictEqual((yield* attempt(fourth.taskId)).at(-1)?.state, 'held', 'what would wait anyway still waits')
        // Nothing of it waits any more: nothing to start.
        assert.isFalse(yield* busy.startNow(second.taskId))
      }).pipe(
        Effect.provide(
          Queries.layer.pipe(
            Layer.provideMerge(
              runtime(':memory:', {}, { busy: { machine: { cores: 8, memory: 16 * 2 ** 30 }, quick: 0, pressure: { read } } }),
            ),
          ),
        ),
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
          yield* busy.set(5)
          const first = yield* start(project.projectId as ProjectId, 'First')
          yield* running(first.taskId)
          yield* tick
          yield* until(busy.now, (value) => value.atOnce === 1)
          assert.strictEqual((yield* busy.now).configured, 5)
          assert.strictEqual((yield* busy.atOnce).own, 5, 'pressure leaves the saved limit intact')
          // The window hears how many may work for now, and why.
          assert.deepInclude(yield* busy.places, { busy: 1, configured: 5, atOnce: 1, why: 'memory' })
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
          assert.strictEqual((yield* busy.now).atOnce, recover === 'healthy' ? 2 : 5)
          assert.strictEqual((yield* busy.places).why, recover === 'healthy' ? 'memory' : null, 'memory until every place is back')
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
