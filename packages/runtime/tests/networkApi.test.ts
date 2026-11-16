import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { API_VERSION, type PairingCode } from '@althar/contracts'
import {
  apiClient,
  completeDevicePairing,
  createDeviceKey,
  openHttpsConnection,
  signDeviceMessage,
  tlsPublicKeyPin,
} from '@althar/transport-node'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'

import { services } from '../src/Api'
import { DevicePairings } from '../src/DevicePairings'
import { Instance } from '../src/Instance'
import { listenNetworkApi } from '../src/networkApi'
import { Secrets } from '../src/Secrets'
import { fakeAgents, fakeConnectors, ROOMY } from './support'

const certificate = readFileSync(new URL('../../transport-node/tests/fixtures/tls/certificate.pem', import.meta.url))
const key = readFileSync(new URL('../../transport-node/tests/fixtures/tls/key.pem', import.meta.url))
const pin = tlsPublicKeyPin(certificate)
const commandId = () => `cmd_${randomBytes(16).toString('hex')}`
const environment = services({
  database: ':memory:',
  worktreeRoot: mkdtempSync(join(tmpdir(), 'althar-network-work-')),
  appVersion: 'test',
  deviceName: 'Host',
  agents: fakeAgents(),
  secrets: Secrets.memory(),
  connectors: fakeConnectors({}),
  busy: { machine: ROOMY },
})
const home = Effect.gen(function* () {
  const instance = yield* Instance
  const pairings = yield* DevicePairings
  const network = yield* listenNetworkApi({
    origin: 'https://127.0.0.1:0',
    address: '127.0.0.1',
    port: 0,
    certificate,
    key,
    version: 'test',
  })
  const token = randomBytes(32).toString('base64url')
  const invitation = yield* pairings.issue(createHash('sha256').update(token).digest('hex'))
  const code: PairingCode = {
    protocol: 1,
    apiVersion: API_VERSION,
    ...invitation,
    token,
    tlsKeyPin: pin,
    origin: `https://127.0.0.1:${network.port}`,
  }
  return { instance, pairings, code }
})

describe('direct HTTPS and WSS home connections', () => {
  it.live('pairs once and reconnects to the shared API without an invitation, relay or private socket secret', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { instance, code } = yield* home
        const key = yield* createDeviceKey
        const target = yield* completeDevicePairing(code, key, 'Desktop')
        const connect = Effect.scoped(
          Effect.gen(function* () {
            const connection = yield* openHttpsConnection(target, (message) => signDeviceMessage(key.privateKey, message))
            const { api, info } = yield* apiClient(connection)
            assert.strictEqual(info.identity.homeId, instance.homeId)
            assert.strictEqual(info.identity.deviceId, target.deviceId)
            assert.strictEqual(info.identity.role, 'socket')
            assert.strictEqual((yield* api.ListProjects()).projects.length, 0)
          }),
        )
        yield* connect
        yield* connect
        const retry = yield* completeDevicePairing(code, key, 'Desktop')
        assert.strictEqual(retry.deviceId, target.deviceId)
      }).pipe(Effect.provide(environment)),
    ),
  )

  it.live('never sends the invitation to a host with the wrong TLS key', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { code } = yield* home
        const key = yield* createDeviceKey
        yield* Effect.flip(completeDevicePairing({ ...code, tlsKeyPin: '0'.repeat(64) }, key, 'Desktop'))
        // The failed TLS connection did not consume the invitation.
        yield* completeDevicePairing(code, key, 'Desktop')
      }).pipe(Effect.provide(environment)),
    ),
  )

  it.live('refuses remote enrollment, key management and person-only authority through an authenticated connection', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { code } = yield* home
        const key = yield* createDeviceKey
        const target = yield* completeDevicePairing(code, key, 'Desktop')
        const { api } = yield* apiClient(yield* openHttpsConnection(target, (message) => signDeviceMessage(key.privateKey, message)))
        for (const action of [
          api.IssueDevicePairing({ commandId: commandId(), tokenHash: '1'.repeat(64) }),
          api.ListClientDevices({}),
          api.RevokeConnectionDevice({ commandId: commandId(), deviceId: target.deviceId }),
        ])
          assert.strictEqual((yield* Effect.flip(action.pipe(Effect.asVoid))).reason, 'Forbidden')
        assert.strictEqual(
          (yield* Effect.flip(api.RevokeClientDevice({ commandId: commandId(), deviceId: target.deviceId }))).reason,
          'PersonRequired',
        )
      }).pipe(Effect.provide(environment)),
    ),
  )

  it.live('closes a live connection on revocation and refuses reconnect and enrollment retries', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { pairings, code } = yield* home
        const key = yield* createDeviceKey
        const target = yield* completeDevicePairing(code, key, 'Desktop')
        const connection = yield* openHttpsConnection(target, (message) => signDeviceMessage(key.privateKey, message))
        yield* apiClient(connection)
        yield* pairings.revokeConnection(target.deviceId)
        yield* Effect.callback<void>((resume) => {
          const stop = connection.port.closed(() => resume(Effect.void))
          return Effect.sync(stop)
        })
        yield* Effect.flip(openHttpsConnection(target, (message) => signDeviceMessage(key.privateKey, message)))
        yield* Effect.flip(completeDevicePairing(code, key, 'Desktop'))
      }).pipe(Effect.provide(environment)),
    ),
  )
})
