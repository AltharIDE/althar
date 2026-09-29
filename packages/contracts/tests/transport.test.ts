import { MessageChannel } from 'node:worker_threads'

import { assert, describe, it } from '@effect/vitest'
import { Effect, Fiber, Layer, Schema, Stream } from 'effect'
import { Rpc, RpcClient, RpcGroup, RpcServer } from 'effect/rpc'

import { clientProtocol, emitterPort, serverProtocol } from '../src/transport'

class Nope extends Schema.TaggedError<Nope>()('Nope', { why: Schema.String }) {}

const Echo = RpcGroup.make(
  Rpc.make('Echo', { payload: { text: Schema.String }, success: Schema.String }),
  Rpc.make('Refuse', { payload: { why: Schema.String }, error: Nope }),
  Rpc.make('Count', { payload: { to: Schema.Number }, success: Schema.Number, stream: true }),
)

const handlers = Echo.toLayer({
  Echo: ({ text }) => Effect.succeed(`echo: ${text}`),
  Refuse: ({ why }) => Effect.fail(new Nope({ why })),
  Count: ({ to }) => Stream.range(1, to),
})

/** A server and a client on the two ends of one channel, as the runtime and the window are. */
const connected = Effect.gen(function* () {
  const channel = new MessageChannel()
  yield* Effect.addFinalizer(() => Effect.sync(() => channel.port1.close()))
  const server = RpcServer.layer(Echo).pipe(
    Layer.provide(handlers),
    Layer.provide(serverProtocol(emitterPort(channel.port1, (data) => data))),
  )
  yield* Layer.build(server)
  const protocol = yield* Layer.build(clientProtocol(emitterPort(channel.port2, (data) => data)))
  return yield* RpcClient.make(Echo).pipe(Effect.provideContext(protocol))
})

describe('the transport', () => {
  it.live('carries a call, a typed failure and a stream over a message port', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* connected
        assert.strictEqual(yield* client.Echo({ text: 'hi' }), 'echo: hi')
        const refused = yield* Effect.flip(client.Refuse({ why: 'not today' }))
        assert.instanceOf(refused, Nope)
        assert.strictEqual(refused.why, 'not today')
        assert.deepStrictEqual(yield* Stream.runCollect(client.Count({ to: 3 })), [1, 2, 3])
        // A stream that stays open doesn't hold up other calls.
        const open = yield* Effect.forkChild(Stream.runDrain(client.Count({ to: 1_000_000 })))
        assert.strictEqual(yield* client.Echo({ text: 'still here' }), 'echo: still here')
        yield* Fiber.interrupt(open)
      }),
    ),
  )
})
