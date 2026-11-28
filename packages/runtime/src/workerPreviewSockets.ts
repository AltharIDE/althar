import { randomBytes } from 'node:crypto'
import type { Duplex } from 'node:stream'
import { ApiError, MAX_PREVIEW_SOCKET_CHUNK } from '@althar/contracts'
import { Effect, type Scope, Stream } from 'effect'

const MAX_SOCKETS = 8
const CLAIM_WITHIN = 5_000
const unavailable = () => new ApiError({ reason: 'NotFound', message: 'This worker preview connection is unavailable.' })

interface OpenSocket {
  readonly socket: Duplex
  claimed: boolean
  writing: boolean
}

async function* chunks(socket: Duplex) {
  for await (const chunk of socket as AsyncIterable<Buffer>) {
    for (let at = 0; at < chunk.length; at += MAX_PREVIEW_SOCKET_CHUNK)
      yield chunk.subarray(at, at + MAX_PREVIEW_SOCKET_CHUNK).toString('base64')
  }
}

/** One authenticated client connection owns these tunnels. No tunnel survives reconnecting the client. */
export const workerPreviewSockets = (scope: Scope.Scope) => {
  const active = new Map<string, OpenSocket>()
  let opening = 0
  let closed = false
  const drop = (id: string) => {
    const socket = active.get(id)
    if (socket === undefined) return
    active.delete(id)
    socket.socket.destroy()
  }
  return {
    open: <E>(connect: Effect.Effect<Duplex, E>) =>
      Effect.gen(function* () {
        if (closed || active.size + opening >= MAX_SOCKETS) return yield* unavailable()
        opening++
        const socket = yield* connect.pipe(
          Effect.ensuring(
            Effect.sync(() => {
              opening--
            }),
          ),
        )
        if (closed || socket.destroyed) {
          socket.destroy()
          return yield* unavailable()
        }
        const id = 'pvs_' + randomBytes(16).toString('hex')
        socket.on('error', () => drop(id))
        socket.once('close', () => drop(id))
        active.set(id, { socket, claimed: false, writing: false })
        yield* Effect.forkIn(
          Effect.sleep(CLAIM_WITHIN).pipe(
            Effect.andThen(
              Effect.sync(() => {
                if (active.get(id)?.claimed === false) drop(id)
              }),
            ),
          ),
          scope,
        )
        return id
      }),
    read: (id: string) =>
      Stream.unwrap(
        Effect.sync(() => {
          const found = active.get(id)
          if (found === undefined || found.claimed) return Stream.fail(unavailable())
          found.claimed = true
          return Stream.fromAsyncIterable(chunks(found.socket), unavailable).pipe(Stream.ensuring(Effect.sync(() => drop(id))))
        }),
      ),
    write: (id: string, encoded: string) =>
      Effect.gen(function* () {
        const found = active.get(id)
        if (found === undefined || found.writing || encoded.length > Math.ceil(MAX_PREVIEW_SOCKET_CHUNK / 3) * 4)
          return yield* unavailable()
        const data = Buffer.from(encoded, 'base64')
        if (data.length === 0 || data.length > MAX_PREVIEW_SOCKET_CHUNK || data.toString('base64') !== encoded) return yield* unavailable()
        found.writing = true
        yield* Effect.tryPromise({
          try: (signal) =>
            new Promise<void>((resolve, reject) => {
              const stop = () => drop(id)
              signal.addEventListener('abort', stop, { once: true })
              found.socket.write(data, (error) => {
                signal.removeEventListener('abort', stop)
                if (error == null) resolve()
                else reject(error)
              })
            }),
          catch: unavailable,
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              found.writing = false
            }),
          ),
        )
      }),
    end: (id: string) => Effect.sync(() => drop(id)),
    close: Effect.sync(() => {
      closed = true
      for (const id of active.keys()) drop(id)
    }),
  }
}
