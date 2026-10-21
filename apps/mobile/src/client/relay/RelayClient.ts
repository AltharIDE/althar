import { Api, ApiError, clientProtocol, type PortLike, type WatchEvent } from '@althar/contracts'
import { Cause, Duration, Effect, Exit, Fiber, Layer, Option, Scope, Stream } from 'effect'
import { RpcClient } from 'effect/rpc'

import type { AltharClient, Connection, PairedMac, Unsubscribe } from '../AltharClient'

/*
 * The client the phone uses once the relay exists: the runtime's own RPC
 * (packages/contracts), over a port the relay's channel carries. It runs as
 * the desktop's data layer does (apps/desktop/src/renderer/data/client.ts):
 * every command gets an id, and is tried once more under the same id when
 * the runtime didn't answer, never when it said no; the watch picks up from
 * the last change it heard when its stream breaks.
 *
 * How the phone stands with the Mac is the relay's to say, so it's handed
 * in: `link` reports it, and pairs and unpairs.
 */

export interface RelayLink {
  connection(): Connection
  onConnection(listener: (connection: Connection) => void): Unsubscribe
  pair(code: string): Promise<PairedMac>
  unpair(): Promise<void>
}

/** A new command id, as the contract has them: `cmd_` and 32 hex digits. */
export const newCommandId = (
  random: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer> = (bytes) => globalThis.crypto.getRandomValues(bytes),
): string => `cmd_${Array.from(random(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('')}`

/** What went wrong with a call, in words the phone can show. */
export const messageOf = (error: unknown): string =>
  error instanceof ApiError ? error.message : 'Althar on your Mac didn’t answer. Check that it’s awake, then try again.'

const RETRY_AFTER = Duration.millis(400)
const REWATCH_AFTER = Duration.seconds(1)

/** Runs a call, settling with the call's own failure, in words. */
const settle = <A>(effect: Effect.Effect<A, unknown>): Promise<A> =>
  Effect.runPromiseExit(effect).then((exit) => {
    if (Exit.isSuccess(exit)) return exit.value
    const error = Cause.squash(exit.cause)
    throw error instanceof ApiError ? error : new Error(messageOf(error))
  })

/** A command, under one id however often it is tried. */
const command = <A>(run: (commandId: string) => Effect.Effect<A, unknown>): Promise<A> => {
  const commandId = newCommandId()
  return settle(
    Effect.catchCause(run(commandId), (cause) => {
      const refused = Option.exists(Cause.findErrorOption(cause), (error) => error instanceof ApiError)
      return refused || Cause.hasInterruptsOnly(cause) ? Effect.failCause(cause) : Effect.andThen(Effect.sleep(RETRY_AFTER), run(commandId))
    }),
  )
}

/** Connects over a port, and keeps the connection until `close`. */
export const connectRelay = async (port: PortLike, link: RelayLink): Promise<AltharClient & { readonly close: () => Promise<void> }> => {
  const scope = await Effect.runPromise(Scope.make())
  const api = await Effect.runPromise(
    Effect.gen(function* () {
      const protocol = yield* Layer.build(clientProtocol(port))
      return yield* RpcClient.make(Api).pipe(Effect.provideContext(protocol))
    }).pipe(Scope.provide(scope)),
  )
  return {
    connection: () => link.connection(),
    onConnection: (listener) => link.onConnection(listener),
    pair: (code) => link.pair(code),
    unpair: () => link.unpair(),
    home: () => settle(api.GetHome({})),
    board: (projectId) => settle(api.GetBoard({ projectId })),
    thread: (threadId) => settle(api.GetThread({ threadId, limit: 100 })),
    fileDiff: (taskId, path) => settle(api.GetFileDiff({ taskId, path })),
    watch: (listener: (event: WatchEvent) => void) => {
      let cursor: number | undefined
      const heard = Effect.suspend(() =>
        Stream.runForEach(api.Watch(cursor === undefined ? {} : { since: cursor }), (event) =>
          Effect.sync(() => {
            if (event._tag === 'Changed') cursor = event.cursor
            listener(event)
          }),
        ),
      )
      const fiber = Effect.runFork(Effect.forever(Effect.andThen(Effect.ignore(heard), Effect.sleep(REWATCH_AFTER))))
      return () => void Effect.runFork(Fiber.interrupt(fiber))
    },
    answer: (input) => command((commandId) => api.Answer({ commandId, ...input })),
    answerQuestion: (input) => command((commandId) => api.AnswerQuestion({ commandId, ...input })),
    answerStuck: (input) => command((commandId) => api.AnswerStuck({ commandId, ...input })),
    send: (input) => command((commandId) => api.Send({ commandId, ...input })),
    createTask: (input) => command((commandId) => api.CreateTask({ commandId, ...input })),
    stopTask: (taskId) => command((commandId) => api.StopTask({ commandId, taskId })),
    markTaskDone: (taskId) => command((commandId) => api.MarkTaskDone({ commandId, taskId })),
    keepTaskForLater: (taskId) => command((commandId) => api.KeepTaskForLater({ commandId, taskId })),
    merge: (input) => command((commandId) => api.Merge({ commandId, ...input })),
    close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
  }
}
