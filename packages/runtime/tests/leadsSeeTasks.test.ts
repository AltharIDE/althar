import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, listTools, repository, runtime, toolDescriptions, turns, until } from './support'

/*
 * A lead sees the project's tasks, and is told which others came from the same
 * message of the person's, so it doesn't draft an issue for work that is
 * already under way elsewhere.
 */

const MESSAGE = 'Slide the selection of the segmented control, and fix the Automations screen: an empty state, a pause banner.'

const open = Effect.gen(function* () {
  const projects = yield* Projects
  return yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
})

const made = (projectId: string, title: string, request: string | null) =>
  Effect.gen(function* () {
    const projects = yield* Projects
    const created = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', { title }),
      projectId: projectId as Parameters<typeof projects.createTask>[0]['projectId'],
      title,
      ...(request === null ? {} : { request }),
    })
    return created
  })

/** What the thread's latest session was first told, once another agent took the thread over. */
const takenOver = (threadId: string) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    yield* sessions.switchAgent({ threadId, agentId: 'codex' })
    const [first] = yield* until(turns(threadId), (rows) => rows.length >= 1 && rows[0]?.prompt != null)
    return first?.prompt ?? ''
  })

describe('a task’s lead', () => {
  it.live('is offered find_tasks and list_tasks, and told to check them before it drafts an issue', () =>
    Effect.gen(function* () {
      const { projectId } = yield* open
      const created = yield* made(projectId, 'Automations screen', null)
      const lead: ToolAccess = { role: 'lead', projectId, threadId: created.threadId, sessionId: 'none', taskId: created.taskId }
      assert.includeMembers(yield* listTools(lead), ['find_tasks', 'list_tasks', 'find_issues', 'draft_issue'])
      // Read-only: nothing that plans or starts work is among them, and a reviewer is offered none of these.
      assert.notIncludeMembers(yield* listTools(lead), ['draft_task', 'start_task', 'propose_plan', 'message_lead'])
      assert.notInclude(yield* listTools({ ...lead, role: 'reviewer' }), 'find_tasks')

      const described = yield* toolDescriptions(lead)
      assert.match(described['draft_issue'] ?? '', /outside your brief, check find_tasks: when a task covers it, say so in your report/)
      // The coordinator's own draft_issue says nothing of it.
      const coordinator = yield* toolDescriptions({ ...lead, role: 'coordinator', taskId: null })
      assert.notInclude(coordinator['draft_issue'] ?? '', 'find_tasks')

      // It reads the project's tasks as the coordinator does.
      assert.include(yield* callTool(lead, 'list_tasks'), 'Automations screen')
      assert.include(yield* callTool(lead, 'find_tasks', { text: 'automations' }), 'Automations screen')
    }).pipe(Effect.provide(runtime())),
  )

  it.live('is told, in its brief, of the other tasks planned from the same message, and of none from another', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { projectId } = yield* open
      const automations = yield* made(projectId, 'Automations screen: empty state and pause banner', MESSAGE)
      const control = yield* made(projectId, 'Segmented control: the selection slides between options', MESSAGE)
      const elsewhere = yield* made(projectId, 'Rename the env var', 'Rename the env var.')
      // The same words long ago were another message.
      const earlier = yield* made(projectId, 'Segmented control, an earlier try', MESSAGE)
      yield* sql`UPDATE tasks SET created_at = '2026-01-01T00:00:00.000Z' WHERE id = ${earlier.taskId}`

      const told = yield* takenOver(automations.threadId)
      assert.include(
        told,
        `Also planned from this message, by other tasks: Segmented control: the selection slides between options (${control.slug}).`,
      )
      assert.notInclude(told, 'an earlier try')
      assert.notInclude(told, 'Rename the env var')

      // The other lead hears of the first, as a task planned later is told of the earlier one.
      assert.include(yield* takenOver(control.threadId), `Automations screen: empty state and pause banner (${automations.slug})`)
      // A task alone with its message hears of nothing.
      assert.notInclude(yield* takenOver(elsewhere.threadId), 'Also planned from this message')
    }).pipe(Effect.provide(runtime())),
  )

  it.live('is told to check the project’s tasks before drafting an issue, in its standing instructions', () =>
    Effect.gen(function* () {
      const { projectId } = yield* open
      const created = yield* made(projectId, 'Automations screen', null)
      const told = yield* takenOver(created.threadId)
      assert.include(told, 'check find_tasks (list_tasks lists them all) too: another task may be doing it already')
      assert.include(told, 'When a task covers it, say so in your report instead of drafting.')
    }).pipe(Effect.provide(runtime())),
  )
})
