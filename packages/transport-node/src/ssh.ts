import { HomeId, ClientDeviceId } from '@althar/contracts'
import { Effect, Schema } from 'effect'

import { AUTH_FRAME_LIMIT } from './authentication'
import { receiveBridgeIdentity } from './bridgeProtocol'
import { TransportError, transportError } from './errors'
import { startSsh, stopSsh, type SshRuntime } from './sshProcess'
import { streamPort } from './streamPort'
import type { SshConnectionOptions, SshTarget } from './sshArguments'

const RemoteStatus = Schema.Struct({
  state: Schema.Literal('ready'),
  homeId: HomeId,
  hostDeviceId: ClientDeviceId,
  apiVersion: Schema.Int,
  version: Schema.String.check(Schema.isMaxLength(128)),
})

/** Read-only discovery never opens a database on the client or establishes a trusted/paired device. */
export const inspectSshHost = (target: SshTarget, runtime: SshRuntime = {}) =>
  Effect.scoped(
    Effect.gen(function* () {
      const resource = yield* startSsh(target, undefined, runtime)
      resource.child.stdin.end()
      const bytes = yield* Effect.tryPromise({
        try: async () => {
          let size = 0
          const chunks: Buffer[] = []
          for await (const chunk of resource.child.stdout) {
            if (!Buffer.isBuffer(chunk)) throw new Error('Invalid SSH output')
            size += chunk.length
            if (size > 16_384) throw new Error('Oversized SSH output')
            chunks.push(chunk)
          }
          await resource.closed
          if (resource.child.exitCode !== 0) throw resource.failure()
          return Buffer.concat(chunks, size)
        },
        catch: (error) => (error instanceof TransportError ? error : resource.failure()),
      })
      const value = yield* Effect.try({
        try: () => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
        catch: () => transportError('HostUnavailable', 'The remote host did not return valid status information.'),
      })
      return yield* Schema.decodeUnknownEffect(RemoteStatus)(value).pipe(
        Effect.mapError(() => transportError('HostUnavailable', 'The remote host did not return valid status information.')),
      )
    }),
  ).pipe(
    Effect.timeoutOrElse({
      duration: '30 seconds',
      orElse: () => Effect.fail(transportError('HostUnavailable', 'The SSH host did not answer its status check.')),
    }),
  )

/** The caller must select a known home before commands can cross this SSH connection. */
export const openSshConnection = (target: SshConnectionOptions, runtime: SshRuntime = {}) =>
  Effect.gen(function* () {
    const resource = yield* startSsh(target, target.homeId, runtime)
    const port = streamPort({ readable: resource.child.stdout, writable: resource.child.stdin, maximum: AUTH_FRAME_LIMIT })
    yield* Effect.addFinalizer(() => Effect.sync(() => port.close()))
    const identity = yield* receiveBridgeIdentity(port, target.homeId).pipe(
      Effect.catch((error) =>
        error instanceof TransportError ? Effect.fail(error) : Effect.flatMap(stopSsh(resource), () => Effect.fail(resource.failure())),
      ),
    )
    return { port, identity }
  })
