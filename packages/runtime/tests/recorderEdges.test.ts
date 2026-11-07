import type { ProjectId } from '@althar/domain'
import type { SessionEvent } from '@althar/provider-adapters'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { Sessions } from '../src/Sessions'
import { recorder } from '../src/threads'
import { items, runtime, task, turns, until } from './support'

/*
 * What the thread recorder keeps of what an agent says and does, where
 * threads.test.ts doesn't go: a message whose id comes after its first
 * words, and a command that fails saying why only in its own words.
 */

/** A thread with a session on it, for the recorder to write into, and how many items it had before. */
const place = Effect.gen(function* () {
  const sessions = yield* Sessions
  const { project, task: created } = yield* task()
  const sessionId = yield* sessions.start({ threadId: created.threadId, agentId: 'codex' })
  yield* until(turns(created.threadId), (rows) => rows[0]?.state === 'completed')
  const before = (yield* items(created.threadId)).length
  return { projectId: project.projectId as ProjectId, threadId: created.threadId, sessionId, before }
})

describe('the thread recorder, at its edges', () => {
  it.live('tells a message apart by the id it gave after its first words', () =>
    Effect.gen(function* () {
      const where = yield* place
      const writer = recorder(where)
      const events: ReadonlyArray<SessionEvent> = [
        { _tag: 'AgentMessage', text: 'One ' },
        { _tag: 'AgentMessage', text: 'two.', messageId: 'a' },
        { _tag: 'AgentMessage', text: 'Three.', messageId: 'b' },
      ]
      for (const event of events) yield* writer.record(event)
      yield* writer.flush
      const said = (yield* items(where.threadId)).slice(where.before).map((item) => [item.kind, item.content.text])
      assert.deepStrictEqual(said, [
        ['agent_message', 'One two.'],
        ['agent_message', 'Three.'],
      ])
    }).pipe(Effect.provide(runtime())),
  )

  it.live('keeps whether a message is the agent’s answer, where it says, through every write of it', () =>
    Effect.gen(function* () {
      const where = yield* place
      const writer = recorder(where)
      const events: ReadonlyArray<SessionEvent> = [
        { _tag: 'AgentMessage', text: 'Checking the board.', messageId: 'a', answer: false },
        { _tag: 'AgentMessage', text: 'Two tasks ', messageId: 'b', answer: true },
        { _tag: 'AgentMessage', text: 'are running.', messageId: 'b', answer: true },
        { _tag: 'AgentMessage', text: 'Said by Claude Code.', messageId: 'c' },
      ]
      for (const event of events) yield* writer.record(event)
      yield* writer.flush
      const said = (yield* items(where.threadId)).slice(where.before).map((item) => item.content)
      assert.deepStrictEqual(said, [
        { text: 'Checking the board.', answer: false },
        { text: 'Two tasks are running.', answer: true },
        { text: 'Said by Claude Code.' },
      ])
    }).pipe(Effect.provide(runtime())),
  )

  it.live('keeps why a command failed from its own words, as OpenCode says it, where what came back says nothing', () =>
    Effect.gen(function* () {
      const where = yield* place
      const writer = recorder(where)
      yield* writer.record({
        _tag: 'ToolCall',
        toolCallId: 'lint',
        title: 'Lint',
        kind: 'execute',
        status: 'in_progress',
        rawInput: { command: 'npm run lint' },
      })
      yield* writer.record({
        _tag: 'ToolCallUpdate',
        toolCallId: 'lint',
        status: 'failed',
        content: [{ _tag: 'Text', text: 'npm ERR! Missing script: "lint"' }],
        rawOutput: {},
      })
      const tool = (yield* items(where.threadId)).find((item) => item.content.title === 'Lint')
      assert.strictEqual(tool?.content.status, 'failed')
      assert.deepStrictEqual(tool?.content.diagnostic, { text: 'npm ERR! Missing script: "lint"', truncated: false, redacted: false })
    }).pipe(Effect.provide(runtime())),
  )

  it.live('says under a call to a server that was down which server and how, only once it failed', () =>
    Effect.gen(function* () {
      const where = yield* place
      const writer = recorder({ ...where, lead: 'Claude Code', leadId: 'claude-code' })
      const events: ReadonlyArray<SessionEvent> = [
        {
          _tag: 'Notice',
          severity: 'info',
          title: 'MCP server "linear" needs authentication',
          server: { name: 'linear', status: 'needs-auth' },
        },
        { _tag: 'ToolCall', toolCallId: 'c1', title: 'mcp__linear__save_issue', kind: 'other', status: 'in_progress', server: 'linear' },
        // What the agent sends when a call fails is its id and status alone: the server is the one the call was made to.
        { _tag: 'ToolCallUpdate', toolCallId: 'c1', status: 'failed' },
        // Named by its _meta rather than its title, and failed by a status alone.
        { _tag: 'ToolCall', toolCallId: 'c3', title: 'Move DEV-188 to In Review', kind: 'other', status: 'in_progress', server: 'linear' },
        { _tag: 'ToolCallUpdate', toolCallId: 'c3', status: 'failed' },
        // A call to a server that is up says nothing, though it fails.
        { _tag: 'ToolCall', toolCallId: 'c2', title: 'mcp__github__get_pr', kind: 'other', status: 'failed', server: 'github' },
      ]
      for (const event of events) yield* writer.record(event)
      yield* writer.flush
      const calls = (yield* items(where.threadId))
        .slice(where.before)
        .flatMap((item) => (item.kind === 'tool_call' ? [[item.content.title, item.content.server ?? null]] : []))
      assert.deepStrictEqual(calls, [
        ['mcp__linear__save_issue', { name: 'linear', down: 'needs-auth', agentId: 'claude-code' }],
        ['Move DEV-188 to In Review', { name: 'linear', down: 'needs-auth', agentId: 'claude-code' }],
        ['mcp__github__get_pr', null],
      ])
    }).pipe(Effect.provide(runtime())),
  )
})
