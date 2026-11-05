import { assert, describe, it } from '@effect/vitest'
import { Deferred, Effect, Fiber } from 'effect'
import { TestClock } from 'effect/testing'

import { INPUT_QUIET, makeInputBatches } from '../src/inputBatches'

describe('input bursts', () => {
  it.effect('waits for quiet after the last message, and flushes once', () =>
    Effect.gen(function* () {
      const flushed: Array<string> = []
      const batches = makeInputBatches(yield* Effect.scope, (id) =>
        Effect.sync(() => {
          flushed.push(id)
        }),
      )
      yield* batches.hold('thread', Effect.void)
      yield* TestClock.adjust(INPUT_QUIET - 1)
      assert.deepStrictEqual(flushed, [])
      yield* batches.hold('thread', Effect.void)
      yield* TestClock.adjust(1)
      assert.deepStrictEqual(flushed, [])
      yield* TestClock.adjust(INPUT_QUIET - 1)
      yield* batches.ready('thread')
      assert.deepStrictEqual(flushed, ['thread'])
      assert.isFalse(batches.pending('thread'))
    }),
  )

  it.effect('holds a thread behind preparation, without blocking another thread, and releases cancelled sends', () =>
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const accepted: Array<string> = []
      const flushed: Array<string> = []
      const batches = makeInputBatches(yield* Effect.scope, (id) =>
        Effect.sync(() => {
          flushed.push(id)
        }),
      )
      const first = yield* Effect.forkChild(
        batches.accepting(
          'thread',
          Effect.gen(function* () {
            yield* Deferred.succeed(entered, undefined)
            yield* Deferred.await(release)
            accepted.push('first')
          }),
        ),
      )
      yield* Deferred.await(entered)
      const second = yield* Effect.forkChild(
        batches.accepting(
          'thread',
          Effect.sync(() => {
            accepted.push('second')
          }),
        ),
      )
      yield* batches.accepting('other', Effect.void)
      yield* TestClock.adjust(INPUT_QUIET)
      assert.deepStrictEqual(accepted, [])
      assert.deepStrictEqual(flushed, ['other'])
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(first)
      yield* Fiber.join(second)
      assert.deepStrictEqual(accepted, ['first', 'second'])
      yield* TestClock.adjust(INPUT_QUIET)
      yield* batches.ready('thread')
      assert.deepStrictEqual(flushed, ['other', 'thread'])

      const cancelEntered = yield* Deferred.make<void>()
      const cancelled = yield* Effect.forkChild(
        batches.accepting('thread', Effect.andThen(Deferred.succeed(cancelEntered, undefined), Effect.never)),
      )
      yield* Deferred.await(cancelEntered)
      yield* Fiber.interrupt(cancelled)
      yield* TestClock.adjust(INPUT_QUIET)
      yield* batches.ready('thread')
      assert.isFalse(batches.pending('thread'))
    }),
  )
})
