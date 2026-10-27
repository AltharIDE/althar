import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Coordinator } from '../src/Coordinator'
import { Launches } from '../src/Launches'
import type { Listed, Reading } from '../src/machine'
import { HISTORY, MachineLoad } from '../src/MachineLoad'
import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { repository, runtime, task } from './support'

/*
 * How hard this computer works, and Althar's part (MachineLoad.ts): read only
 * when asked and at most once a moment however often; each task's agents, a
 * project's coordinator and its runs, each with what they started, however
 * it has left their trees, and what ended between two readings; work an
 * earlier launch left running; Althar itself; and the last readings, started
 * afresh after a gap. This computer is a stand-in, read as each test says,
 * with the environments it says, around the real processes the store records.
 */

const MB = 1024 * 1024

/**
 * A stand-in computer: four cores, a quarter of them busy; and the processes the test lists, each reading `n` having used `n`
 * times its share; `reaped`, each one's time counting its reaped children's, as on a Mac with its reader and on Linux.
 */
const machine = (listed: (n: number) => ReadonlyArray<readonly [number, Listed]> | null, reaped = false) => {
  let reads = 0
  const read = Effect.sync((): Reading => {
    reads += 1
    const listing = listed(reads)
    return {
      at: reads * 3_000,
      cores: { busy: reads * 3_000, total: reads * 12_000, count: 4 },
      memory: { used: 8_000 * MB, total: 16_000 * MB },
      pressure: 'normal',
      processes: listing === null ? null : new Map(listing),
      reaped,
    }
  })
  return { read, reads: () => reads }
}

const pidOf = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{ pid: number }>`
      SELECT p.pid FROM processes p JOIN provider_sessions s ON s.id = p.provider_session_id
      WHERE s.thread_id = ${threadId} AND p.state = 'running'`
    return row?.pid ?? 0
  })

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@althar.test', ...args], { cwd })

/** A repository whose package.json runs something that keeps running. */
const runnable = () => {
  const path = repository()
  writeFileSync(join(path, 'package.json'), JSON.stringify({ name: 'meridian', scripts: { dev: 'node -e "setInterval(() => {}, 1000)"' } }))
  git(path, 'add', '.')
  git(path, 'commit', '-q', '-m', 'Run')
  return path
}

describe('this computer’s load', () => {
  it.live('reads nothing until asked; then the whole of it, and each task’s, coordinator’s and run’s part, with what each started', () => {
    const world = { lead: 0, coordinator: 0, run: 0 }
    const stand = machine((n) => [
      [1, { parent: 0, cpu: n * 9_000, memory: 10 * MB }],
      // The lead, and the test suite it runs.
      [world.lead, { parent: 1, cpu: n * 600, memory: 100 * MB }],
      [900_001, { parent: world.lead, cpu: n * 600, memory: 50 * MB }],
      [world.coordinator, { parent: 1, cpu: n * 300, memory: 80 * MB }],
      [world.run, { parent: 1, cpu: n * 1_200, memory: 30 * MB }],
    ])
    return Effect.gen(function* () {
      const sessions = yield* Sessions
      const launches = yield* Launches
      const machineLoad = yield* MachineLoad
      const { project, task: created } = yield* task()
      yield* sessions.start({ threadId: created.threadId, agentId: 'process' })
      world.lead = yield* pidOf(created.threadId)
      const coordinatorThread = yield* (yield* Coordinator).thread(project.projectId)
      yield* sessions.start({ threadId: coordinatorThread, agentId: 'process' })
      world.coordinator = yield* pidOf(coordinatorThread)
      // A run of the default branch, in a project of its own that runs.
      const projects = yield* Projects
      const runs = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: runnable() })
      const started = yield* launches.start({ projectId: runs.projectId, taskId: null, threadId: null })
      world.run = (yield* launches.processes()).find((one) => one.projectId === runs.projectId)?.pid ?? 0
      assert.strictEqual(stand.reads(), 0)

      const load = yield* machineLoad.now
      // A first reading, then a second to measure from it.
      assert.strictEqual(stand.reads(), 2)
      assert.strictEqual(load.cpu, 0.25)
      assert.deepInclude(load, { memoryUsed: 8_000 * MB, memoryTotal: 16_000 * MB, pressure: 'normal' })
      const agent = { id: 'process', name: 'Fake process' }
      assert.deepStrictEqual(load.shares, [
        // Most CPU first; the same CPU, most memory first.
        {
          kind: 'task',
          projectId: project.projectId,
          project: project.name,
          taskId: created.taskId,
          threadId: created.threadId,
          title: 'Retry checkout',
          agent,
          cpu: 0.1,
          memory: 150 * MB,
          processes: 2,
        },
        {
          kind: 'run',
          projectId: runs.projectId,
          project: runs.name,
          taskId: null,
          threadId: null,
          title: null,
          agent: null,
          cpu: 0.1,
          memory: 30 * MB,
          processes: 1,
        },
        {
          kind: 'coordinator',
          projectId: project.projectId,
          project: project.name,
          taskId: null,
          threadId: null,
          title: null,
          agent,
          cpu: 0.025,
          memory: 80 * MB,
          processes: 1,
        },
      ])
      assert.lengthOf(load.history, 1)
      assert.strictEqual(load.history[0]?.cpu, 0.25)
      assert.closeTo(load.history[0]?.work ?? 0, 0.225, 1e-9)
      // Asked again at once, as a second window would, it is the same reading.
      assert.strictEqual(yield* machineLoad.now, load)
      assert.strictEqual(stand.reads(), 2)
      yield* launches.stop(started.id)
    }).pipe(Effect.provide(runtime(':memory:', {}, { load: { read: stand.read, settle: Duration.millis(1) } })))
  })

  it.live('counts a task’s run as the task’s, and its lead names its agent before its steps’', () => {
    const world = { lead: 0, run: 0 }
    const stand = machine((n) => [
      [world.lead, { parent: 1, cpu: n * 300, memory: 40 * MB }],
      [world.run, { parent: 1, cpu: n * 900, memory: 20 * MB }],
    ])
    return Effect.gen(function* () {
      const sessions = yield* Sessions
      const launches = yield* Launches
      const projects = yield* Projects
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: runnable() })
      const created = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', { title: 'Retry checkout' }),
        projectId: project.projectId,
        title: 'Retry checkout',
      })
      // Its run first, so the lead comes after it and still names the task's agent.
      const started = yield* launches.start({ projectId: project.projectId, taskId: created.taskId, threadId: null })
      world.run = (yield* launches.processes())[0]?.pid ?? 0
      yield* sessions.start({ threadId: created.threadId, agentId: 'process' })
      world.lead = yield* pidOf(created.threadId)
      const [share, ...rest] = (yield* (yield* MachineLoad).now).shares ?? []
      assert.lengthOf(rest, 0)
      // The run, started before the lead, is opened by the task's thread all the same.
      assert.deepInclude(share, {
        kind: 'task',
        taskId: created.taskId,
        threadId: created.threadId,
        title: 'Retry checkout',
        cpu: 0.1,
        memory: 60 * MB,
        processes: 2,
      })
      assert.deepStrictEqual(share?.agent, { id: 'process', name: 'Fake process' })
      yield* launches.stop(started.id)
    }).pipe(Effect.provide(runtime(':memory:', {}, { load: { read: stand.read, settle: Duration.millis(1) } })))
  })

  it.live('starts the readings afresh after a gap, and keeps two minutes of them', () => {
    const stand = machine(() => [])
    return Effect.gen(function* () {
      const machineLoad = yield* MachineLoad
      for (let n = 0; n < HISTORY + 5; n += 1) {
        yield* machineLoad.now
        yield* Effect.sleep(Duration.millis(60))
      }
      const kept = yield* machineLoad.now
      assert.lengthOf(kept.history, HISTORY)
      // Nothing of Althar's runs: its part is none, not unknown.
      assert.deepStrictEqual(kept.shares, [])
      // Not asked for a while: what it read last is too old to measure from.
      yield* Effect.sleep(Duration.millis(400))
      const reads = stand.reads()
      assert.lengthOf((yield* machineLoad.now).history, 1)
      assert.strictEqual(stand.reads(), reads + 2)
    }).pipe(Effect.provide(runtime(':memory:', {}, { load: { read: stand.read, every: Duration.millis(50), settle: Duration.millis(1) } })))
  })

  it.live('says Althar’s part is unknown where processes can’t be listed, and measures CPU only from a listing before', () => {
    const world = { lead: 0 }
    // The first two readings can't list processes; every one after can.
    const stand = machine((n) => (n <= 2 ? null : [[world.lead, { parent: 1, cpu: n * 600, memory: 5 * MB }]]))
    return Effect.gen(function* () {
      const machineLoad = yield* MachineLoad
      const { task: created } = yield* task()
      yield* (yield* Sessions).start({ threadId: created.threadId, agentId: 'process' })
      world.lead = yield* pidOf(created.threadId)
      assert.isNull((yield* machineLoad.now).shares)
      // The listing is back: what each holds shows at once, and its CPU from the reading after.
      yield* Effect.sleep(Duration.millis(60))
      assert.deepInclude((yield* machineLoad.now).shares?.[0], { taskId: created.taskId, cpu: 0, memory: 5 * MB, processes: 1 })
      yield* Effect.sleep(Duration.millis(60))
      assert.deepInclude((yield* machineLoad.now).shares?.[0], { taskId: created.taskId, cpu: 0.05 })
    }).pipe(Effect.provide(runtime(':memory:', {}, { load: { read: stand.read, every: Duration.millis(50), settle: Duration.millis(1) } })))
  })

  it.live('counts as a task’s a server its lead left in the background, and what ended between two readings', () => {
    const world = { lead: 0, taskId: '' }
    const asked: Array<number> = []
    const stand = machine(
      (n) => [
        [1, { parent: 0, cpu: n * 9_000, memory: 10 * MB, started: 0 }],
        // The lead: at the second reading its time counts its test run's, which ended in between, and a check's that
        // started and ended in between: 600 its own, 300 and 900 the run's, 1,500 the check's.
        [world.lead, { parent: 1, cpu: n === 1 ? 600 : 1_200 + 300 + 900 + 1_500, memory: 100 * MB, started: 1 }],
        ...(n === 1 ? [[900_001, { parent: world.lead, cpu: 300, memory: 50 * MB, started: 2 }] as const] : []),
        // The dev server it started in the background, left to launchd once its shell ended.
        [900_002, { parent: 1, cpu: n * 300, memory: 40 * MB, started: 3 }],
        // Someone else's, and another Althar's.
        [900_003, { parent: 1, cpu: n * 3_000, memory: 500 * MB, started: 4 }],
        [900_004, { parent: 1, cpu: n * 3_000, memory: 500 * MB, started: 5 }],
      ],
      true,
    )
    const marks = (pids: ReadonlyArray<number>) =>
      Effect.sync(() => {
        asked.push(...pids)
        const named = new Map<number, string>([
          [900_002, `task:${world.taskId}`],
          [900_004, 'task:another-althars'],
        ])
        return new Map(pids.flatMap((pid) => (named.has(pid) ? [[pid, named.get(pid) ?? '']] : [])))
      })
    return Effect.gen(function* () {
      const machineLoad = yield* MachineLoad
      const { task: created } = yield* task()
      world.taskId = created.taskId
      yield* (yield* Sessions).start({ threadId: created.threadId, agentId: 'process' })
      world.lead = yield* pidOf(created.threadId)
      const load = yield* machineLoad.now
      // Its lead's work since, its run's and the check's, and its server's: 3,300 ms of 12,000.
      assert.deepStrictEqual(
        load.shares?.map(({ taskId, cpu, memory, processes }) => ({ taskId, cpu, memory, processes })),
        [{ taskId: created.taskId, cpu: 0.275, memory: 140 * MB, processes: 2 }],
      )
      // Each process no tree reaches has its environment read once, however many readings there are.
      yield* Effect.sleep(Duration.millis(60))
      yield* machineLoad.now
      assert.strictEqual(asked.filter((pid) => pid === 900_002).length, 1)
      assert.notInclude(asked, world.lead)
    }).pipe(
      Effect.provide(
        runtime(':memory:', {}, { load: { read: stand.read, marks, every: Duration.millis(50), settle: Duration.millis(1) } }),
      ),
    )
  })

  it.live('counts what an earlier launch’s agent left running as its task’s, as the store knows the task', () => {
    const world = { taskId: '' }
    const stand = machine((n) => [[700, { parent: 1, cpu: n * 1_200, memory: 30 * MB }]])
    const marks = (pids: ReadonlyArray<number>) => Effect.succeed(new Map(pids.includes(700) ? [[700, `task:${world.taskId}`]] : []))
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { project, task: created } = yield* task()
      world.taskId = created.taskId
      yield* (yield* Sessions).start({ threadId: created.threadId, agentId: 'process' })
      // Its agent is no longer this launch's, as after a restart: what it started still runs.
      yield* sql`UPDATE processes SET state = 'exited'`
      const load = yield* (yield* MachineLoad).now
      assert.deepStrictEqual(load.shares, [
        {
          kind: 'task',
          projectId: project.projectId,
          project: project.name,
          taskId: created.taskId,
          threadId: created.threadId,
          title: 'Retry checkout',
          agent: { id: 'process', name: 'Fake process' },
          cpu: 0.1,
          memory: 30 * MB,
          processes: 1,
        },
      ])
    }).pipe(Effect.provide(runtime(':memory:', {}, { load: { read: stand.read, marks, settle: Duration.millis(1) } })))
  })

  it.live('counts Althar itself, the app and what it started that is no work’s, in Althar’s part', () => {
    const world = { lead: 0 }
    const stand = machine((n) => [
      [50, { parent: 1, cpu: n * 900, memory: 200 * MB }],
      // Its runtime, which started the lead.
      [51, { parent: 50, cpu: n * 300, memory: 100 * MB }],
      [world.lead, { parent: 51, cpu: n * 600, memory: 80 * MB }],
    ])
    return Effect.gen(function* () {
      const { task: created } = yield* task()
      yield* (yield* Sessions).start({ threadId: created.threadId, agentId: 'process' })
      world.lead = yield* pidOf(created.threadId)
      const load = yield* (yield* MachineLoad).now
      assert.deepStrictEqual(load.althar, { cpu: 0.1, memory: 300 * MB, processes: 2 })
      assert.deepInclude(load.shares?.[0], { taskId: created.taskId, cpu: 0.05, memory: 80 * MB, processes: 1 })
      assert.closeTo(load.history.at(-1)?.work ?? 0, 0.15, 1e-9)
    }).pipe(Effect.provide(runtime(':memory:', {}, { load: { read: stand.read, app: 50, settle: Duration.millis(1) } })))
  })
})
