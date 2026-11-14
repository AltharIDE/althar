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

import { AgentCatalog } from '../src/AgentCatalog'
import { Agents } from '../src/Config'
import { Instance } from '../src/Instance'
import { Models } from '../src/Models'
import { runtime as baseRuntime, fakeAgents } from './support'
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
      yield* catalog.check(spec.id)
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
