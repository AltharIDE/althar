import { type MessagePort, parentPort, workerData } from 'node:worker_threads'

import * as Contracts from '@althar/contracts'
import { Effect, Layer } from 'effect'
import { RpcClient } from 'effect/rpc'

import { type Asked, runWindow, type WindowSetup } from './window'

/*
 * A window's thread (windows.ts starts one for each): the window's own client
 * of the runtime's API over the port it was given, made as client.ts makes
 * the app's, and what the run asks of it over the worker's own. Bundled as it
 * starts, so it runs without the test's module runner. What a commit's
 * contracts have only later (the lane a read nobody waits on goes in, a
 * client with no spans of its own) is read off them, so it runs on one from
 * before too.
 */

const { port, setup } = workerData as { readonly port: MessagePort; readonly setup: WindowSetup }
const has = Contracts as Partial<{
  readonly LANE_HEADER: string
  readonly BACKGROUND: string
  readonly THREAD_ITEMS_AT_ONCE: number
  readonly untraced: { readonly disableTracing: boolean }
}>
const lane = has.LANE_HEADER === undefined || has.BACKGROUND === undefined ? undefined : { [has.LANE_HEADER]: has.BACKGROUND }

Effect.runFork(
  Effect.scoped(
    Effect.gen(function* () {
      const protocol = yield* Layer.build(Contracts.clientProtocol(Contracts.emitterPort(port, (data) => data)))
      const client = yield* (has.untraced === undefined ? RpcClient.make(Contracts.Api) : RpcClient.make(Contracts.Api, has.untraced)).pipe(
        Effect.provideContext(protocol),
      )
      const calls = client as unknown as Readonly<Record<string, ((payload?: unknown) => unknown) | undefined>>
      const ask = runWindow(
        calls,
        setup,
        (answer) => parentPort?.postMessage(answer),
        lane === undefined ? undefined : (call) => RpcClient.withHeaders(call, lane),
        has.THREAD_ITEMS_AT_ONCE ?? 500,
      )
      parentPort?.on('message', (asked: Asked) => {
        void ask(asked)
        if (asked.op === 'stop') setTimeout(() => process.exit(0), 10)
      })
      parentPort?.postMessage({ id: 0, ok: true, features: { items: calls.GetThreadItems !== undefined, lane: lane !== undefined } })
      yield* Effect.never
    }),
  ),
)
