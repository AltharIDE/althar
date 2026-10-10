import type * as acp from '@agentclientprotocol/sdk'
import { assert, describe, it } from '@effect/vitest'

import { handedOf, normalize, normalizeOptions, normalizeUsage, terminalOf } from '../src/events'

describe('normalize', () => {
  it('keeps text, and what a message hands back beside it; sound and a thought’s pictures pass through as they came', () => {
    assert.deepStrictEqual(normalize({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hi' }, messageId: 'm1' }), {
      _tag: 'AgentMessage',
      text: 'Hi',
      messageId: 'm1',
    })
    const image: acp.SessionUpdate = {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'image', data: 'AAAA', mimeType: 'image/png' },
      messageId: 'm2',
    }
    assert.deepStrictEqual(normalize(image), {
      _tag: 'AgentContent',
      content: { _tag: 'Image', data: 'AAAA', mimeType: 'image/png' },
      messageId: 'm2',
    })
    const audio: acp.SessionUpdate = {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'audio', data: 'AAAA', mimeType: 'audio/wav' },
    }
    assert.deepStrictEqual(normalize(audio), { _tag: 'Other', update: 'agent_message_chunk', raw: audio })
    const thoughtImage: acp.SessionUpdate = {
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'image', data: 'AAAA', mimeType: 'image/png' },
    }
    assert.strictEqual(normalize(thoughtImage)._tag, 'Other')
  })

  it('reads a picture, a link and a resource out of a content block', () => {
    assert.deepStrictEqual(handedOf({ type: 'image', data: 'AAAA', mimeType: 'image/png', uri: '/w/shot.png' }), {
      _tag: 'Image',
      data: 'AAAA',
      mimeType: 'image/png',
      uri: '/w/shot.png',
    })
    // Claude Code sends a picture it has only the address of with no bytes.
    assert.deepStrictEqual(handedOf({ type: 'image', data: '', mimeType: '', uri: 'https://example.com/a/shot.png?x=1' }), {
      _tag: 'Link',
      uri: 'https://example.com/a/shot.png?x=1',
      name: 'shot.png',
    })
    assert.isUndefined(handedOf({ type: 'image', data: '', mimeType: 'image/png' }))
    assert.deepStrictEqual(
      handedOf({
        type: 'resource_link',
        uri: 'file:///w/docs/plan.md',
        name: 'plan.md',
        title: 'The plan',
        mimeType: 'text/markdown',
        size: 812,
      }),
      { _tag: 'Link', uri: 'file:///w/docs/plan.md', name: 'plan.md', title: 'The plan', mimeType: 'text/markdown', size: 812 },
    )
    assert.deepStrictEqual(handedOf({ type: 'resource', resource: { uri: 'file:///w/a.md', mimeType: 'text/markdown', text: '# A' } }), {
      _tag: 'Embedded',
      uri: 'file:///w/a.md',
      mimeType: 'text/markdown',
      text: '# A',
    })
    assert.deepStrictEqual(handedOf({ type: 'resource', resource: { uri: 'file:///w/a.png', blob: 'AAAA' } }), {
      _tag: 'Embedded',
      uri: 'file:///w/a.png',
      blob: 'AAAA',
    })
    assert.isUndefined(handedOf({ type: 'text', text: 'words' }))
  })

  it('keeps what a tool call holds: words, pictures, links, the files it writes, and its terminal', () => {
    assert.deepStrictEqual(
      normalize({
        sessionUpdate: 'tool_call_update',
        toolCallId: 't',
        status: 'completed',
        content: [
          { type: 'content', content: { type: 'text', text: 'done' } },
          { type: 'content', content: { type: 'image', data: 'AAAA', mimeType: 'image/png' } },
          { type: 'content', content: { type: 'resource_link', uri: '/w/shot.png', name: '/w/shot.png' } },
          { type: 'content', content: { type: 'audio', data: 'AAAA', mimeType: 'audio/wav' } },
          { type: 'diff', path: '/w/docs/new.md', newText: '# New' },
          { type: 'diff', path: '/w/src/a.ts', oldText: 'a', newText: 'b' },
          { type: 'terminal', terminalId: 't' },
        ],
      }),
      {
        _tag: 'ToolCallUpdate',
        toolCallId: 't',
        status: 'completed',
        content: [
          { _tag: 'Text', text: 'done' },
          { _tag: 'Image', data: 'AAAA', mimeType: 'image/png' },
          { _tag: 'Link', uri: '/w/shot.png', name: '/w/shot.png' },
          { _tag: 'Diff', path: '/w/docs/new.md', created: true },
          { _tag: 'Diff', path: '/w/src/a.ts', created: false },
          { _tag: 'Terminal', terminalId: 't' },
        ],
      },
    )
    assert.deepStrictEqual(
      normalize({
        sessionUpdate: 'tool_call',
        toolCallId: 't',
        title: 'Run',
        kind: 'execute',
        content: [{ type: 'terminal', terminalId: 't' }],
      }),
      {
        _tag: 'ToolCall',
        toolCallId: 't',
        title: 'Run',
        kind: 'execute',
        status: 'pending',
        content: [{ _tag: 'Terminal', terminalId: 't' }],
      },
    )
  })

  it('hears a command’s output and its end in the tool call’s _meta, as Claude Code and Codex send them', () => {
    // Codex: chunks as the command runs.
    assert.deepStrictEqual(
      normalize({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'c',
        _meta: { terminal_output_delta: { terminal_id: 'c', data: ' ✓ a\n' } },
      }),
      { _tag: 'ToolCallUpdate', toolCallId: 'c', terminal: { output: ' ✓ a\n' } },
    )
    // Then its end, with the exit code.
    assert.deepStrictEqual(
      normalize({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'c',
        status: 'failed',
        _meta: { terminal_exit: { terminal_id: 'c', exit_code: 2, signal: null } },
      }),
      { _tag: 'ToolCallUpdate', toolCallId: 'c', status: 'failed', terminal: { exit: { code: 2, signal: null } } },
    )
    // Zed's key, and a signal without a code.
    assert.deepStrictEqual(terminalOf({ terminal_output: { data: 'all' }, terminal_exit: { exit_code: null, signal: 'SIGTERM' } }), {
      output: 'all',
      exit: { code: null, signal: 'SIGTERM' },
    })
    assert.isUndefined(terminalOf({ terminal_output_delta: { data: '' } }))
    assert.isUndefined(terminalOf({ claudeCode: { toolName: 'Bash' } }))
    assert.isUndefined(terminalOf(null))
    assert.isUndefined(terminalOf(['not', 'a', 'record']))
  })

  it('gives a tool call a kind and a status, even when the agent leaves them out', () => {
    assert.deepStrictEqual(normalize({ sessionUpdate: 'tool_call', toolCallId: 't', title: 'Look around' }), {
      _tag: 'ToolCall',
      toolCallId: 't',
      title: 'Look around',
      kind: 'other',
      status: 'pending',
    })
    assert.deepStrictEqual(normalize({ sessionUpdate: 'tool_call_update', toolCallId: 't', status: null, title: null }), {
      _tag: 'ToolCallUpdate',
      toolCallId: 't',
    })
  })

  it('keeps the files a tool call touches', () => {
    assert.deepStrictEqual(
      normalize({
        sessionUpdate: 'tool_call',
        toolCallId: 't',
        title: 'Edit',
        kind: 'edit',
        locations: [
          { path: '/w/a.ts', line: 3 },
          { path: '/w/b.ts', line: null },
        ],
      }),
      {
        _tag: 'ToolCall',
        toolCallId: 't',
        title: 'Edit',
        kind: 'edit',
        status: 'pending',
        locations: [{ path: '/w/a.ts', line: 3 }, { path: '/w/b.ts' }],
      },
    )
    assert.deepStrictEqual(normalize({ sessionUpdate: 'tool_call_update', toolCallId: 't', locations: [{ path: '/w/c.ts' }] }), {
      _tag: 'ToolCallUpdate',
      toolCallId: 't',
      locations: [{ path: '/w/c.ts' }],
    })
    // Claude Code sends the input once it has all of it, in an update.
    assert.deepStrictEqual(normalize({ sessionUpdate: 'tool_call_update', toolCallId: 't', rawInput: { command: 'grep -n x a.css' } }), {
      _tag: 'ToolCallUpdate',
      toolCallId: 't',
      rawInput: { command: 'grep -n x a.css' },
    })
  })

  it('says a mode update came from the agent', () => {
    assert.deepStrictEqual(normalize({ sessionUpdate: 'current_mode_update', currentModeId: 'plan' }), {
      _tag: 'ModeChanged',
      modeId: 'plan',
      byAgent: true,
    })
  })

  it('reports context usage without a cost when there is none', () => {
    assert.deepStrictEqual(normalize({ sessionUpdate: 'usage_update', used: 10, size: 100 }), { _tag: 'ContextUsage', used: 10, size: 100 })
  })

  it('keeps every update it does not model', () => {
    for (const update of [
      { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'me' } },
      { sessionUpdate: 'session_info_update' },
      { sessionUpdate: 'something_new', extra: true },
    ]) {
      assert.strictEqual(normalize(update as acp.SessionUpdate)._tag, 'Other')
    }
    // Ungrouped choices keep their names too.
    assert.deepStrictEqual(
      normalizeOptions([
        {
          id: 'effort',
          name: 'Effort',
          category: 'thought_level',
          type: 'select',
          currentValue: 'high',
          options: [{ value: 'high', name: 'High' }],
        },
      ])[0]?.choices,
      [{ value: 'high', name: 'High' }],
    )
  })
})

describe('normalizeOptions', () => {
  it('flattens grouped values, and keeps booleans', () => {
    const options: Array<acp.SessionConfigOption> = [
      {
        id: 'model',
        name: 'Model',
        category: 'model',
        type: 'select',
        currentValue: 'a',
        options: [
          {
            group: 'g',
            name: 'G',
            options: [
              { value: 'a', name: 'A', description: 'The first' },
              { value: 'b', name: 'B', description: null },
            ],
          },
        ],
      },
      { id: 'fast', name: 'Fast', type: 'boolean', currentValue: false },
    ]
    assert.deepStrictEqual(normalizeOptions(options), [
      {
        id: 'model',
        name: 'Model',
        category: 'model',
        type: 'select',
        currentValue: 'a',
        values: ['a', 'b'],
        choices: [
          { value: 'a', name: 'A', description: 'The first' },
          { value: 'b', name: 'B' },
        ],
      },
      { id: 'fast', name: 'Fast', type: 'boolean', currentValue: false, values: [], choices: [] },
    ])
    assert.deepStrictEqual(normalizeOptions(null), [])
  })
})

describe('normalizeUsage', () => {
  it('keeps what the agent reported', () => {
    assert.isUndefined(normalizeUsage(null))
    assert.deepStrictEqual(normalizeUsage({ inputTokens: 1, outputTokens: 2, totalTokens: 3, thoughtTokens: 4, cachedReadTokens: null }), {
      inputTokens: 1,
      outputTokens: 2,
      totalTokens: 3,
      thoughtTokens: 4,
    })
  })
})
