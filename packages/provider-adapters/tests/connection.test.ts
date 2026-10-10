import { assert, describe, it } from '@effect/vitest'
import { Effect, Fiber, Ref, Stream } from 'effect'

import { answerFor, connect, type PermissionOption, type QuestionAnswer } from '../src/AgentConnection'
import { AgentRequestFailed, OptionUnavailable, TurnInProgress } from '../src/errors'
import type { SessionEvent } from '../src/events'
import type { Classified } from '../src/failures'
import { codexLikeMeanings, fakeAgent, type FakeAgentOptions, scenarios } from '../src/testing'
import { type ContractSubject, type Decide, text, withConnection } from './contract'

const fake: ContractSubject = {
  name: 'fake agent',
  transport: () => ({ _tag: 'InProcess', agent: fakeAgent() }),
  cwd: '/tmp',
  modes: { ask: 'ask', readOnly: 'read-only' },
  permissions: codexLikeMeanings,
  model: { optionId: 'model', switchTo: 'large' },
  prompts: { short: scenarios.hello, long: scenarios.slow, command: scenarios.commandChoices },
}

const allow: Decide = () => Effect.succeed({ decision: 'allow' })
const reject: Decide = () => Effect.succeed({ decision: 'reject' })

const turn = (prompt: string, decide: Decide = reject, mode = 'ask') =>
  withConnection(
    fake,
    (connection, permissions) =>
      Effect.gen(function* () {
        const session = yield* connection.newSession({ cwd: '/tmp', mode })
        const events = yield* Stream.runCollect(session.prompt(prompt))
        return { events, permissions: yield* Ref.get(permissions), options: yield* session.options, mode: yield* session.mode }
      }),
    decide,
  )

const stopReason = (events: ReadonlyArray<SessionEvent>) => {
  const last = events.at(-1)
  return last?._tag === 'TurnEnded' ? last.stopReason : undefined
}
const tags = (events: ReadonlyArray<SessionEvent>) => events.map((event) => event._tag)
const find = <T extends SessionEvent['_tag']>(events: ReadonlyArray<SessionEvent>, tag: T) =>
  events.filter((event): event is Extract<SessionEvent, { _tag: T }> => event._tag === tag)

describe('AgentConnection', () => {
  it.live('reports the agent and what it advertises', () =>
    withConnection(fake, (connection) =>
      Effect.sync(() => {
        assert.deepStrictEqual(connection.info, {
          name: 'fake-agent',
          version: '0.0.0',
          protocolVersion: 1,
          loadSession: false,
          closeSession: true,
          steering: true,
          mcp: { http: true, sse: false },
          authMethods: [],
        })
        assert.isUndefined(connection.process)
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

  it.live('finds the mode option by the id it is given', () =>
    withConnection(fake, (connection) =>
      Effect.gen(function* () {
        const session = yield* connection.newSession({ cwd: '/tmp', mode: 'read-only', modeOptionId: 'mode' })
        assert.strictEqual(yield* session.mode, 'read-only')
        const error = yield* Effect.flip(connection.newSession({ cwd: '/tmp', mode: 'ask', modeOptionId: 'posture' }))
        assert.instanceOf(error, OptionUnavailable)
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
      assert.deepStrictEqual(tags(events), ['AgentThought', 'AgentMessage', 'TurnEnded'])
    }),
  )

  it.live('passes on plans, context usage, notices and the agent changing its own options', () =>
    Effect.gen(function* () {
      const { events, options } = yield* turn(scenarios.updates)
      // The mode update repeats the mode the session is already in, so it is not passed on.
      assert.deepStrictEqual(tags(events), ['Plan', 'ContextUsage', 'Notice', 'OptionsChanged', 'Other', 'TurnEnded'])
      assert.strictEqual(options.find((option) => option.id === 'model')?.currentValue, 'large')
    }),
  )

  it.live('says when the agent changes its own mode', () =>
    Effect.gen(function* () {
      const { events, mode } = yield* turn(scenarios.leaveMode, reject, 'read-only')
      assert.deepStrictEqual(find(events, 'ModeChanged'), [{ _tag: 'ModeChanged', modeId: 'ask', byAgent: true }])
      assert.strictEqual(mode, 'ask')
    }),
  )

  it.live('keeps an update this version does not know, rather than failing', () =>
    Effect.gen(function* () {
      const { events } = yield* turn(scenarios.unknownUpdate)
      assert.strictEqual(text(events), 'after')
      assert.strictEqual(events.at(-1)?._tag, 'TurnEnded')
    }),
  )

  it.live('uses the mode, model, directories and MCP servers it was given', () =>
    withConnection(fake, (connection) =>
      Effect.gen(function* () {
        const session = yield* connection.newSession({
          cwd: '/tmp',
          mode: 'read-only',
          additionalDirectories: ['/tmp/api'],
          mcpServers: [
            { type: 'stdio', name: 'althar', command: 'althar-tools', args: [], env: { ALTHAR_SESSION: 's1' } },
            { type: 'http', name: 'docs', url: 'http://127.0.0.1:9000/mcp', headers: { authorization: 'test' } },
          ],
          meta: { althar: true },
        })
        yield* session.setOption('model', 'large')
        assert.strictEqual(
          text(yield* Stream.runCollect(session.prompt(scenarios.settings))),
          'mode=read-only model=large directories=1 mcp=2',
        )
      }),
    ),
  )

  describe('turns', () => {
    it.live('runs one turn at a time', () =>
      withConnection(fake, (connection) =>
        Effect.gen(function* () {
          const session = yield* connection.newSession({ cwd: '/tmp', mode: 'ask' })
          const first = yield* Effect.forkChild(Stream.runCollect(session.prompt(scenarios.slow)))
          yield* Effect.sleep('50 millis')
          const refused = yield* Effect.flip(Stream.runCollect(session.prompt(scenarios.hello)))
          assert.instanceOf(refused, TurnInProgress)
          yield* session.interrupt
          assert.deepStrictEqual((yield* Fiber.join(first)).at(-1), { _tag: 'TurnEnded', stopReason: 'cancelled' })
          assert.strictEqual(text(yield* Stream.runCollect(session.prompt(scenarios.hello))), 'Hello')
        }),
      ),
    )

    it.live('reads a turn to its end when its stream is stopped early, so the next turn gets only its own events', () =>
      withConnection(fake, (connection) =>
        Effect.gen(function* () {
          const session = yield* connection.newSession({ cwd: '/tmp', mode: 'ask' })
          assert.deepStrictEqual(yield* Stream.runCollect(Stream.take(session.prompt(scenarios.hello), 1)), [
            { _tag: 'AgentMessage', text: 'Hel' },
          ])
          yield* Effect.sleep('50 millis')
          const next = yield* Stream.runCollect(session.prompt(scenarios.think))
          assert.deepStrictEqual(tags(next), ['AgentThought', 'AgentMessage', 'TurnEnded'])
        }),
      ),
    )

    it.live('does nothing when interrupted with no turn running', () =>
      withConnection(fake, (connection) =>
        Effect.gen(function* () {
          const session = yield* connection.newSession({ cwd: '/tmp', mode: 'ask' })
          yield* session.interrupt
        }),
      ),
    )

    it.live('passes on what the agent says between turns', () =>
      withConnection(fake, (connection) =>
        Effect.gen(function* () {
          const session = yield* connection.newSession({ cwd: '/tmp', mode: 'ask' })
          const between = yield* Effect.forkChild(Stream.runCollect(Stream.take(session.events, 1)))
          yield* Effect.sleep('10 millis')
          yield* Stream.runCollect(session.prompt(scenarios.afterTurn))
          assert.deepStrictEqual(tags(yield* Fiber.join(between)), ['Other'])
        }),
      ),
    )

    it.live('ends the turn with a failed prompt, so the session can go on', () =>
      withConnection(fake, (connection) =>
        Effect.gen(function* () {
          const session = yield* connection.newSession({ cwd: '/tmp', mode: 'ask' })
          const error = yield* Effect.flip(Stream.runCollect(session.prompt(scenarios.usageLimit)))
          assert.instanceOf(error, AgentRequestFailed)
          assert.deepStrictEqual(
            { failure: (error as AgentRequestFailed).failure, resetsAt: (error as AgentRequestFailed).resetsAt },
            { failure: 'usage_limit', resetsAt: '2025-09-28T16:00:00.000Z' },
          )
          assert.strictEqual(text(yield* Stream.runCollect(session.prompt(scenarios.hello))), 'Hello')
        }),
      ),
    )

    it.live('recognises a missing sign-in', () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(turn(scenarios.auth))
        assert.strictEqual((error as AgentRequestFailed).failure, 'auth_required')
      }),
    )
  })

  describe('permissions', () => {
    it.live('asks Althar, and answers with a one-time option', () =>
      Effect.gen(function* () {
        const allowed = yield* turn(scenarios.tool, allow)
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
            paths: ['hello.txt'],
            options: undefined,
          },
        )
        assert.deepStrictEqual(find(allowed.events, 'PermissionAnswered'), [
          { _tag: 'PermissionAnswered', toolCallId: 'call-1', decision: 'allow', optionId: 'allow-once', scope: 'once', stopsTurn: false },
        ])
        assert.deepStrictEqual(
          allowed.events.flatMap((event) =>
            event._tag === 'ToolCall' || event._tag === 'ToolCallUpdate' ? [[event._tag, event.status]] : [],
          ),
          [
            ['ToolCall', 'pending'],
            ['ToolCallUpdate', 'completed'],
          ],
        )
        const rejected = yield* turn(scenarios.tool, reject)
        assert.strictEqual(text(rejected.events), 'chosen=reject-once')
      }),
    )

    it.live('never allows always: with no one-time allow on offer, the request is cancelled', () =>
      Effect.gen(function* () {
        const { events, permissions } = yield* turn(scenarios.toolAlwaysOnly, allow)
        assert.strictEqual(text(events), 'chosen=cancelled')
        assert.strictEqual(permissions[0]?.kind, 'other')
        assert.isUndefined(permissions[0]?.rawInput)
      }),
    )

    it.live('describes a request that says only its id from the tool call it is about, as Codex asks for an MCP tool', () =>
      Effect.gen(function* () {
        const { events, permissions } = yield* turn(scenarios.bareAsk, allow)
        assert.strictEqual(text(events), 'chosen=allow-once')
        assert.deepStrictEqual(
          { title: permissions[0]?.title, kind: permissions[0]?.kind, rawInput: permissions[0]?.rawInput },
          { title: 'mcp.althar.draft_task', kind: 'execute', rawInput: { title: 'Probe' } },
        )
      }),
    )

    it.live("picks the rejection that carries on, by the agent's option meanings", () =>
      Effect.gen(function* () {
        const { events } = yield* turn(scenarios.commandChoices, reject)
        assert.strictEqual(text(events), 'chosen=decline')
        assert.strictEqual(stopReason(events), 'end_turn')
      }),
    )

    it.live('resumes a turn a rejection stopped, telling the agent why', () =>
      Effect.gen(function* () {
        const { events } = yield* turn(scenarios.fileEdit, () => Effect.succeed({ decision: 'reject', reason: 'edits wait for review' }))
        assert.deepStrictEqual(tags(events), [
          'ToolCall',
          'PermissionAnswered',
          'ToolCallUpdate',
          'AgentMessage',
          'Resumed',
          'AgentMessage',
          'TurnEnded',
        ])
        assert.deepStrictEqual(find(events, 'PermissionAnswered')[0], {
          _tag: 'PermissionAnswered',
          toolCallId: 'call-2',
          decision: 'reject',
          optionId: 'cancel',
          scope: 'once',
          stopsTurn: true,
        })
        assert.strictEqual(
          find(events, 'Resumed')[0]?.reason,
          "Edit app.ts was not allowed by the project's rules: edits wait for review. Carry on without it.",
        )
        assert.strictEqual(text(events), 'chosen=cancelcarrying on without it')
        assert.strictEqual(stopReason(events), 'end_turn')
      }),
    )

    for (const scenario of [scenarios.commandChoices, scenarios.fileEdit])
      it.live(`delivers the coordinator's reason even when refusal carries on: ${scenario}`, () =>
        Effect.gen(function* () {
          const { events } = yield* turn(scenario, () =>
            Effect.succeed({
              decision: 'reject',
              reason: 'This is outside the requested task.',
              decidedBy: 'coordinator',
            }),
          )
          assert.lengthOf(find(events, 'Resumed'), 1)
          assert.include(find(events, 'Resumed')[0]?.reason ?? '', 'not allowed by the coordinator: This is outside the requested task.')
          assert.include(text(events), 'carrying on without it')
          assert.strictEqual(stopReason(events), 'end_turn')
        }),
      )

    it.live('stops resuming an agent that keeps asking', () =>
      Effect.gen(function* () {
        const { events } = yield* turn(scenarios.stubborn, reject)
        assert.lengthOf(find(events, 'PermissionAnswered'), 4)
        assert.lengthOf(find(events, 'Resumed'), 3)
        assert.strictEqual(stopReason(events), 'cancelled')
      }),
    )

    it.live('does not deliver pending coordinator feedback after the person cancels', () =>
      withConnection(
        fake,
        (connection) =>
          Effect.gen(function* () {
            const session = yield* connection.newSession({ cwd: '/tmp', mode: 'ask' })
            const events: Array<SessionEvent> = []
            const pending = yield* Effect.forkChild(
              Stream.runForEach(session.prompt(scenarios.deniedThenWait), (event) =>
                Effect.sync(() => {
                  events.push(event)
                }),
              ),
            )
            while (!events.some((event) => event._tag === 'AgentMessage' && event.text === 'chosen=decline'))
              yield* Effect.sleep('5 millis')
            yield* session.interrupt
            yield* Fiber.join(pending)
            assert.lengthOf(find(events, 'Resumed'), 0)
            assert.strictEqual(stopReason(events), 'cancelled')
          }),
        () => Effect.succeed({ decision: 'reject', reason: 'Outside the task.', decidedBy: 'coordinator' }),
      ),
    )

    it.live('answers a waiting request itself when it cancels the turn', () =>
      Effect.gen(function* () {
        const subject: ContractSubject = { ...fake, transport: () => ({ _tag: 'InProcess', agent: fakeAgent({ keepsRequests: true }) }) }
        const events = yield* withConnection(
          subject,
          (connection, permissions) =>
            Effect.gen(function* () {
              const session = yield* connection.newSession({ cwd: '/tmp', mode: 'ask' })
              const running = yield* Effect.forkChild(Stream.runCollect(session.prompt(scenarios.commandChoices)))
              while ((yield* Ref.get(permissions)).length === 0) yield* Effect.sleep('5 millis')
              yield* session.interrupt
              return yield* Fiber.join(running)
            }),
          () => Effect.never,
        )
        assert.deepStrictEqual(find(events, 'PermissionWithdrawn'), [{ _tag: 'PermissionWithdrawn', toolCallId: 'call-2' }])
        assert.strictEqual(text(events), 'chosen=cancelled')
        assert.strictEqual(stopReason(events), 'cancelled')
      }),
    )

    it.live('rejects when the decision fails', () =>
      Effect.gen(function* () {
        const { events } = yield* turn(scenarios.tool, () => Effect.die('the rules could not be read'))
        assert.strictEqual(find(events, 'PermissionAnswered')[0]?.decision, 'reject')
        assert.strictEqual(text(events), 'chosen=reject-once')
      }),
    )
  })

  describe('questions', () => {
    const ask = (onQuestion?: () => Effect.Effect<QuestionAnswer>) =>
      Effect.scoped(
        Effect.gen(function* () {
          const connection = yield* connect({
            transport: { _tag: 'InProcess', agent: fakeAgent() },
            onPermission: reject,
            ...(onQuestion === undefined ? {} : { onQuestion }),
          })
          const session = yield* connection.newSession({ cwd: '/tmp', mode: 'ask' })
          return text(yield* Stream.runCollect(session.prompt(scenarios.question)))
        }),
      )

    it.live('passes a question to the person, and their answer back', () =>
      Effect.gen(function* () {
        const seen: Array<unknown> = []
        const answered = yield* ask(() => Effect.succeed({ action: 'accept', content: { database: 'sqlite' } }))
        assert.strictEqual(answered, 'answer={"database":"sqlite"}')
        yield* Effect.scoped(
          Effect.gen(function* () {
            const connection = yield* connect({
              transport: { _tag: 'InProcess', agent: fakeAgent() },
              onPermission: reject,
              onQuestion: (question) => Effect.sync(() => seen.push(question)).pipe(Effect.as({ action: 'decline' as const })),
            })
            const session = yield* connection.newSession({ cwd: '/tmp', mode: 'ask' })
            assert.strictEqual(text(yield* Stream.runCollect(session.prompt(scenarios.question))), 'answer=decline')
          }),
        )
        assert.deepStrictEqual(seen, [
          {
            sessionId: 'fake-1',
            message: 'Which database?',
            fields: { database: { type: 'string', enum: ['postgres', 'sqlite'] } },
            required: ['database'],
          },
        ])
      }),
    )

    it.live('cancels a question no one can answer', () =>
      Effect.gen(function* () {
        assert.strictEqual(yield* ask(), 'answer=cancel')
        assert.strictEqual(yield* ask(() => Effect.die('no one is there')), 'answer=cancel')
      }),
    )
  })

  describe('failures the agent reports', () => {
    it.live('an exhausted quota, and when it resets', () =>
      Effect.gen(function* () {
        const { events } = yield* turn(scenarios.quota)
        const classified: Classified = {
          failure: 'usage_limit',
          message: 'The Claude account has no available quota. Resets at 2026-09-29T05:00:00Z',
          resetsAt: '2026-09-29T05:00:00.000Z',
        }
        assert.deepStrictEqual(find(events, 'AgentFailure'), [{ _tag: 'AgentFailure', severity: 'error', classified }])
        assert.deepStrictEqual(events.at(-1), { _tag: 'TurnEnded', stopReason: 'end_turn', failure: classified })
      }),
    )

    it.live('a full context', () =>
      Effect.gen(function* () {
        const { events } = yield* turn(scenarios.contextFull)
        assert.deepStrictEqual(events.at(-1), {
          _tag: 'TurnEnded',
          stopReason: 'max_tokens',
          failure: { failure: 'context_full', message: 'This Claude turn reached its configured limit.' },
        })
      }),
    )

    it.live('a warning, which does not fail the turn', () =>
      Effect.gen(function* () {
        const { events } = yield* turn(scenarios.rateWarning)
        assert.deepStrictEqual(find(events, 'AgentFailure')[0]?.classified.failure, 'transient')
        assert.deepStrictEqual(events.at(-1), { _tag: 'TurnEnded', stopReason: 'end_turn' })
      }),
    )
  })

  describe('sessions', () => {
    const variant = (options: FakeAgentOptions): ContractSubject => ({
      ...fake,
      transport: () => ({ _tag: 'InProcess', agent: fakeAgent(options) }),
    })

    it.live('closes a session with the agent when its scope closes', () =>
      Effect.gen(function* () {
        const closed: Array<string> = []
        yield* withConnection(variant({ closed: (sessionId) => closed.push(sessionId) }), (connection) =>
          Effect.gen(function* () {
            yield* Effect.scoped(connection.newSession({ cwd: '/tmp', mode: 'ask' }))
            assert.deepStrictEqual(closed, ['fake-1'])
          }),
        )
      }),
    )

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
          assert.instanceOf(yield* Effect.flip(connection.newSession({ cwd: '/tmp', mode: 'ask' })), OptionUnavailable)
        }),
      ),
    )

    it.live('refuses a session whose mode did not change when set, and closes it at once', () =>
      Effect.gen(function* () {
        const closed: Array<string> = []
        yield* withConnection(variant({ modes: 'stuck', closed: (sessionId) => closed.push(sessionId) }), (connection) =>
          Effect.gen(function* () {
            const error = yield* Effect.flip(connection.newSession({ cwd: '/tmp', mode: 'ask' }))
            assert.instanceOf(error, OptionUnavailable)
            assert.strictEqual((error as OptionUnavailable).value, 'ask')
            assert.deepStrictEqual(closed, ['fake-1'])
          }),
        )
      }),
    )

    it.live('fills in what a bare agent leaves out', () =>
      withConnection(variant({ bare: true }), (connection) =>
        Effect.sync(() => {
          assert.deepStrictEqual(connection.info, {
            name: 'unknown',
            protocolVersion: 1,
            loadSession: false,
            closeSession: false,
            steering: false,
            mcp: { http: false, sse: false },
            authMethods: [],
          })
        }),
      ),
    )
  })
})

describe('answerFor', () => {
  const option = (optionId: string, kind: PermissionOption['kind']): PermissionOption => ({ optionId, name: optionId, kind })
  const claude = [option('allow-always', 'allow_always'), option('allow-once', 'allow_once'), option('reject', 'reject_once')]
  const codexCommand = [
    option('allow_once', 'allow_once'),
    option('allow_for_session', 'allow_always'),
    option('decline', 'reject_once'),
    option('cancel', 'reject_once'),
  ]
  const codexEdit = [option('allow_once', 'allow_once'), option('cancel', 'reject_once')]
  const codexPermissions = [option('allow_permissions_turn', 'allow_always'), option('reject_permissions', 'reject_once')]
  const meanings = {
    rejectAndContinue: ['decline'],
    rejectAndStop: ['cancel'],
    allowScopes: { allow_once: 'once' as const, allow_permissions_turn: 'turn' as const },
  }

  it('allows once, never always', () => {
    assert.deepStrictEqual(answerFor(claude, 'allow'), { optionId: 'allow-once', scope: 'once', stopsTurn: false })
    assert.deepStrictEqual(answerFor([option('allow-always', 'allow_always')], 'allow'), { optionId: null, scope: null, stopsTurn: true })
  })

  it('allows for the turn when that is the narrowest the agent offers', () => {
    assert.deepStrictEqual(answerFor(codexPermissions, 'allow', meanings), {
      optionId: 'allow_permissions_turn',
      scope: 'turn',
      stopsTurn: false,
    })
  })

  it('rejects in the way that lets the agent carry on', () => {
    assert.deepStrictEqual(answerFor(codexCommand, 'reject', meanings), { optionId: 'decline', scope: 'once', stopsTurn: false })
    assert.deepStrictEqual(answerFor(claude, 'reject'), { optionId: 'reject', scope: 'once', stopsTurn: false })
    assert.deepStrictEqual(answerFor(codexPermissions, 'reject', meanings), {
      optionId: 'reject_permissions',
      scope: 'once',
      stopsTurn: false,
    })
  })

  it('stops the turn when that is the only rejection on offer', () => {
    assert.deepStrictEqual(answerFor(codexEdit, 'reject', meanings), { optionId: 'cancel', scope: 'once', stopsTurn: true })
    assert.deepStrictEqual(answerFor([option('reject-always', 'reject_always')], 'reject'), {
      optionId: null,
      scope: null,
      stopsTurn: true,
    })
  })
})
