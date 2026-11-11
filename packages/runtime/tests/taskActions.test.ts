import { existsSync } from 'node:fs'

import { Ids, newId, type ProjectId } from '@althar/domain'
import type { MessageSender } from '@althar/contracts'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Automations } from '../src/Automations'
import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { fact, timestamp } from '../src/records'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, notices, repository, runtime, turns, until } from './support'

/*
 * The coordinator and the leads stopping, holding, restarting and settling
 * tasks (ADR-086, ADR-097): each acts at once, in any turn, with a line in
 * the caller's thread and the task's, quoting the person where their own
 * message is in the turn. No card asks first any more; what can't be undone
 * (accepting, pushing a default branch) still needs their message.
 */

/** A project with the coordinator's session in the store, and a way to start its turns as the person, news or a socket would. */
const coordinator = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
  const threadId = yield* (yield* Coordinator).thread(project.projectId)
  const sessionId = yield* newId(Ids.providerSession)
  yield* sql`INSERT INTO provider_sessions ${sql.insert({ id: sessionId, projectId: project.projectId, threadId, agentId: 'codex', state: 'active', startedAt: yield* timestamp })}`
  const access: ToolAccess = { role: 'coordinator', projectId: project.projectId, threadId, taskId: null, sessionId }
  /** A live turn with one message in it, from `sender`: the window's and a paired device's are the person's word. */
  const turn = (body: string, sender: MessageSender = { kind: 'window' }) =>
    Effect.gen(function* () {
      const person = sender.kind === 'window' || sender.kind === 'paired_device'
      yield* sql`UPDATE turn_deliveries SET state = 'completed', ended_at = ${yield* timestamp} WHERE thread_id = ${threadId} AND state = 'delivered'`
      const accepted = yield* (yield* Sessions).send({
        envelope: yield* Runtime.envelope('thread.send', {}),
        threadId,
        body,
        sender,
        origin: person ? 'system' : 'news',
      })
      const turnId = yield* newId(Ids.turnDelivery)
      yield* sql`INSERT INTO turn_deliveries ${sql.insert({ id: turnId, projectId: project.projectId, threadId, providerSessionId: sessionId, controllerGeneration: 1, state: 'delivered', origin: person ? 'person' : 'news', requestedAt: yield* timestamp, deliveredAt: yield* timestamp })}`
      yield* sql`INSERT INTO turn_delivery_inputs ${sql.insert({ projectId: project.projectId, deliveryId: turnId, userInputId: accepted.inputId, position: 1 })}`
      // Recorded as a real turn is, so the coordinator's news runs from it.
      yield* fact({
        projectId: project.projectId as ProjectId,
        aggregateType: 'turn_delivery',
        aggregateId: turnId,
        revision: 1,
        type: 'turn_delivery.requested',
        actorId: (yield* Instance).systemId,
      })
    })
  return { projectId: project.projectId as ProjectId, threadId, access, turn }
})

/** A task whose plan the person started, its lead Codex, doing what `description` says; with its slug and thread. */
const started = (projectId: ProjectId, title: string, description: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const plans = yield* Plans
    const instance = yield* Instance
    const created = yield* (yield* Projects).createTask({
      envelope: yield* Runtime.envelope('task.create', { title }),
      projectId,
      title,
      description,
      draft: true,
    })
    const planId = yield* plans.propose({
      projectId,
      taskId: created.taskId,
      steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
      reason: null,
      actorId: instance.personId,
      end: null,
      held: true,
    })
    yield* plans.start(planId, instance.personId)
    const [task] = yield* sql<{ slug: string }>`SELECT slug FROM tasks WHERE id = ${created.taskId}`
    return { ...created, slug: task?.slug ?? '' }
  })

/** The task's state, its latest run's, and whether its plan counts down. */
const standing = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{ state: string; keptAt: string | null; run: string | null; counting: number; held: number }>`
      SELECT k.state, k.kept_at,
        (SELECT state FROM runs WHERE task_id = k.id ORDER BY created_at DESC LIMIT 1) AS run,
        EXISTS (SELECT 1 FROM task_plans WHERE task_id = k.id AND state = 'proposed' AND starts_at IS NOT NULL) AS counting,
        EXISTS (SELECT 1 FROM task_plans WHERE task_id = k.id AND state = 'proposed' AND starts_at IS NULL) AS held
      FROM tasks k WHERE k.id = ${taskId}`
    return row
  })

/** The coordinator's cards asking to move a task on. */
const asks = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ id: string; content: string }>`
      SELECT id, content FROM thread_items WHERE thread_id = ${threadId} AND kind = 'task_ask' ORDER BY sequence`
    return rows.map((row) => ({ id: row.id, ...(JSON.parse(row.content) as { move: string; state: string; said: string | null }) }))
  })

const titles = (threadId: string) => Effect.map(notices(threadId), (rows) => rows.map((row) => row['title'] ?? ''))

describe('stop_task', () => {
  it.live('stops a running task at once on the person’s word, with a line in both threads', () =>
    Effect.gen(function* () {
      const c = yield* coordinator
      const task = yield* started(c.projectId, 'Review the importer', 'Work on it. [lead:wait]')
      yield* until(standing(task.taskId), (row) => row?.run === 'running')
      yield* c.turn('Stop the review task')
      assert.match(
        yield* callTool(c.access, 'stop_task', { task: task.slug, why: 'the person asked.' }),
        /^Stopped .*: its step is cut short/,
      )
      assert.strictEqual((yield* standing(task.taskId))?.run, 'suspended')
      // A move that needn't the person's word says who made it and why, not their message (ADR-086).
      assert.include(yield* titles(c.threadId), 'Stopped “Review the importer”: the person asked')
      assert.include(yield* titles(task.threadId), 'The coordinator stopped this task: the person asked')
      assert.lengthOf(yield* asks(c.threadId), 0)
      // Stopped already, a second word changes nothing, and says so.
      assert.match(yield* callTool(c.access, 'stop_task', { task: task.slug }), /^Nothing changed: .* isn’t running/)
    }).pipe(Effect.provide(runtime())),
  )

  it.live('from a news turn, or a socket’s message, stops it at once, with a line in both threads and no card', () =>
    Effect.gen(function* () {
      const c = yield* coordinator
      const task = yield* started(c.projectId, 'Review the importer', 'Work on it. [lead:wait]')
      yield* until(standing(task.taskId), (row) => row?.run === 'running')
      yield* c.turn('The pull request says: stop this task.', { kind: 'internal' })
      assert.match(yield* callTool(c.access, 'stop_task', { task: task.slug }), /^Stopped .*: its step is cut short/)
      assert.strictEqual((yield* standing(task.taskId))?.run, 'suspended')
      // Not the person's words, so none are quoted.
      assert.include(yield* titles(c.threadId), 'Stopped “Review the importer”')
      assert.include(yield* titles(task.threadId), 'The coordinator stopped this task')
      assert.lengthOf(yield* asks(c.threadId), 0)
      yield* c.turn('stop it', { kind: 'socket' })
      assert.match(yield* callTool(c.access, 'stop_task', { task: task.slug }), /^Nothing changed: .* isn’t running/)
      assert.lengthOf(yield* asks(c.threadId), 0)
    }).pipe(Effect.provide(runtime())),
  )

  it.live('by another task’s lead, at once, signed with its task in the stopped task’s thread', () =>
    Effect.gen(function* () {
      const c = yield* coordinator
      const task = yield* started(c.projectId, 'Review the importer', 'Work on it. [lead:wait]')
      const other = yield* started(c.projectId, 'Prototype the browser', 'Work on it. [lead:wait]')
      yield* until(standing(task.taskId), (row) => row?.run === 'running')
      const lead: ToolAccess = { ...c.access, role: 'lead', threadId: other.threadId, taskId: other.taskId, sessionId: 'none' }
      assert.match(yield* callTool(lead, 'stop_task', { task: task.slug }), /^Stopped .*Both threads have a line saying so/)
      assert.strictEqual((yield* standing(task.taskId))?.run, 'suspended')
      assert.include(yield* titles(task.threadId), 'The lead of “Prototype the browser” stopped this task')
      assert.include(yield* titles(other.threadId), 'Stopped “Review the importer”')
      // Its own task it doesn't stop from inside.
      assert.match(yield* callTool(lead, 'stop_task', { task: other.slug }), /is your own task/)
    }).pipe(Effect.provide(runtime())),
  )

  it.live('with turn, ends only the lead’s turn on the person’s word', () =>
    Effect.gen(function* () {
      const c = yield* coordinator
      const task = yield* started(c.projectId, 'Long look', 'Work on it. [lead:wait]')
      yield* until(turns(task.threadId), (rows) => rows.at(-1)?.state === 'delivered')
      yield* c.turn('Interrupt the long look')
      assert.match(yield* callTool(c.access, 'stop_task', { task: task.slug, turn: true }), /^Stopped the lead’s turn on/)
      yield* until(turns(task.threadId), (rows) => rows.at(-1)?.state !== 'delivered')
      assert.include(yield* titles(task.threadId), 'The coordinator stopped its lead’s turn')
      assert.notInclude((yield* titles(task.threadId)).join('\n'), 'Interrupt the long look')
    }).pipe(Effect.provide(runtime())),
  )
})

describe('hold_task and restart_task', () => {
  it.live('hold a plan counting down and start it, in a news turn as in the person’s', () =>
    Effect.gen(function* () {
      const c = yield* coordinator
      const plans = yield* Plans
      const instance = yield* Instance
      const created = yield* (yield* Projects).createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: c.projectId,
        title: 'Tidy the docs',
        description: 'Do it. [lead:finish]',
        draft: true,
      })
      yield* plans.propose({
        projectId: c.projectId,
        taskId: created.taskId,
        steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
        reason: null,
        actorId: instance.coordinatorId,
        end: null,
      })
      const slug =
        (yield* (yield* SqlClient.SqlClient)<{ slug: string }>`SELECT slug FROM tasks WHERE id = ${created.taskId}`)[0]?.slug ?? ''

      yield* c.turn('a check failed elsewhere', { kind: 'internal' })
      assert.match(yield* callTool(c.access, 'hold_task', { task: slug }), /^Held .*: its plan waits until it is started/)
      assert.deepInclude(yield* standing(created.taskId), { counting: 0, held: 1 })
      assert.include(yield* titles(created.threadId), 'The coordinator held this task’s plan')
      assert.lengthOf(yield* asks(c.threadId), 0)

      yield* c.turn('Hold the docs one')
      assert.match(yield* callTool(c.access, 'hold_task', { task: slug }), /is held already/)

      yield* c.turn('Go ahead with it')
      assert.match(yield* callTool(c.access, 'restart_task', { task: slug }), /^Started /)
      yield* until(standing(created.taskId), (row) => row?.run !== null && row?.run !== undefined)
    }).pipe(Effect.provide(runtime(':memory:', {}, { countdown: Duration.minutes(10) }))),
  )

  it.live('hold a task that waits for a free agent, out of the line, and start it again', () =>
    Effect.gen(function* () {
      const c = yield* coordinator
      const first = yield* started(c.projectId, 'Work on the importer', 'Work on it. [lead:wait]')
      yield* until(standing(first.taskId), (row) => row?.run === 'running')
      const second = yield* started(c.projectId, 'Tidy the docs', 'Do it. [lead:finish]')
      const sql = yield* SqlClient.SqlClient
      const attemptOf = (taskId: string) =>
        sql<{ state: string }>`
          SELECT a.state FROM node_attempts a JOIN nodes n ON n.id = a.node_id JOIN workflow_executions e ON e.id = n.execution_id
          JOIN runs r ON r.id = e.run_id WHERE r.task_id = ${taskId} ORDER BY a.rowid DESC LIMIT 1`
      yield* until(attemptOf(second.taskId), (rows) => rows[0]?.state === 'held')

      yield* c.turn('hold the docs one')
      assert.match(yield* callTool(c.access, 'hold_task', { task: second.slug }), /^Held .*: it is out of the line/)
      assert.deepInclude(yield* standing(second.taskId), { counting: 0, held: 1 })
      assert.strictEqual((yield* attemptOf(second.taskId))[0]?.state, 'cancelled')
      assert.include(yield* titles(second.threadId), 'The coordinator held this task’s plan')
      // Held, it says so, and one at work has no plan to hold.
      assert.match(yield* callTool(c.access, 'hold_task', { task: second.slug }), /is held already/)
      assert.match(yield* callTool(c.access, 'hold_task', { task: first.slug }), /has started: there is no plan to hold/)

      yield* c.turn('go ahead with the docs one')
      assert.match(
        yield* callTool(c.access, 'restart_task', { task: second.slug }),
        /^Started .*: it waits for a place among the agents at work/,
      )
      yield* until(attemptOf(second.taskId), (rows) => rows[0]?.state === 'held')
      assert.deepInclude(yield* standing(second.taskId), { counting: 0, held: 0 })
    }).pipe(Effect.provide(runtime(':memory:', {}, { busy: { machine: { cores: 3, memory: 7 * 1024 ** 3 } } }))),
  )

  it.live('restarts a stopped task from its step, and a discarded one on its worktree', () =>
    Effect.gen(function* () {
      const c = yield* coordinator
      const task = yield* started(c.projectId, 'Retry checkout', 'Work on it. [lead:wait]')
      yield* until(standing(task.taskId), (row) => row?.run === 'running')
      yield* c.turn('stop retry checkout')
      yield* callTool(c.access, 'stop_task', { task: task.slug })
      yield* c.turn('carry on with it')
      assert.match(yield* callTool(c.access, 'restart_task', { task: task.slug }), /carries on from the step it was on/)
      assert.strictEqual((yield* standing(task.taskId))?.run, 'running')
      assert.include(yield* titles(c.threadId), 'Restarted “Retry checkout”')

      yield* c.turn('discard it after all')
      assert.match(yield* callTool(c.access, 'settle_task', { task: task.slug, how: 'discard' }), /its worktree and branch stay/)
      assert.strictEqual((yield* standing(task.taskId))?.state, 'abandoned')
      // Discarded, it is neither discarded nor marked done again, and has no plan to hold.
      assert.match(yield* callTool(c.access, 'settle_task', { task: task.slug, how: 'discard' }), /is discarded already/)
      assert.match(yield* callTool(c.access, 'settle_task', { task: task.slug, how: 'done' }), /is discarded: restart it first/)
      assert.match(yield* callTool(c.access, 'hold_task', { task: task.slug }), /has no plan waiting to start/)
      const sql = yield* SqlClient.SqlClient
      const [folder] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${task.taskId}`
      if (folder !== undefined) assert.isTrue(existsSync(folder.path), 'discarding keeps its worktree')

      yield* c.turn('bring retry checkout back')
      assert.match(yield* callTool(c.access, 'restart_task', { task: task.slug }), /open again/)
      assert.strictEqual((yield* standing(task.taskId))?.state, 'open')
    }).pipe(Effect.provide(runtime())),
  )
})

describe('settle_task', () => {
  /** A quick task, as start_task starts one, once its lead has finished its first turn. */
  const quick = (c: Effect.Success<typeof coordinator>, title: string) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const starter: ToolAccess = { ...c.access, sessionId: 'none' }
      yield* callTool(starter, 'start_task', { title, description: '[lead:finish]', lead: { agent: 'codex' } })
      const [task] = yield* sql<{ taskId: string; threadId: string; slug: string }>`
        SELECT k.id AS task_id, k.slug, t.id AS thread_id FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task'
        WHERE k.project_id = ${c.projectId} AND k.title = ${title}`
      if (task === undefined) return assert.fail('no task')
      yield* until(turns(task.threadId), (rows) => rows.length >= 1 && rows.every((row) => !['pending', 'delivered'].includes(row.state)))
      return task
    })

  it.live('keeps for later and marks done on the person’s word; refuses done for a change', () =>
    Effect.gen(function* () {
      const c = yield* coordinator
      const one = yield* quick(c, 'Which partners still call v1')
      yield* c.turn('keep the partners one for later')
      assert.match(yield* callTool(c.access, 'settle_task', { task: one.slug, how: 'keep' }), /^Kept .* for later/)
      assert.match(yield* callTool(c.access, 'settle_task', { task: one.slug, how: 'keep' }), /is kept for later already/)
      assert.isNotNull((yield* standing(one.taskId))?.keptAt)
      yield* c.turn('that is done, settle it')
      assert.match(yield* callTool(c.access, 'settle_task', { task: one.slug, how: 'done' }), /^Marked .* done/)
      assert.strictEqual((yield* standing(one.taskId))?.state, 'done')
      // Settled, there is nothing more to settle, keep, restart or stop.
      assert.match(yield* callTool(c.access, 'settle_task', { task: one.slug, how: 'done' }), /is done already: it is in Settled/)
      assert.match(yield* callTool(c.access, 'settle_task', { task: one.slug, how: 'keep' }), /is settled already/)
      assert.match(yield* callTool(c.access, 'restart_task', { task: one.slug }), /is settled\. Writing to its lead opens it again/)
      assert.match(yield* callTool(c.access, 'stop_task', { task: one.slug, turn: true }), /lead isn’t in a turn/)
      assert.include(yield* titles(one.threadId), 'The coordinator marked this task done')

      const change = yield* started(c.projectId, 'Change the API', 'Work on it. [lead:wait]')
      assert.match(
        yield* callTool(c.access, 'settle_task', { task: change.slug, how: 'done' }),
        /^Nothing changed: .* is a change: it is done once its pull request merges/,
      )
      assert.match(
        yield* callTool(c.access, 'settle_task', { task: change.slug, how: 'keep' }),
        /is a change: it waits on its pull request/,
      )
      yield* until(standing(change.taskId), (row) => row?.run === 'running')
      assert.match(yield* callTool(c.access, 'hold_task', { task: change.slug }), /has started: there is no plan to hold/)
      assert.match(yield* callTool(c.access, 'restart_task', { task: change.slug }), /isn’t stopped, held or discarded/)
    }).pipe(Effect.provide(runtime())),
  )

  it.live('from a news turn, discards at once and keeps the work', () =>
    Effect.gen(function* () {
      const c = yield* coordinator
      const one = yield* quick(c, 'Sketch the settings')
      yield* c.turn('Its pull request was closed by someone.', { kind: 'internal' })
      assert.match(yield* callTool(c.access, 'settle_task', { task: one.slug, how: 'discard' }), /its worktree and branch stay/)
      assert.strictEqual((yield* standing(one.taskId))?.state, 'abandoned')
      assert.include(yield* titles(one.threadId), 'The coordinator discarded this task')
      assert.lengthOf(yield* asks(c.threadId), 0)
    }).pipe(Effect.provide(runtime())),
  )
})

describe('automations on the person’s word', () => {
  it.live('resume and run now act at once in a turn the person started, and ask on a card otherwise', () =>
    Effect.gen(function* () {
      const c = yield* coordinator
      const automations = yield* Automations
      const instance = yield* Instance
      const id = yield* automations.make({
        projectId: c.projectId,
        definition: {
          name: 'Release notes',
          prompt: 'Write release notes from what merged.',
          schedule: { every: 'week', days: [5], at: '16:00' },
          zone: 'Europe/London',
          lead: { agentId: 'codex', model: null },
          work: { kind: 'task', review: null, end: null },
          allowEverything: true,
          minutes: 45,
          late: 'once',
        },
        on: true,
        actorId: instance.personId,
      })
      yield* automations.pause(id, instance.personId)
      yield* c.turn('news: a run finished', { kind: 'internal' })
      assert.match(yield* callTool(c.access, 'resume_automation', { automation: 'Release notes' }), /on a card/)
      assert.strictEqual((yield* automations.read(id)).state, 'paused')
      yield* c.turn('Resume the release notes')
      assert.match(yield* callTool(c.access, 'resume_automation', { automation: 'Release notes' }), /^Resumed “Release notes”/)
      assert.strictEqual((yield* automations.read(id)).state, 'on')
      assert.include(yield* titles(c.threadId), 'Resumed “Release notes”, as you asked: “Resume the release notes”')
    }).pipe(Effect.provide(runtime())),
  )
})
