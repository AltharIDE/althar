import { describe, expect, it } from '@effect/vitest'
import { Deferred, Duration, Effect, Exit, Fiber, Layer } from 'effect'
import { TestClock } from 'effect/testing'

import { Copilot, copilotApi } from '../src/Copilot'
import { Secrets } from '../src/Secrets'
import { onTestClock } from './support'

const models = {
  data: [
    {
      id: 'model',
      name: 'Model',
      model_picker_enabled: true,
      supported_endpoints: ['/chat/completions'],
      capabilities: { supports: { tool_calls: true }, limits: { max_prompt_tokens: 128_000, max_output_tokens: 4096 } },
    },
  ],
}
const fixture = (
  options: {
    host?: string
    user?: unknown
    denied?: boolean
    configured?: boolean
    challenge?: Record<string, unknown>
    modelList?: unknown
    failure?: 'start' | 'poll' | 'account' | 'account-json' | 'models' | 'poll-timeout' | 'account-timeout' | 'model-timeout'
  } = {},
) => {
  const host = options.host ?? 'github.com'
  const kept = new Map<string, string>()
  const calls: Array<{ url: string; body: string; authorization: string | null }> = []
  const fetcher = async (url: string, input?: RequestInit) => {
    calls.push({
      url,
      body: typeof input?.body === 'string' ? input.body : '',
      authorization: new Headers(input?.headers).get('authorization'),
    })
    if (options.failure === 'start' && url.endsWith('/login/device/code')) throw new Error('Internal network details')
    if (options.failure === 'poll' && url.endsWith('/login/oauth/access_token')) return Response.json({ error: 'expired_token' })
    if (options.failure === 'account' && url.endsWith('/copilot_internal/user')) return Response.json({}, { status: 403 })
    if (options.failure === 'account-json' && url.endsWith('/copilot_internal/user')) return new Response('unreadable account')
    if (options.failure === 'models' && url.endsWith('/models')) throw new Error('Internal network details')
    if (
      (options.failure === 'poll-timeout' && url.endsWith('/login/oauth/access_token')) ||
      (options.failure === 'account-timeout' && url.endsWith('/copilot_internal/user'))
    )
      return new Promise<Response>((_resolve, reject) => {
        input?.signal?.addEventListener('abort', () => reject(new Error('Request aborted')), { once: true })
      })
    if (options.failure === 'model-timeout' && url.endsWith('/models'))
      return new Response(
        new ReadableStream({
          start(controller) {
            input?.signal?.addEventListener('abort', () => controller.error(new Error('Response aborted')), { once: true })
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      )
    if (url.endsWith('/login/device/code'))
      return Response.json({
        device_code: 'test-device',
        user_code: 'ABCD-1234',
        verification_uri: `https://${host}/login/device`,
        expires_in: 900,
        interval: 1,
        ...options.challenge,
      })
    if (url.endsWith('/login/oauth/access_token'))
      return Response.json(options.denied ? { error: 'access_denied' } : { access_token: 'test-access-token', scope: 'read:user' })
    if (url.endsWith('/copilot_internal/user')) return Response.json(options.user ?? { chat_enabled: true })
    if (url.endsWith('/models')) return Response.json(options.modelList ?? models)
    throw new Error(`Unexpected test request: ${url}`)
  }
  const layer = Copilot.layer({
    ...(options.configured === false ? {} : { clientId: 'althar-public-id' }),
    enterpriseClientIds: { 'company.ghe.com': 'althar-enterprise-id' },
    fetch: fetcher,
  }).pipe(Layer.provideMerge(Secrets.memory(kept)))
  return { kept, calls, layer }
}

const login = (copilot: typeof Copilot.Service, host?: string, advance = 1) =>
  Effect.gen(function* () {
    const shown = yield* Deferred.make<void>()
    const fiber = yield* Effect.forkChild(
      copilot.signIn('account-a', host, () => {
        Effect.runSync(Deferred.succeed(shown, undefined))
      }),
    )
    yield* Deferred.await(shown)
    yield* TestClock.adjust(Duration.seconds(advance))
    yield* Fiber.join(fiber)
  })

describe('Althar’s Copilot account', () => {
  it.effect('uses Althar’s own identity, validates access, and keeps credentials separate by account', () => {
    const { layer, calls, kept } = fixture()
    return Effect.gen(function* () {
      const copilot = yield* Copilot
      yield* login(copilot)
      expect(calls[0]?.body).toContain('client_id=althar-public-id')
      expect(calls[0]?.body).toContain('scope=read%3Auser')
      expect(
        calls.some(
          (call) => call.url === 'https://api.github.com/copilot_internal/user' && call.authorization === 'Bearer test-access-token',
        ),
      ).toBe(true)
      expect(calls.some((call) => call.url === 'https://api.githubcopilot.com/models')).toBe(true)
      expect(kept.size).toBe(1)
      expect(yield* copilot.status('account-a')).toEqual({ status: 'signed_in', paidBy: 'plan' })
      expect(yield* copilot.status('account-b')).toEqual({ status: 'signed_out', paidBy: 'plan' })
      yield* copilot.forget('account-a')
      expect(kept.size).toBe(0)
    }).pipe(Effect.provide(layer), onTestClock)
  })

  it.effect('keeps enterprise authorization and requests on the selected host', () => {
    const { layer, calls, kept } = fixture({
      host: 'company.ghe.com',
      user: { chat_enabled: true, endpoints: { api: 'https://copilot-api.company.ghe.com' } },
    })
    return Effect.gen(function* () {
      yield* login(yield* Copilot, 'company.ghe.com')
      expect(calls[0]?.url).toBe('https://company.ghe.com/login/device/code')
      expect(calls[0]?.body).toContain('client_id=althar-enterprise-id')
      expect(calls.some((call) => call.url === 'https://api.company.ghe.com/copilot_internal/user')).toBe(true)
      expect(calls.some((call) => call.url === 'https://copilot-api.company.ghe.com/models')).toBe(true)
      expect(calls.some((call) => ['api.github.com', 'api.githubcopilot.com'].includes(new URL(call.url).hostname))).toBe(false)
      expect(kept.size).toBe(1)
    }).pipe(Effect.provide(layer), onTestClock)
  })

  it.effect.each([
    { chat_enabled: false },
    { chat_enabled: true, endpoints: { api: 'https://steal.example' } },
    { chat_enabled: true, endpoints: { api: 'https://api.githubcopilot.com@steal.example' } },
  ])('does not keep or send credentials when Copilot access or the returned endpoint is invalid (%j)', (user) => {
    const { layer, kept, calls } = fixture({ user })
    return Effect.gen(function* () {
      const outcome = yield* Effect.exit(login(yield* Copilot))
      expect(Exit.isFailure(outcome)).toBe(true)
      expect(kept.size).toBe(0)
      expect(calls.some((call) => new URL(call.url).hostname === 'steal.example')).toBe(false)
    }).pipe(Effect.provide(layer), onTestClock)
  })

  it.effect('cancels polling without keeping a late sign-in', () => {
    const { layer, kept, calls } = fixture()
    return Effect.gen(function* () {
      const shown = yield* Deferred.make<void>()
      const copilot = yield* Copilot
      const fiber = yield* Effect.forkChild(
        copilot.signIn('account-a', undefined, () => {
          Effect.runSync(Deferred.succeed(shown, undefined))
        }),
      )
      yield* Deferred.await(shown)
      yield* Fiber.interrupt(fiber)
      yield* TestClock.adjust(Duration.seconds(5))
      expect(kept.size).toBe(0)
      expect(calls.some((call) => call.url.endsWith('/login/oauth/access_token'))).toBe(false)
    }).pipe(Effect.provide(layer), onTestClock)
  })

  it.effect('requires Althar’s application ID before contacting GitHub', () => {
    const { layer, calls } = fixture({ configured: false })
    return Effect.gen(function* () {
      const outcome = yield* Effect.exit((yield* Copilot).signIn('account-a', undefined, () => undefined))
      expect(Exit.isFailure(outcome)).toBe(true)
      expect(calls).toEqual([])
    }).pipe(Effect.provide(layer))
  })

  it.effect('refuses an invalid enterprise host before sending an authorization request', () => {
    const { layer, calls } = fixture()
    return Effect.gen(function* () {
      const error = yield* Effect.flip((yield* Copilot).signIn('account-a', 'http://wrong.example', () => undefined))
      expect(error).toMatchObject({ _tag: 'CopilotFailed', message: expect.stringContaining('hostname or HTTPS') })
      expect(calls).toEqual([])
    }).pipe(Effect.provide(layer))
  })

  it.effect.each([
    ['poll-timeout', 901, 'code expired'],
    ['account-timeout', 46, 'did not answer in time'],
    ['model-timeout', 46, 'did not confirm model access in time'],
  ] as const)('ends a stalled %s request with guidance and preserves the previous account', ([failure, advance, message]) => {
    const { layer, kept } = fixture({ failure })
    kept.set('copilot-account-a', 'previously-sealed-account')
    return Effect.gen(function* () {
      const error = yield* Effect.flip(login(yield* Copilot, undefined, advance))
      expect(error).toMatchObject({ _tag: 'CopilotFailed', message: expect.stringContaining(message) })
      expect(kept.get('copilot-account-a')).toBe('previously-sealed-account')
    }).pipe(Effect.provide(layer), onTestClock)
  })

  it.effect.each([
    { verification_uri: 'not a URL' },
    { verification_uri: 'https://unrecognized.example/login/device' },
    { verification_uri: 'https://github.com/login/device?unexpected=true' },
    { verification_uri: 'https://github.com/login/device#unexpected' },
    { user_code: '' },
    { interval: 0 },
    { interval: 301 },
  ])('rejects an invalid device challenge before opening a page or polling (%j)', (challenge) => {
    const { layer, calls, kept } = fixture({ challenge })
    return Effect.gen(function* () {
      let shown = false
      const result = yield* Effect.exit(
        (yield* Copilot).signIn('account-a', undefined, () => {
          shown = true
        }),
      )
      expect(Exit.isFailure(result)).toBe(true)
      expect(shown).toBe(false)
      expect(calls).toHaveLength(1)
      expect(kept.size).toBe(0)
    }).pipe(Effect.provide(layer))
  })

  it.effect.each([{ denied: true }, { modelList: { data: [] } }])(
    'preserves the previous credential after denied authorization or unavailable models (%j)',
    (options) => {
      const { layer, kept } = fixture(options)
      kept.set('copilot-account-a', 'previously-sealed-account')
      return Effect.gen(function* () {
        const result = yield* Effect.exit(login(yield* Copilot))
        expect(Exit.isFailure(result)).toBe(true)
        expect(kept.get('copilot-account-a')).toBe('previously-sealed-account')
      }).pipe(Effect.provide(layer), onTestClock)
    },
  )

  it.effect('fails safely when GitHub cannot start authorization, without opening a page', () => {
    const { layer, kept } = fixture({ failure: 'start' })
    return Effect.gen(function* () {
      const error = yield* Effect.flip(
        (yield* Copilot).signIn('account-a', undefined, () => {
          throw new Error('No page should open')
        }),
      )
      expect(error).toMatchObject({ _tag: 'CopilotFailed', message: expect.stringContaining('could not start sign-in') })
      expect(kept.size).toBe(0)
    }).pipe(Effect.provide(layer))
  })

  it.effect.each(['poll', 'account', 'account-json', 'models'] as const)(
    'preserves the previous sign-in after a failed %s response',
    (failure) => {
      const { layer, kept } = fixture({ failure })
      kept.set('copilot-account-a', 'previously-sealed-account')
      return Effect.gen(function* () {
        const error = yield* Effect.flip(login(yield* Copilot))
        expect(error).toMatchObject({ _tag: 'CopilotFailed' })
        expect(JSON.stringify(error)).not.toContain('Internal network details')
        expect(kept.get('copilot-account-a')).toBe('previously-sealed-account')
      }).pipe(Effect.provide(layer), onTestClock)
    },
  )

  const saved = {
    host: 'github.com',
    clientId: 'althar-public-id',
    api: 'https://api.githubcopilot.com',
    token: { accessToken: 'test-access', refreshToken: null, expiresAt: null, scope: 'read:user' },
  }
  it.each([
    'unreadable credential',
    JSON.stringify({ ...saved, host: 'https://github.com' }),
    JSON.stringify({ ...saved, api: 'https://unrecognized.example' }),
    JSON.stringify({ ...saved, token: { ...saved.token, accessToken: '' } }),
  ])('does not authenticate requests using a damaged or unsafe saved credential (%#)', async (credential) => {
    const { layer, kept, calls } = fixture()
    kept.set('copilot-account-a', credential)
    const copilot = await Effect.runPromise(Copilot.pipe(Effect.provide(layer)))
    expect(await Effect.runPromise(copilot.status('account-a'))).toEqual({ status: 'unknown', paidBy: 'unknown' })
    await expect(copilot.provider('account-a').models(new AbortController().signal)).rejects.toThrow('Sign in again')
    expect(calls).toEqual([])
  })

  it.each([null, JSON.stringify({ ...saved, token: { ...saved.token, expiresAt: '2020-01-01T00:00:00Z' } })])(
    'requires fresh sign-in for a missing or expired credential that cannot refresh (%#)',
    async (credential) => {
      const { layer, kept, calls } = fixture()
      if (credential !== null) kept.set('copilot-account-a', credential)
      const copilot = await Effect.runPromise(Copilot.pipe(Effect.provide(layer)))
      await expect(copilot.provider('account-a').models(new AbortController().signal)).rejects.toThrow('authentication required')
      expect(calls).toEqual([])
    },
  )

  it('accepts GitHub-owned account endpoints and refuses unrelated or unsafe ones', () => {
    expect(copilotApi('github.com', 'https://api.business.githubcopilot.com')).toBe('https://api.business.githubcopilot.com')
    expect(copilotApi('github.com', 'http://api.githubcopilot.com')).toBeNull()
    expect(copilotApi('github.com', 'https://api.githubcopilot.com.evil.example')).toBeNull()
    expect(copilotApi('github.com', 'https://api.githubcopilot.com/path')).toBeNull()
    expect(copilotApi('company.ghe.com')).toBe('https://copilot-api.company.ghe.com')
    for (const endpoint of [
      'not a URL',
      'https://user@api.githubcopilot.com',
      'https://:password@api.githubcopilot.com',
      'https://api.githubcopilot.com:1234',
      'https://api.githubcopilot.com?unexpected=true',
      'https://api.githubcopilot.com#unexpected',
      'https://unrecognized.example',
    ])
      expect(copilotApi('github.com', endpoint)).toBeNull()
  })

  it.effect('uses the selected Enterprise Server REST endpoint rather than github.com', () => {
    const { layer, calls } = fixture({ host: 'git.company.example' })
    return Effect.gen(function* () {
      yield* login(yield* Copilot, 'git.company.example')
      expect(calls.some((call) => call.url === 'https://git.company.example/api/v3/copilot_internal/user')).toBe(true)
      expect(calls.some((call) => new URL(call.url).hostname === 'api.github.com')).toBe(false)
    }).pipe(Effect.provide(layer), onTestClock)
  })

  it('leaves the expired credential intact and requests fresh sign-in after refresh is refused', async () => {
    const credential = JSON.stringify({
      ...saved,
      token: { ...saved.token, expiresAt: '2020-01-01T00:00:00Z', refreshToken: 'expired-refresh' },
    })
    const kept = new Map([['copilot-account-a', credential]])
    const requested: string[] = []
    const layer = Copilot.layer({
      fetch: async (url) => {
        requested.push(url)
        return Response.json({ error: 'bad_refresh_token' }, { status: 400 })
      },
    }).pipe(Layer.provideMerge(Secrets.memory(kept)))
    const copilot = await Effect.runPromise(Copilot.pipe(Effect.provide(layer)))
    await expect(copilot.provider('account-a').models(new AbortController().signal)).rejects.toThrow('authentication required')
    expect(kept.get('copilot-account-a')).toBe(credential)
    expect(requested).toEqual(['https://github.com/login/oauth/access_token'])
  })

  it('authenticates image and compaction requests to the advertised Messages API', async () => {
    const kept = new Map([['copilot-account-a', JSON.stringify(saved)]])
    const headers: Headers[] = []
    const layer = Copilot.layer({
      appVersion: '0.8.0-test',
      fetch: async (url, input) => {
        expect(url).toBe('https://api.githubcopilot.com/v1/messages')
        headers.push(new Headers(input?.headers))
        return Response.json({
          type: 'message',
          content: [{ type: 'text', text: 'Seen.' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 2 },
        })
      },
    }).pipe(Layer.provideMerge(Secrets.memory(kept)))
    const provider = (await Effect.runPromise(Copilot.pipe(Effect.provide(layer)))).provider('account-a')
    const model = {
      id: 'messages-model',
      name: 'Messages model',
      context: 32_000,
      output: 4096,
      images: true,
      protocol: 'messages' as const,
    }
    const base = {
      model,
      tools: [],
      initiator: 'agent' as const,
      sessionId: 'task-a',
      signal: new AbortController().signal,
      onText: () => undefined,
    }
    expect(
      (
        await provider.complete({
          ...base,
          messages: [{ role: 'user', content: [{ type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' }] }],
        })
      ).text,
    ).toBe('Seen.')
    await provider.complete({ ...base, purpose: 'compaction', messages: [{ role: 'user', content: 'Summarize the work.' }] })
    expect(headers[0]?.get('copilot-vision-request')).toBe('true')
    expect(headers[0]?.get('anthropic-version')).toBe('2023-06-01')
    expect(headers[0]?.get('authorization')).toBe('Bearer test-access')
    expect(headers[0]?.get('user-agent')).toBe('Althar/0.8.0-test')
    expect(headers[1]?.get('x-interaction-type')).toBe('conversation-compaction')
    expect(headers[1]?.has('copilot-vision-request')).toBe(false)
  })

  it('refreshes an expired account once for concurrent model requests and authenticates inference inside Althar', async () => {
    const kept = new Map([
      [
        'copilot-account-a',
        JSON.stringify({
          host: 'github.com',
          clientId: 'althar-public-id',
          api: 'https://api.githubcopilot.com',
          token: {
            accessToken: 'expired-test-token',
            refreshToken: 'test-refresh-token',
            expiresAt: '2020-01-01T00:00:00Z',
            scope: 'read:user',
          },
        }),
      ],
    ])
    let refreshes = 0
    const requests: RequestInit[] = []
    const layer = Copilot.layer({
      fetch: async (url, input) => {
        if (url.endsWith('/login/oauth/access_token')) {
          refreshes += 1
          expect(input?.body).toContain('client_id=althar-public-id')
          expect(input?.body).toContain('refresh_token=test-refresh-token')
          return Response.json({ access_token: 'fresh-test-token', refresh_token: 'next-refresh-token', expires_in: 3600 })
        }
        expect(new Headers(input?.headers).get('authorization')).toBe('Bearer fresh-test-token')
        if (url.endsWith('/models')) return Response.json(models)
        requests.push(input ?? {})
        return Response.json({
          choices: [{ message: { content: 'Connected through Althar.' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 3, completion_tokens: 4 },
        })
      },
    }).pipe(Layer.provideMerge(Secrets.memory(kept)))
    const copilot = await Effect.runPromise(Copilot.pipe(Effect.provide(layer)))
    const provider = copilot.provider('account-a')
    const signal = new AbortController().signal
    const [catalog] = await Promise.all([provider.models(signal), provider.models(signal)])
    expect(refreshes).toBe(1)
    expect(kept.get('copilot-account-a')).toContain('next-refresh-token')
    const model = catalog[0]
    if (!model) throw new Error('Missing test model')
    const reply = await provider.complete({
      model,
      messages: [{ role: 'user', content: 'Hello' }],
      tools: [],
      initiator: 'user',
      sessionId: 'task-a',
      signal,
      onText: () => undefined,
    })
    expect(reply.text).toBe('Connected through Althar.')
    const headers = new Headers(requests[0]?.headers)
    expect(headers.get('user-agent')).toBe('Althar/dev')
    expect(headers.get('x-initiator')).toBe('user')
    expect(headers.get('x-interaction-id')).toBe('task-a')
    expect(headers.has('copilot-integration-id')).toBe(false)
  })
})
