import { Effect } from 'effect'

/** Works out a large home's cards in order, letting other runtime calls run between cards. */
export const readHomeCards = <A, B, E, R>(rows: ReadonlyArray<A>, size: number, read: (row: A) => Effect.Effect<B, E, R>) =>
  Effect.forEach(rows, (row) => Effect.andThen(Effect.yieldNow, read(row)), {
    concurrency: size,
  })
