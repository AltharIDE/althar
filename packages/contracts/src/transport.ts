import { Deferred, Effect, Layer, Scope } from 'effect'
import { RpcClient, RpcServer } from 'effect/rpc'
import { Worker, WorkerRunner } from 'effect/workers'
import { WorkerError, WorkerReceiveError } from 'effect/workers/WorkerError'

import { API_VERSION, API_VERSION_HEADER } from './Api'

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
  /** Closes an owned transport. A host may use this to revoke a live connection. */
  close?(): void
  post(message: unknown): void
  /** Calls `handler` with each message's data, until the returned function is called. */
  listen(handler: (data: unknown) => void): () => void
  /** Calls `handler` once the other end has gone, where the port can tell, as when a window reloads. */
  closed?(handler: () => void): () => void
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const requestId = (value: unknown) =>
  (typeof value === 'string' && value.length > 0 && value.length <= 128) ||
  (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
/** The worker adapter does not decode envelope metadata. Payload and result schemas remain RPC's responsibility. */
const clientMessage = (value: unknown): boolean => {
  if (!record(value)) return false
  switch (value._tag) {
    case 'Request':
      return (
        requestId(value.id) &&
        typeof value.tag === 'string' &&
        value.tag.length > 0 &&
        value.tag.length <= 128 &&
        Array.isArray(value.headers) &&
        value.headers.length <= 128 &&
        value.headers.every(
          (header: unknown) =>
            Array.isArray(header) &&
            header.length === 2 &&
            header.every((part: unknown) => typeof part === 'string' && part.length <= 8192),
        ) &&
        (value.traceId === undefined || (typeof value.traceId === 'string' && value.traceId.length <= 128)) &&
        (value.spanId === undefined || (typeof value.spanId === 'string' && value.spanId.length <= 128)) &&
        (value.sampled === undefined || typeof value.sampled === 'boolean')
      )
    case 'Ack':
    case 'Interrupt':
      return requestId(value.requestId)
    case 'Ping':
    case 'Eof':
      return true
    default:
      return false
  }
}
const serverMessage = (value: unknown): boolean => {
  if (!record(value)) return false
  switch (value._tag) {
    case 'Chunk':
      return requestId(value.requestId) && Array.isArray(value.values) && value.values.length > 0
    case 'Exit':
      return (
        requestId(value.requestId) &&
        record(value.exit) &&
        (value.exit._tag === 'Success' || (value.exit._tag === 'Failure' && Array.isArray(value.exit.cause)))
      )
    case 'Defect':
    case 'Pong':
    case 'ClientProtocolError':
      return true
    case 'Request':
      return clientMessage(value)
    default:
      return false
  }
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
    close?(): void
  },
  unwrap: (event: unknown) => unknown = (event) => (typeof event === 'object' && event !== null && 'data' in event ? event.data : event),
): PortLike => ({
  ...(port.close === undefined ? {} : { close: () => port.close?.() }),
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
                      let stop = () => {}
                      let unclose: (() => void) | undefined
                      let ended = false
                      const release = () => {
                        stop()
                        unclose?.()
                      }
                      // The client closing, or the other end going, ends the server for it.
                      const end = () => {
                        if (ended) return
                        ended = true
                        release()
                        resume(Effect.void)
                      }
                      stop = port.listen((data) => {
                        if (
                          !Array.isArray(data) ||
                          (data[0] !== 0 && data[0] !== 1) ||
                          (data[0] === 0 && (data.length !== 2 || !clientMessage(data[1]))) ||
                          (data[0] === 1 && data.length !== 1)
                        ) {
                          port.close?.()
                          return end()
                        }
                        // The outer tuple is checked above; I is decoded by the RPC protocol and its payload schemas.
                        const message = data as unknown as WorkerRunner.PlatformMessage<I>
                        if (message[0] === 1) return end()
                        const handled = handler(0, message[1])
                        if (Effect.isEffect(handled)) Effect.runForkWith(context)(handled)
                      })
                      unclose = port.closed?.(end)
                      if (ended) release()
                      else port.post([0])
                      return Effect.sync(release)
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

/** The window's end: the RPC client's protocol, over a port. Every request says which API version the client speaks. */
export const clientProtocol = (port: PortLike, apiVersion: number = API_VERSION): Layer.Layer<RpcClient.Protocol> => {
  // One port, carrying every call at once: a long-running stream such as `Watch` mustn't hold up the rest.
  const over = RpcClient.layerProtocolWorker({ size: 1, concurrency: Number.MAX_SAFE_INTEGER }).pipe(
    Layer.provide(
      Layer.merge(
        Layer.succeed(
          Worker.WorkerPlatform,
          Worker.makePlatform<PortLike>()({
            // Closing the client says so, and the server stops serving it.
            setup: ({ worker, scope }) =>
              Effect.as(
                Scope.addFinalizer(
                  scope,
                  Effect.sync(() => worker.post([1])),
                ),
                { postMessage: (message: unknown) => worker.post(message), worker },
              ),
            listen: ({ port: wrapped, emit, scope, deferred }) =>
              Effect.gen(function* () {
                const fail = () =>
                  Deferred.doneUnsafe(
                    deferred,
                    Effect.fail(
                      new WorkerError({
                        reason: new WorkerReceiveError({ message: 'The Althar connection closed or sent an invalid message.' }),
                      }),
                    ),
                  )
                const stop = wrapped.worker.listen((data) => {
                  if (
                    !Array.isArray(data) ||
                    !((data.length === 1 && data[0] === 0) || (data.length === 2 && data[0] === 1 && serverMessage(data[1])))
                  ) {
                    wrapped.worker.close?.()
                    return void fail()
                  }
                  emit(data)
                })
                const unclose = wrapped.worker.closed?.(() => {
                  fail()
                })
                yield* Scope.addFinalizer(
                  scope,
                  Effect.sync(() => {
                    stop()
                    unclose?.()
                  }),
                )
              }),
          }),
        ),
        Worker.layerSpawner(() => port),
      ),
    ),
    Layer.orDie,
  )
  // The runtime refuses a client of a version it doesn't serve, so each request carries the one this client speaks.
  return Layer.effect(
    RpcClient.Protocol,
    Effect.gen(function* () {
      const protocol = yield* RpcClient.Protocol
      return RpcClient.Protocol.of({
        ...protocol,
        send: (clientId, request, transferables) =>
          protocol.send(
            clientId,
            request._tag === 'Request' ? { ...request, headers: [...request.headers, [API_VERSION_HEADER, String(apiVersion)]] } : request,
            transferables,
          ),
      })
    }),
  ).pipe(Layer.provide(over))
}
