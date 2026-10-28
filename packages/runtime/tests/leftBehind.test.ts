import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ActorId, ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { makeFakeService } from '@althar/connectors/testing'

import { Busy } from '../src/Busy'
import { Changes } from '../src/Changes'
import { Connections } from '../src/Connections'
import { Instance } from '../src/Instance'
import { Launches } from '../src/Launches'
import { doomedOf, forebearsOf } from '../src/LeftBehind'
import { type Listed, listProcesses, marksOf, WORK } from '../src/machine'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { Tasks } from '../src/Tasks'
import { fakeConnectors, HOST, hosted, repository, runtime, until } from './support'

/*
 * What a task leaves running once it settles, checked against the processes
 * this computer runs, by the mark every one of them carries (`ALTHAR_WORK`):
 * its lead, run as a process of its own, leaves a server in a process group of
 * its own, as Claude Code does, and the task has a run of its own going.
 * However the task settles, none of it is left a few seconds after; and
 * what Althar lost track of, as across a restart, goes once it looks.
 */

/** Windows, where processes carry no mark to be found by. */
const windows = process.platform === 'win32'

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t.test', ...args], { cwd })
    .toString()
    .trim()

/** Every process on this computer marked as the task's work, by pid. */
const markedFor = (taskId: string) =>
  Effect.gen(function* () {
    const listing = yield* listProcesses()
    if (listing === null) return []
    const marks = yield* marksOf()([...listing.keys()])
    return [...marks].flatMap(([pid, work]) => (work === `task:${taskId}` ? [pid] : []))
  })

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** A process of its own that runs until stopped, outside every tree, marked as `work` says, or not at all. */
const loner = (work: string | null) => {
  const env = { ...process.env }
  delete env[WORK]
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    detached: true,
    stdio: 'ignore',
    env: work === null ? env : { ...env, [WORK]: work },
  })
  child.unref()
  return child.pid ?? 0
}

/** A command that runs until stopped, as a run of the project. */
const SERVE = `"${process.execPath}" -e "setInterval(() => {}, 1000)"`

/** A plan for the task, on the lead run as a process, started now: a quick one, or one that opens a draft pull request. */
const started = (title: string, more: { readonly root?: string; readonly quick?: boolean } = {}) =>
  Effect.gen(function* () {
    const projects = yield* Projects
    const plans = yield* Plans
    const instance = yield* Instance
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: more.root ?? repository() })
    const task = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', {}),
      projectId: project.projectId,
      title,
      draft: true,
    })
    const planId = yield* plans.propose({
      projectId: project.projectId as ProjectId,
      taskId: task.taskId,
      steps: [{ key: 'implement', agentId: 'process', model: null, skipped: false }],
      reason: null,
      actorId: instance.personId as ActorId,
      held: true,
      ...(more.quick === true ? { end: null, here: true } : { end: 'draft' as const }),
    })
    yield* plans.start(planId, instance.personId)
    // Its lead finished, its server left running in the background.
    yield* until(
      Effect.map(Effect.orDie((yield* Queries).card(task.taskId)), (card) => (card?.phase === 'ready' ? [card] : [])),
      (ready) => ready.length === 1,
      Duration.seconds(30),
    )
    const running = yield* (yield* Sessions).running(task.threadId)
    assert.isTrue(Option.isSome(running) && running.value.background.some((left) => left.ended === null))
    // And a run of its own, from its worktree.
    const launches = yield* Launches
    yield* launches.keep({ projectId: project.projectId, run: { command: SERVE, setup: null }, actorId: instance.personId })
    yield* launches.start({ projectId: project.projectId, taskId: task.taskId, threadId: task.threadId })
    // Its lead, the server it left and its run, each found by its mark.
    const marked = yield* until(markedFor(task.taskId), (pids) => pids.length >= 3, Duration.seconds(10))
    return { project, task, marked }
  })

/** Waits until nothing on this computer carries the task's mark, and says how long that took. */
const nothingLeft = (taskId: string, within = Duration.seconds(15)) =>
  Effect.gen(function* () {
    const from = Date.now()
    yield* until(markedFor(taskId), (pids) => pids.length === 0, within)
    return Date.now() - from
  })

const holdersOf = (taskId: string) =>
  Effect.map(
    Effect.flatMap(Busy, (busy) => busy.now),
    (now) => now.holders.filter((holder) => holder.taskId === taskId),
  )

describe('what to stop by its mark', () => {
  const listing = new Map<number, Listed>([
    [1, { parent: 1, cpu: 0, memory: 0 }],
    // Althar, under the shell it was started from, with an agent and the server it started.
    [10, { parent: 1, cpu: 0, memory: 0 }],
    [20, { parent: 10, cpu: 0, memory: 0 }],
    [30, { parent: 20, cpu: 0, memory: 0 }],
    [31, { parent: 30, cpu: 0, memory: 0 }],
    // A server that left its agent, and what it started, unmarked.
    [40, { parent: 1, cpu: 0, memory: 0 }],
    [41, { parent: 40, cpu: 0, memory: 0 }],
    // Another task's, and one no Althar started.
    [50, { parent: 1, cpu: 0, memory: 0 }],
    [60, { parent: 1, cpu: 0, memory: 0 }],
  ])
  const marks = new Map([
    [10, 'task:task_a'],
    [20, 'task:task_a'],
    [30, 'task:task_a'],
    [31, 'task:task_a'],
    [40, 'task:task_a'],
    [50, 'task:task_b'],
  ])

  it('is what carries the work and all it started, outside Althar’s tree and what Althar runs under', () => {
    const spared = forebearsOf(listing, 20)
    assert.deepStrictEqual(
      [...spared].toSorted((a, b) => a - b),
      [1, 10, 20],
    )
    assert.deepStrictEqual(
      [...doomedOf(listing, marks, (work) => work === 'task:task_a', 20, spared)].toSorted((a, b) => a - b),
      [40, 41],
    )
    assert.deepStrictEqual(
      doomedOf(listing, marks, (work) => work === 'task:task_c', 20, spared),
      [],
    )
    assert.deepStrictEqual(
      doomedOf(listing, new Map(), () => true, 20, spared),
      [],
    )
  })
})

describe.skipIf(windows)('a task that settles', () => {
  it.live(
    'merged on its host, leaves no agent, server or run of it running, and keeps no place',
    () => {
      const { working, bare } = hosted()
      const github = makeFakeService({ pushUrl: () => bare })
      github.addRepository(['meridian', 'api'])
      git(working, 'config', 'user.name', 'Fake')
      git(working, 'config', 'user.email', 'fake@althar.test')
      return Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const instance = yield* Instance
        yield* (yield* Connections).connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
        const { task, marked } = yield* started('Retry checkout [lead:serve-apart] [lead:edit] [lead:finish]', { root: working })
        // The server it left keeps a place for it, before.
        assert.isNotEmpty(yield* holdersOf(task.taskId))
        github.mergeByHand(1)
        yield* (yield* Changes).refresh(task.taskId)
        yield* until(sql<{ state: string }>`SELECT state FROM tasks WHERE id = ${task.taskId}`, (rows) => rows[0]?.state === 'done')
        const took = yield* nothingLeft(task.taskId)
        assert.isBelow(took, 10_000)
        assert.isTrue(marked.every((pid) => !alive(pid)))
        assert.isTrue(Option.isNone(yield* (yield* Sessions).running(task.threadId)))
        assert.deepStrictEqual(
          yield* (yield* Launches).ofProject(
            (yield* sql<{ projectId: string }>`SELECT project_id FROM tasks WHERE id = ${task.taskId}`)[0]?.projectId ?? '',
          ),
          [],
        )
        // Keeping a place no longer lists it.
        assert.deepStrictEqual(yield* holdersOf(task.taskId), [])
      }).pipe(
        Effect.provide(
          Queries.layer.pipe(
            Layer.provideMerge(runtime(undefined, {}, { connectors: fakeConnectors({ github }), listenEvery: Duration.millis(100) })),
          ),
        ),
      )
    },
    60_000,
  )

  it.live(
    'marked done, leaves none of it running',
    () =>
      Effect.gen(function* () {
        const { task, marked } = yield* started('Sketch the page [lead:serve-apart] [lead:finish]', { quick: true })
        assert.isTrue(yield* (yield* Tasks).markDone({ envelope: yield* Runtime.envelope('task.mark_done', {}), taskId: task.taskId }))
        yield* nothingLeft(task.taskId)
        assert.isTrue(marked.every((pid) => !alive(pid)))
        assert.isTrue(Option.isNone(yield* (yield* Sessions).running(task.threadId)))
      }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime())))),
    60_000,
  )

  it.live(
    'abandoned, leaves none of it running, though its server outlived its lead',
    () =>
      Effect.gen(function* () {
        const { task, marked } = yield* started('Try the cache [lead:serve-apart] [lead:finish]', { quick: true })
        yield* (yield* Tasks).abandon({ envelope: yield* Runtime.envelope('task.abandon', {}), taskId: task.taskId })
        yield* nothingLeft(task.taskId)
        assert.isTrue(marked.every((pid) => !alive(pid)))
      }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime())))),
    60_000,
  )
})

describe.skipIf(windows)('what settled tasks left running that Althar lost track of', () => {
  it.live(
    'goes once Althar looks after it starts again, and nothing else does',
    () => {
      const database = join(mkdtempSync(join(tmpdir(), 'althar-left-')), 'althar.sqlite')
      const others = { unknown: loner('task:task_nobody_knows'), unmarked: loner(null) }
      const open: Array<number> = []
      return Effect.gen(function* () {
        // Started, with a server left, and Althar quits: its lead stops with it, and the server, in a group of its own, doesn't.
        const { task, other } = yield* Effect.gen(function* () {
          const one = yield* started('Serve it [lead:serve-apart] [lead:finish]', { quick: true })
          const two = yield* started('Serve that [lead:serve-apart] [lead:finish]', { quick: true })
          return { task: one.task, other: two.task }
        }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime(database)))))
        const outlived = yield* until(markedFor(task.taskId), (pids) => pids.length >= 1, Duration.seconds(10))
        assert.isTrue(outlived.every(alive))
        const stillOpen = yield* markedFor(other.taskId)
        assert.isNotEmpty(stillOpen)
        open.push(...stillOpen)
        // Althar starts again, the task settled as an Althar that stopped nothing settled it.
        yield* Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          yield* sql`UPDATE tasks SET state = 'done', settled_at = ${new Date().toISOString()} WHERE id = ${task.taskId}`
          // And a project removed, whose run of its default branch was left.
          const removed = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
          yield* sql`UPDATE projects SET archived_at = ${new Date().toISOString()} WHERE id = ${removed.projectId}`
          const run = loner(`run:${removed.projectId}`)
          open.push(run)
          yield* nothingLeft(task.taskId, Duration.seconds(20))
          assert.isTrue(outlived.every((pid) => !alive(pid)))
          yield* until(
            Effect.sync(() => (alive(run) ? [] : [run])),
            (gone) => gone.length === 1,
            Duration.seconds(10),
          )
          // An open task's, another Althar's and one no Althar started run on.
          assert.isTrue(stillOpen.every(alive))
          assert.isTrue(alive(others.unknown))
          assert.isTrue(alive(others.unmarked))
        }).pipe(Effect.provide(runtime(database, {}, { leftFirst: Duration.millis(500), leftEvery: Duration.seconds(1) })))
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            for (const pid of [others.unknown, others.unmarked, ...open]) if (alive(pid)) process.kill(pid, 'SIGKILL')
          }),
        ),
      )
    },
    90_000,
  )
})
