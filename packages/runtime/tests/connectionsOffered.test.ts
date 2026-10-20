import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type ProductInfo, products } from '@althar/connectors'
import { makeFakeService } from '@althar/connectors/testing'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'

import { Connectors } from '../src/Config'
import { Connections } from '../src/Connections'
import { Instance } from '../src/Instance'
import * as Runtime from '../src/Runtime'
import { Secrets } from '../src/Secrets'
import { Projects } from '../src/Projects'
import { fakeAgents, repository, runtime } from './support'

/*
 * A connection to a product this copy of Althar no longer offers, as after
 * an update that drops one: it is still listed, by the product's id, and
 * checked as far as Althar can without its adapter, which offers nothing.
 */

/** One keychain for both launches, as the person's is. */
const keychain = () => {
  const kept = new Map<string, string>()
  return Layer.succeed(
    Secrets,
    Secrets.of({
      set: (name, value) => Effect.sync(() => void kept.set(name, value)),
      get: (name) => Effect.sync(() => kept.get(name) ?? null),
      remove: (name) => Effect.sync(() => void kept.delete(name)),
    }),
  )
}

const launch = (database: string, secrets: Layer.Layer<Secrets>, offered: ReadonlyArray<ProductInfo>) =>
  Runtime.layer({
    database,
    worktreeRoot: mkdtempSync(join(tmpdir(), 'althar-worktrees-')),
    accountsRoot: mkdtempSync(join(tmpdir(), 'althar-accounts-')),
    appVersion: '0.0.0-test',
    deviceName: 'Test Mac',
    agents: fakeAgents(),
    secrets,
    connectors: Layer.succeed(
      Connectors,
      Connectors.of({
        products: offered,
        fetch: () => Promise.reject(new Error('No network in tests')),
        clientIds: {},
        callbackPort: 0,
        cliToken: () => Effect.succeed(null),
      }),
    ),
  })

describe('a connection to a product no longer offered', () => {
  it.live('is listed by its product’s id, offers no adapter, and its check says only that it can’t tell who it is', () => {
    const database = join(mkdtempSync(join(tmpdir(), 'althar-profile-')), 'althar.db')
    const secrets = keychain()
    const trello = makeFakeService({ product: 'trello' })
    const before = [products.github, { ...products.trello, make: () => ({ tracker: trello }), access: trello.access }]
    return Effect.gen(function* () {
      const made = yield* Effect.scoped(
        Effect.gen(function* () {
          const connections = yield* Connections
          const instance = yield* Instance
          const first = yield* connections.connectToken({
            product: 'trello',
            key: 'k'.repeat(32),
            token: 'ATTA0000',
            actorId: instance.personId,
          })
          // Signed in again with a new token alone, it keeps the key that went with the first.
          const again = yield* connections.connectToken({
            connectionId: first.id,
            product: 'trello',
            token: 'ATTA1111',
            actorId: instance.personId,
          })
          assert.strictEqual(again.id, first.id)
          const kept = JSON.parse((yield* (yield* Secrets).get(first.id)) ?? '{}') as Record<string, unknown>
          assert.deepInclude(kept, { token: 'ATTA1111', key: 'k'.repeat(32), user: null })
          return first
        }).pipe(Effect.provide(launch(database, secrets, before))),
      )
      yield* Effect.scoped(
        Effect.gen(function* () {
          const connections = yield* Connections
          const [listed] = yield* connections.list
          assert.deepInclude(listed, { id: made.id, product: 'trello', name: 'trello', state: 'ready' })
          const adapters = yield* connections.adapters(made.id)
          assert.isUndefined(adapters.host)
          assert.isUndefined(adapters.tracker)
          const check = yield* connections.check(made.id)
          assert.deepStrictEqual(check.lines, [{ need: 'account', state: 'no', fact: null, count: null, reason: { kind: 'refused' } }])
          assert.strictEqual(check.settings, made.webUrl)
          // Nor is it a tracker anything can file on.
          assert.deepStrictEqual(yield* connections.trackers, [])
        }).pipe(Effect.provide(launch(database, secrets, [products.github]))),
      )
    })
  })
})

describe('the places a project’s repositories are on', () => {
  it.live('leave out a remote that is a folder on this computer, on no host', () => {
    const bare = mkdtempSync(join(tmpdir(), 'althar-remote-'))
    execFileSync('git', ['init', '-q', '--bare', bare])
    const working = repository()
    execFileSync('git', ['remote', 'add', 'origin', bare], { cwd: working })
    return Effect.gen(function* () {
      const projects = yield* Projects
      const connections = yield* Connections
      yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
      assert.deepStrictEqual(yield* connections.places, [])
    }).pipe(Effect.provide(runtime()))
  })
})
