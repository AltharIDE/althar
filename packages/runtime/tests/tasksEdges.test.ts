import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { Tasks } from '../src/Tasks'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, repository, runtime, until } from './support'

/*
 * The person's task actions at their edges, where tasks.test.ts and
 * kinds.test.ts don't go: leaving out work while a run may still add to it,
 * reopening a quick task abandoned before it started, and marking a quick
 * task done once the server its lead left running has gone by itself.
 */

describe('leaving out what a task’s pull requests don’t have', () => {
  it.live('does nothing while its run is under way, which may still add to it', () =>
    Effect.gen(function* () {
      const tasks = yield* Tasks
      const plans = yield* Plans
      const instance = yield* Instance
      const projects = yield* Projects
      const sql = yield* SqlClient.SqlClient
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const created = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: project.projectId,
        title: 'Still at it',
        description: 'Work on it. [lead:wait]',
        draft: true,
      })
      const planId = yield* plans.propose({
        projectId: project.projectId as ProjectId,
        taskId: created.taskId,
        steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
        reason: null,
        actorId: instance.personId,
        held: true,
      })
      yield* plans.start(planId, instance.personId)
      yield* until(sql<{ state: string }>`SELECT state FROM node_attempts`, (rows) => rows[0]?.state === 'running')
      const before = yield* sql<{ type: string }>`SELECT type FROM record_events ORDER BY sequence`
      yield* tasks.leaveOut({ envelope: yield* Runtime.envelope('task.leave_out', {}), taskId: created.taskId })
      const [row] = yield* sql<{ state: string }>`SELECT state FROM tasks WHERE id = ${created.taskId}`
      assert.strictEqual(row?.state, 'open')
      const [run] = yield* sql<{ state: string }>`SELECT state FROM runs WHERE task_id = ${created.taskId}`
      assert.strictEqual(run?.state, 'running')
      const after = yield* sql<{ type: string }>`SELECT type FROM record_events ORDER BY sequence`
      const since = after.slice(before.length).map((event) => event.type)
      assert.notInclude(since, 'task.left_out')
      assert.notInclude(since, 'task.abandoned')
    }).pipe(Effect.provide(runtime())),
  )
})

describe('reopening a quick task abandoned before it started', () => {
  it.live('brings its plan back held, still one that stays on this computer', () =>
    Effect.gen(function* () {
      const tasks = yield* Tasks
      const plans = yield* Plans
      const instance = yield* Instance
      const projects = yield* Projects
      const sql = yield* SqlClient.SqlClient
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const created = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: project.projectId,
        title: 'Try the cache',
        draft: true,
      })
      yield* plans.propose({
        projectId: project.projectId as ProjectId,
        taskId: created.taskId,
        steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
        reason: 'Quick to start.',
        actorId: instance.personId,
        end: null,
        here: true,
        held: true,
      })
      yield* tasks.abandon({ envelope: yield* Runtime.envelope('task.abandon', {}), taskId: created.taskId })
      yield* tasks.reopen({ envelope: yield* Runtime.envelope('task.reopen', {}), taskId: created.taskId })
      const [row] = yield* sql<{ state: string }>`SELECT state FROM tasks WHERE id = ${created.taskId}`
      assert.strictEqual(row?.state, 'draft')
      const [plan] = yield* sql<{ state: string; parameters: string }>`
        SELECT state, parameters FROM task_plans WHERE task_id = ${created.taskId} ORDER BY proposed_at DESC, rowid DESC LIMIT 1`
      assert.strictEqual(plan?.state, 'proposed')
      assert.deepInclude(JSON.parse(plan?.parameters ?? '{}'), { here: true, reason: 'Quick to start.' })
    }).pipe(Effect.provide(runtime())),
  )
})

describe('marking a quick task done', () => {
  it.live('stops nothing that its lead left running and that has gone by itself since', () => {
    const stopped: Array<string> = []
    return Effect.gen(function* () {
      const sessions = yield* Sessions
      const tasks = yield* Tasks
      const sql = yield* SqlClient.SqlClient
      const projects = yield* Projects
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const threadId = yield* (yield* Coordinator).thread(project.projectId)
      const access: ToolAccess = { role: 'coordinator', projectId: project.projectId, threadId, sessionId: 'none', taskId: null }
      const title = 'Sketch the settings page'
      assert.match(
        yield* callTool(access, 'start_task', {
          title,
          description: 'Serve it. [lead:serve] [lead:serve-exits] [lead:finish]',
          lead: { agent: 'codex' },
        }),
        /^Started /,
      )
      const [served] = yield* sql<{ taskId: string; threadId: string }>`
        SELECT k.id AS task_id, t.id AS thread_id FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task'
        WHERE k.title = ${title}`
      // Its server fails on its own, a moment after the lead's turn.
      yield* until(
        Effect.map(sessions.running(served?.threadId ?? ''), (session) =>
          Option.match(session, { onNone: () => [], onSome: (one) => one.background.filter((left) => left.ended !== null) }),
        ),
        (gone) => gone.length === 1,
      )
      yield* until(
        Effect.map(Effect.orDie((yield* Queries).card(served?.taskId ?? '')), (card) => (card?.phase === 'ready' ? [card] : [])),
        (ready) => ready.length === 1,
      )
      assert.isTrue(yield* tasks.markDone({ envelope: yield* Runtime.envelope('task.mark_done', {}), taskId: served?.taskId ?? '' }))
      assert.deepStrictEqual(stopped, [])
      const [row] = yield* sql<{ state: string }>`SELECT state FROM tasks WHERE id = ${served?.taskId ?? ''}`
      assert.strictEqual(row?.state, 'done')
    }).pipe(
      Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', { stoppedBackground: (id) => void stopped.push(id) })))),
    )
  })
})
