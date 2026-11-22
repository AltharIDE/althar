import { randomBytes, verify, createPublicKey, X509Certificate } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:https'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'

import {
  API_VERSION,
  ApiError,
  ConnectionInfo,
  PairingRegistration,
  clientChallengeMessage,
  pairingRegistrationMessage,
  serverProtocol,
} from '@althar/contracts'
import { assert, describe, it } from '@effect/vitest'
import { Clock, Deferred, Effect, Layer, Schema } from 'effect'
import { TestClock } from 'effect/testing'
import { Rpc, RpcGroup, RpcServer } from 'effect/rpc'

import { homeHttpsAgent, httpsJson, httpsOrigin, tlsPublicKeyPin } from '../src/https'
import { createDeviceKey, decodePairingCode, encodePairingCode, completeDevicePairing, signDeviceMessage } from '../src/pairing'
import {
  openHttpsConnection,
  prepareApprovalKeyEnrollment,
  preparePermissionApproval,
  webSocketPort,
  webSocketServer,
} from '../src/webSocket'
import { apiClient } from '../src/client'
import { readFrame } from '../src/authentication'

const certificate = readFileSync(new URL('./fixtures/tls/certificate.pem', import.meta.url))
const key = readFileSync(new URL('./fixtures/tls/key.pem', import.meta.url))
const homeId = `home_${'1'.repeat(32)}`
const deviceId = `dev_${'2'.repeat(32)}`
const identity = { homeId, deviceId, actorId: `act_${'3'.repeat(32)}`, role: 'socket' as const }
const pin = tlsPublicKeyPin(certificate)
const trust = { tlsKeyPin: pin, tlsCertificate: new X509Certificate(certificate).raw.toString('base64url') }
const Mini = RpcGroup.make(Rpc.make('GetConnectionInfo', { payload: {}, success: ConnectionInfo, error: ApiError }))
const info = {
  identity,
  hostDeviceId: `dev_${'4'.repeat(32)}`,
  apiVersion: API_VERSION,
  appVersion: 'test',
  position: { homeId, cursor: 0, checkpoint: null },
}

const fixture = (handler: (request: IncomingMessage, response: ServerResponse) => void, tls = { cert: certificate, key }) =>
  Effect.gen(function* () {
    const sockets = new Set<Duplex>()
    const server = createServer({ ...tls, minVersion: 'TLSv1.2' }, handler)
    server.on('connection', (socket) => {
      sockets.add(socket)
      socket.once('close', () => sockets.delete(socket))
    })
    yield* Effect.addFinalizer(() =>
      Effect.promise(
        () =>
          new Promise<void>((resolve) => {
            for (const socket of sockets) socket.destroy()
            server.close(() => resolve())
          }),
      ),
    )
    yield* Effect.promise(() => new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('No fixture port')
    return { server, origin: `https://127.0.0.1:${address.port}` }
  })
const json = (response: ServerResponse, value: unknown) => {
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify(value))
}
const body = (request: IncomingMessage, done: (value: unknown) => void) => {
  const chunks: Buffer[] = []
  request.on('data', (chunk: Buffer) => chunks.push(chunk))
  request.once('end', () => done(JSON.parse(Buffer.concat(chunks).toString('utf8'))))
}
const serveRpc = (server: Server, ready: unknown = { type: 'Authenticated', identity, apiVersion: API_VERSION }) =>
  Effect.gen(function* () {
    const ws = webSocketServer()
    const scope = yield* Effect.scope
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        ws.close()
      }),
    )
    server.on('upgrade', (request, socket, head) => {
      assert.match(request.headers.authorization ?? '', /^Althar-Device /)
      ws.handleUpgrade(request, socket, head, (webSocket) => {
        const port = webSocketPort(webSocket)
        port.post(ready)
        Effect.runFork(
          Effect.forkIn(
            Layer.launch(
              RpcServer.layer(Mini).pipe(
                Layer.provide(Mini.toLayer({ GetConnectionInfo: () => Effect.succeed(info) })),
                Layer.provide(serverProtocol(port)),
              ),
            ),
            scope,
          ),
        )
      })
    })
  })

describe('secure bootstrap and device keys', () => {
  it.live('opens security-key pages only on the pinned home and reads the home’s decision receipt', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const key = yield* createDeviceKey
        const code = 'a'.repeat(43)
        let path = `/approve-permission#${code}`
        let receipt = 'accepted'
        let signed = 0
        const server = yield* fixture((request, response) => {
          switch (request.url) {
            case '/v1/connections/challenge':
              request.resume()
              json(response, { protocol: 1, homeId, deviceId, apiVersion: API_VERSION, nonce: code, expiresAt: 50_000 })
              break
            case '/v1/approval-keys':
              request.resume()
              assert.match(request.headers.authorization ?? '', /^Althar-Device /)
              signed++
              json(response, { path: `/enroll-approval-key#${code}` })
              break
            case '/v1/permission-approvals':
              assert.match(request.headers.authorization ?? '', /^Althar-Device /)
              signed++
              body(request, (value) => {
                assert.deepStrictEqual(value, action)
                json(response, { path })
              })
              break
            case '/v1/permission-approvals/result':
              body(request, (value) => {
                assert.deepStrictEqual(value, { code })
                json(response, { state: receipt })
              })
              break
            default:
              response.writeHead(404).end()
          }
        })
        const target = { ...trust, origin: server.origin, homeId, deviceId }
        const sign = (message: string) => signDeviceMessage(key.privateKey, message)
        const action = { commandId: `cmd_${'1'.repeat(32)}`, attentionId: 'ask', decision: 'allow' as const }
        assert.strictEqual(yield* prepareApprovalKeyEnrollment(target, sign), `${server.origin}/enroll-approval-key#${code}`)
        const approval = yield* preparePermissionApproval(target, sign, action)
        assert.strictEqual(approval.url, `${server.origin}${path}`)
        yield* approval.wait
        receipt = 'refused'
        assert.strictEqual((yield* Effect.flip(approval.wait)).reason, 'ApprovalUnavailable')
        path = `https://other.example/approve-permission#${code}`
        assert.strictEqual((yield* Effect.flip(preparePermissionApproval(target, sign, action))).reason, 'ApprovalUnavailable')
        assert.strictEqual(signed, 3)
      }),
    ),
  )

  it.live('round-trips an operator code and proves possession of the generated key', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const device = yield* createDeviceKey
        const at = yield* Clock.currentTimeMillis
        const server = yield* fixture((request, response) =>
          body(request, (raw) => {
            const input = Schema.decodeUnknownSync(PairingRegistration)(raw)
            assert.isTrue(
              verify(
                null,
                Buffer.from(pairingRegistrationMessage(input)),
                createPublicKey({ format: 'jwk', key: { kty: 'OKP', crv: 'Ed25519', x: input.publicKey } }),
                Buffer.from(input.signature, 'base64url'),
              ),
            )
            json(response, {
              homeId,
              apiVersion: API_VERSION,
              device: {
                deviceId,
                name: input.name,
                publicKey: input.publicKey,
                role: 'socket',
                revision: 1,
                createdAt: '2020-01-01T00:00:00.000Z',
                revokedAt: null,
              },
            })
          }),
        )
        const code = {
          protocol: 1 as const,
          homeId,
          apiVersion: API_VERSION,
          origin: server.origin,
          ...trust,
          token: randomBytes(32).toString('base64url'),
          expiresAt: at + 60_000,
        }
        const decoded = decodePairingCode(encodePairingCode(code))
        assert.deepStrictEqual(decoded, code)
        const target = yield* completeDevicePairing(decoded, device, 'Desktop')
        assert.deepStrictEqual(target, { origin: server.origin, ...trust, homeId, deviceId })
        yield* Effect.flip(completeDevicePairing({ ...code, expiresAt: 0 }, device, 'Desktop'))
      }),
    ),
  )

  it.live('refuses malformed codes, insecure origins and invalid private keys', () =>
    Effect.gen(function* () {
      for (const origin of [
        'http://home.test',
        'https://user:secret@home.test',
        'https://home.test/path',
        'https://home.test?q=1',
        'https://home.test#fragment',
        'https://home.test\n',
        '',
      ])
        assert.throws(() => httpsOrigin(origin))
      assert.strictEqual(httpsOrigin('https://HOME.test:443/'), 'https://home.test')
      for (const code of ['', 'not-a-code', `althar-pairing1.${'a'.repeat(8192)}`, 'althar-pairing1.e30', 'althar-pairing1._w'])
        assert.throws(() => decodePairingCode(code))
      for (const privateKey of ['bad', 'A'.repeat(64)])
        assert.strictEqual((yield* Effect.flip(signDeviceMessage(privateKey, 'proof'))).reason, 'AuthenticationFailed')
    }),
  )

  it.live('validates the certificate chain and pin before sending a request', () =>
    Effect.scoped(
      Effect.gen(function* () {
        let requests = 0
        const server = yield* fixture((_request, response) => {
          requests++
          json(response, { ok: true })
        })
        const clock = yield* Clock.Clock
        let now = clock.currentTimeMillisUnsafe()
        const trusted = yield* homeHttpsAgent(server.origin, trust).pipe(
          Effect.provideService(Clock.Clock, {
            currentTimeMillisUnsafe: () => now,
            currentTimeMillis: clock.currentTimeMillis,
            currentTimeNanosUnsafe: () => clock.currentTimeNanosUnsafe(),
            currentTimeNanos: clock.currentTimeNanos,
            monotonicTimeNanosUnsafe: () => clock.monotonicTimeNanosUnsafe(),
            monotonicTimeNanos: clock.monotonicTimeNanos,
            sleep: (duration) => clock.sleep(duration),
          }),
        )
        assert.deepStrictEqual(yield* httpsJson(server.origin, '/v1/info', trusted), { ok: true })
        // A long-lived client must recheck validity on every new TLS connection.
        now = Date.parse(new X509Certificate(certificate).validTo)
        yield* Effect.flip(httpsJson(server.origin, '/v1/info', trusted))
        now = Date.parse(new X509Certificate(certificate).validFrom) - 1
        yield* Effect.flip(httpsJson(server.origin, '/v1/info', trusted))
        yield* Effect.flip(homeHttpsAgent(server.origin, { ...trust, tlsKeyPin: '0'.repeat(64) }))
        const ordinary = yield* homeHttpsAgent(server.origin)
        yield* Effect.flip(httpsJson(server.origin, '/v1/info', ordinary))
        yield* Effect.flip(homeHttpsAgent(server.origin, { ...trust, tlsCertificate: 'bad' }))
        assert.strictEqual(requests, 1)
      }),
    ),
  )

  it.live('accepts a renewed certificate under the trusted chain only with the pinned key', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const renewed = readFileSync(new URL('./fixtures/tls/renewed-certificate.pem', import.meta.url))
        const other = readFileSync(new URL('./fixtures/tls/other-certificate.pem', import.meta.url))
        const otherKey = readFileSync(new URL('./fixtures/tls/other-key.pem', import.meta.url))
        let requests = 0
        const handle = (_request: IncomingMessage, response: ServerResponse) => {
          requests++
          json(response, { ok: true })
        }
        const match = yield* fixture(handle, { cert: renewed, key })
        const good = yield* homeHttpsAgent(match.origin, trust)
        assert.deepStrictEqual(yield* httpsJson(match.origin, '/v1/info', good), { ok: true })
        const mismatch = yield* fixture(handle, { cert: other, key: otherKey })
        const rejected = yield* homeHttpsAgent(mismatch.origin, trust)
        yield* Effect.flip(httpsJson(mismatch.origin, '/v1/pairing/complete', rejected, { token: 'fixture' }))
        assert.strictEqual(requests, 1)
      }),
    ),
  )

  it.live('bounds both request and response bodies and refuses redirects, non-JSON and interrupted replies', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* fixture((request, response) => {
          if (request.url === '/redirect') {
            response.writeHead(302, { location: '/ok' })
            response.end()
            return
          }
          if (request.url === '/large') {
            response.writeHead(200, { 'content-type': 'application/json' })
            response.end('a'.repeat(16 * 1024 + 1))
            return
          }
          if (request.url === '/cut') {
            response.writeHead(200, { 'content-type': 'application/json', 'content-length': '1000' })
            response.write('{}')
            response.destroy()
            return
          }
          response.writeHead(200, { 'content-type': request.url === '/text' ? 'text/plain' : 'application/json' })
          response.end('not-json')
        })
        const agent = yield* homeHttpsAgent(server.origin, trust)
        for (const path of ['/redirect', '/large', '/cut', '/text', '/invalid']) yield* Effect.flip(httpsJson(server.origin, path, agent))
        yield* Effect.flip(httpsJson(server.origin, '/request', agent, 'a'.repeat(16 * 1024)))
      }),
    ),
  )

  it.live('refuses pairing replies for a different home, key, API version or authority, including a revoked device', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const key = yield* createDeviceKey
        const device = {
          deviceId,
          name: 'Desktop',
          publicKey: key.publicKey,
          role: 'socket',
          revision: 1,
          createdAt: '2020-01-01T00:00:00.000Z',
          revokedAt: null,
        }
        for (const reply of [
          { homeId: `home_${'9'.repeat(32)}`, apiVersion: API_VERSION, device },
          { homeId, apiVersion: API_VERSION + 1, device },
          { homeId, apiVersion: API_VERSION, device: { ...device, publicKey: (yield* createDeviceKey).publicKey } },
          { homeId, apiVersion: API_VERSION, device: { ...device, role: 'paired_device' } },
          { homeId, apiVersion: API_VERSION, device: { ...device, revokedAt: '2020-01-02T00:00:00.000Z' } },
          null,
        ]) {
          const server = yield* fixture((_request, response) => json(response, reply))
          const error = yield* Effect.flip(
            completeDevicePairing(
              {
                protocol: 1,
                homeId,
                apiVersion: API_VERSION,
                origin: server.origin,
                ...trust,
                token: randomBytes(32).toString('base64url'),
                expiresAt: (yield* Clock.currentTimeMillis) + 60_000,
              },
              key,
              'Desktop',
            ),
          )
          assert.strictEqual(error.reason, 'InvalidConnection')
        }
      }),
    ),
  )
})

describe('authenticated WebSocket streams', () => {
  it.live('requires a new pairing code for preview targets saved without a certificate', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const failure = yield* Effect.flip(
          openHttpsConnection({ origin: 'https://127.0.0.1:1', homeId, deviceId, tlsKeyPin: pin }, () => Effect.die('Must not sign')),
        )
        assert.strictEqual(failure.reason, 'InvalidConnection')
        assert.include(failure.message, 'Pair it again')
      }),
    ),
  )

  it.effect('keeps responsive peers connected and retires a peer that stops answering pings', () =>
    Effect.scoped(
      Effect.gen(function* () {
        yield* TestClock.setTime(Date.now())
        for (const autoPong of [true, false])
          yield* Effect.scoped(
            Effect.gen(function* () {
              const challenge = {
                protocol: 1 as const,
                homeId,
                deviceId,
                apiVersion: API_VERSION,
                nonce: randomBytes(32).toString('base64url'),
                expiresAt: (yield* Clock.currentTimeMillis) + 30_000,
              }
              const server = yield* fixture((_request, response) => json(response, challenge))
              const ws = webSocketServer()
              ws.options.autoPong = autoPong
              yield* Effect.addFinalizer(() =>
                Effect.sync(() => {
                  ws.close()
                }),
              )
              server.server.on('upgrade', (request, socket, head) =>
                ws.handleUpgrade(request, socket, head, (peer) => {
                  const port = webSocketPort(peer)
                  peer.on('ping', () => port.post('ping-observed'))
                  port.post({ type: 'Authenticated', identity, apiVersion: API_VERSION })
                }),
              )
              const connection = yield* openHttpsConnection({ origin: server.origin, homeId, deviceId, ...trust }, () =>
                Effect.succeed('A'.repeat(86)),
              )
              const closed = yield* Deferred.make<void>()
              const stop = connection.port.closed(() => {
                Deferred.doneUnsafe(closed, Effect.void)
              })
              yield* Effect.addFinalizer(() => Effect.sync(stop))
              yield* TestClock.adjust('30 seconds')
              // The peer sends this frame after its automatic pong, if enabled.
              assert.strictEqual(yield* readFrame(connection.port), 'ping-observed')
              yield* TestClock.adjust('30 seconds')
              if (autoPong) {
                assert.strictEqual(yield* readFrame(connection.port), 'ping-observed')
                assert.isFalse(yield* Deferred.isDone(closed))
              } else {
                yield* Deferred.await(closed)
                yield* TestClock.adjust('30 seconds')
              }
            }),
          )
      }),
    ),
  )

  it.live('rejects an authenticated stream that returns malformed metadata or changes the device, home, API or authority', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const challenge = {
          protocol: 1 as const,
          homeId,
          deviceId,
          apiVersion: API_VERSION,
          nonce: randomBytes(32).toString('base64url'),
          expiresAt: (yield* Clock.currentTimeMillis) + 30_000,
        }
        for (const ready of [
          {},
          { type: 'Authenticated', apiVersion: API_VERSION, identity: { ...identity, homeId: `home_${'9'.repeat(32)}` } },
          { type: 'Authenticated', apiVersion: API_VERSION, identity: { ...identity, deviceId: `dev_${'9'.repeat(32)}` } },
          { type: 'Authenticated', apiVersion: API_VERSION, identity: { ...identity, role: 'paired_device' } },
          { type: 'Authenticated', apiVersion: API_VERSION + 1, identity },
        ]) {
          const server = yield* fixture((_request, response) => json(response, challenge))
          yield* serveRpc(server.server, ready)
          const error = yield* Effect.flip(
            openHttpsConnection({ origin: server.origin, homeId, deviceId, ...trust }, () => Effect.succeed('A'.repeat(86))),
          )
          assert.strictEqual(error.reason, 'AuthenticationFailed')
        }
      }),
    ),
  )

  it.live('carries the existing versioned RPC through the binary stream and checks its authenticated identity', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const at = yield* Clock.currentTimeMillis
        const challenge = {
          protocol: 1 as const,
          homeId,
          deviceId,
          apiVersion: API_VERSION,
          nonce: randomBytes(32).toString('base64url'),
          expiresAt: at + 30_000,
        }
        const device = yield* createDeviceKey
        const server = yield* fixture((_request, response) => json(response, challenge))
        yield* serveRpc(server.server)
        const connection = yield* openHttpsConnection({ origin: server.origin, homeId, deviceId, ...trust }, (message) => {
          assert.strictEqual(message, clientChallengeMessage(challenge))
          return signDeviceMessage(device.privateKey, message)
        })
        assert.deepStrictEqual((yield* apiClient(connection)).info, info)
      }),
    ),
  )

  it.live('never signs a challenge for another home, device or API version', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const at = yield* Clock.currentTimeMillis
        const challenge = {
          protocol: 1 as const,
          homeId,
          deviceId,
          apiVersion: API_VERSION,
          nonce: randomBytes(32).toString('base64url'),
          expiresAt: at + 30_000,
        }
        for (const changed of [
          { homeId: `home_${'9'.repeat(32)}` },
          { deviceId: `dev_${'9'.repeat(32)}` },
          { apiVersion: API_VERSION + 1 },
          { nonce: 'bad' },
        ]) {
          const server = yield* fixture((_request, response) => json(response, { ...challenge, ...changed }))
          let signed = false
          yield* Effect.flip(
            openHttpsConnection({ origin: server.origin, homeId, deviceId, ...trust }, () =>
              Effect.sync(() => {
                signed = true
                return 'A'.repeat(86)
              }),
            ),
          )
          assert.isFalse(signed)
        }
      }),
    ),
  )
})
