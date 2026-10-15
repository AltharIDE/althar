import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type Fetch, type ProductInfo, products } from '@althar/connectors'
import { makeFakeService } from '@althar/connectors/testing'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Fiber, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Agents, Connectors, readingUntrusted, withoutSignIns } from '../src/Config'
import { Connections, NotConnected, pageOf, SignInUnavailable } from '../src/Connections'
import { CliUnanswered, NotFound } from '../src/errors'
import { Instance } from '../src/Instance'
import * as Runtime from '../src/Runtime'
import { type Sealer, Secrets, SecretsUnavailable } from '../src/Secrets'
import { fakeAgents, fakeConnectors, until } from './support'

/*
 * Connections (docs/architecture/06, "Signing in"): the service's own sign-in
 * where it needs no secret (GitHub's device flow, Linear's browser sign-in
 * with PKCE), or a pasted token; the token in the keychain, renewed before it
 * expires, and a connection whose token a service refuses needing its person
 * to sign in again. GitHub here is the real adapter, against answers given by
 * a stand-in for fetch.
 */

type Answer = { readonly status?: number; readonly json?: unknown }
type Route = readonly [
  method: string,
  url: string,
  answer: Answer | ((body: Record<string, string>, authorization: string | undefined) => Answer),
]

/** A stand-in for `fetch`, by method and URL, keeping what each request sent. */
const stub = (routes: ReadonlyArray<Route>) => {
  const sent: Array<{
    readonly method: string
    readonly url: string
    readonly body: Record<string, string>
    readonly authorization: string | undefined
  }> = []
  const fetch: Fetch = async (url, init = {}) => {
    const method = init.method ?? 'GET'
    const raw = typeof init.body === 'string' ? init.body : ''
    const body = raw.startsWith('{') ? (JSON.parse(raw) as Record<string, string>) : Object.fromEntries(new URLSearchParams(raw))
    const headers = (init.headers ?? {}) as Record<string, string>
    sent.push({ method, url, body, authorization: headers.authorization })
    const route = routes.find(([m, u]) => m === method && u === url)
    if (route === undefined) return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 })
    const answer = typeof route[2] === 'function' ? route[2](body, headers.authorization) : route[2]
    return new Response(JSON.stringify(answer.json ?? {}), { status: answer.status ?? 200 })
  }
  return { fetch, sent }
}

/** The runtime with GitHub's real adapter over `fetch`, and Linear answered by a fake. */
const withGitHub = (
  fetch: Fetch,
  more: {
    readonly callbackPort?: number
    readonly linear?: ReturnType<typeof makeFakeService>
    readonly secrets?: Layer.Layer<Secrets>
    /** Real adapters for other products, offered with GitHub's. */
    readonly more?: ReadonlyArray<ProductInfo>
    /** A command-line tool's sign-in, by tool and host. */
    readonly cliToken?: (tool: 'gh' | 'glab', host: string) => Effect.Effect<string | null, CliUnanswered>
  } = {},
) =>
  Runtime.layer({
    database: ':memory:',
    worktreeRoot: mkdtempSync(join(tmpdir(), 'althar-worktrees-')),
    appVersion: '0.0.0-test',
    deviceName: 'Test Mac',
    agents: fakeAgents(),
    secrets: more.secrets ?? Secrets.memory(),
    connectors: Layer.succeed(
      Connectors,
      Connectors.of({
        products: [
          products.github,
          { ...products.linear, make: () => (more.linear === undefined ? {} : { tracker: more.linear }) },
          ...(more.more ?? []),
        ],
        fetch,
        clientIds: { github: 'Iv1.althar', linear: 'lin-althar' },
        callbackPort: more.callbackPort ?? 0,
        cliToken: more.cliToken ?? (() => Effect.succeed(null)),
      }),
    ),
  })

const GITHUB = 'https://github.com'
const device = [
  'POST',
  `${GITHUB}/login/device/code`,
  { json: { device_code: 'dev', user_code: 'ABCD-1234', verification_uri: `${GITHUB}/login/device`, expires_in: 900, interval: 0 } },
] as const
const user = ['GET', 'https://api.github.com/user', { json: { id: 5, login: 'you', name: 'You Person' } }] as const

const flowEnded = (flowId: string) =>
  Effect.gen(function* () {
    const connections = yield* Connections
    return [yield* connections.signIn(flowId)]
  })

describe('a connection', () => {
  it.live('signs in by GitHub’s device flow, keeps the token in the keychain, and renews it before it expires', () => {
    let tokens = 0
    const { fetch, sent } = stub([
      device,
      [
        'POST',
        `${GITHUB}/login/oauth/access_token`,
        (body) =>
          body.grant_type === 'refresh_token'
            ? { json: { access_token: 'ghu_renewed', refresh_token: 'ghr_2', expires_in: 28_800 } }
            : (tokens += 1) === 1
              ? { json: { error: 'authorization_pending' } }
              : { json: { access_token: 'ghu_first', refresh_token: 'ghr_1', expires_in: 60 } },
      ],
      user,
    ])
    return Effect.gen(function* () {
      const connections = yield* Connections
      const instance = yield* Instance
      const secrets = yield* Secrets
      const started = yield* connections.startSignIn({ product: 'github', actorId: instance.personId })
      assert.deepInclude(started, { kind: 'device', userCode: 'ABCD-1234', verificationUri: `${GITHUB}/login/device` })
      const [done] = yield* until(flowEnded(started.flowId), (states) => states[0]?.state !== 'waiting')
      assert.strictEqual(done?.state, 'done')
      const [connection] = yield* connections.list
      assert.deepInclude(connection, { product: 'github', name: 'GitHub', webUrl: GITHUB, auth: 'device_flow', state: 'ready' })
      assert.deepStrictEqual(connection?.account, { id: '5', login: 'you', name: 'You Person' })
      const kept = JSON.parse((yield* secrets.get(connection?.id ?? '')) ?? '{}') as { accessToken?: string }
      assert.strictEqual(kept.accessToken, 'ghu_first')

      // The token expires within the minute: the next call renews it first, and uses the new one.
      const { host } = yield* connections.adapters(connection?.id ?? '')
      yield* host?.account ?? Effect.void
      assert.strictEqual(sent.at(-1)?.authorization, 'Bearer ghu_renewed')
      assert.deepInclude(sent.find((request) => request.body.grant_type === 'refresh_token')?.body, {
        client_id: 'Iv1.althar',
        refresh_token: 'ghr_1',
      })
      const renewed = JSON.parse((yield* secrets.get(connection?.id ?? '')) ?? '{}') as { accessToken?: string; refreshToken?: string }
      assert.deepInclude(renewed, { accessToken: 'ghu_renewed', refreshToken: 'ghr_2' })
      // Renewed for hours, it isn't renewed again.
      yield* host?.account ?? Effect.void
      assert.lengthOf(
        sent.filter((request) => request.body.grant_type === 'refresh_token'),
        1,
      )
      // Its check: a sign-in that renews itself, and when the token it has now runs out.
      const check = yield* connections.check(connection?.id ?? '')
      assert.isTrue(check.renews)
      assert.isAbove(Date.parse(check.expiresAt ?? ''), Date.now())
      // A token gone from the keychain is no token: the connection needs signing in again, and stays so.
      yield* secrets.remove(connection?.id ?? '')
      const missing = yield* Effect.flip(host?.account ?? Effect.void)
      assert.strictEqual(missing instanceof Error && 'reason' in missing ? missing.reason : '', 'unauthorized')
      yield* Effect.flip(host?.account ?? Effect.void)
      assert.strictEqual((yield* connections.list)[0]?.state, 'reauth_required')
    }).pipe(Effect.provide(withGitHub(fetch)))
  })

  it.live('ends a sign-in the person declined, or cancelled', () => {
    const { fetch } = stub([device, ['POST', `${GITHUB}/login/oauth/access_token`, { json: { error: 'access_denied' } }]])
    return Effect.gen(function* () {
      const connections = yield* Connections
      const instance = yield* Instance
      const started = yield* connections.startSignIn({ product: 'github', actorId: instance.personId })
      const [ended] = yield* until(flowEnded(started.flowId), (states) => states[0]?.state !== 'waiting')
      assert.deepStrictEqual(ended, { state: 'ended', reason: 'denied', message: 'Sign-in was declined.' })
      yield* connections.cancelSignIn(started.flowId)
      assert.strictEqual((yield* Effect.flip(connections.signIn(started.flowId)))._tag, 'NotFound')
      assert.lengthOf(yield* connections.list, 0)
    }).pipe(Effect.provide(withGitHub(fetch)))
  })

  it.live('ends a sign-in whose code ran out, that GitHub failed, or that signed in as someone else than the connection', () => {
    let answer: Record<string, unknown> = { error: 'expired_token' }
    const { fetch } = stub([device, ['POST', `${GITHUB}/login/oauth/access_token`, () => ({ json: answer })], user])
    return Effect.gen(function* () {
      const connections = yield* Connections
      const instance = yield* Instance
      const sql = yield* SqlClient.SqlClient
      const ending = (connectionId?: string) =>
        Effect.gen(function* () {
          const started = yield* connections.startSignIn({
            product: 'github',
            actorId: instance.personId,
            ...(connectionId === undefined ? {} : { connectionId }),
          })
          const [ended] = yield* until(flowEnded(started.flowId), (states) => states[0]?.state !== 'waiting')
          return ended
        })
      assert.deepStrictEqual(yield* ending(), { state: 'ended', reason: 'expired', message: 'The code expired.' })
      answer = { error: 'unsupported_grant_type', error_description: 'GitHub said no.' }
      assert.deepInclude(yield* ending(), { state: 'ended', reason: 'failed' })

      // Signing a connection of someone else's in again: GitHub signs in as you, so it isn't theirs.
      answer = { access_token: 'ghu_you', refresh_token: 'ghr_you', expires_in: 28_800 }
      const made = yield* connections.connectToken({ product: 'github', token: 'ghp_old', actorId: instance.personId })
      yield* sql`UPDATE connections SET account_id = 'other', account_login = 'someone' WHERE id = ${made.id}`
      assert.deepStrictEqual(yield* ending(made.id), { state: 'ended', reason: 'failed', message: 'That signed in as you, not someone.' })
      assert.strictEqual((yield* connections.list)[0]?.account.login, 'someone')
    }).pipe(Effect.provide(withGitHub(fetch)))
  })

  it.live('signs a connection in again at its own instance, whatever address came with it', () => {
    const { fetch, sent } = stub([device, ['POST', `${GITHUB}/login/oauth/access_token`, { json: { error: 'access_denied' } }], user])
    return Effect.gen(function* () {
      const connections = yield* Connections
      const instance = yield* Instance
      const made = yield* connections.connectToken({ product: 'github', token: 'ghp_old', actorId: instance.personId })
      const started = yield* connections.startSignIn({
        product: 'github',
        webUrl: 'http://github.com',
        connectionId: made.id,
        actorId: instance.personId,
      })
      yield* connections.cancelSignIn(started.flowId)
      assert.deepStrictEqual(
        sent.filter((request) => request.url.includes('/login/')).map((request) => request.url),
        [`${GITHUB}/login/device/code`],
      )
    }).pipe(Effect.provide(withGitHub(fetch)))
  })

  it.live('signs in to Linear in the browser, coming back to a loopback address only it knows the code for', () => {
    const port = 41_000 + Math.floor(Math.random() * 2000)
    const tracker = makeFakeService({ product: 'linear', account: { id: 'u1', login: 'you', name: 'You' } })
    const { fetch, sent } = stub([
      ['POST', 'https://api.linear.app/oauth/token', { json: { access_token: 'lin_oauth', expires_in: 86_400 } }],
    ])
    return Effect.gen(function* () {
      const connections = yield* Connections
      const instance = yield* Instance
      const started = yield* connections.startSignIn({ product: 'linear', actorId: instance.personId })
      assert.strictEqual(started.kind, 'browser')
      const url = new URL(started.kind === 'browser' ? started.url : '')
      assert.strictEqual(url.origin + url.pathname, 'https://linear.app/oauth/authorize')
      assert.strictEqual(url.searchParams.get('redirect_uri'), `http://127.0.0.1:${port}/callback`)
      // A browser that comes back without the state this sign-in sent is turned away.
      const wrong = yield* Effect.promise(() => globalThis.fetch(`http://127.0.0.1:${port}/callback?code=x&state=forged`))
      assert.strictEqual(wrong.status, 400)
      assert.strictEqual((yield* Effect.promise(() => globalThis.fetch(`http://127.0.0.1:${port}/other`))).status, 404)
      const back = yield* Effect.promise(() =>
        globalThis.fetch(`http://127.0.0.1:${port}/callback?code=the-code&state=${url.searchParams.get('state') ?? ''}`),
      )
      assert.include(yield* Effect.promise(() => back.text()), 'Signed in to Linear')
      const [done] = yield* until(flowEnded(started.flowId), (states) => states[0]?.state !== 'waiting')
      assert.strictEqual(done?.state, 'done')
      assert.deepInclude(sent[0]?.body, { code: 'the-code', grant_type: 'authorization_code', client_id: 'lin-althar' })
      assert.strictEqual((yield* connections.list)[0]?.auth, 'pkce')
    }).pipe(Effect.provide(withGitHub(fetch, { callbackPort: port, linear: tracker })))
  })

  it.live('takes a pasted token, renews the same account’s rather than adding it twice, and is removed with its token', () => {
    const { fetch, sent } = stub([user])
    return Effect.gen(function* () {
      const connections = yield* Connections
      const instance = yield* Instance
      const secrets = yield* Secrets
      const first = yield* connections.connectToken({ product: 'github', token: ' github_pat_1 ', actorId: instance.personId })
      assert.strictEqual(sent[0]?.authorization, 'Bearer github_pat_1')
      const again = yield* connections.connectToken({ product: 'github', token: 'github_pat_2', actorId: instance.personId })
      assert.strictEqual(again.id, first.id)
      assert.lengthOf(yield* connections.list, 1)
      assert.include((yield* secrets.get(first.id)) ?? '', 'github_pat_2')
      yield* connections.remove(first.id, instance.personId)
      assert.lengthOf(yield* connections.list, 0)
      assert.isNull(yield* secrets.get(first.id))
      assert.instanceOf(yield* Effect.flip(connections.adapters(first.id)), NotFound)
    }).pipe(Effect.provide(withGitHub(fetch)))
  })

  it.live('takes Trello’s token with the API key it was made for, and sends both in a header on every call', () => {
    const { fetch, sent } = stub([
      [
        'GET',
        'https://api.trello.com/1/members/me?fields=id,username,fullName',
        { json: { id: 'm1', username: 'you', fullName: 'You Person' } },
      ],
    ])
    const signed = 'OAuth oauth_consumer_key="0123abcd", oauth_token="ATTA0000"'
    return Effect.gen(function* () {
      const connections = yield* Connections
      const instance = yield* Instance
      const secrets = yield* Secrets
      const connection = yield* connections.connectToken({
        product: 'trello',
        key: ' 0123abcd ',
        token: 'ATTA0000',
        actorId: instance.personId,
      })
      assert.deepInclude(connection, { product: 'trello', webUrl: 'https://trello.com', auth: 'token' })
      assert.strictEqual(sent[0]?.authorization, signed)
      assert.deepInclude(JSON.parse((yield* secrets.get(connection.id)) ?? '{}') as object, { token: 'ATTA0000', key: '0123abcd' })
      const { tracker } = yield* connections.adapters(connection.id)
      yield* tracker?.account ?? Effect.void
      assert.strictEqual(sent.at(-1)?.authorization, signed)
      assert.lengthOf(sent, 2)
    }).pipe(Effect.provide(withGitHub(fetch, { more: [products.trello] })))
  })

  it.live('needs signing in again when the service refuses its token, and again on a second look, and says why', () => {
    let refused = false
    const { fetch, sent } = stub([
      ['GET', 'https://api.github.com/user', () => (refused ? { status: 401, json: { message: 'Bad credentials' } } : user[2])],
    ])
    return Effect.gen(function* () {
      const connections = yield* Connections
      const instance = yield* Instance
      const sql = yield* SqlClient.SqlClient
      const connection = yield* connections.connectToken({ product: 'github', token: 't', actorId: instance.personId })
      refused = true
      const { host } = yield* connections.adapters(connection.id)
      const error = yield* Effect.flip(host?.account ?? Effect.void)
      assert.strictEqual(error instanceof Error && 'reason' in error ? error.reason : '', 'unauthorized')
      assert.strictEqual((yield* connections.list)[0]?.state, 'reauth_required')
      // Connecting, the call, and the second look: GitHub said no twice before the connection stopped.
      assert.lengthOf(sent, 3)
      const [fact] = yield* sql<{
        type: string
        payload: string
        actorId: string
      }>`SELECT type, payload, actor_id FROM record_events WHERE aggregate_type = 'connection' ORDER BY sequence DESC LIMIT 1`
      assert.strictEqual(fact?.type, 'connection.reauth_required')
      assert.strictEqual(fact?.actorId, instance.systemId)
      const said = { reason: 'unauthorized', status: 401, message: 'Bad credentials' }
      assert.deepStrictEqual(JSON.parse(fact?.payload ?? '{}'), { product: 'github', refused: said, again: said, cli: null })
      // The token is in no fact.
      assert.notInclude(fact?.payload ?? '', '"t"')
      // A repository there still knows who it was, and that the sign-in stopped working.
      assert.deepInclude((yield* connections.placeOf('git@github.com:meridian/api.git'))?.connection, {
        id: connection.id,
        state: 'reauth_required',
      })
      // Signed in again, it is ready.
      refused = false
      yield* connections.connectToken({ product: 'github', token: 't2', actorId: instance.personId })
      assert.strictEqual((yield* connections.list)[0]?.state, 'ready')
    }).pipe(Effect.provide(withGitHub(fetch)))
  })

  it.live('keeps its state when Althar can’t open its sign-in, or finds it gone for a moment, rather than asking to sign in again', () => {
    const { fetch, sent } = stub([user])
    // Secrets that are kept, until the app stops opening them, or says there is none for as many asks as the test says.
    let locked = false
    let missing = 0
    const kept = new Map<string, string>()
    const secrets = Layer.succeed(
      Secrets,
      Secrets.of({
        set: (name, value) => Effect.sync(() => void kept.set(name, value)),
        get: (name) =>
          locked
            ? Effect.fail(new SecretsUnavailable({ reason: 'The app didn’t answer.' }))
            : Effect.sync(() => (missing-- > 0 ? null : (kept.get(name) ?? null))),
        remove: (name) => Effect.sync(() => void kept.delete(name)),
      }),
    )
    return Effect.gen(function* () {
      const connections = yield* Connections
      const instance = yield* Instance
      const connection = yield* connections.connectToken({ product: 'github', token: 't', actorId: instance.personId })
      locked = true
      const { host } = yield* connections.adapters(connection.id)
      const error = yield* Effect.flip(host?.account ?? Effect.void)
      assert.deepInclude(error, { reason: 'unreachable', message: 'Althar couldn’t open its sign-in: The app didn’t answer.' })
      assert.strictEqual((yield* connections.list)[0]?.state, 'ready')
      // Gone from the keychain for a moment: looked for again, it is there, and the call is made with it.
      locked = false
      missing = 1
      assert.strictEqual((yield* host?.account ?? Effect.die('No code host'))?.login, 'you')
      assert.strictEqual(sent.at(-1)?.authorization, 'Bearer t')
      assert.strictEqual((yield* connections.list)[0]?.state, 'ready')
    }).pipe(Effect.provide(withGitHub(fetch, { secrets })))
  })

  it.live(
    'needs signing in again when the keychain can no longer open the sealed token, and says so rather than that it is unreachable',
    () => {
      const { fetch } = stub([user])
      // The keychain answers, and the key it holds doesn't open what was sealed with another: main says the secret is unreadable.
      let lost = false
      const kept = new Map<string, string>()
      const secrets = Layer.succeed(
        Secrets,
        Secrets.of({
          set: (name, value) => Effect.sync(() => void kept.set(name, value)),
          get: (name) =>
            lost
              ? Effect.fail(
                  new SecretsUnavailable({
                    reason: 'Error while decrypting the ciphertext provided to safeStorage.decryptString.',
                    unreadable: true,
                  }),
                )
              : Effect.sync(() => kept.get(name) ?? null),
          remove: (name) => Effect.sync(() => void kept.delete(name)),
        }),
      )
      return Effect.gen(function* () {
        const connections = yield* Connections
        const instance = yield* Instance
        const sql = yield* SqlClient.SqlClient
        const connection = yield* connections.connectToken({ product: 'github', token: 't', actorId: instance.personId })
        lost = true
        const { host } = yield* connections.adapters(connection.id)
        const error = yield* Effect.flip(host?.account ?? Effect.void)
        assert.deepInclude(error, { _tag: 'ConnectorFailed', reason: 'unauthorized' })
        assert.notInclude(String((error as { message?: string }).message), 'safeStorage')
        assert.strictEqual((yield* connections.list)[0]?.state, 'reauth_required')
        const [fact] = yield* sql<{
          type: string
        }>`SELECT type FROM record_events WHERE aggregate_type = 'connection' ORDER BY sequence DESC LIMIT 1`
        assert.strictEqual(fact?.type, 'connection.reauth_required')
        // A repository there knows the sign-in stopped, and signing in again, with a key that opens, makes it ready.
        assert.deepInclude((yield* connections.placeOf('git@github.com:meridian/api.git'))?.connection, { state: 'reauth_required' })
        lost = false
        yield* connections.connectToken({ product: 'github', token: 't2', actorId: instance.personId })
        assert.strictEqual((yield* connections.list)[0]?.state, 'ready')
      }).pipe(Effect.provide(withGitHub(fetch, { secrets })))
    },
  )

  it.live('offers the browser sign-in only where Althar’s app is registered', () => {
    const github = makeFakeService()
    return Effect.gen(function* () {
      const connections = yield* Connections
      const instance = yield* Instance
      assert.deepStrictEqual(
        connections.products.map((info) => [info.product, info.browserSignIn]),
        [
          ['github', false],
          ['linear', false],
          ['trello', false],
        ],
      )
      assert.instanceOf(yield* Effect.flip(connections.startSignIn({ product: 'github', actorId: instance.personId })), SignInUnavailable)
      // A product without an adapter can't be connected.
      assert.instanceOf(
        yield* Effect.flip(connections.connectToken({ product: 'bitbucket_cloud', token: 't', actorId: instance.personId })),
        NotConnected,
      )
      // The fake answers as any GitHub instance; the remote's host decides which connection reaches a repository.
      const connection = yield* connections.connectToken({
        product: 'github',
        webUrl: 'https://git.meridian.dev/',
        token: 't',
        actorId: instance.personId,
      })
      assert.strictEqual(connection.webUrl, 'https://git.meridian.dev')
      assert.isNull(yield* connections.hostOf(['https://github.com/meridian/api.git', '/a/local/path']))
      assert.deepStrictEqual((yield* connections.hostOf(['git@git.meridian.dev:meridian/api.git']))?.path, ['meridian', 'api'])
      // Where a remote is: a hosted service Althar knows, an instance the person connected, a host it doesn't know, or none.
      assert.deepStrictEqual(yield* connections.placeOf('https://github.com/meridian/api.git'), {
        host: 'github.com',
        path: ['meridian', 'api'],
        code: { product: 'github', name: 'GitHub', hosted: true },
        url: 'https://github.com/meridian/api',
        connection: null,
      })
      const own = yield* connections.placeOf('git@git.meridian.dev:meridian/api.git')
      assert.deepStrictEqual(own?.code, { product: 'github', name: 'GitHub', hosted: false })
      assert.strictEqual(own?.connection?.id, connection.id)
      assert.strictEqual(own?.url, 'https://git.meridian.dev/meridian/api')
      assert.deepStrictEqual(yield* connections.placeOf('git@git.example.org:team/infra.git'), {
        host: 'git.example.org',
        path: ['team', 'infra'],
        code: null,
        url: null,
        connection: null,
      })
      assert.isNull(yield* connections.placeOf('/a/local/path'))
      assert.isNull(yield* connections.resolve('https://example.com/x'))
      assert.strictEqual((yield* connections.resolve('https://git.meridian.dev/meridian/api/pull/3'))?.ref.kind, 'change')
      assert.lengthOf(yield* connections.trackers, 1)
    }).pipe(
      Effect.provide(
        Runtime.layer({
          database: ':memory:',
          worktreeRoot: mkdtempSync(join(tmpdir(), 'althar-worktrees-')),
          appVersion: '0.0.0-test',
          deviceName: 'Test Mac',
          agents: fakeAgents(),
          secrets: Secrets.memory(),
          connectors: fakeConnectors({ github }),
        }),
      ),
    )
  })
})

describe('a sign-in a service refuses', () => {
  const USER = 'https://api.github.com/user'
  const REPO = 'https://api.github.com/repos/meridian/api'
  const refusal: Answer = { status: 401, json: { message: 'Bad credentials' } }

  /** GitHub, taking only the tokens it hasn't let go of. */
  const takes = (valid: ReadonlySet<string>): Route => [
    'GET',
    USER,
    (_, authorization) => (valid.has(authorization?.replace(/^Bearer /, '') ?? '') ? user[2] : refusal),
  ]

  /** Secrets kept in memory, the keeping of `token` held until the test lets it go: gh's token on its way to the keychain. */
  const heldWrite = (token: string) => {
    const kept = new Map<string, string>()
    let arrived = false
    let go = () => {}
    const waiting = new Promise<void>((resolve) => {
      go = resolve
    })
    const secrets = Layer.succeed(
      Secrets,
      Secrets.of({
        set: (name, value) =>
          Effect.gen(function* () {
            if ((JSON.parse(value) as { token?: string }).token === token) {
              arrived = true
              yield* Effect.promise(() => waiting)
            }
            kept.set(name, value)
          }),
        get: (name) => Effect.sync(() => kept.get(name) ?? null),
        remove: (name) => Effect.sync(() => void kept.delete(name)),
      }),
    )
    return {
      secrets,
      arrived: until(
        Effect.sync(() => [arrived]),
        ([now]) => now === true,
      ),
      release: () => go(),
    }
  }

  /** A connection's code host, as a caller has it. */
  const codeHost = (connectionId: string) =>
    Effect.gen(function* () {
      const { host } = yield* (yield* Connections).adapters(connectionId)
      return host ?? (yield* Effect.die('No code host'))
    })

  const factsOf = (connectionId: string) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      return yield* sql<{ type: string; payload: string; actorId: string }>`
        SELECT type, payload, actor_id FROM record_events WHERE aggregate_id = ${connectionId} ORDER BY sequence`
    })

  const tokenOf = (connectionId: string) =>
    Effect.gen(function* () {
      const raw = yield* (yield* Secrets).get(connectionId)
      return (JSON.parse(raw ?? '{}') as { token?: string }).token
    })

  /** GitHub over `fetch`, its `nth` answer to who `token` is for kept back until the test lets it go: a second look under way. */
  const held = (fetch: Fetch, token: string, nth: number) => {
    let seen = 0
    let arrived = false
    let go = () => {}
    const holding: Fetch = async (url, init = {}) => {
      const { authorization } = (init.headers ?? {}) as Record<string, string>
      if (url === USER && authorization?.endsWith(token) === true && ++seen === nth) {
        arrived = true
        await new Promise<void>((resolve) => {
          go = resolve
        })
      }
      return fetch(url, init)
    }
    return {
      fetch: holding,
      arrived: until(
        Effect.sync(() => [arrived]),
        ([now]) => now === true,
      ),
      release: () => go(),
    }
  }

  it.live('stays ready when it is refused once and taken on a second look, and the call is made again', () => {
    let refusals = 0
    const { fetch, sent } = stub([['GET', USER, () => (refusals-- > 0 ? refusal : user[2])]])
    return Effect.gen(function* () {
      const connections = yield* Connections
      const instance = yield* Instance
      const connection = yield* connections.connectToken({ product: 'github', token: 'ghp_t', actorId: instance.personId })
      refusals = 1
      const host = yield* codeHost(connection.id)
      assert.strictEqual((yield* host.account).login, 'you')
      // Connecting, the call refused, the second look, and the call made again.
      assert.lengthOf(sent, 4)
      assert.strictEqual((yield* connections.list)[0]?.state, 'ready')
      assert.deepStrictEqual(
        (yield* factsOf(connection.id)).map((fact) => fact.type),
        ['connection.added'],
      )
    }).pipe(Effect.provide(withGitHub(fetch)))
  })

  it.live('is looked at once, however many calls were refused together', () => {
    // GitHub refuses for a moment, until it is asked who the token is for.
    let blip = false
    let refused = 0
    const base = stub([
      [
        'GET',
        USER,
        () => {
          blip = false
          return user[2]
        },
      ],
      [
        'GET',
        REPO,
        () => {
          if (!blip) return { json: { id: 7, full_name: 'meridian/api', default_branch: 'main', html_url: `${GITHUB}/meridian/api` } }
          refused += 1
          return refusal
        },
      ],
    ])
    // The five calls reach GitHub together, and each is refused before Althar hears of any.
    const waiting: Array<() => void> = []
    const fetch: Fetch = async (url, init) => {
      if (url === REPO && blip)
        await new Promise<void>((resolve) => {
          waiting.push(resolve)
          if (waiting.length === 5) for (const go of waiting) go()
        })
      return base.fetch(url, init)
    }
    return Effect.gen(function* () {
      const connections = yield* Connections
      const instance = yield* Instance
      const connection = yield* connections.connectToken({ product: 'github', token: 'ghp_t', actorId: instance.personId })
      blip = true
      const host = yield* codeHost(connection.id)
      const found = yield* Effect.all(
        Array.from({ length: 5 }, () => host.repository(['meridian', 'api'])),
        { concurrency: 'unbounded' },
      )
      assert.deepStrictEqual(
        found.map((repository) => repository.path.join('/')),
        Array.from({ length: 5 }, () => 'meridian/api'),
      )
      assert.strictEqual(refused, 5)
      // Asked who the token is for on connecting, and once more for the five.
      assert.lengthOf(
        base.sent.filter((request) => request.url === USER),
        2,
      )
      assert.strictEqual((yield* connections.list)[0]?.state, 'ready')
    }).pipe(Effect.provide(withGitHub(fetch)))
  })

  it.live('takes gh’s sign-in again by itself when gh replaced the token it copied; signed out of gh too, it says so', () => {
    const valid = new Set(['gho_first'])
    let gh: string | null = 'gho_first'
    const { fetch } = stub([takes(valid)])
    const cliToken = (tool: 'gh' | 'glab', host: string) => Effect.sync(() => (tool === 'gh' && host === 'github.com' ? gh : null))
    return Effect.gen(function* () {
      const connections = yield* Connections
      const instance = yield* Instance
      const connection = yield* connections.connectCli({ product: 'github', webUrl: GITHUB, actorId: instance.personId })
      const host = yield* codeHost(connection.id)

      // gh signed in again: a new token, and GitHub let the old one go. The call goes through with gh's new one.
      gh = 'gho_second'
      valid.clear()
      valid.add('gho_second')
      assert.strictEqual((yield* host.account).login, 'you')
      assert.strictEqual(yield* tokenOf(connection.id), 'gho_second')
      assert.strictEqual((yield* connections.list)[0]?.state, 'ready')
      const renewed = (yield* factsOf(connection.id)).at(-1)
      assert.deepInclude(renewed, { type: 'connection.renewed', actorId: instance.systemId })
      assert.deepStrictEqual(JSON.parse(renewed?.payload ?? '{}'), { product: 'github', auth: 'token', cli: 'gh' })

      // Signed out of gh, and the token let go: the connection needs signing in again, and says gh had none.
      gh = null
      valid.clear()
      assert.strictEqual((yield* Effect.flip(host.account)).reason, 'unauthorized')
      assert.strictEqual((yield* connections.list)[0]?.state, 'reauth_required')
      const out = (yield* factsOf(connection.id)).at(-1)
      assert.strictEqual(out?.type, 'connection.reauth_required')
      assert.deepInclude(JSON.parse(out?.payload ?? '{}'), { cli: { tool: 'gh', said: 'signed_out' } })

      // Publishing, or trying again, once gh is signed in again: the connection takes gh's sign-in, and reaches the repository.
      gh = 'gho_third'
      valid.add('gho_third')
      const remotes = ['git@github.com:meridian/api.git']
      assert.isNull(yield* connections.hostOf(remotes))
      assert.strictEqual((yield* connections.hostOf(remotes, { fromCli: true }))?.connectionId, connection.id)
      assert.strictEqual((yield* connections.list)[0]?.state, 'ready')
      assert.strictEqual(yield* tokenOf(connection.id), 'gho_third')
    }).pipe(Effect.provide(withGitHub(fetch, { cliToken })))
  })

  it.live('knows a connection made with gh before Althar noted it by its token, and never puts gh’s in place of a pasted one', () => {
    const valid = new Set(['gho_pasted', 'gho_before', 'gho_now'])
    const asked: Array<string> = []
    const { fetch } = stub([takes(valid)])
    const cliToken = (tool: 'gh' | 'glab', host: string) =>
      Effect.sync(() => {
        asked.push(`${tool} ${host}`)
        return 'gho_now'
      })
    return Effect.gen(function* () {
      const connections = yield* Connections
      const instance = yield* Instance
      const sql = yield* SqlClient.SqlClient
      const cliOf = (id: string) =>
        Effect.map(sql<{ cli: string | null }>`SELECT cli FROM connections WHERE id = ${id}`, ([row]) => row?.cli)

      // A token the person pasted, gh's own among them, let go: gh isn't asked, and its token doesn't take the pasted one's place.
      const pasted = yield* connections.connectToken({ product: 'github', token: 'gho_pasted', actorId: instance.personId })
      assert.strictEqual(yield* cliOf(pasted.id), 'none')
      valid.delete('gho_pasted')
      assert.strictEqual((yield* Effect.flip((yield* codeHost(pasted.id)).account)).reason, 'unauthorized')
      assert.deepStrictEqual(asked, [])
      assert.strictEqual(yield* tokenOf(pasted.id), 'gho_pasted')
      assert.strictEqual((yield* connections.list)[0]?.state, 'reauth_required')

      // gh's token, copied before Althar noted where its connections' tokens came from: gh's new one takes its place, and Althar notes it now.
      const before = yield* connections.connectToken({ product: 'github', token: 'gho_before', actorId: instance.personId })
      yield* sql`UPDATE connections SET cli = NULL WHERE id = ${before.id}`
      valid.delete('gho_before')
      assert.strictEqual((yield* (yield* codeHost(before.id)).account).login, 'you')
      assert.deepStrictEqual(asked, ['gh github.com'])
      assert.strictEqual(yield* tokenOf(before.id), 'gho_now')
      assert.strictEqual(yield* cliOf(before.id), 'gh')
    }).pipe(Effect.provide(withGitHub(fetch, { cliToken })))
  })

  it.live('is ready again on publishing with gh’s token, the same one, once GitHub takes it again', () => {
    const valid = new Set(['gho_same'])
    const { fetch } = stub([takes(valid)])
    const cliToken = () => Effect.succeed('gho_same')
    return Effect.gen(function* () {
      const connections = yield* Connections
      const instance = yield* Instance
      const connection = yield* connections.connectCli({ product: 'github', webUrl: GITHUB, actorId: instance.personId })

      // GitHub refused gh's token for a while, on the second look too: the connection needs signing in again, though gh has the same.
      valid.clear()
      assert.strictEqual((yield* Effect.flip((yield* codeHost(connection.id)).account)).reason, 'unauthorized')
      const out = (yield* factsOf(connection.id)).at(-1)
      assert.deepInclude(JSON.parse(out?.payload ?? '{}'), { cli: { tool: 'gh', said: 'same_token' } })

      // GitHub takes it again: trying the publish again finds the connection ready, with the token it had.
      valid.add('gho_same')
      const found = yield* connections.hostOf(['git@github.com:meridian/api.git'], { fromCli: true })
      assert.strictEqual(found?.connectionId, connection.id)
      assert.strictEqual((yield* connections.list)[0]?.state, 'ready')
      assert.strictEqual(yield* tokenOf(connection.id), 'gho_same')
      assert.strictEqual((yield* factsOf(connection.id)).at(-1)?.type, 'connection.renewed')
    }).pipe(Effect.provide(withGitHub(fetch, { cliToken })))
  })

  it.live('stays as it is while gh doesn’t answer, and asks gh again before taking it as signed out', () => {
    const valid = new Set(['gho_first'])
    const { fetch } = stub([takes(valid)])
    const answers: Array<Effect.Effect<string | null, CliUnanswered>> = [Effect.succeed('gho_first')]
    let asked = 0
    const cliToken = () =>
      Effect.suspend(() => {
        asked += 1
        return answers.shift() ?? Effect.succeed(null)
      })
    return Effect.gen(function* () {
      const connections = yield* Connections
      const instance = yield* Instance
      const connection = yield* connections.connectCli({ product: 'github', webUrl: GITHUB, actorId: instance.personId })
      const host = yield* codeHost(connection.id)

      // GitHub lets the token go, and gh times out: Althar can't tell, and the call is one to try again.
      valid.clear()
      answers.push(Effect.fail(new CliUnanswered({ tool: 'gh', message: 'gh didn’t answer (SIGTERM)' })))
      assert.strictEqual((yield* Effect.flip(host.account)).reason, 'unreachable')
      assert.strictEqual((yield* connections.list)[0]?.state, 'ready')
      assert.notInclude(
        (yield* factsOf(connection.id)).map((fact) => fact.type),
        'connection.reauth_required',
      )

      // gh says it has none, as it does when its keychain is slow, and has a new one a moment later: taken, without the person.
      valid.add('gho_second')
      asked = 0
      answers.push(Effect.succeed(null), Effect.succeed('gho_second'))
      assert.strictEqual((yield* host.account).login, 'you')
      assert.strictEqual(asked, 2)
      assert.strictEqual(yield* tokenOf(connection.id), 'gho_second')
      assert.strictEqual((yield* connections.list)[0]?.state, 'ready')
    }).pipe(Effect.provide(withGitHub(fetch, { cliToken })))
  })

  it.live('leaves a connection signed in again while Althar looked at it ready, and makes the call with the new token', () => {
    const valid = new Set(['ghp_new'])
    const base = stub([takes(valid)])
    // Connecting, the call GitHub refuses, and the second look, which waits.
    const github = held(base.fetch, 'ghp_old', 3)
    return Effect.gen(function* () {
      const connections = yield* Connections
      const instance = yield* Instance
      valid.add('ghp_old')
      const connection = yield* connections.connectToken({ product: 'github', token: 'ghp_old', actorId: instance.personId })
      valid.delete('ghp_old')
      const call = yield* Effect.forkChild((yield* codeHost(connection.id)).account)
      yield* github.arrived

      // The person signs it in again meanwhile; then GitHub refuses the old token on the second look too.
      yield* connections.connectToken({ product: 'github', token: 'ghp_new', connectionId: connection.id, actorId: instance.personId })
      github.release()
      assert.strictEqual((yield* Fiber.join(call)).login, 'you')
      assert.strictEqual((yield* connections.list)[0]?.state, 'ready')
      assert.strictEqual(yield* tokenOf(connection.id), 'ghp_new')
      assert.deepStrictEqual(
        (yield* factsOf(connection.id)).map((fact) => fact.type),
        ['connection.added', 'connection.renewed'],
      )
    }).pipe(Effect.provide(withGitHub(github.fetch)))
  })

  it.live('leaves a connection removed while Althar looked at it removed, gh’s sign-in taking nothing over', () => {
    const valid = new Set(['gho_first', 'gho_second'])
    let gh = 'gho_first'
    const base = stub([takes(valid)])
    const github = held(base.fetch, 'gho_first', 3)
    return Effect.gen(function* () {
      const connections = yield* Connections
      const instance = yield* Instance
      const sql = yield* SqlClient.SqlClient
      const connection = yield* connections.connectCli({ product: 'github', webUrl: GITHUB, actorId: instance.personId })
      valid.delete('gho_first')
      gh = 'gho_second'
      const call = yield* Effect.forkChild((yield* codeHost(connection.id)).account)
      yield* github.arrived

      // The person removes it meanwhile; then GitHub refuses the old token, and gh has a new one, which goes nowhere.
      yield* connections.remove(connection.id, instance.personId)
      github.release()
      yield* Effect.flip(Fiber.join(call))
      assert.deepStrictEqual(yield* connections.list, [])
      assert.deepStrictEqual(yield* sql<{ state: string }>`SELECT state FROM connections`, [{ state: 'removed' }])
      assert.isUndefined(yield* tokenOf(connection.id))
      assert.deepStrictEqual(
        (yield* factsOf(connection.id)).map((fact) => fact.type),
        ['connection.added', 'connection.removed'],
      )
    }).pipe(Effect.provide(withGitHub(github.fetch, { cliToken: () => Effect.sync(() => gh) })))
  })

  it.live('keeps the token its person signs in with while gh’s was on its way to the keychain, not gh’s over it', () => {
    const valid = new Set(['gho_first', 'gho_second', 'ghp_person'])
    let gh = 'gho_first'
    const { fetch } = stub([takes(valid)])
    const write = heldWrite('gho_second')
    return Effect.gen(function* () {
      const connections = yield* Connections
      const instance = yield* Instance
      const sql = yield* SqlClient.SqlClient
      const connection = yield* connections.connectCli({ product: 'github', webUrl: GITHUB, actorId: instance.personId })
      valid.delete('gho_first')
      gh = 'gho_second'
      const call = yield* Effect.forkChild((yield* codeHost(connection.id)).account)
      yield* write.arrived

      // The person signs it in again while gh's new token is being kept: time enough to finish, were it not to wait for that.
      const again = yield* Effect.forkChild(
        connections.connectToken({ product: 'github', token: 'ghp_person', connectionId: connection.id, actorId: instance.personId }),
      )
      yield* Effect.sleep('200 millis')
      write.release()
      yield* Fiber.join(again)
      assert.strictEqual((yield* Fiber.join(call)).login, 'you')
      assert.strictEqual(yield* tokenOf(connection.id), 'ghp_person')
      assert.strictEqual((yield* connections.list)[0]?.state, 'ready')
      assert.deepStrictEqual(yield* sql<{ cli: string }>`SELECT cli FROM connections`, [{ cli: 'none' }])
      assert.deepStrictEqual(
        (yield* factsOf(connection.id)).map((fact) => fact.type),
        ['connection.added', 'connection.renewed', 'connection.renewed'],
      )
    }).pipe(Effect.provide(withGitHub(fetch, { cliToken: () => Effect.sync(() => gh), secrets: write.secrets })))
  })

  it.live('leaves a connection removed while gh’s token was on its way to the keychain removed, with no token kept', () => {
    const valid = new Set(['gho_first', 'gho_second'])
    let gh = 'gho_first'
    const { fetch } = stub([takes(valid)])
    const write = heldWrite('gho_second')
    return Effect.gen(function* () {
      const connections = yield* Connections
      const instance = yield* Instance
      const sql = yield* SqlClient.SqlClient
      const connection = yield* connections.connectCli({ product: 'github', webUrl: GITHUB, actorId: instance.personId })
      valid.delete('gho_first')
      gh = 'gho_second'
      const call = yield* Effect.forkChild((yield* codeHost(connection.id)).account)
      yield* write.arrived

      // The person removes it while gh's new token is being kept: time enough to finish, were it not to wait for that.
      const removing = yield* Effect.forkChild(connections.remove(connection.id, instance.personId))
      yield* Effect.sleep('200 millis')
      write.release()
      yield* Fiber.join(removing)
      yield* Fiber.await(call)
      assert.deepStrictEqual(yield* connections.list, [])
      assert.deepStrictEqual(yield* sql<{ state: string }>`SELECT state FROM connections`, [{ state: 'removed' }])
      assert.isUndefined(yield* tokenOf(connection.id))
      assert.strictEqual((yield* factsOf(connection.id)).at(-1)?.type, 'connection.removed')
    }).pipe(Effect.provide(withGitHub(fetch, { cliToken: () => Effect.sync(() => gh), secrets: write.secrets })))
  })
})

describe('a repository’s page on its code host', () => {
  it('is read under the instance’s own path, and on Bitbucket Data Center as a project’s repository or a person’s own', () => {
    assert.deepStrictEqual(pageOf('github', 'https://github.com', ['meridian', 'api']), {
      path: ['meridian', 'api'],
      url: 'https://github.com/meridian/api',
    })
    assert.deepStrictEqual(pageOf('gitlab', 'https://example.org/git/', ['git', 'ops', 'infra', 'deploy']), {
      path: ['ops', 'infra', 'deploy'],
      url: 'https://example.org/git/ops/infra/deploy',
    })
    // Over SSH, and over HTTPS, under the server's own path.
    assert.deepStrictEqual(pageOf('bitbucket_dc', 'https://example.org', ['prj', 'api']), {
      path: ['prj', 'api'],
      url: 'https://example.org/projects/PRJ/repos/api',
    })
    assert.strictEqual(
      pageOf('bitbucket_dc', 'https://example.org/bitbucket', ['bitbucket', 'scm', 'prj', 'api']).url,
      'https://example.org/bitbucket/projects/PRJ/repos/api',
    )
    assert.strictEqual(pageOf('bitbucket_dc', 'https://example.org', ['~me', 'notes']).url, 'https://example.org/users/me/repos/notes')
    // An address that isn't one keeps the path whole.
    assert.strictEqual(pageOf('gitlab', 'not an address', ['ops', 'infra']).url, 'not an address/ops/infra')
  })
})

describe('a Jira Cloud site', () => {
  it.live('is kept by its origin, whatever page of it was pasted', () => {
    const jira = makeFakeService({ product: 'jira_cloud' })
    return Effect.gen(function* () {
      const connections = yield* Connections
      const instance = yield* Instance
      const connection = yield* connections.connectToken({
        product: 'jira_cloud',
        webUrl: 'https://meridian.atlassian.net/jira/software/projects/PAY/boards/3',
        user: 'you@meridian.dev',
        token: 't',
        actorId: instance.personId,
      })
      assert.strictEqual(connection.webUrl, 'https://meridian.atlassian.net')
      assert.strictEqual((yield* connections.resolve('https://meridian.atlassian.net/browse/PAY-1'))?.connectionId, connection.id)
    }).pipe(
      Effect.provide(
        Runtime.layer({
          database: ':memory:',
          worktreeRoot: mkdtempSync(join(tmpdir(), 'althar-worktrees-')),
          appVersion: '0.0.0-test',
          deviceName: 'Test Mac',
          agents: fakeAgents(),
          secrets: Secrets.memory(),
          connectors: Layer.succeed(
            Connectors,
            Connectors.of({
              products: [{ ...products.jira_cloud, make: () => ({ tracker: jira }) }],
              fetch: () => Promise.reject(new Error('No network in tests')),
              clientIds: {},
              callbackPort: 0,
              cliToken: () => Effect.succeed(null),
            }),
          ),
        }),
      ),
    )
  })
})

describe('the network code hosts are called over', () => {
  it.effect('is the one the app gives, and Node’s without one', () =>
    Effect.gen(function* () {
      const app: Fetch = () => Promise.resolve(new Response('{}'))
      const read = (layer: Layer.Layer<Connectors>) =>
        Effect.provide(
          Effect.gen(function* () {
            return (yield* Connectors).fetch
          }),
          layer,
        )
      assert.strictEqual(yield* read(Connectors.live({}, app)), app)
      assert.strictEqual(yield* read(Connectors.live()), globalThis.fetch)
    }),
  )
})

describe('where sign-ins are kept', () => {
  /** A stand-in for the app's main process: it seals by reversing the bytes, and can be told to refuse. */
  const sealer = (refuse = false): Sealer => ({
    seal: (value) =>
      refuse
        ? Effect.fail(new SecretsUnavailable({ reason: 'The app didn’t answer.' }))
        : Effect.succeed(Buffer.from(value).reverse().toString('base64')),
    open: (sealed) =>
      refuse
        ? Effect.fail(new SecretsUnavailable({ reason: 'The app didn’t answer.' }))
        : Effect.succeed(Buffer.from(sealed, 'base64').reverse().toString('utf8')),
  })

  it.effect('seals each in a file of its own that only this user can read, and opens it again', () => {
    const folder = join(mkdtempSync(join(tmpdir(), 'althar-secrets-')), 'secrets')
    return Effect.gen(function* () {
      const secrets = yield* Secrets
      assert.isNull(yield* secrets.get('conn_1'))
      yield* secrets.set('conn_1', '{"token":"ghp secret"}')
      yield* secrets.set('conn_1', '{"token":"ghp newer"}')
      assert.strictEqual(yield* secrets.get('conn_1'), '{"token":"ghp newer"}')
      // What is on disk is sealed, and only this user may read it.
      assert.notInclude(readFileSync(join(folder, 'conn_1'), 'utf8'), 'ghp')
      assert.strictEqual(statSync(join(folder, 'conn_1')).mode & 0o777, 0o600)
      assert.strictEqual(statSync(folder).mode & 0o777, 0o700)
      assert.deepStrictEqual(readdirSync(folder), ['conn_1'])
      yield* secrets.remove('conn_1')
      yield* secrets.remove('conn_1')
      assert.isNull(yield* secrets.get('conn_1'))
      // A name is one of Althar's ids, never a path.
      assert.strictEqual((yield* Effect.flip(secrets.set('../conn_1', 'x'))).reason, "Not a secret's name: ../conn_1")
      assert.strictEqual((yield* Effect.flip(secrets.get('.next'))).reason, "Not a secret's name: .next")
    }).pipe(Effect.provide(Secrets.sealed(folder, sealer())))
  })

  const secretsOf = (layer: Layer.Layer<Secrets>) =>
    Effect.provide(
      Effect.gen(function* () {
        return yield* Secrets
      }),
      layer,
    )

  it.live('says why, when the app can’t seal or open one, or the folder can’t be written', () => {
    const root = mkdtempSync(join(tmpdir(), 'althar-secrets-'))
    writeFileSync(join(root, 'conn_1'), 'sealed')
    return Effect.gen(function* () {
      const refusing = yield* secretsOf(Secrets.sealed(root, sealer(true)))
      assert.strictEqual((yield* Effect.flip(refusing.set('conn_1', 'x'))).reason, 'The app didn’t answer.')
      assert.strictEqual((yield* Effect.flip(refusing.get('conn_1'))).reason, 'The app didn’t answer.')
      // A file where its folder should be.
      const blocked = yield* secretsOf(Secrets.sealed(join(root, 'conn_1'), sealer()))
      assert.match((yield* Effect.flip(blocked.set('conn_2', 'x'))).reason, /^Couldn't keep the secret/)
      assert.match((yield* Effect.flip(blocked.get('conn_2'))).reason, /^Couldn't read the secret/)
    })
  })

  it.live('tries again, a moment apart, when the app is too busy to seal or open one, but not where there is no keyring', () => {
    const folder = join(mkdtempSync(join(tmpdir(), 'althar-secrets-')), 'secrets')
    // The app, busy for as many asks as the test says, then answering; or with no keyring at all.
    let busy = 0
    let keyring = true
    let unreadable = false
    let asked = 0
    const unanswered = () => Effect.fail(new SecretsUnavailable({ reason: 'Althar’s keychain didn’t answer.' }))
    const none = () => Effect.fail(new SecretsUnavailable({ reason: 'Install and start a keyring.', keyring: true }))
    const gone = () => Effect.fail(new SecretsUnavailable({ reason: 'Error while decrypting the ciphertext.', unreadable: true }))
    const answer = <A>(then: () => Effect.Effect<A, SecretsUnavailable>) =>
      Effect.suspend(() => {
        asked += 1
        return !keyring ? none() : unreadable ? gone() : busy-- > 0 ? unanswered() : then()
      })
    const flaky: Sealer = {
      seal: (value) => answer(() => sealer().seal(value)),
      open: (sealed) => answer(() => sealer().open(sealed)),
    }
    return Effect.gen(function* () {
      const secrets = yield* Secrets
      busy = 2
      yield* secrets.set('conn_1', '{"token":"ghp secret"}')
      busy = 2
      assert.strictEqual(yield* secrets.get('conn_1'), '{"token":"ghp secret"}')
      // Busy for longer than that, it says so.
      busy = 3
      assert.strictEqual((yield* Effect.flip(secrets.get('conn_1'))).reason, 'Althar’s keychain didn’t answer.')
      // A secret the keychain can't open any more is lost, not late: asked once, and said at once.
      unreadable = true
      asked = 0
      assert.deepInclude(yield* Effect.flip(secrets.get('conn_1')), { unreadable: true })
      assert.strictEqual(asked, 1)
      unreadable = false
      // No keyring to keep it: asked once, and said at once.
      keyring = false
      asked = 0
      assert.deepInclude(yield* Effect.flip(secrets.set('conn_2', 'x')), { reason: 'Install and start a keyring.', keyring: true })
      assert.strictEqual(asked, 1)
    }).pipe(Effect.provide(Secrets.sealed(folder, flaky)))
  })

  it.effect('in the command-line client, keeps none, and says why', () =>
    Effect.gen(function* () {
      const secrets = yield* Secrets
      assert.strictEqual((yield* Effect.flip(secrets.set('conn_1', 'x'))).reason, 'Kept by the app.')
      assert.strictEqual((yield* Effect.flip(secrets.get('conn_1'))).reason, 'Kept by the app.')
      yield* secrets.remove('conn_1')
    }).pipe(Effect.provide(Secrets.none('Kept by the app.'))),
  )
})

describe('the agents', () => {
  it.effect('run without the person’s sign-ins to gh, glab, or git', () =>
    Effect.gen(function* () {
      const agents = yield* Agents
      const transport = agents.list[0]?.transport('/w')
      const env = transport?._tag === 'Process' ? (transport.spec.env ?? {}) : {}
      assert.isTrue(existsSync(env.GH_CONFIG_DIR ?? ''))
      assert.strictEqual(env.GLAB_CONFIG_DIR, env.GH_CONFIG_DIR)
      assert.deepInclude(env, {
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'credential.helper',
        GIT_CONFIG_VALUE_0: '',
        GIT_TERMINAL_PROMPT: '0',
      })
    }).pipe(Effect.provide(Layer.sync(Agents, () => Agents.fromRegistry()))),
  )

  it.effect('run without the MCP servers the person set up for Codex, in the account’s home or the repository', () =>
    Effect.gen(function* () {
      const agents = yield* Agents
      const home = mkdtempSync(join(tmpdir(), 'althar-codex-home-'))
      writeFileSync(join(home, 'config.toml'), '[mcp_servers.github]\ncommand = "npx"\n')
      const codex = agents.list.find((entry) => entry.definition.id === 'codex')
      const transport = codex?.transport(mkdtempSync(join(tmpdir(), 'althar-cwd-')), { CODEX_HOME: home })
      const env = transport?._tag === 'Process' ? (transport.spec.env ?? {}) : {}
      assert.deepStrictEqual(JSON.parse(env.CODEX_CONFIG ?? '{}'), {
        'mcp_servers.github.command': 'npx',
        'mcp_servers.github.enabled': false,
      })
      assert.strictEqual(env.CODEX_HOME, home)
    }).pipe(Effect.provide(Layer.sync(Agents, () => Agents.fromRegistry()))),
  )

  it.effect('start a review’s lead with nothing of the repository’s config loading, each as its registry entry says', () =>
    Effect.gen(function* () {
      const agents = yield* Agents
      const cwd = mkdtempSync(join(tmpdir(), 'althar-cwd-'))
      const envOf = (agentId: string, untrusted: boolean) => {
        const transport = agents.list
          .find((entry) => entry.definition.id === agentId)
          ?.transport(cwd, { CODEX_HOME: mkdtempSync(join(tmpdir(), 'althar-codex-home-')) }, untrusted ? { untrusted } : undefined)
        return transport?._tag === 'Process' ? (transport.spec.env ?? {}) : {}
      }
      for (const agentId of ['claude-code', 'codex', 'opencode']) {
        // Git's credential helper stays reset beside it.
        assert.deepInclude(envOf(agentId, true), { ...readingUntrusted, GIT_CONFIG_KEY_0: 'credential.helper', GIT_CONFIG_VALUE_0: '' })
        assert.strictEqual(envOf(agentId, false).GIT_CONFIG_COUNT, '1')
      }
      assert.deepStrictEqual(JSON.parse(envOf('codex', true).CODEX_CONFIG ?? '{}'), { web_search: 'disabled', 'features.hooks': false })
      assert.isUndefined(envOf('codex', false).CODEX_CONFIG)
      assert.strictEqual(envOf('opencode', true).OPENCODE_DISABLE_PROJECT_CONFIG, '1')
      assert.isFalse(JSON.parse(envOf('opencode', true).OPENCODE_CONFIG_CONTENT ?? '{}').lsp)
      assert.isUndefined(envOf('opencode', false).OPENCODE_DISABLE_PROJECT_CONFIG)
    }).pipe(Effect.provide(Layer.sync(Agents, () => Agents.fromRegistry()))),
  )

  it('leave a review’s lead’s git out of a bare repository the pull request carries, unless it is named', () => {
    // A repository a pull request could carry under any name, whose config names a program for git to run.
    const folder = mkdtempSync(join(tmpdir(), 'althar-carried-'))
    spawnSync('git', ['init', '-q', '--bare', 'fixtures.git'], { cwd: folder })
    const git = (env: Readonly<Record<string, string>>) =>
      spawnSync('git', ['-C', 'fixtures.git', 'rev-parse', '--git-dir'], {
        cwd: folder,
        env: { PATH: process.env.PATH ?? '', HOME: folder, GIT_CONFIG_NOSYSTEM: '1', ...withoutSignIns(folder), ...env },
      })
    assert.strictEqual(git({}).status, 0)
    const refused = git(readingUntrusted)
    assert.notStrictEqual(refused.status, 0)
    assert.include(refused.stderr.toString(), 'safe.bareRepository')
  })

  it('leave git with no credential helper to ask, whatever the person set', () => {
    // The person's git hands out a password to whoever asks. The system's config is left out, so the real keychain isn't asked.
    const home = mkdtempSync(join(tmpdir(), 'althar-home-'))
    writeFileSync(join(home, '.gitconfig'), '[credential]\n\thelper = "!f() { echo username=dana; echo password=leaked; }; f"\n')
    const fill = (env: Readonly<Record<string, string>>) =>
      spawnSync('git', ['credential', 'fill'], {
        input: 'protocol=https\nhost=github.com\n\n',
        env: { PATH: process.env.PATH ?? '', HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', ...env },
      }).stdout.toString()
    assert.include(fill({}), 'password=leaked')
    assert.notInclude(fill(withoutSignIns(home)), 'leaked')
  })
})
