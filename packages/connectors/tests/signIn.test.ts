import { assert, describe, it } from '@effect/vitest'
import { Effect, Exit, Fiber } from 'effect'
import { TestClock } from 'effect/testing'

import { authorizeUrl, awaitDeviceFlow, exchangeCode, makePkce, refreshToken, startDeviceFlow } from '../src/signIn'
import { type Answer, stubFetch } from './stub'

const START = Date.parse('1970-01-01T00:00:00.000Z')

describe('a device sign-in', () => {
  it.effect('gives the code and where to type it', () =>
    Effect.gen(function* () {
      const { fetch, sent } = stubFetch([
        [
          'POST',
          'https://github.com/login/device/code',
          {
            json: {
              device_code: 'dev',
              user_code: 'ABCD-1234',
              verification_uri: 'https://github.com/login/device',
              expires_in: 900,
              interval: 5,
            },
          },
        ],
      ])
      const authorization = yield* startDeviceFlow({
        product: 'github',
        fetch,
        codeUrl: 'https://github.com/login/device/code',
        clientId: 'Iv1.app',
      })
      assert.deepStrictEqual(authorization, {
        deviceCode: 'dev',
        userCode: 'ABCD-1234',
        verificationUri: 'https://github.com/login/device',
        verificationUriComplete: null,
        expiresAt: new Date(START + 900_000).toISOString(),
        interval: 5,
      })
      assert.deepStrictEqual(sent[0]?.body, { client_id: 'Iv1.app' })
      assert.strictEqual(sent[0]?.headers['content-type'], 'application/x-www-form-urlencoded')
    }),
  )

  it.effect('asks for a scope where the service wants one, and polls every 5 seconds unless told', () =>
    Effect.gen(function* () {
      const { fetch, sent } = stubFetch([
        [
          'POST',
          'https://gitlab.com/oauth/authorize_device',
          {
            json: {
              device_code: 'dev',
              user_code: 'XY',
              verification_uri: 'https://gitlab.com/oauth/device',
              verification_uri_complete: 'https://gitlab.com/oauth/device?user_code=XY',
              expires_in: 300,
            },
          },
        ],
      ])
      const authorization = yield* startDeviceFlow({
        product: 'gitlab',
        fetch,
        codeUrl: 'https://gitlab.com/oauth/authorize_device',
        clientId: 'app',
        scope: 'api',
      })
      assert.strictEqual(authorization.interval, 5)
      assert.strictEqual(authorization.verificationUriComplete, 'https://gitlab.com/oauth/device?user_code=XY')
      assert.deepStrictEqual(sent[0]?.body, { client_id: 'app', scope: 'api' })
    }),
  )

  const waiting = (answers: ReadonlyArray<Answer>, expiresIn = 900) => {
    let next = 0
    const { fetch, sent } = stubFetch([
      ['POST', 'https://github.com/login/oauth/access_token', () => answers[Math.min((next += 1) - 1, answers.length - 1)] ?? {}],
    ])
    const flow = awaitDeviceFlow({
      product: 'github',
      fetch,
      tokenUrl: 'https://github.com/login/oauth/access_token',
      clientId: 'Iv1.app',
      authorization: {
        deviceCode: 'dev',
        userCode: 'ABCD-1234',
        verificationUri: 'https://github.com/login/device',
        verificationUriComplete: null,
        expiresAt: new Date(START + expiresIn * 1000).toISOString(),
        interval: 5,
      },
    })
    return { flow, sent }
  }

  it.effect('waits while the person types the code, slower when asked, and ends with the token', () =>
    Effect.gen(function* () {
      const { flow, sent } = waiting([
        { json: { error: 'authorization_pending' } },
        { json: { error: 'slow_down', interval: 10 } },
        { json: { access_token: 'ghu_1', refresh_token: 'ghr_1', expires_in: 28_800, scope: '' } },
      ])
      const fiber = yield* Effect.forkChild(flow)
      yield* TestClock.adjust('5 seconds')
      yield* TestClock.adjust('5 seconds')
      assert.lengthOf(sent, 2)
      yield* TestClock.adjust('5 seconds')
      assert.lengthOf(sent, 2, 'asked to slow down, it waits 10 seconds')
      yield* TestClock.adjust('5 seconds')
      const token = yield* Fiber.join(fiber)
      assert.deepStrictEqual(token, {
        accessToken: 'ghu_1',
        refreshToken: 'ghr_1',
        expiresAt: new Date(START + 20_000 + 28_800_000).toISOString(),
        scope: '',
      })
      assert.deepStrictEqual(sent[0]?.body, {
        client_id: 'Iv1.app',
        device_code: 'dev',
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      })
    }),
  )

  it.effect('ends when the person says no, or the code expires', () =>
    Effect.gen(function* () {
      const denied = yield* Effect.forkChild(Effect.flip(waiting([{ json: { error: 'access_denied' } }]).flow))
      yield* TestClock.adjust('5 seconds')
      assert.strictEqual((yield* Fiber.join(denied)).reason, 'denied')
      const expired = yield* Effect.forkChild(Effect.flip(waiting([{ json: { error: 'expired_token' } }]).flow))
      yield* TestClock.adjust('5 seconds')
      assert.strictEqual((yield* Fiber.join(expired)).reason, 'expired')
      // The clock is at 10 seconds by now: the code expires 7 seconds on.
      const late = waiting([{ json: { error: 'authorization_pending' } }], 17)
      const timedOut = yield* Effect.forkChild(Effect.flip(late.flow))
      yield* TestClock.adjust('10 seconds')
      assert.strictEqual((yield* Fiber.join(timedOut)).reason, 'expired')
      assert.lengthOf(late.sent, 1, 'it stops asking once the code has expired')
    }),
  )

  it.effect('fails when the service answers with something other than a token', () =>
    Effect.gen(function* () {
      const odd = yield* Effect.forkChild(
        Effect.exit(waiting([{ json: { error: 'unsupported_grant_type', error_description: 'No' } }]).flow),
      )
      yield* TestClock.adjust('5 seconds')
      const exit = yield* Fiber.join(odd)
      assert.isTrue(Exit.isFailure(exit))
      const broken = yield* Effect.forkChild(Effect.exit(waiting([{ status: 503, text: 'down' }]).flow))
      yield* TestClock.adjust('5 seconds')
      assert.isTrue(Exit.isFailure(yield* Fiber.join(broken)))
      const garbled = yield* Effect.forkChild(Effect.exit(waiting([{ status: 401, text: 'nope' }]).flow))
      yield* TestClock.adjust('5 seconds')
      const garbledExit = yield* Fiber.join(garbled)
      assert.isTrue(Exit.isFailure(garbledExit))
    }),
  )

  it.effect('is unreachable when the network fails', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        startDeviceFlow({ product: 'github', fetch: () => Promise.reject(new Error('offline')), codeUrl: 'https://x', clientId: 'a' }),
      )
      assert.strictEqual(error._tag === 'ConnectorFailed' ? error.reason : '', 'unreachable')
      const unreadable = yield* Effect.flip(
        startDeviceFlow({
          product: 'github',
          fetch: async () => ({ status: 200, text: () => Promise.reject(new Error('reset')) }) as unknown as Response,
          codeUrl: 'https://x',
          clientId: 'a',
        }),
      )
      assert.strictEqual(unreadable.reason, 'unreachable')
    }),
  )
})

describe('a refresh', () => {
  it.effect('renews the token, keeping a refresh token the service didn’t rotate', () =>
    Effect.gen(function* () {
      const { fetch, sent } = stubFetch([
        ['POST', 'https://github.com/login/oauth/access_token', { json: { access_token: 'ghu_2', expires_in: 60 } }],
      ])
      const token = yield* refreshToken({
        product: 'github',
        fetch,
        tokenUrl: 'https://github.com/login/oauth/access_token',
        clientId: 'Iv1.app',
        refreshToken: 'ghr_1',
      })
      assert.strictEqual(token.accessToken, 'ghu_2')
      assert.strictEqual(token.refreshToken, 'ghr_1')
      assert.deepStrictEqual(sent[0]?.body, { client_id: 'Iv1.app', grant_type: 'refresh_token', refresh_token: 'ghr_1' })
    }),
  )

  it.effect('says the person must sign in again when the refresh token is spent', () =>
    Effect.gen(function* () {
      const { fetch } = stubFetch([['POST', 'https://github.com/login/oauth/access_token', { json: { error: 'invalid_grant' } }]])
      const error = yield* Effect.flip(
        refreshToken({
          product: 'github',
          fetch,
          tokenUrl: 'https://github.com/login/oauth/access_token',
          clientId: 'a',
          refreshToken: 'old',
        }),
      )
      assert.strictEqual(error.reason, 'unauthorized')
    }),
  )
})

describe('a browser sign-in with PKCE', () => {
  it('carries a challenge only this process can answer', () => {
    const pkce = makePkce()
    assert.match(pkce.verifier, /^[A-Za-z0-9_-]{43}$/)
    assert.notStrictEqual(pkce.challenge, pkce.verifier)
    const url = new URL(
      authorizeUrl({
        authorizeUrl: 'https://linear.app/oauth/authorize',
        clientId: 'lin',
        redirectUri: 'http://127.0.0.1:5000/callback',
        scope: 'read,write',
        pkce,
        extra: { prompt: 'consent' },
      }),
    )
    assert.strictEqual(url.origin + url.pathname, 'https://linear.app/oauth/authorize')
    assert.strictEqual(url.searchParams.get('code_challenge'), pkce.challenge)
    assert.strictEqual(url.searchParams.get('code_challenge_method'), 'S256')
    assert.strictEqual(url.searchParams.get('state'), pkce.state)
    assert.strictEqual(url.searchParams.get('prompt'), 'consent')
    assert.notStrictEqual(makePkce().verifier, pkce.verifier)
  })

  it.effect('redeems the code with the verifier', () =>
    Effect.gen(function* () {
      const { fetch, sent } = stubFetch([
        [
          'POST',
          'https://api.linear.app/oauth/token',
          { json: { access_token: 'lin_oauth', token_type: 'Bearer', expires_in: 86_400, scope: 'read write' } },
        ],
      ])
      const pkce = makePkce()
      const token = yield* exchangeCode({
        product: 'linear',
        fetch,
        tokenUrl: 'https://api.linear.app/oauth/token',
        clientId: 'lin',
        redirectUri: 'http://127.0.0.1:5000/callback',
        code: 'code',
        pkce,
      })
      assert.strictEqual(token.accessToken, 'lin_oauth')
      assert.isNull(token.refreshToken)
      assert.deepStrictEqual(sent[0]?.body, {
        client_id: 'lin',
        grant_type: 'authorization_code',
        code: 'code',
        redirect_uri: 'http://127.0.0.1:5000/callback',
        code_verifier: pkce.verifier,
      })
    }),
  )
})
