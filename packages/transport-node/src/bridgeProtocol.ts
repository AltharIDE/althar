import { API_VERSION, HomeId, type ClientIdentity } from '@althar/contracts'
import { Effect, Schema } from 'effect'

import { Authenticated, readFrame } from './authentication'
import { TransportReason, transportError } from './errors'
import { MAX_SOCKET_FRAME, type StreamPort } from './streamPort'

/** This bridge authenticates only the SSH account's existing socket authority. It never conveys a launch secret. */
export const BridgeRejected = Schema.Struct({
  type: Schema.Literal('BridgeRejected'),
  protocol: Schema.Literal(1),
  reason: TransportReason,
})
const Reply = Schema.Union([Authenticated, BridgeRejected])
export const socketReady = (identity: ClientIdentity) => ({ type: 'Authenticated' as const, identity, apiVersion: API_VERSION })

export const receiveBridgeIdentity = (port: StreamPort, expectedHome: string) =>
  Effect.gen(function* () {
    yield* Schema.decodeUnknownEffect(HomeId)(expectedHome).pipe(
      Effect.mapError(() => transportError('InvalidConnection', 'Name the expected Althar home before connecting.')),
    )
    const reply = yield* Schema.decodeUnknownEffect(Reply)(yield* readFrame(port)).pipe(
      Effect.mapError(() => transportError('AuthenticationFailed', 'The remote host did not return a valid authenticated connection.')),
    )
    if (reply.type === 'BridgeRejected')
      return yield* transportError(
        reply.reason,
        'The remote host refused this connection. Check its service, expected home and API version.',
      )
    if (reply.identity.homeId !== expectedHome)
      return yield* transportError(
        'HomeMismatch',
        'This server is running a different Althar home. Check its identity before reconnecting.',
      )
    if (reply.apiVersion !== API_VERSION)
      return yield* transportError(
        'ApiVersionMismatch',
        'This host and client speak different API versions. Update them before reconnecting.',
      )
    if (reply.identity.role !== 'socket')
      return yield* transportError('AuthenticationFailed', 'An SSH bridge cannot grant paired-client or window authority.')
    port.setFrameLimit(MAX_SOCKET_FRAME)
    return reply.identity
  }).pipe(
    Effect.timeoutOrElse({
      duration: '30 seconds',
      orElse: () =>
        Effect.fail(transportError('HostUnavailable', 'The SSH host did not become ready. Check its service and SSH connection.')),
    }),
  )
