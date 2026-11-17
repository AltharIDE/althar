import { emitterPort, type ClientIdentity, type PortLike } from '@althar/contracts'
import { openSshConnection } from '@althar/transport-node'
import { Deferred, Effect } from 'effect'

import type { RemoteHome } from '../homes'

/** Runs in a utility process: decoding and copying remote RPC frames never occupies the desktop's main thread. */
export const bridgeHome = (home: RemoteHome, front: PortLike, ready: (identity: ClientIdentity) => void) =>
  Effect.scoped(
    Effect.gen(function* () {
      const connection = yield* openSshConnection({ ...home.ssh, homeId: home.homeId })
      const done = yield* Deferred.make<void>()
      const end = () => {
        Deferred.doneUnsafe(done, Effect.void)
      }
      const input = front.listen((message) => connection.port.post(message))
      const output = connection.port.listen((message) => front.post(message))
      const frontClosed = front.closed?.(end)
      const backClosed = connection.port.closed(end)
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          input()
          output()
          frontClosed?.()
          backClosed()
          front.close?.()
        }),
      )
      ready(connection.identity)
      yield* Deferred.await(done)
    }),
  )

export type ConnectionPort = Parameters<typeof emitterPort>[0]
