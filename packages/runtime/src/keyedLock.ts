import { Effect, Semaphore } from 'effect'

/**
 * One at a time per key: a task's, a thread's, a place's. A key's lock is
 * kept only while something holds it or waits on it, so keys come and go
 * for as long as Althar runs without one staying behind for each.
 */
export interface KeyedLock {
  /** Runs `effect` once no other on `key` is running, then lets the next go. */
  readonly withLock: <A, E, R>(key: string, effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  /** How many keys are held or waited on: the locks kept now. */
  readonly size: () => number
}

export const makeKeyedLock = (): KeyedLock => {
  const held = new Map<string, { readonly lock: Semaphore.Semaphore; users: number }>()
  const withLock = <A, E, R>(key: string, effect: Effect.Effect<A, E, R>) =>
    Effect.uninterruptibleMask((restore) => {
      const entry = held.get(key) ?? { lock: Semaphore.makeUnsafe(1), users: 0 }
      entry.users++
      held.set(key, entry)
      return restore(entry.lock.withPermits(1)(effect)).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            entry.users--
            if (entry.users === 0 && held.get(key) === entry) held.delete(key)
          }),
        ),
      )
    })
  return { withLock, size: () => held.size }
}
