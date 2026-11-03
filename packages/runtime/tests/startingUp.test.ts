import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ActorId, ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Instance } from '../src/Instance'
import { Launches } from '../src/Launches'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { repository, runtime, until } from './support'

/*
 * A task whose plan has just started is under way, or up next, until its lead
 * is on it: while its plan is accepted and its run not yet made, while its
 * folder is set up (its dependencies installed) before its lead's first turn,
 * and while it waits for a place among the agents at work here. It is never
 * Stopped before an agent has worked on it, and never without a time to say.
 */

const GB = 1024 ** 3

/** The runtime, on a machine that runs `n` at once, with the queries the screens read. */
const machine = (n: number) =>
  Queries.layer.pipe(
    Layer.provideMerge(runtime(':memory:', {}, { busy: { machine: { cores: Math.ceil(n * 2.5), memory: (4 + 3 * n) * GB } } })),
  )

/** A setup that finishes only once the test opens its gate. */
const gated = () => {
  const gate = join(mkdtempSync(join(tmpdir(), 'althar-gate-')), 'open').replaceAll('\\', '/')
  return {
    setup: `node -e "const fs = require('fs'); const t = setInterval(() => fs.existsSync('${gate}') && (clearInterval(t), process.exit(0)), 20)"`,
    open: () => writeFileSync(gate, ''),
  }
}

const person = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const [row] = yield* sql<{ id: string }>`SELECT id FROM actors WHERE kind = 'person'`
  return (row?.id ?? '') as ActorId
})

/** A project whose worktrees are set up by `setup`, where one is given. */
const project = (setup?: string) =>
  Effect.gen(function* () {
    const opened = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
    if (setup !== undefined)
      yield* (yield* Launches).keep({
        projectId: opened.projectId,
        run: { command: 'node serve.js', setup },
        actorId: (yield* Instance).personId,
      })
    return opened.projectId as ProjectId
  })

/** A task drafted with a plan, its lead Codex, that the person has yet to start. */
const planned = (projectId: ProjectId, title: string) =>
  Effect.gen(function* () {
    const created = yield* (yield* Projects).createTask({
      envelope: yield* Runtime.envelope('task.create', { title }),
      projectId,
      title,
      description: `${title}. [lead:wait]`,
      draft: true,
    })
    const planId = yield* (yield* Plans).propose({
      projectId,
      taskId: created.taskId,
      steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
      reason: null,
      actorId: yield* person,
      end: null,
      held: true,
    })
    return { ...created, planId }
  })

/** A task whose plan the person starts now. */
const started = (projectId: ProjectId, title: string) =>
  Effect.gen(function* () {
    const task = yield* planned(projectId, title)
    yield* (yield* Plans).start(task.planId, yield* person)
    return task
  })

const cardOf = (projectId: string, taskId: string) =>
  Effect.gen(function* () {
    const board = yield* Effect.orDie((yield* Queries).board(projectId))
    return board.tasks.find((task) => task.taskId === taskId)
  })

/** Whether each of the task's folders has been set up, and how. */
const setUps = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ setup: string | null }>`SELECT setup FROM workspaces WHERE task_id = ${taskId}`
  })

/** How many turns its lead has had. */
const turnsOf = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{ n: number }>`SELECT count(*) AS n FROM turn_deliveries WHERE thread_id = ${threadId}`
    return row?.n ?? 0
  })

describe('a task not yet started', () => {
  it.live('is under way once its plan is accepted, before its run is made: not Stopped, and no time it never had', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const projectId = yield* project()
      const task = yield* planned(projectId, 'Local merge: as strict as git, a short error, tidy paths')
      yield* until(setUps(task.taskId), (rows) => rows.every((row) => row.setup !== null))
      // As the board read it the moment its plan was accepted: no run, no session, no turn yet.
      yield* sql`UPDATE task_plans SET state = 'accepted', starts_at = NULL WHERE id = ${task.planId}`
      yield* sql`UPDATE tasks SET state = 'open' WHERE id = ${task.taskId}`
      const card = yield* cardOf(projectId, task.taskId)
      assert.strictEqual(card?.phase, 'running')
      assert.isUndefined(card?.stopped)
    }).pipe(Effect.provide(machine(4))),
  )

  it.live('is under way while its folder is set up before its lead’s first turn, and says so', () =>
    Effect.gen(function* () {
      const gate = gated()
      const projectId = yield* project(gate.setup)
      const task = yield* started(projectId, 'Local merge')
      // Its folder's setup still runs, and its lead's first turn waits for it.
      assert.isNull((yield* setUps(task.taskId))[0]?.setup)
      assert.strictEqual(yield* turnsOf(task.threadId), 0)
      const card = yield* cardOf(projectId, task.taskId)
      assert.strictEqual(card?.phase, 'running')
      assert.isUndefined(card?.stopped)
      assert.strictEqual(card?.settingUp, 'kept')
      // Set up, its lead has its first turn, and the card no longer says it sets up.
      gate.open()
      yield* until(turnsOf(task.threadId), (n) => n > 0)
      const after = yield* cardOf(projectId, task.taskId)
      assert.strictEqual(after?.phase, 'running')
      assert.isUndefined(after?.settingUp)
    }).pipe(Effect.provide(machine(4))),
  )

  it.live('is up next while every place is taken and its folder is set up, never Stopped', () =>
    Effect.gen(function* () {
      const gate = gated()
      const projectId = yield* project(gate.setup)
      const first = yield* started(projectId, 'First')
      const second = yield* started(projectId, 'Local merge')
      const card = yield* cardOf(projectId, second.taskId)
      assert.strictEqual(card?.phase, 'running')
      assert.isNotNull(card?.queued)
      assert.isUndefined(card?.stopped)
      // The first's lead, waiting on its folder's setup, is under way too.
      const working = yield* cardOf(projectId, first.taskId)
      assert.strictEqual(working?.phase, 'running')
      assert.isUndefined(working?.stopped)
      gate.open()
    }).pipe(Effect.provide(machine(1))),
  )

  it.live('whose folder’s setup failed is under way all the same, its lead told why, not Stopped', () =>
    Effect.gen(function* () {
      const projectId = yield* project(`node -e "console.error('npm ERR! missing: left-pad'); process.exit(3)"`)
      const task = yield* started(projectId, 'Local merge')
      yield* until(turnsOf(task.threadId), (n) => n > 0)
      const card = yield* cardOf(projectId, task.taskId)
      assert.strictEqual(card?.phase, 'running')
      assert.isUndefined(card?.stopped)
      assert.isUndefined(card?.settingUp)
    }).pipe(Effect.provide(machine(4))),
  )
})
