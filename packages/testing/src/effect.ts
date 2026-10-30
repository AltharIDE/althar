import { Effect } from 'effect'

import { deadline } from './deadline'

/**
 * Reads until what it reads passes the check, every 20 ms, and gives back what passed. It gives up only near its
 * test's own time (deadline.ts), which is sized for the test and the machine, so no wait sets a time of its own.
 * Giving up, it says what it last read.
 */
export const until = <A, E, R>(read: Effect.Effect<A, E, R>, check: (value: A) => boolean) =>
  Effect.gen(function* () {
    for (;;) {
      const value = yield* Effect.orDie(read)
      if (check(value)) return value
      if (Date.now() > deadline()) return yield* Effect.die(new Error(`Timed out waiting; last saw ${JSON.stringify(value)}`))
      yield* Effect.sleep('20 millis')
    }
  })
