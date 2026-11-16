import { createConnection } from 'node:net'

import { ApiError } from '@althar/contracts'
import { Effect } from 'effect'

import { socketPort, type SocketPort } from './socketPort'

const unavailable = () => new ApiError({ reason: 'SocketUnavailable', message: 'Althar could not open its private API connection.' })

/** Opens a transport owned by the caller's scope. SSH forwarding can supply the same private-socket address shape. */
export const openApiSocket = (address: string) =>
  Effect.acquireRelease(
    Effect.tryPromise({
      try: (signal) =>
        new Promise<SocketPort>((resolve, reject) => {
          const socket = createConnection({ path: address, signal })
          socket.once('error', reject)
          socket.once('connect', () => {
            const port = socketPort(socket)
            socket.off('error', reject)
            resolve(port)
          })
        }),
      catch: unavailable,
    }),
    (port) => Effect.sync(() => port.close()),
  )
