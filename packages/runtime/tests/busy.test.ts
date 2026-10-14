import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ActorId, ProjectId } from '@althar/domain'
import { scenarios } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { Busy, inOrder } from '../src/Busy'
import type { BusyOptions } from '../src/Config'
import { touchTask } from '../src/cards'
import { Coordinator } from '../src/Coordinator'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Runs } from '../src/Runs'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { Tasks } from '../src/Tasks'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, repository, runtime, until } from './support'

/*
 * How many tasks are at work at once on this machine (Busy.ts, ADR-032,
 * ADR-037). A task keeps its place from its first step until its work comes
 * back, through its steps and while it waits on the person. With every place
 * taken, the next task's first step doesn't start: it waits, held in the
 * store, and its card says why; it starts on its own when a place frees,
 * after a restart too, what the person did first. The person can stop it
 * while it waits, and a number they set takes effect at once.
 */

const GB = 1024 ** 3

/** A machine whose cores and memory give `n` at once by default: 2.5 cores and 3 GB each, and 4 GB kept. */
const runsAtOnce = (n: number) => ({ busy: { machine: { cores: Math.ceil(n * 2.5), memory: (4 + 3 * n) * GB } } })

/** The runtime, on a machine that runs `n` at once, with the queries the screens read. */
const machine = (n: number, database = ':memory:', busy: BusyOptions = {}) =>
  Queries.layer.pipe(Layer.provideMerge(runtime(database, {}, { busy: { ...runsAtOnce(n).busy, ...busy } })))

/** What a card says it waits for, without who holds the places. */
const countsOf = (queued: { readonly busy: number; readonly atOnce: number } | null | undefined) =>
  queued == null ? queued : { busy: queued.busy, atOnce: queued.atOnce }

const store = () => join(mkdtempSync(join(tmpdir(), 'althar-busy-')), 'althar.sqlite')

const opened = Effect.gen(function* () {
  const projects = yield* Projects
  const coordinator = yield* Coordinator
  const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
  return { projectId: project.projectId as ProjectId, threadId: yield* coordinator.thread(project.projectId) }
})

const person = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const [row] = yield* sql<{ id: string }>`SELECT id FROM actors WHERE kind = 'person'`
  return (row?.id ?? '') as ActorId
})

/** A task whose plan, its lead Codex unless said, with no review, the person starts now: whether its lead is on it, or it waits. */
const started = (projectId: ProjectId, title: string, description: string, agentId = 'codex') =>
  Effect.gen(function* () {
    const projects = yield* Projects
    const plans = yield* Plans
    const created = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', { title }),
      projectId,
      title,
      description,
      draft: true,
    })
    const actor = yield* person
    const planId = yield* plans.propose({
      projectId,
      taskId: created.taskId,
      steps: [{ key: 'implement', agentId, model: null, skipped: false }],
      reason: null,
      actorId: actor,
      end: null,
      held: true,
    })
    return { ...created, planId, outcome: yield* plans.start(planId, actor) }
  })

/** The task's step attempts, oldest first: which step, where each stands, and why one is held. */
const attempts = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ step: string; state: string; holdReason: string | null }>`
      SELECT n.node_key AS step, a.state, a.hold_reason FROM node_attempts a JOIN nodes n ON n.id = a.node_id
      JOIN workflow_executions e ON e.id = n.execution_id JOIN runs r ON r.id = e.run_id
      WHERE r.task_id = ${taskId} ORDER BY a.admitted_at, a.rowid`
  })

/** The agents that ran on the task's thread, oldest first. */
const sessionsOn = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ agentId: string; state: string }>`
      SELECT agent_id, state FROM provider_sessions WHERE thread_id = ${threadId} ORDER BY started_at, rowid`
  })

/** The turns on a thread, oldest first, as they stand. */
const turnsOn = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ state: string }>`SELECT state FROM turn_deliveries WHERE thread_id = ${threadId} ORDER BY requested_at, rowid`
  })

/** The task's card on its project's board. */
const cardOf = (projectId: string, taskId: string) =>
  Effect.gen(function* () {
    const queries = yield* Queries
    const board = yield* Effect.orDie(queries.board(projectId))
    return board.tasks.find((task) => task.taskId === taskId)
  })

/** What the home says of the task. */
const onHome = (taskId: string) =>
  Effect.gen(function* () {
    const queries = yield* Queries
    const home = yield* Effect.orDie(queries.home())
    return home.tasks.find((task) => task.taskId === taskId)
  })

const say = (threadId: string, body: string, disposition: 'after_current' | 'interrupt_and_continue' = 'interrupt_and_continue') =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    yield* sessions.send({ envelope: yield* Runtime.envelope('thread.send', { threadId, body }), threadId, body, disposition })
  })

/** A task whose plan, its lead Claude Code and its reviewer Codex, the person starts now. */
const reviewed = (projectId: ProjectId, title: string, description: string) =>
  Effect.gen(function* () {
    const projects = yield* Projects
    const plans = yield* Plans
    const created = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', { title }),
      projectId,
      title,
      description,
      draft: true,
    })
    const actor = yield* person
    const planId = yield* plans.propose({
      projectId,
      taskId: created.taskId,
      steps: [
        { key: 'implement', agentId: 'claude-code', model: null, skipped: false },
        { key: 'review', agentId: 'codex', model: null, skipped: false },
      ],
      reason: null,
      actorId: actor,
      end: null,
      held: true,
    })
    return { ...created, outcome: yield* plans.start(planId, actor) }
  })

/** What the agents on the thread said, in order. */
const replies = (threadId: string) =>
  Effect.gen(function* () {
    const queries = yield* Queries
    const snapshot = yield* Effect.orDie(queries.thread(threadId))
    return snapshot.items.flatMap((item) => (item.kind === 'agent_message' ? [String(item.content.text)] : []))
  })

/** The question the thread's agent asked, once it has. */
const askedOn = (threadId: string) =>
  Effect.map(
    until(
      Effect.flatMap(
        SqlClient.SqlClient,
        (sql) => sql<{ id: string; state: string; payload: string }>`
        SELECT id, state, payload FROM attention_requests WHERE kind = 'question' AND json_extract(payload, '$.threadId') = ${threadId}`,
      ),
      (rows) => rows.length === 1,
    ),
    (rows) => rows[0]?.id ?? '',
  )

/** Where the question stands, and whether its answer waits for a place. */
const questionOf = (attentionId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{ state: string; waits: string | null }>`
      SELECT state, json_extract(payload, '$.waitsForPlace') AS waits FROM attention_requests WHERE id = ${attentionId}`
    return { state: row?.state, kept: row?.waits != null }
  })

/** The person answers the question, as the window does. */
const answerIt = (attentionId: string) =>
  Effect.gen(function* () {
    const runs = yield* Runs
    yield* runs.answer({
      envelope: yield* Runtime.envelope('attention.answer_question', { attentionId }),
      attentionId,
      answers: { database: { values: ['sqlite'] } },
    })
  })

/** A lead at work on its step, asking the person something between turns: its first turn interrupted, then asked. */
const asking = (threadId: string) =>
  Effect.gen(function* () {
    yield* until(turnsOn(threadId), (rows) => rows.some((row) => row.state === 'delivered'))
    yield* (yield* Sessions).interrupt(threadId)
    yield* until(turnsOn(threadId), (rows) => rows.every((row) => row.state !== 'delivered'))
    yield* say(threadId, scenarios.question, 'after_current')
    return yield* askedOn(threadId)
  })

/** Waits until the thread's agent is on, between turns. */
const idle = (threadId: string) =>
  Effect.flatMap(Sessions, (sessions) =>
    until(
      Effect.map(sessions.running(threadId), (live) => (Option.isSome(live) && !live.value.turnRunning ? [true] : [])),
      (rows) => rows.length === 1,
    ),
  )

/** Since when a turn on the thread waits for a place, as the thread keeps it; null where none waits. */
const waitsOn = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{ since: string | null }>`SELECT waits_for_place AS since FROM threads WHERE id = ${threadId}`
    return row?.since ?? null
  })

/** Waits until the task's card says a follow-up for its lead waits for a place. */
const followUpOn = (projectId: string, taskId: string) =>
  until(
    Effect.map(cardOf(projectId, taskId), (card) => (card?.followUpWaits === undefined ? [] : [card.followUpWaits])),
    (rows) => rows.length === 1,
  )

/** Waits until the task's first step is running on its lead. */
const working = (taskId: string) => until(attempts(taskId), (rows) => rows.at(-1)?.state === 'running')

/** Waits until the task's latest step waits for a place. */
const waiting = (taskId: string) =>
  until(attempts(taskId), (rows) => rows.at(-1)?.state === 'held' && rows.at(-1)?.holdReason === 'machine_busy')

describe('Tasks at once', () => {
  it.live('start what fits, and the next plan waits, saying why, until a place frees; then it starts on its own', () =>
    Effect.gen(function* () {
      const { projectId } = yield* opened
      const first = yield* started(projectId, 'First', 'Work on it. [lead:wait]')
      const second = yield* started(projectId, 'Second', 'Work on it. [lead:wait]')
      assert.strictEqual(first.outcome, 'running')
      assert.strictEqual(second.outcome, 'running')
      yield* working(first.taskId)
      yield* working(second.taskId)

      const third = yield* started(projectId, 'Third', 'Do it. [lead:finish]')
      assert.strictEqual(third.outcome, 'waiting')
      assert.deepStrictEqual(yield* attempts(third.taskId), [{ step: 'implement', state: 'held', holdReason: 'machine_busy' }])
      // No agent starts on it, and its card says what it waits for: under way, not stopped, and not held for a usage limit.
      assert.deepStrictEqual(yield* sessionsOn(third.threadId), [])
      const card = yield* cardOf(projectId, third.taskId)
      assert.strictEqual(card?.phase, 'running')
      assert.strictEqual(card?.step, 'implement')
      assert.deepStrictEqual(countsOf(card?.queued), { busy: 2, atOnce: 2 })
      // It names the tasks that hold the places.
      assert.deepStrictEqual(
        card?.queued?.holders?.map((holder) => [holder.title, holder.threadId]),
        [
          ['First', first.threadId],
          ['Second', second.threadId],
        ],
      )
      assert.isNull(card?.waits)
      assert.deepStrictEqual(countsOf((yield* onHome(third.taskId))?.queued), { busy: 2, atOnce: 2 })
      assert.isNull((yield* cardOf(projectId, first.taskId))?.queued)

      // The first is told to finish: once it has, the third starts by itself, and finishes too.
      yield* say(first.threadId, '[lead:finish]')
      yield* until(attempts(third.taskId), (rows) => rows[0]?.state === 'succeeded')
      assert.deepStrictEqual(
        (yield* sessionsOn(third.threadId)).map((session) => session.agentId),
        ['codex'],
      )
      const done = yield* until(
        Effect.map(cardOf(projectId, third.taskId), (card) => (card === undefined ? [] : [card])),
        (cards) => cards[0]?.phase === 'ready',
      )
      assert.isNull(done[0]?.queued)
      // The second worked on all along.
      assert.strictEqual((yield* attempts(second.taskId))[0]?.state, 'running')
    }).pipe(Effect.provide(machine(2))),
  )

  it.live('start the oldest that waits first', () =>
    Effect.gen(function* () {
      const { projectId } = yield* opened
      const first = yield* started(projectId, 'First', 'Work on it. [lead:wait]')
      yield* working(first.taskId)
      const second = yield* started(projectId, 'Second', 'Work on it. [lead:wait]')
      const third = yield* started(projectId, 'Third', 'Work on it. [lead:wait]')
      yield* waiting(second.taskId)
      yield* waiting(third.taskId)
      const tasks = yield* Tasks
      yield* tasks.stop({ envelope: yield* Runtime.envelope('task.stop', {}), taskId: first.taskId })
      yield* working(second.taskId)
      // One place: the third waits on behind the second.
      assert.deepStrictEqual((yield* attempts(third.taskId)).at(-1), { step: 'implement', state: 'held', holdReason: 'machine_busy' })
      assert.deepStrictEqual(countsOf((yield* cardOf(projectId, third.taskId))?.queued), { busy: 1, atOnce: 1 })
    }).pipe(Effect.provide(machine(1))),
  )

  it.live('leave a quick task the coordinator starts waiting, and say so to the coordinator', () =>
    Effect.gen(function* () {
      const { projectId, threadId } = yield* opened
      const first = yield* started(projectId, 'First', 'Work on it. [lead:wait]')
      yield* working(first.taskId)
      const access: ToolAccess = { role: 'coordinator', projectId, threadId, sessionId: 'none', taskId: null }
      const said = yield* callTool(access, 'start_task', {
        title: 'Try the double jump',
        description: 'Jump twice and say whether it lands. [lead:finish]',
        lead: { agent: 'codex' },
      })
      assert.match(
        said,
        /^Started try-the-double-jump, but it waits for a free place: 1 of the 1 tasks this computer runs at once are at work\./,
      )
      const sql = yield* SqlClient.SqlClient
      const [quick] = yield* sql<{ id: string }>`SELECT id FROM tasks WHERE slug = 'try-the-double-jump'`
      const taskId = quick?.id ?? ''
      yield* waiting(taskId)
      assert.deepStrictEqual(countsOf((yield* cardOf(projectId, taskId))?.queued), { busy: 1, atOnce: 1 })
      // A place frees when the first is stopped: the quick task starts, and finishes.
      const tasks = yield* Tasks
      yield* tasks.stop({ envelope: yield* Runtime.envelope('task.stop', {}), taskId: first.taskId })
      yield* until(attempts(taskId), (rows) => rows[0]?.state === 'succeeded')
    }).pipe(Effect.provide(machine(1))),
  )

  it.live('can be stopped while it waits, and resumed, when it waits again for a place', () =>
    Effect.gen(function* () {
      const { projectId } = yield* opened
      const tasks = yield* Tasks
      const first = yield* started(projectId, 'First', 'Work on it. [lead:wait]')
      yield* working(first.taskId)
      const second = yield* started(projectId, 'Second', 'Do it. [lead:finish]')
      yield* waiting(second.taskId)
      assert.include(yield* tasksActions(second.threadId), 'stop')

      // Stopped, it no longer waits: it is the person's to resume, and no place starts it.
      yield* tasks.stop({ envelope: yield* Runtime.envelope('task.stop', {}), taskId: second.taskId })
      assert.deepStrictEqual(
        (yield* attempts(second.taskId)).map((row) => row.state),
        ['cancelled'],
      )
      const stopped = yield* cardOf(projectId, second.taskId)
      assert.strictEqual(stopped?.phase, 'stopped')
      assert.isNull(stopped?.queued)

      // Resumed while the first still works, it waits for a place again.
      yield* tasks.resume({ envelope: yield* Runtime.envelope('task.resume', {}), taskId: second.taskId })
      yield* waiting(second.taskId)
      assert.deepStrictEqual(countsOf((yield* cardOf(projectId, second.taskId))?.queued), { busy: 1, atOnce: 1 })
      assert.deepStrictEqual(yield* sessionsOn(second.threadId), [])

      // The first is stopped: the second carries on, on its lead, and finishes.
      yield* tasks.stop({ envelope: yield* Runtime.envelope('task.stop', {}), taskId: first.taskId })
      yield* until(attempts(second.taskId), (rows) => rows.at(-1)?.state === 'succeeded')
      assert.deepStrictEqual(
        (yield* sessionsOn(second.threadId)).map((session) => session.agentId),
        ['codex'],
      )
      // Stopping the first left nothing of it running, and nothing it held waiting.
      assert.deepStrictEqual(
        (yield* attempts(first.taskId)).map((row) => row.state),
        ['cancelled'],
      )
    }).pipe(Effect.provide(machine(1))),
  )

  it.live('take a number the person sets at once: more at once starts what waits, without a restart', () =>
    Effect.gen(function* () {
      const busy = yield* Busy
      const { projectId } = yield* opened
      assert.deepStrictEqual(yield* busy.atOnce, {
        count: 1,
        own: null,
        machine: { count: 1, cores: 3, memory: 7, byCores: 1, byMemory: 1 },
      })
      const first = yield* started(projectId, 'First', 'Work on it. [lead:wait]')
      yield* working(first.taskId)
      const second = yield* started(projectId, 'Second', 'Work on it. [lead:wait]')
      yield* waiting(second.taskId)
      yield* busy.set(2)
      yield* working(second.taskId)
      assert.deepStrictEqual(countsOf(yield* busy.now), { busy: 2, atOnce: 2 })
      // Fewer again leaves what works at work: the next waits until it is below the number.
      yield* busy.set(1)
      const third = yield* started(projectId, 'Third', 'Work on it. [lead:wait]')
      yield* waiting(third.taskId)
      assert.deepStrictEqual(countsOf((yield* cardOf(projectId, third.taskId))?.queued), { busy: 2, atOnce: 1 })
      yield* busy.set(null)
      assert.strictEqual((yield* busy.atOnce).count, 1)
    }).pipe(Effect.provide(machine(1))),
  )

  it.live('keep a task’s place while its lead waits on the person’s answer, and tell the answer at once', () =>
    Effect.gen(function* () {
      const { projectId } = yield* opened
      const tasks = yield* Tasks
      const first = yield* started(projectId, 'First', 'Work on it. [lead:wait]')
      yield* working(first.taskId)
      const question = yield* asking(first.threadId)
      // Its lead waits on the person: the task keeps its place, and the second waits for one.
      const second = yield* started(projectId, 'Second', 'Do it. [lead:finish]')
      assert.strictEqual(second.outcome, 'waiting')
      yield* waiting(second.taskId)
      assert.deepStrictEqual(
        (yield* cardOf(projectId, second.taskId))?.queued?.holders?.map((holder) => holder.title),
        ['First'],
      )
      // Answered, its lead is told at once, in the place its task kept; nothing of the answer waits.
      yield* answerIt(question)
      assert.include(
        yield* until(replies(first.threadId), (said) => said.some((text) => text.startsWith('answer='))),
        'answer={"database":"sqlite"}',
      )
      assert.deepStrictEqual(yield* questionOf(question), { state: 'answered', kept: false })
      assert.isNull((yield* cardOf(projectId, first.taskId))?.queued)
      yield* waiting(second.taskId)
      // Once the first stops, the second starts, and finishes.
      yield* tasks.stop({ envelope: yield* Runtime.envelope('task.stop', {}), taskId: first.taskId })
      yield* until(attempts(second.taskId), (rows) => rows[0]?.state === 'succeeded')
    }).pipe(Effect.provide(machine(1))),
  )

  it.live('start a review in its task’s place, whatever its lead left running, while the next task waits on', () =>
    Effect.gen(function* () {
      const { projectId } = yield* opened
      const tasks = yield* Tasks
      const task = yield* reviewed(projectId, 'Served', 'Serve it, then finish. [lead:serve] [lead:finish] [review:wait]')
      assert.strictEqual(task.outcome, 'running')
      const next = yield* started(projectId, 'Next', 'Do it. [lead:finish]')
      assert.strictEqual(next.outcome, 'waiting')
      // The lead's step is done and its server still runs: the review goes on in the task's place, and the next task can't
      // slip in between the two.
      yield* until(
        attempts(task.taskId),
        (rows) => rows.map((row) => [row.step, row.state, row.holdReason]).join() === 'implement,succeeded,,review,running,',
      )
      assert.isNull((yield* cardOf(projectId, task.taskId))?.queued)
      yield* waiting(next.taskId)
      assert.deepStrictEqual(yield* sessionsOn(next.threadId), [])
      // Stopped, the task gives its place up: the next starts, and finishes.
      yield* tasks.stop({ envelope: yield* Runtime.envelope('task.stop', {}), taskId: task.taskId })
      yield* until(attempts(next.taskId), (rows) => rows[0]?.state === 'succeeded')
    }).pipe(Effect.provide(machine(1))),
  )

  it.live('hold a follow-up for a lead that finished until there is a place, leaving its task in Needs you, saying so', () =>
    Effect.gen(function* () {
      const { projectId } = yield* opened
      const tasks = yield* Tasks
      const first = yield* started(projectId, 'First', 'Do it. [lead:finish]')
      yield* until(attempts(first.taskId), (rows) => rows[0]?.state === 'succeeded')
      yield* idle(first.threadId)
      const second = yield* started(projectId, 'Second', 'Work on it. [lead:wait]')
      yield* working(second.taskId)
      const turns = (yield* turnsOn(first.threadId)).length
      // Its lead is idle and its task has no place: a word for it waits, and its task stays ready, saying so.
      yield* say(first.threadId, 'Look again.', 'after_current')
      const [waits] = yield* followUpOn(projectId, first.taskId)
      assert.deepStrictEqual(countsOf(waits), { busy: 1, atOnce: 1 })
      assert.deepStrictEqual(
        waits?.holders?.map((holder) => holder.title),
        ['Second'],
      )
      const card = yield* cardOf(projectId, first.taskId)
      assert.strictEqual(card?.phase, 'ready')
      assert.isNull(card?.queued)
      const home = yield* onHome(first.taskId)
      assert.strictEqual(home?.phase, 'ready')
      assert.deepStrictEqual(countsOf(home?.followUpWaits), { busy: 1, atOnce: 1 })
      const thread = yield* Effect.orDie((yield* Queries).thread(first.threadId))
      assert.deepStrictEqual(countsOf(thread.task.followUpWaits), { busy: 1, atOnce: 1 })
      assert.isNull(thread.task.queued)
      yield* Effect.sleep('300 millis')
      assert.lengthOf(yield* turnsOn(first.threadId), turns)
      // Once the second stops, it is delivered, and the task says so no more.
      yield* tasks.stop({ envelope: yield* Runtime.envelope('task.stop', {}), taskId: second.taskId })
      yield* until(turnsOn(first.threadId), (rows) => rows.length === turns + 1)
      yield* until(
        Effect.map(cardOf(projectId, first.taskId), (card) => (card?.followUpWaits === undefined ? [true] : [])),
        (rows) => rows.length === 1,
      )
    }).pipe(Effect.provide(machine(1))),
  )

  it.live('go on with what the person said while its lead worked, in the same place, ahead of a task that waited longer', () =>
    Effect.gen(function* () {
      const { projectId } = yield* opened
      const sessions = yield* Sessions
      const first = yield* started(projectId, 'First', 'Do it. [lead:finish]')
      yield* until(attempts(first.taskId), (rows) => rows[0]?.state === 'succeeded')
      yield* idle(first.threadId)
      // A long turn on the first's lead takes the place: the second waits for it.
      yield* say(first.threadId, scenarios.slow, 'after_current')
      yield* until(
        Effect.map(sessions.running(first.threadId), (live) => (Option.isSome(live) && live.value.turnRunning ? [true] : [])),
        (rows) => rows.length === 1,
      )
      const second = yield* started(projectId, 'Second', 'Work on it. [lead:wait]')
      assert.strictEqual(second.outcome, 'waiting')
      // The person says more to the first while its turn runs; then that turn ends.
      const turns = (yield* turnsOn(first.threadId)).length
      yield* say(first.threadId, 'Look again.', 'after_current')
      yield* sessions.interrupt(first.threadId)
      // What the person said while it worked follows on in its place, though the second waited longer: the first's lead is
      // told, and the second waits on.
      yield* until(turnsOn(first.threadId), (rows) => rows.length === turns + 1)
      yield* waiting(second.taskId)
      assert.deepStrictEqual(yield* sessionsOn(second.threadId), [])
    }).pipe(Effect.provide(machine(1))),
  )

  it.live('let a turn that waits go once the person stops its agent: its task waits no more', () =>
    Effect.gen(function* () {
      const { projectId } = yield* opened
      const sessions = yield* Sessions
      const tasks = yield* Tasks
      const first = yield* started(projectId, 'First', 'Do it. [lead:finish]')
      yield* until(attempts(first.taskId), (rows) => rows[0]?.state === 'succeeded')
      yield* idle(first.threadId)
      const second = yield* started(projectId, 'Second', 'Work on it. [lead:wait]')
      yield* working(second.taskId)
      const turns = (yield* turnsOn(first.threadId)).length
      yield* say(first.threadId, 'Look again.', 'after_current')
      yield* followUpOn(projectId, first.taskId)
      // The person stops the first's lead: nothing of it waits, and its card no longer says so.
      yield* sessions.stop(first.threadId)
      yield* until(
        Effect.map(cardOf(projectId, first.taskId), (card) => (card?.followUpWaits === undefined ? [true] : [])),
        (rows) => rows.length === 1,
      )
      // A place frees: the stopped lead isn't started for it.
      yield* tasks.stop({ envelope: yield* Runtime.envelope('task.stop', {}), taskId: second.taskId })
      yield* Effect.sleep('500 millis')
      assert.lengthOf(yield* turnsOn(first.threadId), turns)
      assert.isTrue(Option.isNone(yield* sessions.running(first.threadId)))
    }).pipe(Effect.provide(machine(1))),
  )

  it.live('take no place for what a task left running once its work came back', () =>
    Effect.gen(function* () {
      const { projectId } = yield* opened
      const sessions = yield* Sessions
      const first = yield* started(projectId, 'First', 'Serve it, then finish. [lead:serve] [lead:finish]', 'claude-code')
      // Its step is done and the task ready, while the server it left running still runs: it holds no place.
      yield* until(
        Effect.map(cardOf(projectId, first.taskId), (card) => (card === undefined ? [] : [card])),
        (cards) => cards[0]?.phase === 'ready',
      )
      yield* until(
        Effect.map(sessions.running(first.threadId), (live) => (Option.isSome(live) ? live.value.background : [])),
        (left) => left.length === 1,
      )
      yield* until(
        Effect.map((yield* Busy).now, (now) => [now.busy]),
        (rows) => rows[0] === 0,
      )
      const second = yield* started(projectId, 'Second', 'Do it. [lead:finish]')
      assert.strictEqual(second.outcome, 'running')
      yield* until(attempts(second.taskId), (rows) => rows[0]?.state === 'succeeded')
    }).pipe(Effect.provide(machine(1))),
  )

  it.live("tell the waiting task's thread, and the cards, who holds the places as they change, so an open view reads them again", () =>
    Effect.gen(function* () {
      const { projectId } = yield* opened
      const queries = yield* Queries
      const tasks = yield* Tasks
      const first = yield* started(projectId, 'First', 'Work on it. [lead:wait]')
      yield* working(first.taskId)
      const second = yield* started(projectId, 'Second', 'Work on it. [lead:wait]')
      const third = yield* started(projectId, 'Third', 'Do it. [lead:finish]')
      yield* waiting(second.taskId)
      yield* waiting(third.taskId)
      const holders = (taskId: string) =>
        Effect.map(cardOf(projectId, taskId), (card) => card?.queued?.holders?.map((holder) => holder.title) ?? [])
      assert.deepStrictEqual(yield* holders(third.taskId), ['First'])
      // The first stops: the second takes the place, and the third, still waiting, is told, on its own thread too.
      const at = yield* queries.cursor
      yield* tasks.stop({ envelope: yield* Runtime.envelope('task.stop', {}), taskId: first.taskId })
      yield* working(second.taskId)
      yield* until(holders(third.taskId), (rows) => rows.length === 1 && rows[0] === 'Second')
      const changes = yield* queries.changesSince(at, 100)
      assert.isTrue(changes.some((change) => change.aggregateType === 'task' && change.threadId === third.threadId))
      // Telling the clients about a task that isn't there changes nothing.
      yield* touchTask('missing')
    }).pipe(Effect.provide(machine(1))),
  )
})

describe('What waits, in order', () => {
  it('starts what was at work first, then what the person did, the work of a task under way, then the rest, oldest first', () => {
    const start = Effect.void
    const waiters = [
      { taskId: 'first-plan', since: '2026-10-14T20:00:00.000Z', start },
      { taskId: 'restarted', since: '2026-10-14T23:00:00.000Z', ahead: 'working' as const, start },
      { taskId: 'back-from-a-limit', since: '2026-10-14T21:00:00.000Z', ahead: 'started' as const, start },
      { taskId: 'resumed', since: '2026-10-14T22:00:00.000Z', ahead: 'person' as const, start },
      { taskId: 'round-turn', threadId: 'round', since: '2026-10-14T21:30:00.000Z', start },
      { taskId: 'persons-turn', threadId: 'told', since: '2026-10-14T22:30:00.000Z', start },
      { taskId: 'passed-on', threadId: 'idle', since: '2026-10-14T20:30:00.000Z', start },
    ]
    assert.deepStrictEqual(
      inOrder(waiters, new Set(['told']), new Set(['round-turn'])).map((waiter) => waiter.taskId),
      ['restarted', 'resumed', 'persons-turn', 'back-from-a-limit', 'round-turn', 'first-plan', 'passed-on'],
    )
  })
})

describe('Tasks at once, across a restart', () => {
  it.live('carry on a stuck step as the person answered, in the place its task kept, while what came after waits', () =>
    Effect.gen(function* () {
      const runs = yield* Runs
      const sql = yield* SqlClient.SqlClient
      const { projectId } = yield* opened
      // Its lead can't start: the step needs the person, and its task keeps its place meanwhile.
      const stuck = yield* started(projectId, 'Stuck', 'Do it. [lead:finish]', 'missing')
      const [call] = yield* until(
        sql<{ id: string }>`SELECT id FROM attention_requests WHERE task_id = ${stuck.taskId} AND kind = 'stuck' AND state = 'open'`,
        (rows) => rows.length === 1,
      )
      const other = yield* started(projectId, 'Other', 'Do it. [lead:finish]')
      assert.strictEqual(other.outcome, 'waiting')
      // Handed to Codex: it carries on at once, as the person said, and finishes; then the other starts.
      yield* runs.answerStuck({
        envelope: yield* Runtime.envelope('attention.answer', {}),
        attentionId: call?.id ?? '',
        answer: { kind: 'retry', agentId: 'codex' },
      })
      yield* until(attempts(stuck.taskId), (rows) => rows.at(-1)?.state === 'succeeded')
      assert.deepStrictEqual(
        (yield* sessionsOn(stuck.threadId)).map((session) => session.agentId),
        ['missing', 'codex'],
      )
      yield* until(attempts(other.taskId), (rows) => rows[0]?.state === 'succeeded')
      assert.isNull((yield* cardOf(projectId, stuck.taskId))?.queued)
    }).pipe(Effect.provide(machine(1))),
  )

  it.live('start an idle lead again for what the person said to it, once there is a place, though Althar restarted meanwhile', () =>
    Effect.gen(function* () {
      const file = store()
      const before = yield* Effect.gen(function* () {
        const { projectId } = yield* opened
        const first = yield* started(projectId, 'First', 'Do it. [lead:finish]')
        yield* until(attempts(first.taskId), (rows) => rows[0]?.state === 'succeeded')
        yield* idle(first.threadId)
        const second = yield* started(projectId, 'Second', 'Work on it. [lead:wait]')
        yield* working(second.taskId)
        yield* say(first.threadId, 'Look again.', 'after_current')
        yield* followUpOn(projectId, first.taskId)
        return { projectId, first, second, turns: (yield* turnsOn(first.threadId)).length }
      }).pipe(Effect.provide(machine(1, file)))

      yield* Effect.gen(function* () {
        const { projectId, first, second, turns } = before
        yield* until(sessionsOn(second.threadId), (rows) => rows.length === 2)
        // Still waiting, and saying so; once the second is stopped, the lead starts again and is told.
        assert.deepStrictEqual(countsOf((yield* cardOf(projectId, first.taskId))?.followUpWaits), { busy: 1, atOnce: 1 })
        const tasks = yield* Tasks
        yield* tasks.stop({ envelope: yield* Runtime.envelope('task.stop', {}), taskId: second.taskId })
        yield* until(turnsOn(first.threadId), (rows) => rows.length === turns + 1)
        assert.isUndefined((yield* cardOf(projectId, first.taskId))?.followUpWaits)
      }).pipe(Effect.provide(machine(1, file)))
    }),
  )

  it.live('let what waited go once it is delivered: nothing of it starts again after a restart', () =>
    Effect.gen(function* () {
      const file = store()
      const before = yield* Effect.gen(function* () {
        const tasks = yield* Tasks
        const { projectId } = yield* opened
        const first = yield* started(projectId, 'First', 'Do it. [lead:finish]')
        yield* until(attempts(first.taskId), (rows) => rows[0]?.state === 'succeeded')
        yield* idle(first.threadId)
        const second = yield* started(projectId, 'Second', 'Work on it. [lead:wait]')
        yield* working(second.taskId)
        const turns = (yield* turnsOn(first.threadId)).length
        yield* say(first.threadId, 'Look again.', 'after_current')
        yield* followUpOn(projectId, first.taskId)
        assert.isNotNull(yield* waitsOn(first.threadId))
        // The second stops: what waited is delivered, and nothing of it waits any more, on the card or the thread.
        yield* tasks.stop({ envelope: yield* Runtime.envelope('task.stop', {}), taskId: second.taskId })
        yield* until(turnsOn(first.threadId), (rows) => rows.length === turns + 1 && rows.every((row) => row.state !== 'delivered'))
        assert.isNull(yield* waitsOn(first.threadId))
        assert.isUndefined((yield* cardOf(projectId, first.taskId))?.followUpWaits)
        return { projectId, first, turns: turns + 1, sessions: (yield* sessionsOn(first.threadId)).length }
      }).pipe(Effect.provide(machine(1, file)))

      yield* Effect.gen(function* () {
        const { projectId, first, turns, sessions } = before
        yield* Effect.sleep('1 second')
        assert.lengthOf(yield* turnsOn(first.threadId), turns)
        assert.lengthOf(yield* sessionsOn(first.threadId), sessions)
        assert.isUndefined((yield* cardOf(projectId, first.taskId))?.followUpWaits)
      }).pipe(Effect.provide(machine(1, file)))
    }),
  )

  it.live('let the person stop a task whose idle lead waits for a place after a restart: it never starts', () =>
    Effect.gen(function* () {
      const file = store()
      const before = yield* Effect.gen(function* () {
        const { projectId } = yield* opened
        const first = yield* started(projectId, 'First', 'Do it. [lead:finish]')
        yield* until(attempts(first.taskId), (rows) => rows[0]?.state === 'succeeded')
        yield* idle(first.threadId)
        const second = yield* started(projectId, 'Second', 'Work on it. [lead:wait]')
        yield* working(second.taskId)
        yield* say(first.threadId, 'Look again.', 'after_current')
        yield* followUpOn(projectId, first.taskId)
        return { projectId, first, second, turns: (yield* turnsOn(first.threadId)).length }
      }).pipe(Effect.provide(machine(1, file)))

      yield* Effect.gen(function* () {
        const { projectId, first, second, turns } = before
        const tasks = yield* Tasks
        yield* until(sessionsOn(second.threadId), (rows) => rows.length === 2)
        // Nothing is on the first, but it waits: the person can stop it, and then it waits no more.
        assert.include(yield* tasksActions(first.threadId), 'stop')
        yield* tasks.stop({ envelope: yield* Runtime.envelope('task.stop', {}), taskId: first.taskId })
        assert.isNull(yield* waitsOn(first.threadId))
        assert.isUndefined((yield* cardOf(projectId, first.taskId))?.followUpWaits)
        const sessions = (yield* sessionsOn(first.threadId)).length
        // A place frees: the first isn't started for it.
        yield* tasks.stop({ envelope: yield* Runtime.envelope('task.stop', {}), taskId: second.taskId })
        yield* Effect.sleep('1 second')
        assert.lengthOf(yield* turnsOn(first.threadId), turns)
        assert.lengthOf(yield* sessionsOn(first.threadId), sessions)
      }).pipe(Effect.provide(machine(1, file)))
    }),
  )

  it.live('start the agent the person switched an idle lead to, once there is a place, though Althar restarted meanwhile', () =>
    Effect.gen(function* () {
      const file = store()
      const before = yield* Effect.gen(function* () {
        const sessions = yield* Sessions
        const { projectId } = yield* opened
        const first = yield* started(projectId, 'First', 'Do it. [lead:finish]')
        yield* until(attempts(first.taskId), (rows) => rows[0]?.state === 'succeeded')
        yield* idle(first.threadId)
        const second = yield* started(projectId, 'Second', 'Work on it. [lead:wait]')
        yield* working(second.taskId)
        // Switched to Claude Code, with a word for it: its first turn waits for a place.
        yield* sessions.switchAgent({
          threadId: first.threadId,
          agentId: 'claude-code',
          message: { envelope: yield* Runtime.envelope('thread.send', {}), body: 'Look again.' },
        })
        yield* followUpOn(projectId, first.taskId)
        return { projectId, first, second }
      }).pipe(Effect.provide(machine(1, file)))

      yield* Effect.gen(function* () {
        const { projectId, first, second } = before
        yield* until(sessionsOn(second.threadId), (rows) => rows.length === 2)
        assert.deepStrictEqual(countsOf((yield* cardOf(projectId, first.taskId))?.followUpWaits), { busy: 1, atOnce: 1 })
        const tasks = yield* Tasks
        yield* tasks.stop({ envelope: yield* Runtime.envelope('task.stop', {}), taskId: second.taskId })
        // Claude Code starts again, as the person last had it, and takes what waited.
        const sql = yield* SqlClient.SqlClient
        yield* until(
          sql<{ agentId: string }>`
            SELECT s.agent_id FROM turn_deliveries d JOIN provider_sessions s ON s.id = d.provider_session_id
            WHERE d.thread_id = ${first.threadId} AND d.state != 'requested' ORDER BY d.requested_at DESC LIMIT 1`,
          (rows) => rows[0]?.agentId === 'claude-code',
        )
      }).pipe(Effect.provide(machine(1, file)))
    }),
  )

  it.live('let the person change a plan whose first step waits, after a restart too, and start it as changed', () =>
    Effect.gen(function* () {
      const file = store()
      /** The plan as its run keeps it: who leads, who reviews, and how it ends. */
      const planOf = (taskId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [run] = yield* sql<{ parameters: string }>`SELECT parameters FROM runs WHERE task_id = ${taskId}`
          const [plan] = yield* sql<{
            parameters: string
          }>`SELECT parameters FROM task_plans WHERE task_id = ${taskId} AND state = 'accepted'`
          return { run: JSON.parse(run?.parameters ?? '{}'), plan: JSON.parse(plan?.parameters ?? '{}') }
        })
      const before = yield* Effect.gen(function* () {
        const plans = yield* Plans
        const { projectId } = yield* opened
        const first = yield* started(projectId, 'First', 'Work on it. [lead:wait]')
        yield* working(first.taskId)
        const second = yield* started(projectId, 'Second', 'Do it. [lead:finish] [review:pass]')
        yield* waiting(second.taskId)
        assert.isTrue((yield* cardOf(projectId, second.taskId))?.planWaits)
        // Changed while it waits: Claude Code leads now, Codex reviews, and it ends on its branch.
        const steps = [
          { key: 'implement' as const, agentId: 'claude-code', model: null, skipped: false },
          { key: 'review' as const, agentId: 'codex', model: null, skipped: false },
        ]
        yield* plans.change(second.planId, steps, yield* person, 'none')
        const changed = yield* planOf(second.taskId)
        assert.deepStrictEqual(changed.run.steps, steps)
        assert.deepStrictEqual(changed.plan.steps, steps)
        assert.strictEqual(changed.run.end, 'none')
        // One at work already can't be changed so: its plan stays as it was.
        yield* plans.change(first.planId, steps, yield* person, 'none')
        assert.strictEqual((yield* planOf(first.taskId)).run.steps[0].agentId, 'codex')
        assert.isUndefined((yield* cardOf(projectId, first.taskId))?.planWaits)
        return { projectId, first, second }
      }).pipe(Effect.provide(machine(1, file)))

      yield* Effect.gen(function* () {
        const plans = yield* Plans
        const { projectId, first, second } = before
        yield* until(sessionsOn(first.threadId), (rows) => rows.length === 2)
        yield* waiting(second.taskId)
        assert.isTrue((yield* cardOf(projectId, second.taskId))?.planWaits)
        // Changed again after the restart: its reviewer skipped.
        yield* plans.change(
          second.planId,
          [
            { key: 'implement', agentId: 'claude-code', model: null, skipped: false },
            { key: 'review', agentId: 'codex', model: null, skipped: true },
          ],
          yield* person,
        )
        assert.isTrue((yield* planOf(second.taskId)).run.steps[1].skipped)
        // Once a place frees, it starts as changed: on Claude Code, with no review, and on to how it ends now.
        const tasks = yield* Tasks
        yield* tasks.stop({ envelope: yield* Runtime.envelope('task.stop', {}), taskId: first.taskId })
        yield* until(attempts(second.taskId), (rows) => rows[0]?.state === 'succeeded' && rows.length === 2)
        assert.deepStrictEqual(
          (yield* sessionsOn(second.threadId)).map((session) => session.agentId),
          ['claude-code'],
        )
        assert.deepStrictEqual(
          (yield* attempts(second.taskId)).map((row) => row.step),
          ['implement', 'publish'],
        )
        assert.isUndefined((yield* cardOf(projectId, second.taskId))?.planWaits)
      }).pipe(Effect.provide(machine(1, file)))
    }),
  )

  it.live('keep the place of a task whose lead waits on the person across a restart, and tell its answer at once', () =>
    Effect.gen(function* () {
      const file = store()
      const before = yield* Effect.gen(function* () {
        const { projectId } = yield* opened
        const first = yield* started(projectId, 'First', 'Work on it. [lead:wait]')
        yield* working(first.taskId)
        const question = yield* asking(first.threadId)
        const second = yield* started(projectId, 'Second', 'Work on it. [lead:wait]')
        yield* waiting(second.taskId)
        return { projectId, first, second, question }
      }).pipe(Effect.provide(machine(1, file)))

      yield* Effect.gen(function* () {
        const { projectId, first, second, question } = before
        // Its step still waits on the person after the restart, in its task's place: the second waits on.
        yield* until(attempts(first.taskId), (rows) => rows[0]?.state === 'waiting_attention')
        yield* waiting(second.taskId)
        assert.deepStrictEqual(countsOf((yield* cardOf(projectId, second.taskId))?.queued), { busy: 1, atOnce: 1 })
        // Answered, it is told at once to a lead started for it, and nothing of the answer waits.
        yield* answerIt(question)
        assert.include(
          yield* until(replies(first.threadId), (said) => said.some((text) => text.startsWith('told='))),
          'told=Which database? sqlite',
        )
        assert.deepStrictEqual(yield* questionOf(question), { state: 'answered', kept: false })
        yield* waiting(second.taskId)
        // Once the first stops, the second starts by itself.
        const tasks = yield* Tasks
        yield* tasks.stop({ envelope: yield* Runtime.envelope('task.stop', {}), taskId: first.taskId })
        yield* working(second.taskId)
      }).pipe(Effect.provide(machine(1, file)))
    }),
  )

  it.live('keep what waits, and carry on what was working first, then what waited, oldest first', () =>
    Effect.gen(function* () {
      const file = store()
      const before = yield* Effect.gen(function* () {
        const { projectId } = yield* opened
        const first = yield* started(projectId, 'First', 'Work on it. [lead:wait]')
        yield* working(first.taskId)
        const second = yield* started(projectId, 'Second', 'Work on it. [lead:wait]')
        yield* waiting(second.taskId)
        return { projectId, first, second }
      }).pipe(Effect.provide(machine(1, file)))

      yield* Effect.gen(function* () {
        const { projectId, first, second } = before
        // The first was working: it carries on, on its own place; the second still waits, saying why.
        yield* until(sessionsOn(first.threadId), (rows) => rows.length === 2)
        yield* working(first.taskId)
        yield* waiting(second.taskId)
        assert.deepStrictEqual(countsOf((yield* cardOf(projectId, second.taskId))?.queued), { busy: 1, atOnce: 1 })
        assert.deepStrictEqual(yield* sessionsOn(second.threadId), [])
        // Once the first is stopped, the second starts by itself.
        const tasks = yield* Tasks
        yield* tasks.stop({ envelope: yield* Runtime.envelope('task.stop', {}), taskId: first.taskId })
        yield* working(second.taskId)
        assert.deepStrictEqual(
          (yield* sessionsOn(second.threadId)).map((session) => session.agentId),
          ['codex'],
        )
      }).pipe(Effect.provide(machine(1, file)))
    }),
  )

  it.live('hold every step a restart stopped until it has a place, the first admitted first', () =>
    Effect.gen(function* () {
      const file = store()
      const before = yield* Effect.gen(function* () {
        const busy = yield* Busy
        yield* busy.set(2)
        const { projectId } = yield* opened
        const first = yield* started(projectId, 'First', 'Work on it. [lead:wait]')
        const second = yield* started(projectId, 'Second', 'Work on it. [lead:wait]')
        yield* working(first.taskId)
        yield* working(second.taskId)
        // Back to one at a time for the next launch.
        yield* busy.set(1)
        return { projectId, first, second }
      }).pipe(Effect.provide(machine(2, file)))

      yield* Effect.gen(function* () {
        const { projectId, first, second } = before
        // One place: the first admitted carries on, and the other waits for it, kept so a restart doesn't lose it.
        yield* working(first.taskId)
        yield* waiting(second.taskId)
        assert.deepStrictEqual(countsOf((yield* cardOf(projectId, second.taskId))?.queued), { busy: 1, atOnce: 1 })
      }).pipe(Effect.provide(machine(2, file)))
    }),
  )
})

/** What the person can do to the task now, from its thread. */
const tasksActions = (threadId: string) =>
  Effect.gen(function* () {
    const queries = yield* Queries
    return (yield* Effect.orDie(queries.thread(threadId))).task.actions
  })
