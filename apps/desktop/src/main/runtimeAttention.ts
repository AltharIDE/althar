import { AttentionApi, clientProtocol, type AttentionEvent, isKnownAttention, type PortLike, untraced } from '@althar/contracts'
import { Cause, Effect, Fiber, Layer, Stream } from 'effect'
import { RpcClient } from 'effect/rpc'

/** Native notifications use the same versioned API as other clients, with a connection owned by this runtime launch. */
export const watchRuntimeAttention = (
  port: PortLike,
  event: (event: AttentionEvent) => void,
  failed: (reason: string) => void,
): (() => void) => {
  const fiber = Effect.runFork(
    Effect.scoped(
      Effect.gen(function* () {
        yield* Effect.addFinalizer(() => Effect.sync(() => port.close?.()))
        const protocol = yield* Layer.build(clientProtocol(port))
        const client = yield* RpcClient.make(AttentionApi, untraced).pipe(Effect.provideContext(protocol))
        // An event of a type this app doesn't know, as a newer runtime could send, is passed over.
        yield* Stream.runForEach(Stream.filter(client.WatchAttention({}), isKnownAttention), (attention) =>
          Effect.sync(() => event(attention)),
        )
      }),
    ).pipe(Effect.catchCause((cause) => (Cause.hasInterruptsOnly(cause) ? Effect.void : Effect.sync(() => failed(Cause.pretty(cause)))))),
  )
  return () => {
    Effect.runFork(Fiber.interrupt(fiber))
  }
}
