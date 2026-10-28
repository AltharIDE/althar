import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Coordinator } from '../src/Coordinator'
import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { siblingsOf } from '../src/siblings'
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
  const coordinator = yield* Coordinator
  const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
  return { projectId: project.projectId, coordinatorThreadId: yield* coordinator.thread(project.projectId) }
})

/** One turn of the project's coordinator, on a message of the person's: the delivery, once the coordinator has answered it. */
const turn = (threadId: string, body: string) =>
  Effect.gen(function* () {
    const coordinator = yield* Coordinator
    const before = (yield* turns(threadId)).length
    yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
    const done = yield* until(turns(threadId), (rows) => rows.length > before && rows.every((row) => row.state === 'completed'))
    const latest = done.at(-1)
    return { id: latest?.id ?? '', sessionId: latest?.providerSessionId ?? '' }
  })

/** A task the coordinator drafts in that turn, while it is running: it ends once the drafting is done, as it would. */
const draftedIn = (delivery: { id: string; sessionId: string }, projectId: string, title: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [thread] = yield* sql<{ id: string }>`SELECT thread_id AS id FROM turn_deliveries WHERE id = ${delivery.id}`
    yield* sql`UPDATE turn_deliveries SET ended_at = NULL WHERE id = ${delivery.id}`
    const access: ToolAccess = { role: 'coordinator', projectId, threadId: thread?.id ?? '', sessionId: delivery.sessionId, taskId: null }
    const said = yield* callTool(access, 'draft_task', { title })
    yield* sql`UPDATE turn_deliveries SET ended_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ${delivery.id}`
    const slug = /Drafted ([^\s,.]+)/.exec(said)?.[1] ?? ''
    const [task] = yield* sql<{ taskId: string; threadId: string }>`
      SELECT k.id AS task_id, t.id AS thread_id FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task' WHERE k.slug = ${slug}`
    return { slug, taskId: task?.taskId ?? '', threadId: task?.threadId ?? '' }
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

  it.live('is told, in its brief, of the tasks planned from the same coordinator turn, and of none from another', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { projectId, coordinatorThreadId } = yield* open
      // The person says the same words twice, in two turns: the second is a message of its own.
      const first = yield* turn(coordinatorThreadId, MESSAGE)
      const automations = yield* draftedIn(first, projectId, 'Automations screen: empty state and pause banner')
      const control = yield* draftedIn(first, projectId, 'Segmented control: the selection slides between options')
      const second = yield* turn(coordinatorThreadId, MESSAGE)
      const again = yield* draftedIn(second, projectId, 'Segmented control, once more')
      const elsewhere = yield* made(projectId, 'Rename the env var', 'Rename the env var.')

      const told = yield* takenOver(automations.threadId)
      assert.include(
        told,
        `Also planned from this message, by other tasks: Segmented control: the selection slides between options (${control.slug}).`,
      )
      assert.notInclude(told, 'once more')
      assert.notInclude(told, 'Rename the env var')

      // The other lead hears of the first, and the later turn's of neither.
      assert.include(yield* takenOver(control.threadId), `Automations screen: empty state and pause banner (${automations.slug})`)
      assert.notInclude(yield* takenOver(again.threadId), 'Also planned from this message')
      // A task alone with its message hears of nothing.
      assert.notInclude(yield* takenOver(elsewhere.threadId), 'Also planned from this message')

      // A turn that runs for hours is one message still: its tasks are siblings however far apart they were made.
      yield* sql`UPDATE turn_deliveries SET requested_at = '2030-01-01T00:00:00.000Z', ended_at = '2030-01-01T03:00:00.000Z' WHERE id = ${first.id}`
      yield* sql`UPDATE tasks SET created_at = '2030-01-01T00:30:00.000Z' WHERE id = ${automations.taskId}`
      yield* sql`UPDATE tasks SET created_at = '2030-01-01T02:30:00.000Z' WHERE id = ${control.taskId}`
      assert.deepStrictEqual(
        (yield* siblingsOf(automations.taskId)).map((other) => other.slug),
        [control.slug],
      )
    }).pipe(Effect.provide(runtime())),
  )

  it.live('tells a lead that has started of a task planned from its message afterwards, once', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { projectId, coordinatorThreadId } = yield* open
      const first = yield* turn(coordinatorThreadId, MESSAGE)
      // The turn is running still: its first task is started, its lead briefed, before the second is drafted.
      yield* sql`UPDATE turn_deliveries SET ended_at = NULL WHERE id = ${first.id}`
      const automations = yield* made(projectId, 'Automations screen: empty state and pause banner', MESSAGE)
      const notStarted = yield* made(projectId, 'Not started yet', MESSAGE)
      yield* takenOver(automations.threadId)

      const coordinator: ToolAccess = {
        role: 'coordinator',
        projectId,
        threadId: coordinatorThreadId,
        sessionId: first.sessionId,
        taskId: null,
      }
      const title = 'Segmented control: the selection slides between options'
      yield* callTool(coordinator, 'draft_task', { title })
      yield* callTool(coordinator, 'draft_task', { title })

      const heard = (threadId: string) =>
        sql<{ body: string }>`SELECT body FROM user_inputs WHERE thread_id = ${threadId} AND body LIKE '%since you started%'`
      const [told, ...more] = yield* heard(automations.threadId)
      assert.lengthOf(more, 0)
      assert.include(
        told?.body,
        'Also planned from this message, since you started, by other tasks: Segmented control: the selection slides',
      )
      assert.match(told?.body ?? '', /\(segmented-control-[a-z-]+\)/)
      // A lead that has had no brief yet gets it in its opening brief, not as a message too.
      assert.lengthOf(yield* heard(notStarted.threadId), 0)
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
