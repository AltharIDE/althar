import { MessageChannel } from 'node:worker_threads'

import { assert, describe, it } from '@effect/vitest'
import { Effect, Exit, Fiber, Layer, Schema, Scope, Stream } from 'effect'
import { Rpc, RpcClient, RpcGroup, RpcServer } from 'effect/rpc'

import { clientProtocol, type DomMessagePort, domPort, emitterPort, type PortLike, serverProtocol } from '../src/transport'

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

/** A port that says when its listeners come and go. */
const watched = (port: PortLike) => {
  const seen = { listening: 0, watchingClose: 0 }
  return {
    seen,
    port: {
      post: (message: unknown) => port.post(message),
      listen: (handler: (data: unknown) => void) => {
        seen.listening += 1
        const stop = port.listen(handler)
        return () => {
          seen.listening -= 1
          stop()
        }
      },
      closed: (handler: () => void) => {
        seen.watchingClose += 1
        const stop = port.closed?.(handler) ?? (() => {})
        return () => {
          seen.watchingClose -= 1
          stop()
        }
      },
    } satisfies PortLike,
  }
}

/** A server on its own fiber, as the runtime runs one per window: it ends when its client goes. */
const serve = (port: PortLike) =>
  Effect.forkScoped(Layer.launch(RpcServer.layer(Echo).pipe(Layer.provide(handlers), Layer.provide(serverProtocol(port)))))

const client = (port: PortLike) =>
  Effect.gen(function* () {
    const protocol = yield* Layer.build(clientProtocol(port))
    return yield* RpcClient.make(Echo).pipe(Effect.provideContext(protocol))
  })

const settled = (check: () => boolean) =>
  Effect.gen(function* () {
    for (let tries = 0; tries < 100 && !check(); tries += 1) yield* Effect.sleep('10 millis')
    return check()
  })

describe('the transport', () => {
  it.live('carries a call, a typed failure and a stream over a message port', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const channel = new MessageChannel()
        yield* Effect.addFinalizer(() => Effect.sync(() => channel.port1.close()))
        yield* serve(emitterPort(channel.port1, (data) => data))
        const echo = yield* client(emitterPort(channel.port2, (data) => data))
        assert.strictEqual(yield* echo.Echo({ text: 'hi' }), 'echo: hi')
        const refused = yield* Effect.flip(echo.Refuse({ why: 'not today' }))
        assert.instanceOf(refused, Nope)
        assert.strictEqual(refused.why, 'not today')
        assert.deepStrictEqual(yield* Stream.runCollect(echo.Count({ to: 3 })), [1, 2, 3])
        // A stream that stays open doesn't hold up other calls.
        const open = yield* Effect.forkChild(Stream.runDrain(echo.Count({ to: 1_000_000 })))
        assert.strictEqual(yield* echo.Echo({ text: 'still here' }), 'echo: still here')
        yield* Fiber.interrupt(open)
      }),
    ),
  )

  it.live("speaks to a window's DOM port, and unwraps an Electron port's events", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const channel = new MessageChannel()
        yield* Effect.addFinalizer(() => Effect.sync(() => channel.port1.close()))
        // Node's ports emit the message itself, which the default reads as is: the protocol's messages are arrays.
        yield* serve(emitterPort(channel.port1))
        const echo = yield* client(domPort(channel.port2 as unknown as DomMessagePort))
        assert.strictEqual(yield* echo.Echo({ text: 'from the window' }), 'echo: from the window')

        // Electron's ports emit an event with the message in `.data`.
        const heard: Array<unknown> = []
        const electron = {
          postMessage: () => {},
          on: (_: string, listener: (event: unknown) => void) => listener({ data: [1] }),
          off: () => {},
        }
        emitterPort(electron).listen((data) => heard.push(data))
        assert.deepStrictEqual(heard, [[1]])
      }),
    ),
  )

  it.live('stops serving a client once it closes, or once its port goes', () =>
    Effect.scoped(
      Effect.gen(function* () {
        // The client closes: it says so, and the server stops listening and ends.
        const first = new MessageChannel()
        yield* Effect.addFinalizer(() => Effect.sync(() => first.port1.close()))
        const server = watched(emitterPort(first.port1, (data) => data))
        const serving = yield* serve(server.port)
        const clientScope = yield* Scope.make()
        const echo = yield* client(emitterPort(first.port2, (data) => data)).pipe(Scope.provide(clientScope))
        assert.strictEqual(yield* echo.Echo({ text: 'hi' }), 'echo: hi')
        yield* Scope.close(clientScope, Exit.void)
        yield* Fiber.await(serving)
        assert.deepStrictEqual(server.seen, { listening: 0, watchingClose: 0 })

        // The other end goes without a word, as a window does when it reloads.
        const second = new MessageChannel()
        const gone = watched(emitterPort(second.port1, (data) => data))
        const abandoned = yield* serve(gone.port)
        assert.isTrue(yield* settled(() => gone.seen.listening === 1))
        second.port2.close()
        yield* Fiber.await(abandoned)
        assert.deepStrictEqual(gone.seen, { listening: 0, watchingClose: 0 })
      }),
    ),
  )
})
