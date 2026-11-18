// @vitest-environment node
import {
  apiLayer,
  Api,
  type ApiHandlers,
  ClientAuthority,
  type ClientIdentity,
  type ConnectionInfo,
  type DomMessagePort,
  emitterPort,
  serverProtocol,
} from '@althar/contracts'
import { Effect, Exit, Layer, Scope, Stream } from 'effect'
import { RpcServer } from 'effect/rpc'
import { afterEach, expect, it, vi } from 'vitest'

import { waitFor } from '@althar/testing'
import { home as homeSnapshot } from './fixtures'
import { connect } from '../src/renderer/data/client'

const identity: ClientIdentity = {
  homeId: `home_${'1'.repeat(32)}`,
  actorId: `act_${'2'.repeat(32)}`,
  deviceId: `dev_${'3'.repeat(32)}`,
  role: 'socket',
}
const info: ConnectionInfo = {
  identity,
  hostDeviceId: identity.deviceId,
  apiVersion: 1,
  appVersion: 'fixture',
  position: { homeId: identity.homeId, cursor: 0, checkpoint: null },
}
const scopes: Scope.Closeable[] = []
afterEach(async () => {
  for (const scope of scopes.splice(0)) await Effect.runPromise(Scope.close(scope, Exit.void))
})
const server = async (reply: ConnectionInfo) => {
  const channel = new MessageChannel()
  const called = vi.fn()
  const handlers = new Proxy(
    {},
    {
      get: (_target, tag: string) => () => {
        called(tag)
        return tag === 'CreateTask'
          ? Effect.die('Fixture connection failed')
          : tag === 'WatchFrom'
            ? Stream.never
            : Effect.succeed(tag === 'GetHome' ? homeSnapshot() : reply)
      },
    },
  )
  const layer = RpcServer.layer(Api).pipe(
    Layer.provide(Layer.succeed(ClientAuthority, (effect) => effect)),
    Layer.provide(apiLayer(handlers as ApiHandlers)),
    Layer.provide(serverProtocol(emitterPort(channel.port1 as never, (data) => data))),
  ) as Layer.Layer<never>
  const scope = await Effect.runPromise(Scope.make())
  scopes.push(scope)
  await Effect.runPromise(Effect.forkIn(Layer.launch(layer), scope))
  return { port: channel.port2 as unknown as DomMessagePort, called }
}
it('checks remote identity before exposing the client and refuses person-only methods before sending them', async () => {
  const at = await server(info)
  const client = await connect(at.port, identity)
  try {
    expect(client.connection).toEqual(info)
    await expect(client.answer({ attentionId: 'permission', decision: 'allow' })).rejects.toMatchObject({ reason: 'PersonRequired' })
    expect(at.called.mock.calls).toEqual([['GetConnectionInfo']])
    expect(() => client.watch(() => {}, 12)).toThrow()
  } finally {
    await client.close()
  }
})
it('fails closed for a changed home, actor, device, authority, API or checked position', async () => {
  for (const reply of [
    { ...info, identity: { ...identity, homeId: `home_${'4'.repeat(32)}` } },
    { ...info, identity: { ...identity, actorId: `act_${'4'.repeat(32)}` } },
    { ...info, identity: { ...identity, deviceId: `dev_${'4'.repeat(32)}` } },
    { ...info, identity: { ...identity, role: 'window' as const } },
    { ...info, apiVersion: 2 },
    { ...info, position: { ...info.position, homeId: `home_${'4'.repeat(32)}` } },
  ]) {
    const at = await server(reply)
    await expect(connect(at.port, identity)).rejects.toBeDefined()
    expect(at.called.mock.calls).toEqual([['GetConnectionInfo']])
  }
})

it('loads the home while its checked change feed remains open', async () => {
  const at = await server(info)
  const client = await connect(at.port, identity)
  const stop = client.watch(() => {}, info.position)
  try {
    await waitFor(
      async () => at.called.mock.calls,
      (calls) => calls.some(([tag]) => tag === 'WatchFrom'),
    )
    expect(await client.getHome()).toEqual(homeSnapshot())
    expect(at.called.mock.calls).toContainEqual(['WatchFrom'])
    expect(at.called.mock.calls).toContainEqual(['GetHome'])
  } finally {
    stop()
    await client.close()
  }
})

it('does not replay a remote command when its response fails unexpectedly', async () => {
  const at = await server(info)
  const client = await connect(at.port, identity)
  try {
    await expect(client.createTask({ projectId: 'fixture', title: 'Once' })).rejects.toBeDefined()
    expect(at.called.mock.calls.filter(([tag]) => tag === 'CreateTask')).toHaveLength(1)
  } finally {
    await client.close()
  }
})
