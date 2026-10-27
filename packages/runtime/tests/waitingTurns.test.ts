import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ProjectId } from '@althar/domain'
import { scenarios } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Busy } from '../src/Busy'
import type { BusyOptions } from '../src/Config'
import { Instance } from '../src/Instance'
import { Plans } from '../src/Plans'
import { Policies } from '../src/Policies'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { Questions } from '../src/Questions'
import { Runs } from '../src/Runs'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { Tasks } from '../src/Tasks'
import { items, outFor, repository, runtime, until } from './support'

/*
 * Work waiting for a place among the agents at work (Busy.ts), where
 * busy.test.ts and placesKept.test.ts don't go: a turn Althar's word to an
 * idle lead waits for, as the person switches that lead to another agent,
 * two such that wait together, and one that waited as Althar stopped; a task
 * under way whose turn waits, up next ahead of new work (ADR-065); the
 * line where two tasks waited since the same moment; an answer kept for a place whose lead has gone since; and a review that
 * waits for a place of its own, skipped.
 */

const GB = 1024 ** 3

/** The runtime on a machine that runs one agent at once, with the queries the screens read. */
const oneAtOnce = (busy: BusyOptions = {}, file = ':memory:', more: Parameters<typeof runtime>[2] = {}) =>
  Queries.layer.pipe(Layer.provideMerge(runtime(file, {}, { ...more, busy: { machine: { cores: 3, memory: 7 * GB }, ...busy } })))

/** A task whose plan, its lead Codex with no review unless said, the person starts now. */
const started = (
  projectId: ProjectId,
  title: string,
  description: string,
  steps: ReadonlyArray<{ readonly key: 'implement' | 'review'; readonly agentId: string }> = [{ key: 'implement', agentId: 'codex' }],
) =>
  Effect.gen(function* () {
    const projects = yield* Projects
    const plans = yield* Plans
    const instance = yield* Instance
    const created = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', { title }),
      projectId,
      title,
      description,
      draft: true,
    })
    const planId = yield* plans.propose({
      projectId,
      taskId: created.taskId,
      steps: steps.map((step) => ({ ...step, model: null, skipped: false })),
      reason: null,
      actorId: instance.personId,
      end: null,
      held: true,
    })
    yield* plans.start(planId, instance.personId)
    return created
  })

/** The task's step attempts, oldest first: which step, where it stands, and why one is held. */
const attempts = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ step: string; state: string; holdReason: string | null }>`
      SELECT n.node_key AS step, a.state, a.hold_reason FROM node_attempts a JOIN nodes n ON n.id = a.node_id
      JOIN workflow_executions e ON e.id = n.execution_id JOIN runs r ON r.id = e.run_id
      WHERE r.task_id = ${taskId} ORDER BY a.admitted_at, a.rowid`
  })

const opened = Effect.gen(function* () {
  const projects = yield* Projects
  const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
  return project.projectId as ProjectId
})

/** The turns on a thread, oldest first: the agent each went to, and where it stands. */
const turnsOn = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ agentId: string | null; state: string; prompt: string | null; requestedAt: string }>`
      SELECT s.agent_id, d.state, d.prompt, d.requested_at FROM turn_deliveries d LEFT JOIN provider_sessions s ON s.id = d.provider_session_id
      WHERE d.thread_id = ${threadId} ORDER BY d.requested_at, d.rowid`
  })

/** Since when a turn on the thread waits for a place, as the thread keeps it; null where none waits. */
const waitsOn = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{ since: string | null }>`SELECT waits_for_place AS since FROM threads WHERE id = ${threadId}`
    return row?.since ?? null
  })

describe('a turn Althar’s word to an idle lead waits for', () => {
  it.live('goes to the agent the person switches the lead to, at once, though every place is taken', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const instance = yield* Instance
      const projectId = yield* opened
      const first = yield* started(projectId, 'First', 'Do it. [lead:finish]')
      yield* until(attempts(first.taskId), (rows) => rows[0]?.state === 'succeeded')
      const second = yield* started(projectId, 'Second', 'Work on it. [lead:wait]')
      yield* until(attempts(second.taskId), (rows) => rows[0]?.state === 'running')
      const before = (yield* turnsOn(first.threadId)).length
      // Althar's own word would make the first's lead a second agent at work: its turn waits for a place.
      const envelope = yield* Runtime.envelope('thread.send', {}, undefined, instance.systemId)
      yield* sessions.send({ envelope, threadId: first.threadId, body: 'The checks failed.', disposition: 'after_current', quiet: true })
      yield* until(
        Effect.map(waitsOn(first.threadId), (since) => (since === null ? [] : [since])),
        (rows) => rows.length === 1,
      )
      // The person switches its lead to Claude Code: the session it waited in goes, and Claude Code takes the word at once.
      yield* sessions.switchAgent({ threadId: first.threadId, agentId: 'claude-code', byPerson: true })
      const turns = yield* until(
        turnsOn(first.threadId),
        (rows) => rows.length > before && rows.at(-1)?.agentId === 'claude-code' && rows.at(-1)?.state === 'completed',
      )
      assert.include(turns.at(-1)?.prompt, 'The checks failed.')
      assert.isNull(yield* waitsOn(first.threadId))
      // The second worked on all along.
      assert.strictEqual((yield* attempts(second.taskId))[0]?.state, 'running')
    }).pipe(Effect.provide(oneAtOnce())),
  )
})

describe('turns Althar’s words to two idle leads wait for', () => {
  it.live('go one at a time as places free, the one that waited longest first', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const tasks = yield* Tasks
      const instance = yield* Instance
      const projectId = yield* opened
      const first = yield* started(projectId, 'First', 'Do it. [lead:finish]')
      yield* until(attempts(first.taskId), (rows) => rows[0]?.state === 'succeeded')
      const second = yield* started(projectId, 'Second', 'Do it. [lead:finish]')
      yield* until(attempts(second.taskId), (rows) => rows[0]?.state === 'succeeded')
      const third = yield* started(projectId, 'Third', 'Work on it. [lead:wait]')
      yield* until(attempts(third.taskId), (rows) => rows[0]?.state === 'running')
      const told = (threadId: string) =>
        Effect.gen(function* () {
          const envelope = yield* Runtime.envelope('thread.send', {}, undefined, instance.systemId)
          yield* sessions.send({ envelope, threadId, body: 'The checks failed.', disposition: 'after_current', quiet: true })
          yield* until(
            Effect.map(waitsOn(threadId), (since) => (since === null ? [] : [since])),
            (rows) => rows.length === 1,
          )
        })
      const before = { first: (yield* turnsOn(first.threadId)).length, second: (yield* turnsOn(second.threadId)).length }
      yield* told(first.threadId)
      yield* told(second.threadId)
      // The third stops: its place goes to the first, and the second has it once the first's turn is over.
      yield* tasks.stop({ envelope: yield* Runtime.envelope('task.stop', {}), taskId: third.taskId })
      const [firstTurn] = (yield* until(turnsOn(first.threadId), (rows) => rows.length === before.first + 1)).slice(-1)
      const [secondTurn] = (yield* until(turnsOn(second.threadId), (rows) => rows.length === before.second + 1)).slice(-1)
      assert.isTrue((firstTurn?.requestedAt ?? '') < (secondTurn?.requestedAt ?? ''))
      assert.isNull(yield* waitsOn(first.threadId))
      assert.isNull(yield* waitsOn(second.threadId))
    }).pipe(Effect.provide(oneAtOnce())),
  )
})

describe('a turn Althar’s word waited for when it stopped', () => {
  it.live('starts its lead again once there is a place, and lets it go once its turn is under way', () =>
    Effect.gen(function* () {
      const file = join(mkdtempSync(join(tmpdir(), 'althar-waiting-')), 'althar.sqlite')
      const before = yield* Effect.gen(function* () {
        const sessions = yield* Sessions
        const instance = yield* Instance
        const projectId = yield* opened
        const first = yield* started(projectId, 'First', 'Do it. [lead:finish]')
        yield* until(attempts(first.taskId), (rows) => rows[0]?.state === 'succeeded')
        const second = yield* started(projectId, 'Second', 'Work on it. [lead:wait]')
        yield* until(attempts(second.taskId), (rows) => rows[0]?.state === 'running')
        // What Althar tells the first's lead takes it a moment, once it is delivered.
        const envelope = yield* Runtime.envelope('thread.send', {}, undefined, instance.systemId)
        yield* sessions.send({
          envelope,
          threadId: first.threadId,
          body: 'Look again. [answers-after:1s]',
          disposition: 'after_current',
          quiet: true,
        })
        yield* until(
          Effect.map(waitsOn(first.threadId), (since) => (since === null ? [] : [since])),
          (rows) => rows.length === 1,
        )
        return { first, second, turns: (yield* turnsOn(first.threadId)).length }
      }).pipe(Effect.provide(oneAtOnce({}, file)))

      yield* Effect.gen(function* () {
        const tasks = yield* Tasks
        const { first, second, turns } = before
        yield* until(attempts(second.taskId), (rows) => rows.at(-1)?.state === 'running', Duration.seconds(15))
        yield* tasks.stop({ envelope: yield* Runtime.envelope('task.stop', {}), taskId: second.taskId })
        const told = yield* until(
          turnsOn(first.threadId),
          (rows) => rows.length === turns + 1 && rows.at(-1)?.state === 'completed',
          Duration.seconds(15),
        )
        assert.include(told.at(-1)?.prompt, 'Look again.')
        assert.isNull(yield* waitsOn(first.threadId))
      }).pipe(Effect.provide(oneAtOnce({}, file)))
    }),
  )
})

describe('a task under way whose next turn waits for a place', () => {
  it.live('continues up next ahead of new work, and leaves it once its turn starts', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const tasks = yield* Tasks
      const queries = yield* Queries
      const instance = yield* Instance
      const projectId = yield* opened
      /** The cards waiting for a place, by title, in the order the board's Up next lists them, and whether each continues. */
      const upNext = Effect.gen(function* () {
        const board = yield* Effect.orDie(queries.board(projectId))
        return board.tasks
          .filter((task) => task.phase === 'running' && task.place !== undefined)
          .toSorted((a, b) => (a.place ?? 0) - (b.place ?? 0))
          .map((task) => [task.title, task.place, task.continues === true ? 'continues' : task.inLine === true ? 'line' : '?'])
      })
      const first = yield* started(projectId, 'Under way', 'Do it. [lead:finish]')
      yield* until(attempts(first.taskId), (rows) => rows[0]?.state === 'succeeded')
      const holder = yield* started(projectId, 'Holding the place', 'Work on it. [lead:wait]')
      yield* until(attempts(holder.taskId), (rows) => rows[0]?.state === 'running')
      const fresh = yield* started(projectId, 'New work', 'Work on it. [lead:wait]')
      yield* until(attempts(fresh.taskId), (rows) => rows[0]?.holdReason === 'machine_busy')
      // Althar tells the first's lead its checks failed: its next turn waits, though it waited after the new work began to.
      const envelope = yield* Runtime.envelope('thread.send', {}, undefined, instance.systemId)
      yield* sessions.send({
        envelope,
        threadId: first.threadId,
        body: 'The checks failed. [answers-after:3s]',
        disposition: 'after_current',
        quiet: true,
      })
      yield* until(
        Effect.map(waitsOn(first.threadId), (since) => (since === null ? [] : [since])),
        (rows) => rows.length === 1,
      )
      // It continues first, as work under way (ADR-037), then the line: the holder, at work, is in neither.
      assert.deepStrictEqual(yield* until(upNext, (rows) => rows.length === 2), [
        ['Under way', 1, 'continues'],
        ['New work', 2, 'line'],
      ])
      const card = (taskId: string) =>
        Effect.map(Effect.orDie(queries.board(projectId)), (board) => board.tasks.find((task) => task.taskId === taskId))
      assert.strictEqual((yield* card(first.taskId))?.phase, 'running')
      assert.isUndefined((yield* card(holder.taskId))?.continues)
      // The place frees: its turn has it before the new work, and it leaves Up next, which the new work leads.
      yield* tasks.stop({ envelope: yield* Runtime.envelope('task.stop', {}), taskId: holder.taskId })
      assert.deepStrictEqual(yield* until(upNext, (rows) => rows.length === 1), [['New work', 1, 'line']])
      const going = yield* card(first.taskId)
      assert.strictEqual(going?.phase, 'running')
      assert.isUndefined(going?.continues)
      assert.isUndefined(going?.place)
    }).pipe(Effect.provide(oneAtOnce())),
  )
})

describe('the line, where two tasks waited since the same moment', () => {
  it.live('keeps them apart when the person puts another first, each after the one before it', () =>
    Effect.gen(function* () {
      const busy = yield* Busy
      const sql = yield* SqlClient.SqlClient
      const queries = yield* Queries
      const projectId = yield* opened
      const lineOn = Effect.gen(function* () {
        const board = yield* Effect.orDie(queries.board(projectId))
        return board.tasks
          .filter((task) => task.inLine === true)
          .toSorted((a, b) => (a.place ?? 0) - (b.place ?? 0))
          .map((task) => task.title)
      })
      const first = yield* started(projectId, 'First', 'Work on it. [lead:wait]')
      yield* until(attempts(first.taskId), (rows) => rows[0]?.state === 'running')
      const waits = []
      for (const title of ['Second', 'Third', 'Fourth']) {
        const task = yield* started(projectId, title, 'Work on it. [lead:wait]')
        yield* until(attempts(task.taskId), (rows) => rows[0]?.holdReason === 'machine_busy')
        waits.push(task)
      }
      const [second, third, fourth] = waits
      // The second and third waited since the same moment, as an earlier Althar kept them.
      const [kept] = yield* sql<{ output: string }>`
        SELECT a.output FROM node_attempts a JOIN nodes n ON n.id = a.node_id JOIN workflow_executions e ON e.id = n.execution_id
        JOIN runs r ON r.id = e.run_id WHERE r.task_id = ${second?.taskId ?? ''}`
      yield* sql`
        UPDATE node_attempts SET output = ${kept?.output ?? ''} WHERE id IN (
          SELECT a.id FROM node_attempts a JOIN nodes n ON n.id = a.node_id JOIN workflow_executions e ON e.id = n.execution_id
          JOIN runs r ON r.id = e.run_id WHERE r.task_id = ${third?.taskId ?? ''})`
      assert.isTrue(yield* busy.move(fourth?.taskId ?? '', 0))
      assert.deepStrictEqual(yield* lineOn, ['Fourth', 'Second', 'Third'])
      const order = yield* sql<{ title: string; lineAt: string }>`
        SELECT title, line_at FROM tasks WHERE title IN ('Second', 'Third', 'Fourth') ORDER BY line_at`
      assert.deepStrictEqual(
        order.map((row) => row.title),
        ['Fourth', 'Second', 'Third'],
      )
      assert.isTrue((order[1]?.lineAt ?? '') < (order[2]?.lineAt ?? ''))
    }).pipe(Effect.provide(oneAtOnce())),
  )
})

describe('an answer kept for a place, as answers once were', () => {
  it.live('starts the lead for it where the one that asked has gone since', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const sql = yield* SqlClient.SqlClient
      const projectId = yield* opened
      const first = yield* started(projectId, 'First', 'Work on it. [lead:wait]')
      yield* until(attempts(first.taskId), (rows) => rows[0]?.state === 'running')
      // Its first turn stopped, its lead asks the person something.
      yield* until(turnsOn(first.threadId), (rows) => rows.some((row) => row.state === 'delivered'))
      yield* sessions.interrupt(first.threadId)
      yield* until(turnsOn(first.threadId), (rows) => rows.every((row) => row.state !== 'delivered'))
      yield* sessions.send({
        envelope: yield* Runtime.envelope('thread.send', {}),
        threadId: first.threadId,
        body: scenarios.question,
        disposition: 'after_current',
      })
      const [question] = yield* until(
        sql<{ id: string }>`
          SELECT id FROM attention_requests WHERE kind = 'question' AND state = 'open' AND json_extract(payload, '$.threadId') = ${first.threadId}`,
        (rows) => rows.length === 1,
      )
      const second = yield* started(projectId, 'Second', 'Work on it. [lead:wait]')
      yield* until(attempts(second.taskId), (rows) => rows[0]?.state === 'running')
      // Its lead goes; the question stays the person's to answer, and an earlier Althar kept the answer for a place.
      yield* sessions.stop(first.threadId)
      yield* (yield* Questions).answer({
        envelope: yield* Runtime.envelope('attention.answer_question', { attentionId: question?.id ?? '' }),
        attentionId: question?.id ?? '',
        answers: { database: { values: ['sqlite'] } },
        keep: true,
      })
      yield* (yield* Busy).wake
      // It is the person's, so it goes at once: a lead starts on the thread and reads it.
      const said = yield* until(
        Effect.map(items(first.threadId), (all) =>
          all.flatMap((item) => (item.kind === 'agent_message' ? [String(item.content.text)] : [])),
        ),
        (texts) => texts.some((text) => text.startsWith('told=')),
      )
      assert.include(
        said.find((text) => text.startsWith('told=')),
        'sqlite',
      )
      assert.lengthOf(yield* sql`SELECT id FROM provider_sessions WHERE thread_id = ${first.threadId}`, 2)
    }).pipe(Effect.provide(oneAtOnce({ askGrace: Duration.millis(0) }))),
  )
})

describe('a review that waits for a place of its own', () => {
  it.live('is gone on without when the person skips it, and its reviewer never starts again', () => {
    // Out until three seconds after it first turns the review away, while the other's lead is at work.
    const out = outFor(3_000)
    return Effect.gen(function* () {
      const runs = yield* Runs
      const sessions = yield* Sessions
      const sql = yield* SqlClient.SqlClient
      const policies = yield* Policies
      const instance = yield* Instance
      const projectId = yield* opened
      yield* policies.setUsageLimit(projectId, 'wait', instance.personId)
      const task = yield* started(projectId, 'Reviewed', 'Do it. [lead:hold] [review:pass]', [
        { key: 'implement', agentId: 'claude-code' },
        { key: 'review', agentId: 'codex' },
      ])
      // Its lead keeps the one place while another task's lead is put in line behind it.
      yield* until(attempts(task.taskId), (rows) => rows.at(-1)?.state === 'running', Duration.seconds(15))
      const other = yield* started(projectId, 'Hold the place', 'Work on it. [lead:hold]', [{ key: 'implement', agentId: 'opencode' }])
      yield* until(attempts(other.taskId), (rows) => rows.at(-1)?.holdReason === 'machine_busy', Duration.seconds(15))
      // Told to finish, it hands the place to its review, whose reviewer is out of usage until its reset: the other's lead
      // takes the place meanwhile.
      yield* sessions.send({
        envelope: yield* Runtime.envelope('thread.send', {}),
        threadId: task.threadId,
        body: '[lead:finish]',
        disposition: 'interrupt_and_continue',
      })
      yield* until(attempts(other.taskId), (rows) => rows.at(-1)?.state === 'running', Duration.seconds(15))
      // At the reset there is none: the review waits for a place of its own.
      yield* until(
        attempts(task.taskId),
        (rows) => rows.at(-1)?.step === 'review' && rows.at(-1)?.holdReason === 'machine_busy',
        Duration.seconds(15),
      )
      const reviewers = sql`SELECT s.id FROM provider_sessions s JOIN threads t ON t.id = s.thread_id WHERE t.task_id = ${task.taskId} AND t.kind = 'step'`
      const before = (yield* reviewers).length
      yield* runs.skipReview({ envelope: yield* Runtime.envelope('run.skip_review', {}), taskId: task.taskId })
      const [run] = yield* sql<{ state: string }>`SELECT state FROM runs WHERE task_id = ${task.taskId}`
      assert.strictEqual(run?.state, 'succeeded')
      assert.deepStrictEqual(
        (yield* attempts(task.taskId)).map((row) => [row.step, row.state]),
        [
          ['implement', 'succeeded'],
          ['review', 'cancelled'],
        ],
      )
      yield* Effect.sleep('300 millis')
      assert.lengthOf(yield* reviewers, before)
    }).pipe(Effect.provide(oneAtOnce({}, ':memory:', { each: { codex: { outOfUsage: out } } })))
  })
})
