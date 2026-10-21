import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type Fetch, type ProductInfo, products } from '@althar/connectors'
import { makeFakeService } from '@althar/connectors/testing'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Connectors } from '../src/Config'
import { Connections } from '../src/Connections'
import type { CliUnanswered } from '../src/errors'
import { Instance } from '../src/Instance'
import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { Secrets, SecretsUnavailable } from '../src/Secrets'
import { fakeAgents, repository, until } from './support'

/*
 * A connection's sign-in as Althar keeps it working (docs/architecture/06,
 * "Signing in"): an expiring token renewed once for calls made together, or
 * not at all where this Althar can't; a refusal looked at again, and what
 * that look can't tell; gh's sign-in that can't take over; and sign-ins
 * that end without a connection, or sign one in again.
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

/** Secrets in a map the test holds, so two runtimes can share it, or look into it. */
const kept = (map = new Map<string, string>()) =>
  Layer.succeed(
    Secrets,
    Secrets.of({
      set: (name, value) => Effect.sync(() => void map.set(name, value)),
      get: (name) => Effect.sync(() => map.get(name) ?? null),
      remove: (name) => Effect.sync(() => void map.delete(name)),
    }),
  )

/** The runtime with GitHub's real adapter over `fetch`, Linear answered by a fake, and the app's registrations as the test says. */
const withGitHub = (
  fetch: Fetch,
  more: {
    readonly database?: string
    readonly secrets?: Layer.Layer<Secrets>
    readonly clientIds?: Readonly<Record<string, string>>
    readonly callbackPort?: number
    readonly linear?: ReturnType<typeof makeFakeService>
    readonly more?: ReadonlyArray<ProductInfo>
    readonly cliToken?: (tool: 'gh' | 'glab', host: string) => Effect.Effect<string | null, CliUnanswered>
    readonly appSlug?: string
  } = {},
) =>
  Runtime.layer({
    database: more.database ?? ':memory:',
    worktreeRoot: mkdtempSync(join(tmpdir(), 'althar-worktrees-')),
    appVersion: '0.0.0-test',
    deviceName: 'Test Mac',
    agents: fakeAgents(),
    secrets: more.secrets ?? kept(),
    connectors: Layer.succeed(
      Connectors,
      Connectors.of({
        products: [
          products.github,
          { ...products.linear, make: () => (more.linear === undefined ? {} : { tracker: more.linear }) },
          ...(more.more ?? []),
        ],
        fetch,
        clientIds: more.clientIds ?? { github: 'Iv1.althar', linear: 'lin-althar' },
        callbackPort: more.callbackPort ?? 0,
        cliToken: more.cliToken ?? (() => Effect.succeed(null)),
        ...(more.appSlug === undefined ? {} : { appSlug: more.appSlug }),
      }),
    ),
  })

const GITHUB = 'https://github.com'
const USER = 'https://api.github.com/user'
const TOKEN = `${GITHUB}/login/oauth/access_token`
const device = [
  'POST',
  `${GITHUB}/login/device/code`,
  { json: { device_code: 'dev', user_code: 'ABCD-1234', verification_uri: `${GITHUB}/login/device`, expires_in: 900, interval: 0 } },
] as const
const you = { json: { id: 5, login: 'you', name: 'You Person' } }
const refusal: Answer = { status: 401, json: { message: 'Bad credentials' } }

/** GitHub, taking only the tokens it hasn't let go of, and answering for others as the test says. */
const takes = (valid: ReadonlySet<string>, others: Readonly<Record<string, Answer>> = {}): Route => [
  'GET',
  USER,
  (_, authorization) => {
    const token = authorization?.replace(/^Bearer /, '') ?? ''
    return others[token] ?? (valid.has(token) ? you : refusal)
  },
]

/** Signs in to GitHub by its device flow, as the person does in the window: the connection it made. */
const signedIn = Effect.gen(function* () {
  const connections = yield* Connections
  const instance = yield* Instance
  const started = yield* connections.startSignIn({ product: 'github', actorId: instance.personId })
  yield* until(
    Effect.map(
      Effect.suspend(() => connections.signIn(started.flowId)),
      (state) => [state],
    ),
    ([state]) => state?.state !== 'waiting',
  )
  const [connection] = yield* connections.list
  return connection ?? (yield* Effect.die('No connection'))
})

const codeHost = (connectionId: string) =>
  Effect.gen(function* () {
    const { host } = yield* (yield* Connections).adapters(connectionId)
    return host ?? (yield* Effect.die('No code host'))
  })

const factsOf = (connectionId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ type: string; payload: string }>`
      SELECT type, payload FROM record_events WHERE aggregate_id = ${connectionId} ORDER BY sequence`
  })

const keptFor = (connectionId: string) =>
  Effect.gen(function* () {
    return JSON.parse((yield* (yield* Secrets).get(connectionId)) ?? '{}') as Record<string, unknown>
  })

const reasonOf = (error: unknown) => (error instanceof Error && 'reason' in error ? error.reason : String(error))

describe('an expiring sign-in', () => {
  it.live('is renewed once for calls made together, the others taking the token that renewal kept', () => {
    let tokens = 0
    const { fetch, sent } = stub([
      device,
      [
        'POST',
        TOKEN,
        (body) =>
          body.grant_type === 'refresh_token'
            ? { json: { access_token: 'ghu_renewed', refresh_token: 'ghr_2', expires_in: 28_800 } }
            : { json: { access_token: `ghu_first${(tokens += 1)}`, refresh_token: 'ghr_1', expires_in: 60 } },
      ],
      ['GET', USER, you],
    ])
    return Effect.gen(function* () {
      const connection = yield* signedIn
      const host = yield* codeHost(connection.id)
      const before = sent.length
      const found = yield* Effect.all([host.account, host.account, host.account], { concurrency: 'unbounded' })
      assert.deepStrictEqual(
        found.map((account) => account.login),
        ['you', 'you', 'you'],
      )
      assert.lengthOf(
        sent.filter((request) => request.body.grant_type === 'refresh_token'),
        1,
      )
      assert.deepStrictEqual(
        sent
          .slice(before)
          .filter((request) => request.url === USER)
          .map((request) => request.authorization),
        ['Bearer ghu_renewed', 'Bearer ghu_renewed', 'Bearer ghu_renewed'],
      )
      assert.deepInclude(yield* keptFor(connection.id), { accessToken: 'ghu_renewed', refreshToken: 'ghr_2' })
    }).pipe(Effect.provide(withGitHub(fetch)))
  })

  it.live('needs signing in again where this Althar has no registration to renew it with', () => {
    const { fetch, sent } = stub([
      device,
      ['POST', TOKEN, { json: { access_token: 'ghu_first', refresh_token: 'ghr_1', expires_in: 60 } }],
      ['GET', USER, you],
    ])
    const database = join(mkdtempSync(join(tmpdir(), 'althar-store-')), 'althar.db')
    const keychain = new Map<string, string>()
    return Effect.gen(function* () {
      // Signed in where Althar's app is registered.
      const id = yield* Effect.map(signedIn, (connection) => connection.id).pipe(
        Effect.provide(withGitHub(fetch, { database, secrets: kept(keychain) })),
      )
      // Opened again by an Althar without that registration, as the token runs out.
      yield* Effect.gen(function* () {
        const connections = yield* Connections
        const error = yield* Effect.flip((yield* codeHost(id)).account)
        assert.strictEqual(reasonOf(error), 'unauthorized')
        assert.strictEqual((yield* connections.list)[0]?.state, 'reauth_required')
        const said = { reason: 'unauthorized', status: null, message: 'The token expired and can’t be renewed here' }
        const fact = (yield* factsOf(id)).at(-1)
        assert.strictEqual(fact?.type, 'connection.reauth_required')
        assert.deepStrictEqual(JSON.parse(fact?.payload ?? '{}'), { product: 'github', refused: said, again: said, cli: null })
      }).pipe(Effect.provide(withGitHub(fetch, { database, secrets: kept(keychain), clientIds: {} })))
      assert.notInclude(
        sent.map((request) => request.body.grant_type),
        'refresh_token',
      )
    })
  })
})

describe('a sign-in in the browser', () => {
  const port = () => 43_000 + Math.floor(Math.random() * 2000)

  /** Linear's sign-in, the browser coming back with its code. */
  const backFromLinear = (at: number, connectionId?: string) =>
    Effect.gen(function* () {
      const connections = yield* Connections
      const instance = yield* Instance
      const started = yield* connections.startSignIn({
        product: 'linear',
        actorId: instance.personId,
        ...(connectionId === undefined ? {} : { connectionId }),
      })
      const url = new URL(started.kind === 'browser' ? started.url : '')
      yield* Effect.promise(() => globalThis.fetch(`http://127.0.0.1:${at}/callback?code=c&state=${url.searchParams.get('state') ?? ''}`))
      const [ended] = yield* until(
        Effect.map(
          Effect.suspend(() => connections.signIn(started.flowId)),
          (state) => [state],
        ),
        ([state]) => state?.state !== 'waiting',
      )
      return ended
    })

  it.live('renews a Linear token at Linear’s own address when a refused call is looked at again, and makes the call', () => {
    const at = port()
    const linear = makeFakeService({ product: 'linear', account: { id: 'u1', login: 'you', name: 'You' } })
    const { fetch, sent } = stub([
      [
        'POST',
        'https://api.linear.app/oauth/token',
        (body) =>
          body.grant_type === 'refresh_token'
            ? { json: { access_token: 'lin_renewed', refresh_token: 'lin_r2', expires_in: 86_400 } }
            : { json: { access_token: 'lin_first', refresh_token: 'lin_r1', expires_in: 60 } },
      ],
    ])
    return Effect.gen(function* () {
      const connections = yield* Connections
      assert.strictEqual((yield* backFromLinear(at))?.state, 'done')
      const [connection] = yield* connections.list
      const { tracker } = yield* connections.adapters(connection?.id ?? '')
      // Linear refuses the call once: the second look renews the token that was about to run out, and Linear takes it.
      linear.failNext('containers', 'unauthorized', undefined, 401)
      assert.deepStrictEqual(yield* tracker?.containers() ?? Effect.die('No tracker'), [])
      assert.deepStrictEqual(
        linear.calls.filter((call) => call === 'containers'),
        ['containers', 'containers'],
      )
      assert.deepInclude(
        sent.find((request) => request.body.grant_type === 'refresh_token'),
        {
          url: 'https://api.linear.app/oauth/token',
        },
      )
      assert.deepInclude(sent.find((request) => request.body.grant_type === 'refresh_token')?.body, {
        client_id: 'lin-althar',
        refresh_token: 'lin_r1',
      })
      assert.deepInclude(yield* keptFor(connection?.id ?? ''), { accessToken: 'lin_renewed', refreshToken: 'lin_r2' })
      assert.strictEqual((yield* connections.list)[0]?.state, 'ready')
    }).pipe(Effect.provide(withGitHub(fetch, { callbackPort: at, linear })))
  })

  it.live('signs a Linear connection in again for its own account, and turns away another', () => {
    const at = port()
    const linear = makeFakeService({ product: 'linear', account: { id: 'u1', login: 'you', name: 'You' } })
    const { fetch } = stub([['POST', 'https://api.linear.app/oauth/token', { json: { access_token: 'lin_oauth', expires_in: 86_400 } }]])
    return Effect.gen(function* () {
      const connections = yield* Connections
      const sql = yield* SqlClient.SqlClient
      assert.strictEqual((yield* backFromLinear(at))?.state, 'done')
      const [connection] = yield* connections.list
      const id = connection?.id ?? ''
      assert.deepStrictEqual(yield* backFromLinear(at, id), { state: 'done', connectionId: id })
      assert.deepStrictEqual(
        (yield* factsOf(id)).map((fact) => fact.type),
        ['connection.added', 'connection.renewed'],
      )
      // The connection was someone else's: signing it in as you doesn't take it over.
      yield* sql`UPDATE connections SET account_id = 'u2', account_login = 'them' WHERE id = ${id}`
      assert.deepStrictEqual(yield* backFromLinear(at, id), {
        state: 'ended',
        reason: 'failed',
        message: 'That signed in as you, not them.',
      })
      assert.strictEqual((yield* connections.list)[0]?.account.login, 'them')
    }).pipe(Effect.provide(withGitHub(fetch, { callbackPort: at, linear })))
  })

  it.live('stops listening for the browser once the person cancels it, and makes nothing', () => {
    const at = port()
    const { fetch } = stub([])
    return Effect.gen(function* () {
      const connections = yield* Connections
      const instance = yield* Instance
      const started = yield* connections.startSignIn({ product: 'linear', actorId: instance.personId })
      assert.strictEqual((yield* connections.signIn(started.flowId)).state, 'waiting')
      // Cancelled once its wait for the browser has begun.
      yield* Effect.yieldNow
      yield* connections.cancelSignIn(started.flowId)
      assert.strictEqual((yield* Effect.flip(connections.signIn(started.flowId)))._tag, 'NotFound')
      // Nothing answers at its address any more.
      const back = yield* Effect.flip(Effect.tryPromise(() => globalThis.fetch(`http://127.0.0.1:${at}/callback?code=c&state=s`)))
      assert.isDefined(back)
      assert.lengthOf(yield* connections.list, 0)
    }).pipe(Effect.provide(withGitHub(fetch, { callbackPort: at, linear: makeFakeService({ product: 'linear' }) })))
  })
})

describe('a sign-in that ends without a connection', () => {
  it.live('says it didn’t finish where the keychain wouldn’t keep its token', () => {
    const { fetch } = stub([
      device,
      ['POST', TOKEN, { json: { access_token: 'ghu_first', refresh_token: 'ghr_1', expires_in: 28_800 } }],
      ['GET', USER, you],
    ])
    const secrets = Layer.succeed(
      Secrets,
      Secrets.of({
        set: () => Effect.fail(new SecretsUnavailable({ reason: 'The app didn’t answer.' })),
        get: () => Effect.succeed(null),
        remove: () => Effect.void,
      }),
    )
    return Effect.gen(function* () {
      const connections = yield* Connections
      const instance = yield* Instance
      const started = yield* connections.startSignIn({ product: 'github', actorId: instance.personId })
      const [ended] = yield* until(
        Effect.map(
          Effect.suspend(() => connections.signIn(started.flowId)),
          (state) => [state],
        ),
        ([state]) => state?.state !== 'waiting',
      )
      assert.deepStrictEqual(ended, { state: 'ended', reason: 'failed', message: 'Sign-in didn’t finish.' })
      assert.lengthOf(yield* connections.list, 0)
    }).pipe(Effect.provide(withGitHub(fetch, { secrets })))
  })

  it.live('sends GitLab’s device sign-in the scope Althar asks for', () => {
    const { fetch, sent } = stub([
      [
        'POST',
        'https://gitlab.com/oauth/authorize_device',
        {
          json: {
            device_code: 'dev',
            user_code: 'WXYZ',
            verification_uri: 'https://gitlab.com/oauth/device',
            expires_in: 900,
            interval: 0,
          },
        },
      ],
      ['POST', 'https://gitlab.com/oauth/token', { json: { error: 'access_denied' } }],
    ])
    return Effect.gen(function* () {
      const connections = yield* Connections
      const instance = yield* Instance
      const started = yield* connections.startSignIn({ product: 'gitlab', actorId: instance.personId })
      assert.deepInclude(started, { kind: 'device', userCode: 'WXYZ' })
      assert.deepStrictEqual(sent[0]?.body, { client_id: 'gl-althar', scope: 'api' })
      const [ended] = yield* until(
        Effect.map(
          Effect.suspend(() => connections.signIn(started.flowId)),
          (state) => [state],
        ),
        ([state]) => state?.state !== 'waiting',
      )
      assert.deepInclude(ended, { state: 'ended', reason: 'denied' })
    }).pipe(Effect.provide(withGitHub(fetch, { more: [products.gitlab], clientIds: { gitlab: 'gl-althar' } })))
  })
})

describe('signing a connection in again with a pasted token', () => {
  it.live('keeps no email or key of a sign-in made in the browser, and no renewal', () => {
    const { fetch } = stub([
      device,
      ['POST', TOKEN, { json: { access_token: 'ghu_first', refresh_token: 'ghr_1', expires_in: 28_800 } }],
      ['GET', USER, you],
    ])
    return Effect.gen(function* () {
      const connections = yield* Connections
      const instance = yield* Instance
      const connection = yield* signedIn
      assert.isTrue((yield* connections.check(connection.id)).renews)
      const again = yield* connections.connectToken({
        product: 'github',
        token: ' ghp_pasted ',
        connectionId: connection.id,
        actorId: instance.personId,
      })
      assert.deepInclude(again, { id: connection.id, auth: 'token', state: 'ready' })
      assert.deepStrictEqual(yield* keptFor(connection.id), { kind: 'token', token: 'ghp_pasted', user: null, key: null })
      assert.isFalse((yield* connections.check(connection.id)).renews)
    }).pipe(Effect.provide(withGitHub(fetch)))
  })
})

describe('a connection’s check', () => {
  it.live('says where to install Althar’s app on GitHub for a project’s repository it can’t see', () => {
    const { fetch } = stub([
      device,
      ['POST', TOKEN, { json: { access_token: 'ghu_first', refresh_token: 'ghr_1', expires_in: 28_800 } }],
      ['GET', USER, you],
    ])
    return Effect.gen(function* () {
      const connections = yield* Connections
      const projects = yield* Projects
      const path = repository()
      execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/northwind/api.git'], { cwd: path })
      yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path })
      const connection = yield* signedIn
      const check = yield* connections.check(connection.id)
      assert.deepInclude(
        check.lines.map((line) => line.reason),
        { kind: 'not_installed', owner: 'northwind', url: 'https://github.com/apps/althar/installations/new' },
      )
    }).pipe(Effect.provide(withGitHub(fetch, { appSlug: 'althar' })))
  })
})

describe('the guide to connecting a code host', () => {
  it.live('lists a repository on GitHub as a place for GitHub, and none for GitLab', () => {
    const { fetch } = stub([])
    return Effect.gen(function* () {
      const connections = yield* Connections
      const projects = yield* Projects
      const path = repository()
      execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/meridian/api.git'], { cwd: path })
      yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path })
      assert.deepStrictEqual(
        (yield* connections.guide('github')).places.map((place) => [place.product, place.repositories]),
        [['github', ['meridian/api']]],
      )
      assert.deepStrictEqual((yield* connections.guide('gitlab')).places, [])
    }).pipe(Effect.provide(withGitHub(fetch, { more: [products.gitlab] })))
  })

  it.live('takes git’s own email for a token that needs one where a project’s repository says one that isn’t an address', () => {
    const { fetch } = stub([])
    const bitbucket = makeFakeService({ product: 'bitbucket_cloud' })
    const global = join(mkdtempSync(join(tmpdir(), 'althar-gitconfig-')), 'config')
    const was = process.env.GIT_CONFIG_GLOBAL
    return Effect.gen(function* () {
      const connections = yield* Connections
      const projects = yield* Projects
      process.env.GIT_CONFIG_GLOBAL = global
      writeFileSync(global, '[user]\n\temail = me@home.test\n')
      const path = repository()
      execFileSync('git', ['config', 'user.email', 'build-bot'], { cwd: path })
      yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path })
      assert.deepStrictEqual((yield* connections.guide('bitbucket')).email, { address: 'me@home.test', project: null })
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (was === undefined) delete process.env.GIT_CONFIG_GLOBAL
          else process.env.GIT_CONFIG_GLOBAL = was
        }),
      ),
      Effect.provide(withGitHub(fetch, { more: [{ ...products.bitbucket_cloud, make: () => ({ host: bitbucket }), access: null }] })),
    )
  })
})

describe('a refusal a second look can’t settle', () => {
  it.live('leaves the connection ready where GitHub fails the second look, or the keychain won’t open for it', () => {
    let answers: Array<Answer> = []
    // The keychain stops opening as GitHub refuses, where the test says: Althar's second look can't read the token.
    let locksOnRefusal = false
    let locked = false
    const map = new Map<string, string>()
    const secrets = Layer.succeed(
      Secrets,
      Secrets.of({
        set: (name, value) => Effect.sync(() => void map.set(name, value)),
        get: (name) =>
          locked ? Effect.fail(new SecretsUnavailable({ reason: 'The app didn’t answer.' })) : Effect.sync(() => map.get(name) ?? null),
        remove: (name) => Effect.sync(() => void map.delete(name)),
      }),
    )
    const { fetch } = stub([
      [
        'GET',
        USER,
        () => {
          const answer = answers.shift() ?? you
          if (locksOnRefusal && answer === refusal) locked = true
          return answer
        },
      ],
    ])
    return Effect.gen(function* () {
      const connections = yield* Connections
      const instance = yield* Instance
      const connection = yield* connections.connectToken({ product: 'github', token: 'ghp_t', actorId: instance.personId })
      const host = yield* codeHost(connection.id)

      // Refused, then GitHub fails as it is asked again: Althar can't tell, and the call is one to try again.
      answers = [refusal, { status: 502, json: { message: 'Bad gateway' } }]
      assert.strictEqual(reasonOf(yield* Effect.flip(host.account)), 'unreachable')
      assert.strictEqual((yield* connections.list)[0]?.state, 'ready')

      // Refused, and the keychain won't open as Althar looks again: the same.
      answers = [refusal]
      locksOnRefusal = true
      assert.strictEqual(reasonOf(yield* Effect.flip(host.account)), 'unreachable')
      locked = false
      assert.strictEqual((yield* connections.list)[0]?.state, 'ready')
      assert.notInclude(
        (yield* factsOf(connection.id)).map((fact) => fact.type),
        'connection.reauth_required',
      )
      // Open again, the call goes through with the token it had.
      locksOnRefusal = false
      assert.strictEqual((yield* host.account).login, 'you')
    }).pipe(Effect.provide(withGitHub(fetch, { secrets })))
  })
})

describe('gh’s sign-in, where a connection’s copy of it stopped working', () => {
  it.live('doesn’t take over where gh signs in as someone else, GitHub refuses gh’s too, or doesn’t answer for it', () => {
    const valid = new Set(['gho_first'])
    let gh = 'gho_first'
    const { fetch } = stub([
      takes(valid, {
        gho_other: { json: { id: 6, login: 'someone', name: 'Someone' } },
        gho_flaky: { status: 503, json: { message: 'Unavailable' } },
      }),
    ])
    return Effect.gen(function* () {
      const connections = yield* Connections
      const instance = yield* Instance
      const connection = yield* connections.connectCli({ product: 'github', webUrl: GITHUB, actorId: instance.personId })
      const host = yield* codeHost(connection.id)
      const lastSaid = Effect.map(factsOf(connection.id), (facts) => JSON.parse(facts.at(-1)?.payload ?? '{}') as { cli?: unknown })
      /** The person signs in with gh again, gh having a token GitHub takes. */
      const again = (token: string) =>
        Effect.gen(function* () {
          valid.add(token)
          gh = token
          yield* connections.connectCli({ product: 'github', webUrl: GITHUB, connectionId: connection.id, actorId: instance.personId })
          assert.strictEqual((yield* connections.list)[0]?.state, 'ready')
        })

      // gh is signed in as someone else now.
      valid.clear()
      gh = 'gho_other'
      assert.strictEqual(reasonOf(yield* Effect.flip(host.account)), 'unauthorized')
      assert.strictEqual((yield* connections.list)[0]?.state, 'reauth_required')
      assert.deepStrictEqual((yield* lastSaid).cli, { tool: 'gh', said: 'other_account' })
      assert.strictEqual((yield* keptFor(connection.id)).token, 'gho_first')

      // GitHub refuses gh's new token too.
      yield* again('gho_second')
      valid.clear()
      gh = 'gho_bad'
      assert.strictEqual(reasonOf(yield* Effect.flip(host.account)), 'unauthorized')
      assert.strictEqual((yield* connections.list)[0]?.state, 'reauth_required')
      assert.deepStrictEqual((yield* lastSaid).cli, { tool: 'gh', said: 'refused' })

      // GitHub doesn't answer for gh's new token: Althar can't tell, and the connection stays as it was.
      yield* again('gho_third')
      valid.clear()
      gh = 'gho_flaky'
      assert.strictEqual(reasonOf(yield* Effect.flip(host.account)), 'unreachable')
      assert.strictEqual((yield* connections.list)[0]?.state, 'ready')
      assert.strictEqual((yield* keptFor(connection.id)).token, 'gho_third')
    }).pipe(Effect.provide(withGitHub(fetch, { cliToken: () => Effect.sync(() => gh) })))
  })

  it.live('isn’t asked for a connection Althar didn’t note the source of, whose token isn’t one gh gives', () => {
    const valid = new Set(['ghp_pasted'])
    const asked: Array<string> = []
    const { fetch } = stub([takes(valid)])
    const cliToken = (tool: 'gh' | 'glab') =>
      Effect.sync(() => {
        asked.push(tool)
        return 'gho_now'
      })
    return Effect.gen(function* () {
      const connections = yield* Connections
      const instance = yield* Instance
      const sql = yield* SqlClient.SqlClient
      const connection = yield* connections.connectToken({ product: 'github', token: 'ghp_pasted', actorId: instance.personId })
      yield* sql`UPDATE connections SET cli = NULL WHERE id = ${connection.id}`
      valid.clear()
      assert.strictEqual(reasonOf(yield* Effect.flip((yield* codeHost(connection.id)).account)), 'unauthorized')
      assert.deepStrictEqual(asked, [])
      assert.strictEqual((yield* connections.list)[0]?.state, 'reauth_required')
      assert.deepInclude(JSON.parse((yield* factsOf(connection.id)).at(-1)?.payload ?? '{}') as object, { cli: null })
    }).pipe(Effect.provide(withGitHub(fetch, { cliToken })))
  })

  it.live('never sends gh’s sign-in to an instance over plain HTTP, though its token looks like one gh gives', () => {
    const asked: Array<string> = []
    let refused = false
    const { fetch } = stub([['GET', 'http://git.meridian.test/api/v3/user', () => (refused ? refusal : you)]])
    const cliToken = (tool: 'gh' | 'glab') =>
      Effect.sync(() => {
        asked.push(tool)
        return 'gho_now'
      })
    return Effect.gen(function* () {
      const connections = yield* Connections
      const instance = yield* Instance
      const sql = yield* SqlClient.SqlClient
      const connection = yield* connections.connectToken({
        product: 'github',
        webUrl: 'http://git.meridian.test',
        token: 'gho_copied',
        actorId: instance.personId,
      })
      yield* sql`UPDATE connections SET cli = NULL WHERE id = ${connection.id}`
      refused = true
      assert.strictEqual(reasonOf(yield* Effect.flip((yield* codeHost(connection.id)).account)), 'unauthorized')
      assert.deepStrictEqual(asked, [])
      assert.strictEqual((yield* connections.list)[0]?.state, 'reauth_required')
      assert.deepInclude(JSON.parse((yield* factsOf(connection.id)).at(-1)?.payload ?? '{}') as object, {
        cli: { tool: 'gh', said: 'signed_out' },
      })
    }).pipe(Effect.provide(withGitHub(fetch, { cliToken })))
  })

  it.live('leaves a connection still signed out of gh needing its person: no code host for publishing, and no tracker', () => {
    const valid = new Set(['gho_first'])
    let gh: string | null = 'gho_first'
    const { fetch } = stub([takes(valid)])
    return Effect.gen(function* () {
      const connections = yield* Connections
      const instance = yield* Instance
      const connection = yield* connections.connectCli({ product: 'github', webUrl: GITHUB, actorId: instance.personId })
      assert.lengthOf(yield* connections.trackers, 1)
      valid.clear()
      gh = null
      assert.strictEqual(reasonOf(yield* Effect.flip((yield* codeHost(connection.id)).account)), 'unauthorized')
      assert.isNull(yield* connections.hostOf(['git@github.com:meridian/api.git'], { fromCli: true }))
      assert.strictEqual((yield* connections.list)[0]?.state, 'reauth_required')
      assert.lengthOf(yield* connections.trackers, 0)
    }).pipe(Effect.provide(withGitHub(fetch, { cliToken: () => Effect.sync(() => gh) })))
  })
})
