import { isAbsolute, join } from 'node:path'

import { API_VERSION, Api, clientProtocol } from '@althar/contracts'
import { authenticateApiClient, LocalApiEndpoint, openApiSocket } from '@althar/runtime'
import { Effect, Layer, Schedule, Schema } from 'effect'
import { RpcClient } from 'effect/rpc'

import { HostError } from './errors'
import { privateDirectory, readPrivate } from './privateFiles'

const unavailable = () =>
  new HostError({
    code: 'HostUnavailable',
    message: 'This home is not ready or its private API is unavailable. Check the host service and its journal.',
  })

export const hostStatus = (profile: string, wait = false) => {
  const attempt = Effect.scoped(
    Effect.gen(function* () {
      const endpoint = yield* Effect.tryPromise({
        try: async () => {
          const root = await privateDirectory(profile)
          await privateDirectory(join(root, 'api'))
          const bytes = await readPrivate(join(root, 'api', 'endpoint.json'), 16_384)
          if (bytes === null) throw unavailable()
          const endpoint = Schema.decodeUnknownSync(LocalApiEndpoint)(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
          if (!isAbsolute(endpoint.address) || endpoint.apiVersion !== API_VERSION) throw unavailable()
          return endpoint
        },
        catch: (error) => (error instanceof HostError && error.code === 'UnsafePermissions' ? error : unavailable()),
      })
      const port = yield* openApiSocket(endpoint.address).pipe(Effect.mapError(unavailable))
      const identity = yield* authenticateApiClient(port, endpoint.homeId, { kind: 'secret', secret: endpoint.secret }).pipe(
        Effect.mapError(unavailable),
      )
      const protocol = yield* Layer.build(clientProtocol(port))
      const api = yield* RpcClient.make(Api).pipe(Effect.provideContext(protocol))
      const info = yield* api.GetConnectionInfo({}).pipe(Effect.mapError(unavailable))
      if (info.identity.homeId !== identity.homeId || info.identity.role !== 'socket') return yield* unavailable()
      return {
        state: 'ready' as const,
        homeId: info.identity.homeId,
        hostDeviceId: info.hostDeviceId,
        apiVersion: info.apiVersion,
        version: info.appVersion,
      }
    }),
  )
  return (
    wait
      ? attempt.pipe(
          Effect.retry({ times: 149, schedule: Schedule.spaced('200 millis'), while: (error) => error.code === 'HostUnavailable' }),
        )
      : attempt
  ).pipe(Effect.timeoutOrElse({ duration: wait ? '30 seconds' : '10 seconds', orElse: () => Effect.fail(unavailable()) }))
}
