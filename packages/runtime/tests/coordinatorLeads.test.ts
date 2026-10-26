import { rmSync } from 'node:fs'

import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Coordinator } from '../src/Coordinator'
import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, notices, repository, runtime, turns, until } from './support'

/*
 * The coordinator's and a lead's tools on a task's lead and its worktree:
 * a lead whose agent Althar doesn't list, as one gone from the registry
 * since, named by its id; and a quick task made a change once its worktree
 * has gone, with no branch to say its work is on.
 */

describe('the coordinator’s list_tasks', () => {
  it.live('names a lead whose agent Althar doesn’t list by its id', () =>
    Effect.gen(function* () {
      const projects = yield* Projects
      const sessions = yield* Sessions
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const task = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: project.projectId,
        title: 'Retry the checkout',
      })
      // An agent the registry no longer lists, run as a process of its own.
      yield* sessions.start({ threadId: task.threadId, agentId: 'process' })
      yield* until(turns(task.threadId), (rows) => rows.length >= 1 && rows.every((row) => !['pending', 'delivered'].includes(row.state)))
      const threadId = yield* (yield* Coordinator).thread(project.projectId)
      const coordinator: ToolAccess = { role: 'coordinator', projectId: project.projectId, threadId, sessionId: 'none', taskId: null }
      assert.include(yield* callTool(coordinator, 'list_tasks', {}), 'led by process')
    }).pipe(Effect.provide(runtime())),
  )
})

describe('a quick task’s lead making it a change', () => {
  it.live('makes it one with no branch to name once its worktree has gone', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const projects = yield* Projects
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const threadId = yield* (yield* Coordinator).thread(project.projectId)
      const coordinator: ToolAccess = { role: 'coordinator', projectId: project.projectId, threadId, sessionId: 'none', taskId: null }
      assert.match(
        yield* callTool(coordinator, 'start_task', {
          title: 'Sketch the settings',
          description: '[lead:finish]',
          lead: { agent: 'codex' },
        }),
        /^Started /,
      )
      const [task] = yield* sql<{ taskId: string; threadId: string; path: string }>`
        SELECT k.id AS task_id, t.id AS thread_id, w.path FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task'
        JOIN workspaces w ON w.task_id = k.id WHERE k.project_id = ${project.projectId}`
      yield* until(
        turns(task?.threadId ?? ''),
        (rows) => rows.length >= 1 && rows.every((row) => !['pending', 'delivered'].includes(row.state)),
      )
      // Its agent stopped first, as Windows won't remove the folder a process works in, and tried again while what ended
      // there still holds it a moment.
      yield* (yield* Sessions).stop(task?.threadId ?? '')
      rmSync(task?.path ?? '', { recursive: true, force: true, maxRetries: 5 })
      const lead: ToolAccess = {
        role: 'lead',
        projectId: project.projectId,
        threadId: task?.threadId ?? '',
        sessionId: 'none',
        taskId: task?.taskId ?? '',
      }
      assert.match(
        yield* callTool(lead, 'make_it_a_change', { title: 'Sketch the settings', review: null, output: 'draft' }),
        /^The task is a change now, called “Sketch the settings”/,
      )
      const said = (yield* notices(task?.threadId ?? '')).find((notice) => notice.title?.startsWith('This task is a change now') === true)
      assert.deepInclude(said, {
        title: 'This task is a change now: with no review, it ends on its branch, as its repository isn’t on a code host Althar knows.',
      })
      assert.isUndefined(said?.description)
    }).pipe(Effect.provide(runtime())),
  )
})
