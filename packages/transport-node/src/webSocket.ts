import {
  API_VERSION,
  ApiError,
  ClientChallenge,
  type HttpsHomeTarget,
  type PermissionApproval,
  clientChallengeMessage,
} from '@althar/contracts'
import { Effect, Schema } from 'effect'
import WebSocket, { createWebSocketStream, WebSocketServer } from 'ws'

import { AUTH_FRAME_LIMIT, Authenticated, readFrame } from './authentication'
import { httpsJson, homeHttpsAgent, httpsOrigin } from './https'
import { streamPort, MAX_SOCKET_FRAME } from './streamPort'
import { transportError, type TransportError } from './errors'

export const webSocketServer = () =>
  new WebSocketServer({ noServer: true, clientTracking: false, perMessageDeflate: false, maxPayload: MAX_SOCKET_FRAME + 4 })
export type HomeWebSocket = WebSocket

/** Reuse the socket codec, queue bounds and auth-to-RPC handoff over binary WebSocket byte streams. */
export const webSocketPort = (socket: WebSocket) => {
  socket.on('error', () => undefined)
  socket.on('message', (_data, binary) => {
    if (!binary) socket.terminate()
  })
  const duplex = createWebSocketStream(socket)
  return streamPort({ readable: duplex, writable: duplex })
}

const deviceProof = (target: HttpsHomeTarget, sign: (message: string) => Effect.Effect<string, ApiError | TransportError>) =>
  Effect.gen(function* () {
    const origin = httpsOrigin(target.origin)
    if (target.tlsCertificate === undefined)
      return yield* transportError(
        'InvalidConnection',
        'This saved connection needs the home’s certificate. Pair it again with a new code.',
      )
    const agent = yield* homeHttpsAgent(origin, { tlsKeyPin: target.tlsKeyPin, tlsCertificate: target.tlsCertificate })
    const challenge = yield* Schema.decodeUnknownEffect(ClientChallenge)(
      yield* httpsJson(origin, '/v1/connections/challenge', agent, { homeId: target.homeId, deviceId: target.deviceId }),
    ).pipe(Effect.mapError(() => transportError('AuthenticationFailed', 'The home returned an invalid device challenge.')))
    if (challenge.homeId !== target.homeId || challenge.deviceId !== target.deviceId || challenge.apiVersion !== API_VERSION)
      return yield* transportError('AuthenticationFailed', 'The home returned another device or home identity.')
    const proof = { challenge, signature: yield* sign(clientChallengeMessage(challenge)) }
    return { agent, origin, authorization: `Althar-Device ${Buffer.from(JSON.stringify(proof)).toString('base64url')}` }
  })

export const prepareApprovalKeyEnrollment = (target: HttpsHomeTarget, sign: Parameters<typeof deviceProof>[1]) =>
  Effect.scoped(
    Effect.gen(function* () {
      const { agent, origin, authorization } = yield* deviceProof(target, sign)
      const { path } = yield* Schema.decodeUnknownEffect(
        Schema.Struct({ path: Schema.String.check(Schema.isPattern(/^\/enroll-approval-key#[A-Za-z0-9_-]{43}$/)) }),
      )(yield* httpsJson(origin, '/v1/approval-keys', agent, {}, authorization))
      return new URL(path, origin).href
    }).pipe(
      Effect.mapError(() =>
        transportError('ApprovalUnavailable', 'The home could not start security key setup. Check that the administrator enabled it.'),
      ),
    ),
  )

/** Prepares the browser ceremony without granting the transport key authority to answer the request. */
export const preparePermissionApproval = (target: HttpsHomeTarget, sign: Parameters<typeof deviceProof>[1], action: PermissionApproval) =>
  Effect.scoped(
    Effect.gen(function* () {
      const { origin, agent, authorization } = yield* deviceProof(target, sign)
      const response = yield* httpsJson(origin, '/v1/permission-approvals', agent, action, authorization)
      const { path } = yield* Schema.decodeUnknownEffect(
        Schema.Struct({ path: Schema.String.check(Schema.isPattern(/^\/approve-permission#[A-Za-z0-9_-]{43}$/)) }),
      )(response)
      const url = new URL(path, origin)
      const wait = Effect.scoped(
        Effect.gen(function* () {
          if (target.tlsCertificate === undefined) return yield* transportError('ApprovalUnavailable', 'Pair this home again.')
          const secure = yield* homeHttpsAgent(origin, { tlsKeyPin: target.tlsKeyPin, tlsCertificate: target.tlsCertificate })
          const code = url.hash.slice(1)
          for (;;) {
            const result = yield* Schema.decodeUnknownEffect(Schema.Struct({ state: Schema.Literals(['pending', 'refused', 'accepted']) }))(
              yield* httpsJson(origin, '/v1/permission-approvals/result', secure, { code }),
            )
            if (result.state === 'accepted') return
            if (result.state === 'refused') return yield* transportError('ApprovalUnavailable', 'The home refused this confirmation.')
            yield* Effect.sleep('2 seconds')
          }
        }),
      ).pipe(
        Effect.timeout('90 seconds'),
        Effect.mapError(() =>
          transportError('ApprovalUnavailable', 'The security-key confirmation did not go through. Reopen the request.'),
        ),
      )
      return { url: url.href, wait }
    }).pipe(Effect.mapError(() => transportError('ApprovalUnavailable', 'This home could not open a security-key confirmation.'))),
  )

export const openHttpsConnection = (target: HttpsHomeTarget, sign: Parameters<typeof deviceProof>[1]) =>
  Effect.gen(function* () {
    const { origin, agent, authorization } = yield* deviceProof(target, sign)
    const opened = yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: (signal) =>
          new Promise<{ socket: WebSocket; port: ReturnType<typeof webSocketPort> }>((resolve, reject) => {
            const socket = new WebSocket(`${origin.replace(/^https:/, 'wss:')}/v1/api`, {
              agent,
              followRedirects: false,
              perMessageDeflate: false,
              maxPayload: MAX_SOCKET_FRAME + 4,
              handshakeTimeout: 10_000,
              headers: { authorization },
            })
            const abort = () => {
              socket.terminate()
              reject(new Error('Connection cancelled'))
            }
            signal.addEventListener('abort', abort, { once: true })
            socket.once('error', reject)
            socket.once('open', () => {
              signal.removeEventListener('abort', abort)
              const port = webSocketPort(socket)
              port.setFrameLimit(AUTH_FRAME_LIMIT)
              resolve({ socket, port })
            })
            socket.once('close', () => {
              signal.removeEventListener('abort', abort)
              reject(new Error('Connection closed'))
            })
          }),
        catch: () =>
          transportError(
            'AuthenticationFailed',
            'The home refused this device connection. Check its certificate or pair the device again.',
          ),
      }),
      (opened) => Effect.sync(() => opened.socket.terminate()),
    )
    const { port, socket } = opened
    yield* webSocketHeartbeat(socket)
    const ready = yield* readFrame(port).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Authenticated)),
      Effect.timeout('10 seconds'),
      Effect.mapError(() => transportError('AuthenticationFailed', 'The home did not confirm the authenticated device.')),
    )
    const identity = ready.identity
    if (
      identity.homeId !== target.homeId ||
      identity.deviceId !== target.deviceId ||
      identity.role !== 'socket' ||
      ready.apiVersion !== API_VERSION
    )
      return yield* transportError('AuthenticationFailed', 'The home returned an unexpected identity or authority.')
    port.setFrameLimit(MAX_SOCKET_FRAME)
    return { port, identity }
  })

/** Owned, clock-driven keepalive on each endpoint; a half-open peer cannot retain a connection indefinitely. */
export const webSocketHeartbeat = (socket: HomeWebSocket) =>
  Effect.gen(function* () {
    let alive = true
    const pong = () => {
      alive = true
    }
    yield* Effect.acquireRelease(
      Effect.sync(() => socket.on('pong', pong)),
      () => Effect.sync(() => socket.off('pong', pong)),
    )
    yield* Effect.forkScoped(
      Effect.forever(
        Effect.gen(function* () {
          yield* Effect.sleep('30 seconds')
          yield* Effect.sync(() => {
            if (socket.readyState !== WebSocket.OPEN) return
            if (!alive) {
              socket.terminate()
              return
            }
            alive = false
            try {
              socket.ping()
            } catch {
              socket.terminate()
            }
          })
        }),
      ),
    )
  })
