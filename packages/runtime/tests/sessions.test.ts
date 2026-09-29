import { assert, describe, it } from '@effect/vitest'
import { scenarios } from '@charrette/provider-adapters/testing'
import { Effect, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { AttentionClosed, NoSession, NotFound, SessionRunning } from '../src/errors'
import { Permissions } from '../src/Permissions'
import * as Runtime from '../src/Runtime'
import { promptFor, Sessions } from '../src/Sessions'
import { items, runtime, task, turns, until } from './support'

const say = (threadId: string, body: string, disposition: 'after_current' | 'interrupt_and_continue' = 'after_current') =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    return yield* sessions.send({ envelope: yield* Runtime.envelope('thread.send', { threadId, body }), threadId, body, disposition })
  })

const ended = (threadId: string, count: number) =>
  until(turns(threadId), (rows) => rows.filter((row) => !['pending', 'delivered'].includes(row.state)).length >= count)

const session = (sessionId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{
      state: string
      agentId: string
      model: string | null
      externalSessionId: string | null
      supersededBySessionId: string | null
    }>`
      SELECT state, agent_id, model, external_session_id, superseded_by_session_id FROM provider_sessions WHERE id = ${sessionId}`
    return row
  })

describe('sessions', () => {
  it.live('runs a turn and records it: the input, the reply, and how the turn ended', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const { task: created } = yield* task()
      const sessionId = yield* sessions.start({ threadId: created.threadId, agentId: 'claude-code' })
      assert.deepStrictEqual(yield* session(sessionId), {
        state: 'active',
        agentId: 'claude-code',
        model: 'small',
        externalSessionId: 'fake-1',
        supersededBySessionId: null,
      })

      yield* say(created.threadId, scenarios.hello)
      const [turn] = yield* ended(created.threadId, 1)
      assert.deepStrictEqual(
        { state: turn?.state, stopReason: turn?.stopReason, usage: JSON.parse(turn?.usage ?? 'null') },
        { state: 'completed', stopReason: 'end_turn', usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 } },
      )
      assert.deepStrictEqual(
        (yield* items(created.threadId)).map((item) => [item.kind, item.content.text]),
        [
          ['user_message', 'hello'],
          ['agent_message', 'Hello'],
        ],
      )
    }).pipe(Effect.provide(runtime())),
  )

  it.live('runs one session per thread, and says when there is none', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const { task: created } = yield* task()
      yield* sessions.start({ threadId: created.threadId, agentId: 'codex' })
      assert.instanceOf(yield* Effect.flip(sessions.start({ threadId: created.threadId, agentId: 'codex' })), SessionRunning)
      assert.isTrue(Option.isSome(yield* sessions.running(created.threadId)))
      yield* sessions.stop(created.threadId)
      assert.isTrue(Option.isNone(yield* sessions.running(created.threadId)))
      assert.instanceOf(yield* Effect.flip(sessions.stop(created.threadId)), NoSession)
      assert.instanceOf(yield* Effect.flip(sessions.setModel({ threadId: created.threadId, model: 'large' })), NoSession)
    }).pipe(Effect.provide(runtime())),
  )

  it.live('delivers input that arrived before the session started, and input sent during a turn after it', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const { task: created } = yield* task()
      yield* say(created.threadId, scenarios.think)
      yield* sessions.start({ threadId: created.threadId, agentId: 'codex' })
      yield* ended(created.threadId, 1)
      yield* say(created.threadId, scenarios.hello)
      yield* ended(created.threadId, 2)
      const kinds = (yield* items(created.threadId)).map((item) => item.kind)
      assert.deepStrictEqual(kinds, ['user_message', 'agent_thought', 'agent_message', 'user_message', 'agent_message'])
    }).pipe(Effect.provide(runtime())),
  )

  it.live('interrupts a turn and continues with the new input first', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const { task: created } = yield* task()
      yield* sessions.start({ threadId: created.threadId, agentId: 'codex' })
      yield* say(created.threadId, scenarios.slow)
      yield* until(items(created.threadId), (rows) => rows.some((item) => item.content.text === 'Starting'))
      yield* say(created.threadId, 'use the retry helper', 'interrupt_and_continue')
      const [first, second] = yield* ended(created.threadId, 2)
      assert.deepStrictEqual([first?.state, first?.stopReason, second?.state], ['interrupted', 'cancelled', 'completed'])
      const replies = (yield* items(created.threadId)).filter((item) => item.kind === 'agent_message').map((item) => item.content.text)
      assert.strictEqual(
        replies.at(-1),
        `echo: ${promptFor([{ body: 'use the retry helper', disposition: 'interrupt_and_continue' }], undefined)}`,
      )
    }).pipe(Effect.provide(runtime())),
  )

  it.live('records a tool call as one item, updated as it runs, and the permission it needed', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const sql = yield* SqlClient.SqlClient
      const { task: created } = yield* task()
      yield* sessions.start({ threadId: created.threadId, agentId: 'codex' })
      yield* say(created.threadId, scenarios.tool)
      yield* ended(created.threadId, 1)
      const tool = (yield* items(created.threadId)).filter((item) => item.kind === 'tool_call')
      assert.deepStrictEqual(
        tool.map((item) => [item.toolCallId, item.content.title, item.content.status]),
        [['call-1', 'Write hello.txt', 'completed']],
      )
      const decisions = yield* sql<{ outcome: string; scope: string; agentOptionId: string; state: string; actorKind: string }>`
        SELECT d.outcome, d.scope, d.agent_option_id, r.state, a.kind AS actor_kind FROM decisions d
        JOIN permission_requests r ON r.id = d.permission_request_id JOIN actors a ON a.id = d.decided_by_actor_id`
      assert.deepStrictEqual(decisions, [
        { outcome: 'allow', scope: 'once', agentOptionId: 'allow-once', state: 'decided', actorKind: 'system' },
      ])
    }).pipe(Effect.provide(runtime())),
  )

  it.live('asks the person about what the rules keep for them, and carries on with their answer', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const permissions = yield* Permissions
      const sql = yield* SqlClient.SqlClient
      const { task: created } = yield* task()
      const sessionId = yield* sessions.start({ threadId: created.threadId, agentId: 'codex' })
      yield* say(created.threadId, scenarios.commandChoices)
      const [attention] = yield* until(
        sql<{ id: string; payload: string }>`SELECT id, payload FROM attention_requests WHERE state = 'open'`,
        (rows) => rows.length === 1,
      )
      assert.strictEqual(JSON.parse(attention?.payload ?? '{}').reason, 'Deploying or publishing always asks.')
      assert.strictEqual((yield* session(sessionId))?.state, 'waiting_approval')
      yield* permissions.answer({
        envelope: yield* Runtime.envelope('attention.answer', {}),
        attentionId: attention?.id ?? '',
        decision: 'reject',
        reason: 'not from a task branch',
      })
      yield* ended(created.threadId, 1)
      assert.strictEqual((yield* session(sessionId))?.state, 'active')
      const [decision] = yield* sql<{ outcome: string; agentOptionId: string; reason: string; actorKind: string }>`
        SELECT d.outcome, d.agent_option_id, d.reason, a.kind AS actor_kind FROM decisions d JOIN actors a ON a.id = d.decided_by_actor_id`
      assert.deepStrictEqual(decision, {
        outcome: 'reject',
        agentOptionId: 'decline',
        reason: 'not from a task branch',
        actorKind: 'person',
      })
      const replies = (yield* items(created.threadId)).filter((item) => item.kind === 'agent_message').map((item) => item.content.text)
      assert.deepStrictEqual(replies, ['chosen=decline'])
    }).pipe(Effect.provide(runtime())),
  )

  it.live('withdraws a question to the person when the turn is interrupted', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const sql = yield* SqlClient.SqlClient
      const { task: created } = yield* task()
      const sessionId = yield* sessions.start({ threadId: created.threadId, agentId: 'codex' })
      yield* say(created.threadId, scenarios.commandChoices)
      yield* until(sql<{ id: string }>`SELECT id FROM attention_requests WHERE state = 'open'`, (rows) => rows.length === 1)
      yield* say(created.threadId, 'never mind', 'interrupt_and_continue')
      yield* ended(created.threadId, 2)
      const states = yield* sql<{ attention: string; request: string }>`
        SELECT a.state AS attention, r.state AS request FROM attention_requests a JOIN permission_requests r ON r.id = a.permission_request_id`
      assert.deepStrictEqual(states, [{ attention: 'withdrawn', request: 'cancelled' }])
      assert.strictEqual((yield* session(sessionId))?.state, 'active')
    }).pipe(Effect.provide(runtime())),
  )

  it.live('changes the model, and says so in the thread', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const { task: created } = yield* task()
      const sessionId = yield* sessions.start({ threadId: created.threadId, agentId: 'codex', model: 'large' })
      assert.strictEqual((yield* session(sessionId))?.model, 'large')
      yield* sessions.setModel({ threadId: created.threadId, model: 'small' })
      assert.strictEqual((yield* session(sessionId))?.model, 'small')
      assert.deepStrictEqual((yield* items(created.threadId)).at(-1)?.content.title, 'Model changed to small.')
    }).pipe(Effect.provide(runtime())),
  )

  it.live('hands the thread to another agent, briefed with what happened so far', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const { task: created } = yield* task('Add the retry helper')
      const first = yield* sessions.start({ threadId: created.threadId, agentId: 'claude-code' })
      yield* say(created.threadId, scenarios.hello)
      yield* ended(created.threadId, 1)
      const second = yield* sessions.switchAgent({ threadId: created.threadId, agentId: 'opencode' })
      yield* ended(created.threadId, 2)
      assert.deepStrictEqual(
        [yield* session(first), yield* session(second)].map((row) => [row?.state, row?.agentId, row?.supersededBySessionId]),
        [
          ['superseded', 'claude-code', second],
          ['active', 'opencode', null],
        ],
      )
      const reply = (yield* items(created.threadId)).filter((item) => item.kind === 'agent_message').at(-1)?.content.text as string
      assert.include(reply, 'You are taking over a task from Fake claude-code')
      assert.include(reply, 'Task: Add the retry helper')
      assert.include(reply, '[person] hello')
      assert.include(reply, '[claude-code] Hello')
      assert.include(reply, 'Carry on with the task from where it stands.')
    }).pipe(Effect.provide(runtime())),
  )

  it.live('records a usage limit against the account, with when it resets', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const sql = yield* SqlClient.SqlClient
      const { task: created } = yield* task()
      yield* sessions.start({ threadId: created.threadId, agentId: 'claude-code' })
      yield* say(created.threadId, scenarios.quota)
      const [turn] = yield* ended(created.threadId, 1)
      assert.deepStrictEqual([turn?.state, turn?.errorClass], ['failed', 'usage_limit'])
      const statuses = yield* sql<{ state: string; windows: string; agentId: string }>`
        SELECT s.state, s.windows, p.agent_id FROM account_statuses s JOIN principals p ON p.id = s.principal_id`
      assert.deepStrictEqual(
        statuses.map((row) => [row.state, row.agentId, JSON.parse(row.windows)]),
        [['limited', 'claude-code', [{ kind: 'usage', resetsAt: '2026-09-29T05:00:00.000Z' }]]],
      )
      const notice = (yield* items(created.threadId)).find((item) => item.kind === 'notice')
      assert.strictEqual(notice?.content.failure, 'usage_limit')
    }).pipe(Effect.provide(runtime())),
  )

  it.live('records a failed prompt as a failed turn, and the session carries on', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const { task: created } = yield* task()
      yield* sessions.start({ threadId: created.threadId, agentId: 'codex' })
      yield* say(created.threadId, scenarios.auth)
      yield* ended(created.threadId, 1)
      yield* say(created.threadId, scenarios.hello)
      const rows = yield* ended(created.threadId, 2)
      assert.deepStrictEqual(
        rows.map((row) => [row.state, row.errorClass]),
        [
          ['failed', 'auth_required'],
          ['completed', null],
        ],
      )
    }).pipe(Effect.provide(runtime())),
  )

  it.live('records the agent moving itself to another mode between turns', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const { task: created } = yield* task()
      yield* sessions.start({ threadId: created.threadId, agentId: 'codex' })
      yield* say(created.threadId, scenarios.leaveMode)
      yield* ended(created.threadId, 1)
      // The session started in `ask`, so the agent "leaving" to `ask` is no change; plan updates and notices are items.
      yield* say(created.threadId, scenarios.updates)
      yield* ended(created.threadId, 2)
      const kinds = (yield* items(created.threadId)).map((item) => item.kind)
      assert.includeMembers(kinds, ['plan', 'notice'])
    }).pipe(Effect.provide(runtime())),
  )

  describe('edges', () => {
    it.live('starts a first agent from a brief too, with input already waiting', () =>
      Effect.gen(function* () {
        const sessions = yield* Sessions
        const { task: created } = yield* task('Tidy the logs')
        yield* say(created.threadId, 'start with the worker')
        const sessionId = yield* sessions.switchAgent({ threadId: created.threadId, agentId: 'codex', model: 'large' })
        yield* ended(created.threadId, 1)
        assert.strictEqual((yield* session(sessionId))?.model, 'large')
        const notes = (yield* items(created.threadId)).filter((item) => item.kind === 'notice').map((item) => item.content.title)
        assert.deepStrictEqual(notes, ['Fake codex takes over.'])
        const reply = (yield* items(created.threadId)).filter((item) => item.kind === 'agent_message').at(-1)?.content.text as string
        assert.include(reply, 'You are taking over a task, in the same worktree.')
        assert.include(reply, '[person] start with the worker')
        assert.isTrue(reply.endsWith('start with the worker'))
      }).pipe(Effect.provide(runtime())),
    )

    it.live('says what it cannot find', () =>
      Effect.gen(function* () {
        const sessions = yield* Sessions
        const permissions = yield* Permissions
        const { project } = yield* task()
        assert.instanceOf(yield* Effect.flip(say('thr_missing', 'hello')), NotFound)
        assert.instanceOf(yield* Effect.flip(sessions.start({ threadId: project.coordinatorThreadId, agentId: 'codex' })), NotFound)
        const answer = permissions.answer({
          envelope: yield* Runtime.envelope('attention.answer', {}),
          attentionId: 'attn_missing',
          decision: 'allow',
        })
        assert.instanceOf(yield* Effect.flip(answer), NotFound)
      }).pipe(Effect.provide(runtime())),
    )

    it.live('takes one answer to a question, and allows without a reason', () =>
      Effect.gen(function* () {
        const sessions = yield* Sessions
        const permissions = yield* Permissions
        const sql = yield* SqlClient.SqlClient
        const { task: created } = yield* task()
        yield* sessions.start({ threadId: created.threadId, agentId: 'codex' })
        yield* say(created.threadId, scenarios.commandChoices)
        const [attention] = yield* until(
          sql<{ id: string }>`SELECT id FROM attention_requests WHERE state = 'open'`,
          (rows) => rows.length === 1,
        )
        const attentionId = attention?.id ?? ''
        yield* permissions.answer({ envelope: yield* Runtime.envelope('attention.answer', {}), attentionId, decision: 'allow' })
        yield* ended(created.threadId, 1)
        const again = permissions.answer({ envelope: yield* Runtime.envelope('attention.answer', {}), attentionId, decision: 'reject' })
        assert.instanceOf(yield* Effect.flip(again), AttentionClosed)
        const replies = (yield* items(created.threadId)).filter((item) => item.kind === 'agent_message').map((item) => item.content.text)
        assert.deepStrictEqual(replies, ['chosen=allow_once'])
      }).pipe(Effect.provide(runtime())),
    )

    it.live('withdraws a question when the agent goes while it waits', () =>
      Effect.gen(function* () {
        const sessions = yield* Sessions
        const sql = yield* SqlClient.SqlClient
        const { task: created } = yield* task()
        const sessionId = yield* sessions.start({ threadId: created.threadId, agentId: 'process' })
        yield* say(created.threadId, scenarios.commandChoices)
        yield* until(sql<{ id: string }>`SELECT id FROM attention_requests WHERE state = 'open'`, (rows) => rows.length === 1)
        const [process] = yield* sql<{ pid: number }>`SELECT pid FROM processes WHERE provider_session_id = ${sessionId}`
        globalThis.process.kill(-(process?.pid ?? 0), 'SIGKILL')
        yield* until(
          Effect.map(session(sessionId), (row) => [row]),
          ([row]) => row?.state === 'lost',
        )
        const states = yield* sql<{ attention: string; request: string }>`
          SELECT a.state AS attention, r.state AS request FROM attention_requests a JOIN permission_requests r ON r.id = a.permission_request_id`
        assert.deepStrictEqual(states, [{ attention: 'withdrawn', request: 'cancelled' }])
        assert.isTrue(Option.isNone(yield* sessions.running(created.threadId)))
      }).pipe(Effect.provide(runtime())),
    )

    it.live('keeps one principal per agent sign-in across limits', () =>
      Effect.gen(function* () {
        const sessions = yield* Sessions
        const sql = yield* SqlClient.SqlClient
        const { task: created } = yield* task()
        yield* sessions.start({ threadId: created.threadId, agentId: 'codex' })
        yield* say(created.threadId, scenarios.usageLimit)
        yield* ended(created.threadId, 1)
        yield* say(created.threadId, scenarios.quota)
        yield* ended(created.threadId, 2)
        const [counts] = yield* sql<{ principals: number; statuses: number }>`
          SELECT (SELECT count(*) FROM principals) AS principals, (SELECT count(*) FROM account_statuses) AS statuses`
        assert.deepStrictEqual(counts, { principals: 1, statuses: 2 })
      }).pipe(Effect.provide(runtime())),
    )
  })
})
