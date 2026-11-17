import { ConnectorFailed } from '@althar/connectors'
import { assert, describe, it } from '@effect/vitest'
import { Clock, Deferred, Effect, Exit, Fiber } from 'effect'
import { TestClock } from 'effect/testing'

import { makeIssuePace, type PacedFiling } from '../src/issuePace'

const limited = (retryAt?: number) =>
  new ConnectorFailed({
    product: 'linear',
    reason: 'rate_limited',
    message: 'Slow down',
    status: 400,
    ...(retryAt === undefined ? {} : { retryAt: new Date(retryAt).toISOString() }),
  })

/** A filing that writes down what it does, as at what time, and answers each ask with the next of `answers`. */
const filing = (
  log: Array<string>,
  name: string,
  answers: Array<Effect.Effect<string, ConnectorFailed>> = [],
  go = true,
): PacedFiling<string, never, never> => ({
  waiting: (until) => Effect.map(Clock.currentTimeMillis, (now) => void log.push(`${name} waits ${(until - now) / 1000}s`)),
  start: Effect.map(Clock.currentTimeMillis, (now) => (log.push(`${name} asks at ${now / 1000}s`), go)),
  attempt: Effect.suspend(() => answers.shift() ?? Effect.succeed(name)),
})

describe('issues filed on a tracker', () => {
  it.effect('go one at a time on an account, a second apart, while another account files at once', () =>
    Effect.gen(function* () {
      const pace = makeIssuePace()
      const log: Array<string> = []
      const release = yield* Deferred.make<void>()
      const first = yield* Effect.forkChild(pace.run('linear:alice', filing(log, 'first', [Effect.as(Deferred.await(release), 'first')])))
      yield* Effect.yieldNow
      const second = yield* Effect.forkChild(pace.run('linear:alice', filing(log, 'second')))
      const other = yield* Effect.forkChild(pace.run('github:bob', filing(log, 'other')))
      yield* Effect.yieldNow
      // The first is still being asked: the second waits for it, the other account's goes.
      assert.deepStrictEqual(log, ['first asks at 0s', 'other asks at 0s'])
      assert.deepStrictEqual(yield* Fiber.join(other), { stopped: false, value: 'other' })
      yield* TestClock.adjust('2 seconds')
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(first)
      yield* Effect.yieldNow
      // Answered at 2s, the next on its account is asked a second later.
      assert.deepStrictEqual(log, ['first asks at 0s', 'other asks at 0s'])
      yield* TestClock.adjust('1 second')
      assert.deepStrictEqual(yield* Fiber.join(second), { stopped: false, value: 'second' })
      assert.deepStrictEqual(log, ['first asks at 0s', 'other asks at 0s', 'second asks at 3s'])
    }),
  )

  it.effect('wait for the reset a refusal for too many calls says, then ask again, and hold the account’s next filing until then', () =>
    Effect.gen(function* () {
      const pace = makeIssuePace()
      const log: Array<string> = []
      const first = yield* Effect.forkChild(pace.run('linear:alice', filing(log, 'first', [Effect.fail(limited(20_000))])))
      yield* Effect.yieldNow
      const second = yield* Effect.forkChild(pace.run('linear:alice', filing(log, 'second')))
      yield* TestClock.adjust('19 seconds')
      assert.deepStrictEqual(log, ['first asks at 0s', 'first waits 20s'])
      yield* TestClock.adjust('1 second')
      assert.deepStrictEqual(yield* Fiber.join(first), { stopped: false, value: 'first' })
      yield* TestClock.adjust('1 second')
      assert.deepStrictEqual(yield* Fiber.join(second), { stopped: false, value: 'second' })
      assert.deepStrictEqual(log, ['first asks at 0s', 'first waits 20s', 'first asks at 20s', 'second asks at 21s'])
    }),
  )

  it.effect('back off, doubling, where the tracker says no time, and stop after their tries with when to try again', () =>
    Effect.gen(function* () {
      const pace = makeIssuePace({ gap: 1_000, longest: 60_000, tries: 3, backoff: 5_000 })
      const log: Array<string> = []
      const fiber = yield* Effect.forkChild(
        Effect.exit(
          pace.run('trello:carol', filing(log, 'card', [Effect.fail(limited()), Effect.fail(limited()), Effect.fail(limited())])),
        ),
      )
      yield* TestClock.adjust('5 seconds')
      yield* TestClock.adjust('10 seconds')
      const exit = yield* Fiber.join(fiber)
      assert.deepStrictEqual(log, ['card asks at 0s', 'card waits 5s', 'card asks at 5s', 'card waits 10s', 'card asks at 15s'])
      assert.isTrue(Exit.isFailure(exit))
      const error = Exit.isFailure(exit) ? exit.cause.reasons[0] : undefined
      assert.strictEqual(error?._tag === 'Fail' ? (error.error as ConnectorFailed).retryAt : undefined, new Date(35_000).toISOString())
    }),
  )

  it.effect('say a reset further off than they wait, and ask nothing more of the account until it', () =>
    Effect.gen(function* () {
      const pace = makeIssuePace()
      const log: Array<string> = []
      const hour = 60 * 60 * 1000
      const first = yield* Effect.exit(pace.run('linear:alice', filing(log, 'first', [Effect.fail(limited(hour))])))
      assert.isTrue(Exit.isFailure(first))
      // Refused for an hour: the next filing on the account is refused with the same, without asking the tracker.
      yield* TestClock.adjust('10 minutes')
      const second = yield* Effect.exit(pace.run('linear:alice', filing(log, 'second')))
      assert.deepStrictEqual(log, ['first asks at 0s'])
      const said = Exit.isFailure(second) ? second.cause.reasons[0] : undefined
      assert.strictEqual(said?._tag === 'Fail' ? (said.error as ConnectorFailed).retryAt : undefined, new Date(hour).toISOString())
      // Another account is not held by it.
      assert.deepStrictEqual(yield* pace.run('linear:dana', filing(log, 'other')), { stopped: false, value: 'other' })
      // Once it reopens, the account files again.
      yield* TestClock.adjust('50 minutes')
      assert.deepStrictEqual(yield* pace.run('linear:alice', filing(log, 'third')), { stopped: false, value: 'third' })
    }),
  )

  it.effect('never ask again after any other failure: a refusal, or an answer lost', () =>
    Effect.gen(function* () {
      const pace = makeIssuePace()
      for (const reason of ['rejected', 'unreachable', 'invalid_response'] as const) {
        const log: Array<string> = []
        const exit = yield* Effect.exit(
          pace.run(
            `linear:${reason}`,
            filing(log, reason, [Effect.fail(new ConnectorFailed({ product: 'linear', reason, message: reason }))]),
          ),
        )
        assert.deepStrictEqual(log, [`${reason} asks at 0s`])
        const failed = Exit.isFailure(exit) ? exit.cause.reasons[0] : undefined
        assert.strictEqual(failed?._tag === 'Fail' ? (failed.error as ConnectorFailed).reason : undefined, reason)
      }
    }),
  )

  it.effect('stop without asking where the filing says not to go on, as a draft discarded while it waited', () =>
    Effect.gen(function* () {
      const pace = makeIssuePace()
      const log: Array<string> = []
      assert.deepStrictEqual(yield* pace.run('linear:alice', filing(log, 'gone', [Effect.die('asked')], false)), { stopped: true })
    }),
  )

  it.effect('keep no account whose waits are past', () =>
    Effect.gen(function* () {
      const pace = makeIssuePace()
      yield* pace.run('linear:alice', filing([], 'one'))
      yield* pace.run('github:bob', filing([], 'two'))
      assert.strictEqual(pace.size(), 2)
      yield* TestClock.adjust('2 seconds')
      yield* pace.run('linear:alice', filing([], 'three'))
      assert.strictEqual(pace.size(), 1)
    }),
  )

  it.effect('let the next on an account go when one is interrupted while it waits', () =>
    Effect.gen(function* () {
      const pace = makeIssuePace()
      const log: Array<string> = []
      const first = yield* Effect.forkChild(pace.run('linear:alice', filing(log, 'first', [Effect.fail(limited(30_000))])))
      const queued = yield* Effect.forkChild(pace.run('linear:alice', filing(log, 'queued')))
      yield* Effect.yieldNow
      yield* Fiber.interrupt(first)
      yield* Fiber.interrupt(queued)
      // The reset the tracker said still holds the account; the next asks once it is past.
      const next = yield* Effect.forkChild(pace.run('linear:alice', filing(log, 'next')))
      yield* TestClock.adjust('30 seconds')
      assert.deepStrictEqual(yield* Fiber.join(next), { stopped: false, value: 'next' })
      assert.deepStrictEqual(log, ['first asks at 0s', 'first waits 30s', 'next waits 30s', 'next asks at 30s'])
    }),
  )
})
