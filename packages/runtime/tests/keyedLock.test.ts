import { assert, describe, it } from '@effect/vitest'
import { Deferred, Effect, Fiber } from 'effect'

import { makeKeyedLock } from '../src/keyedLock'

describe('keyedLock', () => {
  it.effect('runs one at a time on a key, and others on other keys beside it', () =>
    Effect.gen(function* () {
      const locks = makeKeyedLock()
      const order: Array<string> = []
      const gate = yield* Deferred.make<void>()
      const first = yield* Effect.forkChild(
        locks.withLock(
          'a',
          Effect.map(Deferred.await(gate), () => order.push('a1')),
        ),
      )
      yield* Effect.yieldNow
      const second = yield* Effect.forkChild(
        locks.withLock(
          'a',
          Effect.sync(() => order.push('a2')),
        ),
      )
      yield* locks.withLock(
        'b',
        Effect.sync(() => order.push('b')),
      )
      assert.deepStrictEqual(order, ['b'])
      yield* Deferred.succeed(gate, undefined)
      yield* Fiber.join(first)
      yield* Fiber.join(second)
      assert.deepStrictEqual(order, ['b', 'a1', 'a2'])
    }),
  )

  it.effect('keeps no lock for a key once nothing holds or waits on it', () =>
    Effect.gen(function* () {
      const locks = makeKeyedLock()
      for (let i = 0; i < 100; i++) yield* locks.withLock(`task-${i}`, Effect.void)
      assert.strictEqual(locks.size(), 0)
      yield* Effect.exit(locks.withLock('failing', Effect.fail('no')))
      assert.strictEqual(locks.size(), 0)
    }),
  )

  it.effect('lets go of a key whose waiter is interrupted', () =>
    Effect.gen(function* () {
      const locks = makeKeyedLock()
      const gate = yield* Deferred.make<void>()
      const holder = yield* Effect.forkChild(locks.withLock('a', Deferred.await(gate)))
      yield* Effect.yieldNow
      const waiter = yield* Effect.forkChild(locks.withLock('a', Effect.void))
      yield* Effect.yieldNow
      yield* Fiber.interrupt(waiter)
      assert.strictEqual(locks.size(), 1)
      yield* Deferred.succeed(gate, undefined)
      yield* Fiber.join(holder)
      assert.strictEqual(locks.size(), 0)
    }),
  )
})
