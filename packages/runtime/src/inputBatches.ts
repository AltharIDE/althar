import { Clock, Deferred, Effect, type Scope } from 'effect'

import { makeKeyedLock } from './keyedLock'

/** A burst ends after this much quiet, once every message's attachments have been prepared. */
export const INPUT_QUIET = 100

/** Keeps preparation in arrival order, and holds delivery until the whole burst is accepted. */
export const makeInputBatches = (scope: Scope.Scope, flushed: (threadId: string) => Effect.Effect<void>) => {
  const locks = makeKeyedLock()
  const batches = new Map<
    string,
    {
      pending: number
      last: number
      idle: Deferred.Deferred<void>
      ready: Deferred.Deferred<void>
    }
  >()

  const hold = <A, E, R>(threadId: string, effect: Effect.Effect<A, E, R>) =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        let batch = batches.get(threadId)
        if (batch === undefined) {
          batch = {
            pending: 1,
            last: yield* Clock.currentTimeMillis,
            idle: yield* Deferred.make<void>(),
            ready: yield* Deferred.make<void>(),
          }
          batches.set(threadId, batch)
          const current = batch
          yield* Effect.forkIn(
            restore(
              Effect.gen(function* () {
                while (true) {
                  if (current.pending > 0) yield* Deferred.await(current.idle)
                  const left = current.last + INPUT_QUIET - (yield* Clock.currentTimeMillis)
                  if (left > 0) yield* Effect.sleep(left)
                  if (current.pending === 0 && (yield* Clock.currentTimeMillis) >= current.last + INPUT_QUIET) {
                    yield* flushed(threadId)
                    // Another message can arrive while the interruption is being acknowledged.
                    if (current.pending === 0 && (yield* Clock.currentTimeMillis) >= current.last + INPUT_QUIET) break
                  }
                }
                batches.delete(threadId)
                yield* Deferred.succeed(current.ready, undefined)
              }),
            ),
            scope,
          )
        } else {
          if (batch.pending === 0) batch.idle = Deferred.makeUnsafe<void>()
          batch.pending++
        }
        const current = batch
        return yield* restore(effect).pipe(
          Effect.ensuring(
            Effect.gen(function* () {
              current.pending--
              current.last = yield* Clock.currentTimeMillis
              if (current.pending === 0) yield* Deferred.succeed(current.idle, undefined)
            }),
          ),
        )
      }),
    )

  return {
    hold,
    accepting: <A, E, R>(threadId: string, effect: Effect.Effect<A, E, R>) => hold(threadId, locks.withLock(threadId, effect)),
    pending: (threadId: string) => batches.has(threadId),
    ready: (threadId: string): Effect.Effect<void> =>
      Effect.gen(function* () {
        while (true) {
          const batch = batches.get(threadId)
          if (batch === undefined) return
          yield* Deferred.await(batch.ready)
        }
      }),
  }
}
