import { Clock, Duration, Effect } from 'effect'
import { TestClock } from 'effect/testing'
import { expect, test } from 'vite-plus/test'

import { readClock } from '../src/effect'

test('moves reads by days without waking the runtime timer, which still fires on its own clock', async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      let fired = false
      yield* Effect.forkChild(
        Effect.andThen(
          Effect.sleep('1 second'),
          Effect.sync(() => {
            fired = true
          }),
        ),
      )
      const clock = yield* readClock
      const other = yield* readClock
      yield* clock.advance('5 days')
      expect(yield* Clock.currentTimeMillis).toBe(0)
      expect(yield* clock.run(Clock.currentTimeMillis)).toBe(5 * 86_400_000)
      expect(yield* clock.run(Clock.currentTimeNanos)).toBe(BigInt(5 * 86_400_000) * 1_000_000n)
      expect(
        yield* clock.run(Clock.clockWith((one) => Effect.succeed([one.currentTimeMillisUnsafe(), one.currentTimeNanosUnsafe()]))),
      ).toEqual([5 * 86_400_000, BigInt(5 * 86_400_000) * 1_000_000n])
      expect(yield* other.run(Clock.currentTimeMillis)).toBe(0)
      expect(fired).toBe(false)
      yield* TestClock.adjust('1 second')
      expect(fired).toBe(true)
      expect(yield* clock.run(Clock.currentTimeMillis)).toBe(5 * 86_400_000 + 1000)
      yield* clock.advance(Duration.nanos(500_000n))
      expect(yield* clock.run(Clock.currentTimeNanos)).toBe(BigInt(5 * 86_400_000 + 1000) * 1_000_000n + 500_000n)
      expect(yield* clock.run(Clock.currentTimeMillis)).toBe(5 * 86_400_000 + 1000.5)
    }).pipe(Effect.provide(TestClock.layer())),
  )
})
