import { execFileSync } from 'node:child_process'

import { type Credential, type ProductInfo, products } from '@althar/connectors'
import { makeFakeService } from '@althar/connectors/testing'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { cliToken, Connectors } from '../src/Config'
import { CliElsewhere, CliSignedOut, Connections, OtherAccount } from '../src/Connections'
import { Instance } from '../src/Instance'
import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { Secrets } from '../src/Secrets'
import { fakeConnectors, HOST, hosted, repository, runtime } from './support'

/*
 * Connecting a service, as the walk in asks the runtime: where the projects'
 * code is on it, gh's sign-in on this device taken as it is, what a
 * connection can do there, and a connection signed in again with a new
 * token, keeping what went with the old one, for its own account only.
 */

describe('connecting', () => {
  it.live('reads no sign-in of gh or glab for a host they aren’t signed in to, or where they aren’t installed', () =>
    Effect.gen(function* () {
      assert.isNull(yield* cliToken('gh', 'nowhere.invalid'))
      assert.isNull(yield* cliToken('glab', 'nowhere.invalid'))
    }),
  )

  it.live('says where the projects’ code is, and gh’s sign-in there, and connects with it', () => {
    const github = makeFakeService()
    github.addRepository(['meridian', 'api'])
    const asked: Array<string> = []
    const layer = runtime(
      ':memory:',
      {},
      {
        connectors: fakeConnectors(
          { github },
          {
            cliToken: (tool, host) =>
              Effect.sync(() => {
                asked.push(`${tool} ${host}`)
                return tool === 'gh' && host === 'github.test' ? 'gho_from_gh' : null
              }),
          },
        ),
      },
    )
    return Effect.gen(function* () {
      const connections = yield* Connections
      const instance = yield* Instance
      const projects = yield* Projects
      const secrets = yield* Secrets
      // A connection on the instance already, so its host is known by it.
      const first = yield* connections.connectToken({ product: 'github', webUrl: HOST, token: 'ghp_first', actorId: instance.personId })
      const { working } = hosted()
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })

      const guide = yield* connections.guide('github')
      assert.deepStrictEqual(guide.places, [
        { product: 'github', webUrl: HOST, project: project.name, remote: 'origin', repositories: ['meridian/api'] },
      ])
      assert.deepStrictEqual(guide.clis, [{ product: 'github', webUrl: HOST, tool: 'gh', account: 'you', scopes: null }])
      assert.include(asked, 'gh github.test')
      // Neither GitHub nor anything of its service wants an email with a token.
      assert.isNull(guide.email)

      // gh's sign-in, taken as it is: the same account's connection renewed with gh's token, which agents never see.
      const taken = yield* connections.connectCli({ product: 'github', webUrl: HOST, actorId: instance.personId })
      assert.strictEqual(taken.id, first.id)
      const kept = JSON.parse((yield* secrets.get(first.id)) ?? '{}') as { token?: string }
      assert.strictEqual(kept.token, 'gho_from_gh')
      // Signing a connection of another account's in again with it is refused: gh is signed in as someone else.
      const sql = yield* SqlClient.SqlClient
      yield* sql`UPDATE connections SET account_id = 'other', account_login = 'someone' WHERE id = ${first.id}`
      const other = yield* Effect.flip(
        connections.connectCli({ product: 'github', webUrl: HOST, connectionId: first.id, actorId: instance.personId }),
      )
      assert.instanceOf(other, OtherAccount)
      yield* sql`UPDATE connections SET account_id = '1', account_login = 'you' WHERE id = ${first.id}`
      // glab isn't signed in anywhere here.
      const signedOut = yield* Effect.flip(
        connections.connectCli({ product: 'gitlab', webUrl: 'https://gitlab.com', actorId: instance.personId }),
      )
      assert.instanceOf(signedOut, CliSignedOut)

      // What it can do there: the fake answers for its repositories.
      const check = yield* connections.check(first.id)
      assert.deepStrictEqual(
        check.lines.map((line) => [line.need, line.state, line.fact]),
        [
          ['account', 'ok', 'you'],
          ['reach', 'ok', 'meridian'],
          ['push', 'ok', null],
          ['changes', 'ok', null],
          ['checks', 'ok', null],
          ['issues', 'ok', null],
        ],
      )
      assert.isFalse(check.renews)
      assert.strictEqual(check.settings, `${HOST}/settings/tokens`)
    }).pipe(Effect.provide(layer))
  })

  it.live('signs a connection in again with a new token, keeping its key, and only for the account it was', () => {
    const trello = makeFakeService({ product: 'trello', account: { id: '1', login: 'you', name: 'You' } })
    const someone = makeFakeService({ product: 'trello', account: { id: '2', login: 'someone', name: null } })
    // Whose the token is, as Trello would say: `other` is someone else's.
    const layer = runtime(
      ':memory:',
      {},
      {
        connectors: connectorsWith({
          ...products.trello,
          make: (options) => ({
            tracker: {
              ...trello,
              account: Effect.flatMap(options.credential, (credential: Credential) =>
                credential.kind === 'app' && credential.token === 'other' ? someone.account : trello.account,
              ),
            },
          }),
          access: null,
        }),
      },
    )
    return Effect.gen(function* () {
      const connections = yield* Connections
      const instance = yield* Instance
      const secrets = yield* Secrets
      const sql = yield* SqlClient.SqlClient
      const made = yield* connections.connectToken({ product: 'trello', key: 'k'.repeat(32), token: 'ATTA1', actorId: instance.personId })
      yield* sql`UPDATE connections SET state = 'reauth_required' WHERE id = ${made.id}`

      // Someone else's token doesn't sign this one in again.
      const other = yield* Effect.flip(
        connections.connectToken({ product: 'trello', token: 'other', connectionId: made.id, actorId: instance.personId }),
      )
      assert.instanceOf(other, OtherAccount)
      assert.deepInclude(other, { login: 'someone', expected: 'you' })
      assert.strictEqual((yield* connections.list)[0]?.state, 'reauth_required')

      // Its own: the key it was made for stays, and only the token changes.
      const again = yield* connections.connectToken({
        product: 'trello',
        token: 'ATTA2',
        connectionId: made.id,
        actorId: instance.personId,
      })
      assert.strictEqual(again.id, made.id)
      assert.strictEqual(again.state, 'ready')
      const kept = JSON.parse((yield* secrets.get(made.id)) ?? '{}') as { token?: string; key?: string }
      assert.deepInclude(kept, { token: 'ATTA2', key: 'k'.repeat(32) })
      // Without a check of its own, the product says who it signs in as, and no more.
      const check = yield* connections.check(made.id)
      assert.deepStrictEqual(check.lines, [{ need: 'account', state: 'ok', fact: 'you', count: null, reason: null }])
    }).pipe(Effect.provide(layer))
  })

  it.live('hands gh’s sign-in only to the instance it is for, over HTTPS, and signs a connection in again where it is', () => {
    const github = makeFakeService()
    const asked: Array<string> = []
    const layer = runtime(
      ':memory:',
      {},
      {
        connectors: fakeConnectors(
          { github },
          { cliToken: (tool, host) => Effect.sync(() => (asked.push(`${tool} ${host}`), 'gho_from_gh')) },
        ),
      },
    )
    return Effect.gen(function* () {
      const connections = yield* Connections
      const { personId } = yield* Instance
      const first = yield* connections.connectToken({ product: 'github', webUrl: HOST, token: 'ghp_first', actorId: personId })
      // A connection kept at an address without HTTPS: gh's sign-in isn't read for it, even to say who it is.
      yield* connections.connectToken({ product: 'github', webUrl: 'http://plain.test', token: 'ghp_plain', actorId: personId })
      yield* connections.guide('github')
      assert.sameMembers(asked, ['gh github.com', 'gh github.test'])
      asked.length = 0

      // Not over HTTPS, not the hosted service's own address, or a server Althar neither found nor connected: refused before gh is asked.
      for (const webUrl of [
        'http://github.com',
        'https://github.com:8443',
        'https://github.com/elsewhere',
        'https://you@github.com',
        'http://github.test',
        'http://plain.test',
        'https://elsewhere.test',
      ]) {
        const refused = yield* Effect.flip(connections.connectCli({ product: 'github', webUrl, actorId: personId }))
        assert.instanceOf(refused, CliElsewhere, webUrl)
      }
      assert.deepStrictEqual(asked, [])

      // The hosted service, written with a slash, is its own address.
      const onHosted = yield* connections.connectCli({ product: 'github', webUrl: 'https://github.com/', actorId: personId })
      assert.strictEqual(onHosted.webUrl, 'https://github.com')
      // Signing a connection in again goes where the connection is, whatever address came with it.
      const again = yield* connections.connectCli({
        product: 'github',
        webUrl: 'http://github.com',
        connectionId: first.id,
        actorId: personId,
      })
      assert.strictEqual(again.id, first.id)
      assert.strictEqual(again.webUrl, HOST)
      assert.deepStrictEqual(asked, ['gh github.com', 'gh github.test'])
    }).pipe(Effect.provide(layer))
  })

  it.live('reads a remote on a server it shares with a tracker as its code host’s, under the code host’s own path', () => {
    const gitlab = makeFakeService({ product: 'gitlab' })
    gitlab.addRepository(['team', 'api'])
    gitlab.addRepository(['team', 'web'])
    const jira = makeFakeService({ product: 'jira_dc' })
    const layer = runtime(
      ':memory:',
      {},
      {
        connectors: connectorsOf([
          { ...products.gitlab, make: () => ({ host: gitlab, tracker: gitlab }), access: gitlab.access },
          { ...products.jira_dc, make: () => ({ tracker: jira }), access: jira.access },
        ]),
      },
    )
    return Effect.gen(function* () {
      const connections = yield* Connections
      const projects = yield* Projects
      const { personId } = yield* Instance
      const code = yield* connections.connectToken({
        product: 'gitlab',
        webUrl: 'https://tools.example.test/gitlab',
        token: 'glpat-1',
        actorId: personId,
      })
      // Jira on the same server, connected after.
      yield* connections.connectToken({ product: 'jira_dc', webUrl: 'https://tools.example.test/jira', token: 'pat', actorId: personId })
      // The code over HTTPS, under GitLab's own path; and over SSH, which doesn't say it.
      const working = repository()
      execFileSync('git', ['remote', 'add', 'origin', 'https://tools.example.test/gitlab/team/api.git'], { cwd: working })
      execFileSync('git', ['remote', 'add', 'backup', 'git@tools.example.test:team/web.git'], { cwd: working })
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })

      const [place, ...others] = yield* connections.places
      assert.deepStrictEqual(others, [])
      assert.deepInclude(place, { product: 'gitlab', webUrl: 'https://tools.example.test/gitlab', project: project.name })
      assert.sameMembers([...(place?.repositories ?? [])], ['team/api', 'team/web'])
      // Its check asks for those repositories, by the paths GitLab knows them by.
      const check = yield* connections.check(code.id)
      assert.deepInclude(
        check.lines.find((line) => line.need === 'reach'),
        { state: 'ok', fact: 'team' },
      )
    }).pipe(Effect.provide(layer))
  })

  it.live('reads where the code is past a remote it can’t read', () => {
    const github = makeFakeService()
    const layer = runtime(':memory:', {}, { connectors: fakeConnectors({ github }) })
    return Effect.gen(function* () {
      const connections = yield* Connections
      const projects = yield* Projects
      const { personId } = yield* Instance
      const sql = yield* SqlClient.SqlClient
      yield* connections.connectToken({ product: 'github', webUrl: HOST, token: 'ghp_first', actorId: personId })
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: hosted().working })
      // A remote whose escapes don't read, beside one that does.
      yield* sql`UPDATE repository_bindings SET remote_fingerprints = ${JSON.stringify([`${HOST}/team/api%ZZ.git`, `${HOST}/meridian/api.git`])}`
      assert.deepStrictEqual(yield* connections.places, [
        { product: 'github', webUrl: HOST, project: project.name, remote: null, repositories: ['team/api%ZZ', 'meridian/api'] },
      ])
    }).pipe(Effect.provide(layer))
  })
})

/** The runtime's connectors with one product of a test's own, and no network. */
const connectorsWith = (product: ProductInfo) => connectorsOf([product])

/** The runtime's connectors with products of a test's own, and no network. */
const connectorsOf = (given: ReadonlyArray<ProductInfo>) =>
  Layer.succeed(
    Connectors,
    Connectors.of({
      products: given,
      fetch: () => Promise.reject(new Error('No network in tests')),
      clientIds: {},
      callbackPort: 0,
      cliToken: () => Effect.succeed(null),
    }),
  )
