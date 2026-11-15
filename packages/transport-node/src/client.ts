import { API_VERSION, Api, clientProtocol, type ClientIdentity } from '@althar/contracts'
import { Effect, Layer } from 'effect'
import { RpcClient } from 'effect/rpc'

import { AUTH_FRAME_LIMIT, authenticateApiClient } from './authentication'
import { MAX_SOCKET_FRAME } from './streamPort'
import { readLocalEndpoint } from './endpoint'
import { transportError } from './errors'
import { openApiSocket } from './socket'
import type { StreamPort } from './streamPort'

export interface ApiConnection {
  readonly port: StreamPort
  readonly identity: ClientIdentity
}

/** Owns only an API connection; never constructs a runtime, opens SQLite or loads provider credentials. */
export const openLocalConnection = (profile: string, expectedHome?: string) =>
  Effect.gen(function* () {
    const endpoint = yield* readLocalEndpoint(profile, expectedHome)
    const port = yield* openApiSocket(endpoint.address)
    port.setFrameLimit(AUTH_FRAME_LIMIT)
    const identity = yield* authenticateApiClient(port, endpoint.homeId, { kind: 'secret', secret: endpoint.secret })
    port.setFrameLimit(MAX_SOCKET_FRAME)
    return { port, identity }
  })

/** Verify the RPC endpoint too, before handing any commands to its caller. Closing the scope disconnects only this client. */
export const apiClient = (connection: ApiConnection) =>
  Effect.gen(function* () {
    const context = yield* Layer.build(clientProtocol(connection.port))
    const api = yield* RpcClient.make(Api).pipe(Effect.provideContext(context))
    const info = yield* api.GetConnectionInfo({})
    const expected = connection.identity
    if (
      info.identity.homeId !== expected.homeId ||
      info.identity.actorId !== expected.actorId ||
      info.identity.deviceId !== expected.deviceId ||
      info.identity.role !== expected.role
    )
      return yield* transportError('AuthenticationFailed', 'The API endpoint changed its authenticated identity.')
    if (info.apiVersion !== API_VERSION) return yield* transportError('ApiVersionMismatch', 'The API endpoint changed its version.')
    if (info.position.homeId !== expected.homeId)
      return yield* transportError('HomeMismatch', 'The API endpoint returned history from another home.')
    return { api, info }
  }).pipe(
    Effect.timeoutOrElse({
      duration: '10 seconds',
      orElse: () => Effect.fail(transportError('HostUnavailable', 'The authenticated home did not answer its API identity check.')),
    }),
  )
