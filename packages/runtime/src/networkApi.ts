import { createServer } from 'node:https'
import { randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'

import { API_VERSION, ApiError, ClientChallenge, ClientDeviceId, ClientSignature, HomeId, PairingRegistration } from '@althar/contracts'
import { httpsOrigin, untilPortCloses, webSocketServer, webSocketPort, webSocketHeartbeat } from '@althar/transport-node'
import { Clock, Effect, Layer, Schema, type Scope } from 'effect'

import { connection } from './Api'
import { ClientIdentities } from './ClientIdentities'
import { DevicePairings } from './DevicePairings'
import { Instance } from './Instance'
import { networkPermissionApprovals } from './networkPermissionApprovals'
import { permissionApprovalPage } from './permissionApprovalPage'
import type { ApprovalCredentials } from './permissionApprovals'

const MAX_CONNECTIONS = 32
const MAX_BODY = 16 * 1024
const ChallengeRequest = Schema.Struct({ homeId: HomeId, deviceId: ClientDeviceId })
const Proof = Schema.Struct({ challenge: ClientChallenge, signature: ClientSignature })
const rejected = () => new ApiError({ reason: 'ConnectionRefused', message: 'The home refused this connection request.' })
type Services = Layer.Services<ReturnType<typeof connection>> | DevicePairings

export interface NetworkApiOptions {
  readonly origin: string
  readonly address: string
  readonly port: number
  readonly certificate: Buffer
  readonly key: Buffer
  readonly version: string
  readonly approvalCredentials?: ApprovalCredentials
}

const body = (request: IncomingMessage) =>
  Effect.tryPromise({
    try: (signal) =>
      new Promise<unknown>((resolve, reject) => {
        const chunks: Buffer[] = []
        let bytes = 0
        const abort = () => {
          request.destroy()
          reject(new Error('Cancelled request'))
        }
        signal.addEventListener('abort', abort, { once: true })
        const remove = () => signal.removeEventListener('abort', abort)
        request.once('close', remove)
        request.once('error', reject)
        request.once('aborted', () => reject(new Error('Interrupted request')))
        request.on('data', (chunk: Buffer) => {
          bytes += chunk.length
          if (bytes > MAX_BODY) {
            request.destroy()
            reject(new Error('Oversized request'))
            return
          }
          chunks.push(chunk)
        })
        request.once('end', () => {
          remove()
          try {
            resolve(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes))))
          } catch {
            reject(new Error('Malformed request'))
          }
        })
      }),
    catch: rejected,
  })

/** Opt-in HTTPS ingress. A device proof is consumed before upgrading to a large-frame RPC stream. */
export const listenNetworkApi = (given: NetworkApiOptions): Effect.Effect<{ port: number }, ApiError, Services | Scope.Scope> =>
  Effect.gen(function* () {
    const origin = new URL(httpsOrigin(given.origin))
    const identities = yield* ClientIdentities
    const pairings = yield* DevicePairings
    const instance = yield* Instance
    const approvals =
      given.approvalCredentials === undefined ? undefined : yield* networkPermissionApprovals(origin, given.approvalCredentials)
    const context = yield* Effect.context<Services | Scope.Scope>()
    const scope = yield* Effect.scope
    const sockets = new Set<Duplex>()
    const active = new Set<ReturnType<typeof webSocketPort>>()
    const buckets = new Map<string, { until: number; count: number }>()
    let inFlight = 0
    const allowed = (request: IncomingMessage) =>
      request.headers.host?.toLowerCase() === origin.host &&
      (request.headers.origin === undefined || request.headers.origin === origin.origin)
    const admit = (request: IncomingMessage) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        for (const [ip, bucket] of buckets) if (bucket.until <= now) buckets.delete(ip)
        const ip = request.socket.remoteAddress ?? ''
        let bucket = buckets.get(ip)
        if (bucket === undefined) {
          if (buckets.size >= 256) return false
          bucket = { until: now + 60_000, count: 0 }
          buckets.set(ip, bucket)
        }
        bucket.count++
        return bucket.count <= 60
      })
    const reply = (response: ServerResponse, status: number, value: unknown) => {
      if (response.destroyed || response.writableEnded) return
      response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
      response.end(JSON.stringify(value))
    }
    const authenticate = (request: IncomingMessage) =>
      Effect.gen(function* () {
        const authorization = request.headers.authorization ?? ''
        if (authorization.length > 4096 || !authorization.startsWith('Althar-Device ')) return yield* rejected()
        const encoded = authorization.slice('Althar-Device '.length)
        if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return yield* rejected()
        const proof = yield* Schema.decodeUnknownEffect(Proof)(
          JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(encoded, 'base64url'))),
        )
        const identity = yield* identities.authenticate(proof.challenge, proof.signature)
        if (identity.role !== 'socket') return yield* rejected()
        yield* identities.check(identity)
        return identity
      })
    const run = (effect: Effect.Effect<void, unknown, Services | Scope.Scope>) =>
      Effect.runFork(
        Effect.forkIn(
          effect.pipe(
            Effect.provideContext(context),
            Effect.catchCause(() => Effect.void),
          ),
          scope,
        ),
      )
    const server = createServer(
      {
        cert: given.certificate,
        key: given.key,
        minVersion: 'TLSv1.2',
        handshakeTimeout: 10_000,
        maxHeaderSize: MAX_BODY,
        requestTimeout: 10_000,
        headersTimeout: 10_000,
        keepAliveTimeout: 5_000,
      },
      (request, response) => {
        if (!allowed(request) || inFlight >= 16) {
          reply(response, 403, { error: 'ConnectionRefused' })
          request.resume()
          return
        }
        inFlight++
        run(
          Effect.gen(function* () {
            if (!(yield* admit(request))) {
              reply(response, 429, { error: 'TryLater' })
              return
            }
            if (request.method === 'GET' && request.url === '/v1/info') {
              reply(response, 200, {
                homeId: instance.homeId,
                hostDeviceId: instance.deviceId,
                apiVersion: API_VERSION,
                version: given.version,
              })
              return
            }
            if (
              approvals !== undefined &&
              request.method === 'GET' &&
              (request.url === '/approve-permission' || request.url === '/enroll-approval-key')
            ) {
              const nonce = randomBytes(18).toString('base64')
              response.writeHead(200, {
                'content-type': 'text/html; charset=utf-8',
                'cache-control': 'no-store',
                'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
                'referrer-policy': 'no-referrer',
                'permissions-policy': 'publickey-credentials-create=(self), publickey-credentials-get=(self)',
                'x-content-type-options': 'nosniff',
                'x-frame-options': 'DENY',
              })
              response.end(permissionApprovalPage(nonce, request.url === '/enroll-approval-key'))
              return
            }
            if (request.method !== 'POST' || request.headers['content-type']?.split(';')[0] !== 'application/json') return yield* rejected()
            if (approvals !== undefined) {
              if (request.url === '/v1/permission-approvals') {
                const identity = yield* authenticate(request)
                reply(response, 200, yield* approvals.begin(identity, yield* body(request)))
                return
              }
              if (request.url === '/v1/approval-keys') {
                reply(response, 200, yield* approvals.enroll(yield* authenticate(request)))
                request.resume()
                return
              }
              if (request.headers.origin === origin.origin && request.url === '/v1/approval-keys/view') {
                reply(response, 200, yield* approvals.enrollmentOptions(yield* body(request)))
                return
              }
              if (request.headers.origin === origin.origin && request.url === '/v1/approval-keys/export') {
                reply(response, 200, yield* approvals.exportKey(yield* body(request)))
                return
              }
              if (request.url === '/v1/permission-approvals/result') {
                reply(response, 200, yield* approvals.result(yield* body(request)))
                return
              }
              if (request.headers.origin === origin.origin && request.url === '/v1/permission-approvals/view') {
                reply(response, 200, yield* approvals.view(yield* body(request)))
                return
              }
              if (request.headers.origin === origin.origin && request.url === '/v1/permission-approvals/answer') {
                yield* approvals.answer(yield* body(request))
                reply(response, 200, { accepted: true })
                return
              }
            }
            if (request.url === '/v1/connections/challenge') {
              const input = yield* Schema.decodeUnknownEffect(ChallengeRequest)(yield* body(request))
              if (input.homeId !== instance.homeId) return yield* rejected()
              reply(response, 200, yield* identities.challenge(input.deviceId))
              return
            }
            if (request.url === '/v1/pairing/complete') {
              const input = yield* Schema.decodeUnknownEffect(PairingRegistration)(yield* body(request))
              const device = yield* pairings.complete(input)
              reply(response, 200, { homeId: instance.homeId, apiVersion: API_VERSION, device })
              return
            }
            reply(response, 404, { error: 'NotFound' })
          }).pipe(
            Effect.timeout('10 seconds'),
            Effect.catchCause(() =>
              Effect.sync(() => {
                reply(response, 403, { error: 'ConnectionRefused' })
                request.resume()
              }),
            ),
            Effect.ensuring(
              Effect.sync(() => {
                inFlight--
              }),
            ),
          ),
        )
      },
    )
    server.maxConnections = 64
    server.maxHeadersCount = 32
    server.maxRequestsPerSocket = 100
    server.on('connection', (socket) => {
      sockets.add(socket)
      socket.once('close', () => sockets.delete(socket))
    })
    server.on('tlsClientError', () => undefined)
    const ws = webSocketServer()
    server.on('upgrade', (request, socket, head) => {
      if (!allowed(request) || request.url !== '/v1/api' || request.method !== 'GET' || inFlight >= 16 || active.size >= MAX_CONNECTIONS) {
        socket.destroy()
        return
      }
      inFlight++
      let upgraded = false
      run(
        Effect.gen(function* () {
          if (!(yield* admit(request))) return yield* rejected()
          const identity = yield* authenticate(request)
          if (socket.destroyed || active.size >= MAX_CONNECTIONS) return yield* rejected()
          ws.handleUpgrade(request, socket, head, (webSocket) => {
            upgraded = true
            request.socket.setTimeout(0)
            const port = webSocketPort(webSocket)
            active.add(port)
            webSocket.once('close', () => active.delete(port))
            run(
              Effect.scoped(
                Effect.gen(function* () {
                  yield* webSocketHeartbeat(webSocket)
                  port.post({ type: 'Authenticated', identity, apiVersion: API_VERSION })
                  yield* untilPortCloses(port, Layer.launch(connection(port, { kind: 'socket' }, identity)))
                }),
              ).pipe(
                Effect.ensuring(
                  Effect.sync(() => {
                    active.delete(port)
                    port.close()
                  }),
                ),
              ),
            )
          })
        }).pipe(
          Effect.timeout('10 seconds'),
          Effect.ensuring(
            Effect.sync(() => {
              inFlight--
              if (!upgraded) socket.destroy()
            }),
          ),
        ),
      )
    })
    yield* Effect.addFinalizer(() =>
      Effect.promise(
        () =>
          new Promise<void>((resolve) => {
            for (const port of active) port.close()
            for (const socket of sockets) socket.destroy()
            ws.close()
            server.close(() => resolve())
          }),
      ),
    )
    yield* Effect.tryPromise({
      try: () =>
        new Promise<void>((resolve, reject) => {
          server.once('error', reject)
          server.listen(given.port, given.address, () => {
            server.off('error', reject)
            resolve()
          })
        }),
      catch: rejected,
    })
    server.on('error', () => {
      for (const socket of sockets) socket.destroy()
    })
    const address = server.address()
    if (address === null || typeof address === 'string') return yield* rejected()
    if (given.port === 0 && origin.port === '0') origin.port = String(address.port)
    return { port: address.port }
  }).pipe(Effect.mapError(() => rejected()))
