import { Effect, Layer, Scope } from 'effect'
import { RpcClient, RpcServer } from 'effect/rpc'
import { Worker, WorkerRunner } from 'effect/workers'

/*
 * The API runs over a message port (docs/architecture/02): Electron's main
 * process makes a channel and hands one end to the runtime's utility process
 * and the other to the window. Both ends speak Effect's RPC worker protocol,
 * which needs only posting and receiving structured-clone messages:
 *
 * - the client sends `[0, request]`, or `[1]` to close;
 * - the server answers `[0]` once it is listening, then `[1, response]`.
 *
 * `PortLike` is the one thing each end supplies, since the ports differ: a DOM
 * `MessagePort` in the window, Electron's `MessagePortMain` in the runtime,
 * and `worker_threads` ports in tests.
 */

export interface PortLike {
  post(message: unknown): void
  /** Calls `handler` with each message's data, until the returned function is called. */
  listen(handler: (data: unknown) => void): () => void
  /** Calls `handler` once the other end has gone, where the port can tell, as when a window reloads. */
  closed?(handler: () => void): () => void
}

/** What the window's DOM `MessagePort` offers; described here so the runtime needn't know the DOM. */
export interface DomMessagePort {
  postMessage(message: unknown): void
  addEventListener(type: 'message', listener: (event: { readonly data: unknown }) => void): void
  removeEventListener(type: 'message', listener: (event: { readonly data: unknown }) => void): void
  start(): void
}

/** A DOM `MessagePort`, as the window has it. */
export const domPort = (port: DomMessagePort): PortLike => ({
  post: (message) => port.postMessage(message),
  listen: (handler) => {
    const onMessage = (event: { readonly data: unknown }) => handler(event.data)
    port.addEventListener('message', onMessage)
    port.start()
    return () => port.removeEventListener('message', onMessage)
  },
})

/** An Electron `MessagePortMain` or a Node `EventEmitter` port: `on('message', …)`, with the data in `.data` or given as is. */
export const emitterPort = (
  port: {
    postMessage(message: unknown): void
    on(event: 'message' | 'close', listener: (event: unknown) => void): unknown
    off(event: 'message' | 'close', listener: (event: unknown) => void): unknown
    start?(): void
  },
  unwrap: (event: unknown) => unknown = (event) => (typeof event === 'object' && event !== null && 'data' in event ? event.data : event),
): PortLike => ({
  post: (message) => port.postMessage(message),
  listen: (handler) => {
    const onMessage = (event: unknown) => handler(unwrap(event))
    port.on('message', onMessage)
    port.start?.()
    return () => port.off('message', onMessage)
  },
  closed: (handler) => {
    const onClose = () => handler()
    port.on('close', onClose)
    return () => port.off('close', onClose)
  },
})

/** The runtime's end: the RPC server's protocol, over a port. */
export const serverProtocol = (port: PortLike): Layer.Layer<RpcServer.Protocol> =>
  RpcServer.layerProtocolWorkerRunner.pipe(
    Layer.provide(
      Layer.succeed(
        WorkerRunner.WorkerRunnerPlatform,
        WorkerRunner.WorkerRunnerPlatform.of({
          start: <O, I>() =>
            Effect.sync((): WorkerRunner.WorkerRunner<O, I> => {
              const sendUnsafe = (_portId: number, message: O) => port.post([1, message])
              return {
                run: <A, E, R>(handler: (portId: number, message: I) => Effect.Effect<A, E, R> | void) =>
                  Effect.flatMap(Effect.context<R>(), (context) =>
                    Effect.callback<void>((resume) => {
                      const stop = port.listen((data) => {
                        const message = data as WorkerRunner.PlatformMessage<I>
                        if (message[0] === 1) return resume(Effect.void)
                        const handled = handler(0, message[1])
                        if (Effect.isEffect(handled)) Effect.runForkWith(context)(handled)
                      })
                      // The other end gone ends the server for it.
                      const unclose = port.closed?.(() => resume(Effect.void))
                      port.post([0])
                      return Effect.sync(() => {
                        stop()
                        unclose?.()
                      })
                    }),
                  ),
                send: (portId, message) => Effect.sync(() => sendUnsafe(portId, message)),
                sendUnsafe,
              }
            }),
        }),
      ),
    ),
    Layer.orDie,
  )

/** The window's end: the RPC client's protocol, over a port. */
export const clientProtocol = (port: PortLike): Layer.Layer<RpcClient.Protocol> =>
  // One port, carrying every call at once: a long-running stream such as `Watch` mustn't hold up the rest.
  RpcClient.layerProtocolWorker({ size: 1, concurrency: Number.MAX_SAFE_INTEGER }).pipe(
    Layer.provide(
      Layer.merge(
        Layer.succeed(
          Worker.WorkerPlatform,
          Worker.makePlatform<PortLike>()({
            setup: ({ worker }) => Effect.succeed({ postMessage: (message: unknown) => worker.post(message), worker }),
            listen: ({ port: wrapped, emit, scope }) =>
              Effect.flatMap(
                Effect.sync(() => wrapped.worker.listen(emit)),
                (stop) => Scope.addFinalizer(scope, Effect.sync(stop)),
              ),
          }),
        ),
        Worker.layerSpawner(() => port),
      ),
    ),
    Layer.orDie,
  )
