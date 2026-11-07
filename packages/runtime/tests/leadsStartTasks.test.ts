import { Ids, newId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { LEAD_STARTS } from '../src/Coordinator'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { timestamp } from '../src/records'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, items, notices, repository, runtime } from './support'

/*
 * A task's lead starts tasks of its own (ADR-097): it drafts one and plans
 * it, or starts a quick one, as the coordinator does. The task records the
 * lead's as its parent: its card says it was started by it, and the lead's
 * thread has a line linking to it. What a lead starts waits the plan's
 * countdown, so the person can hold it, and a lead starts only so many.
 */

const withQueries = () => Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', {}, { countdown: Duration.minutes(10) })))

/** A prototype task under way, its lead in a turn the person's message started: what a lead calls with. */
const prototype = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const projects = yield* Projects
  const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
  // Its lead is the session below: no agent of its own is started for it.
  const created = yield* projects.createTask({
    envelope: yield* Runtime.envelope('task.create', { title: 'Prototype the browser' }),
    projectId: project.projectId,
    title: 'Prototype the browser',
    description: 'Prototype it.',
  })
  const sessionId = yield* newId(Ids.providerSession)
  yield* sql`INSERT INTO provider_sessions ${sql.insert({ id: sessionId, projectId: project.projectId, threadId: created.threadId, agentId: 'codex', state: 'active', startedAt: yield* timestamp })}`
  const lead: ToolAccess = {
    role: 'lead',
    projectId: project.projectId,
    threadId: created.threadId,
    sessionId,
    taskId: created.taskId,
  }
  /** A new turn of the lead's, on a message of the person's. */
  const turn = (body: string) =>
    Effect.gen(function* () {
      yield* sql`UPDATE turn_deliveries SET state = 'completed', ended_at = ${yield* timestamp}
        WHERE thread_id = ${created.threadId} AND provider_session_id = ${sessionId} AND state = 'delivered'`
      const accepted = yield* (yield* Sessions).send({
        envelope: yield* Runtime.envelope('thread.send', {}),
        threadId: created.threadId,
        body,
        sender: { kind: 'window' },
        origin: 'system',
      })
      const turnId = yield* newId(Ids.turnDelivery)
      yield* sql`INSERT INTO turn_deliveries ${sql.insert({ id: turnId, projectId: project.projectId, threadId: created.threadId, providerSessionId: sessionId, controllerGeneration: 1, state: 'delivered', origin: 'person', requestedAt: yield* timestamp, deliveredAt: yield* timestamp })}`
      yield* sql`INSERT INTO turn_delivery_inputs ${sql.insert({ projectId: project.projectId, deliveryId: turnId, userInputId: accepted.inputId, position: 1 })}`
      return { ...lead, turnId }
    })
  return { projectId: project.projectId, task: created, lead, turn }
})

/** A task of the project by its title: its id, slug, parent and plan. */
const taskTitled = (projectId: string, title: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [task] = yield* sql<{ id: string; slug: string; threadId: string; parentTaskId: string | null; state: string; counting: number }>`
      SELECT k.id, k.slug, (SELECT t.id FROM threads t WHERE t.task_id = k.id) AS thread_id, k.parent_task_id, k.state,
        EXISTS (SELECT 1 FROM task_plans p WHERE p.task_id = k.id AND p.state = 'proposed' AND p.starts_at IS NOT NULL) AS counting
      FROM tasks k WHERE k.project_id = ${projectId} AND k.title = ${title}`
    return task
  })

describe('a lead starting tasks', () => {
  it.live('drafts and plans the real build of its prototype: the new task names its parent, on its card and in the lead’s thread', () =>
    Effect.gen(function* () {
      const p = yield* prototype
      const lead = yield* p.turn('Make this into a change: build direction E for real.')
      assert.match(
        yield* callTool(lead, 'draft_task', { title: 'Built-in browser beside the conversation', description: 'Build direction E.' }),
        /^Drafted built-in-browser-beside-the-conversation\. Now propose its plan/,
      )
      const child = yield* taskTitled(p.projectId, 'Built-in browser beside the conversation')
      assert.strictEqual(child?.parentTaskId, p.task.taskId)

      // The lead's thread has one line linking to it.
      const lines = (yield* items(p.task.threadId)).filter(
        (item) => item.kind === 'notice' && item.content['title'] === 'Started “Built-in browser beside the conversation”',
      )
      assert.lengthOf(lines, 1)
      assert.deepInclude(lines[0]?.content['task'] as object, { taskId: child?.id, slug: child?.slug })
      // And the window reads it with the task, which its title links to.
      const line = yield* Effect.orDie((yield* Queries).thread(p.task.threadId))
      const shown = line.items.find((item) => item.kind === 'notice' && item.content.title.startsWith('Started “Built-in browser'))
      assert.deepInclude(shown?.kind === 'notice' ? shown.content.task : undefined, {
        taskId: child?.id ?? '',
        threadId: child?.threadId ?? '',
        title: 'Built-in browser beside the conversation',
      })

      // Its plan, as the coordinator's, waits the countdown: the person can hold it.
      assert.match(
        yield* callTool(lead, 'propose_plan', { task: child?.slug, lead: { agent: 'claude-code' }, review: { agent: 'codex' } }),
        /^Planned built-in-browser-beside-the-conversation\. It starts in 25 seconds unless the person holds or changes it/,
      )
      assert.strictEqual((yield* taskTitled(p.projectId, 'Built-in browser beside the conversation'))?.counting, 1)

      // Its card says who started it.
      const card = yield* Effect.orDie((yield* Queries).card(child?.id ?? ''))
      assert.deepStrictEqual(card.startedBy, {
        taskId: p.task.taskId,
        slug: (yield* taskTitled(p.projectId, 'Prototype the browser'))?.slug ?? '',
        title: 'Prototype the browser',
        threadId: p.task.threadId,
      })
      // One the person started says nothing of it.
      assert.isUndefined((yield* Effect.orDie((yield* Queries).card(p.task.taskId))).startedBy)

      // Called again, unsure the first worked, it is the same task, with no second line.
      yield* callTool(lead, 'draft_task', { title: 'Built-in browser beside the conversation' })
      assert.lengthOf(
        (yield* notices(p.task.threadId)).filter((notice) => notice['title']?.startsWith('Started “Built-in browser')),
        1,
      )
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('plans only what it drafted, and a quick task it starts waits the countdown', () =>
    Effect.gen(function* () {
      const p = yield* prototype
      const projects = yield* Projects
      const other = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', { title: 'Someone else’s draft' }),
        projectId: p.projectId,
        title: 'Someone else’s draft',
        draft: true,
      })
      const slug = (yield* taskTitled(p.projectId, 'Someone else’s draft'))?.slug ?? ''
      const lead = yield* p.turn('Try the cookie setting quickly.')
      assert.match(
        yield* callTool(lead, 'propose_plan', { task: slug, lead: { agent: 'codex' }, review: null }),
        /isn't a task you drafted: the coordinator or the person plans it/,
      )
      assert.strictEqual((yield* taskTitled(p.projectId, 'Someone else’s draft'))?.state, 'draft')
      assert.isDefined(other)

      assert.match(
        yield* callTool(lead, 'start_task', { title: 'Try the cookie setting', description: 'Look.', lead: { agent: 'codex' } }),
        /^Planned try-the-cookie-setting, started from this task: its lead starts in 25 seconds unless the person holds it/,
      )
      const quick = yield* taskTitled(p.projectId, 'Try the cookie setting')
      assert.deepInclude(quick, { parentTaskId: p.task.taskId, state: 'draft', counting: 1 })
    }).pipe(Effect.provide(withQueries())),
  )

  it.live(`starts at most ${LEAD_STARTS.turn} tasks in a turn and ${LEAD_STARTS.all} in all`, () =>
    Effect.gen(function* () {
      const p = yield* prototype
      const draft = (lead: ToolAccess, n: number) => callTool(lead, 'draft_task', { title: `Follow-up ${n}` })
      let lead = yield* p.turn('Start the follow-ups.')
      for (let n = 1; n <= LEAD_STARTS.turn; n++) assert.match(yield* draft(lead, n), /^Drafted /)
      assert.match(yield* draft(lead, LEAD_STARTS.turn + 1), /You started 3 tasks in this turn, as many as a lead may in one/)
      // A new turn starts more, up to the cap in all.
      let n = LEAD_STARTS.turn + 1
      while (n <= LEAD_STARTS.all) {
        lead = yield* p.turn('And more.')
        for (let k = 0; k < LEAD_STARTS.turn && n <= LEAD_STARTS.all; k++, n++) assert.match(yield* draft(lead, n), /^Drafted /)
      }
      lead = yield* p.turn('One more.')
      assert.match(yield* draft(lead, n), /This task has started 10 tasks, as many as a lead may/)
      // The coordinator isn't capped.
      const sql = yield* SqlClient.SqlClient
      const [{ count } = { count: 0 }] = yield* sql<{ count: number }>`
        SELECT count(*) AS count FROM tasks WHERE parent_task_id = ${p.task.taskId}`
      assert.strictEqual(count, LEAD_STARTS.all)
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('passes a message on to another lead, signed with its task', () =>
    Effect.gen(function* () {
      const p = yield* prototype
      const lead = yield* p.turn('Tell the build what the prototype found.')
      yield* callTool(lead, 'draft_task', { title: 'Build the browser' })
      const child = yield* taskTitled(p.projectId, 'Build the browser')
      assert.match(
        yield* callTool(lead, 'message_lead', { task: child?.slug, message: 'Direction E won.' }),
        /Passed on to build-the-browser|No lead is running on build-the-browser/,
      )
      const sql = yield* SqlClient.SqlClient
      const [input] = yield* sql<{ body: string }>`
        SELECT u.body FROM user_inputs u JOIN threads t ON t.id = u.thread_id WHERE t.task_id = ${child?.id ?? ''} ORDER BY u.sequence DESC LIMIT 1`
      assert.strictEqual(input?.body, 'The lead of “Prototype the browser” passes this on:\n\nDirection E won.')
      assert.match(yield* callTool(lead, 'message_lead', { task: p.task.taskId, message: 'Hi' }), /is your own task/)
    }).pipe(Effect.provide(withQueries())),
  )
})
