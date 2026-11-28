import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { Readable, Writable } from 'node:stream'

import { fakeAgentMain } from '@althar/provider-adapters/testing'
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
import { Sessions } from '../src/Sessions'
import type { WorkerExecution } from '../src/workerExecution'
import type { RuntimeOptions } from '../src/Config'
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
const start = (projectId: ProjectId, title: string, workerId?: string) =>
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
    yield* plans.start(plan, actor, workerId)
    return created
  })
/** The person says something to a thread's agent. */
const say = (threadId: string, body: string) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    yield* sessions.send({
      envelope: yield* Runtime.envelope('thread.send', { threadId, body }),
      threadId,
      body,
      disposition: 'interrupt_and_continue',
    })
  })

/** A worker's agent: the fake agent in the worker's folder, as a worker runs it; `ended` once it is gone. */
const fakeWorker = (cwd: string, ended: () => void) =>
  Effect.gen(function* () {
    const child = spawn('bun', [fakeAgentMain], { cwd, stdio: ['pipe', 'pipe', 'ignore'] })
    const exited = once(child, 'exit').then((result) => {
      ended()
      return result
    })
    const stop = Effect.promise(async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill()
      await exited
    })
    yield* Effect.addFinalizer(() => stop)
    return {
      _tag: 'Remote',
      stdin: Writable.toWeb(child.stdin),
      stdout: Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
      exited: Effect.promise(() => exited.then(([code, signal]) => ({ code: code as number | null, signal: signal as string | null }))),
      stop,
    } satisfies WorkerExecution['transport']
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

  it.effect('starts work placed on a worker at once under this computer’s memory pressure, and holds back what runs here', () => {
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
    const workerId = 'wrk_' + '5'.repeat(32)
    const workerPath = repository()
    // The worker runs one task at a time: it holds a task's workspace from the session it opens for it until that session ends.
    const opened: Array<string> = []
    let holds: string | null = null
    const workers: NonNullable<RuntimeOptions['workers']> = {
      // Checked already: its sandbox starts, it has git, and the lead's agent started there once.
      list: () => [
        {
          workerId,
          providers: ['codex'],
          busy: holds !== null,
          readiness: {
            sandbox: { starts: true },
            tools: [{ name: 'git', version: '2.43.0' }],
            models: [],
            agents: [{ providerId: 'codex', starts: true }],
          },
        },
      ],
      enrolled: () => [
        {
          workerId,
          name: 'build-box',
          connected: true,
          busy: holds !== null,
          ...(holds === null ? {} : { workspaceId: holds }),
          providers: ['codex'],
          projectIds: [],
        },
      ],
      open: (request) =>
        Effect.gen(function* () {
          opened.push(request.workspaceId)
          holds = request.workspaceId
          const transport = yield* fakeWorker(workerPath, () => {
            if (holds === request.workspaceId) holds = null
          })
          return { path: workerPath, toolPort: request.toolPort, transport, checkpoint: Effect.void }
        }),
    }
    return onTestClock(
      Effect.gen(function* () {
        const projects = yield* Projects
        const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
        const projectId = project.projectId as ProjectId
        const busy = yield* Busy
        const sql = yield* SqlClient.SqlClient
        const workspaceOf = (taskId: string) =>
          Effect.map(sql<{ id: string }>`SELECT id FROM workspaces WHERE task_id = ${taskId}`, (rows) => rows.map((row) => row.id))
        yield* busy.set(3)
        const first = yield* start(projectId, 'First')
        yield* running(first.taskId)
        yield* TestClock.adjust(Duration.seconds(5))
        yield* until(busy.now, (value) => value.atOnce === 1)
        // Placed on the worker, its lead starts at once: this computer's one place is taken and its memory is short, but
        // neither is the worker's.
        const remote = yield* start(projectId, 'On the worker', workerId)
        yield* running(remote.taskId)
        assert.deepStrictEqual(opened, yield* workspaceOf(remote.taskId))
        assert.notInclude(
          (yield* attempt(remote.taskId)).map((row) => row.holdReason),
          'machine_busy',
          'it never waited for a place here',
        )
        // It takes none of this computer's places, which says it runs apart.
        yield* until(busy.places, (places) => places.onWorkers === 1)
        assert.deepInclude(yield* busy.places, { busy: 1, configured: 3, atOnce: 1, why: 'memory', onWorkers: 1 })
        // A review runs here: following its lead, it takes that lead's place only where the lead held one here. The worker
        // lead's place is no place here, which is full; the lead here hands its own on.
        const after = (taskId: string) =>
          busy.enter(taskId, (room) => Effect.succeed(room), { review: true, after: 'lead', order: 'underway' })
        assert.isFalse(yield* after(remote.taskId), 'a lead’s place on a worker is no place here for its review')
        assert.isTrue(yield* after(first.taskId), 'a lead’s place here is its review’s')
        // Work here is held back as before.
        const home = yield* start(projectId, 'Here')
        yield* queued(home.taskId)
        yield* until(busy.held, (now) => now.get(home.taskId) === 'memory')
        // Picked by name though the worker is at work on another task, the next takes it, and waits for it, not for this
        // computer: the worker runs one task at a time.
        const next = yield* start(projectId, 'Also on the worker', workerId)
        yield* queued(next.taskId)
        yield* until(busy.waitsForWorker, (now) => now.get(next.taskId) === workerId)
        assert.isFalse((yield* busy.held).has(next.taskId), 'never held back for this computer’s memory')
        const cards = (yield* Effect.orDie((yield* Queries).board(projectId))).tasks
        const card = (taskId: string) => cards.find((one) => one.taskId === taskId)?.queued
        // Its card names the worker and the task that has it; the one here says it is held back by memory.
        assert.deepInclude(card(next.taskId), { worker: 'build-box', busy: 1, atOnce: 1 })
        assert.deepStrictEqual(
          card(next.taskId)?.holders?.map((holder) => holder.title),
          ['On the worker'],
        )
        assert.isUndefined(card(next.taskId)?.held)
        assert.deepInclude(card(home.taskId), { held: 'memory' })
        assert.isUndefined(card(home.taskId)?.worker)
        assert.deepStrictEqual(
          card(home.taskId)?.holders?.map((holder) => holder.title),
          ['First'],
          'what holds the places here leaves out what runs on the worker',
        )
        // The first on the worker finishes. Its idle lead still holds the worker's workspace, so the next waits on: then its
        // finished session lets the worker go, and the next starts there.
        yield* say(remote.threadId, '[lead:finish]')
        yield* until(attempt(remote.taskId), (rows) => rows.at(-1)?.state === 'succeeded')
        yield* running(next.taskId)
        assert.deepStrictEqual(opened.slice(1), yield* workspaceOf(next.taskId))
        assert.strictEqual(holds, opened[1] ?? null, 'the worker holds the next task’s workspace now')
        assert.isFalse((yield* busy.waitsForWorker).has(next.taskId))
        assert.deepInclude(card(home.taskId), { held: 'memory' }, 'what runs here is held back still')
        // Only the same session goes, looked at under its lock: another one's id lets nothing go.
        assert.isFalse(yield* (yield* Sessions).retireIdle(next.threadId, 'another-session'))
        // Said something now, the first's lead starts again on its worker, which the next has: it waits for the worker,
        // never started into it.
        yield* say(remote.threadId, 'One more thing. [lead:finish]')
        yield* until(busy.waitsForWorker, (now) => now.get(remote.taskId) === workerId)
        // The window starts the lead as it sends: no session yet, and the worker isn't asked.
        assert.strictEqual(yield* (yield* Sessions).start({ threadId: remote.threadId, agentId: 'codex' }), '')
        assert.strictEqual(opened.length, 2, 'the worker was never asked for a second session while it runs one')
        const told = Effect.map(
          sql<{ n: number }>`SELECT count(*) AS n FROM user_inputs WHERE thread_id = ${remote.threadId} AND state = 'queued'`,
          ([row]) => row?.n ?? 0,
        )
        assert.strictEqual(yield* told, 1, 'what was said waits')
        // The next finishes and lets the worker go: the first's lead starts there again, and what was said reaches it.
        yield* say(next.threadId, '[lead:finish]')
        yield* until(
          Effect.sync(() => opened.length),
          (n) => n === 3,
        )
        assert.strictEqual(opened[2], opened[0], 'the first task’s workspace, back on the worker')
        yield* until(told, (n) => n === 0)
        yield* until(busy.waitsForWorker, (now) => !now.has(remote.taskId))
      }).pipe(
        Effect.provide(
          Queries.layer.pipe(
            Layer.provideMerge(
              runtime(':memory:', {}, { busy: { machine: { cores: 8, memory: 16 * 2 ** 30 }, quick: 0, pressure: { read } }, workers }),
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
