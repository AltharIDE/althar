import { createHash, randomBytes, X509Certificate } from 'node:crypto'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request, type Agent } from 'node:https'

import { API_VERSION, clientChallengeMessage, type PairingCode } from '@althar/contracts'
import {
  apiClient,
  completeDevicePairing,
  createDeviceKey,
  openHttpsConnection,
  signDeviceMessage,
  tlsPublicKeyPin,
  homeHttpsAgent,
} from '@althar/transport-node'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Exit, Scope } from 'effect'

import { services } from '../src/Api'
import { DevicePairings } from '../src/DevicePairings'
import { Instance } from '../src/Instance'
import { ClientIdentities } from '../src/ClientIdentities'
import { listenNetworkApi } from '../src/networkApi'
import { Secrets } from '../src/Secrets'
import { Projects } from '../src/Projects'
import { envelope } from '../src/envelope'
import { fakeAgents, fakeConnectors, repository, ROOMY } from './support'

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
    tlsCertificate: new X509Certificate(certificate).raw.toString('base64url'),
    origin: `https://127.0.0.1:${network.port}`,
  }
  return { instance, pairings, code }
})

const probe = (origin: string, agent: Agent, headers: Record<string, string> = {}, path = '/v1/info', body?: string) =>
  Effect.promise(
    () =>
      new Promise<number>((resolve) => {
        const req = request(
          new URL(path, origin),
          {
            agent,
            method: body === undefined ? 'GET' : 'POST',
            headers,
          },
          (response) => {
            response.resume()
            resolve(response.statusCode ?? 0)
          },
        )
        req.once('error', () => resolve(0))
        req.once('upgrade', (_response, socket) => {
          socket.destroy()
          resolve(101)
        })
        req.end(body)
      }),
  )

describe('direct HTTPS and WSS home connections', () => {
  it.live('rejects foreign browser origins, host headers, malformed bodies and repeated device proofs before admitting RPC', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { code } = yield* home
        const agent = yield* homeHttpsAgent(code.origin, code)
        assert.strictEqual(yield* probe(code.origin, agent), 200)
        assert.strictEqual(yield* probe(code.origin, agent, { origin: 'https://foreign.test' }), 403)
        assert.strictEqual(yield* probe(code.origin, agent, { host: 'foreign.test' }), 403)
        assert.strictEqual(yield* probe(code.origin, agent, { 'content-type': 'application/json' }, '/v1/pairing/complete', '{'), 403)
        assert.strictEqual(yield* probe(code.origin, agent, { 'content-type': 'application/json' }, '/v1/missing', '{}'), 404)
        assert.strictEqual(yield* probe(code.origin, agent, { 'content-type': 'text/plain' }, '/v1/pairing/complete', '{}'), 403)
        assert.strictEqual(
          yield* probe(code.origin, agent, { 'content-type': 'application/json' }, '/v1/pairing/complete', 'x'.repeat(16 * 1024 + 1)),
          0,
        )
        const key = yield* createDeviceKey
        const target = yield* completeDevicePairing(code, key, 'Desktop')
        const identities = yield* ClientIdentities
        const challenge = yield* identities.challenge(target.deviceId)
        const signature = yield* signDeviceMessage(key.privateKey, clientChallengeMessage(challenge))
        const headers = {
          connection: 'Upgrade',
          upgrade: 'websocket',
          'sec-websocket-version': '13',
          'sec-websocket-key': randomBytes(16).toString('base64'),
          authorization: `Althar-Device ${Buffer.from(JSON.stringify({ challenge, signature })).toString('base64url')}`,
        }
        assert.strictEqual(yield* probe(code.origin, agent, { ...headers, authorization: 'Althar-Device invalid' }, '/v1/api'), 0)
        assert.strictEqual(yield* probe(code.origin, agent, headers, '/v1/api'), 101)
        assert.strictEqual(yield* probe(code.origin, agent, headers, '/v1/api'), 0)
        const statuses = yield* Effect.forEach(Array.from({ length: 60 }), () => probe(code.origin, agent))
        assert.include(statuses, 429)
      }).pipe(Effect.provide(environment)),
    ),
  )

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

  it.live('records a remote task exactly once and reads it after reconnecting with the saved device key', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { code } = yield* home
        const project = yield* (yield* Projects).open({ envelope: yield* envelope('project.open', {}), path: repository() })
        const key = yield* createDeviceKey
        const target = yield* completeDevicePairing(code, key, 'Desktop')
        const scope = yield* Scope.make()
        const { api } = yield* Effect.gen(function* () {
          return yield* apiClient(yield* openHttpsConnection(target, (message) => signDeviceMessage(key.privateKey, message)))
        }).pipe(Scope.provide(scope))
        const command = { commandId: commandId(), projectId: project.projectId, title: 'Created over WSS' }
        const task = yield* api.CreateTask(command)
        assert.strictEqual((yield* api.CreateTask(command)).id, task.id)
        yield* Scope.close(scope, Exit.void)
        const again = yield* apiClient(yield* openHttpsConnection(target, (message) => signDeviceMessage(key.privateKey, message)))
        assert.strictEqual(again.info.identity.deviceId, target.deviceId)
        assert.strictEqual((yield* again.api.GetThread({ threadId: task.threadId })).task.title, command.title)
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
