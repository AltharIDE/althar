import type { NativeCall, NativeContent, NativeMessage, NativeModel, NativeProvider, NativeReply, NativeRequest } from './agent'

/** Only the runtime supplies authenticated requests. Tokens never enter the agent's environment or tool arguments. */
export type CopilotSend = (
  path: string,
  input: {
    readonly body?: unknown
    readonly signal: AbortSignal
    readonly initiator?: 'user' | 'agent'
    readonly sessionId?: string
    readonly vision?: boolean
    readonly compaction?: boolean
  },
) => Promise<Response>

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const number = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0)
const words = (content: NativeMessage['content']) =>
  typeof content === 'string' ? content : content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n')
const imageURL = (part: Extract<NativeContent, { type: 'image' }>) => `data:${part.mimeType};base64,${part.data}`
const parts = (content: NativeMessage['content']) => (typeof content === 'string' ? [{ type: 'text' as const, text: content }] : content)

const protocolOf = (raw: Record<string, unknown>): NonNullable<NativeModel['protocol']> => {
  const endpoints = array(raw.supported_endpoints)
  if (endpoints.includes('/v1/messages')) return 'messages'
  if (endpoints.includes('/responses')) return 'responses'
  if (endpoints.includes('/chat/completions')) return 'chat'
  const id = text(raw.id)
  const generation = /^gpt-(\d+)/.exec(id)?.[1]
  return (generation !== undefined && Number(generation) >= 5 && !id.startsWith('gpt-5-mini')) ||
    id.startsWith('grok-') ||
    id.startsWith('mai-code-')
    ? 'responses'
    : 'chat'
}

export const copilotModels = (value: unknown): NativeModel[] =>
  array(record(value).data).flatMap((value) => {
    const raw = record(value)
    const capabilities = record(raw.capabilities)
    const supports = record(capabilities.supports)
    const limits = record(capabilities.limits)
    const id = text(raw.id)
    const context = number(limits.max_context_window_tokens) || number(limits.max_prompt_tokens)
    const output = number(limits.max_output_tokens)
    const protocol = protocolOf(raw)
    if (
      !id ||
      supports.tool_calls !== true ||
      context === 0 ||
      output === 0 ||
      raw.model_picker_enabled === false ||
      record(raw.policy).state === 'disabled'
    )
      return []
    return [
      {
        id,
        name: text(raw.name) || id,
        context,
        output,
        images:
          supports.vision === true ||
          array(record(limits.vision).supported_media_types).some((value) => typeof value === 'string' && value.startsWith('image/')),
        protocol,
        efforts:
          protocol === 'messages' && supports.adaptive_thinking !== true
            ? []
            : array(supports.reasoning_effort).filter((value): value is string => typeof value === 'string'),
        ...(protocol === 'messages' && supports.adaptive_thinking === true ? { adaptiveThinking: true as const } : {}),
      },
    ]
  })

export const copilotFailure = async (response: Response): Promise<never> => {
  if (response.status === 401) throw new Error('GitHub Copilot authentication required. Sign in again.')
  if (response.status === 403)
    throw new Error('GitHub Copilot access forbidden. Your organization may need to approve Althar or enable this model.')
  if (response.status === 402 || response.status === 429)
    throw new Error('GitHub Copilot usage limit reached. Check your Copilot plan and try again later.')
  if (response.status >= 500) throw new Error(`GitHub Copilot service unavailable (HTTP ${response.status}). Try again.`)
  let code = ''
  try {
    code = text(record(record(await response.json()).error).code)
  } catch {
    /* Error bodies need not be JSON. */
  }
  if (/context|token_limit|prompt_too_long/.test(code))
    throw new Error('GitHub Copilot context window is full. Compact the conversation or start a new one.')
  throw new Error(`GitHub Copilot rejected this request (HTTP ${response.status}). Check the selected model and account access.`)
}

const chatMessages = (messages: NativeRequest['messages']) =>
  messages.flatMap((message): unknown[] => {
    if (message.role === 'tool') {
      const images = parts(message.content).flatMap((part) =>
        part.type === 'image' ? [{ type: 'image_url', image_url: { url: imageURL(part) } }] : [],
      )
      return [
        { role: 'tool', tool_call_id: message.toolCallId, content: words(message.content) },
        ...(images.length ? [{ role: 'user', content: images }] : []),
      ]
    }
    return [
      {
        role: message.role,
        content:
          typeof message.content === 'string'
            ? message.content
            : message.content.map((part) => (part.type === 'text' ? part : { type: 'image_url', image_url: { url: imageURL(part) } })),
        ...(message.tools?.length
          ? {
              tool_calls: message.tools.map((call) => ({
                id: call.id,
                type: 'function',
                function: { name: call.name, arguments: JSON.stringify(call.input) },
              })),
            }
          : {}),
      },
    ]
  })

const responseMessages = (request: NativeRequest) =>
  request.messages.flatMap((message): unknown[] => {
    if (message.role === 'tool')
      return [
        {
          type: 'function_call_output',
          call_id: message.toolCallId,
          output:
            typeof message.content === 'string'
              ? message.content
              : message.content.map((part) =>
                  part.type === 'text' ? { type: 'input_text', text: part.text } : { type: 'input_image', image_url: imageURL(part) },
                ),
        },
      ]
    if (message.continuation?.model === request.model.id && message.continuation.protocol === 'responses')
      return [...message.continuation.items]
    const content = parts(message.content).filter((part) => part.type !== 'text' || part.text.length > 0)
    return [
      ...(content.length === 0
        ? []
        : [
            {
              role: message.role === 'system' ? 'developer' : message.role,
              content: content.map((part) =>
                part.type === 'image'
                  ? { type: 'input_image', image_url: imageURL(part) }
                  : { type: message.role === 'assistant' ? 'output_text' : 'input_text', text: part.text },
              ),
            },
          ]),
      ...(message.tools ?? []).map((call) => ({
        type: 'function_call',
        call_id: call.id,
        name: call.name,
        arguments: JSON.stringify(call.input),
      })),
    ]
  })

const anthropicMessages = (request: NativeRequest) => {
  const messages: Array<{ role: 'user' | 'assistant'; content: unknown[] }> = []
  const contentOf = (content: NativeMessage['content']) =>
    parts(content)
      .filter((part) => part.type !== 'text' || part.text.length > 0)
      .map((part) =>
        part.type === 'text' ? part : { type: 'image', source: { type: 'base64', media_type: part.mimeType, data: part.data } },
      )
  for (const message of request.messages) {
    if (message.role === 'system') continue
    const role = message.role === 'assistant' ? 'assistant' : 'user'
    const content =
      message.role === 'tool'
        ? [{ type: 'tool_result', tool_use_id: message.toolCallId, content: contentOf(message.content) }]
        : message.continuation?.model === request.model.id && message.continuation.protocol === 'messages'
          ? [...message.continuation.items]
          : [
              ...contentOf(message.content),
              ...(message.tools ?? []).map((call) => ({ type: 'tool_use', id: call.id, name: call.name, input: call.input })),
            ]
    const last = messages.at(-1)
    if (last?.role === role) last.content.push(...content)
    else messages.push({ role, content })
  }
  return messages
}

export const copilotRequest = (request: NativeRequest): { path: string; body: unknown } => {
  const protocol = request.model.protocol ?? 'chat'
  if (protocol === 'responses')
    return {
      path: '/responses',
      body: {
        model: request.model.id,
        input: responseMessages(request),
        stream: true,
        store: false,
        max_output_tokens: request.model.output,
        tools: request.tools.map((tool) => ({
          type: 'function',
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
          strict: false,
        })),
        include: ['reasoning.encrypted_content'],
        ...(request.effort ? { reasoning: { effort: request.effort, summary: 'auto' } } : {}),
      },
    }
  if (protocol === 'messages')
    return {
      path: '/v1/messages',
      body: {
        model: request.model.id,
        system: request.messages
          .filter((message) => message.role === 'system')
          .map((message) => words(message.content))
          .join('\n\n'),
        messages: anthropicMessages(request),
        stream: true,
        max_tokens: request.model.output,
        tools: request.tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema })),
        ...(request.effort && request.model.adaptiveThinking
          ? { thinking: { type: 'adaptive' }, output_config: { effort: request.effort } }
          : {}),
      },
    }
  return {
    path: '/chat/completions',
    body: {
      model: request.model.id,
      messages: chatMessages(request.messages),
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: request.model.output,
      ...(request.tools.length
        ? {
            tools: request.tools.map((tool) => ({
              type: 'function',
              function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
            })),
          }
        : {}),
      ...(request.effort ? { reasoning_effort: request.effort } : {}),
    },
  }
}

/** SSE framing permits arbitrary UTF-8 chunk boundaries, CRLF, comments, and multiple data lines. */
export async function* copilotEvents(response: Response, signal: AbortSignal): AsyncGenerator<unknown> {
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    yield await response.json()
    return
  }
  if (!response.body) throw new Error('GitHub Copilot returned an empty response stream.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  const abort = () => {
    void reader.cancel().catch(() => undefined)
  }
  signal.addEventListener('abort', abort, { once: true })
  try {
    for (;;) {
      signal.throwIfAborted()
      const chunk = await reader.read()
      pending += decoder.decode(chunk.value, { stream: !chunk.done }).replace(/\r/g, '')
      if (pending.length > 4_000_000) throw new Error('GitHub Copilot sent an oversized stream event.')
      let at = pending.indexOf('\n\n')
      while (at >= 0) {
        const event = pending.slice(0, at)
        pending = pending.slice(at + 2)
        const data = event
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n')
        if (data === '[DONE]') return
        if (data !== '') yield JSON.parse(data) as unknown
        at = pending.indexOf('\n\n')
      }
      if (chunk.done) break
    }
  } finally {
    signal.removeEventListener('abort', abort)
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

const inputOf = (value: unknown): Record<string, unknown> => {
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Copilot returned invalid tool arguments.')
  return parsed as Record<string, unknown>
}

export const copilotReply = async (response: Response, request: NativeRequest): Promise<NativeReply> => {
  const protocol = request.model.protocol ?? 'chat'
  const calls = new Map<number, { id: string; name: string; arguments: string }>()
  const blocks = new Map<number, Record<string, unknown>>()
  const json = new Map<number, string>()
  let output: unknown[] = []
  let replyText = ''
  let input = 0
  let tokens = 0
  let ended = false
  let stopped: NativeReply['stopped']
  const say = (value: unknown) => {
    const delta = text(value)
    replyText += delta
    if (delta !== '') request.onText(delta)
  }
  for await (const value of copilotEvents(response, request.signal)) {
    const event = record(value)
    if (event.error || event.type === 'error' || event.type === 'response.failed')
      throw new Error('GitHub Copilot could not finish this response. Try again.')
    if (protocol === 'chat') {
      const usage = record(event.usage)
      input = number(usage.prompt_tokens) || input
      tokens = number(usage.completion_tokens) || tokens
      for (const value of array(event.choices)) {
        const choice = record(value)
        const delta = record(choice.delta ?? choice.message)
        say(delta.content)
        for (const [index, value] of array(delta.tool_calls).entries()) {
          const call = record(value)
          const slot = typeof call.index === 'number' ? call.index : index
          const old = calls.get(slot) ?? { id: '', name: '', arguments: '' }
          const fn = record(call.function)
          calls.set(slot, { id: old.id + text(call.id), name: old.name + text(fn.name), arguments: old.arguments + text(fn.arguments) })
        }
        if (choice.finish_reason) {
          ended = true
          if (choice.finish_reason === 'length') stopped = 'max_tokens'
          if (choice.finish_reason === 'content_filter') stopped = 'refusal'
        }
      }
    } else if (protocol === 'responses') {
      if (event.type === 'response.output_text.delta') say(event.delta)
      if (event.type === 'response.completed' || event.type === 'response.incomplete' || event.object === 'response') {
        const final = record(event.response ?? event)
        output = array(final.output)
        const usage = record(final.usage)
        input = number(usage.input_tokens)
        tokens = number(usage.output_tokens)
        if (replyText === '')
          for (const item of output)
            for (const part of array(record(item).content)) if (record(part).type === 'output_text') say(record(part).text)
        ended = true
        if (final.status === 'incomplete') stopped = 'max_tokens'
      }
    } else {
      if (event.type === 'message_start') input = number(record(record(event.message).usage).input_tokens)
      if (event.type === 'content_block_start') blocks.set(number(event.index), { ...record(event.content_block) })
      if (event.type === 'content_block_delta') {
        const index = number(event.index)
        const delta = record(event.delta)
        const block = blocks.get(index)
        if (!block) throw new Error('Copilot sent a content delta without a content block.')
        if (delta.type === 'text_delta') {
          block.text = text(block.text) + text(delta.text)
          say(delta.text)
        } else if (delta.type === 'input_json_delta') json.set(index, (json.get(index) ?? '') + text(delta.partial_json))
        else if (delta.type === 'thinking_delta') block.thinking = text(block.thinking) + text(delta.thinking)
        else if (delta.type === 'signature_delta') block.signature = text(block.signature) + text(delta.signature)
      }
      if (event.type === 'message_delta') {
        tokens = number(record(event.usage).output_tokens)
        if (record(event.delta).stop_reason === 'max_tokens') stopped = 'max_tokens'
        if (record(event.delta).stop_reason === 'refusal') stopped = 'refusal'
      }
      if (event.type === 'message_stop') ended = true
      if (event.type === 'message') {
        output = array(event.content)
        input = number(record(event.usage).input_tokens)
        tokens = number(record(event.usage).output_tokens)
        for (const part of output) if (record(part).type === 'text') say(record(part).text)
        ended = true
      }
    }
  }
  request.signal.throwIfAborted()
  if (!ended) throw new Error('GitHub Copilot’s stream ended before the response completed. Try again.')
  const tools: NativeCall[] = []
  if (protocol === 'chat')
    for (const call of calls.values()) tools.push({ id: call.id, name: call.name, input: inputOf(call.arguments || '{}') })
  else {
    if (protocol === 'messages' && blocks.size > 0)
      output = [...blocks]
        .toSorted(([a], [b]) => a - b)
        .map(([index, block]) => (block.type === 'tool_use' && json.has(index) ? { ...block, input: inputOf(json.get(index)) } : block))
    for (const value of output) {
      const item = record(value)
      if (item.type === 'function_call' || item.type === 'tool_use')
        tools.push({ id: text(item.call_id ?? item.id), name: text(item.name), input: inputOf(item.arguments ?? item.input) })
    }
  }
  if (tools.some((call) => call.id === '' || call.name === '') || new Set(tools.map((call) => call.id)).size !== tools.length)
    throw new Error('Copilot returned invalid or duplicate tool calls.')
  return {
    text: replyText,
    tools,
    usage: { input, output: tokens },
    ...(stopped ? { stopped } : {}),
    ...(protocol === 'chat' ? {} : { continuation: { model: request.model.id, protocol, items: output } }),
  }
}

export const copilotProvider = (send: CopilotSend): NativeProvider => ({
  models: async (signal) => {
    const response = await send('/models', { signal })
    if (!response.ok) return copilotFailure(response)
    const models = copilotModels(await response.json())
    if (models.length === 0)
      throw new Error('GitHub Copilot offers no coding models for this account and application. Check your plan and enterprise policy.')
    return models
  },
  complete: async (request) => {
    const input = copilotRequest(request)
    const vision = request.messages.some(
      (message) => typeof message.content !== 'string' && message.content.some((part) => part.type === 'image'),
    )
    const response = await send(input.path, {
      body: input.body,
      signal: request.signal,
      initiator: request.initiator,
      sessionId: request.sessionId,
      vision,
      ...(request.purpose === 'compaction' ? { compaction: true } : {}),
    })
    if (!response.ok) return copilotFailure(response)
    return copilotReply(response, request)
  },
})
