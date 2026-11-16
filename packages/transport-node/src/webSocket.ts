import { API_VERSION, ApiError, ClientChallenge, clientChallengeMessage } from '@althar/contracts'
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

export interface HttpsHomeTarget {
  readonly origin: string
  readonly homeId: string
  readonly deviceId: string
  readonly tlsKeyPin: string
}

export const openHttpsConnection = (target: HttpsHomeTarget, sign: (message: string) => Effect.Effect<string, ApiError | TransportError>) =>
  Effect.gen(function* () {
    const origin = httpsOrigin(target.origin)
    const agent = yield* homeHttpsAgent(origin, target.tlsKeyPin)
    const challenge = yield* Schema.decodeUnknownEffect(ClientChallenge)(
      yield* httpsJson(origin, '/v1/connections/challenge', agent, { homeId: target.homeId, deviceId: target.deviceId }),
    ).pipe(Effect.mapError(() => transportError('AuthenticationFailed', 'The home returned an invalid device challenge.')))
    if (challenge.homeId !== target.homeId || challenge.deviceId !== target.deviceId || challenge.apiVersion !== API_VERSION)
      return yield* transportError('AuthenticationFailed', 'The home returned another device or home identity.')
    const proof = { challenge, signature: yield* sign(clientChallengeMessage(challenge)) }
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
              headers: { authorization: `Althar-Device ${Buffer.from(JSON.stringify(proof)).toString('base64url')}` },
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
