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
})
