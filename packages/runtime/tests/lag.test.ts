import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Fiber, Logger, References } from 'effect'
import { TestClock } from 'effect/testing'

import { lagLogged, lagOf, slowCall, watchLag } from '../src/lag'

/*
 * A development build's runtime says when its thread ran late, and which of
 * the window's calls took long (lag.ts): what holds the thread the window is
 * answered on shows in its log where it happens.
 */

/** What was logged: each line's words and what it was annotated with. */
const logged = () => {
  const lines: Array<{ readonly message: unknown; readonly annotations: Readonly<Record<string, unknown>> }> = []
  const logger = Logger.make((options) =>
    lines.push({ message: options.message, annotations: { ...options.fiber.getRef(References.CurrentLogAnnotations) } }),
  )
  return { lines, layer: Logger.layer([logger]) }
}

const said = (message: unknown) => (Array.isArray(message) ? message.join(' ') : String(message))

describe('the log of a late loop', () => {
  it('is on only where the app asks, as a development build does', () => {
    assert.isTrue(lagLogged({ ALTHAR_LAG_LOG: '1' }))
    assert.isFalse(lagLogged({}))
  })

  it('reads a window of the loop in milliseconds, and none as no lateness', () => {
    assert.deepStrictEqual(lagOf({ max: 250_000_000, mean: 12_340_000, percentile: () => 180_000_000 }), {
      maxMs: 250,
      p99Ms: 180,
      meanMs: 12.3,
    })
    assert.strictEqual(lagOf({ max: 0, mean: Number.NaN, percentile: () => 0 }).meanMs, 0)
  })

  it.effect('says each window the loop ran late in, and nothing of one it kept up in', () => {
    const { lines, layer } = logged()
    const windows = [
      { maxMs: 40, p99Ms: 20, meanMs: 5 },
      { maxMs: 900, p99Ms: 600, meanMs: 30 },
    ]
    return Effect.gen(function* () {
      yield* watchLag({ every: Duration.seconds(5), read: () => windows.shift() ?? { maxMs: 0, p99Ms: 0, meanMs: 0 } })
      yield* TestClock.adjust(Duration.seconds(5))
      assert.lengthOf(lines, 0)
      yield* TestClock.adjust(Duration.seconds(5))
      assert.deepStrictEqual(
        lines.map((line) => [said(line.message), line.annotations]),
        [['Event loop ran late', { max_ms: 900, p99_ms: 600, mean_ms: 30 }]],
      )
    }).pipe(Effect.scoped, Effect.provide(layer))
  })

  it.effect('watches the loop itself where no test reads it, until its scope ends', () =>
    Effect.scoped(watchLag()).pipe(Effect.andThen(Effect.void)),
  )
})

describe('a slow call', () => {
  it.effect('is said with its name and how long it took; a quick one is not', () => {
    const { lines, layer } = logged()
    return Effect.gen(function* () {
      const quick = yield* slowCall(Effect.succeed('GetBoard'), Effect.succeed(1))
      const slow = yield* Effect.forkChild(slowCall(Effect.succeed('Ship'), Effect.as(Effect.sleep(Duration.seconds(2)), 2)))
      yield* TestClock.adjust(Duration.seconds(2))
      assert.deepStrictEqual([quick, yield* Fiber.join(slow)], [1, 2])
      assert.deepStrictEqual(
        lines.map((line) => [said(line.message), line.annotations]),
        [['Slow call', { call: 'Ship', ms: 2000 }]],
      )
    }).pipe(Effect.provide(layer))
  })
})
