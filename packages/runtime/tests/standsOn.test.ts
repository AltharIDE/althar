import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Clock, Effect } from 'effect'
import { TestClock } from 'effect/testing'

import { holds, noteLook, noteUnsure, nowFor, nowUntil, there, unnoted, workedOut } from '../src/standsOn'

/*
 * What a kept answer stands on besides the store (standsOn.ts): what it
 * looked at, until when the time it read says the same, and whether it read
 * anything that can't be looked at again, which leaves it unkept.
 */

const look = (key: string, said: string, now: () => string = () => said) => ({ key, said, again: () => Promise.resolve(now()) })

describe('what an answer stands on', () => {
  it.effect('is what it looked at, and holds while each says what it said', () =>
    Effect.gen(function* () {
      let head = 'a'
      const [value, on] = yield* workedOut(
        Effect.as(Effect.andThen(noteLook(look('head', 'a', () => head)), noteLook(look('index', 'i'))), 42),
      )
      assert.deepStrictEqual([value, on.looks.map((one) => one.key), on.unsure, on.until], [42, ['head', 'index'], null, Infinity])
      assert.isTrue(yield* holds(on.looks))
      head = 'b'
      assert.isFalse(yield* holds(on.looks))
      assert.isTrue(yield* holds([]))
    }),
  )

  it.effect('looks at each thing once a read, however many answers stood on it', () =>
    Effect.gen(function* () {
      let looked = 0
      const counted = { key: 'head', said: 'a', again: () => Promise.resolve(String((looked += 1) > 0 ? 'a' : '')) }
      const seen = new Map<string, Promise<string>>()
      assert.isTrue(yield* holds([counted, counted], seen))
      assert.isTrue(yield* holds([counted], seen))
      assert.strictEqual(looked, 1)
    }),
  )

  it.effect('holds nowhere where a look fails', () =>
    Effect.gen(function* () {
      const failing = { key: 'gone', said: 'a', again: () => Promise.reject(new Error('no such folder')) }
      assert.isFalse(yield* holds([failing]))
    }),
  )

  it.effect('is unsure, and says why first, where it read what it can’t look at again', () =>
    Effect.gen(function* () {
      const [, on] = yield* workedOut(Effect.andThen(noteUnsure('git log'), noteUnsure('git diff')))
      assert.strictEqual(on.unsure, 'git log')
      // What is worked out unnoted, under a key of its own, notes nothing.
      const [, quiet] = yield* workedOut(unnoted(Effect.andThen(noteUnsure('git log'), noteLook(look('head', 'a')))))
      assert.deepStrictEqual([quiet.unsure, quiet.looks], [null, []])
      // Outside any answer, nothing is noted, and nothing fails.
      yield* noteUnsure('git log')
      yield* noteLook(look('head', 'a'))
    }),
  )

  it.effect('reads the time unsure, unless a rule says when what it decided changes', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(1_000_000)
      const since = new Date(1_000_000 - 1_000).toISOString()
      // A rule that holds for a minute from a second ago: it holds until then.
      const [now, on] = yield* workedOut(nowFor(since, 60_000))
      assert.deepStrictEqual([now, on.unsure, on.until], [1_000_000, null, 1_000_000 - 1_000 + 60_000])
      // Of several, the first to come; one already past, or with no time, says nothing.
      const [, several] = yield* workedOut(nowUntil(1_000_000 + 5_000, 1_000_000 + 2_000, 1_000_000 - 1, Number.NaN))
      assert.strictEqual(several.until, 1_000_000 + 2_000)
      const [, none] = yield* workedOut(nowFor(null, 60_000))
      assert.strictEqual(none.until, Infinity)
      // Read straight from the clock, nothing says when it changes: not kept.
      const [, read] = yield* workedOut(Clock.currentTimeMillis)
      assert.strictEqual(read.unsure, 'the time')
      const [, nanos] = yield* workedOut(Clock.currentTimeNanos)
      assert.strictEqual(nanos.unsure, 'the time')
      // What Effect reads for itself, unsafely, isn't the answer's, and nor is a wait.
      const [, own] = yield* workedOut(
        Effect.andThen(
          Clock.clockWith((clock) =>
            Effect.sync(() => [clock.currentTimeMillisUnsafe(), clock.currentTimeNanosUnsafe(), clock.monotonicTimeNanosUnsafe()]),
          ),
          Clock.clockWith((clock) => clock.monotonicTimeNanos),
        ),
      )
      assert.strictEqual(own.unsure, null)
      const [, slept] = yield* workedOut(Effect.sleep(0))
      assert.strictEqual(slept.unsure, null)
    }),
  )

  it.effect('is noted in the answer worked out around it', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(1_000_000)
      const [, outer] = yield* workedOut(
        Effect.gen(function* () {
          yield* noteLook(look('outer', 'o'))
          const [, inner] = yield* workedOut(Effect.andThen(noteLook(look('inner', 'i')), nowUntil(1_000_000 + 10)))
          assert.deepStrictEqual(
            inner.looks.map((one) => one.key),
            ['inner'],
          )
          yield* noteUnsure('git status')
        }),
      )
      assert.deepStrictEqual([outer.looks.map((one) => one.key), outer.unsure, outer.until], [['outer', 'inner'], 'git status', 1_000_010])
    }),
  )
})

describe('whether a path is there', () => {
  it.live('says so, and holds while it stays so', () =>
    Effect.gen(function* () {
      const folder = mkdtempSync(join(tmpdir(), 'althar-there-'))
      const [here, on] = yield* workedOut(there(folder))
      assert.isTrue(here)
      assert.isTrue(yield* holds(on.looks))
      rmSync(folder, { recursive: true, force: true })
      assert.isFalse(yield* holds(on.looks))
      const [gone] = yield* workedOut(there(folder))
      assert.isFalse(gone)
    }),
  )
})
