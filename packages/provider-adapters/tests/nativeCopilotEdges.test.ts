import { describe, expect, it } from 'vitest'

import type { NativeRequest } from '../src/native/agent'
import { copilotEvents, copilotFailure, copilotModels, copilotProvider, copilotReply, copilotRequest } from '../src/native/copilot'

const request = (protocol: 'chat' | 'responses' | 'messages', extra: Partial<NativeRequest> = {}): NativeRequest => ({
  model: { id: 'model', name: 'Model', context: 128_000, output: 4096, images: true, protocol },
  messages: [{ role: 'user', content: 'Inspect the project.' }],
  tools: [],
  initiator: 'user',
  sessionId: 'protocol-test',
  signal: new AbortController().signal,
  onText: () => undefined,
  ...extra,
})
const model = {
  id: 'model',
  capabilities: { supports: { tool_calls: true }, limits: { max_prompt_tokens: 128_000, max_output_tokens: 4096 } },
}
const events = (...values: unknown[]) =>
  new Response(values.map((value) => `data: ${JSON.stringify(value)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  })
const collect = async (response: Response, signal = new AbortController().signal) => {
  const result: unknown[] = []
  for await (const value of copilotEvents(response, signal)) result.push(value)
  return result
}

describe('Copilot protocol boundaries', () => {
  it.each([
    ['gpt-5', 'responses'],
    ['gpt-5-mini', 'chat'],
    ['gpt-4.1', 'chat'],
    ['grok-code', 'responses'],
    ['mai-code-1', 'responses'],
    ['other', 'chat'],
  ])('uses the documented fallback for %s when no endpoint is advertised', (id, protocol) => {
    expect(copilotModels({ data: [{ ...model, id }] })).toEqual([
      { id, name: id, context: 128_000, output: 4096, images: false, protocol, efforts: [] },
    ])
  })

  it('uses explicit endpoint and vision limits, and only advertises supported thinking efforts', () => {
    expect(
      copilotModels({
        data: [
          { ...model, supported_endpoints: ['/chat/completions'] },
          { ...model, supported_endpoints: ['/responses'] },
          {
            id: 'thinking',
            supported_endpoints: ['/v1/messages'],
            capabilities: {
              supports: { tool_calls: true, adaptive_thinking: true, reasoning_effort: ['high', null, 5] },
              limits: { max_context_window_tokens: 200_000, max_output_tokens: 8192, vision: { supported_media_types: [4, 'image/png'] } },
            },
          },
        ],
      }),
    ).toMatchObject([
      { protocol: 'chat' },
      { protocol: 'responses' },
      { context: 200_000, images: true, efforts: ['high'], adaptiveThinking: true },
    ])
  })

  it.each([null, {}, { data: [null, [], { id: 'missing-capabilities' }] }, { data: [{ ...model, id: '' }] }])(
    'rejects incomplete model listings: %j',
    (value) => expect(copilotModels(value)).toEqual([]),
  )

  it.each([
    { max_prompt_tokens: 0, max_output_tokens: 4096 },
    { max_prompt_tokens: -1, max_output_tokens: 4096 },
    { max_prompt_tokens: Number.POSITIVE_INFINITY, max_output_tokens: 4096 },
    { max_prompt_tokens: 128_000, max_output_tokens: 0 },
  ])('does not advertise unusable context or output limits: %j', (limits) => {
    expect(copilotModels({ data: [{ ...model, capabilities: { ...model.capabilities, limits } }] })).toEqual([])
  })

  it.each([
    [
      'chat',
      { choices: [{ message: { content: 'Finished.' }, finish_reason: 'length' }], usage: { prompt_tokens: 4, completion_tokens: 8 } },
    ],
    [
      'responses',
      {
        object: 'response',
        status: 'incomplete',
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'Finished.' }] }],
        usage: { input_tokens: 4, output_tokens: 8 },
      },
    ],
    ['messages', { type: 'message', content: [{ type: 'text', text: 'Finished.' }], usage: { input_tokens: 4, output_tokens: 8 } }],
  ] as const)('reads a non-streamed %s response and its usage', async (protocol, value) => {
    const reply = await copilotReply(Response.json(value), request(protocol))
    expect(reply).toMatchObject({ text: 'Finished.', tools: [], usage: { input: 4, output: 8 } })
    if (protocol !== 'messages') expect(reply.stopped).toBe('max_tokens')
  })

  it.each(['length', 'content_filter'] as const)('keeps the Chat %s stop reason', async (reason) => {
    expect(await copilotReply(events({ choices: [{ delta: {}, finish_reason: reason }] }), request('chat'))).toMatchObject({
      stopped: reason === 'length' ? 'max_tokens' : 'refusal',
    })
  })

  it.each(['max_tokens', 'refusal'] as const)('keeps the Messages %s stop reason and streams text once', async (reason) => {
    let said = ''
    const reply = await copilotReply(
      events(
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello.' } },
        { type: 'message_delta', delta: { stop_reason: reason } },
        { type: 'message_stop' },
      ),
      request('messages', {
        onText: (text) => {
          said += text
        },
      }),
    )
    expect(reply).toMatchObject({ text: 'Hello.', stopped: reason })
    expect(said).toBe('Hello.')
  })

  it.each([{ input: null }, { input: [] }, { input: 'not an object' }])(
    'refuses invalid tool arguments %j before a caller can execute them',
    async ({ input }) => {
      await expect(
        copilotReply(
          events({
            type: 'response.completed',
            response: { output: [{ type: 'function_call', call_id: 'one', name: 'write_file', arguments: JSON.stringify(input) }] },
          }),
          request('responses'),
        ),
      ).rejects.toThrow('invalid tool arguments')
    },
  )

  it.each([
    { tools: [{ id: '', name: 'write_file' }] },
    { tools: [{ id: 'one', name: '' }] },
    {
      tools: [
        { id: 'one', name: 'write_file' },
        { id: 'one', name: 'read_file' },
      ],
    },
  ])('refuses missing or duplicate tool identities: %j', async ({ tools }) => {
    await expect(
      copilotReply(
        events({
          choices: [
            {
              message: { tool_calls: tools.map(({ id, name }) => ({ id, function: { name, arguments: '{}' } })) },
              finish_reason: 'tool_calls',
            },
          ],
        }),
        request('chat'),
      ),
    ).rejects.toThrow('invalid or duplicate tool calls')
  })

  it.each([{ error: { message: 'private upstream detail' } }, { type: 'error' }, { type: 'response.failed' }])(
    'reports failed streams without leaking upstream details: %j',
    async (value) => {
      await expect(copilotReply(events(value), request('responses'))).rejects.toThrow('could not finish this response')
    },
  )

  it('refuses a Messages delta that has no content block', async () => {
    await expect(
      copilotReply(events({ type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: 'orphan' } }), request('messages')),
    ).rejects.toThrow('without a content block')
  })

  it('reads SSE comments and multiline data, stops at DONE, and leaves later data unread', async () => {
    const response = new Response(': ping\n\ndata: {"answer":\ndata: 42}\n\ndata: [DONE]\n\ndata: invalid\n\n', {
      headers: { 'content-type': 'text/event-stream' },
    })
    expect(await collect(response)).toEqual([{ answer: 42 }])
  })

  it('refuses absent and oversized SSE bodies', async () => {
    await expect(collect(new Response(null, { headers: { 'content-type': 'text/event-stream' } }))).rejects.toThrow('empty response stream')
    await expect(collect(new Response('x'.repeat(4_000_001), { headers: { 'content-type': 'text/event-stream' } }))).rejects.toThrow(
      'oversized stream event',
    )
  })

  it('cancels the reader when its request is already aborted', async () => {
    const controller = new AbortController()
    controller.abort(new Error('Stopped by the person'))
    let cancelled = false
    const response = new Response(
      new ReadableStream({
        cancel: () => {
          cancelled = true
        },
      }),
      {
        headers: { 'content-type': 'text/event-stream' },
      },
    )
    await expect(collect(response, controller.signal)).rejects.toThrow('Stopped by the person')
    expect(cancelled).toBe(true)
  })

  it.each(['context_length_exceeded', 'token_limit', 'prompt_too_long'])('explains %s without exposing the response body', async (code) => {
    await expect(copilotFailure(Response.json({ error: { code, message: 'private detail' } }, { status: 400 }))).rejects.toThrow(
      'context window is full',
    )
  })

  it.each([new Response('private detail', { status: 400 }), Response.json({ error: { code: 'unknown' } }, { status: 422 })])(
    'gives an actionable generic refusal for other HTTP errors',
    async (response) => {
      await expect(copilotFailure(response)).rejects.toThrow(`rejected this request (HTTP ${response.status})`)
    },
  )

  it('passes authentication-owned request metadata, images and compaction through to the sender', async () => {
    const sent: Array<{ path: string; input: unknown }> = []
    const api = copilotProvider(async (path, input) => {
      sent.push({ path, input })
      return path === '/models'
        ? Response.json({ data: [model] })
        : events({ choices: [{ delta: { content: 'Summary.' }, finish_reason: 'stop' }] })
    })
    const signal = new AbortController().signal
    expect(await api.models(signal)).toHaveLength(1)
    expect(
      await api.complete(
        request('chat', {
          purpose: 'compaction',
          initiator: 'agent',
          signal,
          messages: [{ role: 'user', content: [{ type: 'image', mimeType: 'image/png', data: 'aW1hZ2U=' }] }],
        }),
      ),
    ).toMatchObject({ text: 'Summary.' })
    expect(sent).toMatchObject([
      { path: '/models', input: { signal } },
      { path: '/chat/completions', input: { signal, initiator: 'agent', sessionId: 'protocol-test', vision: true, compaction: true } },
    ])
    expect(copilotRequest(request('chat', { effort: 'high' })).body).toMatchObject({ reasoning_effort: 'high' })
  })

  it('refuses an account with no coding models and forwards HTTP failures from both endpoints', async () => {
    await expect(copilotProvider(async () => Response.json({ data: [] })).models(new AbortController().signal)).rejects.toThrow(
      'offers no coding models',
    )
    const api = copilotProvider(async () => new Response(null, { status: 402 }))
    await expect(api.models(new AbortController().signal)).rejects.toThrow('usage limit reached')
    await expect(api.complete(request('chat'))).rejects.toThrow('usage limit reached')
  })
})
