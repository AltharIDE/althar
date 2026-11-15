import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { afterEach, beforeEach, vi } from 'vitest'

import { Accounts } from '../src/Accounts'
import { Agents } from '../src/Config'
import { Models } from '../src/Models'
import { fakeAgents, launches, runtime, until } from './support'

const cliAgents = () =>
  Layer.effect(
    Agents,
    Effect.gen(function* () {
      const agents = yield* Agents
      const cli = yield* agents.get('copilot').pipe(Effect.orDie)
      return Agents.from([
        ...agents.list,
        { ...cli, definition: { ...cli.definition, signIn: { ...cli.definition.signIn, login: 'copilot login' } } },
      ])
    }),
  ).pipe(Layer.provide(fakeAgents()))

const fixture = (database = ':memory:') => runtime(database, {}, { agents: cliAgents() })

beforeEach(() => {
  vi.stubEnv('GH_HOST', undefined)
  vi.stubEnv('COPILOT_GH_HOST', undefined)
})
afterEach(() => vi.unstubAllEnvs())

describe('Copilot CLI enterprise sign-in', () => {
  it.live('passes the normalized host explicitly and uses it when discovering models', () =>
    Effect.gen(function* () {
      const accounts = yield* Accounts
      const [account] = yield* accounts.of('copilot')
      assert.isDefined(account)
      assert.strictEqual(yield* accounts.login(account!.id, 'https://Company.GHE.com/'), "copilot login --host 'https://company.ghe.com'")
      const saved = yield* accounts.get(account!.id)
      assert.strictEqual(saved.signInHost, 'company.ghe.com')
      assert.deepStrictEqual(accounts.env(saved), { GH_HOST: 'company.ghe.com', COPILOT_GH_HOST: 'company.ghe.com' })
      const models = yield* Models
      yield* models.forget('copilot')
      yield* until(models.catalog, (catalog) => catalog.some((entry) => entry.agentId === 'copilot' && entry.models.length > 0))
      assert.isTrue(launches.some((launch) => launch.agentId === 'copilot' && launch.env.COPILOT_GH_HOST === 'company.ghe.com'))
    }).pipe(Effect.provide(fixture())),
  )

  it.live('keeps the selected host after restart, ahead of a different shell host', () => {
    const database = join(mkdtempSync(join(tmpdir(), 'althar-copilot-cli-')), 'profile.sqlite')
    const first = Effect.gen(function* () {
      const accounts = yield* Accounts
      const [account] = yield* accounts.of('copilot')
      yield* accounts.login(account!.id, 'company.ghe.com')
      return account!.id
    }).pipe(Effect.provide(fixture(database)))
    return first.pipe(
      Effect.flatMap((id) => {
        vi.stubEnv('GH_HOST', 'other.ghe.com')
        return Effect.gen(function* () {
          const accounts = yield* Accounts
          const saved = yield* accounts.get(id)
          assert.strictEqual(saved.signInHost, 'company.ghe.com')
          assert.strictEqual(yield* accounts.login(id), "copilot login --host 'https://company.ghe.com'")
          assert.strictEqual(accounts.env(saved).GH_HOST, 'company.ghe.com')
        }).pipe(Effect.provide(fixture(database)))
      }),
    )
  })

  it.live('honors Copilot’s host override and can switch explicitly back to github.com', () => {
    vi.stubEnv('GH_HOST', 'other.ghe.com')
    vi.stubEnv('COPILOT_GH_HOST', 'company.ghe.com')
    return Effect.gen(function* () {
      const accounts = yield* Accounts
      const [account] = yield* accounts.of('copilot')
      assert.strictEqual(yield* accounts.login(account!.id), "copilot login --host 'https://company.ghe.com'")
      assert.strictEqual(yield* accounts.login(account!.id, 'github.com'), "copilot login --host 'https://github.com'")
      assert.deepStrictEqual(accounts.env(yield* accounts.get(account!.id)), { GH_HOST: 'github.com', COPILOT_GH_HOST: 'github.com' })
      assert.strictEqual(process.env.COPILOT_GH_HOST, 'company.ghe.com')
    }).pipe(Effect.provide(fixture()))
  })

  it.live('turns GH_HOST into an explicit login argument when no host was selected', () => {
    vi.stubEnv('GH_HOST', 'company.ghe.com')
    return Effect.gen(function* () {
      const accounts = yield* Accounts
      const [account] = yield* accounts.of('copilot')
      assert.strictEqual(yield* accounts.login(account!.id), "copilot login --host 'https://company.ghe.com'")
    }).pipe(Effect.provide(fixture()))
  })

  it.live('treats an empty shell host as the normal GitHub sign-in', () => {
    vi.stubEnv('GH_HOST', '')
    vi.stubEnv('COPILOT_GH_HOST', '')
    return Effect.gen(function* () {
      const accounts = yield* Accounts
      const [account] = yield* accounts.of('copilot')
      assert.strictEqual(yield* accounts.login(account!.id), 'copilot login')
    }).pipe(Effect.provide(fixture()))
  })

  it.live('rejects unsafe addresses without replacing the selected account host', () =>
    Effect.gen(function* () {
      const accounts = yield* Accounts
      const [account] = yield* accounts.of('copilot')
      yield* accounts.login(account!.id, 'company.ghe.com')
      for (const host of [
        'http://company.ghe.com',
        'https://user:password@company.ghe.com',
        'https://company.ghe.com/login',
        'company.ghe.com; echo unsafe',
      ]) {
        assert.deepInclude(yield* Effect.flip(accounts.login(account!.id, host)), { _tag: 'AccountRefused', reason: 'host' })
      }
      assert.strictEqual(yield* accounts.login(account!.id), "copilot login --host 'https://company.ghe.com'")
      const [codex] = yield* accounts.of('codex')
      assert.deepInclude(yield* Effect.flip(accounts.login(codex!.id, 'company.ghe.com')), { _tag: 'AccountRefused', reason: 'host' })
      assert.strictEqual((yield* accounts.get(codex!.id)).signInHost, undefined)
    }).pipe(Effect.provide(fixture())),
  )
})
