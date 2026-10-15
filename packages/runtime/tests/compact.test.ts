import type { ActorId, ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { Coordinator } from '../src/Coordinator'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { COMPACT, compactedWords, Sessions } from '../src/Sessions'
import { notices, repository, runtime, until } from './support'

/*
 * The person can have an agent compact its context (`CompactContext`): its
 * own command, sent bare as a turn of its own, after what it was told
 * before. It never waits for a place among the agents at work, and the
 * thread says how far it took the context. The fake agent answers `/compact`
 * by saying its context holds a tenth of what it may.
 */

const GB = 1024 ** 3

/** The runtime on a machine that runs one task's agents at a time. */
const oneAtOnce = () => Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', {}, { busy: { machine: { cores: 3, memory: 7 * GB } } })))

const opened = Effect.gen(function* () {
  const projects = yield* Projects
  const coordinator = yield* Coordinator
  const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
  yield* coordinator.thread(project.projectId)
  return project.projectId as ProjectId
})

const person = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const [row] = yield* sql<{ id: string }>`SELECT id FROM actors WHERE kind = 'person'`
  return (row?.id ?? '') as ActorId
})

/** A task whose plan, its lead Codex and no review, the person starts now. */
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
    yield* plans.start(planId, actor)
    return created
  })

const say = (threadId: string, body: string) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    yield* sessions.send({
      envelope: yield* Runtime.envelope('thread.send', { threadId, body }),
      threadId,
      body,
      disposition: 'after_current',
    })
  })

const compact = (threadId: string) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    yield* sessions.compact({ envelope: yield* Runtime.envelope('thread.compact', { threadId }), threadId })
  })

/** What the thread's turns were prompted with, oldest first. */
const prompts = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ prompt: string; state: string }>`
      SELECT prompt, state FROM turn_deliveries WHERE thread_id = ${threadId} ORDER BY requested_at, rowid`
  })

/** Waits until the thread has had this many turns, each over, and its agent waits for the next. */
const answered = (threadId: string, count: number) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    yield* until(
      prompts(threadId),
      (rows) => rows.length === count && rows.every((row) => row.state !== 'pending' && row.state !== 'delivered'),
    )
    yield* until(
      Effect.map(sessions.running(threadId), (running) => (Option.isSome(running) && !running.value.turnRunning ? [true] : [])),
      (rows) => rows.length === 1,
    )
  })

/** The step attempts of a task, oldest first. */
const attempts = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ state: string }>`
      SELECT a.state FROM node_attempts a JOIN nodes n ON n.id = a.node_id JOIN workflow_executions e ON e.id = n.execution_id
      JOIN runs r ON r.id = e.run_id WHERE r.task_id = ${taskId} ORDER BY a.admitted_at, a.rowid`
  })

const titles = (threadId: string) => Effect.map(notices(threadId), (said) => said.map((notice) => notice.title))

describe('what a compaction says', () => {
  it('from how full to how full, where the agent said both and it went down; else only that it did', () => {
    assert.strictEqual(compactedWords('Codex', { used: 412_000 }, { used: 38_400 }), "Compacted Codex's context: 412k → 38k tokens.")
    assert.strictEqual(compactedWords('Codex', { used: 1_250_000 }, { used: 90_000 }), "Compacted Codex's context: 1.3M → 90k tokens.")
    assert.strictEqual(compactedWords('Codex', null, { used: 38_400 }), "Compacted Codex's context.")
    assert.strictEqual(compactedWords('Codex', { used: 38_000 }, { used: 38_000 }), "Compacted Codex's context.")
  })
})

describe('compacting an agent’s context', () => {
  it.live('sends the agent its own command, bare, as a turn of its own, and says how far it took the context', () =>
    Effect.gen(function* () {
      const projectId = yield* opened
      const task = yield* started(projectId, 'First', 'Do it. [lead:finish]')
      yield* answered(task.threadId, 1)
      // A quarter of a million-token window: past where a lead is handed over, but the person asked to compact.
      yield* say(task.threadId, 'Look again. [context:25/1000000]')
      yield* answered(task.threadId, 2)
      yield* compact(task.threadId)
      yield* answered(task.threadId, 3)
      const [, , compacted] = yield* prompts(task.threadId)
      assert.deepStrictEqual(compacted, { prompt: COMPACT, state: 'completed' })
      assert.include(yield* titles(task.threadId), "Compacted Fake codex's context: 250k → 100k tokens.")
      // It isn't the person's message, and it wasn't handed over: the same session, a tenth as full.
      const sql = yield* SqlClient.SqlClient
      const said = yield* sql<{ text: string }>`
        SELECT json_extract(content, '$.text') AS text FROM thread_items WHERE thread_id = ${task.threadId} AND kind = 'user_message'`
      assert.notInclude(
        said.map((row) => row.text),
        COMPACT,
      )
      const sessions = yield* sql<{ id: string }>`SELECT id FROM provider_sessions WHERE thread_id = ${task.threadId}`
      assert.lengthOf(sessions, 1)
    }).pipe(Effect.provide(oneAtOnce())),
  )

  it.live('never waits for a place among the agents at work', () =>
    Effect.gen(function* () {
      const projectId = yield* opened
      const first = yield* started(projectId, 'First', 'Do it. [lead:finish]')
      yield* answered(first.threadId, 1)
      yield* say(first.threadId, 'Look again. [context:10/1000000]')
      yield* answered(first.threadId, 2)
      // The one place this machine has goes to another task.
      const second = yield* started(projectId, 'Second', 'Work on it. [lead:wait]')
      yield* until(attempts(second.taskId), (rows) => rows[0]?.state === 'running')
      // Compacting the first's lead goes on all the same.
      yield* compact(first.threadId)
      yield* answered(first.threadId, 3)
      assert.strictEqual((yield* prompts(first.threadId))[2]?.prompt, COMPACT)
      assert.strictEqual((yield* attempts(second.taskId))[0]?.state, 'running')
    }).pipe(Effect.provide(oneAtOnce())),
  )

  it.live('is refused where no agent is on the thread', () =>
    Effect.gen(function* () {
      const projectId = yield* opened
      const projects = yield* Projects
      const made = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', { title: 'Idle' }),
        projectId,
        title: 'Idle',
        draft: true,
      })
      const refused = yield* Effect.flip(compact(made.threadId))
      assert.strictEqual(refused._tag, 'NotFound')
    }).pipe(Effect.provide(oneAtOnce())),
  )
})
