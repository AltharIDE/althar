import type { ProjectId } from '@althar/domain'
import { recorded } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Connectivity } from '../src/Connectivity'
import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { Runs } from '../src/Runs'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { items, repository, runtime, until } from './support'

/*
 * A step whose connection fails (ADR-060), from what the agents really said
 * when theirs did (provider-adapters/src/testing/recorded.ts): it isn't a
 * missing report, so it is never reminded. Offline, or its service out of
 * reach, the step waits for the connection and carries on by itself once the
 * computer is back and the service answers; a service that answers and keeps
 * failing is tried again after growing pauses, and then the step needs the
 * person. While the computer is offline, new work waits rather than start.
 */

/** Where the fake agents' connection, and their services, stand: as each test sets them. */
const connection = () => {
  const state: { down: 'offline' | 'server' | 'waits' | undefined; answers: boolean } = { down: undefined, answers: true }
  const layer = Queries.layer.pipe(
    Layer.provideMerge(
      runtime(
        ':memory:',
        { connection: () => state.down },
        {
          connectivity: {
            answers: () => Effect.sync(() => state.answers),
            pauses: [Duration.millis(30), Duration.millis(60), Duration.millis(90)],
            every: Duration.millis(50),
          },
        },
      ),
    ),
  )
  return { state, layer }
}

/** A task planned on its lead alone, which finishes its step whenever it is told to, started now. */
const planned = (agentId: string) =>
  Effect.gen(function* () {
    const plans = yield* Plans
    const projects = yield* Projects
    const instance = yield* Instance
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
    const task = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', {}),
      projectId: project.projectId,
      title: 'Retry the checkout',
      description: 'Fix the heading. [lead:finish]',
      draft: true,
    })
    const planId = yield* plans.propose({
      projectId: project.projectId as ProjectId,
      taskId: task.taskId,
      steps: [{ key: 'implement', agentId, model: null, skipped: false }],
      reason: null,
      actorId: instance.personId,
      held: true,
    })
    yield* plans.start(planId, instance.personId)
    return { projectId: project.projectId, ...task }
  })

/** The task's Implement attempt, once it stands as asked: where it stands, why it is held, and what it keeps. */
const implementOf = (taskId: string, stands: (attempt: { state: string; holdReason: string | null }) => boolean) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [attempt] = yield* until(
      sql<{ state: string; holdReason: string | null; output: string | null }>`
        SELECT a.state, a.hold_reason, a.output FROM node_attempts a JOIN nodes n ON n.id = a.node_id
        JOIN workflow_executions e ON e.id = n.execution_id JOIN runs r ON r.id = e.run_id
        WHERE r.task_id = ${taskId} AND n.node_key = 'implement' ORDER BY a.admitted_at DESC LIMIT 1`,
      (rows) => rows[0] !== undefined && stands(rows[0]),
      Duration.seconds(15),
    )
    return attempt ?? { state: '', holdReason: null, output: null }
  })

const heldForConnection = (attempt: { state: string; holdReason: string | null }) =>
  attempt.state === 'held' && attempt.holdReason === 'agent_unavailable'

/** The task's card, as the coordinator's thread shows it. */
const cardOf = (projectId: string, taskId: string) =>
  Effect.gen(function* () {
    const snapshot = yield* Effect.orDie((yield* Queries).coordinator(projectId))
    return snapshot.items.flatMap((item) => (item.kind === 'task' && item.content.taskId === taskId ? [item.content] : []))[0]
  })

/** The thread's turns, oldest first: how each ended, and what it was told. */
const turnsOf = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ state: string; errorClass: string | null; prompt: string | null }>`
      SELECT state, error_class, prompt FROM turn_deliveries WHERE thread_id = ${threadId} ORDER BY requested_at, rowid`
  })

const stuckCalls = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{
      id: string
      payload: string
    }>`SELECT id, payload FROM attention_requests WHERE task_id = ${taskId} AND kind = 'stuck'`
  })

const notices = (threadId: string) =>
  Effect.map(items(threadId), (all) => all.flatMap((item) => (item.kind === 'notice' ? [(item.content as { title: string }).title] : [])))

describe('a step whose connection is lost', () => {
  it.live(
    "waits for the connection, unreminded, and carries on by itself once it's back (Claude Code, offline)",
    () => {
      const { state, layer } = connection()
      return Effect.gen(function* () {
        const connectivity = yield* Connectivity
        // The network goes as the step starts: its turn ends as Claude Code's did, and its service can't be reached.
        state.down = 'offline'
        state.answers = false
        const task = yield* planned('claude-code')
        const held = yield* implementOf(task.taskId, heldForConnection)
        assert.include(JSON.parse(held.output ?? '{}'), { heldFor: 'claude-code', offline: true, tries: 0, service: 'Anthropic' })
        yield* connectivity.set(false)
        // Under way with no agent at work, it continues by itself: up next, not running (ADR-063).
        const [card] = yield* until(
          Effect.map(cardOf(task.projectId, task.taskId), (one) => (one === undefined ? [] : [one])),
          ([one]) => one?.continues === true,
        )
        assert.strictEqual(card?.phase, 'running')
        // Held as soon as Claude Code warned it was reconnecting, or once its turn gave up: with what it said.
        const { failure, ...reconnects } = card?.reconnects ?? { failure: null }
        assert.deepStrictEqual(reconnects, { agentId: 'claude-code', service: 'Anthropic', offline: true, next: null })
        assert.include([recorded.claude.offline.title, 'Reconnecting to Claude, attempt 1 of 10.'], failure)
        assert.include(
          yield* notices(task.threadId),
          "Lost the connection to Anthropic. The work waits for it, and carries on by itself when it's back.",
        )
        // Waited out a while offline, it is still only waiting: no reminder, no call for the person.
        yield* Effect.sleep(Duration.millis(300))
        assert.lengthOf(yield* turnsOf(task.threadId), 1)
        assert.lengthOf(yield* stuckCalls(task.taskId), 0)
        // Back: the computer says so, and Anthropic answers. The step's turn goes again in the same session, and it finishes.
        state.down = undefined
        state.answers = true
        yield* connectivity.set(true)
        yield* implementOf(task.taskId, (attempt) => attempt.state === 'succeeded')
        const turns = yield* until(turnsOf(task.threadId), (all) => all[1]?.state === 'completed', Duration.seconds(10))
        assert.deepStrictEqual(
          turns.map((turn) => turn.state),
          [turns[0]?.state === 'interrupted' ? 'interrupted' : 'failed', 'completed'],
        )
        assert.include(turns[1]?.prompt ?? '', "Your last turn stopped because the connection to your model's service failed.")
        assert.include(yield* notices(task.threadId), 'The connection is back; the step carried on from here.')
        assert.lengthOf(yield* stuckCalls(task.taskId), 0)
      }).pipe(Effect.provide(layer))
    },
    30_000,
  )

  it.live(
    "stops a turn that waits on a dead connection, and carries on once it's back (Codex, offline)",
    () => {
      const { state, layer } = connection()
      return Effect.gen(function* () {
        // Codex, offline, says it waits for the network, and its turn never ends: OpenAI's service doesn't answer.
        state.down = 'waits'
        state.answers = false
        const task = yield* planned('codex')
        const held = yield* implementOf(task.taskId, heldForConnection)
        assert.include(JSON.parse(held.output ?? '{}'), { heldFor: 'codex', offline: true, service: 'OpenAI' })
        // The turn that waited is stopped, not left to the stall watch.
        const [first] = yield* until(turnsOf(task.threadId), (turns) => turns[0]?.state === 'interrupted', Duration.seconds(10))
        assert.strictEqual(first?.state, 'interrupted')
        state.down = undefined
        state.answers = true
        yield* implementOf(task.taskId, (attempt) => attempt.state === 'succeeded')
        assert.lengthOf(yield* stuckCalls(task.taskId), 0)
      }).pipe(Effect.provide(layer))
    },
    30_000,
  )

  it.live(
    'is tried again after growing pauses while its service answers but keeps failing, and then needs the person',
    () => {
      const { state, layer } = connection()
      return Effect.gen(function* () {
        // Anthropic answers, with errors: Claude Code's turn ends each time as it did given a 500.
        state.down = 'server'
        const task = yield* planned('claude-code')
        const sql = yield* SqlClient.SqlClient
        const [call] = yield* until(stuckCalls(task.taskId), (calls) => calls.length === 1, Duration.seconds(15))
        const stuck = JSON.parse(call?.payload ?? '{}') as { why: string; detail: string | null; service?: string; agentId: string }
        assert.deepStrictEqual(
          [stuck.why, stuck.detail, stuck.service, stuck.agentId],
          ['transient', recorded.claude.serverError.title, 'Anthropic', 'claude-code'],
        )
        // Its first turn and three tries again, after each pause; never reminded.
        assert.deepStrictEqual(
          (yield* turnsOf(task.threadId)).map((turn) => [turn.state, turn.errorClass]),
          Array.from({ length: 4 }, () => ['failed', 'transient']),
        )
        // Each pause said, the person's to read, none of them a call.
        assert.deepStrictEqual(
          (yield* notices(task.threadId)).filter((title) => title.startsWith('Anthropic failed, so the work waits')),
          [
            'Anthropic failed, so the work waits: Althar tries again in 0 seconds.',
            'Anthropic failed, so the work waits: Althar tries again in 0 seconds.',
            'Anthropic failed, so the work waits: Althar tries again in 0 seconds.',
          ],
        )
        // Try again, once Anthropic is back: the step's turn runs again in the same session, and finishes.
        state.down = undefined
        const runs = yield* Runs
        yield* runs.answerStuck({
          envelope: yield* Runtime.envelope('attention.answer_stuck', {}),
          attentionId: call?.id ?? '',
          answer: { kind: 'retry', agentId: 'claude-code' },
        })
        yield* implementOf(task.taskId, (attempt) => attempt.state === 'succeeded')
        const sessions = yield* sql<{ id: string }>`SELECT id FROM provider_sessions WHERE thread_id = ${task.threadId}`
        assert.lengthOf(sessions, 1)
      }).pipe(Effect.provide(layer))
    },
    30_000,
  )

  it.live(
    'keeps new work waiting in Up next while the computer is offline, and starts it once it is back',
    () => {
      const { layer } = connection()
      return Effect.gen(function* () {
        const connectivity = yield* Connectivity
        yield* connectivity.set(false)
        const task = yield* planned('claude-code')
        const waiting = yield* implementOf(task.taskId, (attempt) => attempt.state === 'held')
        assert.strictEqual(waiting.holdReason, 'machine_busy')
        yield* Effect.sleep(Duration.millis(300))
        assert.lengthOf(yield* turnsOf(task.threadId), 0)
        assert.isTrue((yield* cardOf(task.projectId, task.taskId))?.inLine === true)
        yield* connectivity.set(true)
        yield* implementOf(task.taskId, (attempt) => attempt.state === 'succeeded')
      }).pipe(Effect.provide(layer))
    },
    30_000,
  )
})

describe('a coordinator turn whose connection is lost', () => {
  it.live(
    'ends in its error, keeps what the person said, and sends it again on Try again',
    () => {
      const { state, layer } = connection()
      return Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const projects = yield* Projects
        const coordinator = yield* Coordinator
        const sessions = yield* Sessions
        const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
        const threadId = yield* coordinator.thread(project.projectId)
        // Offline, Claude Code ends the coordinator's turn as it did: the failure only on the prompt's response.
        state.down = 'offline'
        const body = 'What is left on the checkout?'
        yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
        yield* until(turnsOf(threadId), (turns) => turns[0]?.state === 'failed', Duration.seconds(10))
        assert.deepStrictEqual(
          (yield* turnsOf(threadId)).map((turn) => [turn.state, turn.errorClass]),
          [['failed', 'transient']],
        )
        // The turn ends in its error, as the chat shows it, with Try again under it.
        const [last] = (yield* items(threadId)).filter((item) => item.kind === 'notice').slice(-1)
        assert.deepInclude(last?.content, {
          severity: 'error',
          title: "Fake claude-code couldn't answer.",
          description: recorded.claude.offline.title,
          failure: 'transient',
        })
        // What the person said waits for it, rather than lost.
        const waiting = yield* sql<{ body: string }>`SELECT body FROM user_inputs WHERE thread_id = ${threadId} AND state = 'queued'`
        assert.deepStrictEqual(
          waiting.map((input) => input.body),
          [body],
        )
        // Back, Try again sends it again, to the same session, and it is answered.
        state.down = undefined
        assert.isTrue(yield* sessions.tryAgain(threadId))
        const turns = yield* until(turnsOf(threadId), (all) => all[1]?.state === 'completed', Duration.seconds(10))
        assert.include(turns[1]?.prompt ?? '', body)
        const kept = yield* sql<{ id: string }>`SELECT id FROM provider_sessions WHERE thread_id = ${threadId}`
        assert.lengthOf(kept, 1)
        // Its last turn answered, there is nothing to try again.
        assert.isFalse(yield* sessions.tryAgain(threadId))
      }).pipe(Effect.provide(layer))
    },
    30_000,
  )
})
