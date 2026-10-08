import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { scenarios } from '@althar/provider-adapters/testing'
import { Effect, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { AlreadyDelivered, AttentionClosed, NoSession, NotFound, SessionFailed, SessionRunning } from '../src/errors'
import { Instance } from '../src/Instance'
import { Permissions } from '../src/Permissions'
import { Policies } from '../src/Policies'
import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { errorClassOf, promptFor, Sessions } from '../src/Sessions'
import { items, repository, runtime, task, turns, until } from './support'

const say = (threadId: string, body: string, disposition: 'after_current' | 'interrupt_and_continue' = 'after_current') =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    return yield* sessions.send({ envelope: yield* Runtime.envelope('thread.send', { threadId, body }), threadId, body, disposition })
  })

/** The thread item of what the person said, and where that input stands. */
const message = (inputId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{
      itemId: string
      state: string
    }>`SELECT i.id AS item_id, u.state FROM thread_items i JOIN user_inputs u ON u.id = i.user_input_id WHERE u.id = ${inputId}`
    return row ?? { itemId: '', state: 'missing' }
  })

const takeBack = (itemId: string) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    return yield* sessions.takeBack({ envelope: yield* Runtime.envelope('thread.take_back', { itemId }), itemId })
  })

const done = (row: { readonly state: string }) => !['pending', 'delivered'].includes(row.state)
const withInput = <A extends { readonly inputs: number }>(rows: ReadonlyArray<A>) => rows.filter((row) => row.inputs > 0)

/** Waits until `count` turns that carried input have ended, and returns those turns. A brief alone isn't counted. */
const ended = (threadId: string, count: number) =>
  Effect.map(
    until(turns(threadId), (rows) => withInput(rows).filter(done).length >= count),
    withInput,
  )

/** Waits until the thread has `count` turns, all ended. */
const settled = (threadId: string, count: number) => until(turns(threadId), (rows) => rows.length >= count && rows.every(done))

/** Starts a session, and waits for the turn that delivers its brief to end. */
const begin = (threadId: string, agentId: string, model?: string) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    const sessionId = yield* sessions.start({ threadId, agentId, ...(model === undefined ? {} : { model }) })
    yield* settled(threadId, 1)
    return sessionId
  })

/** The thread's items, leaving out the fake agent's echo of a new session's brief. */
const threadItems = (threadId: string) =>
  Effect.map(items(threadId), (rows) =>
    rows.filter((item) => !(typeof item.content.text === 'string' && item.content.text.startsWith('echo: You are working on a task'))),
  )

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
      const { task: created } = yield* task()
      const sessionId = yield* begin(created.threadId, 'claude-code')
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
        (yield* threadItems(created.threadId)).map((item) => [item.kind, item.content.text]),
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
      yield* begin(created.threadId, 'codex')
      assert.instanceOf(yield* Effect.flip(sessions.start({ threadId: created.threadId, agentId: 'codex' })), SessionRunning)
      assert.isTrue(Option.isSome(yield* sessions.running(created.threadId)))
      yield* sessions.stop(created.threadId)
      assert.isTrue(Option.isNone(yield* sessions.running(created.threadId)))
      assert.instanceOf(yield* Effect.flip(sessions.stop(created.threadId)), NoSession)
      assert.instanceOf(yield* Effect.flip(sessions.setModel({ threadId: created.threadId, model: 'large' })), NoSession)
    }).pipe(Effect.provide(runtime())),
  )

  it.live('delivers input that arrived before the session started with its brief, and input sent during a turn after it', () =>
    Effect.gen(function* () {
      const { task: created } = yield* task()
      yield* say(created.threadId, 'start with the worker')
      yield* begin(created.threadId, 'codex')
      const [first] = yield* ended(created.threadId, 1)
      assert.isTrue(first?.prompt?.startsWith('You are working on a task in a git worktree of its own.'))
      assert.isTrue(first?.prompt?.endsWith('\n\nstart with the worker'))
      yield* say(created.threadId, scenarios.hello)
      yield* ended(created.threadId, 2)
      const kinds = (yield* threadItems(created.threadId)).map((item) => item.kind)
      assert.deepStrictEqual(kinds, ['user_message', 'user_message', 'agent_message'])
    }).pipe(Effect.provide(runtime())),
  )

  it.live('interrupts a turn and continues with the new input first', () =>
    Effect.gen(function* () {
      const { task: created } = yield* task()
      yield* begin(created.threadId, 'codex')
      yield* say(created.threadId, scenarios.slow)
      yield* until(threadItems(created.threadId), (rows) => rows.some((item) => item.content.text === 'Starting'))
      yield* say(created.threadId, 'use the retry helper', 'interrupt_and_continue')
      const [first, second] = yield* ended(created.threadId, 2)
      assert.deepStrictEqual([first?.state, first?.stopReason, second?.state], ['interrupted', 'cancelled', 'completed'])
      const replies = (yield* threadItems(created.threadId))
        .filter((item) => item.kind === 'agent_message')
        .map((item) => item.content.text)
      assert.strictEqual(
        replies.at(-1),
        `echo: ${promptFor([{ body: 'use the retry helper', disposition: 'interrupt_and_continue' }], undefined)}`,
      )
    }).pipe(Effect.provide(runtime())),
  )

  it.live('takes back a message waiting its turn, so the agent never reads it, and keeps one the agent has', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const { task: created } = yield* task()
      yield* begin(created.threadId, 'codex')
      yield* say(created.threadId, scenarios.slow)
      yield* until(threadItems(created.threadId), (rows) => rows.some((item) => item.content.text === 'Starting'))
      const dropped = yield* say(created.threadId, 'drop the cache')
      const kept = yield* say(created.threadId, 'keep the retry')
      const droppedItem = (yield* message(dropped.inputId)).itemId
      yield* takeBack(droppedItem)
      assert.strictEqual((yield* message(kept.inputId)).state, 'queued')
      yield* sessions.interrupt(created.threadId)
      const [, next] = yield* ended(created.threadId, 2)
      assert.isTrue(next?.prompt?.includes('keep the retry'))
      assert.isFalse(next?.prompt?.includes('drop the cache'))
      assert.strictEqual((yield* message(dropped.inputId)).state, 'withdrawn')
      // Once the agent has it, or once it is taken back, it stays as it is.
      assert.instanceOf(yield* Effect.flip(takeBack((yield* message(kept.inputId)).itemId)), AlreadyDelivered)
      assert.instanceOf(yield* Effect.flip(takeBack(droppedItem)), AlreadyDelivered)
      assert.instanceOf(yield* Effect.flip(takeBack('item_missing')), NotFound)
    }).pipe(Effect.provide(runtime())),
  )

  it.live('never both gives a message to the agent and takes it back', () =>
    Effect.gen(function* () {
      const { task: created } = yield* task()
      yield* begin(created.threadId, 'codex')
      // Taken back at once, or after letting the session run, so some go before a turn has them and some after.
      for (let round = 0; round < 8; round += 1) {
        const body = `round ${round}`
        const sent = yield* say(created.threadId, body)
        const itemId = (yield* message(sent.inputId)).itemId
        if (round % 2 === 1) yield* Effect.yieldNow
        const taken = yield* Effect.exit(takeBack(itemId))
        const given = <A extends { readonly prompt: string | null }>(rows: ReadonlyArray<A>) =>
          rows.filter((row) => row.prompt?.endsWith(body))
        if (taken._tag === 'Success') {
          // Taken back: it stays out of every turn, now and after.
          assert.strictEqual((yield* message(sent.inputId)).state, 'withdrawn')
          assert.isEmpty(given(yield* turns(created.threadId)))
        } else {
          // Too late: the agent has it, once.
          const rows = yield* until(turns(created.threadId), (all) => given(all).some(done))
          assert.lengthOf(given(rows), 1)
          assert.strictEqual((yield* message(sent.inputId)).state, 'delivered')
        }
      }
    }).pipe(Effect.provide(runtime())),
  )

  it.live('records a tool call as one item, updated as it runs, and the permission it needed', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { task: created } = yield* task()
      yield* begin(created.threadId, 'codex')
      yield* say(created.threadId, scenarios.tool)
      yield* ended(created.threadId, 1)
      const tool = (yield* threadItems(created.threadId)).filter((item) => item.kind === 'tool_call')
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
      const permissions = yield* Permissions
      const sql = yield* SqlClient.SqlClient
      const { task: created } = yield* task()
      const sessionId = yield* begin(created.threadId, 'codex')
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
      const replies = (yield* threadItems(created.threadId))
        .filter((item) => item.kind === 'agent_message')
        .map((item) => item.content.text)
      assert.deepStrictEqual(replies, ['chosen=decline'])
    }).pipe(Effect.provide(runtime())),
  )

  it.live(
    'decides by the project’s rules as they are when the agent asks: refused where never allowed, let through where everything is',
    () =>
      Effect.gen(function* () {
        const policies = yield* Policies
        const instance = yield* Instance
        const sql = yield* SqlClient.SqlClient
        const { project, task: created } = yield* task()
        yield* policies.set(project.projectId, { never: ['deploy'] }, instance.personId)
        yield* begin(created.threadId, 'codex')
        yield* say(created.threadId, scenarios.commandChoices)
        yield* ended(created.threadId, 1)
        yield* policies.set(project.projectId, { never: [], permissions: 'allow' }, instance.personId)
        yield* say(created.threadId, scenarios.commandChoices)
        yield* ended(created.threadId, 2)
        const decisions = yield* sql<{ outcome: string; reason: string }>`SELECT outcome, reason FROM decisions ORDER BY rowid`
        assert.deepStrictEqual(
          decisions.map((decision) => [decision.outcome, decision.reason]),
          [
            ['reject', "The project's rules never allow deploying and publishing."],
            ['allow', 'Allowed by the project rules.'],
          ],
        )
        assert.deepStrictEqual(yield* sql`SELECT id FROM attention_requests`, [])
      }).pipe(Effect.provide(runtime())),
  )

  it.live('withdraws a question to the person when the turn is interrupted', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { task: created } = yield* task()
      const sessionId = yield* begin(created.threadId, 'codex')
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
      const sessionId = yield* begin(created.threadId, 'codex', 'large')
      assert.strictEqual((yield* session(sessionId))?.model, 'large')
      yield* sessions.setModel({ threadId: created.threadId, model: 'small' })
      assert.strictEqual((yield* session(sessionId))?.model, 'small')
      assert.deepStrictEqual((yield* threadItems(created.threadId)).at(-1)?.content.title, 'Model changed to small.')
    }).pipe(Effect.provide(runtime())),
  )

  it.live('hands the thread to another agent, briefed with what happened so far', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const { task: created } = yield* task('Add the retry helper')
      const first = yield* begin(created.threadId, 'claude-code')
      yield* say(created.threadId, scenarios.hello)
      yield* ended(created.threadId, 1)
      const second = yield* sessions.switchAgent({ threadId: created.threadId, agentId: 'opencode' })
      yield* settled(created.threadId, 3)
      assert.deepStrictEqual(
        [yield* session(first), yield* session(second)].map((row) => [row?.state, row?.agentId, row?.supersededBySessionId]),
        [
          ['superseded', 'claude-code', second],
          ['active', 'opencode', null],
        ],
      )
      const reply = (yield* threadItems(created.threadId)).filter((item) => item.kind === 'agent_message').at(-1)?.content.text as string
      assert.include(reply, 'You are taking over a task from Fake claude-code')
      assert.include(reply, 'Task: Add the retry helper')
      assert.include(reply, '[person] hello')
      assert.include(reply, '[claude-code] Hello')
      assert.include(reply, 'Carry on with the task from where it stands.')
    }).pipe(Effect.provide(runtime())),
  )

  it.live('records a usage limit against the account, with when it resets', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { task: created } = yield* task()
      yield* begin(created.threadId, 'claude-code')
      yield* say(created.threadId, scenarios.quota)
      const [turn] = yield* ended(created.threadId, 1)
      assert.deepStrictEqual([turn?.state, turn?.errorClass], ['failed', 'usage_limit'])
      const statuses = yield* sql<{ state: string; windows: string; agentId: string }>`
        SELECT s.state, s.windows, p.agent_id FROM account_statuses s JOIN principals p ON p.id = s.principal_id`
      assert.deepStrictEqual(
        statuses.map((row) => [row.state, row.agentId, JSON.parse(row.windows)]),
        [['limited', 'claude-code', [{ kind: 'usage', resetsAt: '2026-09-29T05:00:00.000Z' }]]],
      )
      const notice = (yield* threadItems(created.threadId)).find((item) => item.kind === 'notice')
      assert.strictEqual(notice?.content.failure, 'usage_limit')
    }).pipe(Effect.provide(runtime())),
  )

  it.live('records a failed prompt as a failed turn, and the session carries on', () =>
    Effect.gen(function* () {
      const { task: created } = yield* task()
      yield* begin(created.threadId, 'codex')
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
      // The thread says why no answer came, in the agent's words.
      const notice = (yield* threadItems(created.threadId)).find((item) => item.kind === 'notice' && item.content.severity === 'error')
      assert.deepInclude(notice?.content, { source: 'agent', title: "Fake codex couldn't answer.", failure: 'auth_required' })
      assert.isNotEmpty(notice?.content.description)
    }).pipe(Effect.provide(runtime())),
  )

  it.live('leaves a usage limit in a thrown error to what carries the work on', () =>
    Effect.gen(function* () {
      const { task: created } = yield* task()
      yield* begin(created.threadId, 'codex')
      yield* say(created.threadId, scenarios.usageLimit)
      yield* ended(created.threadId, 1)
      const notices = (yield* threadItems(created.threadId)).filter((item) => item.kind === 'notice' && item.content.severity === 'error')
      assert.lengthOf(notices, 0)
    }).pipe(Effect.provide(runtime())),
  )

  it.live('records the agent moving itself to another mode between turns', () =>
    Effect.gen(function* () {
      const { task: created } = yield* task()
      yield* begin(created.threadId, 'codex')
      yield* say(created.threadId, scenarios.leaveMode)
      yield* ended(created.threadId, 1)
      // The session started in `ask`, so the agent "leaving" to `ask` is no change; plan updates and notices are items.
      yield* say(created.threadId, scenarios.updates)
      yield* ended(created.threadId, 2)
      const kinds = (yield* threadItems(created.threadId)).map((item) => item.kind)
      assert.includeMembers(kinds, ['plan', 'notice'])
      // How full its context is, as it last said, is kept on the session while it runs.
      const running = yield* (yield* Sessions).running(created.threadId)
      assert.deepStrictEqual(Option.getOrUndefined(running)?.context, { used: 1200, size: 200_000 })
    }).pipe(Effect.provide(runtime())),
  )

  describe('edges', () => {
    it.live('starts a first agent from a brief too, with input already waiting', () =>
      Effect.gen(function* () {
        const sessions = yield* Sessions
        const { task: created } = yield* task('Tidy the logs')
        yield* say(created.threadId, 'start with the worker')
        const sessionId = yield* sessions.switchAgent({ threadId: created.threadId, agentId: 'codex', model: 'large', effort: 'high' })
        yield* ended(created.threadId, 1)
        assert.strictEqual((yield* session(sessionId))?.model, 'large')
        const sql = yield* SqlClient.SqlClient
        const [chosen] = yield* sql<{ effort: string | null }>`SELECT effort FROM provider_sessions WHERE id = ${sessionId}`
        assert.strictEqual(chosen?.effort, 'high')
        const notes = (yield* threadItems(created.threadId)).filter((item) => item.kind === 'notice').map((item) => item.content.title)
        assert.deepStrictEqual(notes, ['Fake codex takes over.'])
        const reply = (yield* threadItems(created.threadId)).filter((item) => item.kind === 'agent_message').at(-1)?.content.text as string
        assert.include(reply, 'You are taking over a task, in the same worktree.')
        assert.include(reply, '[person] start with the worker')
        assert.isTrue(reply.endsWith('start with the worker'))
      }).pipe(Effect.provide(runtime())),
    )

    it.live('says what it cannot find', () =>
      Effect.gen(function* () {
        const sessions = yield* Sessions
        const permissions = yield* Permissions
        yield* task()
        assert.instanceOf(yield* Effect.flip(say('thr_missing', 'hello')), NotFound)
        assert.instanceOf(yield* Effect.flip(sessions.start({ threadId: 'thr_missing', agentId: 'codex' })), NotFound)
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
        const permissions = yield* Permissions
        const sql = yield* SqlClient.SqlClient
        const { task: created } = yield* task()
        yield* begin(created.threadId, 'codex')
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
        const replies = (yield* threadItems(created.threadId))
          .filter((item) => item.kind === 'agent_message')
          .map((item) => item.content.text)
        assert.deepStrictEqual(replies, ['chosen=allow_once'])
      }).pipe(Effect.provide(runtime())),
    )

    it.live('withdraws a question when the agent goes while it waits', () =>
      Effect.gen(function* () {
        const sessions = yield* Sessions
        const sql = yield* SqlClient.SqlClient
        const { task: created } = yield* task()
        const sessionId = yield* begin(created.threadId, 'process')
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
        const sql = yield* SqlClient.SqlClient
        // Two tasks' leads on the same agent each reach its limit.
        for (const scenario of [scenarios.usageLimit, scenarios.quota]) {
          const { task: created } = yield* task()
          yield* begin(created.threadId, 'codex')
          yield* say(created.threadId, scenario)
          yield* ended(created.threadId, 1)
        }
        const [counts] = yield* sql<{ principals: number; statuses: number }>`
          SELECT (SELECT count(*) FROM principals) AS principals, (SELECT count(*) FROM account_statuses) AS statuses`
        assert.deepStrictEqual(counts, { principals: 1, statuses: 2 })
      }).pipe(Effect.provide(runtime())),
    )

    it.live('leaves the old agent working when a switch fails', () =>
      Effect.gen(function* () {
        const sessions = yield* Sessions
        const sql = yield* SqlClient.SqlClient
        const { task: created } = yield* task()
        const first = yield* begin(created.threadId, 'codex')
        const error = yield* Effect.flip(sessions.switchAgent({ threadId: created.threadId, agentId: 'missing' }))
        assert.instanceOf(error, SessionFailed)
        assert.strictEqual((yield* session(first))?.state, 'active')
        assert.strictEqual(Option.getOrUndefined(yield* sessions.running(created.threadId))?.sessionId, first)
        const states = yield* sql<{ agentId: string; state: string }>`SELECT agent_id, state FROM provider_sessions ORDER BY started_at, id`
        assert.deepStrictEqual(states, [
          { agentId: 'codex', state: 'active' },
          { agentId: 'missing', state: 'failed' },
        ])
        yield* say(created.threadId, scenarios.hello)
        assert.strictEqual((yield* ended(created.threadId, 1))[0]?.state, 'completed')
      }).pipe(Effect.provide(runtime())),
    )

    it.live('starts one session when two starts race', () =>
      Effect.gen(function* () {
        const sessions = yield* Sessions
        const sql = yield* SqlClient.SqlClient
        const { task: created } = yield* task()
        const start = Effect.exit(sessions.start({ threadId: created.threadId, agentId: 'codex' }))
        const [a, b] = yield* Effect.all([start, start], { concurrency: 'unbounded' })
        assert.deepStrictEqual([a, b].map((exit) => exit._tag).toSorted(), ['Failure', 'Success'])
        const [count] = yield* sql<{ count: number }>`SELECT count(*) AS count FROM provider_sessions`
        assert.strictEqual(count?.count, 1)
      }).pipe(Effect.provide(runtime())),
    )

    it('names why a turn failed', () => {
      assert.strictEqual(errorClassOf(Option.some({ _tag: 'AgentRequestFailed', failure: 'usage_limit' }), true), 'usage_limit')
      assert.strictEqual(errorClassOf(Option.some({ _tag: 'AgentExited' }), true), 'agent_exited')
      assert.strictEqual(errorClassOf(Option.some({ _tag: 'TurnInProgress' }), true), 'turn_in_progress')
      assert.strictEqual(errorClassOf(Option.some({ _tag: 'SqlError' }), true), 'unknown')
      assert.strictEqual(errorClassOf(Option.none(), true), 'unknown')
      assert.isUndefined(errorClassOf(Option.none(), false))
    })

    it.live('briefs a new agent with the plan, the change so far and what is not committed', () =>
      Effect.gen(function* () {
        const sessions = yield* Sessions
        const projects = yield* Projects
        const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
        const created = yield* projects.createTask({
          envelope: yield* Runtime.envelope('task.create', {}),
          projectId: project.projectId,
          title: 'Retry the checkout',
          description: 'Three attempts, with backoff.',
        })
        yield* begin(created.threadId, 'codex')
        yield* say(created.threadId, scenarios.updates)
        yield* ended(created.threadId, 1)
        const commit = (message: string) =>
          execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t.test', 'commit', '-q', '-am', message], { cwd: created.worktree })
        writeFileSync(join(created.worktree, 'README.md'), `${'# Meridian\n'}${'a line\n'.repeat(900)}`)
        commit('Grow the readme')
        writeFileSync(join(created.worktree, 'notes.txt'), 'draft\n')
        yield* sessions.switchAgent({ threadId: created.threadId, agentId: 'opencode' })
        const all = yield* settled(created.threadId, 3)
        const brief = all.at(-1)?.prompt ?? ''
        assert.include(brief, 'Task: Retry the checkout\n\nThree attempts, with backoff.')
        assert.include(brief, 'which started from main at')
        assert.include(brief, 'The plan:\n- [in_progress] Write the test')
        assert.include(brief, 'Changed since the start:\nREADME.md | 900')
        assert.include(brief, 'Not yet committed:\n?? notes.txt')
      }).pipe(Effect.provide(runtime())),
    )
  })
})
