import { clientProtocol, emitterPort, PictureApi, untraced } from '@althar/contracts'
import { Effect, Exit, Layer, Scope } from 'effect'
import { RpcClient, type RpcClientError } from 'effect/rpc'

/*
 * The pictures a thread shows on a home (a lead's report, show_pictures, a
 * check's or review's shots, a canvas's picture) are kept in the home's
 * artifact store, not this computer's. A window paired with the home draws
 * them by the same address as a local one (althar-picture://shot/<digest>),
 * which main answers in that home's session: from what it fetched before,
 * else through a connection of its own to the home (`ReadPicture`), opened
 * when a picture is first wanted and kept while a window is on the home.
 * Nothing reaches the window but the picture, and nothing but a picture is
 * asked for.
 */

type PictureClient = RpcClient.FromGroup<typeof PictureApi, RpcClientError.RpcClientError>

/** Opens a port to the home's API, as a connected window of it would: null where no window is connected to it. */
export type HomePort = (homeId: string, signal: AbortSignal) => Promise<Electron.MessagePortMain>

interface Open {
  readonly client: Promise<PictureClient>
  readonly scope: Scope.Closeable
  readonly controller: AbortController
}

export const homePictures = (port: HomePort) => {
  const open = new Map<string, Open>()
  /* Pictures being fetched, by home and digest: the full one and its smaller copy, asked at once, are fetched once. */
  const fetching = new Map<string, Promise<Buffer | null>>()

  const close = (homeId: string, which?: Open) => {
    const one = open.get(homeId)
    if (one === undefined || (which !== undefined && one !== which)) return
    open.delete(homeId)
    one.controller.abort()
    void Effect.runPromise(Scope.close(one.scope, Exit.void)).catch(() => undefined)
  }

  const clientOf = (homeId: string): Open => {
    const there = open.get(homeId)
    if (there !== undefined) return there
    const scope = Effect.runSync(Scope.make())
    const controller = new AbortController()
    const client = Effect.runPromise(
      Effect.gen(function* () {
        const opened = yield* Effect.tryPromise(() => port(homeId, controller.signal))
        yield* Effect.addFinalizer(() => Effect.sync(() => opened.close()))
        const protocol = yield* Layer.build(clientProtocol(emitterPort(opened)))
        return yield* RpcClient.make(PictureApi, untraced).pipe(Effect.provideContext(protocol))
      }).pipe(Scope.provide(scope)),
      { signal: controller.signal },
    )
    const made: Open = { client, scope, controller }
    open.set(homeId, made)
    // One that couldn't open is opened afresh when a picture is next wanted.
    client.catch(() => close(homeId, made))
    return made
  }

  const ask = async (homeId: string, digest: string, again: boolean): Promise<Buffer | null> => {
    const one = clientOf(homeId)
    try {
      const client = await one.client
      const read = await Effect.runPromise(client.ReadPicture({ digest }), { signal: one.controller.signal })
      return Buffer.from(read.bodyBase64, 'base64')
    } catch (error) {
      // The home has no such picture: nothing to try again.
      if (typeof error === 'object' && error !== null && 'reason' in error && error.reason === 'NotFound') return null
      // A connection that went (the home restarted, the network moved) is opened once more.
      close(homeId, one)
      return again ? ask(homeId, digest, false) : null
    }
  }

  return {
    /** A picture's bytes from the home, by its digest; null where the home doesn't keep it or can't be asked now. */
    read: (homeId: string, digest: string): Promise<Buffer | null> => {
      const key = `${homeId} ${digest}`
      const going = fetching.get(key)
      if (going !== undefined) return going
      const read = ask(homeId, digest, true).finally(() => fetching.delete(key))
      fetching.set(key, read)
      return read
    },
    /** Closes the home's picture connection, as its last window closes. */
    forget: (homeId: string) => close(homeId),
    stop: () => {
      for (const homeId of [...open.keys()]) close(homeId)
    },
  }
}
