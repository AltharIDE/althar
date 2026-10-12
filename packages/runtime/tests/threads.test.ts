import { execFileSync } from 'node:child_process'

import type { ProjectId } from '@althar/domain'
import type { SessionEvent } from '@althar/provider-adapters'

import { assert, describe, it } from '@effect/vitest'
import { Effect, Exit, Layer, Stream } from 'effect'
import { SqlClient } from 'effect/sql'

import { Agents, WebCrypto } from '../src/Config'
import { UnknownAgent } from '../src/errors'
import { currentBranch, defaultBranch, remoteUrls } from '../src/git'
import { change } from '../src/records'
import { Live } from '../src/Live'
import { Sessions } from '../src/Sessions'
import { addItem, recorder, transcript } from '../src/threads'
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
