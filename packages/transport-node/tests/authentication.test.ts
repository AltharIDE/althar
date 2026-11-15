import { MessageChannel } from 'node:worker_threads'
import { API_VERSION, emitterPort } from '@althar/contracts'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { authenticateApiClient } from '../src/authentication'

describe('shared client authentication', () => {
  it.live('never signs a challenge for another home, device or API version', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const homeId = `home_${'1'.repeat(32)}`
        const deviceId = `dev_${'2'.repeat(32)}`
        const challenge = { protocol: 1, homeId, deviceId, apiVersion: API_VERSION, nonce: 'A'.repeat(43), expiresAt: Date.now() + 30_000 }
        for (const changed of [
          { homeId: `home_${'3'.repeat(32)}` },
          { deviceId: `dev_${'4'.repeat(32)}` },
          { apiVersion: API_VERSION + 1 },
        ]) {
          const channel = new MessageChannel()
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              channel.port1.close()
              channel.port2.close()
            }),
          )
          channel.port1.on('message', () => channel.port1.postMessage({ ...challenge, ...changed }))
          let signed = false
          const refused = yield* Effect.flip(
            authenticateApiClient(emitterPort(channel.port2), homeId, {
              kind: 'device',
              deviceId,
              sign: () =>
                Effect.sync(() => {
                  signed = true
                  return 'A'.repeat(86)
                }),
            }),
          )
          assert.strictEqual(refused.reason, 'AuthenticationFailed')
          assert.isFalse(signed)
        }
      }),
    ),
  )

  it.live('rejects a successful handshake for another home or version, or one that upgrades launch-secret authority', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const homeId = `home_${'1'.repeat(32)}`
        const identity = { homeId, actorId: `act_${'2'.repeat(32)}`, deviceId: `dev_${'3'.repeat(32)}`, role: 'socket' }
        for (const changed of [
          { identity: { ...identity, homeId: `home_${'4'.repeat(32)}` } },
          { apiVersion: API_VERSION + 1 },
          { identity: { ...identity, role: 'window' } },
        ]) {
          const channel = new MessageChannel()
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              channel.port1.close()
              channel.port2.close()
            }),
          )
          channel.port1.on('message', () =>
            channel.port1.postMessage({ type: 'Authenticated', identity, apiVersion: API_VERSION, ...changed }),
          )
          const refused = yield* Effect.flip(
            authenticateApiClient(emitterPort(channel.port2), homeId, { kind: 'secret', secret: '0'.repeat(64) }),
          )
          assert.strictEqual(refused.reason, 'AuthenticationFailed')
        }
      }),
    ),
  )
})
