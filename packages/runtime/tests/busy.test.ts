import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ActorId, ProjectId } from '@althar/domain'
import { scenarios } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { Busy } from '../src/Busy'
import type { BusyOptions } from '../src/Config'
import { touchTask } from '../src/cards'
import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Questions } from '../src/Questions'
import { Runs } from '../src/Runs'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { Tasks } from '../src/Tasks'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, repository, runtime, until } from './support'

/*
 * How many tasks are at work at once on this machine (Busy.ts, ADR-032).
 * With every place taken, the next task's first step doesn't start: it
 * waits, held in the store, and its card says why; it starts on its own,
 * oldest first, when a place frees, after a restart too. The person can stop
 * it while it waits, and a number they set takes effect at once.
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

/** What the record says of the task's step attempts, oldest first: one held for a place says so, though it ran later. */
const facts = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ type: string }>`
      SELECT f.type FROM record_events f JOIN node_attempts a ON a.id = f.aggregate_id JOIN nodes n ON n.id = a.node_id
      JOIN workflow_executions e ON e.id = n.execution_id JOIN runs r ON r.id = e.run_id
      WHERE f.aggregate_type = 'node_attempt' AND r.task_id = ${taskId} ORDER BY f.sequence`
    return rows.map((row) => row.type)
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

/** Althar tells the thread's agent something, quietly, as it does a check that failed: a task's work under way, not the person's. */
const tell = (threadId: string, body: string) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    const envelope = yield* Runtime.envelope('thread.send', { threadId, body }, undefined, (yield* Instance).systemId)
    yield* sessions.send({ envelope, threadId, body, disposition: 'after_current', quiet: true })
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

/** Waits until the task's card says it waits for a free agent. */
const queuedOn = (projectId: string, taskId: string) =>
  until(
    Effect.map(cardOf(projectId, taskId), (card) => (card?.queued == null ? [] : [card.queued])),
    (rows) => rows.length === 1,
  )

/** Waits until the task's first step is running on its lead. */
const working = (taskId: string) => until(attempts(taskId), (rows) => rows.at(-1)?.state === 'running')

/** Waits until the task's latest step waits for a place. */
const waiting = (taskId: string) =>
  until(attempts(taskId), (rows) => rows.at(-1)?.state === 'held' && rows.at(-1)?.holdReason === 'machine_busy')

describe('Agents at once', () => {
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
      // It names the tasks that hold the places, none of them only by something it left running.
      assert.deepStrictEqual(
        card?.queued?.holders?.map((holder) => [holder.title, holder.kept]),
        [
          ['First', false],
          ['Second', false],
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
      assert.match(said, /^Started try-the-double-jump, but it waits for a free agent: 1 of the 1 this computer runs at once are busy\./)
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

  it.live('can be stopped while it waits, and resumed by the person, when it starts at once though every place is taken', () =>
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

      // Resumed by the person while the first still works, it starts at once: what the person does never waits.
      yield* tasks.resume({ envelope: yield* Runtime.envelope('task.resume', {}), taskId: second.taskId })
      yield* until(attempts(second.taskId), (rows) => rows.at(-1)?.state === 'succeeded')
      assert.deepStrictEqual(
        (yield* sessionsOn(second.threadId)).map((session) => session.agentId),
        ['codex'],
      )
      assert.isNull((yield* cardOf(projectId, second.taskId))?.queued)
      // The first worked on all along.
      assert.strictEqual((yield* attempts(first.taskId))[0]?.state, 'running')
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

  it.live('count a lead waiting on the person’s answer to a question a few minutes, while it is warm, and then not', () =>
    Effect.gen(function* () {
      const { projectId } = yield* opened
      const first = yield* started(projectId, 'First', 'Work on it. [lead:wait]')
      yield* working(first.taskId)
      const second = yield* started(projectId, 'Second', 'Do it. [lead:finish]')
      yield* waiting(second.taskId)
      // Its step still under way between turns, the first's lead holds its place: the second waits on.
      yield* (yield* Sessions).interrupt(first.threadId)
      yield* until(turnsOn(first.threadId), (rows) => rows.every((row) => row.state !== 'delivered'))
      yield* waiting(second.taskId)
      // Then its lead asks the person something: an answer soon goes on where it was, so it keeps its place a while.
      yield* say(first.threadId, scenarios.question, 'after_current')
      yield* askedOn(first.threadId)
      yield* Effect.sleep('400 millis')
      assert.deepStrictEqual((yield* attempts(second.taskId))[0], { step: 'implement', state: 'held', holdReason: 'machine_busy' })
      // Past that, it isn't using the machine while it waits on them: the second starts.
      yield* until(attempts(second.taskId), (rows) => rows[0]?.state === 'succeeded')
      const sql = yield* SqlClient.SqlClient
      const asked = yield* sql<{ id: string }>`SELECT id FROM attention_requests WHERE kind = 'question' AND state = 'open'`
      assert.lengthOf(asked, 1)
    }).pipe(Effect.provide(machine(1, ':memory:', { askGrace: Duration.seconds(1), every: Duration.millis(100) }))),
  )

  it.live('tell the person’s answer to its lead at once, though every place is taken', () =>
    Effect.gen(function* () {
      const { projectId } = yield* opened
      const first = yield* started(projectId, 'First', 'Work on it. [lead:wait]')
      yield* working(first.taskId)
      const question = yield* asking(first.threadId)
      // Its lead waits on the person, past the minutes it keeps its place: the second takes the place.
      const second = yield* started(projectId, 'Second', 'Work on it. [lead:wait]')
      yield* working(second.taskId)
      // Answered now, the first's lead goes on at once, as a second agent at work: what the person does never waits.
      yield* answerIt(question)
      assert.include(
        yield* until(replies(first.threadId), (said) => said.some((text) => text.startsWith('answer='))),
        'answer={"database":"sqlite"}',
      )
      assert.deepStrictEqual(yield* questionOf(question), { state: 'answered', kept: false })
      assert.isNull((yield* cardOf(projectId, first.taskId))?.queued)
      // The second worked on all along.
      assert.strictEqual((yield* attempts(second.taskId))[0]?.state, 'running')
    }).pipe(Effect.provide(machine(1, ':memory:', { askGrace: Duration.millis(0) }))),
  )

  it.live('tell an answer kept to wait for a place, as answers once were, at once', () =>
    Effect.gen(function* () {
      const busy = yield* Busy
      const { projectId } = yield* opened
      const first = yield* started(projectId, 'First', 'Work on it. [lead:wait]')
      yield* working(first.taskId)
      const question = yield* asking(first.threadId)
      const second = yield* started(projectId, 'Second', 'Work on it. [lead:wait]')
      yield* working(second.taskId)
      // An answer kept for a place, as one was before the person's answers went on at once: it is theirs, and goes now.
      yield* (yield* Questions).answer({
        envelope: yield* Runtime.envelope('attention.answer_question', { attentionId: question }),
        attentionId: question,
        answers: { database: { values: ['sqlite'] } },
        keep: true,
      })
      yield* busy.wake
      assert.include(
        yield* until(replies(first.threadId), (said) => said.some((text) => text.startsWith('answer='))),
        'answer={"database":"sqlite"}',
      )
      assert.deepStrictEqual(yield* questionOf(question), { state: 'answered', kept: false })
      assert.isNull((yield* cardOf(projectId, first.taskId))?.queued)
    }).pipe(Effect.provide(machine(1, ':memory:', { askGrace: Duration.millis(0) }))),
  )

  it.live('deliver what the person says to an idle lead at once, though every place is taken', () =>
    Effect.gen(function* () {
      const { projectId } = yield* opened
      const first = yield* started(projectId, 'First', 'Do it. [lead:finish]')
      yield* until(attempts(first.taskId), (rows) => rows[0]?.state === 'succeeded')
      yield* idle(first.threadId)
      const second = yield* started(projectId, 'Second', 'Work on it. [lead:wait]')
      yield* working(second.taskId)
      const turns = (yield* turnsOn(first.threadId)).length
      // Its lead is idle, and every place taken: a word from the person goes on all the same, and its task never waits.
      yield* say(first.threadId, 'Look again.', 'after_current')
      yield* until(turnsOn(first.threadId), (rows) => rows.length === turns + 1)
      assert.isNull(yield* waitsOn(first.threadId))
      assert.isNull((yield* cardOf(projectId, first.taskId))?.queued)
      // The second worked on all along.
      assert.strictEqual((yield* attempts(second.taskId))[0]?.state, 'running')
    }).pipe(Effect.provide(machine(1))),
  )

  it.live('hold what Althar tells an idle lead until it has a place, and deliver it then', () =>
    Effect.gen(function* () {
      const { projectId } = yield* opened
      const tasks = yield* Tasks
      const first = yield* started(projectId, 'First', 'Do it. [lead:finish]')
      yield* until(attempts(first.taskId), (rows) => rows[0]?.state === 'succeeded')
      yield* idle(first.threadId)
      const second = yield* started(projectId, 'Second', 'Work on it. [lead:wait]')
      yield* working(second.taskId)
      const turns = (yield* turnsOn(first.threadId)).length
      // Althar's own word would make it a second agent at work: it waits, as a task's work under way, and its task says so.
      yield* tell(first.threadId, 'The checks failed.')
      yield* queuedOn(projectId, first.taskId)
      assert.deepStrictEqual(countsOf((yield* cardOf(projectId, first.taskId))?.queued), { busy: 1, atOnce: 1 })
      yield* Effect.sleep('300 millis')
      assert.lengthOf(yield* turnsOn(first.threadId), turns)
      // Once the second stops, it is delivered.
      yield* tasks.stop({ envelope: yield* Runtime.envelope('task.stop', {}), taskId: second.taskId })
      yield* until(turnsOn(first.threadId), (rows) => rows.length === turns + 1)
    }).pipe(Effect.provide(machine(1))),
  )

  it.live('hold a review until what its lead left running stops: the two would be two agents at work', () =>
    Effect.gen(function* () {
      const { projectId } = yield* opened
      const sessions = yield* Sessions
      const task = yield* reviewed(projectId, 'Served', 'Serve it, then finish. [lead:serve] [lead:finish] [review:pass]')
      assert.strictEqual(task.outcome, 'running')
      // The lead's step is done, and the server it left running still runs: the review waits for a place, and says so.
      const running = yield* until(
        Effect.map(sessions.running(task.threadId), (live) => (Option.isSome(live) ? live.value.background : [])),
        (left) => left.length === 1,
      )
      yield* until(
        attempts(task.taskId),
        (rows) => rows.map((row) => [row.step, row.state, row.holdReason]).join() === 'implement,succeeded,,review,held,machine_busy',
      )
      assert.deepStrictEqual(countsOf((yield* cardOf(projectId, task.taskId))?.queued), { busy: 1, atOnce: 1 })
      // The server stops: the reviewer takes the place, and the review passes.
      yield* sessions.stopBackground(task.threadId, running[0]?.id ?? '')
      yield* until(attempts(task.taskId), (rows) => rows.at(-1)?.step === 'review' && rows.at(-1)?.state === 'succeeded')
    }).pipe(Effect.provide(machine(1))),
  )

  it.live('keep a task’s place between its own steps: its review goes on, ahead of a task that waited longer', () =>
    Effect.gen(function* () {
      const { projectId } = yield* opened
      const task = yield* reviewed(projectId, 'Reviewed', 'Work on it. [lead:wait] [review:pass]')
      yield* working(task.taskId)
      const other = yield* started(projectId, 'Other', 'Work on it. [lead:wait]')
      yield* waiting(other.taskId)
      // The lead finishes: its review takes its place at once, though the other has waited all along.
      yield* say(task.threadId, '[lead:finish]')
      yield* until(attempts(task.taskId), (rows) => rows.at(-1)?.step === 'review' && rows.at(-1)?.state === 'succeeded')
      assert.isFalse((yield* facts(task.taskId)).includes('node_attempt.held'), 'the review never waited for a place')
      // Then the task is the person's, and the other has the place.
      yield* working(other.taskId)
    }).pipe(Effect.provide(machine(1))),
  )

  it.live('start a task’s work under way before new work that waited longer', () =>
    Effect.gen(function* () {
      const { projectId } = yield* opened
      const sessions = yield* Sessions
      const task = yield* reviewed(projectId, 'Served', 'Work on it. [lead:wait] [review:pass]')
      yield* working(task.taskId)
      const other = yield* started(projectId, 'Other', 'Work on it. [lead:wait]')
      yield* waiting(other.taskId)
      // The lead serves and finishes: what it left running still runs, so its review waits for a place of its own.
      yield* say(task.threadId, '[lead:serve] [lead:finish]')
      const running = yield* until(
        Effect.map(sessions.running(task.threadId), (live) => (Option.isSome(live) ? live.value.background : [])),
        (left) => left.length === 1,
      )
      yield* until(
        attempts(task.taskId),
        (rows) => rows.map((row) => [row.step, row.state, row.holdReason]).join() === 'implement,succeeded,,review,held,machine_busy',
      )
      // The server stops: the review is the task's work under way, and goes before the other, new, that waited longer.
      yield* sessions.stopBackground(task.threadId, running[0]?.id ?? '')
      yield* until(attempts(task.taskId), (rows) => rows.at(-1)?.step === 'review' && rows.at(-1)?.state === 'succeeded')
      yield* working(other.taskId)
    }).pipe(Effect.provide(machine(1))),
  )

  it.live('ask for a place for each turn: one the person adds goes on ahead of a task that waited longer', () =>
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
      // The person says more to the first while its turn runs, at length; then that turn ends.
      const turns = (yield* turnsOn(first.threadId)).length
      yield* say(first.threadId, scenarios.slow, 'after_current')
      yield* sessions.interrupt(first.threadId)
      // What the person said goes on first, though the second waited longer; the second waits on while it runs.
      yield* until(turnsOn(first.threadId), (rows) => rows.length === turns + 1 && rows.at(-1)?.state === 'delivered')
      assert.deepStrictEqual((yield* attempts(second.taskId)).at(-1), { step: 'implement', state: 'held', holdReason: 'machine_busy' })
      assert.isNull((yield* cardOf(projectId, first.taskId))?.queued)
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
      yield* tell(first.threadId, 'The checks failed.')
      yield* queuedOn(projectId, first.taskId)
      // The person stops the first's lead: nothing of it waits, and its card no longer says so.
      yield* sessions.stop(first.threadId)
      yield* until(
        Effect.map(cardOf(projectId, first.taskId), (card) => (card?.queued == null ? [true] : [])),
        (rows) => rows.length === 1,
      )
      // A place frees: the stopped lead isn't started for it.
      yield* tasks.stop({ envelope: yield* Runtime.envelope('task.stop', {}), taskId: second.taskId })
      yield* Effect.sleep('500 millis')
      assert.lengthOf(yield* turnsOn(first.threadId), turns)
      assert.isTrue(Option.isNone(yield* sessions.running(first.threadId)))
    }).pipe(Effect.provide(machine(1))),
  )

  it.live('count a lead whose step is done while what it left running still runs, and free its place when that stops', () =>
    Effect.gen(function* () {
      const { projectId } = yield* opened
      const sessions = yield* Sessions
      const first = yield* started(projectId, 'First', 'Serve it, then finish. [lead:serve] [lead:finish]', 'claude-code')
      // Its step is done and the task ready, but the server it left running still runs: it holds its place.
      yield* until(attempts(first.taskId), (rows) => rows[0]?.state === 'succeeded')
      const running = yield* until(
        Effect.map(sessions.running(first.threadId), (live) => (Option.isSome(live) ? live.value.background : [])),
        (left) => left.length === 1,
      )
      const second = yield* started(projectId, 'Second', 'Do it. [lead:finish]')
      assert.strictEqual(second.outcome, 'waiting')
      yield* waiting(second.taskId)
      yield* sessions.stopBackground(first.threadId, running[0]?.id ?? '')
      yield* until(attempts(second.taskId), (rows) => rows[0]?.state === 'succeeded')
    }).pipe(Effect.provide(machine(1))),
  )
})

/**
 * A stand-in for `ps`, for agents that are no process here: the tree of every agent is one process whose CPU time rises
 * by a second a reading while `burning`, else stands still; with `churning`, a short-lived worker besides, a new one each reading.
 */
const fakeCpu = () => {
  const cpu = { burning: false, churning: false, total: 0, unreadable: false, workers: 0, burstEvery: 0, reads: 0 }
  const of: NonNullable<BusyOptions['cpuOf']> = (agents) =>
    Effect.sync(() => {
      if (cpu.burning) cpu.total += 1_000
      if (cpu.churning) cpu.workers += 1
      cpu.reads += 1
      // A burst of work that a reading finds only now and then: a worker alive at every n-th reading, gone at the rest.
      const burst = cpu.burstEvery > 0 && cpu.reads % cpu.burstEvery === 0
      return new Map(
        agents.map((agent) => [
          agent.threadId,
          cpu.unreadable ? null : new Map([[1, cpu.total], ...(cpu.churning || burst ? [[1_000 + cpu.reads, 0] as [number, number]] : [])]),
        ]),
      )
    })
  return { cpu, of }
}

/** A machine that runs `n` at once, whose agents' CPU the test sets: read every 50 ms, and quiet for a second before it counts as idle. */
const withCpu = <A, E, R>(n: number, body: (cpu: ReturnType<typeof fakeCpu>['cpu']) => Effect.Effect<A, E, R>) => {
  const fake = fakeCpu()
  return body(fake.cpu).pipe(
    Effect.provide(machine(n, ':memory:', { cpuOf: fake.of, sample: Duration.millis(50), quiet: Duration.millis(1_000) })),
  )
}

/** The lead of a task that served and finished: its step is done, and what it left running is the only thing that may hold its place. */
const served = (projectId: ProjectId, title: string) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    const task = yield* started(projectId, title, 'Serve it, then finish. [lead:serve] [lead:finish]', 'claude-code')
    yield* until(attempts(task.taskId), (rows) => rows[0]?.state === 'succeeded')
    const running = yield* until(
      Effect.map(sessions.running(task.threadId), (live) => (Option.isSome(live) ? live.value.background : [])),
      (left) => left.length === 1,
    )
    return { ...task, serverId: running[0]?.id ?? '' }
  })

/** Waits until this many agents are counted at work. */
const busyAt = (n: number) =>
  Effect.flatMap(Busy, (busy) =>
    until(
      Effect.map(busy.now, (now) => [now.busy]),
      (rows) => rows[0] === n,
    ),
  )

describe('Agents at once, and what they left running', () => {
  it.live('take no place for a server left running that sits idle', () =>
    withCpu(1, () =>
      Effect.gen(function* () {
        const { projectId } = yield* opened
        const sessions = yield* Sessions
        const first = yield* served(projectId, 'First')
        // Nothing uses CPU: the server is still there, and takes no place.
        yield* busyAt(0)
        const left = yield* sessions.running(first.threadId)
        assert.strictEqual(Option.isSome(left) ? left.value.background.length : 0, 1)
        // The next task starts at once, and finishes, though the cap is one.
        const second = yield* started(projectId, 'Second', 'Do it. [lead:finish]')
        assert.strictEqual(second.outcome, 'running')
        yield* until(attempts(second.taskId), (rows) => rows[0]?.state === 'succeeded')
      }),
    ),
  )

  it.live('count a test run left running, and say it keeps the place, with what to stop', () =>
    withCpu(1, (cpu) =>
      Effect.gen(function* () {
        cpu.burning = true
        const { projectId } = yield* opened
        const sessions = yield* Sessions
        const first = yield* served(projectId, 'First')
        // Well past the time an idle server stops counting, it still holds its place.
        yield* Effect.sleep('2200 millis')
        assert.strictEqual((yield* (yield* Busy).now).busy, 1)
        const second = yield* started(projectId, 'Second', 'Do it. [lead:finish]')
        assert.strictEqual(second.outcome, 'waiting')
        yield* waiting(second.taskId)
        // The waiting task says who keeps the place: the first, by what it left running, and what to stop.
        const holders = (yield* cardOf(projectId, second.taskId))?.queued?.holders ?? []
        assert.deepStrictEqual(
          holders.map((holder) => [holder.taskId, holder.title, holder.threadId, holder.kept, holder.running.map((left) => left.id)]),
          [[first.taskId, 'First', first.threadId, true, [first.serverId]]],
        )
        yield* sessions.stopBackground(first.threadId, first.serverId)
        yield* until(attempts(second.taskId), (rows) => rows[0]?.state === 'succeeded')
      }),
    ),
  )

  it.live('keep counting a test run that idles for a moment', () =>
    withCpu(1, (cpu) =>
      Effect.gen(function* () {
        cpu.burning = true
        const { projectId } = yield* opened
        yield* served(projectId, 'First')
        yield* Effect.sleep('300 millis')
        // A pause shorter than the quiet it takes to stop counting.
        cpu.burning = false
        yield* Effect.sleep('150 millis')
        assert.strictEqual((yield* (yield* Busy).now).busy, 1)
        cpu.burning = true
        yield* Effect.sleep('1500 millis')
        assert.strictEqual((yield* (yield* Busy).now).busy, 1)
        // Quiet for good, it stops counting.
        cpu.burning = false
        yield* busyAt(0)
      }),
    ),
  )

  it.live('keep counting a runner whose short-lived workers end between readings, though no CPU time is left in the tree', () =>
    withCpu(1, (cpu) =>
      Effect.gen(function* () {
        cpu.churning = true
        const { projectId } = yield* opened
        yield* served(projectId, 'First')
        // Far past the quiet that frees an idle server's place: each reading finds other workers than the last.
        yield* Effect.sleep('2500 millis')
        assert.strictEqual((yield* (yield* Busy).now).busy, 1)
        const second = yield* started(projectId, 'Second', 'Do it. [lead:finish]')
        assert.strictEqual(second.outcome, 'waiting')
        cpu.churning = false
        yield* busyAt(0)
      }),
    ),
  )

  it.live("tell the waiting task's thread, and the cards, who holds the places as they change, so an open view reads them again", () =>
    withCpu(1, (cpu) =>
      Effect.gen(function* () {
        cpu.burning = true
        const { projectId } = yield* opened
        const queries = yield* Queries
        const first = yield* served(projectId, 'First')
        const second = yield* started(projectId, 'Second', 'Work on it. [lead:wait]')
        const third = yield* started(projectId, 'Third', 'Do it. [lead:finish]')
        yield* waiting(second.taskId)
        yield* waiting(third.taskId)
        const holders = (taskId: string) =>
          Effect.map(cardOf(projectId, taskId), (card) => card?.queued?.holders?.map((holder) => [holder.title, holder.kept]) ?? [])
        assert.deepStrictEqual(yield* holders(third.taskId), [['First', true]])
        // The server goes quiet: the second takes the place, and the third, still waiting, is told, on its own thread too.
        const at = yield* queries.cursor
        cpu.burning = false
        yield* working(second.taskId)
        yield* until(holders(third.taskId), (rows) => rows.length === 1 && rows[0]?.[0] === 'Second')
        assert.deepStrictEqual(yield* holders(third.taskId), [['Second', false]])
        const changes = yield* queries.changesSince(at, 100)
        assert.isTrue(changes.some((change) => change.aggregateType === 'task' && change.threadId === third.threadId))
        assert.isTrue(first.serverId !== '')
      }),
    ),
  )

  it.live(
    'keep counting a runner whose bursts are seen only now and then, while they come more often than the quiet, and free it once they stop',
    () =>
      withCpu(1, (cpu) =>
        Effect.gen(function* () {
          // A worker alive at every 5th reading (250 ms), gone between: the tree is the same idle parent at the rest, for far
          // longer than the second it takes an idle server to stop counting.
          cpu.burstEvery = 5
          const { projectId } = yield* opened
          yield* served(projectId, 'First')
          yield* Effect.sleep('2500 millis')
          assert.strictEqual((yield* (yield* Busy).now).busy, 1)
          // The bursts stop: nothing shows work for the quiet, and the place frees.
          cpu.burstEvery = 0
          yield* busyAt(0)
        }),
      ),
  )

  it.live('count a server again once it starts working', () =>
    withCpu(1, (cpu) =>
      Effect.gen(function* () {
        const { projectId } = yield* opened
        yield* served(projectId, 'First')
        yield* busyAt(0)
        // A request makes it work: it holds its place again, and the next task waits.
        cpu.burning = true
        yield* busyAt(1)
        const second = yield* started(projectId, 'Second', 'Do it. [lead:finish]')
        assert.strictEqual(second.outcome, 'waiting')
      }),
    ),
  )

  it.live('start a waiting task as soon as the server it waits for goes idle, with nothing else happening', () =>
    withCpu(1, (cpu) =>
      Effect.gen(function* () {
        cpu.burning = true
        const { projectId } = yield* opened
        yield* served(projectId, 'First')
        const second = yield* started(projectId, 'Second', 'Do it. [lead:finish]')
        yield* waiting(second.taskId)
        // The server goes quiet: no turn ends, no one answers, nothing is stopped.
        cpu.burning = false
        yield* until(attempts(second.taskId), (rows) => rows[0]?.state === 'succeeded')
        // Nothing is left holding a place once it is done and the idle server counts no more.
        yield* busyAt(0)
      }),
    ),
  )

  it.live('read what the machine says of an agent that is no process, and count it, as it cannot say', () =>
    Effect.gen(function* () {
      const { projectId } = yield* opened
      yield* served(projectId, 'First')
      yield* Effect.sleep('600 millis')
      assert.strictEqual((yield* (yield* Busy).now).busy, 1)
      // Telling the clients about a task that isn't there changes nothing.
      yield* touchTask('missing')
    }).pipe(Effect.provide(machine(1, ':memory:', { sample: Duration.millis(50), quiet: Duration.millis(100) }))),
  )

  it.live('let a session that ended go from what is read, with what it left running', () =>
    withCpu(1, (cpu) =>
      Effect.gen(function* () {
        cpu.burning = true
        const { projectId } = yield* opened
        const sessions = yield* Sessions
        const first = yield* served(projectId, 'First')
        yield* Effect.sleep('300 millis')
        yield* sessions.stop(first.threadId)
        yield* busyAt(0)
        yield* Effect.sleep('300 millis')
        assert.strictEqual((yield* (yield* Busy).now).busy, 0)
      }),
    ),
  )

  it.live('count what it cannot read the CPU of', () =>
    withCpu(1, (cpu) =>
      Effect.gen(function* () {
        cpu.unreadable = true
        const { projectId } = yield* opened
        yield* served(projectId, 'First')
        yield* Effect.sleep('2200 millis')
        assert.strictEqual((yield* (yield* Busy).now).busy, 1)
        const second = yield* started(projectId, 'Second', 'Do it. [lead:finish]')
        assert.strictEqual(second.outcome, 'waiting')
      }),
    ),
  )
})

describe('Agents at once, across a restart', () => {
  it.live('carry on a stuck step at once as the person answered, though every place is taken', () =>
    Effect.gen(function* () {
      const runs = yield* Runs
      const sql = yield* SqlClient.SqlClient
      const { projectId } = yield* opened
      // Its lead can't start: the step needs the person, and takes no place meanwhile.
      const stuck = yield* started(projectId, 'Stuck', 'Do it. [lead:finish]', 'missing')
      const [call] = yield* until(
        sql<{ id: string }>`SELECT id FROM attention_requests WHERE task_id = ${stuck.taskId} AND kind = 'stuck' AND state = 'open'`,
        (rows) => rows.length === 1,
      )
      const other = yield* started(projectId, 'Other', 'Work on it. [lead:wait]')
      yield* working(other.taskId)
      // Handed to Codex while the other works: the person's answer goes on at once, and the step finishes on Codex.
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
      assert.isNull((yield* cardOf(projectId, stuck.taskId))?.queued)
      // The other worked on all along.
      assert.strictEqual((yield* attempts(other.taskId))[0]?.state, 'running')
    }).pipe(Effect.provide(machine(1))),
  )

  it.live('start an idle lead again for what Althar told it, once there is a place, though Althar restarted meanwhile', () =>
    Effect.gen(function* () {
      const file = store()
      const before = yield* Effect.gen(function* () {
        const { projectId } = yield* opened
        const first = yield* started(projectId, 'First', 'Do it. [lead:finish]')
        yield* until(attempts(first.taskId), (rows) => rows[0]?.state === 'succeeded')
        yield* idle(first.threadId)
        const second = yield* started(projectId, 'Second', 'Work on it. [lead:wait]')
        yield* working(second.taskId)
        yield* tell(first.threadId, 'The checks failed.')
        yield* queuedOn(projectId, first.taskId)
        return { projectId, first, second, turns: (yield* turnsOn(first.threadId)).length }
      }).pipe(Effect.provide(machine(1, file)))

      yield* Effect.gen(function* () {
        const { projectId, first, second, turns } = before
        yield* until(sessionsOn(second.threadId), (rows) => rows.length === 2)
        // Still waiting, and saying so; once the second is stopped, the lead starts again and is told.
        assert.deepStrictEqual(countsOf((yield* cardOf(projectId, first.taskId))?.queued), { busy: 1, atOnce: 1 })
        const tasks = yield* Tasks
        yield* tasks.stop({ envelope: yield* Runtime.envelope('task.stop', {}), taskId: second.taskId })
        yield* until(turnsOn(first.threadId), (rows) => rows.length === turns + 1)
        assert.isNull((yield* cardOf(projectId, first.taskId))?.queued)
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
        yield* tell(first.threadId, 'The checks failed.')
        yield* queuedOn(projectId, first.taskId)
        assert.isNotNull(yield* waitsOn(first.threadId))
        // The second stops: what waited is delivered, and nothing of it waits any more, on the card or the thread.
        yield* tasks.stop({ envelope: yield* Runtime.envelope('task.stop', {}), taskId: second.taskId })
        yield* until(turnsOn(first.threadId), (rows) => rows.length === turns + 1 && rows.every((row) => row.state !== 'delivered'))
        assert.isNull(yield* waitsOn(first.threadId))
        assert.isNull((yield* cardOf(projectId, first.taskId))?.queued)
        return { projectId, first, turns: turns + 1, sessions: (yield* sessionsOn(first.threadId)).length }
      }).pipe(Effect.provide(machine(1, file)))

      yield* Effect.gen(function* () {
        const { projectId, first, turns, sessions } = before
        yield* Effect.sleep('1 second')
        assert.lengthOf(yield* turnsOn(first.threadId), turns)
        assert.lengthOf(yield* sessionsOn(first.threadId), sessions)
        assert.isNull((yield* cardOf(projectId, first.taskId))?.queued)
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
        yield* tell(first.threadId, 'The checks failed.')
        yield* queuedOn(projectId, first.taskId)
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
        assert.isNull((yield* cardOf(projectId, first.taskId))?.queued)
        const sessions = (yield* sessionsOn(first.threadId)).length
        // A place frees: the first isn't started for it.
        yield* tasks.stop({ envelope: yield* Runtime.envelope('task.stop', {}), taskId: second.taskId })
        yield* Effect.sleep('1 second')
        assert.lengthOf(yield* turnsOn(first.threadId), turns)
        assert.lengthOf(yield* sessionsOn(first.threadId), sessions)
      }).pipe(Effect.provide(machine(1, file)))
    }),
  )

  it.live('start the agent the person switched an idle lead to at once, though every place is taken', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const { projectId } = yield* opened
      const first = yield* started(projectId, 'First', 'Do it. [lead:finish]')
      yield* until(attempts(first.taskId), (rows) => rows[0]?.state === 'succeeded')
      yield* idle(first.threadId)
      const second = yield* started(projectId, 'Second', 'Work on it. [lead:wait]')
      yield* working(second.taskId)
      // Switched to Claude Code, with a word for it: what the person does goes on, and Claude Code takes it.
      yield* sessions.switchAgent({
        threadId: first.threadId,
        agentId: 'claude-code',
        message: { envelope: yield* Runtime.envelope('thread.send', {}), body: 'Look again.' },
      })
      const sql = yield* SqlClient.SqlClient
      yield* until(
        sql<{ agentId: string }>`
          SELECT s.agent_id FROM turn_deliveries d JOIN provider_sessions s ON s.id = d.provider_session_id
          WHERE d.thread_id = ${first.threadId} AND d.state != 'requested' ORDER BY d.requested_at DESC LIMIT 1`,
        (rows) => rows[0]?.agentId === 'claude-code',
      )
      assert.isNull((yield* cardOf(projectId, first.taskId))?.queued)
    }).pipe(Effect.provide(machine(1))),
  )

  it.live('start the agent the person switched an idle lead to at once with nothing said, though every place is taken', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const { projectId } = yield* opened
      const first = yield* started(projectId, 'First', 'Do it. [lead:finish]')
      yield* until(attempts(first.taskId), (rows) => rows[0]?.state === 'succeeded')
      yield* idle(first.threadId)
      const second = yield* started(projectId, 'Second', 'Work on it. [lead:wait]')
      yield* working(second.taskId)
      // Switched from the model picker, with no word for it: its brief is its first turn, and the person's, so it goes on.
      yield* sessions.switchAgent({ threadId: first.threadId, agentId: 'claude-code', byPerson: true })
      const sql = yield* SqlClient.SqlClient
      yield* until(
        sql<{ agentId: string }>`
          SELECT s.agent_id FROM turn_deliveries d JOIN provider_sessions s ON s.id = d.provider_session_id
          WHERE d.thread_id = ${first.threadId} AND d.state != 'requested' ORDER BY d.requested_at DESC LIMIT 1`,
        (rows) => rows[0]?.agentId === 'claude-code',
      )
      assert.isNull((yield* cardOf(projectId, first.taskId))?.queued)
    }).pipe(Effect.provide(machine(1))),
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
