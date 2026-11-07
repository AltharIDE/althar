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
        title: 'This task is a change now: with no review, it ends on its branch.',
      })
      assert.isUndefined(said?.description)
    }).pipe(Effect.provide(runtime())),
  )
})

describe('the buttons on a task’s lead, as tools', () => {
  it.live('change its lead, try it again, compact it and set its issue part, from the coordinator or another lead', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const projects = yield* Projects
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const threadId = yield* (yield* Coordinator).thread(project.projectId)
      const coordinator: ToolAccess = { role: 'coordinator', projectId: project.projectId, threadId, sessionId: 'none', taskId: null }
      const quick = (title: string) =>
        Effect.gen(function* () {
          yield* callTool(coordinator, 'start_task', { title, description: '[lead:finish]', lead: { agent: 'codex' } })
          const [task] = yield* sql<{ taskId: string; threadId: string; slug: string }>`
            SELECT k.id AS task_id, k.slug, t.id AS thread_id FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task'
            WHERE k.project_id = ${project.projectId} AND k.title = ${title}`
          if (task === undefined) return assert.fail('no task')
          yield* until(
            turns(task.threadId),
            (rows) => rows.length >= 1 && rows.every((row) => !['pending', 'delivered'].includes(row.state)),
          )
          return task
        })
      const one = yield* quick('Sketch the settings')
      const other = yield* quick('Read the logs')
      const lead: ToolAccess = {
        role: 'lead',
        projectId: project.projectId,
        threadId: other.threadId,
        sessionId: 'none',
        taskId: other.taskId,
      }
      const titles = (thread: string) => Effect.map(notices(thread), (rows) => rows.map((row) => row.title ?? ''))

      // As the model picker and Hand over: a session of the new agent, said in both threads with why.
      assert.match(
        yield* callTool(coordinator, 'change_lead', {
          task: one.slug,
          lead: { agent: 'claude-code' },
          message: 'Carry on from the sketch.',
          why: 'codex is out',
        }),
        /^sketch-the-settings's lead is claude-code now, briefed with its thread so far/,
      )
      assert.include(yield* titles(one.threadId), 'The coordinator put claude-code on this task: codex is out')
      assert.match(
        yield* callTool(lead, 'change_lead', { task: other.slug, lead: { agent: 'codex' } }),
        /is your own task: the person changes who leads it/,
      )
      assert.match(
        yield* callTool(coordinator, 'change_lead', { task: one.slug, lead: { agent: 'nobody' } }),
        /^Althar has no agent nobody/,
      )

      // Try again: only a turn that failed.
      assert.strictEqual(
        yield* callTool(coordinator, 'try_again', { task: one.slug }),
        "Nothing changed: sketch-the-settings's lead's last turn didn't fail.",
      )

      // Compact, from another task's lead, signed with its task.
      assert.match(yield* callTool(lead, 'compact_lead', { task: one.slug, why: 'its context is full' }), /lead compacts its context/)
      assert.include(yield* titles(one.threadId), 'The lead of “Read the logs” had its lead compact its context: its context is full')
      assert.include(yield* titles(other.threadId), 'Compacted the context of “Sketch the settings”: its context is full')

      // Its issue's switch: refused for a task that came from none, set and set back for one that did.
      assert.strictEqual(
        yield* callTool(coordinator, 'set_part_of_issue', { task: one.slug, part_of: true }),
        "sketch-the-settings didn't come from an issue: there is nothing to set.",
      )
      const at = new Date().toISOString()
      yield* sql`INSERT INTO external_links ${sql.insert({
        id: 'xlink_a5500000000000000000000000000001',
        projectId: project.projectId,
        taskId: one.taskId,
        connectionId: null,
        product: 'linear',
        kind: 'issue',
        externalId: 'MER-231',
        ref: 'MER-231',
        key: 'MER-231',
        url: 'https://linear.app/meridian/issue/MER-231',
        snapshot: '{}',
        createdAt: at,
        updatedAt: at,
      })}`
      assert.match(
        yield* callTool(coordinator, 'set_part_of_issue', { task: one.slug, part_of: true }),
        /^sketch-the-settings does only part of its issue now: .*leaves it open/,
      )
      assert.match(
        yield* callTool(lead, 'set_part_of_issue', { task: one.slug, part_of: false }),
        /does all of its issue now: .*closes the issue/,
      )
      assert.include(yield* titles(one.threadId), 'The lead of “Read the logs” set this task as one that does all of its issue')
    }).pipe(Effect.provide(runtime())),
  )
})
