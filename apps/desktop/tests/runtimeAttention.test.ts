import { MessageChannel } from 'node:worker_threads'

import { AttentionApi, ClientAuthority, emitterPort, serverProtocol, type AttentionEvent } from '@althar/contracts'
import { until } from '@althar/testing/effect'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer, Stream } from 'effect'
import { RpcServer } from 'effect/rpc'

import { watchRuntimeAttention } from '../src/main/runtimeAttention'

describe('native attention over the shared API', () => {
  it.live('delivers typed notifications and stops its connection with the launch', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const channel = new MessageChannel()
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            channel.port1.close()
            channel.port2.close()
          }),
        )
        const expected: AttentionEvent[] = [
          { _tag: 'Waiting', count: 2 },
          { _tag: 'Working', working: true },
          { _tag: 'Nudge', kind: 'ready', key: 'finished', title: 'Finished', body: 'Ready to review', threadId: 'thread' },
        ]
        yield* Effect.forkScoped(
          Layer.launch(
            RpcServer.layer(AttentionApi).pipe(
              Layer.provide(AttentionApi.toLayer({ WatchAttention: () => Stream.concat(Stream.fromIterable(expected), Stream.never) })),
              Layer.provide(Layer.succeed(ClientAuthority, (effect) => effect)),
              Layer.provide(serverProtocol(emitterPort(channel.port1))),
            ),
          ),
        )
        const heard: AttentionEvent[] = []
        const failures: string[] = []
        const stop = watchRuntimeAttention(
          emitterPort(channel.port2),
          (event) => heard.push(event),
          (reason) => failures.push(reason),
        )
        yield* Effect.addFinalizer(() => Effect.sync(stop))
        yield* until(
          Effect.sync(() => heard.length),
          (count) => count === expected.length,
        )
        assert.deepStrictEqual(heard, expected)
        stop()
        assert.deepStrictEqual(failures, [])
      }),
    ),
  )
})
