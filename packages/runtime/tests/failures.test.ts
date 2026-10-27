import { assert, describe, it } from '@effect/vitest'
import { Cause, Data, Duration, Effect, Fiber, Option, Stream } from 'effect'
import { TestClock } from 'effect/testing'

import { backoff, contained, type Failure, failureOf, Failures, failuresLayer, keptGoing } from '../src/Failures'
import { agentLost } from '../src/Sessions'

class StoreBusy extends Data.TaggedError('StoreBusy')<{ readonly table: string }> {}

/** Reports gathered as `effect` runs, from a listener of its own. */
const heardWhile = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    const failures = yield* Failures
    const listening = yield* Effect.forkChild(Stream.runCollect(Stream.take(failures.events, 1)))
    yield* Effect.sleep('10 millis')
    const result = yield* Effect.exit(effect)
    const heard = yield* Fiber.join(listening).pipe(Effect.timeoutOption('200 millis'))
    return { result, heard: Option.getOrElse(heard, () => []) as ReadonlyArray<Failure> }
  }).pipe(Effect.provide(failuresLayer))

describe('failures kept to where they belong', () => {
  it('says a tagged error by its tag, an error by its name, and anything else as it says itself', () => {
    const tagged = failureOf(Cause.fail(new StoreBusy({ table: 'accounts' })), 'Status.account', 'codex')
    assert.deepInclude(tagged, { where: 'Status.account', agent: 'codex', name: 'StoreBusy', message: 'StoreBusy' })
    const thrown = failureOf(Cause.die(new TypeError('Not a function')), 'Status')
    assert.deepInclude(thrown, { where: 'Status', agent: null, name: 'TypeError', message: 'Not a function' })
    assert.include(thrown.stack, 'TypeError: Not a function')
    assert.deepStrictEqual(failureOf(Cause.die('a string'), 'agent'), {
      where: 'agent',
      agent: null,
      name: 'Error',
      message: 'a string',
      stack: '',
    })
    const unsayable = { toString: () => assert.fail('never said') }
    assert.strictEqual(failureOf(Cause.die(unsayable), 'agent').message, 'object')
  })

  it.live('gives what stands in for what failed, logs it and reports it, and the rest carries on', () =>
    Effect.gen(function* () {
      const { result, heard } = yield* heardWhile(
        Effect.die(new RangeError('Out of range')).pipe(contained('Status.version', () => null, 'opencode')),
      )
      assert.deepStrictEqual(result, Effect.succeed(null).pipe(Effect.runSyncExit))
      assert.deepInclude(heard[0], { where: 'Status.version', agent: 'opencode', name: 'RangeError', message: 'Out of range' })
    }),
  )

  it.live('lets what was asked to stop stop, and says nothing of it', () =>
    Effect.gen(function* () {
      const { result, heard } = yield* heardWhile(Effect.interrupt.pipe(contained('Status', () => 'stood in')))
      assert.isTrue(result._tag === 'Failure' && Cause.hasInterruptsOnly(result.cause))
      assert.deepStrictEqual(heard, [])
    }),
  )

  it.effect('only logs where nothing listens, as in the CLI', () =>
    Effect.gen(function* () {
      assert.strictEqual(yield* Effect.fail('broken').pipe(contained('Status', () => 'stood in')), 'stood in')
      assert.deepStrictEqual(yield* Stream.runCollect((yield* Failures).events), [])
    }),
  )

  it.effect('keeps an item that fails apart a while, longer each time it fails again, until it goes through', () =>
    Effect.gen(function* () {
      const tries = backoff(Duration.seconds(10), Duration.seconds(30))
      const busy = Effect.fail(new StoreBusy({ table: 'task_plans' }))
      assert.strictEqual(tries.until('plan'), 0)
      yield* tries.attempt('plan', 'Plans.start', busy)
      assert.strictEqual(tries.until('plan'), 10_000)
      yield* tries.attempt('plan', 'Plans.start', busy)
      assert.strictEqual(tries.until('plan'), 20_000)
      // At most as long as it says, however often it fails.
      yield* tries.attempt('plan', 'Plans.start', busy)
      yield* tries.attempt('plan', 'Plans.start', busy)
      assert.strictEqual(tries.until('plan'), 30_000)
      // Each item is its own.
      assert.strictEqual(tries.until('another'), 0)
      yield* tries.attempt('plan', 'Plans.start', Effect.void)
      assert.strictEqual(tries.until('plan'), 0)
    }),
  )

  it.effect('forgets an item not tried again long after its wait, as one the loop no longer has', () =>
    Effect.gen(function* () {
      const tries = backoff(Duration.seconds(10), Duration.seconds(30))
      const busy = Effect.fail(new StoreBusy({ table: 'task_plans' }))
      yield* tries.attempt('gone', 'Plans.start', busy)
      yield* TestClock.adjust(Duration.seconds(30))
      yield* tries.attempt('other', 'Plans.start', busy)
      assert.strictEqual(tries.until('gone'), 10_000, 'not while it may still come back')
      yield* TestClock.adjust(Duration.seconds(11))
      yield* tries.attempt('other', 'Plans.start', busy)
      assert.strictEqual(tries.until('gone'), 0)
    }),
  )

  it.effect('keeps a loop going after a round of it fails, a while after', () =>
    Effect.gen(function* () {
      let rounds = 0
      const loop = Effect.suspend(() => {
        rounds += 1
        return rounds === 1 ? Effect.die(new RangeError('Out of range')) : Effect.never
      })
      const going = yield* Effect.forkChild(keptGoing('Plans.countdown', loop, Duration.seconds(10)))
      yield* TestClock.adjust(Duration.seconds(5))
      assert.strictEqual(rounds, 1)
      yield* TestClock.adjust(Duration.seconds(5))
      assert.strictEqual(rounds, 2)
      yield* Fiber.interrupt(going)
    }),
  )

  it('says an agent that went on its own by its id and how its process ended, never what it wrote, and with no stack', () => {
    const lost = agentLost('codex', Option.some({ code: 3, signal: null }))
    assert.deepStrictEqual(
      [lost.name, lost.message, lost.stack],
      ['AgentLost', 'The codex agent stopped on its own: exit code 3, signal none.', ''],
    )
    assert.strictEqual(agentLost('codex', Option.none()).message, 'The codex agent stopped on its own: no exit seen.')
    assert.deepInclude(failureOf(Cause.die(lost), 'agent', 'codex'), { name: 'AgentLost', stack: '' })
  })
})
