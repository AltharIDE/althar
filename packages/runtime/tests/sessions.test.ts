import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { CommandEnvelope } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { scenarios } from '@althar/provider-adapters/testing'
import { Cause, Clock, Deferred, Duration, Effect, Exit, Fiber, Layer, Option, Stream } from 'effect'
import { TestClock } from 'effect/testing'
import { SqlClient } from 'effect/sql'

import { AlreadyDelivered, AttentionClosed, NoSession, NotFound, SessionFailed, SessionRunning } from '../src/errors'
import { Instance } from '../src/Instance'
import { Live } from '../src/Live'
import { Permissions } from '../src/Permissions'
import { Policies } from '../src/Policies'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { DICTATED, errorClassOf, promptFor, Sessions } from '../src/Sessions'
import { items, repository, runtime, task, turns, until } from './support'

const say = (threadId: string, body: string, disposition: 'after_current' | 'interrupt_and_continue' = 'after_current', dictated = false) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    return yield* sessions.send({
      envelope: yield* Runtime.envelope('thread.send', { threadId, body }),
      threadId,
      body,
      disposition,
      ...(dictated ? { dictated } : {}),
    })
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

  it.live('tells the agent a message was dictated, and only that one, in the prompt and not in the thread', () =>
    Effect.gen(function* () {
      const { task: created } = yield* task()
      yield* begin(created.threadId, 'codex')
      yield* say(created.threadId, 'ask alpha about the retry', 'after_current', true)
      yield* ended(created.threadId, 1)
      yield* say(created.threadId, 'ask Althar about the cache')
      yield* ended(created.threadId, 2)
      const all = yield* threadItems(created.threadId)
      const said = all.filter((item) => item.kind === 'user_message').map((item) => item.content.text)
      const replies = all.filter((item) => item.kind === 'agent_message').map((item) => String(item.content.text))
      // What the thread shows is what the person said, as it was.
      assert.deepStrictEqual(said.slice(-2), ['ask alpha about the retry', 'ask Althar about the cache'])
      assert.strictEqual(replies.at(-2), `echo: ask alpha about the retry\n\n${DICTATED}`)
      assert.strictEqual(replies.at(-1), 'echo: ask Althar about the cache')
    }).pipe(Effect.provide(runtime())),
  )

  it.live('keeps the mark on a dictated message that waits behind a turn, and says it as the thread shows it', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const { task: created } = yield* task()
      yield* begin(created.threadId, 'codex')
      yield* say(created.threadId, scenarios.slow)
      yield* until(threadItems(created.threadId), (rows) => rows.some((item) => item.content.text === 'Starting'))
      const queued = yield* say(created.threadId, 'then check the alter docs', 'after_current', true)
      const row = yield* message(queued.inputId)
      assert.strictEqual(row.state, 'queued')
      // The thread shows its words as they were said, marker or not.
      const waiting = (yield* threadItems(created.threadId)).filter((item) => item.kind === 'user_message').at(-1)
      assert.strictEqual(waiting?.content.text, 'then check the alter docs')
      yield* sessions.interrupt(created.threadId)
      yield* ended(created.threadId, 2)
      const replies = (yield* threadItems(created.threadId))
        .filter((item) => item.kind === 'agent_message')
        .map((item) => String(item.content.text))
      assert.strictEqual(replies.at(-1), `echo: then check the alter docs\n\n${DICTATED}`)
    }).pipe(Effect.provide(runtime())),
  )

  it.live('stops a turn that is stopped as soon as it is said to have started', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const sessions = yield* Sessions
        const live = yield* Live
        const { task: created } = yield* task()
        yield* begin(created.threadId, 'codex')
        // Stopped the moment it is said to have started, as a spent budget of turns does: it is said once the agent can be stopped.
        const events = yield* live.subscribe
        yield* Effect.forkScoped(
          Stream.runForEach(events, (event) =>
            event._tag === 'TurnStarted' && event.threadId === created.threadId
              ? Effect.asVoid(Effect.forkScoped(Effect.ignore(sessions.interrupt(created.threadId))))
              : Effect.void,
          ),
        )
        yield* say(created.threadId, scenarios.slow)
        const [turn] = yield* ended(created.threadId, 1)
        assert.deepStrictEqual([turn?.state, turn?.stopReason], ['interrupted', 'cancelled'])
      }),
    ).pipe(Effect.provide(runtime())),
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
      // Taken back, it takes no place on a page of the thread, and read by itself it says so.
      const queries = yield* Queries
      assert.isFalse((yield* queries.thread(created.threadId)).items.some((item) => item.id === droppedItem))
      const read = yield* queries.item(created.threadId, droppedItem)
      assert.strictEqual(read.kind === 'user_message' ? read.input?.state : null, 'withdrawn')
      // Once the agent has it, or once it is taken back, it stays as it is.
      assert.instanceOf(yield* Effect.flip(takeBack((yield* message(kept.inputId)).itemId)), AlreadyDelivered)
      assert.instanceOf(yield* Effect.flip(takeBack(droppedItem)), AlreadyDelivered)
      assert.instanceOf(yield* Effect.flip(takeBack('item_missing')), NotFound)
    }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime())))),
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

  it.live('describes the session the runtime holds while a handover starts', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const queries = yield* Queries
      const sql = yield* SqlClient.SqlClient
      const { task: created } = yield* task()
      const first = yield* sessions.start({ threadId: created.threadId, agentId: 'codex', model: 'large', effort: 'high' })
      yield* settled(created.threadId, 1)

      // The new row exists, but its slow connection has not replaced the session the runtime still holds.
      const switching = yield* Effect.forkChild(sessions.switchAgent({ threadId: created.threadId, agentId: 'opencode', model: 'small' }))
      yield* until(sql<{ state: string }>`SELECT state FROM provider_sessions WHERE thread_id = ${created.threadId}`, (rows) =>
        rows.some((row) => row.state === 'starting'),
      )
      const during = yield* queries.thread(created.threadId, { limit: 0 })
      assert.deepStrictEqual(
        [during.session?.id, during.session?.agentId, during.session?.model, during.session?.effort, during.session?.held],
        [first, 'codex', 'large', 'high', true],
      )

      yield* Fiber.join(switching)
      const after = yield* queries.thread(created.threadId, { limit: 0 })
      assert.deepStrictEqual([after.session?.agentId, after.session?.model, after.session?.held], ['opencode', 'small', true])
    }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', {}, { each: { opencode: { slowStart: 500 } } }))))),
  )

  it.live('describes a recorded session the runtime no longer holds as not held', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const queries = yield* Queries
      const sql = yield* SqlClient.SqlClient
      const { task: created } = yield* task()
      const sessionId = yield* begin(created.threadId, 'codex', 'large')
      yield* sessions.stop(created.threadId)
      // The row a crash leaves: still live, while the runtime holds nothing on the thread.
      yield* sql`UPDATE provider_sessions SET state = 'active' WHERE id = ${sessionId}`

      const { session } = yield* queries.thread(created.threadId, { limit: 0 })
      assert.deepStrictEqual(
        [session?.id, session?.model, session?.held, session?.turnRunning, session?.turnStartedAt, session?.context, session?.background],
        [sessionId, 'large', false, false, null, null, []],
      )
    }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime())))),
  )

  it.live('briefs the agent that takes over with what a failed command printed, not only that it failed', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const { task: created } = yield* task('Fix the lint')
      yield* begin(created.threadId, 'claude-code')
      yield* say(created.threadId, scenarios.handsBack)
      yield* ended(created.threadId, 1)
      yield* sessions.switchAgent({ threadId: created.threadId, agentId: 'opencode' })
      yield* settled(created.threadId, 3)
      const reply = (yield* threadItems(created.threadId)).filter((item) => item.kind === 'agent_message').at(-1)?.content.text as string
      assert.include(reply, 'You are taking over a task from Fake claude-code')
      assert.include(reply, '[tool] npm run lint (failed)\n[it printed] src/a.ts\n  3:1  error  Unexpected any\n✗ 1 problem\nexit code: 1')
      // A command that succeeded is said as before, without what it printed.
      assert.include(reply, '[tool] git status --short (completed)\n')
    }).pipe(Effect.provide(runtime())),
  )

  it.live('hands the thread over with what the person said: the new lead takes it first, after its brief, and the old one never does', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const sessions = yield* Sessions
      const { task: created } = yield* task('Add the retry helper')
      const first = yield* begin(created.threadId, 'claude-code')
      yield* say(created.threadId, scenarios.hello)
      yield* ended(created.threadId, 1)
      const body = 'Use the helper we already have'
      const second = yield* sessions.switchAgent({
        threadId: created.threadId,
        agentId: 'opencode',
        model: 'large',
        message: { envelope: yield* Runtime.envelope('thread.send', { threadId: created.threadId, body }), body },
      })
      yield* settled(created.threadId, 3)
      // What the person said is in the thread, and was given to the new lead alone, with its brief and in place of carrying on.
      const items = yield* threadItems(created.threadId)
      assert.deepStrictEqual(
        items.filter((item) => item.kind === 'user_message').map((item) => item.content.text),
        [scenarios.hello, body],
      )
      const given = yield* sql<{ sessionId: string; prompt: string }>`
        SELECT d.provider_session_id AS session_id, d.prompt FROM turn_deliveries d JOIN turn_delivery_inputs di ON di.delivery_id = d.id
        JOIN user_inputs u ON u.id = di.user_input_id WHERE u.body = ${body}`
      assert.deepStrictEqual(
        given.map((turn) => turn.sessionId),
        [second],
      )
      assert.include(given[0]?.prompt, 'You are taking over a task from Fake claude-code')
      assert.isTrue(given[0]?.prompt.endsWith(body))
      assert.notInclude(given[0]?.prompt, 'Carry on with the task from where it stands.')
      assert.notStrictEqual(first, second)
      // It is on the model asked for from the moment it starts.
      assert.strictEqual((yield* session(second))?.model, 'large')
    }).pipe(Effect.provide(runtime())),
  )

  it.live('lets go of a session that started but could not take over its thread', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const sessions = yield* Sessions
      const { task: created } = yield* task('Add the retry helper')
      yield* begin(created.threadId, 'claude-code')
      // What the person said comes again under a command id already used for something else: the switch fails once the new
      // agent has started, before it takes over.
      const envelope = yield* Runtime.envelope('thread.send', { threadId: created.threadId, body: 'first' })
      yield* sessions.send({ envelope, threadId: created.threadId, body: 'first', disposition: 'after_current' })
      yield* ended(created.threadId, 1)
      const { commandType, schemaVersion, actorId, deviceId, issuedAt, payload } = yield* Runtime.envelope('thread.send', {
        threadId: created.threadId,
        body: 'second',
      })
      const reused = new CommandEnvelope({
        commandId: envelope.commandId,
        commandType,
        schemaVersion,
        actorId,
        deviceId,
        issuedAt,
        payload,
      })
      const exit = yield* Effect.exit(
        sessions.switchAgent({ threadId: created.threadId, agentId: 'opencode', message: { envelope: reused, body: 'second' } }),
      )
      assert.isTrue(Exit.isFailure(exit))
      const [started] = yield* sql<{ id: string; state: string }>`
        SELECT id, state FROM provider_sessions WHERE thread_id = ${created.threadId} AND agent_id = 'opencode'`
      // It is recorded as failed, not left starting, and its process as ended: nothing of it holds a place.
      assert.strictEqual(started?.state, 'failed')
      const processes = yield* sql<{ state: string; endedAt: string | null }>`
        SELECT state, ended_at FROM processes WHERE provider_session_id = ${started?.id}`
      assert.isTrue(processes.every((process) => process.state !== 'running' && process.endedAt !== null))
      assert.isTrue(Option.isNone(yield* sessions.running(created.threadId)))
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
      // The thread says plainly that it is signed out, with the agent's own words under it.
      const notice = (yield* threadItems(created.threadId)).find((item) => item.kind === 'notice' && item.content.severity === 'error')
      assert.deepInclude(notice?.content, { source: 'agent', title: 'Fake codex is signed out.', failure: 'auth_required' })
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

  it.live('keeps what the agent says on its own whole, and apart from the next turn and the next time it wakes', () =>
    Effect.gen(function* () {
      const { task: created } = yield* task()
      yield* begin(created.threadId, 'codex')
      const woken = (rows: ReadonlyArray<{ readonly kind: string; readonly content: { readonly text?: unknown } }>) =>
        rows.filter((item) => item.kind === 'agent_message' && item.content.text === 'Verify finished.').length
      yield* say(created.threadId, scenarios.wakesItself)
      // Its first words open the item; the rest is written as it grows and when it closes.
      yield* until(threadItems(created.threadId), (rows) => rows.some((item) => String(item.content.text ?? '').startsWith('Verify')))
      // A prompted turn takes over before the agent has gone quiet; what it says next on its own starts a new item.
      yield* say(created.threadId, scenarios.wakesItself)
      yield* until(threadItems(created.threadId), (rows) => woken(rows) === 2)
      const texts = (yield* threadItems(created.threadId)).filter((item) => item.kind !== 'user_message').map((item) => item.content.text)
      assert.deepStrictEqual(texts, ['Done', 'Verify finished.', 'Done', 'Verify finished.'])
    }).pipe(Effect.provide(runtime())),
  )

  describe('what a lead leaves running', () => {
    /** What the thread's session has left running, as a client reads it. */
    const shown = (threadId: string) =>
      Effect.flatMap(Queries, (queries) =>
        Effect.map(Effect.orDie(queries.thread(threadId, { limit: 0 })), (thread) => thread.session?.background ?? []),
      )

    it.live(
      'keeps a command left running, by its command, with where it answers, until it is stopped; and one that ended by itself, to say how',
      () =>
        Effect.gen(function* () {
          const sessions = yield* Sessions
          const { task: created } = yield* task()
          yield* begin(created.threadId, 'claude-code')
          yield* say(created.threadId, scenarios.background)
          yield* ended(created.threadId, 1)
          // By its tool call's command, not by what the call says it does; where it answers, from what it printed, colours and all.
          const [serving] = yield* until(shown(created.threadId), (all) => all[0]?.url != null)
          assert.deepInclude(serving, { command: 'bun dev', name: 'Start the dev server', url: 'http://localhost:5173/', ended: null })
          // Background work that isn't a command isn't kept.
          assert.lengthOf(yield* shown(created.threadId), 1)
          yield* sessions.stopBackground(created.threadId, serving?.id ?? '')
          assert.lengthOf(yield* shown(created.threadId), 0)
          // Gone already, there is nothing more to stop.
          yield* sessions.stopBackground(created.threadId, serving?.id ?? '')

          // One that ends by itself stays, with its exit code, until it is cleared.
          yield* say(created.threadId, '[lead:serve-exits]')
          yield* ended(created.threadId, 2)
          const [exited] = yield* until(shown(created.threadId), (all) => all[0]?.ended != null)
          assert.strictEqual(exited?.ended?.code, 1)
          yield* sessions.clearBackground(created.threadId, exited?.id ?? '')
          assert.lengthOf(yield* shown(created.threadId), 0)
        }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime())))),
    )

    it.live('finds where one answers from its port when its output never says, and it keeps its name', () =>
      Effect.gen(function* () {
        const sessions = yield* Sessions
        const { task: created } = yield* task()
        yield* begin(created.threadId, 'claude-code')
        yield* say(created.threadId, scenarios.backgroundQuiet)
        yield* ended(created.threadId, 1)
        const [serving] = yield* until(shown(created.threadId), (all) => all[0]?.url != null)
        assert.match(serving?.url ?? '', /^http:\/\/localhost:\d{4,5}\/$/)
        assert.strictEqual(serving?.name, 'Start the dev server')
        yield* sessions.stopBackground(created.threadId, serving?.id ?? '')
      }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime())))),
    )

    it.live('finds a silent server in the agent’s tree that was already listening when the agent reported it', () =>
      Effect.gen(function* () {
        const sessions = yield* Sessions
        const { task: created } = yield* task()
        // A process, so its tree is known; no file its output goes to, so that is all there is to tell it by.
        yield* begin(created.threadId, 'process')
        yield* say(created.threadId, scenarios.backgroundCodexQuiet)
        yield* ended(created.threadId, 1)
        const [serving] = yield* until(shown(created.threadId), (all) => all[0]?.url != null)
        assert.match(serving?.url ?? '', /^http:\/\/localhost:\d{4,5}\/$/)
        yield* sessions.stopBackground(created.threadId, serving?.id ?? '')
      }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime())))),
    )

    it.live.skipIf(process.platform === 'win32')(
      'finds a silent server started while the lookup of what listened before is still slow',
      () =>
        Effect.gen(function* () {
          const sessions = yield* Sessions
          const { task: created } = yield* task()
          // `lsof` answers late, from the machine as it is then: the server the agent starts as its turn begins is listening by
          // then, and is in what listened before unless the turn waited for that to be read before the agent was told.
          const real = execFileSync('which', ['lsof'], { encoding: 'utf8' }).trim()
          const dir = mkdtempSync(join(tmpdir(), 'slow-lsof-'))
          writeFileSync(join(dir, 'lsof'), `#!/bin/sh\nsleep 1\nexec ${real} "$@"\n`, { mode: 0o755 })
          const path = process.env.PATH
          process.env.PATH = `${dir}:${path ?? ''}`
          yield* Effect.gen(function* () {
            yield* begin(created.threadId, 'process')
            yield* say(created.threadId, scenarios.backgroundCodexQuiet)
            yield* ended(created.threadId, 1)
            const [serving] = yield* until(shown(created.threadId), (all) => all[0]?.url != null)
            assert.match(serving?.url ?? '', /^http:\/\/localhost:\d{4,5}\/$/)
            yield* sessions.stopBackground(created.threadId, serving?.id ?? '')
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                process.env.PATH = path
                rmSync(dir, { recursive: true, force: true })
              }),
            ),
          )
        }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime())))),
    )

    it.live(
      'keeps commands an agent starts of its own by their names; one that ended by itself says how, with or without a code; one it stopped goes',
      () =>
        Effect.gen(function* () {
          const sessions = yield* Sessions
          const { task: created } = yield* task()
          yield* begin(created.threadId, 'claude-code')
          yield* say(created.threadId, scenarios.backgroundOwn)
          yield* ended(created.threadId, 1)
          const all = yield* until(shown(created.threadId), (all) => all.length === 3)
          // Output for a call or a command it never named changes nothing.
          assert.deepStrictEqual(
            all.map((left) => [left.command, left.url, left.ended?.code]),
            [
              ['npm run watch', null, undefined],
              ['npm test', null, 0],
              ['npm run lint', null, null],
            ],
          )
          const [watch, test] = all
          // Only one that ended is cleared; Stop on one that ended asks the agent nothing, and it goes.
          yield* sessions.clearBackground(created.threadId, watch?.id ?? '')
          assert.lengthOf(yield* shown(created.threadId), 3)
          yield* sessions.stopBackground(created.threadId, test?.id ?? '')
          assert.deepStrictEqual(
            (yield* shown(created.threadId)).map((left) => left.command),
            ['npm run watch', 'npm run lint'],
          )
        }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime())))),
    )

    it.live('keeps one Codex left running, with where it answers from its tool call’s output after the turn', () =>
      Effect.gen(function* () {
        const { task: created } = yield* task()
        yield* begin(created.threadId, 'codex')
        yield* say(created.threadId, scenarios.backgroundCodex)
        yield* ended(created.threadId, 1)
        const [serving] = yield* until(shown(created.threadId), (all) => all[0]?.url != null)
        assert.deepInclude(serving, { command: 'bun dev', url: 'http://localhost:5173/' })
      }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime())))),
    )

    it.live('lets go of everything it left running when the session stops', () =>
      Effect.gen(function* () {
        const sessions = yield* Sessions
        const { task: created } = yield* task()
        yield* begin(created.threadId, 'claude-code')
        yield* say(created.threadId, scenarios.background)
        yield* ended(created.threadId, 1)
        yield* until(shown(created.threadId), (all) => all.length === 1)
        yield* sessions.stop(created.threadId)
        assert.lengthOf(yield* shown(created.threadId), 0)
      }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime())))),
    )
  })

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
        // Its whole tree: its process group, or on Windows its keeper, whose job ends with it.
        const pid = process?.pid ?? 0
        globalThis.process.kill(globalThis.process.platform === 'win32' ? pid : -pid, 'SIGKILL')
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

    // The agent's startup stops answering at `hangsIn`; the timeout then cuts it off and the current lead carries on.
    const timesOutStartup = (hangsIn: 'beforeInitialize' | 'beforeNewSession') => {
      let entered!: () => void
      const waitingForStartup = new Promise<void>((resolve) => {
        entered = resolve
      })
      let releaseStartup!: () => void
      const startupResponse = new Promise<void>((resolve) => {
        releaseStartup = resolve
      })
      const startupTimeoutScheduled = Deferred.makeUnsafe<void>()
      const testGuardScheduled = Deferred.makeUnsafe<void>()
      // The test clock stands in for time, and the timeout isn't reachable from here, so the clock is watched instead: the
      // timeout is found as the one 2-minute `Clock.sleep` (SESSION_START_TIMEOUT, which relies on `Effect.timeoutOption`
      // sleeping on the Clock service) and the test's own 3-minute guard as the 3-minute one. Change either duration, or
      // how the timeout waits, and this stops finding it and the test hangs rather than fails.
      const observedClock = Layer.effect(
        Clock.Clock,
        Effect.gen(function* () {
          const baseClock = yield* Clock.Clock
          const clock = Object.create(baseClock) as Clock.Clock
          Object.defineProperty(clock, 'sleep', {
            value: (duration: Duration.Duration) =>
              Effect.gen(function* () {
                const millis = Duration.toMillis(duration)
                if (millis === Duration.toMillis(Duration.minutes(2))) {
                  yield* Deferred.succeed(startupTimeoutScheduled, undefined)
                } else if (millis === Duration.toMillis(Duration.minutes(3))) {
                  yield* Deferred.succeed(testGuardScheduled, undefined)
                }
                yield* baseClock.sleep(duration)
              }),
          })
          return clock
        }),
      ).pipe(Layer.provideMerge(TestClock.layer()))
      const app = runtime(
        ':memory:',
        {},
        {
          each: {
            opencode: {
              [hangsIn]: () => {
                entered()
                return startupResponse
              },
            },
          },
        },
      ).pipe(Layer.provideMerge(observedClock))
      return Effect.gen(function* () {
        const sessions = yield* Sessions
        const sql = yield* SqlClient.SqlClient
        const { task: created } = yield* task()
        const first = yield* sessions.start({ threadId: created.threadId, agentId: 'codex' })
        const attempt = yield* Effect.forkChild(Effect.exit(sessions.switchAgent({ threadId: created.threadId, agentId: 'opencode' })))
        yield* Effect.promise(() => waitingForStartup)
        yield* Deferred.await(startupTimeoutScheduled)
        const timeout = yield* Effect.forkChild(Effect.timeoutOption(Fiber.join(attempt), Duration.minutes(3)))
        yield* Deferred.await(testGuardScheduled)
        yield* TestClock.adjust(Duration.minutes(3))
        const finished = yield* Fiber.join(timeout)
        releaseStartup()
        if (Option.isNone(finished)) throw new Error('The startup attempt should finish before the test guard.')
        if (Exit.isSuccess(finished.value)) throw new Error('The startup attempt should fail after its timeout.')
        const failure = finished.value.cause.reasons.find(Cause.isFailReason)
        if (failure === undefined) throw new Error('The startup attempt should fail with a typed error.')
        assert.instanceOf(failure.error, SessionFailed)
        assert.include(failure.error.summary, 'Timed out after 2m waiting for Fake opencode to set up a session.')
        // The tag is what tells a hang from a failure, in the log and for telemetry.
        assert.include(failure.error.reason, 'StartTimedOut')

        assert.strictEqual((yield* session(first))?.state, 'active')
        assert.strictEqual(Option.getOrUndefined(yield* sessions.running(created.threadId))?.sessionId, first)
        const states = yield* sql<{ agentId: string; state: string }>`
          SELECT agent_id, state FROM provider_sessions ORDER BY agent_id`
        assert.deepStrictEqual(states, [
          { agentId: 'codex', state: 'active' },
          { agentId: 'opencode', state: 'failed' },
        ])
        const notices = (yield* threadItems(created.threadId)).filter((item) => item.kind === 'notice')
        assert.strictEqual(notices.at(-1)?.content.title, "Fake opencode couldn't start.")
        assert.include(String(notices.at(-1)?.content.description), 'Timed out after 2m waiting for Fake opencode to set up a session')
      }).pipe(Effect.ensuring(Effect.sync(releaseStartup)), Effect.provide(app))
    }

    it.effect('times out an ACP startup that hangs in session/new, records the failure and leaves the current lead running', () =>
      timesOutStartup('beforeNewSession'),
    )

    it.effect('times out an ACP startup that hangs in initialize', () => timesOutStartup('beforeInitialize'))

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
        // Whether its branch is published, as Althar knows it, and that a published one is merged into, never rebased.
        const branch = execFileSync('git', ['branch', '--show-current'], { cwd: created.worktree }).toString().trim()
        // Nothing says it was never pushed: unknown, it is merged into all the same.
        assert.include(brief, `The branch ${branch} isn't on any remote Althar knows of, but it may still have been pushed some other way.`)
        assert.include(brief, 'Bring the default branch in by merging it, never by rebasing')
        const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: created.worktree }).toString().trim()
        execFileSync('git', ['update-ref', `refs/remotes/origin/${branch}`, head], { cwd: created.worktree })
        yield* sessions.switchAgent({ threadId: created.threadId, agentId: 'codex' })
        const again = (yield* settled(created.threadId, 4)).at(-1)?.prompt ?? ''
        assert.include(again, `The branch ${branch} is published: origin/${branch} has it at ${head.slice(0, 12)}.`)
        // Pushed by Althar, by URL, with no remote-tracking ref: still published.
        execFileSync('git', ['update-ref', '-d', `refs/remotes/origin/${branch}`], { cwd: created.worktree })
        execFileSync('git', ['update-ref', `refs/althar/pushed/${branch}`, head], { cwd: created.worktree })
        yield* sessions.switchAgent({ threadId: created.threadId, agentId: 'opencode' })
        const pushed = (yield* settled(created.threadId, 5)).at(-1)?.prompt ?? ''
        assert.include(pushed, `The branch ${branch} is published: Althar pushed it, at ${head.slice(0, 12)}.`)
      }).pipe(Effect.provide(runtime())),
    )
  })
})
