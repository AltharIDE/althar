import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { itemOf } from '../src/Queries'
import { Sessions } from '../src/Sessions'
import { recorder } from '../src/threads'
import { items, runtime, task, turns, until } from './support'

/*
 * A call to one of the person's MCP servers, as the thread keeps it and the
 * window reads it (ADR-097): its server and tool, whether it acts on the
 * outside world, what it did, the words it posted, and the link it came back
 * with; a read stays a read.
 */

const place = Effect.gen(function* () {
  const sessions = yield* Sessions
  const { project, task: created } = yield* task()
  const sessionId = yield* sessions.start({ threadId: created.threadId, agentId: 'codex' })
  yield* until(turns(created.threadId), (rows) => rows[0]?.state === 'completed')
  return { projectId: project.projectId as ProjectId, threadId: created.threadId, sessionId, folders: [] }
})

const kept = (threadId: string, toolCallId: string) =>
  Effect.map(items(threadId), (rows) => rows.findLast((row) => row.toolCallId === toolCallId)?.content)

/** The stored item as the window gets it. */
const read = (content: Record<string, unknown> | undefined) =>
  itemOf({
    id: 'i1',
    sequence: 1,
    kind: 'tool_call',
    content: JSON.stringify(content),
    agentId: 'codex',
    inputState: null,
    disposition: null,
    decision: null,
    createdAt: '2026-11-07T10:00:00.000Z',
  })?.content as { readonly mcp?: Record<string, unknown> } | undefined

describe('an MCP call in the thread', () => {
  it.live('keeps what an act did, the words it posted and the link it came back with; a read stays a read', () =>
    Effect.gen(function* () {
      const where = yield* place
      const record = recorder(where)
      const call = { server: 'github', tool: 'add_issue_comment' }
      // Claude Code sends the input only once it has all of it, in an update.
      yield* record.record({
        _tag: 'ToolCall',
        toolCallId: 'post',
        title: 'add_issue_comment',
        kind: 'other',
        status: 'pending',
        mcp: call,
      })
      assert.deepStrictEqual((yield* kept(where.threadId, 'post'))?.['mcp'], {
        server: 'github',
        tool: 'add_issue_comment',
        acts: false,
        did: 'add_issue_comment',
      })
      yield* record.record({
        _tag: 'ToolCallUpdate',
        toolCallId: 'post',
        status: 'completed',
        rawInput: { issue_number: 640, body: `Not needed once #635 merges. ${'More. '.repeat(200)}` },
        rawOutput: { html_url: 'https://github.com/AltharIDE/althar/issues/640#issuecomment-1' },
      })
      const posted = read(yield* kept(where.threadId, 'post'))?.mcp
      assert.strictEqual(posted?.['server'], 'github')
      assert.strictEqual(posted?.['acts'], true)
      assert.strictEqual(posted?.['did'], 'Posted on #640')
      assert.isTrue(String(posted?.['words']).startsWith('Not needed once #635 merges.'))
      assert.strictEqual(String(posted?.['words']).length, 600)
      assert.strictEqual(posted?.['link'], 'https://github.com/AltharIDE/althar/issues/640#issuecomment-1')

      // An update that says nothing of the call keeps what it was.
      yield* record.record({ _tag: 'ToolCallUpdate', toolCallId: 'post', status: 'completed' })
      assert.strictEqual(read(yield* kept(where.threadId, 'post'))?.mcp?.['did'], 'Posted on #640')

      yield* record.record({
        _tag: 'ToolCall',
        toolCallId: 'look',
        title: 'get_pull_request',
        kind: 'other',
        status: 'completed',
        mcp: { server: 'github', tool: 'get_pull_request' },
        rawInput: { pull_number: 635 },
        rawOutput: 'nothing to link',
      })
      const looked = read(yield* kept(where.threadId, 'look'))?.mcp
      assert.strictEqual(looked?.['acts'], false)
      assert.isUndefined(looked?.['words'])
      assert.isUndefined(looked?.['link'])
    }).pipe(Effect.provide(runtime())),
  )

  it('reads a kept call without its server or tool as no MCP call, and a link that isn’t https as none', () => {
    assert.isUndefined(read({ title: 'x', mcp: { server: '', tool: 'merge' } })?.mcp)
    assert.deepStrictEqual(read({ title: 'x', mcp: { server: 'gh', tool: 'merge_pull_request', link: 'javascript:alert(1)' } })?.mcp, {
      server: 'gh',
      tool: 'merge_pull_request',
      acts: false,
      did: 'merge_pull_request',
    })
  })
})
