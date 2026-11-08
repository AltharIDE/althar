import type * as acp from '@agentclientprotocol/sdk'
import { assert, describe, it } from '@effect/vitest'

import { pageOf, parentOf, subAgentOf, webCallOf } from '../src/activity'
import { normalize } from '../src/events'

/*
 * What an agent does beyond the repository, as each agent's adapter reports
 * it: the payloads here are the ones claude-agent-acp 0.101, codex-acp 2.5
 * and OpenCode's ACP send.
 */

const claude = (toolName: string, extra: Record<string, unknown> = {}) => ({ claudeCode: { toolName, ...extra } })

describe('webCallOf', () => {
  it('reads Claude Code’s web search and fetch by its tool’s name, once its input has come', () => {
    // Without its input, as its first call and its updates after say it: nothing, so what came with the input stands.
    assert.isUndefined(webCallOf('fetch', undefined, claude('WebSearch')))
    assert.isUndefined(webCallOf('fetch', undefined, claude('WebFetch')))
    assert.deepStrictEqual(webCallOf('fetch', {}, claude('WebSearch')), { action: 'search', query: '' })
    assert.deepStrictEqual(webCallOf('fetch', { query: 'effect schema optional' }, claude('WebSearch')), {
      action: 'search',
      query: 'effect schema optional',
    })
    assert.deepStrictEqual(
      webCallOf('fetch', { url: 'https://effect.website/docs/schema?x=1#a', prompt: 'What is it?' }, claude('WebFetch')),
      {
        action: 'fetch',
        url: 'https://effect.website/docs/schema',
      },
    )
  })

  it('reads Codex’s web search item: a search, a page it opened, a search in one', () => {
    const item = (action: unknown) => ({ type: 'webSearch', id: 'ws_1', query: 'fallback', action })
    assert.deepStrictEqual(webCallOf('search', item({ type: 'search', query: 'acp compaction' })), {
      action: 'search',
      query: 'acp compaction',
    })
    assert.deepStrictEqual(webCallOf('search', item({ type: 'search', queries: ['one', '', 'two'] })), {
      action: 'search',
      query: 'one, two',
    })
    assert.deepStrictEqual(webCallOf('search', item(null)), { action: 'search', query: 'fallback' })
    assert.deepStrictEqual(webCallOf('search', item({ type: 'openPage', url: 'https://github.com/x/y' })), {
      action: 'fetch',
      url: 'https://github.com/x/y',
    })
    assert.deepStrictEqual(webCallOf('search', item({ type: 'findInPage', url: 'https://example.com/', pattern: 'p' })), {
      action: 'fetch',
      url: 'https://example.com',
    })
  })

  it('reads any other agent’s fetch by the address it reads, as OpenCode’s webfetch', () => {
    assert.deepStrictEqual(webCallOf('fetch', { url: 'https://opencode.ai/docs', format: 'markdown' }), {
      action: 'fetch',
      url: 'https://opencode.ai/docs',
    })
  })

  it('is nothing for the repository’s own searches, a fetch of no web address, or no input', () => {
    assert.strictEqual(webCallOf('search', { pattern: 'TODO', path: 'src' }), undefined)
    assert.strictEqual(webCallOf('fetch', { url: 'file:///etc/passwd' }), undefined)
    assert.strictEqual(webCallOf('fetch', undefined), undefined)
    assert.strictEqual(webCallOf('read', { url: 'https://example.com' }), undefined)
  })

  it('keeps a long query to a line', () => {
    const call = webCallOf('fetch', { query: `${'a'.repeat(300)}\nsecond line` }, claude('WebSearch'))
    assert.strictEqual(call?.action === 'search' ? call.query.length : 0, 200)
  })
})

describe('pageOf', () => {
  it('keeps where a page is, without its query or fragment, and nothing that isn’t a web address', () => {
    assert.strictEqual(pageOf('https://example.com/a/b?token=secret#top'), 'https://example.com/a/b')
    assert.strictEqual(pageOf('http://example.com/'), 'http://example.com')
    assert.strictEqual(pageOf('not a url'), undefined)
    assert.strictEqual(pageOf('javascript:alert(1)'), undefined)
  })
})

describe('subAgentOf', () => {
  it('reads Claude Code’s Task and Agent, by what it was asked to do', () => {
    // Without its input, as its updates say it: nothing, so what it was asked stands.
    assert.isUndefined(subAgentOf('Task', undefined, claude('Task')))
    assert.isUndefined(subAgentOf('', undefined, claude('Agent')))
    assert.deepStrictEqual(subAgentOf('Task', {}, claude('Task')), { label: 'Task' })
    assert.deepStrictEqual(
      subAgentOf('Find the readers', { description: 'Find the readers', prompt: 'Look for…', subagent_type: 'Explore' }, claude('Agent')),
      { label: 'Find the readers', type: 'Explore' },
    )
  })

  it('reads OpenCode’s task tool by the kind of sub-agent it starts', () => {
    assert.deepStrictEqual(
      subAgentOf('Explore the adapters', { description: 'Explore the adapters', prompt: 'p', subagent_type: 'general' }),
      {
        label: 'Explore the adapters',
        type: 'general',
      },
    )
  })

  it('reads Codex’s spawnAgent, by the first line of what it was asked, and its model', () => {
    assert.deepStrictEqual(
      subAgentOf('spawnAgent', { prompt: 'Check the tests\nand say what fails', model: 'gpt-5.5', status: 'inProgress' }),
      {
        label: 'Check the tests',
        model: 'gpt-5.5',
      },
    )
    assert.deepStrictEqual(subAgentOf('spawnAgent', undefined), { label: 'Sub-agent' })
  })

  it('is nothing for any other call, and for Codex’s other collab tools', () => {
    assert.strictEqual(subAgentOf('Read file', { path: 'a.ts' }), undefined)
    assert.strictEqual(subAgentOf('wait', { receiverThreadIds: ['t'] }), undefined)
    assert.strictEqual(subAgentOf('Plan', { description: 'no kind' }), undefined)
  })
})

describe('parentOf', () => {
  it('reads the sub-agent’s call a call is made by, where Claude Code stamps it', () => {
    assert.strictEqual(parentOf({ claudeCode: { toolName: 'Read', parentToolUseId: 'toolu_1' } }), 'toolu_1')
    assert.strictEqual(parentOf({ claudeCode: { toolName: 'Read' } }), undefined)
    assert.strictEqual(parentOf(undefined), undefined)
  })
})

describe('normalize', () => {
  it('says a tool call’s web call, sub-agent and parent, on its start and its updates', () => {
    const started = normalize({
      sessionUpdate: 'tool_call',
      toolCallId: 'toolu_2',
      title: 'Search "acp"',
      kind: 'fetch',
      status: 'pending',
      rawInput: { query: 'acp' },
      _meta: claude('WebSearch', { parentToolUseId: 'toolu_1' }),
    })
    assert.deepStrictEqual(started._tag === 'ToolCall' ? [started.web, started.subAgent, started.parent] : [], [
      { action: 'search', query: 'acp' },
      undefined,
      'toolu_1',
    ])
    const updated = normalize({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'toolu_1',
      title: 'Find the readers',
      rawInput: { description: 'Find the readers', prompt: 'p', subagent_type: 'Explore' },
      _meta: claude('Agent'),
    })
    assert.deepStrictEqual(updated._tag === 'ToolCallUpdate' ? [updated.web, updated.subAgent] : [], [
      undefined,
      { label: 'Find the readers', type: 'Explore' },
    ])
  })

  it('says a compaction as it stands, with the summary it kept and why it failed', () => {
    const update = (fields: Record<string, unknown>) =>
      normalize({ sessionUpdate: 'compaction_update', compactionId: 'c1', ...fields } as unknown as acp.SessionUpdate)
    assert.deepStrictEqual(update({ status: 'in_progress' }), { _tag: 'Compaction', compactionId: 'c1', status: 'in_progress' })
    assert.deepStrictEqual(
      update({
        status: 'completed',
        summary: [
          { type: 'text', text: 'We were ' },
          { type: 'image', data: '', mimeType: 'image/png' },
          { type: 'text', text: 'fixing the tests.' },
        ],
      }),
      { _tag: 'Compaction', compactionId: 'c1', status: 'completed', summary: 'We were fixing the tests.' },
    )
    assert.deepStrictEqual(update({ status: 'completed', summary: null }), { _tag: 'Compaction', compactionId: 'c1', status: 'completed' })
    assert.deepStrictEqual(update({ status: 'failed', error: 'Prompt too long' }), {
      _tag: 'Compaction',
      compactionId: 'c1',
      status: 'failed',
      error: 'Prompt too long',
    })
    assert.strictEqual(update({ status: 'paused' })._tag, 'Other')
  })

  it('says a piece of a compaction’s summary as it is written, and passes on one that isn’t words', () => {
    const chunk = (content: unknown) =>
      normalize({ sessionUpdate: 'compaction_summary_chunk', compactionId: 'c1', content } as unknown as acp.SessionUpdate)
    assert.deepStrictEqual(chunk({ type: 'text', text: 'We were' }), { _tag: 'CompactionSummary', compactionId: 'c1', text: 'We were' })
    assert.strictEqual(chunk({ type: 'image', data: 'x', mimeType: 'image/png' })._tag, 'Other')
  })
})
