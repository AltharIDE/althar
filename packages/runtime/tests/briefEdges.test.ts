import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Coordinator } from '../src/Coordinator'
import { DICTATED, Sessions } from '../src/Sessions'
import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { addItem } from '../src/threads'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, repository, runtime, task, turns, until } from './support'

/*
 * What an agent is told as it takes a thread over, where sessions.test.ts
 * doesn't go: a quick task whose work is on its branch already, a thread too
 * long to tell whole, what the person dictated with a switch, and a
 * coordinator whose project is a folder of a larger repository.
 */

const open = (path: string) =>
  Effect.gen(function* () {
    const projects = yield* Projects
    return yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path })
  })

/** The first turn of the thread's latest session: what its agent was told. */
const toldLast = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [told] = yield* until(
      sql<{ prompt: string | null }>`
        SELECT d.prompt FROM turn_deliveries d
        WHERE d.provider_session_id = (SELECT id FROM provider_sessions WHERE thread_id = ${threadId} ORDER BY started_at DESC, rowid DESC LIMIT 1)
        ORDER BY d.requested_at, d.rowid LIMIT 1`,
      (rows) => rows.length === 1 && rows[0]?.prompt != null,
    )
    return told?.prompt ?? ''
  })

describe('an agent taking a thread over', () => {
  it.live(
    "on a quick task whose lead changed the repository, is told its work is on that branch, and by whom it's taken over from nobody",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const sessions = yield* Sessions
        const { projectId } = yield* open(repository())
        const threadId = yield* (yield* Coordinator).thread(projectId)
        // The coordinator starts it at once, and its lead writes in the repository.
        const access: ToolAccess = { role: 'coordinator', projectId, threadId, sessionId: 'none', taskId: null }
        yield* callTool(access, 'start_task', {
          title: 'Try the slider',
          description: 'Sketch it in the repository. [lead:write]',
          lead: { agent: 'codex', model: 'small' },
        })
        const [created] = yield* until(
          sql<{ taskId: string; threadId: string; branch: string }>`
          SELECT k.id AS task_id, t.id AS thread_id, w.branch FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task'
          JOIN workspaces w ON w.task_id = k.id WHERE k.title = 'Try the slider'`,
          (rows) => rows.length === 1,
        )
        if (created === undefined) return yield* Effect.die(new Error('No task'))
        // Its turn over, what it wrote put the task's work on a branch of its own.
        yield* until(
          sql<{ branched: string | null }>`SELECT branched_at AS branched FROM workspaces WHERE task_id = ${created.taskId}`,
          (rows) => rows[0]?.branched != null,
        )
        yield* sessions.stop(created.threadId)
        yield* sessions.switchAgent({ threadId: created.threadId, agentId: 'claude-code' })
        const told = yield* toldLast(created.threadId)
        assert.include(told, 'You are taking over a task, in the same worktree. Its record so far is below.')
        assert.include(
          told,
          `Writing in the repository is fine: its work is on a branch of its own, ${created.branch}, which stays on this computer. Commit there as on any task.`,
        )
      }).pipe(Effect.provide(runtime())),
  )

  it.live('is told only the latest of a thread too long to tell whole, and says how many items it left out', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const { project, task: created } = yield* task('Long talk')
      for (let n = 0; n < 30; n += 1)
        yield* addItem({ projectId: project.projectId as ProjectId, threadId: created.threadId }, 'agent_message', {
          text: `Step ${n}: ${'checked the checkout again. '.repeat(120)}`,
        })
      yield* sessions.switchAgent({ threadId: created.threadId, agentId: 'codex' })
      assert.match(yield* toldLast(created.threadId), /The thread so far, oldest first \(the \d+ earliest items are left out\):/)
    }).pipe(Effect.provide(runtime())),
  )

  it.live('hears what the person dictated with the switch as dictated, in its first turn', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const { task: created } = yield* task('Dictated')
      const body = 'Carry on with the alter retry.'
      yield* sessions.switchAgent({
        threadId: created.threadId,
        agentId: 'codex',
        message: { envelope: yield* Runtime.envelope('thread.send', { body }), body, dictated: true },
      })
      const [first] = yield* until(turns(created.threadId), (rows) => rows.length >= 1 && rows[0]?.prompt != null)
      assert.include(first?.prompt ?? '', `${body}\n\n${DICTATED}`)
    }).pipe(Effect.provide(runtime())),
  )
})

describe("the coordinator's brief", () => {
  it.live('names the folder of its repository the project is about, and where the rest of the repository is', () =>
    Effect.gen(function* () {
      const root = repository()
      mkdirSync(join(root, 'apps', 'web'), { recursive: true })
      writeFileSync(join(root, 'apps', 'web', 'index.html'), '<h1>Meridian</h1>\n')
      const git = (...args: Array<string>) =>
        execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@althar.test', ...args], { cwd: root })
      git('add', '.')
      git('commit', '-q', '-m', 'Web')
      const { projectId } = yield* open(join(root, 'apps', 'web'))
      const coordinator = yield* Coordinator
      const threadId = yield* coordinator.thread(projectId)
      const body = 'What is in the web app?'
      yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
      assert.match(
        yield* toldLast(threadId),
        /- [^\n]+, its folder apps\/web: [^\n]+ \(main\)\. That folder is what the project is about; the rest of the repository is in [^\n]+\./,
      )
    }).pipe(Effect.provide(runtime())),
  )
})
