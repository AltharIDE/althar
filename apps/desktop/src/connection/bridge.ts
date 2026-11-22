import { emitterPort, type ClientIdentity, type PortLike } from '@althar/contracts'
import { join } from 'node:path'
import { openSshConnection, openHttpsConnection, signDeviceMessage, type DeviceKey, type SshRuntime } from '@althar/transport-node'
import { Deferred, Effect } from 'effect'

import type { RemoteHome } from '../homes'

/** The system's ssh, or, in a build from source given one (ALTHAR_SSH_TOOLS, set only by main there), that folder's. */
export const sshRuntime = (): SshRuntime => {
  const tools = process.env.ALTHAR_SSH_TOOLS
  return tools === undefined || tools === '' ? {} : { executable: join(tools, 'ssh') }
}

/** Runs in a utility process: decoding and copying remote RPC frames never occupies the desktop's main thread. */
export const bridgeHome = (home: RemoteHome, front: PortLike, ready: (identity: ClientIdentity) => void, key?: DeviceKey) =>
  Effect.scoped(
    Effect.gen(function* () {
      if (home.https !== undefined && key === undefined)
        return yield* Effect.fail(new Error('Pair this home again to create a connection key.'))
      const connection =
        home.https === undefined
          ? yield* openSshConnection({ ...home.ssh, homeId: home.homeId }, sshRuntime())
          : yield* openHttpsConnection(home.https, (message) => signDeviceMessage(key?.privateKey ?? '', message))
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
