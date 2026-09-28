import type * as acp from '@agentclientprotocol/sdk'
import { assert, describe, it } from '@effect/vitest'

import { normalize, normalizeOptions, normalizeUsage } from '../src/events'

describe('normalize', () => {
  it('keeps text, and passes other content through as it came', () => {
    assert.deepStrictEqual(normalize({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hi' }, messageId: 'm1' }), {
      _tag: 'AgentMessage',
      text: 'Hi',
      messageId: 'm1',
    })
    const image: acp.SessionUpdate = {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'image', data: 'AAAA', mimeType: 'image/png' },
    }
    assert.deepStrictEqual(normalize(image), { _tag: 'Other', update: 'agent_message_chunk', raw: image })
    const thoughtImage: acp.SessionUpdate = {
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'image', data: 'AAAA', mimeType: 'image/png' },
    }
    assert.strictEqual(normalize(thoughtImage)._tag, 'Other')
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
              { value: 'a', name: 'A' },
              { value: 'b', name: 'B' },
            ],
          },
        ],
      },
      { id: 'fast', name: 'Fast', type: 'boolean', currentValue: false },
    ]
    assert.deepStrictEqual(normalizeOptions(options), [
      { id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'a', values: ['a', 'b'] },
      { id: 'fast', name: 'Fast', type: 'boolean', currentValue: false, values: [] },
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
