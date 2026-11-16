import { type MessagePort, parentPort, workerData } from 'node:worker_threads'

import { Api, clientProtocol, emitterPort } from '@althar/contracts'
import { Effect, Layer } from 'effect'
import { RpcClient } from 'effect/rpc'

import { type Asked, runWindow, type WindowSetup } from './window'

/*
 * A window's thread (windows.ts starts one for each): the window's own client
 * of the runtime's API over the port it was given, as the app's window has
 * over its MessagePort, and what the run asks of it over the worker's own.
 * Bundled as it starts, so it runs without the test's module runner.
 */

const { port, setup } = workerData as { readonly port: MessagePort; readonly setup: WindowSetup }

Effect.runFork(
  Effect.scoped(
    Effect.gen(function* () {
      const protocol = yield* Layer.build(clientProtocol(emitterPort(port, (data) => data)))
      const client = yield* RpcClient.make(Api).pipe(Effect.provideContext(protocol))
      const ask = runWindow(client as never, setup, (answer) => parentPort?.postMessage(answer))
      parentPort?.on('message', (asked: Asked) => {
        void ask(asked)
        if (asked.op === 'stop') setTimeout(() => process.exit(0), 10)
      })
      parentPort?.postMessage({ id: 0, ok: true })
      yield* Effect.never
    }),
  ),
)
