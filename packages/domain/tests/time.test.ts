import { assert, describe, it } from '@effect/vitest'
import { Effect, Schema } from 'effect'
import { TestClock } from 'effect/testing'

import { now, Timestamp } from '../src/time'

describe('time', () => {
  it.effect('is read from the Effect clock, in UTC with milliseconds', () =>
    Effect.gen(function* () {
      assert.strictEqual(yield* now, '1970-01-01T00:00:00.000Z')
      yield* TestClock.adjust(90_061_001)
      assert.strictEqual(yield* now, '1970-01-02T01:01:01.001Z')
    }),
  )

  it('accepts only UTC with milliseconds', () => {
    const isTimestamp = Schema.is(Timestamp)
    assert.isTrue(isTimestamp('2026-09-28T20:34:23.123Z'))
    assert.isFalse(isTimestamp('2026-09-28T20:34:23Z'))
    assert.isFalse(isTimestamp('2026-09-28T21:34:23.123+01:00'))
    assert.isFalse(isTimestamp('2026-09-28'))
  })
})
