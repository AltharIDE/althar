import { describe, expect, it } from '@effect/vitest'

import type { NativeRequest } from '../src/native/agent'
import { copilotFailure, copilotModels, copilotReply, copilotRequest } from '../src/native/copilot'

const request = (protocol: 'chat' | 'responses' | 'messages', extra: Partial<NativeRequest> = {}): NativeRequest => ({
  model: { id: 'test-model', name: 'Test', context: 128_000, output: 4096, images: true, protocol },
  messages: [
    { role: 'system', content: 'You are Althar.' },
    { role: 'user', content: 'Help me.' },
  ],
  tools: [
    {
      name: 'read_file',
      description: 'Read a file',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    },
  ],
  initiator: 'user',
  sessionId: 'native-test',
  signal: new AbortController().signal,
  onText: () => undefined,
  ...extra,
})
const stream = (...events: unknown[]) => {
  const bytes = new TextEncoder().encode(events.map((event) => `data: ${JSON.stringify(event)}\r\n\r\n`).join(''))
  return new Response(
    new ReadableStream({
      start(controller) {
        // Deliberately split framing, JSON and Unicode into small byte chunks.
        for (let at = 0; at < bytes.length; at += 7) controller.enqueue(bytes.slice(at, at + 7))
        controller.close()
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  )
}

describe('Althar’s direct Copilot model connection', () => {
  it('advertises only valid, enabled coding models and uses their advertised protocol', () => {
    const model = {
      id: 'test',
      name: 'Test',
      model_picker_enabled: true,
      supported_endpoints: ['/v1/messages'],
      capabilities: { supports: { tool_calls: true, vision: true }, limits: { max_prompt_tokens: 128_000, max_output_tokens: 4096 } },
    }
    expect(
      copilotModels({
        data: [
          model,
          { ...model, id: 'off', policy: { state: 'disabled' } },
          { ...model, id: 'hidden', model_picker_enabled: false },
          { id: 'broken' },
        ],
      }),
    ).toEqual([{ id: 'test', name: 'Test', context: 128_000, output: 4096, images: true, protocol: 'messages', efforts: [] }])
  })

  it('streams Chat Completions and reconstructs tool arguments across arbitrary chunks', async () => {
    let text = ''
    const reply = await copilotReply(
      stream(
        { choices: [{ delta: { content: 'Olá ' } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'read_file', arguments: '{"pa' } }] } }] },
        {
          choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"README.md"}' } }] }, finish_reason: 'tool_calls' }],
          usage: { prompt_tokens: 42, completion_tokens: 7 },
        },
      ),
      request('chat', {
        onText: (chunk) => {
          text += chunk
        },
      }),
    )
    expect(text).toBe('Olá ')
    expect(reply).toMatchObject({
      tools: [{ id: 'call-1', name: 'read_file', input: { path: 'README.md' } }],
      usage: { input: 42, output: 7 },
    })
    expect(copilotRequest(request('chat')).path).toBe('/chat/completions')
  })

  it('preserves Responses reasoning and tool calls across the next model request', async () => {
    const output = [
      { type: 'reasoning', id: 'reason-1', encrypted_content: 'opaque-test-state' },
      { type: 'function_call', call_id: 'call-1', name: 'read_file', arguments: '{"path":"README.md"}' },
    ]
    const reply = await copilotReply(
      stream({ type: 'response.completed', response: { output, usage: { input_tokens: 20, output_tokens: 10 } } }),
      request('responses'),
    )
    const next = copilotRequest(
      request('responses', {
        messages: [
          {
            role: 'assistant',
            content: reply.text,
            tools: reply.tools,
            ...(reply.continuation ? { continuation: reply.continuation } : {}),
          },
          { role: 'tool', toolCallId: 'call-1', content: 'The actual README.' },
        ],
      }),
    )
    expect(next.path).toBe('/responses')
    expect(next.body).toMatchObject({
      include: ['reasoning.encrypted_content'],
      input: [...output, { type: 'function_call_output', call_id: 'call-1', output: 'The actual README.' }],
    })
  })

  it('preserves signed Anthropic thinking while returning actual tool results', async () => {
    const reply = await copilotReply(
      stream(
        { type: 'message_start', message: { usage: { input_tokens: 12 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'I should inspect the file.' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'signed-test-state' } },
        { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'call-1', name: 'read_file', input: {} } },
        { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"path":"README.md"}' } },
        { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 9 } },
        { type: 'message_stop' },
      ),
      request('messages'),
    )
    expect(reply.tools).toEqual([{ id: 'call-1', name: 'read_file', input: { path: 'README.md' } }])
    expect(reply.continuation?.items[0]).toMatchObject({ type: 'thinking', signature: 'signed-test-state' })
    const next = copilotRequest(
      request('messages', {
        messages: [
          { role: 'assistant', content: '', tools: reply.tools, ...(reply.continuation ? { continuation: reply.continuation } : {}) },
          { role: 'tool', toolCallId: 'call-1', content: 'Read succeeded.' },
        ],
      }),
    )
    expect(next.path).toBe('/v1/messages')
    expect(next.body).toMatchObject({
      messages: [
        { role: 'assistant', content: reply.continuation?.items },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-1', content: [{ type: 'text', text: 'Read succeeded.' }] }] },
      ],
    })
  })

  it('refuses an interrupted response instead of executing an incomplete tool call', async () => {
    await expect(
      copilotReply(
        stream({
          choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'write_file', arguments: '{"path":' } }] } }],
        }),
        request('chat'),
      ),
    ).rejects.toThrow('before the response completed')
  })

  it.each(['responses', 'messages'] as const)('switches to %s without empty assistant blocks or another model’s reasoning', (protocol) => {
    const encoded = copilotRequest(
      request(protocol, {
        model: { ...request(protocol).model, adaptiveThinking: true },
        effort: 'high',
        messages: [
          { role: 'user', content: 'Read the file.' },
          {
            role: 'assistant',
            content: '',
            tools: [{ id: 'call-1', name: 'read_file', input: { path: 'README.md' } }],
            continuation: { model: 'other-model', protocol, items: [{ type: 'thinking', signature: 'other-model-signature' }] },
          },
          { role: 'tool', toolCallId: 'call-1', content: 'Read succeeded.' },
        ],
      }),
    )
    const serialized = JSON.stringify(encoded.body)
    expect(serialized).not.toContain('other-model-signature')
    expect(serialized).not.toContain('"text":""')
    expect(serialized).toContain('Read succeeded.')
    if (protocol === 'messages') expect(encoded.body).toMatchObject({ thinking: { type: 'adaptive' }, output_config: { effort: 'high' } })
  })

  it.each([401, 403, 429, 503])('reports HTTP %s without echoing an untrusted response body', async (status) => {
    await expect(copilotFailure(new Response('do-not-echo-this-token', { status }))).rejects.not.toThrow('do-not-echo-this-token')
  })
})
