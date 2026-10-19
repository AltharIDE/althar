import { words } from '@althar/runtime'
import { Effect } from 'effect'

/*
 * The store is held by another runtime (`DatabaseInUse`): another Althar on
 * this profile, or the command-line client. The person caused it and can put
 * it right by closing that one, so it isn't a crash (ADR-047): the runtime
 * says so to the main process, in the words the runtime has for it, serves
 * nothing, and waits to be shut down. Main starts no other runtime, and the
 * window says it, with a way to try again.
 */
export const profileInUse = (post: (message: unknown) => void): Effect.Effect<never> =>
  Effect.andThen(
    Effect.sync(() => post({ type: 'profile-in-use', reason: words({ _tag: 'DatabaseInUse' }, (id) => id).message })),
    Effect.never,
  )
