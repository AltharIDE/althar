import { assert, it } from '@effect/vitest'
import { Effect, Fiber } from 'effect'
import { TestClock } from 'effect/testing'
import { vi } from 'vitest'

import { GitFailed } from '../src/errors'
import { gitWithin } from '../src/git'

const stopped = vi.hoisted(() => vi.fn())
vi.mock('../src/spawner', async (original) => ({
  ...(await original<typeof import('../src/spawner')>()),
  // A root exited, but an inherited output pipe still has no EOF or close acknowledgement.
  startApart: () => ({ result: new Promise(() => {}), stop: stopped }),
}))

it.effect('ends a git read at its deadline without waiting for a runner close acknowledgement', () =>
  Effect.gen(function* () {
    stopped.mockClear()
    const read = yield* Effect.forkChild(Effect.exit(gitWithin(1_000, '.', 'status')))
    yield* TestClock.adjust(1_001)
    yield* Effect.yieldNow
    assert.isDefined(read.pollUnsafe(), 'the deadline must finish the read without waiting for the runner')
    const result = yield* Fiber.join(read)
    assert.strictEqual(result._tag, 'Failure')
    if (result._tag !== 'Failure') return
    const error = yield* Effect.flip(Effect.failCause(result.cause))
    assert.instanceOf(error, GitFailed)
    assert.isTrue(error.timedOut)
    assert.strictEqual(error.timeout, 1_000)
    assert.deepStrictEqual(error.args, ['status'])
    assert.notProperty(error, 'signal')
    assert.notProperty(error, 'code')
    assert.isAtLeast(stopped.mock.calls.length, 1)
  }),
)
