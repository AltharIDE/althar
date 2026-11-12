import { Clock, Duration, Effect } from 'effect'

import { deadline } from './deadline'
import { calledFrom, timedOut } from './seen'

/**
 * Moves the time read by the effects passed to `run`, leaving the runtime's timers on their original clock.
 * Use TestClock.adjust instead when the test means to fire timers. Make this after providing the runtime so its
 * background fibers retain their own clock.
 */
export const readClock = Effect.gen(function* () {
  const base = yield* Clock.Clock
  let offset = 0
  const moved: Clock.Clock = Object.create(base, {
    currentTimeMillisUnsafe: { value: () => base.currentTimeMillisUnsafe() + offset },
    currentTimeMillis: { value: Effect.sync(() => base.currentTimeMillisUnsafe() + offset) },
    currentTimeNanosUnsafe: { value: () => base.currentTimeNanosUnsafe() + BigInt(offset) * 1_000_000n },
    currentTimeNanos: { value: Effect.sync(() => base.currentTimeNanosUnsafe() + BigInt(offset) * 1_000_000n) },
  })
  return {
    run: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.provideService(effect, Clock.Clock, moved),
    advance: (duration: Duration.Input) =>
      Effect.sync(() => {
        offset += Duration.toMillis(Duration.fromInputUnsafe(duration))
      }),
  }
})

/**
 * Reads until what it reads passes the check, every 20 ms, and gives back what passed. It gives up only near its
 * test's own time (deadline.ts), which is sized for the test and the machine, so no wait sets a time of its own.
 * Giving up, it says which wait it was (`what`, and the line that asked for it) and what it last read.
 */
export const until = <A, E, R>(read: Effect.Effect<A, E, R>, check: (value: A) => boolean, what?: string) => {
  const where = calledFrom()
  return Effect.gen(function* () {
    for (;;) {
      const value = yield* Effect.orDie(read)
      if (check(value)) return value
      if (Date.now() > deadline()) return yield* Effect.die(timedOut(what, where, value))
      yield* Effect.sleep('20 millis')
    }
  })
}
