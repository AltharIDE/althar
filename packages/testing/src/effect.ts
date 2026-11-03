import { Effect } from 'effect'

import { deadline } from './deadline'
import { calledFrom, timedOut } from './seen'

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
