import type { ActorId, ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'
import { TestClock } from 'effect/testing'

import { Coordinator } from '../src/Coordinator'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { timingsFrom, toolClock } from '../src/turnTimes'
import { onTestClock, repository, runtime, until } from './support'

/*
 * Where a turn's time goes (a task is a conversation plus parts): each turn
 * keeps, as it ends, how long it waited for a place among the agents at work
 * here, how long its session took to start where it was the session's
 * first, and the agent's own work, of which its tools are a part. A thread's
 * page carries them by turn, and a task adds up all of its own.
 */

const GB = 1024 ** 3

/** The runtime, on a machine that runs one agent at once, with the queries the screens read. */
const oneAtOnce = () => Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', {}, { busy: { machine: { cores: 3, memory: 7 * GB } } })))

const opened = Effect.gen(function* () {
  const projects = yield* Projects
  const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
  yield* (yield* Coordinator).thread(project.projectId)
  return project.projectId as ProjectId
})

const person = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const [row] = yield* sql<{ id: string }>`SELECT id FROM actors WHERE kind = 'person'`
  return (row?.id ?? '') as ActorId
})

/** A task whose plan, its lead Codex, with no review, the person starts now. */
const started = (projectId: ProjectId, title: string, description: string) =>
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
      steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
      reason: null,
      actorId: actor,
      end: null,
      held: true,
    })
    return { ...created, outcome: yield* plans.start(planId, actor) }
  })

/** The turns on a thread that ended, oldest first, with where their time went. */
const ended = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ id: string; timings: string | null }>`
      SELECT id, timings FROM turn_deliveries WHERE thread_id = ${threadId} AND ended_at IS NOT NULL ORDER BY requested_at, rowid`
    return rows.map((row) => ({ id: row.id, timings: timingsFrom(row.timings) }))
  })

const say = (threadId: string, body: string, disposition: 'after_current' | 'interrupt_and_continue' = 'after_current') =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    yield* sessions.send({ envelope: yield* Runtime.envelope('thread.send', { threadId, body }), threadId, body, disposition })
  })

describe('Where a turn’s time goes', () => {
  it('counts a turn’s tools once where several run at once, and one still open up to the turn’s end', () => {
    const clock = toolClock()
    clock.heard({ _tag: 'ToolCall', toolCallId: 'a', title: 'Read', kind: 'read', status: 'in_progress' }, 1_000)
    clock.heard({ _tag: 'ToolCall', toolCallId: 'b', title: 'Grep', kind: 'search', status: 'pending' }, 1_500)
    clock.heard({ _tag: 'ToolCallUpdate', toolCallId: 'a', status: 'completed' }, 3_000)
    clock.heard({ _tag: 'ToolCallUpdate', toolCallId: 'b', status: 'failed' }, 4_000)
    // A call that arrives already over, and an update for a call never heard, take nothing.
    clock.heard({ _tag: 'ToolCall', toolCallId: 'c', title: 'Read', kind: 'read', status: 'completed' }, 5_000)
    clock.heard({ _tag: 'ToolCallUpdate', toolCallId: 'd', title: 'Edit' }, 5_000)
    clock.heard({ _tag: 'AgentMessage', text: 'Done.' }, 5_500)
    assert.strictEqual(clock.total(6_000), 3_000)
    clock.heard({ _tag: 'ToolCallUpdate', toolCallId: 'e', status: 'in_progress' }, 7_000)
    assert.strictEqual(clock.total(9_000), 5_000)
  })

  it('reads what the store keeps, and nothing from what it can’t read', () => {
    assert.isNull(timingsFrom(null))
    assert.isNull(timingsFrom('not json'))
    assert.isNull(timingsFrom('3'))
    assert.deepStrictEqual(timingsFrom('{"place":12.4,"session":-3,"starting":"other","work":100,"tools":250}'), {
      place: 12,
      session: 0,
      starting: null,
      work: 100,
      tools: 100,
    })
  })

  it.effect('keeps each turn’s wait for a place, its session’s start, and its work, and a thread and its task read them', () =>
    Effect.gen(function* () {
      const projectId = yield* opened
      const first = yield* started(projectId, 'First', 'Work on it. [lead:wait]')
      assert.strictEqual(first.outcome, 'running')
      yield* until(
        Effect.flatMap(
          SqlClient.SqlClient,
          (sql) => sql`SELECT id FROM turn_deliveries WHERE thread_id = ${first.threadId} AND state = 'delivered'`,
        ),
        (rows) => rows.length === 1,
      )
      // The second waits for the first's place: half a minute passes before it has one.
      const second = yield* started(projectId, 'Second', 'Do it. [lead:finish]')
      assert.strictEqual(second.outcome, 'waiting')
      yield* TestClock.adjust(Duration.seconds(30))
      yield* say(first.threadId, '[lead:finish]', 'interrupt_and_continue')
      const [turn] = yield* until(ended(second.threadId), (rows) => rows.length > 0)
      const timings = turn?.timings
      assert.isNotNull(timings)
      assert.isAtLeast(timings?.place ?? 0, 30_000)
      // Its session started for the work, so it counts that start, and its work holds its tools.
      assert.strictEqual(timings?.starting, 'start')
      assert.isAtLeast(timings?.work ?? -1, timings?.tools ?? 0)
      // The first never waited for a place.
      const [firstTurn] = yield* until(ended(first.threadId), (rows) => rows.length > 0)
      assert.isBelow(firstTurn?.timings?.place ?? Infinity, 30_000)
      assert.strictEqual(firstTurn?.timings?.starting, 'start')

      // Its thread's page carries the turn its items came in, .
      const queries = yield* Queries
      const snapshot = yield* Effect.orDie(queries.thread(second.threadId))
      const read = snapshot.turns?.find((one) => one.id === turn?.id)
      assert.isDefined(read)
      assert.isTrue(snapshot.items.some((item) => item.turn === turn?.id))
    }).pipe(Effect.provide(oneAtOnce()), onTestClock),
  )

  it.effect('counts a session’s start only in its first turn', () =>
    Effect.gen(function* () {
      const projectId = yield* opened
      const task = yield* started(projectId, 'Talked to', 'Do it. [lead:finish]')
      assert.strictEqual(task.outcome, 'running')
      yield* until(ended(task.threadId), (rows) => rows.length === 1)
      yield* say(task.threadId, 'And one more thing.')
      const turns = yield* until(ended(task.threadId), (rows) => rows.length === 2)
      assert.strictEqual(turns[0]?.timings?.starting, 'start')
      assert.isNull(turns[1]?.timings?.starting)
      assert.strictEqual(turns[1]?.timings?.session, 0)
    }).pipe(Effect.provide(oneAtOnce()), onTestClock),
  )
})
