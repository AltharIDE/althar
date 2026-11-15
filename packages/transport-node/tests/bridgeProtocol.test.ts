import { PassThrough } from 'node:stream'

import { API_VERSION } from '@althar/contracts'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { receiveBridgeIdentity, socketReady } from '../src/bridgeProtocol'
import { streamPort } from '../src/streamPort'

const homeId = `home_${'1'.repeat(32)}`
const identity = { homeId, actorId: `act_${'2'.repeat(32)}`, deviceId: `dev_${'3'.repeat(32)}`, role: 'socket' as const }
const withPorts = async (exercise: (client: ReturnType<typeof streamPort>, server: ReturnType<typeof streamPort>) => Promise<void>) => {
  const left = new PassThrough()
  const right = new PassThrough()
  const client = streamPort({ readable: left, writable: right })
  const server = streamPort({ readable: right, writable: left })
  try {
    await exercise(client, server)
  } finally {
    client.close()
    server.close()
  }
}
describe('the socket-only SSH bridge handshake', () => {
  it('pins identity and preserves an RPC frame arriving with readiness', async () =>
    withPorts(async (client, server) => {
      server.post(socketReady(identity))
      server.post([0])
      expect(await Effect.runPromise(receiveBridgeIdentity(client, homeId))).toEqual(identity)
      const heard: unknown[] = []
      client.listen((value) => {
        heard.push(value)
      })
      await Promise.resolve()
      expect(heard).toEqual([[0]])
    }))
  it('refuses an unexpected home, API, authority, rejection or malformed reply', async () => {
    for (const [reply, reason] of [
      [{ ...socketReady(identity), identity: { ...identity, homeId: `home_${'4'.repeat(32)}` } }, 'HomeMismatch'],
      [{ ...socketReady(identity), apiVersion: API_VERSION + 1 }, 'ApiVersionMismatch'],
      [{ ...socketReady(identity), identity: { ...identity, role: 'window' } }, 'AuthenticationFailed'],
      [{ type: 'BridgeRejected', protocol: 1, reason: 'HostUnavailable' }, 'HostUnavailable'],
      [{ type: 'not a host' }, 'AuthenticationFailed'],
    ] as const)
      await withPorts(async (client, server) => {
        server.post(reply)
        expect(await Effect.runPromise(Effect.flip(receiveBridgeIdentity(client, homeId)))).toMatchObject({ reason })
      })
    await withPorts(async (client) => {
      expect(await Effect.runPromise(Effect.flip(receiveBridgeIdentity(client, 'untrusted')))).toMatchObject({
        reason: 'InvalidConnection',
      })
    })
  })
})
