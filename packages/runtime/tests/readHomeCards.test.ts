import { assert, it } from '@effect/vitest'
import { Effect } from 'effect'
import { readHomeCards } from '../src/readHomeCards'

it.live('lets another event-loop callback run before a large home finishes, without changing card order', () =>
  Effect.gen(function* () {
    const rows = Array.from({ length: 32 }, (_, index) => index)
    let read = 0
    let saw = -1
    let signal!: () => void
    const called = new Promise<void>((resolve) => (signal = resolve))
    const result = yield* readHomeCards(rows, 8, (row) =>
      Effect.sync(() => {
        if (row === 0)
          setImmediate(() => {
            saw = read
            signal()
          })
        read += 1
        return row
      }),
    )
    yield* Effect.promise(() => called)
    assert.isAbove(saw, 0)
    assert.isBelow(saw, rows.length)
    assert.deepStrictEqual(result, rows)
  }),
)
