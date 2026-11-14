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
const fixture = (options: { host?: string; user?: unknown; denied?: boolean; configured?: boolean } = {}) => {
  const host = options.host ?? 'github.com'
  const kept = new Map<string, string>()
  const calls: Array<{ url: string; body: string; authorization: string | null }> = []
  const fetcher = async (url: string, input?: RequestInit) => {
    calls.push({
      url,
      body: typeof input?.body === 'string' ? input.body : '',
      authorization: new Headers(input?.headers).get('authorization'),
    })
    if (url.endsWith('/login/device/code'))
      return Response.json({
        device_code: 'test-device',
        user_code: 'ABCD-1234',
        verification_uri: `https://${host}/login/device`,
        expires_in: 900,
        interval: 1,
      })
    if (url.endsWith('/login/oauth/access_token'))
      return Response.json(options.denied ? { error: 'access_denied' } : { access_token: 'test-access-token', scope: 'read:user' })
    if (url.endsWith('/copilot_internal/user')) return Response.json(options.user ?? { chat_enabled: true })
    if (url.endsWith('/models')) return Response.json(models)
    throw new Error(`Unexpected test request: ${url}`)
  }
  const layer = Copilot.layer({
    ...(options.configured === false ? {} : { clientId: 'althar-public-id' }),
    enterpriseClientIds: { 'company.ghe.com': 'althar-enterprise-id' },
    fetch: fetcher,
  }).pipe(Layer.provideMerge(Secrets.memory(kept)))
  return { kept, calls, layer }
}

const login = (copilot: typeof Copilot.Service, host?: string) =>
  Effect.gen(function* () {
    const shown = yield* Deferred.make<void>()
    const fiber = yield* Effect.forkChild(
      copilot.signIn('account-a', host, () => {
        Effect.runSync(Deferred.succeed(shown, undefined))
      }),
    )
    yield* Deferred.await(shown)
    yield* TestClock.adjust(Duration.seconds(1))
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

  it('accepts GitHub-owned account endpoints and refuses unrelated or unsafe ones', () => {
    expect(copilotApi('github.com', 'https://api.business.githubcopilot.com')).toBe('https://api.business.githubcopilot.com')
    expect(copilotApi('github.com', 'http://api.githubcopilot.com')).toBeNull()
    expect(copilotApi('github.com', 'https://api.githubcopilot.com.evil.example')).toBeNull()
    expect(copilotApi('github.com', 'https://api.githubcopilot.com/path')).toBeNull()
    expect(copilotApi('company.ghe.com')).toBe('https://copilot-api.company.ghe.com')
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
