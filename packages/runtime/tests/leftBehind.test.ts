import { budget } from '@althar/testing'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ActorId, ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer, Option } from 'effect'
import { SqlClient } from 'effect/sql'
import { TestClock } from 'effect/testing'

import { makeFakeService } from '@althar/connectors/testing'
import { holds } from '@althar/provider-adapters/testing'

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
import { fakeConnectors, HOST, hosted, onTestClock, repository, runtime, until } from './support'

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
  // Started by a shell that exits at once, so launchd is its parent, as for what outlived an Althar that quit.
  const pid = execFileSync('/bin/sh', ['-c', `"${process.execPath}" -e "setInterval(() => {}, 1000)" >/dev/null 2>&1 & echo $!`], {
    env: work === null ? env : { ...env, [WORK]: work },
  })
  return Number(pid.toString().trim())
}

/** A command that runs until stopped, as a run of the project. */
const SERVE = `"${process.execPath}" -e "setInterval(() => {}, 1000)"`

/**
 * A plan for the task, on the lead run as a process, started now: a quick one, or one that opens a draft pull request; with a
 * run of its own, unless `run` is false.
 */
const started = (title: string, more: { readonly root?: string; readonly quick?: boolean; readonly run?: boolean } = {}) =>
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
    )
    const running = yield* (yield* Sessions).running(task.threadId)
    assert.isTrue(Option.isSome(running) && running.value.background.some((left) => left.ended === null))
    // And a run of its own, from its worktree.
    if (more.run !== false) {
      const launches = yield* Launches
      yield* launches.keep({ projectId: project.projectId, run: { command: SERVE, setup: null }, actorId: instance.personId })
      yield* launches.start({ projectId: project.projectId, taskId: task.taskId, threadId: task.threadId })
    }
    // Its lead, the server it left and its run, each found by its mark.
    const marked = yield* until(markedFor(task.taskId), (pids) => pids.length >= (more.run === false ? 2 : 3))
    return { project, task, marked }
  })

/**
 * Waits until none of `pids` runs. One that was stopped loses its mark at once,
 * but answers to its pid until its parent has reaped it.
 */
const stopped = (pids: ReadonlyArray<number>) =>
  until(
    Effect.sync(() => pids.filter(alive)),
    (left) => left.length === 0,
  )

/** Waits until nothing on this computer carries the task's mark, and says how long that took. */
const nothingLeft = (taskId: string) =>
  Effect.gen(function* () {
    const from = Date.now()
    yield* until(markedFor(taskId), (pids) => pids.length === 0)
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

describe.skipIf(windows)('a command an agent left running', () => {
  it.live('stopped by the person, leaves nothing it started running, though its server is in its shell’s group, not its tree', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const { task } = yield* started('Serve it [lead:serve-apart] [lead:finish]', { quick: true, run: false })
      const running = yield* sessions.running(task.threadId)
      assert.isTrue(Option.isSome(running))
      if (Option.isNone(running)) return
      const lead = running.value.pid
      const server = (yield* markedFor(task.taskId)).filter((pid) => pid !== lead)
      assert.isNotEmpty(server)
      const left = running.value.background.find((one) => one.ended === null)
      assert.isDefined(left)
      yield* sessions.stopBackground(task.threadId, left?.id ?? '')
      // Its lead runs on, and only its lead.
      yield* until(markedFor(task.taskId), (pids) => pids.length === 1 && pids[0] === lead)
      yield* stopped(server)
    }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime())))),
  )

  it.live('goes with everything it started when its agent stops', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const { task, marked } = yield* started('Serve it [lead:serve-apart] [lead:finish]', { quick: true, run: false })
      yield* sessions.stop(task.threadId)
      yield* nothingLeft(task.taskId)
      yield* stopped(marked)
    }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime())))),
  )
})

describe.skipIf(windows)('a task that settles', () => {
  it.live('merged on its host, leaves no agent, server or run of it running, and keeps no place', () => {
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
      yield* stopped(marked)
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
  })

  it.live('marked done, leaves none of it running', () =>
    Effect.gen(function* () {
      const { task, marked } = yield* started('Sketch the page [lead:serve-apart] [lead:finish]', { quick: true })
      assert.isTrue(yield* (yield* Tasks).markDone({ envelope: yield* Runtime.envelope('task.mark_done', {}), taskId: task.taskId }))
      yield* nothingLeft(task.taskId)
      yield* stopped(marked)
      assert.isTrue(Option.isNone(yield* (yield* Sessions).running(task.threadId)))
    }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime())))),
  )

  it.live('abandoned, leaves none of it running, though its server outlived its lead', () =>
    Effect.gen(function* () {
      const { task, marked } = yield* started('Try the cache [lead:serve-apart] [lead:finish]', { quick: true })
      yield* (yield* Tasks).abandon({ envelope: yield* Runtime.envelope('task.abandon', {}), taskId: task.taskId })
      yield* nothingLeft(task.taskId)
      yield* stopped(marked)
    }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime())))),
  )
})

describe.skipIf(windows)('a task opened again before settling has stopped it', () => {
  it.live('keeps its lead and the run started since', () => {
    const lead = holds()
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const sessions = yield* Sessions
      const launches = yield* Launches
      const { project, task } = yield* started('Sketch the page [lead:serve-apart] [lead:finish]', { quick: true })
      // Asked something that takes it a while, until the test lets it go on: its turn runs as the task settles, so settling waits for it.
      const body = 'And the footer? [lead:slowly]'
      yield* sessions.send({
        envelope: yield* Runtime.envelope('thread.send', { threadId: task.threadId, body }),
        threadId: task.threadId,
        body,
      })
      const turn = (running: boolean) =>
        until(
          Effect.map(sessions.running(task.threadId), (one) => (Option.exists(one, (on) => on.turnRunning === running) ? [one] : [])),
          (seen) => seen.length === 1,
        )
      yield* turn(true)
      assert.isTrue(yield* (yield* Tasks).markDone({ envelope: yield* Runtime.envelope('task.mark_done', {}), taskId: task.taskId }))
      yield* Effect.sleep(Duration.seconds(1))
      // Opened again once settling waits on that turn, as by a round the person's words open, and run again.
      yield* sql`UPDATE tasks SET state = 'open', settled_at = NULL WHERE id = ${task.taskId}`
      const again = yield* launches.start({ projectId: project.projectId, taskId: task.taskId, threadId: task.threadId })
      // Its turn ended, and settling had its go: its lead and its new run go on.
      lead.open('[lead:slowly]')
      yield* turn(false)
      yield* Effect.sleep(Duration.seconds(5))
      assert.isTrue(Option.isSome(yield* sessions.running(task.threadId)))
      const runs = yield* launches.ofProject(project.projectId)
      assert.deepStrictEqual(
        runs.map((run) => [run.id, run.ended]),
        [[again.id, null]],
      )
      yield* sessions.stop(task.threadId)
      yield* launches.stopAll(project.projectId)
    }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', { holds: lead })))))
  })
})

describe.skipIf(windows)('what settled tasks left running that Althar lost track of', () => {
  it.effect(
    'goes once Althar looks after it starts again, and nothing else does',
    () => {
      const database = join(mkdtempSync(join(tmpdir(), 'althar-left-')), 'althar.sqlite')
      const others = { unknown: loner('task:task_nobody_knows'), unmarked: loner(null) }
      const open: Array<number> = []
      return Effect.gen(function* () {
        // Started, with a server left, and Althar quits: its leads stop with it, and so do the servers they left.
        const { task, other } = yield* Effect.gen(function* () {
          const one = yield* started('Serve it [lead:serve-apart] [lead:finish]', { quick: true })
          const two = yield* started('Serve that [lead:serve-apart] [lead:finish]', { quick: true })
          return { task: one.task, other: two.task }
        }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime(database)))))
        yield* nothingLeft(task.taskId)
        yield* nothingLeft(other.taskId)
        // What an Althar that was killed, or one from before, left of each, outside every tree.
        const outlived = [loner(`task:${task.taskId}`)]
        const stillOpen = [loner(`task:${other.taskId}`)]
        open.push(...outlived, ...stillOpen)
        // Althar starts again, the task settled as an Althar that stopped nothing settled it.
        yield* Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          yield* sql`UPDATE tasks SET state = 'done', settled_at = ${new Date().toISOString()} WHERE id = ${task.taskId}`
          // And a project removed, whose run of its default branch was left.
          const removed = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
          yield* sql`UPDATE projects SET archived_at = ${new Date().toISOString()} WHERE id = ${removed.projectId}`
          const run = loner(`run:${removed.projectId}`)
          open.push(run)
          // Its first look, an hour in, comes now: after all of that, never before it.
          yield* TestClock.adjust(Duration.hours(1))
          yield* nothingLeft(task.taskId)
          // Its mark disappears as it exits, just before Linux has finished reaping the process.
          yield* stopped(outlived)
          yield* until(
            Effect.sync(() => (alive(run) ? [] : [run])),
            (gone) => gone.length === 1,
          )
          // An open task's, another Althar's and one no Althar started run on.
          assert.isTrue(stillOpen.every(alive))
          assert.isTrue(alive(others.unknown))
          assert.isTrue(alive(others.unmarked))
        }).pipe(Effect.provide(runtime(database)))
      }).pipe(
        onTestClock,
        Effect.ensuring(
          Effect.sync(() => {
            for (const pid of [others.unknown, others.unmarked, ...open]) if (alive(pid)) process.kill(pid, 'SIGKILL')
          }),
        ),
      )
    },
    budget.large,
  )
})
