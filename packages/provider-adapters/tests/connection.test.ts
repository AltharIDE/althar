import { assert, describe, it } from '@effect/vitest'
import { Deferred, Effect, Fiber, Ref, Stream } from 'effect'

import { answerFor, connect, type PermissionOption } from '../src/AgentConnection'
import { type Question, type QuestionAnswer, questionContent } from '../src/questions'
import { AgentRequestFailed, OptionUnavailable, TurnInProgress } from '../src/errors'
import { changeOf, type SessionEvent } from '../src/events'
import type { Classified } from '../src/failures'
import { codexLikeMeanings, fakeAgent, type FakeAgentOptions, HANDED_DOCUMENT, SCREENSHOT_PNG, scenarios, WHY } from '../src/testing'
import { type ContractSubject, type Decide, text, withConnection } from './contract'

const fake: ContractSubject = {
  name: 'fake agent',
  transport: () => ({ _tag: 'InProcess', agent: fakeAgent() }),
  cwd: '/tmp',
  modes: { ask: 'ask', readOnly: 'read-only' },
  permissions: codexLikeMeanings,
  model: { optionId: 'model', switchTo: 'large' },
  prompts: { short: scenarios.hello, long: scenarios.slow, command: scenarios.commandChoices, question: scenarios.questions },
  asks: 'form',
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
  it.live('asks for command output, what it leaves running and notices, and keeps asking for structured failures', () => {
    let asked: unknown
    let notices: unknown
    const listening: ContractSubject = {
      ...fake,
      transport: () => ({
        _tag: 'InProcess',
        agent: fakeAgent({
          initialized: (capabilities) => {
            asked = capabilities?._meta
            notices = capabilities?.session?.notices
          },
        }),
      }),
    }
    return withConnection(listening, () =>
      Effect.sync(() => {
        assert.deepStrictEqual(asked, {
          jetbrains: { air: { version: 1, capabilities: ['sessionFailure', 'asyncTasks'] } },
          terminal_output_delta: true,
        })
        assert.deepStrictEqual(notices, {})
      }),
    )
  })

  describe('what it leaves running', () => {
    it.live('hears a command Claude Code sent to the background, and nothing else it does there, and stops it', () =>
      withConnection(fake, (connection) =>
        Effect.gen(function* () {
          const session = yield* connection.newSession({ cwd: '/tmp', mode: 'ask' })
          const events = yield* Stream.runCollect(session.prompt(scenarios.background))
          // By what its tool call says it does; the call has the command.
          assert.deepInclude(find(events, 'BackgroundStarted')[0], { id: 'bg-1', name: 'Start the dev server', toolCallId: 'serve-1' })
          assert.match(find(events, 'BackgroundOutput')[0]?.outputPath ?? '', /bg-1\.output$/)
          assert.lengthOf(find(events, 'BackgroundStarted'), 1, 'background work that isn’t a command isn’t heard')
          assert.strictEqual(text(events), 'serving')
          // Stopped, it says so between turns; there is then nothing to stop.
          const between = yield* Effect.forkChild(Stream.runCollect(Stream.take(session.events, 1)))
          yield* Effect.sleep('10 millis')
          assert.isTrue(yield* session.stopBackground('bg-1'))
          assert.deepStrictEqual(yield* Fiber.join(between), [{ _tag: 'BackgroundEnded', id: 'bg-1', end: 'stopped' }])
          assert.isFalse(yield* session.stopBackground('bg-1'))
        }),
      ),
    )

    it.live('hears one Codex sends to the background after the turn, by its command, with its output on its tool call', () =>
      withConnection(fake, (connection) =>
        Effect.gen(function* () {
          const session = yield* connection.newSession({ cwd: '/tmp', mode: 'ask' })
          const between = yield* Effect.forkChild(Stream.runCollect(Stream.take(session.events, 2)))
          yield* Effect.sleep('10 millis')
          const events = yield* Stream.runCollect(session.prompt(scenarios.backgroundCodex))
          assert.lengthOf(find(events, 'BackgroundStarted'), 0)
          const [started, output] = yield* Fiber.join(between)
          assert.deepStrictEqual(started, { _tag: 'BackgroundStarted', id: 'bg-1', name: 'bun dev', toolCallId: 'serve-1' })
          assert.include(output?._tag === 'ToolCallUpdate' ? output.terminal?.output : '', 'http://localhost:')
        }),
      ),
    )

    it.live('stops what a session left running when the session closes', () => {
      const stopped: Array<string> = []
      const subject: ContractSubject = {
        ...fake,
        transport: () => ({ _tag: 'InProcess', agent: fakeAgent({ stoppedBackground: (id) => stopped.push(id) }) }),
      }
      return withConnection(subject, (connection) =>
        Effect.gen(function* () {
          yield* Effect.scoped(
            Effect.gen(function* () {
              const session = yield* connection.newSession({ cwd: '/tmp', mode: 'ask' })
              yield* Stream.runCollect(session.prompt(scenarios.background))
            }),
          )
          assert.deepStrictEqual(stopped, ['bg-1'])
        }),
      )
    })
  })

  it.live('hears what an agent hands back: output in chunks and whole, pictures, links and the files it writes', () =>
    Effect.gen(function* () {
      const { events } = yield* turn(scenarios.handsBack)
      const updates = find(events, 'ToolCallUpdate')
      const chunks = updates.filter((event) => event.toolCallId === 'run-chunks').flatMap((event) => event.terminal?.output ?? [])
      assert.deepStrictEqual(chunks, [' ✓ charges/limit (14)\n', ' ✓ refunds/router (38)\n', ' 52 passed\n'])
      assert.deepStrictEqual(updates.find((event) => event.toolCallId === 'run-whole' && event.status === 'failed')?.terminal, {
        exit: { code: 1, signal: null },
      })
      const words = updates.filter((event) => event.toolCallId === 'run-words').map((event) => event.content)
      assert.deepStrictEqual(words.at(-1), [{ _tag: 'Text', text: ' M src/a.ts\n?? docs/notes.md\n' }])
      const shot = updates.find((event) => event.toolCallId === 'shot')
      assert.strictEqual(shot?.content?.[1]?._tag, 'Image')
      const wrote = find(events, 'ToolCall').find((event) => event.toolCallId === 'write-doc')
      assert.deepStrictEqual(wrote?.content, [
        { _tag: 'Diff', path: '/tmp/docs/notes.md', created: true, change: changeOf(null, HANDED_DOCUMENT.body) },
      ])
      const handed = find(events, 'AgentContent').map((event) => event.content._tag)
      assert.deepStrictEqual(handed, ['Link', 'Image'])
    }),
  )

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
          images: true,
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

    it.live('says a turn has started only once it can be interrupted', () =>
      withConnection(fake, (connection) =>
        Effect.gen(function* () {
          const session = yield* connection.newSession({ cwd: '/tmp', mode: 'ask' })
          // Stopped the moment it is said to have started, as a spent budget of turns does: the stop reaches it.
          const events = yield* Stream.runCollect(session.prompt(scenarios.slow, [], Effect.ignore(session.interrupt)))
          assert.strictEqual(stopReason(events), 'cancelled')
          assert.strictEqual(text(yield* Stream.runCollect(session.prompt(scenarios.hello))), 'Hello')
        }),
      ),
    )

    it.live('does not say a turn has started when the agent is already in one', () =>
      withConnection(fake, (connection) =>
        Effect.gen(function* () {
          const session = yield* connection.newSession({ cwd: '/tmp', mode: 'ask' })
          const first = yield* Effect.forkChild(Stream.runCollect(session.prompt(scenarios.slow)))
          yield* Effect.sleep('50 millis')
          const started = yield* Ref.make(false)
          const refused = yield* Effect.flip(Stream.runCollect(session.prompt(scenarios.hello, [], Ref.set(started, true))))
          assert.instanceOf(refused, TurnInProgress)
          assert.isFalse(yield* Ref.get(started))
          yield* session.interrupt
          yield* Fiber.join(first)
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

    it.live('runs the command it is given, asking first, as a tool call of its own each time', () =>
      withConnection(
        fake,
        (connection, permissions) =>
          Effect.gen(function* () {
            const session = yield* connection.newSession({ cwd: '/tmp', mode: 'ask' })
            const first = yield* Stream.runCollect(session.prompt(`${scenarios.run}git status --short`))
            yield* Stream.runCollect(session.prompt(`${scenarios.run}git status`))
            assert.strictEqual(text(first), 'chosen=allow_once')
            assert.deepStrictEqual(
              (yield* Ref.get(permissions)).map((request) => [request.toolCallId, request.kind, request.rawInput]),
              [
                ['run-1', 'execute', { command: 'git status --short' }],
                ['run-2', 'execute', { command: 'git status' }],
              ],
            )
          }),
        allow,
      ),
    )

    it.live('runs several commands at once, each asking as a tool call of its own, and says what was chosen for each', () =>
      withConnection(
        fake,
        (connection, permissions) =>
          Effect.gen(function* () {
            const session = yield* connection.newSession({ cwd: '/tmp', mode: 'ask' })
            const events = yield* Stream.runCollect(session.prompt(`${scenarios.runEach}make deploy; ./deploy.sh`))
            assert.strictEqual(text(events), 'chosen=allow_once,allow_once')
            assert.deepStrictEqual(
              (yield* Ref.get(permissions)).map((request) => [request.toolCallId, request.rawInput]),
              [
                ['run-1', { command: 'make deploy' }],
                ['run-2', { command: './deploy.sh' }],
              ],
            )
          }),
        allow,
      ),
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
    const ask = (onQuestion?: (question: Question) => Effect.Effect<QuestionAnswer>, scenario: string = scenarios.question) =>
      Effect.scoped(
        Effect.gen(function* () {
          const connection = yield* connect({
            transport: { _tag: 'InProcess', agent: fakeAgent() },
            onPermission: reject,
            ...(onQuestion === undefined ? {} : { onQuestion }),
          })
          const session = yield* connection.newSession({ cwd: '/tmp', mode: 'ask' })
          return text(yield* Stream.runCollect(session.prompt(scenario)))
        }),
      )

    it.live('passes a question to the person, and their answer back', () =>
      Effect.gen(function* () {
        const seen: Array<Question> = []
        const answered = yield* ask(() => Effect.succeed({ action: 'accept', content: { database: 'sqlite' } }))
        assert.strictEqual(answered, 'answer={"database":"sqlite"}')
        const declined = yield* ask((question) => Effect.sync(() => seen.push(question)).pipe(Effect.as({ action: 'decline' as const })))
        assert.strictEqual(declined, 'answer=decline')
        assert.deepStrictEqual(seen, [
          {
            sessionId: 'fake-1',
            message: 'Which database?',
            fields: [
              {
                id: 'database',
                question: 'Which database?',
                type: 'choice',
                options: [
                  { value: 'postgres', label: 'postgres' },
                  { value: 'sqlite', label: 'sqlite' },
                ],
                multiple: false,
                required: true,
              },
            ],
          },
        ])
      }),
    )

    it.live("reads Claude Code's questions, with the tool call they stand for, and answers them in its fields", () =>
      Effect.gen(function* () {
        const seen: Array<Question> = []
        const answered = yield* ask(
          (question) =>
            Effect.sync(() => seen.push(question)).pipe(
              Effect.as({
                action: 'accept' as const,
                content: questionContent(question, {
                  question_0: { values: [], words: 'DuckDB' },
                  question_1: { values: ['Unit tests', 'Lint'] },
                }),
              }),
            ),
          scenarios.questions,
        )
        assert.strictEqual(answered, `${WHY}answer={"question_0_custom":"DuckDB","question_1":["Unit tests","Lint"]}`)
        assert.strictEqual(seen[0]?.toolCallId, 'ask-1')
        // What it said before asking, though a tool call came between.
        assert.strictEqual(seen[0]?.said, WHY)
        assert.deepStrictEqual(
          seen[0]?.fields.map((field) => [field.id, field.question, field.header, field.multiple, field.wordsField]),
          [
            ['question_0', 'Which database should the cache use?', 'Database', false, 'question_0_custom'],
            ['question_1', 'Which checks should run before it lands?', 'Checks', true, 'question_1_custom'],
          ],
        )
      }),
    )

    it.live(
      'asks the person, never the rules, what an agent asks as a permission on a question’s tool call, and answers with their pick',
      () =>
        Effect.gen(function* () {
          const choose = (onQuestion?: (question: Question) => Effect.Effect<QuestionAnswer>, questions: string | null = 'interaction_') =>
            Effect.scoped(
              Effect.gen(function* () {
                const ruled: Array<string> = []
                const connection = yield* connect({
                  transport: { _tag: 'InProcess', agent: fakeAgent() },
                  onPermission: (request) =>
                    Effect.sync(() => ruled.push(request.toolCallId)).pipe(Effect.as({ decision: 'allow' as const })),
                  permissions: { rejectAndContinue: [], rejectAndStop: [], allowScopes: {}, ...(questions === null ? {} : { questions }) },
                  ...(onQuestion === undefined ? {} : { onQuestion }),
                })
                const session = yield* connection.newSession({ cwd: '/tmp', mode: 'ask' })
                return { said: text(yield* Stream.runCollect(session.prompt(scenarios.choice))), ruled }
              }),
            )
          const seen: Array<Question> = []
          const picked = yield* choose((question) =>
            Effect.sync(() => seen.push(question)).pipe(
              Effect.as({ action: 'accept' as const, content: questionContent(question, { answer: { values: ['2'] } }) }),
            ),
          )
          assert.deepStrictEqual(picked, { said: 'chosen=2', ruled: [] })
          assert.deepStrictEqual(seen, [
            {
              sessionId: 'fake-1',
              toolCallId: 'interaction_28ffdbf7',
              message: 'Which color do you prefer?',
              fields: [
                {
                  id: 'answer',
                  question: 'Which color do you prefer?',
                  type: 'choice',
                  options: [
                    { value: '1', label: 'red' },
                    { value: '2', label: 'blue' },
                  ],
                  multiple: false,
                  required: true,
                },
              ],
            },
          ])
          // Declined, or with no one to ask, it is cancelled: never the first answer, as the rules would allow it.
          assert.deepStrictEqual(yield* choose(() => Effect.succeed({ action: 'decline' })), { said: 'chosen=cancelled', ruled: [] })
          assert.deepStrictEqual(yield* choose(), { said: 'chosen=cancelled', ruled: [] })
          // An agent that doesn't ask so has it go to the rules, as any other request.
          assert.deepStrictEqual(yield* choose(undefined, null), { said: 'chosen=1', ruled: ['interaction_28ffdbf7'] })
        }),
    )

    it.live('hears what the agent said before asking in this turn only', () =>
      Effect.scoped(
        Effect.gen(function* () {
          const seen: Array<Question> = []
          const connection = yield* connect({
            transport: { _tag: 'InProcess', agent: fakeAgent() },
            onPermission: reject,
            onQuestion: (question) => Effect.sync(() => seen.push(question)).pipe(Effect.as({ action: 'decline' as const })),
          })
          const session = yield* connection.newSession({ cwd: '/tmp', mode: 'ask' })
          yield* Stream.runCollect(session.prompt(scenarios.hello))
          yield* Stream.runCollect(session.prompt(scenarios.question))
          // The plain question says nothing first: what it said a turn before isn't why.
          assert.isUndefined(seen[0]?.said)
        }),
      ),
    )

    it.live('offers a way to ask only where someone answers', () =>
      Effect.gen(function* () {
        const offered: Array<unknown> = []
        const listen = (onQuestion?: () => Effect.Effect<QuestionAnswer>) =>
          Effect.scoped(
            connect({
              transport: {
                _tag: 'InProcess',
                agent: fakeAgent({ initialized: (capabilities) => offered.push(capabilities?.elicitation ?? null) }),
              },
              onPermission: reject,
              ...(onQuestion === undefined ? {} : { onQuestion }),
            }),
          )
        yield* listen(() => Effect.succeed({ action: 'decline' }))
        yield* listen()
        assert.deepStrictEqual(offered, [{ form: {} }, null])
      }),
    )

    it.live('cancels a question no one can answer', () =>
      Effect.gen(function* () {
        assert.strictEqual(yield* ask(), 'answer=cancel')
        assert.strictEqual(yield* ask(() => Effect.die('no one is there')), 'answer=cancel')
      }),
    )

    for (const [how, keepsRequests] of [
      ['the agent withdraws it', false],
      ['the agent keeps it, so Althar drops it', true],
    ] as const)
      it.live(`drops a question still waiting when the turn is cancelled: ${how}`, () =>
        Effect.scoped(
          Effect.gen(function* () {
            const asked = yield* Deferred.make<void>()
            const ended = yield* Deferred.make<boolean>()
            const connection = yield* connect({
              transport: { _tag: 'InProcess', agent: fakeAgent({ keepsRequests }) },
              onPermission: reject,
              onQuestion: () =>
                Deferred.succeed(asked, undefined).pipe(
                  Effect.andThen(Effect.never),
                  Effect.onInterrupt(() => Deferred.succeed(ended, true)),
                ),
            })
            const session = yield* connection.newSession({ cwd: '/tmp', mode: 'ask' })
            const turn = yield* Effect.forkChild(Stream.runCollect(session.prompt(scenarios.question)))
            yield* Deferred.await(asked)
            yield* session.cancel
            const events = yield* Fiber.join(turn)
            assert.strictEqual(text(events), 'answer=cancel')
            assert.isTrue(yield* Deferred.await(ended))
          }),
        ),
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

    it.live('starts an agent with no modes in none, where its entry says its meta makes it ask', () =>
      withConnection(variant({ modes: 'none' }), (connection) =>
        Effect.gen(function* () {
          const session = yield* connection.newSession({ cwd: '/tmp', mode: null, meta: { yoloMode: false } })
          assert.strictEqual(yield* session.mode, '')
          assert.strictEqual(text(yield* Stream.runCollect(session.prompt(scenarios.hello))), 'Hello')
        }),
      ),
    )

    it.live('refuses to start an agent in no mode once it offers modes, as its entry no longer says what it is', () =>
      withConnection(fake, (connection) =>
        Effect.gen(function* () {
          const error = yield* Effect.flip(connection.newSession({ cwd: '/tmp', mode: null }))
          assert.instanceOf(error, OptionUnavailable)
          assert.deepStrictEqual((error as OptionUnavailable).available, ['ask', 'read-only', 'bypass'])
        }),
      ),
    )

    it.live('holds an option where it is held: set as the session starts, and set back when the agent moves it', () =>
      withConnection(variant({ allowAll: 'on' }), (connection) =>
        Effect.gen(function* () {
          const session = yield* connection.newSession({ cwd: '/tmp', mode: 'ask', held: { allow_all: 'off', colour: 'blue' } })
          assert.match(text(yield* Stream.runCollect(session.prompt(scenarios.settings))), /allow_all=off$/)
          const moved = yield* Stream.runCollect(session.prompt(scenarios.allowAll))
          assert.deepInclude(moved, { _tag: 'Notice', severity: 'info', title: "Althar set the agent's allow_all back to off." })
          assert.match(text(yield* Stream.runCollect(session.prompt(scenarios.settings))), /allow_all=off$/)
        }),
      ),
    )

    it.live('puts a reader back in its mode when the agent leaves it', () =>
      withConnection(fake, (connection) =>
        Effect.gen(function* () {
          const session = yield* connection.newSession({ cwd: '/tmp', mode: 'read-only', held: { mode: 'read-only' } })
          const events = yield* Stream.runCollect(session.prompt(scenarios.leaveMode))
          assert.strictEqual(yield* session.mode, 'read-only')
          assert.isFalse(events.some((event) => event._tag === 'ModeChanged'))
          assert.match(text(yield* Stream.runCollect(session.prompt(scenarios.settings))), /^mode=read-only /)
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

    it.live('sends images after the prompt’s text, in their order, to an agent that takes them, and none to one that doesn’t', () =>
      Effect.gen(function* () {
        const png = Buffer.from(SCREENSHOT_PNG, 'base64')
        const images = [
          { data: SCREENSHOT_PNG, mimeType: 'image/png' },
          { data: Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString('base64'), mimeType: 'image/jpeg' },
        ]
        const said = (subject: ContractSubject) =>
          withConnection(subject, (connection) =>
            Effect.gen(function* () {
              const session = yield* connection.newSession({ cwd: '/tmp', mode: 'ask' })
              return { takes: connection.info.images, text: text(yield* Stream.runCollect(session.prompt('look at these', images))) }
            }),
          )
        assert.deepStrictEqual(yield* said(fake), {
          takes: true,
          text: `saw images: image/png ${png.length} B, image/jpeg 4 B\n\necho: look at these`,
        })
        // One that doesn't say it takes images gets the words alone: the caller says what became of them.
        assert.deepStrictEqual(yield* said(variant({ images: false })), { takes: false, text: 'echo: look at these' })
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
            images: false,
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
