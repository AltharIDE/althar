import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'

import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, fakeConnectors, HOST, hosted, items, runtime, until } from './support'

/*
 * A lead's helpers (ADR-087, as "a task is a conversation plus parts" amends
 * it): handed one of the task's changes, a helper works in its worktree in
 * the background, on a session of its own, and its last message comes back
 * to the lead as a new turn; the lead's report waits for it, and a helper
 * ships, asks and starts nothing.
 */

const runtimeWith = (github: FakeService) =>
  Queries.layer.pipe(
    Layer.provideMerge(runtime(':memory:', {}, { connectors: fakeConnectors({ github }), listenEvery: Duration.hours(1) })),
  )

const git = (cwd: string, ...args: Array<string>) => execFileSync('git', args, { cwd }).toString().trim()

const cards = (projectId: string) =>
  Effect.gen(function* () {
    const snapshot = yield* Effect.orDie((yield* Queries).coordinator(projectId))
    return snapshot.items.flatMap((item) => (item.kind === 'task' ? [item.content] : []))
  })

const opened = (working: string) =>
  Effect.gen(function* () {
    const connections = yield* Connections
    const instance = yield* Instance
    yield* connections.connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
    const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
    const coordinator = yield* Coordinator
    const threadId = yield* coordinator.thread(project.projectId)
    const body = 'Add a retry. [coordinator:plan] [coordinator:plan-no-review] [lead:finish] [lead:edit]'
    yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
    const [ready] = yield* until(cards(project.projectId), (all) => all[0]?.phase === 'ready' && all[0].change !== null)
    const card = ready ?? assert.fail('no card')
    yield* until(
      Effect.flatMap(Sessions, (sessions) => sessions.busy(card.threadId)),
      (busy) => !busy,
    )
    const sql = yield* SqlClient.SqlClient
    const [lead] = yield* sql<{ id: string }>`
      SELECT id FROM provider_sessions WHERE thread_id = ${card.threadId} ORDER BY started_at DESC LIMIT 1`
    const [workspace] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${card.taskId}`
    const access: ToolAccess = {
      role: 'lead',
      projectId: project.projectId,
      threadId: card.threadId,
      sessionId: lead?.id ?? '',
      taskId: card.taskId,
    }
    return { projectId: project.projectId, taskId: card.taskId, threadId: card.threadId, path: workspace?.path ?? '', access }
  })

describe('a lead’s helpers', () => {
  it.live('work on a change in the background, in its worktree, and their result comes to the lead as a new turn', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* opened(working)
      const before = git(task.path, 'rev-parse', 'HEAD')
      const said = yield* callTool(task.access, 'start_helper', {
        name: 'Note the retry',
        brief: 'Write a note on how the retry works, and commit it. [lead:commit]',
      })
      assert.match(said, /^Started "Note the retry" on .+, in the worktree of the task’s change\. Its result comes to you as a new turn/)
      // The thread says what started, where.
      assert.isTrue(
        (yield* items(task.threadId)).some(
          (item) => item.kind === 'notice' && String(item.content.title).startsWith('Helper · Note the retry'),
        ),
      )
      // Its result: kept, its session ended, and queued to the lead as news, which it reads as a new turn.
      const [done] = yield* until(
        sql<{ state: string; result: string | null; threadId: string; id: string }>`
          SELECT state, result, thread_id, id FROM helpers WHERE task_id = ${task.taskId}`,
        (rows) => rows[0]?.state === 'done',
      )
      assert.isNotNull(done?.result ?? null)
      const told = yield* until(
        sql<{ body: string }>`
          SELECT body FROM user_inputs WHERE thread_id = ${task.threadId} AND body LIKE 'Helper "Note the retry"%'`,
        (rows) => rows.length === 1,
      )
      assert.include(told[0]?.body ?? '', "What it said, which is its own and not the person's:")
      assert.isTrue(existsSync(`${task.path}/.althar/scratch/helpers/${done?.id ?? ''}.md`))
      // Its commits are on the change's branch: nothing needs bringing back.
      yield* until(
        Effect.sync(() => git(task.path, 'rev-parse', 'HEAD')),
        (now) => now !== before,
      )
      // A helper ships, asks and starts nothing.
      const helper: ToolAccess = { ...task.access, threadId: done?.threadId ?? '', sessionId: 'none' }
      assert.include(yield* callTool(helper, 'start_helper', { name: 'Again', brief: 'More.' }), 'You are a helper')
      assert.include(yield* callTool(helper, 'push_to_pull_request', {}), 'You are a helper')
    }).pipe(Effect.provide(runtimeWith(github)))
  })

  it.live('keep the lead’s report waiting while one is at work, and stop on its word', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const task = yield* opened(working)
      // One at work, as its session would have it.
      const [run] = yield* sql<{ executionId: string }>`
        SELECT e.id AS execution_id FROM runs r JOIN workflow_executions e ON e.run_id = r.id WHERE r.task_id = ${task.taskId} LIMIT 1`
      const at = new Date().toISOString()
      yield* sql`INSERT INTO threads ${sql.insert({ id: 'th_helper0000000000000000000000000000', projectId: task.projectId, kind: 'step', taskId: task.taskId, executionId: run?.executionId ?? '', nodeKey: 'helper:x', createdAt: at })}`.pipe(
        Effect.catch(() => Effect.void),
      )
      const [threadRow] = yield* sql<{ id: string }>`SELECT id FROM threads WHERE node_key = 'helper:x'`
      yield* sql`INSERT INTO helpers ${sql.insert({ id: 'hlp_x', taskId: task.taskId, projectId: task.projectId, threadId: threadRow?.id ?? 'none', name: 'Split it', brief: 'Split.', agentId: 'claude-code', state: 'working', startedAt: at })}`
      assert.include(yield* callTool(task.access, 'finish_step', { summary: 'Done.' }), 'Your helpers are still at work: "Split it"')
      // Stopped by its lead: nothing of it comes back.
      assert.include(yield* callTool(task.access, 'stop_helper', { helper: 'Split it' }), 'Stopped "Split it"')
      const [stopped] = yield* sql<{ state: string }>`SELECT state FROM helpers WHERE id = 'hlp_x'`
      assert.strictEqual(stopped?.state, 'stopped')
    }).pipe(Effect.provide(runtimeWith(github)))
  })
})
