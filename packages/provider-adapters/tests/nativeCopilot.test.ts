import { describe, expect, it } from '@effect/vitest'

import type { NativeRequest } from '../src/native/agent'
import {
  copilotEvents,
  copilotFailure,
  copilotModels,
  copilotProvider,
  copilotReply,
  copilotRequest,
  type CopilotSend,
} from '../src/native/copilot'

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

  it('returns all Chat tool receipts before forwarding their images as user content', () => {
    const encoded = copilotRequest(
      request('chat', {
        messages: [
          {
            role: 'assistant',
            content: '',
            tools: [
              { id: 'picture', name: 'take_picture', input: {} },
              { id: 'read', name: 'read_file', input: { path: 'README.md' } },
            ],
          },
          {
            role: 'tool',
            toolCallId: 'picture',
            content: [
              { type: 'text', text: 'Picture taken.' },
              { type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' },
            ],
          },
          { role: 'tool', toolCallId: 'read', content: 'Actual README.' },
        ],
      }),
    )
    expect(encoded.body).toMatchObject({
      messages: [
        { role: 'assistant' },
        { role: 'tool', tool_call_id: 'picture', content: 'Picture taken.' },
        { role: 'tool', tool_call_id: 'read', content: 'Actual README.' },
        { role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,aW1hZ2U=' } }] },
      ],
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

  it('infers each model’s protocol, context, images and efforts from what Copilot lists', () => {
    const supports = { tool_calls: true }
    const limits = { max_context_window_tokens: 200_000, max_prompt_tokens: 100, max_output_tokens: 8192 }
    const model = (id: string, extra: Record<string, unknown> = {}) => ({ id, capabilities: { supports, limits }, ...extra })
    const listed = copilotModels({
      data: [
        model('listed-responses', { supported_endpoints: ['/responses'] }),
        model('listed-chat', { supported_endpoints: ['/chat/completions'] }),
        model('gpt-5.1'),
        model('gpt-5-mini'),
        model('gpt-4o'),
        model('grok-code'),
        model('mai-code-1'),
        model('claude-thinking', {
          supported_endpoints: ['/v1/messages'],
          capabilities: {
            supports: { ...supports, adaptive_thinking: true, reasoning_effort: ['low', 7, 'high'] },
            limits: { ...limits, vision: { supported_media_types: ['application/pdf', 'image/png'] } },
          },
        }),
      ],
    })
    expect(listed.map((model) => [model.id, model.protocol])).toEqual([
      ['listed-responses', 'responses'],
      ['listed-chat', 'chat'],
      ['gpt-5.1', 'responses'],
      ['gpt-5-mini', 'chat'],
      ['gpt-4o', 'chat'],
      ['grok-code', 'responses'],
      ['mai-code-1', 'responses'],
      ['claude-thinking', 'messages'],
    ])
    expect(listed[0]).toMatchObject({ name: 'listed-responses', context: 200_000, output: 8192, images: false })
    expect(listed.at(-1)).toMatchObject({ images: true, efforts: ['low', 'high'], adaptiveThinking: true })
  })

  it.each([
    [402, 'usage limit'],
    [400, 'rejected this request (HTTP 400)'],
  ])('says what HTTP %s means', async (status, message) => {
    await expect(copilotFailure(new Response('not json', { status }))).rejects.toThrow(message)
  })

  it('says the context window is full when Copilot reports it', async () => {
    await expect(
      copilotFailure(Response.json({ error: { code: 'model_max_prompt_tokens_exceeded_context' } }, { status: 400 })),
    ).rejects.toThrow('context window is full')
  })

  it('encodes images, assistant words and efforts for every protocol', () => {
    const image = { type: 'image' as const, data: 'aW1hZ2U=', mimeType: 'image/png' }
    const messages: NativeRequest['messages'] = [
      { role: 'system', content: 'You are Althar.' },
      { role: 'user', content: [{ type: 'text', text: 'Look.' }, image] },
      { role: 'assistant', content: 'Taking a picture.', tools: [{ id: 'picture', name: 'take_picture', input: {} }] },
      { role: 'tool', toolCallId: 'picture', content: [{ type: 'text', text: 'Taken.' }, image] },
      { role: 'user', content: 'And now?' },
    ]
    expect(copilotRequest(request('responses', { messages, effort: 'low' })).body).toMatchObject({
      reasoning: { effort: 'low', summary: 'auto' },
      input: [
        { role: 'developer', content: [{ type: 'input_text', text: 'You are Althar.' }] },
        {
          role: 'user',
          content: [
            { type: 'input_text', text: 'Look.' },
            { type: 'input_image', image_url: 'data:image/png;base64,aW1hZ2U=' },
          ],
        },
        { role: 'assistant', content: [{ type: 'output_text', text: 'Taking a picture.' }] },
        { type: 'function_call', call_id: 'picture', name: 'take_picture', arguments: '{}' },
        {
          type: 'function_call_output',
          call_id: 'picture',
          output: [
            { type: 'input_text', text: 'Taken.' },
            { type: 'input_image', image_url: 'data:image/png;base64,aW1hZ2U=' },
          ],
        },
        { role: 'user', content: [{ type: 'input_text', text: 'And now?' }] },
      ],
    })
    const anthropic = copilotRequest(request('messages', { messages, effort: 'low' })).body
    expect(anthropic).toMatchObject({
      system: 'You are Althar.',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Look.' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png' } },
          ],
        },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Taking a picture.' },
            { type: 'tool_use', id: 'picture' },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'picture' },
            { type: 'text', text: 'And now?' },
          ],
        },
      ],
    })
    expect(anthropic).not.toHaveProperty('thinking')
    const chat = copilotRequest(request('chat', { messages, effort: 'low', tools: [] })).body
    expect(chat).toMatchObject({
      reasoning_effort: 'low',
      messages: [
        { role: 'system' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Look.' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,aW1hZ2U=' } },
          ],
        },
        { role: 'assistant', tool_calls: [{ id: 'picture', type: 'function' }] },
        { role: 'tool', tool_call_id: 'picture', content: 'Taken.' },
        { role: 'user', content: [{ type: 'image_url' }] },
        { role: 'user', content: 'And now?' },
      ],
    })
    expect(chat).not.toHaveProperty('tools')
  })

  it('reads a whole JSON answer as one event, stops at [DONE], and refuses a stream with no body', async () => {
    const signal = new AbortController().signal
    const all = async (response: Response) => {
      const events: unknown[] = []
      for await (const event of copilotEvents(response, signal)) events.push(event)
      return events
    }
    expect(await all(Response.json({ whole: true }))).toEqual([{ whole: true }])
    const done = new Response(': comment\n\ndata: {"a":1}\n\ndata: [DONE]\n\ndata: {"b":2}\n\n', {
      headers: { 'content-type': 'text/event-stream' },
    })
    expect(await all(done)).toEqual([{ a: 1 }])
    await expect(all(new Response(null, { headers: { 'content-type': 'text/event-stream' } }))).rejects.toThrow('empty response stream')
  })

  it.each([
    ['length', 'max_tokens'],
    ['content_filter', 'refusal'],
  ] as const)('says a Chat answer that finished with %s stopped early', async (finish, stopped) => {
    const reply = await copilotReply(
      Response.json({ choices: [{ message: { content: 'Partial' }, finish_reason: finish }] }),
      request('chat'),
    )
    expect(reply).toMatchObject({ text: 'Partial', tools: [], stopped })
  })

  it('takes a whole Responses answer, its words from its output, and says when it was cut short', async () => {
    let said = ''
    const reply = await copilotReply(
      Response.json({
        object: 'response',
        status: 'incomplete',
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'From the output.' }, { type: 'refusal' }] }],
        usage: { input_tokens: 3, output_tokens: 4 },
      }),
      request('responses', {
        onText: (text) => {
          said += text
        },
      }),
    )
    expect(said).toBe('From the output.')
    expect(reply).toMatchObject({ text: 'From the output.', stopped: 'max_tokens', usage: { input: 3, output: 4 } })
    expect(reply.continuation).toMatchObject({ protocol: 'responses' })
  })

  it('takes streamed Responses words as they come', async () => {
    const reply = await copilotReply(
      stream(
        { type: 'response.output_text.delta', delta: 'Streamed.' },
        {
          type: 'response.incomplete',
          response: { status: 'incomplete', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Twice' }] }] },
        },
      ),
      request('responses'),
    )
    expect(reply).toMatchObject({ text: 'Streamed.', stopped: 'max_tokens' })
  })

  it.each([
    ['an error event', 'chat', [{ error: { message: 'secret' } }], 'could not finish'],
    ['a failed response', 'responses', [{ type: 'response.failed' }], 'could not finish'],
    [
      'a delta without its block',
      'messages',
      [{ type: 'content_block_delta', index: 3, delta: { type: 'text_delta', text: 'x' } }],
      'without a content block',
    ],
    [
      'duplicate tool calls',
      'responses',
      [
        {
          type: 'response.completed',
          response: {
            output: [
              { type: 'function_call', call_id: 'same', name: 'read_file', arguments: '{}' },
              { type: 'function_call', call_id: 'same', name: 'read_file', arguments: '{}' },
            ],
          },
        },
      ],
      'invalid or duplicate',
    ],
    [
      'tool arguments that are not an object',
      'chat',
      [
        {
          choices: [
            { delta: { tool_calls: [{ id: 'c', function: { name: 'read_file', arguments: '[1]' } }] }, finish_reason: 'tool_calls' },
          ],
        },
      ],
      'invalid tool arguments',
    ],
  ] as const)('refuses %s', async (_, protocol, events, message) => {
    await expect(copilotReply(stream(...events), request(protocol))).rejects.toThrow(message)
  })

  it.each([
    ['max_tokens', 'max_tokens'],
    ['refusal', 'refusal'],
  ] as const)('says an Anthropic answer that stopped for %s stopped early, and keeps its words', async (reason, stopped) => {
    const reply = await copilotReply(
      stream(
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Partial' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'unknown_delta' } },
        { type: 'message_delta', delta: { stop_reason: reason }, usage: { output_tokens: 2 } },
        { type: 'message_stop' },
      ),
      request('messages'),
    )
    expect(reply).toMatchObject({ text: 'Partial', stopped, tools: [], continuation: { items: [{ type: 'text', text: 'Partial' }] } })
  })

  it('takes a whole Anthropic message, with its words and tool calls', async () => {
    const reply = await copilotReply(
      Response.json({
        type: 'message',
        content: [
          { type: 'text', text: 'Reading.' },
          { type: 'tool_use', id: 'call-1', name: 'read_file', input: { path: 'README.md' } },
        ],
        usage: { input_tokens: 5, output_tokens: 6 },
      }),
      request('messages'),
    )
    expect(reply).toMatchObject({
      text: 'Reading.',
      tools: [{ id: 'call-1', name: 'read_file', input: { path: 'README.md' } }],
      usage: { input: 5, output: 6 },
    })
  })

  it('asks Copilot through the runtime’s sender, saying when images or a compaction go with it', async () => {
    const sent: Array<[string, Parameters<CopilotSend>[1]]> = []
    const answers: Response[] = [
      new Response('', { status: 401 }),
      Response.json({ data: [] }),
      Response.json({
        data: [
          { id: 'gpt-4o', capabilities: { supports: { tool_calls: true }, limits: { max_prompt_tokens: 1000, max_output_tokens: 100 } } },
        ],
      }),
      Response.json({ choices: [{ message: { content: 'Summary.' }, finish_reason: 'stop' }] }),
      new Response('', { status: 403 }),
    ]
    const provider = copilotProvider(async (path, input) => {
      sent.push([path, input])
      const answer = answers.shift()
      if (!answer) throw new Error('No answer left')
      return answer
    })
    const signal = new AbortController().signal
    await expect(provider.models(signal)).rejects.toThrow('authentication required')
    await expect(provider.models(signal)).rejects.toThrow('no coding models')
    expect(await provider.models(signal)).toMatchObject([{ id: 'gpt-4o', protocol: 'chat' }])
    const image = { type: 'image' as const, data: 'aW1hZ2U=', mimeType: 'image/png' }
    const ask = request('chat', { purpose: 'compaction', messages: [{ role: 'user', content: [{ type: 'text', text: 'Look.' }, image] }] })
    expect(await provider.complete(ask)).toMatchObject({ text: 'Summary.' })
    await expect(provider.complete(request('chat'))).rejects.toThrow('access forbidden')
    expect(sent.map(([path]) => path)).toEqual(['/models', '/models', '/models', '/chat/completions', '/chat/completions'])
    expect(sent[3]?.[1]).toMatchObject({ vision: true, compaction: true, initiator: 'user', sessionId: 'native-test' })
    expect(sent[4]?.[1]).toMatchObject({ vision: false })
    expect(sent[4]?.[1]).not.toHaveProperty('compaction')
  })
})
