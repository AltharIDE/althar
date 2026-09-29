import { execFileSync } from 'node:child_process'

import type { ProjectId } from '@charrette/domain'
import type { SessionEvent } from '@charrette/provider-adapters'

import { assert, describe, it } from '@effect/vitest'
import { Effect, Exit } from 'effect'

import { Agents, WebCrypto } from '../src/Config'
import { UnknownAgent } from '../src/errors'
import { currentBranch, defaultBranch, remoteUrls } from '../src/git'
import { change } from '../src/records'
import { Sessions } from '../src/Sessions'
import { recorder, transcript } from '../src/threads'
import { items, repository, runtime, task } from './support'

/** A thread with a session on it, for the recorder to write into. */
const place = Effect.gen(function* () {
  const sessions = yield* Sessions
  const { project, task: created } = yield* task()
  const sessionId = yield* sessions.start({ threadId: created.threadId, agentId: 'codex' })
  return { projectId: project.projectId as ProjectId, threadId: created.threadId, sessionId }
})

describe('the thread recorder', () => {
  it.live('keeps one item per tool call and per plan, and notes what the agent did on its own', () =>
    Effect.gen(function* () {
      const where = yield* place
      const record = recorder(where)
      const events: ReadonlyArray<SessionEvent> = [
        { _tag: 'ToolCallUpdate', toolCallId: 'early', status: 'in_progress' },
        { _tag: 'ToolCall', toolCallId: 'early', title: 'Run tests', kind: 'execute', status: 'in_progress' },
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
      const kinds = (yield* items(where.threadId)).map((item) => [
        item.kind,
        item.content.title ?? item.content.text ?? item.content.entries,
      ])
      assert.deepStrictEqual(kinds, [
        ['tool_call', 'Run tests'],
        ['agent_message', 'Looking'],
        ['plan', [{ content: 'Write it', status: 'completed' }]],
        ['notice', 'The agent moved to its plan mode.'],
        ['notice', 'Resumed after a rejection.'],
        ['notice', 'Context is filling up'],
        ['notice', 'Rate limited'],
      ])
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
      assert.deepStrictEqual(whole, { text: '[codex] first\n[tool] Read README (completed)\n[note] Plain: with detail', omitted: 0 })
      const tail = yield* transcript(where.threadId, 30)
      assert.deepStrictEqual(tail, { text: '[note] Plain: with detail', omitted: 2 })
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
    }).pipe(Effect.provide(Agents.registry)),
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
