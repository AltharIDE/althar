import { MessageChannel } from 'node:worker_threads'

import { emitterPort } from '@althar/contracts'
import { assert, it } from '@effect/vitest'
import { Deferred, Effect, Fiber } from 'effect'

import { untilPortCloses } from '../src/lifetime'

it.live('supports a caller-owned port without close notifications while serving completes normally', () =>
  Effect.gen(function* () {
    const port = { post: () => {}, listen: () => () => {} }
    assert.strictEqual(yield* untilPortCloses(port, Effect.succeed('done')), 'done')
  }),
)

it.live('releases connection-owned resources before returning after a real peer disconnect', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const channel = new MessageChannel()
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          channel.port1.close()
          channel.port2.close()
        }),
      )
      const ready = yield* Deferred.make<void>()
      let released = false
      const serving = Effect.scoped(
        Effect.gen(function* () {
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              released = true
            }),
          )
          yield* Deferred.succeed(ready, undefined)
          yield* Effect.never
        }),
      )
      const fiber = yield* Effect.forkScoped(untilPortCloses(emitterPort(channel.port1), serving))
      yield* Deferred.await(ready)
      channel.port2.close()
      yield* Fiber.join(fiber)
      assert.isTrue(released)
      assert.strictEqual(channel.port1.listenerCount('close'), 0)
    }),
  ),
)

it.live('removes its close listener when serving finishes first', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const channel = new MessageChannel()
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          channel.port1.close()
          channel.port2.close()
        }),
      )
      yield* untilPortCloses(emitterPort(channel.port1), Effect.void)
      assert.strictEqual(channel.port1.listenerCount('close'), 0)
    }),
  ),
)
