import { execFileSync } from 'node:child_process'

import type { ProjectId } from '@althar/domain'
import type { SessionEvent } from '@althar/provider-adapters'

import { assert, describe, it } from '@effect/vitest'
import { Effect, Exit, Fiber, Layer, Scope, Stream } from 'effect'
import { SqlClient } from 'effect/sql'

import { Agents, WebCrypto } from '../src/Config'
import { UnknownAgent } from '../src/errors'
import { currentBranch, defaultBranch, remoteUrls } from '../src/git'
import { change } from '../src/records'
import { Live } from '../src/Live'
import { Sessions } from '../src/Sessions'
import { Ledger } from '@althar/persistence-sqlite'
import { addItem, betweenTurns, recorder, transcript } from '../src/threads'
import { items, repository, runtime, task, turns, until } from './support'

/** A thread with a session on it, for the recorder to write into. */
const place = Effect.gen(function* () {
  const sessions = yield* Sessions
  const { project, task: created } = yield* task()
  const sessionId = yield* sessions.start({ threadId: created.threadId, agentId: 'codex' })
  // The session's first turn delivers its brief; the tests write after it.
  yield* until(turns(created.threadId), (rows) => rows[0]?.state === 'completed')
  const before = (yield* items(created.threadId)).length
  return { projectId: project.projectId as ProjectId, threadId: created.threadId, sessionId, before }
})

describe('the thread recorder', () => {
  it.live('keeps one item per tool call and per plan, and notes what the agent did on its own', () =>
    Effect.gen(function* () {
      const where = yield* place
      const record = recorder(where)
      const events: ReadonlyArray<SessionEvent> = [
        { _tag: 'ToolCallUpdate', toolCallId: 'early', status: 'in_progress' },
        { _tag: 'ToolCall', toolCallId: 'early', title: 'Run tests', kind: 'execute', status: 'in_progress' },
        {
          _tag: 'ToolCallUpdate',
          toolCallId: 'early',
          locations: [{ path: '/w/tests/a.test.ts', line: 4 }],
          rawInput: { command: 'bun test a' },
        },
        { _tag: 'AgentMessage', text: 'Look' },
        { _tag: 'AgentMessage', text: 'ing' },
        { _tag: 'Plan', entries: [{ content: 'Write it', status: 'pending' }] },
        { _tag: 'Plan', entries: [{ content: 'Write it', status: 'completed' }] },
        { _tag: 'ModeChanged', modeId: 'plan', byAgent: true },
        { _tag: 'ModeChanged', modeId: 'ask', byAgent: false },
        { _tag: 'Resumed', reason: 'Edit app.ts was not allowed.' },
        { _tag: 'Notice', severity: 'warning', title: 'Context is filling up' },
        { _tag: 'AgentFailure', severity: 'warning', classified: { failure: 'transient', message: 'Rate limited' } },
        { _tag: 'ContextUsage', used: 1, size: 2 },
      ]
      for (const event of events) yield* record.record(event)
      yield* record.flush
      const kinds = (yield* items(where.threadId))
        .slice(where.before)
        .map((item) => [item.kind, item.content.title ?? item.content.text ?? item.content.entries])
      assert.deepStrictEqual(kinds, [
        ['tool_call', 'Run tests'],
        ['agent_message', 'Looking'],
        ['plan', [{ content: 'Write it', status: 'completed' }]],
        ['notice', 'The agent moved to its plan mode.'],
        ['notice', 'Resumed after a rejection.'],
        ['notice', 'Context is filling up'],
        ['notice', 'Rate limited'],
      ])
      // What it touched stays with it, for the thread to show.
      const tool = (yield* items(where.threadId)).find((item) => item.kind === 'tool_call')
      assert.deepStrictEqual(tool?.content.locations, [{ path: '/w/tests/a.test.ts', line: 4 }])
      // An input that arrives in an update is kept, as Claude Code sends it.
      assert.deepStrictEqual(tool?.content.rawInput, { command: 'bun test a' })
    }).pipe(Effect.provide(runtime())),
  )

  it.live("keeps a tool call's command and paths, not what it writes or what came back, and says what it left out", () =>
    Effect.gen(function* () {
      const where = yield* place
      const record = recorder(where)
      yield* record.record({ _tag: 'ToolCall', toolCallId: 'write', title: 'Write .env', kind: 'edit', status: 'pending' })
      yield* record.record({
        _tag: 'ToolCallUpdate',
        toolCallId: 'write',
        rawInput: { file_path: '/w/.env', content: 'API_KEY=sk-canary-123' },
      })
      yield* record.record({
        _tag: 'ToolCallUpdate',
        toolCallId: 'write',
        status: 'completed',
        rawOutput: { written: 'API_KEY=sk-canary-123' },
      })
      const tool = (yield* items(where.threadId)).find((item) => item.kind === 'tool_call')
      assert.deepStrictEqual(tool?.content, {
        title: 'Write .env',
        kind: 'edit',
        status: 'completed',
        rawInput: { file_path: '/w/.env' },
        cut: ['content', 'output'],
        // The file it wrote whole, by its path alone.
        files: [{ path: '/w/.env', how: 'wrote', mediaType: null, bytes: null, title: null }],
      })
      const sql = yield* SqlClient.SqlClient
      const stored = yield* sql<{ content: string }>`SELECT content FROM thread_items WHERE thread_id = ${where.threadId}`
      assert.isFalse(stored.some((row) => row.content.includes('sk-canary')))
    }).pipe(Effect.provide(runtime())),
  )

  it.live('writes the thread as text for a new agent, keeping the most recent part that fits', () =>
    Effect.gen(function* () {
      const where = yield* place
      const writer = recorder(where)
      yield* writer.record({ _tag: 'AgentMessage', text: 'first' })
      yield* writer.record({ _tag: 'ToolCall', toolCallId: 'a', title: 'Read README', kind: 'read', status: 'completed' })
      yield* writer.record({ _tag: 'Notice', severity: 'info', title: 'Plain', description: 'with detail' })
      yield* writer.record({ _tag: 'AgentThought', text: 'thinking is left out' })
      yield* writer.flush
      const whole = yield* transcript(where.threadId, 10_000)
      assert.strictEqual(whole.omitted, 0)
      assert.isTrue(whole.text.startsWith('[codex] echo: You are working on a task'))
      assert.isTrue(whole.text.endsWith('\n[codex] first\n[tool] Read README (completed)\n[note] Plain: with detail'))
      const tail = yield* transcript(where.threadId, 30)
      assert.deepStrictEqual(tail, { text: '[note] Plain: with detail', omitted: 3 })
      // Steps' results and task cards are written in a line each; a card for a task that's gone, not at all.
      const { projectId } = where
      const [task] = yield* (yield* SqlClient.SqlClient)<{ id: string }>`SELECT task_id AS id FROM threads WHERE id = ${where.threadId}`
      yield* addItem({ projectId, threadId: where.threadId }, 'step_result', { step: 'review', verdict: 'pass', summary: 'Holds.' })
      yield* addItem({ projectId, threadId: where.threadId }, 'task', { taskId: task?.id })
      yield* addItem({ projectId, threadId: where.threadId }, 'task', { taskId: 'tsk_gone' })
      yield* addItem({ projectId, threadId: where.threadId }, 'agent_message', { text: 'from nobody' })
      assert.isTrue(
        (yield* transcript(where.threadId, 10_000)).text.endsWith(
          '\n[review, pass] Holds.\n[task] retry-checkout: Retry checkout\n[agent] from nobody',
        ),
      )
      // A push the lead asked for says how it stands, so the next lead doesn't ask again for what went.
      const push = (count: number, state: string) =>
        addItem({ projectId, threadId: where.threadId }, 'push_request', { where: 'PR #12', count, state })
      yield* push(1, 'pushed')
      yield* push(2, 'replaced')
      yield* push(3, 'closed')
      yield* push(4, 'open')
      assert.isTrue(
        (yield* transcript(where.threadId, 10_000)).text.endsWith(
          [
            '[the lead asked the person to push] 1 commit to PR #12: pushed',
            '[the lead asked the person to push] 2 commits to PR #12: asked again later',
            '[the lead asked the person to push] 3 commits to PR #12: not pushed: the pull request closed',
            '[the lead asked the person to push] 4 commits to PR #12: not pushed yet',
          ].join('\n'),
        ),
      )
    }).pipe(Effect.provide(runtime())),
  )
})

describe('long messages', () => {
  it.live('are written as they grow, not only when they end', () =>
    Effect.gen(function* () {
      const where = yield* place
      const writer = recorder(where)
      yield* writer.record({ _tag: 'AgentMessage', text: 'Start. ' })
      yield* writer.record({ _tag: 'AgentMessage', text: 'x'.repeat(2_500) })
      const [written] = (yield* items(where.threadId)).slice(where.before)
      assert.strictEqual(String(written?.content.text).length, 2_507)
      yield* writer.record({ _tag: 'AgentMessage', text: ' end' })
      yield* writer.flush
      const [done] = (yield* items(where.threadId)).slice(where.before)
      assert.isTrue(String(done?.content.text).endsWith('x end'))
    }).pipe(Effect.provide(runtime())),
  )
})

describe('what an agent says between turns', () => {
  const chunks = (tag: 'AgentMessage' | 'AgentThought', words: ReadonlyArray<string>, messageId?: string): ReadonlyArray<SessionEvent> =>
    words.map((text) => ({ _tag: tag, text, ...(messageId === undefined || tag === 'AgentThought' ? {} : { messageId }) }) as SessionEvent)

  const texts = (threadId: string, before: number) =>
    items(threadId).pipe(Effect.map((all) => all.slice(before).map((item) => [item.kind, item.content.text ?? item.content.title])))

  const tool: SessionEvent = { _tag: 'ToolCall', toolCallId: 'check', title: 'Run the check', kind: 'execute', status: 'in_progress' }

  for (const [tag, kind] of [
    ['AgentMessage', 'agent_message'],
    ['AgentThought', 'agent_thought'],
  ] as const) {
    for (const ids of [false, true]) {
      it.live(`keeps a ${kind} whole around a tool call, ${ids ? 'with' : 'without'} message ids`, () =>
        Effect.gen(function* () {
          const where = yield* place
          const scope = yield* Scope.make()
          const { record } = yield* betweenTurns(recorder(where), scope)
          const run = [
            ...chunks(tag, ['The log', " isn't", ' where I', ' expected.'], ids ? 'm1' : undefined),
            tool,
            ...chunks(tag, ['Coverage ', 'clears ', '90%.'], ids ? 'm2' : undefined),
          ]
          for (const event of run) yield* record(event)
          yield* until(texts(where.threadId, where.before), (rows) => rows.length === 3 && rows[2]?.[1] === 'Coverage clears 90%.')
          assert.deepStrictEqual(yield* texts(where.threadId, where.before), [
            [kind, "The log isn't where I expected."],
            ['tool_call', 'Run the check'],
            [kind, 'Coverage clears 90%.'],
          ])
          yield* Scope.close(scope, Exit.void)
        }).pipe(Effect.provide(runtime())),
      )
    }
  }

  it.live('tells two messages apart by their ids, with nothing between them', () =>
    Effect.gen(function* () {
      const where = yield* place
      const scope = yield* Scope.make()
      const { record } = yield* betweenTurns(recorder(where), scope)
      for (const event of [...chunks('AgentMessage', ['One ', 'two.'], 'a'), ...chunks('AgentMessage', ['Three ', 'four.'], 'b')])
        yield* record(event)
      yield* until(texts(where.threadId, where.before), (rows) => rows.length === 2 && rows[1]?.[1] === 'Three four.')
      assert.deepStrictEqual(yield* texts(where.threadId, where.before), [
        ['agent_message', 'One two.'],
        ['agent_message', 'Three four.'],
      ])
      yield* Scope.close(scope, Exit.void)
    }).pipe(Effect.provide(runtime())),
  )

  it.live('closes a message once the agent goes quiet, and the next one is a new item', () =>
    Effect.gen(function* () {
      const where = yield* place
      const scope = yield* Scope.make()
      const { record } = yield* betweenTurns(recorder(where), scope, '50 millis')
      for (const event of chunks('AgentMessage', ['First ', 'part.'])) yield* record(event)
      yield* Effect.sleep('300 millis')
      for (const event of chunks('AgentMessage', ['Second.'])) yield* record(event)
      yield* until(texts(where.threadId, where.before), (rows) => rows.length === 2)
      assert.deepStrictEqual(yield* texts(where.threadId, where.before), [
        ['agent_message', 'First part.'],
        ['agent_message', 'Second.'],
      ])
      yield* Scope.close(scope, Exit.void)
    }).pipe(Effect.provide(runtime())),
  )
  it.live('keeps what was said when the scope ends before the agent goes quiet', () =>
    Effect.gen(function* () {
      const where = yield* place
      const scope = yield* Scope.make()
      const { record } = yield* betweenTurns(recorder(where), scope)
      for (const event of chunks('AgentMessage', ['Cut ', 'off ', 'soon.'])) yield* record(event)
      yield* Scope.close(scope, Exit.void)
      assert.deepStrictEqual(yield* texts(where.threadId, where.before), [['agent_message', 'Cut off soon.']])
    }).pipe(Effect.provide(runtime())),
  )

  /** A ledger that takes its time to notify, so a write is under way, inside its transaction, while the test acts. */
  const slowLedger = Effect.gen(function* () {
    const real = yield* Ledger
    return Ledger.of({ ...real, notify: (change) => Effect.andThen(Effect.sleep('300 millis'), real.notify(change)) })
  })

  it.live('keeps what was said when the scope ends while the quiet close is writing it', () =>
    Effect.gen(function* () {
      const where = yield* place
      const slow = yield* slowLedger
      const scope = yield* Scope.make()
      const { record } = yield* betweenTurns(recorder(where), scope, '50 millis')
      const [last, ...before] = chunks('AgentMessage', ['Cut ', 'off ', 'mid-write.']).toReversed()
      for (const event of before.toReversed()) yield* record(event)
      // The timer is forked with the slow ledger, so what it writes at the end of the quiet is still under way when the scope ends.
      if (last !== undefined) yield* Effect.provideService(record(last), Ledger, slow)
      yield* Effect.sleep('150 millis')
      yield* Scope.close(scope, Exit.void)
      assert.deepStrictEqual(yield* texts(where.threadId, where.before), [['agent_message', 'Cut off mid-write.']])
    }).pipe(Effect.provide(runtime())),
  )

  it.live('writes a message again when a write of it was cut short', () =>
    Effect.gen(function* () {
      const where = yield* place
      const slow = yield* slowLedger
      const items = recorder(where)
      for (const event of chunks('AgentMessage', ['Whole ', 'text.'])) yield* items.record(event)
      const writing = yield* Effect.forkChild(Effect.provideService(items.flush, Ledger, slow))
      yield* Effect.sleep('100 millis')
      yield* Fiber.interrupt(writing)
      yield* items.flush
      assert.deepStrictEqual(yield* texts(where.threadId, where.before), [['agent_message', 'Whole text.']])
    }).pipe(Effect.provide(runtime())),
  )

  it.live('closes a message when the stream is handed on, so what comes next is a new item', () =>
    Effect.gen(function* () {
      const where = yield* place
      const scope = yield* Scope.make()
      const { record, close } = yield* betweenTurns(recorder(where), scope)
      for (const event of chunks('AgentMessage', ['Before ', 'the turn.'])) yield* record(event)
      yield* close
      for (const event of chunks('AgentMessage', ['After ', 'it.'])) yield* record(event)
      yield* Scope.close(scope, Exit.void)
      assert.deepStrictEqual(yield* texts(where.threadId, where.before), [
        ['agent_message', 'Before the turn.'],
        ['agent_message', 'After it.'],
      ])
    }).pipe(Effect.provide(runtime())),
  )
})

describe('the runtime helpers', () => {
  it.effect('reads what git knows about a repository', () =>
    Effect.gen(function* () {
      const path = repository()
      execFileSync('git', ['remote', 'add', 'origin', 'https://example.test/meridian.git'], { cwd: path })
      assert.deepStrictEqual(yield* remoteUrls(path), ['https://example.test/meridian.git'])
      assert.strictEqual(yield* defaultBranch(path), 'main')
      execFileSync('git', ['update-ref', 'refs/remotes/origin/trunk', 'HEAD'], { cwd: path })
      execFileSync('git', ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk'], { cwd: path })
      assert.strictEqual(yield* defaultBranch(path), 'trunk')
      const detached = repository()
      execFileSync('git', ['checkout', '-q', '--detach'], { cwd: detached })
      assert.isUndefined(yield* currentBranch(detached))
      assert.strictEqual(yield* defaultBranch(detached), 'main')
    }),
  )

  it.live('fails to change a row that does not exist', () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(change('tasks', 'task_missing', { title: 'x' }))
      assert.isTrue(Exit.isFailure(exit))
    }).pipe(Effect.provide(runtime())),
  )

  it.effect('finds the registry agents, each run as a process', () =>
    Effect.gen(function* () {
      const agents = yield* Agents
      const codex = yield* agents.get('codex')
      assert.strictEqual(codex.definition.name, 'Codex')
      assert.strictEqual(codex.transport('/tmp')._tag, 'Process')
      assert.instanceOf(yield* Effect.flip(agents.get('gemini')), UnknownAgent)
    }).pipe(Effect.provide(Layer.sync(Agents, () => Agents.fromRegistry()))),
  )

  it.live('lets a client subscribe before anything happens, and miss nothing', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const live = yield* Live
        const events = yield* live.subscribe
        yield* live.publish({ _tag: 'TurnStarted', threadId: 't', turnId: 'u' })
        const [first] = yield* Stream.runCollect(Stream.take(events, 1))
        assert.deepStrictEqual(first, { _tag: 'TurnStarted', threadId: 't', turnId: 'u' })
      }),
    ).pipe(Effect.provide(Live.layer)),
  )

  it.effect('digests with the platform crypto', () =>
    Effect.gen(function* () {
      const { Crypto } = yield* Effect.promise(() => import('effect'))
      const crypto = yield* Crypto.Crypto
      const digest = yield* crypto.digest('SHA-256', new Uint8Array([1]))
      assert.strictEqual(digest.length, 32)
    }).pipe(Effect.provide(WebCrypto)),
  )
})
