import { mkdtempSync } from 'node:fs'
import { removeTreeSync } from '@althar/testing'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { AcpConnection } from '@althar/contracts'
import { assert, describe, it } from '@effect/vitest'
import { afterEach, vi } from 'vitest'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'
import { until } from '@althar/testing/effect'
import { Ids, newId } from '@althar/domain'

import { AgentCatalog } from '../src/AgentCatalog'
import { Agents } from '../src/Config'
import { Instance } from '../src/Instance'
import { Models } from '../src/Models'
import { Projects } from '../src/Projects'
import { Coordinator } from '../src/Coordinator'
import * as Runtime from '../src/Runtime'
import { runtime as baseRuntime, fakeAgents, repository } from './support'
const mutableAgents = Layer.effect(
  Agents,
  Effect.map(Agents, (all) => Agents.from(all.list)),
).pipe(Layer.provide(fakeAgents()))
const runtime = (file = ':memory:') => baseRuntime(file, {}, { agents: mutableAgents })
const folders: string[] = []
const folder = () => {
  const path = mkdtempSync(join(tmpdir(), 'althar-test-acp-'))
  folders.push(path)
  return path
}

const connection = (): AcpConnection => ({
  id: 'acp-example',
  name: 'Example',
  command: join(folder(), 'missing-agent'),
  args: ['acp'],
  mode: 'ask',
  readerMode: 'read',
  modeOption: 'mode',
  modelOption: 'model',
  effortOption: null,
  held: {},
  registryId: null,
  registryVersion: null,
})
const database = () => join(folder(), 'profile.sqlite')
afterEach(() => {
  vi.unstubAllGlobals()
  for (const path of folders.splice(0)) removeTreeSync(path)
})

describe('the person’s saved ACP connections', () => {
  it.live('keeps connections unchanged while their conversations are active', () =>
    Effect.gen(function* () {
      const catalog = yield* AgentCatalog
      const spec = connection()
      yield* catalog.save(spec)
      const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const threadId = yield* (yield* Coordinator).thread(project.projectId)
      const sql = yield* SqlClient.SqlClient
      const id = yield* newId(Ids.providerSession)
      yield* sql`INSERT INTO provider_sessions ${sql.insert({ id, projectId: project.projectId, threadId, agentId: spec.id, state: 'active', startedAt: new Date().toISOString() })}`
      for (const action of [catalog.save({ ...spec, name: 'Changed' }), catalog.check(spec.id), catalog.remove(spec.id)]) {
        const failed = yield* Effect.flip(action)
        assert.include(failed.message, 'active conversations')
      }
      assert.strictEqual((yield* catalog.read()).connections[0]?.connection.name, spec.name)
    }).pipe(Effect.provide(runtime())),
  )

  it.live('recovers interrupted checks and isolates corrupt saved metadata without enabling blocked agents', () => {
    const file = database()
    const spec = connection()
    const seed = Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const instance = yield* Instance
      for (const [key, value] of [
        [`acp:${instance.deviceId}:${spec.id}`, JSON.stringify({ connection: spec, state: 'checking', reason: null, version: null })],
        [
          `acp:${instance.deviceId}:acp-blocked`,
          JSON.stringify({ connection: { ...spec, id: 'acp-blocked', command: 'devin' }, state: 'ready', reason: null, version: '1' }),
        ],
        [`acp:${instance.deviceId}:acp-broken`, 'invalid'],
        [`acp-registry:${instance.deviceId}`, '{}'],
        [`acp-revision:${instance.deviceId}`, 'invalid'],
      ])
        yield* sql`INSERT INTO settings ${sql.insert({ key, value, updatedAt: new Date().toISOString() })} ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    }).pipe(Effect.provide(runtime(file)))
    const read = Effect.gen(function* () {
      const state = yield* (yield* AgentCatalog).read()
      assert.strictEqual(state.revision, 0)
      assert.strictEqual(state.connections.find((one) => one.connection.id === spec.id)?.state, 'unchecked')
      assert.strictEqual(state.connections.find((one) => one.connection.id === 'acp-blocked')?.state, 'failed')
      assert.include(state.problem ?? '', 'catalog could not be read')
      assert.strictEqual((yield* Effect.flip((yield* Agents).get('acp-blocked')))._tag, 'UnknownAgent')
    }).pipe(Effect.provide(runtime(file)))
    return Effect.andThen(seed, read)
  })
  it.live('refuses a known blocked custom command before starting a compatibility process', () =>
    Effect.gen(function* () {
      const catalog = yield* AgentCatalog
      const spec = { ...connection(), command: 'npx', args: ['--yes', 'droid@1.12.1', 'exec', '--output-format', 'acp-daemon'] }
      yield* catalog.save(spec)
      const failed = yield* Effect.flip(catalog.check(spec.id))
      assert.include(failed.message, 'Script')
      const sql = yield* SqlClient.SqlClient
      assert.deepStrictEqual(yield* sql`SELECT id FROM processes WHERE purpose = 'probe'`, [])
    }).pipe(Effect.provide(runtime())),
  )
  it.live('restores a qualified connection with its version gate, and a newly registered agent reaches the model catalog', () => {
    const file = database()
    const spec = connection()
    const save = Effect.gen(function* () {
      const catalog = yield* AgentCatalog
      yield* catalog.save(spec)
      const instance = yield* Instance
      const sql = yield* SqlClient.SqlClient
      yield* sql`UPDATE settings SET value = ${JSON.stringify({ connection: spec, state: 'ready', version: '1.2.3', reason: null })} WHERE key = ${`acp:${instance.deviceId}:${spec.id}`}`
    }).pipe(Effect.provide(runtime(file)))
    const read = Effect.gen(function* () {
      const agents = yield* Agents
      const entry = yield* agents.get(spec.id)
      const transport = entry.transport(tmpdir())
      assert.strictEqual(transport._tag, 'Process')
      if (transport._tag === 'Process') assert.strictEqual(transport.expectedVersion, '1.2.3')
      const models = yield* Models
      agents.remove?.(spec.id)
      assert.isFalse((yield* models.catalog).some((one) => one.agentId === spec.id))
      agents.register?.(entry)
      assert.isTrue((yield* models.catalog).some((one) => one.agentId === spec.id))
    }).pipe(Effect.provide(runtime(file)))
    return Effect.andThen(save, read)
  })
  it.live('keeps a new command unavailable until it passes, and removes it without making it runnable', () =>
    Effect.gen(function* () {
      const catalog = yield* AgentCatalog
      const agents = yield* Agents
      yield* catalog.remove('claude-code')
      assert.strictEqual((yield* agents.get('claude-code')).definition.id, 'claude-code')
      const spec = connection()
      const revision = yield* catalog.save(spec)
      const read = yield* catalog.read()
      assert.strictEqual(read.revision, revision)
      assert.strictEqual(read.connections[0]?.state, 'unchecked')
      assert.strictEqual((yield* Effect.flip(agents.get(spec.id)))._tag, 'UnknownAgent')
      assert.isAbove(yield* catalog.remove(spec.id), revision)
      assert.deepStrictEqual((yield* catalog.read()).connections, [])
    }).pipe(Effect.provide(runtime())),
  )

  it.live('retains the command across a restart, then keeps its removal', () => {
    const file = database()
    const spec = connection()
    const save = Effect.gen(function* () {
      yield* (yield* AgentCatalog).save(spec)
    }).pipe(Effect.provide(runtime(file)))
    const read = Effect.gen(function* () {
      const catalog = yield* AgentCatalog
      assert.deepStrictEqual(
        (yield* catalog.read()).connections.map((one) => one.connection),
        [spec],
      )
      yield* catalog.remove(spec.id)
    }).pipe(Effect.provide(runtime(file)))
    const removed = Effect.gen(function* () {
      assert.deepStrictEqual((yield* (yield* AgentCatalog).read()).connections, [])
    }).pipe(Effect.provide(runtime(file)))
    return Effect.andThen(save, Effect.andThen(read, removed))
  })

  it.live('rejects an unsafe mode and invalid input without replacing a saved connection', () =>
    Effect.gen(function* () {
      const catalog = yield* AgentCatalog
      const spec = connection()
      yield* catalog.save(spec)
      for (const command of ['\0', ` ${spec.command}`])
        assert.include((yield* Effect.flip(catalog.save({ ...spec, command }))).message, 'executable')
      assert.include((yield* Effect.flip(catalog.check('acp-missing'))).message, 'Save the connection')
      const bad = yield* Effect.flip(catalog.save({ ...spec, mode: 'bypassPermissions' }))
      assert.include(bad.message, 'Choose modes')
      yield* Effect.flip(catalog.save({ ...spec, id: '../not-a-connection' }))
      assert.deepStrictEqual((yield* catalog.read()).connections[0]?.connection, spec)
    }).pipe(Effect.provide(runtime())),
  )

  it.live('returns while a check runs and reports a missing executable on that connection', () =>
    Effect.gen(function* () {
      const catalog = yield* AgentCatalog
      const spec = connection()
      yield* catalog.save(spec)
      yield* catalog.check(spec.id)
      const done = yield* until(catalog.read(), (read) => read.connections[0]?.state === 'failed')
      assert.isNotNull(done.connections[0]?.reason)
      assert.strictEqual((yield* Effect.flip((yield* Agents).get(spec.id)))._tag, 'UnknownAgent')
    }).pipe(Effect.provide(runtime())),
  )

  it.live('cancels a check that has not initialized without letting its late result restore the connection', () =>
    Effect.gen(function* () {
      const catalog = yield* AgentCatalog
      const sql = yield* SqlClient.SqlClient
      const spec = { ...connection(), command: 'bun', args: ['-e', 'setInterval(() => {}, 1000)'] }
      yield* catalog.save(spec)
      const revision = yield* catalog.check(spec.id)
      assert.strictEqual(yield* catalog.check(spec.id), revision)
      assert.include((yield* Effect.flip(catalog.save(spec))).message, 'Cancel the compatibility check')
      yield* until(sql<{ state: string }>`SELECT state FROM processes WHERE purpose = 'probe'`, (rows) =>
        rows.some((row) => row.state === 'launching'),
      )
      yield* catalog.remove(spec.id)
      yield* until(
        sql<{ endedAt: string | null }>`SELECT ended_at FROM processes WHERE purpose = 'probe'`,
        (rows) => rows.length > 0 && rows.every((row) => row.endedAt !== null),
      )
      assert.deepStrictEqual((yield* catalog.read()).connections, [])
      assert.strictEqual((yield* Effect.flip((yield* Agents).get(spec.id)))._tag, 'UnknownAgent')
    }).pipe(Effect.provide(runtime())),
  )
})

describe('registry metadata', () => {
  for (const [name, response] of [
    ['an oversized advertised response', () => new Response('{}', { headers: { 'content-length': '2000001' } })],
    ['an oversized streamed response', () => new Response('x'.repeat(2000001))],
    ['an empty response', () => new Response(null)],
    ['invalid metadata', () => new Response('not json')],
  ] as const)
    it.live(`retains the setup profiles after ${name}`, () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => response()),
      )
      return Effect.gen(function* () {
        const catalog = yield* AgentCatalog
        yield* catalog.read(true)
        const result = yield* until(catalog.read(), (state) => !state.refreshing)
        assert.isNotNull(result.problem)
        assert.isTrue(result.items.some((one) => one.id === 'cursor'))
        assert.isEmpty(result.connections)
      }).pipe(Effect.provide(runtime()))
    })

  it.live('preserves mode-less profiles, environment and mode options, platform gaps and known blockers across a restart', () => {
    const file = database()
    const agents = ['pi-acp', 'muse-code', 'letta', 'devin'].map((id) => ({
      id,
      name: id,
      version: '1.2.3',
      repository: 'https://example.test/source',
      distribution: { npx: { package: `${id}@1.2.3`, env: { EXTRA: 'kept' } } },
    }))
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              agents: [
                ...agents,
                {
                  id: 'unsupported',
                  name: 'Unsupported',
                  version: '1',
                  website: 'https://example.test/setup',
                  distribution: { binary: { 'missing-platform': { cmd: 'missing' } } },
                },
              ],
            }),
          ),
      ),
    )
    const verify = (refresh: boolean) =>
      Effect.gen(function* () {
        const catalog = yield* AgentCatalog
        if (refresh) yield* catalog.read(true)
        const result = yield* until(catalog.read(), (state) => !state.refreshing)
        assert.strictEqual(result.items.find((one) => one.id === 'pi-acp')?.mode, null)
        assert.strictEqual(result.items.find((one) => one.id === 'letta')?.modeOption, 'permissions')
        assert.deepInclude(result.items.find((one) => one.id === 'muse-code')?.env, { EXTRA: 'kept', MUSE_EXPERIMENTAL_ACP: 'on' })
        assert.strictEqual(result.items.find((one) => one.id === 'unsupported')?.command, null)
        assert.include(result.items.find((one) => one.id === 'devin')?.problem ?? '', 'edits')
        assert.strictEqual(result.items.find((one) => one.id === 'devin')?.command, null)
      }).pipe(Effect.provide(runtime(file)))
    return Effect.andThen(verify(true), verify(false))
  })
  const index = {
    agents: [
      {
        id: 'example',
        name: 'Example Agent',
        version: '1.2.3',
        description: 'A test agent',
        distribution: { npx: { package: 'example@1.2.3', args: ['--acp'] } },
      },
    ],
  }
  it.live('refreshes behind the read, retains the last good catalog after a failure, and never saves a connection by browsing', () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(index)))
    vi.stubGlobal('fetch', fetch)
    return Effect.gen(function* () {
      const catalog = yield* AgentCatalog
      const first = yield* catalog.read(true)
      assert.isTrue(first.refreshing)
      const loaded = yield* until(catalog.read(), (read) => !read.refreshing)
      assert.strictEqual(loaded.items.find((one) => one.id === 'example')?.version, '1.2.3')
      assert.deepStrictEqual(loaded.connections, [])
      fetch.mockImplementation(async () => new Response('wrong', { status: 503 }))
      yield* catalog.read(true)
      const failed = yield* until(catalog.read(), (read) => !read.refreshing)
      assert.include(failed.problem ?? '', '503')
      assert.isTrue(failed.items.some((one) => one.id === 'example'))
    }).pipe(Effect.provide(runtime()))
  })
})
