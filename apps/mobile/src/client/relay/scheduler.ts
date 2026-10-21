import { Effect, Scheduler } from 'effect'

/*
 * Effect's scheduler, for a phone. A busy fiber yields every so often, by
 * default with `setImmediate`; on React Native that is a microtask, so the
 * yield lets nothing else run: no timer, no touch, no message from the
 * relay, until the fiber is done (docs/hermes-spike.md). Yielding with
 * `setTimeout` gives them their turn.
 */

export const yielding = new Scheduler.MixedScheduler('async', (run) => {
  const timer = setTimeout(run, 0)
  return () => clearTimeout(timer)
})

/** Runs on the phone's scheduler: everything the relay client runs goes through this. */
export const onPhone = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.provideService(effect, Scheduler.Scheduler, yielding)
