import type { Readable, Writable } from 'node:stream'

import { API_VERSION } from '@althar/contracts'
import {
  AUTH_FRAME_LIMIT,
  MAX_SOCKET_FRAME,
  openLocalConnection,
  socketReady,
  streamPort,
  TransportError,
  transportError,
} from '@althar/transport-node'
import { Deferred, Effect } from 'effect'

import { HostError } from './errors'

export interface BridgeStreams {
  readonly input: Readable & { readonly isTTY?: boolean }
  readonly output: Writable & { readonly isTTY?: boolean }
}
const flush = (output: Writable) =>
  Effect.callback<void, HostError>((resume) => {
    output.write('', (error) =>
      resume(
        error == null ? Effect.void : Effect.fail(new HostError({ code: 'HostUnavailable', message: 'The SSH output stream closed.' })),
      ),
    )
  }).pipe(
    Effect.timeoutOrElse({
      duration: '5 seconds',
      orElse: () => Effect.fail(new HostError({ code: 'HostUnavailable', message: 'The SSH output stream did not drain.' })),
    }),
  )

/** An SSH account reaches the same socket authority it already has locally. This never opens a runtime or reveals its launch secret. */
export const serveStdio = (profile: string, homeId: string, apiVersion: number, streams: BridgeStreams) =>
  Effect.scoped(
    Effect.gen(function* () {
      if (streams.input.isTTY || streams.output.isTTY)
        return yield* new HostError({
          code: 'InvalidConfig',
          message: 'connect-stdio is a framed client transport. Run it through an Althar SSH client, without a terminal.',
        })
      const front = streamPort({ readable: streams.input, writable: streams.output, maximum: AUTH_FRAME_LIMIT })
      yield* Effect.addFinalizer(() => Effect.sync(() => front.close()))
      let ready = false
      yield* Effect.gen(function* () {
        if (apiVersion !== API_VERSION) return yield* transportError('ApiVersionMismatch', 'The requested API version is incompatible.')
        const local = yield* openLocalConnection(profile, homeId)
        if (local.identity.role !== 'socket')
          return yield* transportError('AuthenticationFailed', 'The host did not grant socket authority.')
        front.setFrameLimit(MAX_SOCKET_FRAME)
        front.post(socketReady(local.identity))
        ready = true
        const done = yield* Deferred.make<void>()
        const end = () => {
          Deferred.doneUnsafe(done, Effect.void)
        }
        const stopInput = front.listen((message) => local.port.post(message))
        const stopOutput = local.port.listen((message) => front.post(message))
        const stopFront = front.closed(end)
        const stopLocal = local.port.closed(end)
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            stopInput()
            stopOutput()
            stopFront()
            stopLocal()
          }),
        )
        yield* Deferred.await(done)
      }).pipe(
        Effect.catch((error) =>
          Effect.gen(function* () {
            const reason = error instanceof TransportError ? error.reason : 'HostUnavailable'
            if (!ready) {
              front.post({ type: 'BridgeRejected', protocol: 1, reason })
              yield* flush(streams.output)
            }
            return yield* new HostError({
              code: 'HostUnavailable',
              message: 'The host could not open this SSH API connection. Check its service, expected home and API version.',
            })
          }),
        ),
      )
    }),
  )
