import { assert, describe, it } from '@effect/vitest'
import { Effect, Ref, Stream } from 'effect'

import { oneTimeOption } from '../src/AgentConnection'
import { AgentRequestFailed, OptionUnavailable } from '../src/errors'
import { fakeAgent, type FakeAgentOptions, scenarios } from '../src/testing'
import { text, withConnection, type ContractSubject } from './contract'

const fake: ContractSubject = {
  name: 'fake agent',
  transport: () => ({ _tag: 'InProcess', agent: fakeAgent() }),
  cwd: '/tmp',
  modes: { ask: 'ask', readOnly: 'read-only' },
  model: { optionId: 'model', switchTo: 'large' },
  prompts: { short: scenarios.hello, long: scenarios.slow },
}

const turn = (prompt: string, decide: 'allow' | 'reject' = 'reject') =>
  withConnection(
    fake,
    (connection, permissions) =>
      Effect.gen(function* () {
        const session = yield* connection.newSession({ cwd: '/tmp', mode: 'ask' })
        const events = yield* Stream.runCollect(session.prompt(prompt))
        return { events, permissions: yield* Ref.get(permissions), options: yield* session.options }
      }),
    decide,
  )

describe('AgentConnection', () => {
  it.live('reports the agent and what it advertises', () =>
    withConnection(fake, (connection) =>
      Effect.sync(() => {
        assert.deepStrictEqual(connection.info, {
          name: 'fake-agent',
          version: '0.0.0',
          protocolVersion: 1,
          loadSession: false,
          steering: true,
          mcp: { http: true, sse: false },
          authMethods: [],
        })
        assert.isUndefined(connection.pid)
      }),
    ),
  )

  it.live('refuses a mode the agent does not offer', () =>
    withConnection(fake, (connection) =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(connection.newSession({ cwd: '/tmp', mode: 'yolo' }))
        assert.instanceOf(error, OptionUnavailable)
        assert.deepStrictEqual((error as OptionUnavailable).available, ['ask', 'read-only', 'bypass'])
      }),
    ),
  )

  it.live('refuses an option value the agent does not offer', () =>
    withConnection(fake, (connection) =>
      Effect.gen(function* () {
        const session = yield* connection.newSession({ cwd: '/tmp', mode: 'ask' })
        assert.instanceOf(yield* Effect.flip(session.setOption('model', 'huge')), OptionUnavailable)
        assert.instanceOf(yield* Effect.flip(session.setOption('colour', 'blue')), OptionUnavailable)
      }),
    ),
  )

  it.live('reports what the turn used', () =>
    Effect.gen(function* () {
      const { events } = yield* turn(scenarios.hello)
      assert.deepStrictEqual(events.at(-1), {
        _tag: 'TurnEnded',
        stopReason: 'end_turn',
        usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
      })
      assert.strictEqual(text(events), 'Hello')
    }),
  )

  it.live('keeps thoughts apart from the message', () =>
    Effect.gen(function* () {
      const { events } = yield* turn(scenarios.think)
      assert.deepStrictEqual(
        events.map((event) => event._tag),
        ['AgentThought', 'AgentMessage', 'TurnEnded'],
      )
    }),
  )

  it.live('asks Charrette for permission, and answers with a one-time option', () =>
    Effect.gen(function* () {
      const allowed = yield* turn(scenarios.tool, 'allow')
      assert.strictEqual(text(allowed.events), 'chosen=allow-once')
      assert.lengthOf(allowed.permissions, 1)
      assert.deepStrictEqual(
        { ...allowed.permissions[0], options: undefined },
        {
          sessionId: 'fake-1',
          toolCallId: 'call-1',
          title: 'Write hello.txt',
          kind: 'edit',
          rawInput: { path: 'hello.txt' },
          options: undefined,
        },
      )
      const toolEvents = allowed.events.filter((event) => event._tag === 'ToolCall' || event._tag === 'ToolCallUpdate')
      assert.deepStrictEqual(
        toolEvents.map((event) => [event._tag, event.status]),
        [
          ['ToolCall', 'pending'],
          ['ToolCallUpdate', 'completed'],
        ],
      )
      const rejected = yield* turn(scenarios.tool, 'reject')
      assert.strictEqual(text(rejected.events), 'chosen=reject-once')
    }),
  )

  it.live('never allows always: with no one-time allow on offer, the request is cancelled', () =>
    Effect.gen(function* () {
      const { events } = yield* turn(scenarios.toolAlwaysOnly, 'allow')
      assert.strictEqual(text(events), 'chosen=cancelled')
      assert.isUndefined(oneTimeOption([{ optionId: 'a', name: 'Always', kind: 'allow_always' }], 'allow'))
    }),
  )

  it.live('passes on plans, context usage, notices and the agent changing its own options', () =>
    Effect.gen(function* () {
      const { events, options } = yield* turn(scenarios.updates)
      assert.deepStrictEqual(
        events.map((event) => event._tag),
        ['Plan', 'ContextUsage', 'Notice', 'OptionsChanged', 'ModeChanged', 'Other', 'TurnEnded'],
      )
      assert.strictEqual(options.find((option) => option.id === 'model')?.currentValue, 'large')
    }),
  )

  it.live('keeps an update this version does not know, rather than failing', () =>
    Effect.gen(function* () {
      const { events } = yield* turn(scenarios.unknownUpdate)
      assert.strictEqual(text(events), 'after')
      assert.strictEqual(events.at(-1)?._tag, 'TurnEnded')
    }),
  )

  it.live('recognises a usage limit, and when it resets', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(turn(scenarios.usageLimit))
      assert.instanceOf(error, AgentRequestFailed)
      assert.deepStrictEqual(
        { failure: (error as AgentRequestFailed).failure, resetsAt: (error as AgentRequestFailed).resetsAt },
        { failure: 'usage_limit', resetsAt: '2025-09-28T16:00:00.000Z' },
      )
    }),
  )

  it.live('recognises a missing sign-in', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(turn(scenarios.auth))
      assert.strictEqual((error as AgentRequestFailed).failure, 'auth_required')
    }),
  )

  it.live('uses the mode, model, directories and MCP servers it was given', () =>
    withConnection(fake, (connection) =>
      Effect.gen(function* () {
        const session = yield* connection.newSession({
          cwd: '/tmp',
          mode: 'read-only',
          additionalDirectories: ['/tmp/api'],
          mcpServers: [{ name: 'charrette', command: 'charrette-tools', args: [], env: [] }],
        })
        yield* session.setOption('model', 'large')
        assert.strictEqual(
          text(yield* Stream.runCollect(session.prompt(scenarios.settings))),
          'mode=read-only model=large directories=1 mcp=1',
        )
      }),
    ),
  )

  const variant = (options: FakeAgentOptions): ContractSubject => ({
    ...fake,
    transport: () => ({ _tag: 'InProcess', agent: fakeAgent(options) }),
  })

  it.live('sets the mode through legacy session modes, when that is all the agent has', () =>
    withConnection(variant({ modes: 'legacy' }), (connection) =>
      Effect.gen(function* () {
        const session = yield* connection.newSession({ cwd: '/tmp', mode: 'ask' })
        assert.strictEqual(text(yield* Stream.runCollect(session.prompt(scenarios.settings))), 'mode=ask model=small directories=0 mcp=0')
        const error = yield* Effect.flip(connection.newSession({ cwd: '/tmp', mode: 'yolo' }))
        assert.deepStrictEqual((error as OptionUnavailable).available, ['ask', 'read-only', 'bypass'])
      }),
    ),
  )

  it.live('refuses to start a session in an agent with no modes, since it could not be made to ask', () =>
    withConnection(variant({ modes: 'none' }), (connection) =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(connection.newSession({ cwd: '/tmp', mode: 'ask' }))
        assert.instanceOf(error, OptionUnavailable)
      }),
    ),
  )

  it.live('fills in what a bare agent leaves out', () =>
    withConnection(variant({ bare: true }), (connection) =>
      Effect.sync(() => {
        assert.deepStrictEqual(connection.info, {
          name: 'unknown',
          protocolVersion: 1,
          loadSession: false,
          steering: false,
          mcp: { http: false, sse: false },
          authMethods: [],
        })
      }),
    ),
  )

  it.live('gives a permission request with no kind the kind other', () =>
    Effect.gen(function* () {
      const { permissions } = yield* turn(scenarios.toolAlwaysOnly, 'reject')
      assert.strictEqual(permissions[0]?.kind, 'other')
      assert.isUndefined(permissions[0]?.rawInput)
    }),
  )
})
