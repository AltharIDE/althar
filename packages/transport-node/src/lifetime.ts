import type { PortLike } from '@althar/contracts'
import { Deferred, Effect } from 'effect'

/** Disconnect cancels the connection's scope, including its RPC layers and subscriptions. */
export const untilPortCloses = <A, E, R>(port: PortLike, serving: Effect.Effect<A, E, R>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const closed = yield* Deferred.make<void>()
      yield* Effect.acquireRelease(
        Effect.sync(
          () =>
            port.closed?.(() => {
              Deferred.doneUnsafe(closed, Effect.void)
            }) ?? (() => {}),
        ),
        (stop) => Effect.sync(stop),
      )
      return yield* Effect.raceFirst(serving, Deferred.await(closed))
    }),
  )
