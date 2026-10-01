import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type Fetch, products } from '@charrette/connectors'
import { makeFakeService } from '@charrette/connectors/testing'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Agents, Connectors } from '../src/Config'
import { Connections, NotConnected, SignInUnavailable } from '../src/Connections'
import { NotFound } from '../src/errors'
import { Instance } from '../src/Instance'
import * as Runtime from '../src/Runtime'
import { Secrets } from '../src/Secrets'
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
type Route = readonly [method: string, url: string, answer: Answer | ((body: Record<string, string>) => Answer)]

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
    const answer = typeof route[2] === 'function' ? route[2](body) : route[2]
    return new Response(JSON.stringify(answer.json ?? {}), { status: answer.status ?? 200 })
  }
  return { fetch, sent }
}

/** The runtime with GitHub's real adapter over `fetch`, and Linear answered by a fake. */
const withGitHub = (fetch: Fetch, more: { readonly callbackPort?: number; readonly linear?: ReturnType<typeof makeFakeService> } = {}) =>
  Runtime.layer({
    database: ':memory:',
    worktreeRoot: mkdtempSync(join(tmpdir(), 'charrette-worktrees-')),
    appVersion: '0.0.0-test',
    deviceName: 'Test Mac',
    agents: fakeAgents(),
    secrets: Secrets.memory(),
    connectors: Layer.succeed(
      Connectors,
      Connectors.of({
        products: [products.github, { ...products.linear, make: () => (more.linear === undefined ? {} : { tracker: more.linear }) }],
        fetch,
        clientIds: { github: 'Iv1.charrette', linear: 'lin-charrette' },
        callbackPort: more.callbackPort ?? 0,
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
        client_id: 'Iv1.charrette',
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
      assert.deepInclude(sent[0]?.body, { code: 'the-code', grant_type: 'authorization_code', client_id: 'lin-charrette' })
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

  it.live('needs signing in again when the service refuses its token', () => {
    let refused = false
    const { fetch } = stub([
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
      const [fact] = yield* sql<{
        type: string
      }>`SELECT type FROM record_events WHERE aggregate_type = 'connection' ORDER BY sequence DESC LIMIT 1`
      assert.strictEqual(fact?.type, 'connection.reauth_required')
      // Signed in again, it is ready.
      refused = false
      yield* connections.connectToken({ product: 'github', token: 't2', actorId: instance.personId })
      assert.strictEqual((yield* connections.list)[0]?.state, 'ready')
    }).pipe(Effect.provide(withGitHub(fetch)))
  })

  it.live('offers the browser sign-in only where Charrette’s app is registered', () => {
    const github = makeFakeService()
    return Effect.gen(function* () {
      const connections = yield* Connections
      const instance = yield* Instance
      assert.deepStrictEqual(
        connections.products.map((info) => [info.product, info.browserSignIn]),
        [
          ['github', false],
          ['linear', false],
        ],
      )
      assert.instanceOf(yield* Effect.flip(connections.startSignIn({ product: 'github', actorId: instance.personId })), SignInUnavailable)
      // A product without an adapter can't be connected.
      assert.instanceOf(
        yield* Effect.flip(connections.connectToken({ product: 'trello', token: 't', actorId: instance.personId })),
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
      assert.isNull(yield* connections.resolve('https://example.com/x'))
      assert.strictEqual((yield* connections.resolve('https://git.meridian.dev/meridian/api/pull/3'))?.ref.kind, 'change')
      assert.lengthOf(yield* connections.trackers, 1)
    }).pipe(
      Effect.provide(
        Runtime.layer({
          database: ':memory:',
          worktreeRoot: mkdtempSync(join(tmpdir(), 'charrette-worktrees-')),
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

describe('the keychain', () => {
  /** `security`, as a script that keeps items in a file, on a PATH of its own. */
  const fakeSecurity = () => {
    const bin = mkdtempSync(join(tmpdir(), 'charrette-security-'))
    const store = join(bin, 'items')
    writeFileSync(
      join(bin, 'security'),
      `#!/bin/sh
store="${store}"
touch "$store"
case "$1" in
  -i)
    read -r line
    echo "$line" >> "${join(bin, 'stdin')}"
    set -- $line
    shift; account=""; value=""
    while [ $# -gt 0 ]; do case "$1" in -a) account="$2"; shift 2;; -w) value="$2"; shift 2;; *) shift;; esac; done
    if [ "$account" = "locked" ]; then echo "The keychain is locked." >&2; exit 0; fi
    if [ "$account" = "silent" ]; then exit 3; fi
    grep -v "^$account " "$store" > "$store.new"; mv "$store.new" "$store"; echo "$account $value" >> "$store" ;;
  find-generic-password)
    if [ "$5" = "locked" ]; then echo "The keychain is locked." >&2; exit 51; fi
    if [ "$5" = "silent" ]; then exit 2; fi
    found=$(grep "^$5 " "$store" | cut -d' ' -f2)
    if [ -z "$found" ]; then echo "not found" >&2; exit 44; fi
    echo "$found" ;;
  delete-generic-password)
    if [ "$5" = "locked" ]; then echo "The keychain is locked." >&2; exit 51; fi
    if [ "$5" = "silent" ]; then exit 2; fi
    grep -q "^$5 " "$store" || exit 44
    grep -v "^$5 " "$store" > "$store.new"; mv "$store.new" "$store" ;;
esac
`,
    )
    chmodSync(join(bin, 'security'), 0o755)
    return bin
  }

  it.live('keeps a secret in macOS’s keychain through `security`, never in its arguments', () => {
    const bin = fakeSecurity()
    const path = process.env.PATH
    process.env.PATH = `${bin}:${path ?? ''}`
    return Effect.gen(function* () {
      const secrets = yield* Secrets
      yield* secrets.set('conn_1', '{"token":"ghp secret"}')
      assert.strictEqual(yield* secrets.get('conn_1'), '{"token":"ghp secret"}')
      assert.notInclude(readFileSync(join(bin, 'stdin'), 'utf8'), 'ghp secret', 'it goes base64, so it is one word')
      assert.isNull(yield* secrets.get('conn_2'))
      yield* secrets.remove('conn_1')
      yield* secrets.remove('conn_1')
      assert.isNull(yield* secrets.get('conn_1'))
      assert.strictEqual((yield* Effect.flip(secrets.set('not a name', 'x'))).reason, 'Not a keychain name: not a name')
      // A keychain that won't give or take says why.
      assert.strictEqual((yield* Effect.flip(secrets.set('locked', 'x'))).reason, 'The keychain is locked.')
      assert.strictEqual((yield* Effect.flip(secrets.get('locked'))).reason, 'The keychain is locked.')
      assert.strictEqual((yield* Effect.flip(secrets.remove('locked'))).reason, 'The keychain is locked.')
      // One that fails without a word still fails.
      assert.strictEqual((yield* Effect.flip(secrets.set('silent', 'x'))).reason, 'security exited 3')
      assert.match((yield* Effect.flip(secrets.get('silent'))).reason, /Command failed/)
      assert.match((yield* Effect.flip(secrets.remove('silent'))).reason, /Command failed/)
    }).pipe(Effect.provide(Secrets.keychainOn('darwin')), Effect.ensuring(Effect.sync(() => (process.env.PATH = path))))
  })

  it.effect('elsewhere, says there is no keychain yet', () =>
    Effect.gen(function* () {
      const secrets = yield* Secrets
      assert.strictEqual(
        (yield* Effect.flip(secrets.set('conn_1', 'x'))).reason,
        'Charrette keeps secrets in the macOS keychain, and this is not macOS.',
      )
      assert.isNull(yield* secrets.get('conn_1'))
      yield* secrets.remove('conn_1')
    }).pipe(Effect.provide(Secrets.keychainOn('linux'))),
  )
})

describe('the agents', () => {
  it.effect('run without the person’s sign-ins to gh and glab', () =>
    Effect.gen(function* () {
      const agents = yield* Agents
      const transport = agents.list[0]?.transport('/w')
      const env = transport?._tag === 'Process' ? (transport.spec.env ?? {}) : {}
      assert.isTrue(existsSync(env.GH_CONFIG_DIR ?? ''))
      assert.strictEqual(env.GLAB_CONFIG_DIR, env.GH_CONFIG_DIR)
    }).pipe(Effect.provide(Agents.registry)),
  )
})
