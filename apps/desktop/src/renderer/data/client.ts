import {
  Api,
  ApiError,
  clientProtocol,
  type DomMessagePort,
  domPort,
  type ProjectList,
  type ProjectSummary,
  type Status,
  type TaskList,
  type TaskSummary,
  type ThreadItem,
  type ThreadSnapshot,
  type WatchEvent,
} from '@charrette/contracts'
import { Cause, Duration, Effect, Exit, Fiber, Layer, Option, Scope, Stream } from 'effect'
import { RpcClient } from 'effect/rpc'

/*
 * The data layer (ADR-010): the only code that talks to the runtime. It is
 * Effect inside; what it hands the view models is plain promises and a
 * subscription, so they stay ordinary React hooks.
 *
 * Every command gets an id here. When a command's answer doesn't come back
 * (the runtime didn't answer, rather than said no), it is tried once more
 * with the same id, and the runtime answers the retry from the first one's
 * receipt instead of doing it twice. `watch` picks up from the last change it
 * heard when its stream breaks.
 */

export interface Client {
  /** The runtime's version and the agents on this Mac; `recheck` asks each agent again rather than trust the last minute's answer. */
  readonly status: (options?: { readonly recheck?: boolean }) => Promise<Status>
  readonly listProjects: () => Promise<ProjectList>
  /** Opens the folder a grant names: one the person chose in the picker or dropped on the window. */
  readonly openProject: (grant: string) => Promise<ProjectSummary>
  readonly listTasks: (projectId: string) => Promise<TaskList>
  readonly createTask: (input: {
    readonly projectId: string
    readonly title: string
    readonly description?: string
  }) => Promise<TaskSummary>
  /** The thread, with the newest `limit` items before `before`. */
  readonly getThread: (threadId: string, page?: { readonly before?: number; readonly limit?: number }) => Promise<ThreadSnapshot>
  readonly getThreadItem: (threadId: string, itemId: string) => Promise<ThreadItem>
  readonly startSession: (input: { readonly threadId: string; readonly agentId: string; readonly model?: string }) => Promise<string>
  readonly switchAgent: (input: { readonly threadId: string; readonly agentId: string; readonly model?: string }) => Promise<string>
  readonly setModel: (input: { readonly threadId: string; readonly model: string }) => Promise<void>
  readonly interrupt: (threadId: string) => Promise<void>
  readonly stopSession: (threadId: string) => Promise<void>
  readonly send: (input: {
    readonly threadId: string
    readonly body: string
    readonly disposition: 'after_current' | 'interrupt_and_continue'
  }) => Promise<void>
  readonly answer: (input: {
    readonly attentionId: string
    readonly decision: 'allow' | 'reject'
    readonly reason?: string
  }) => Promise<void>
  /** Calls `listener` with each change after `since` (or from now) until the returned function is called. */
  readonly watch: (listener: (event: WatchEvent) => void, since?: number) => () => void
  readonly close: () => Promise<void>
}

/** What went wrong with a call, in words a view can show. */
export const messageOf = (error: unknown): string =>
  error instanceof ApiError ? error.message : "Charrette's runtime didn't answer. If it keeps happening, restart Charrette."

/** A new command id, as the contract has them. */
export const newCommandId = (): string => `cmd_${globalThis.crypto.randomUUID().replaceAll('-', '')}`

/** Runs a call and settles its promise with the call's own failure, not Effect's wrapper around it. */
const settle = <A>(effect: Effect.Effect<A, unknown>): Promise<A> =>
  Effect.runPromiseExit(effect).then((exit) => {
    if (Exit.isSuccess(exit)) return exit.value
    throw Cause.squash(exit.cause)
  })

/** How long before a command with no answer is tried again, once. */
const RETRY_AFTER = Duration.millis(300)

/** How long before a broken watch picks up again. */
const REWATCH_AFTER = Duration.seconds(1)

/** A command, under one id however often it is tried: once more when the runtime didn't answer, never when it said no. */
const command = <A>(run: (commandId: string) => Effect.Effect<A, unknown>): Promise<A> => {
  const commandId = newCommandId()
  return settle(
    Effect.catchCause(run(commandId), (cause) => {
      const refused = Option.exists(Cause.findErrorOption(cause), (error) => error instanceof ApiError)
      return refused || Cause.hasInterruptsOnly(cause) ? Effect.failCause(cause) : Effect.andThen(Effect.sleep(RETRY_AFTER), run(commandId))
    }),
  )
}

/** Connects to the runtime over a port, and keeps the connection until `close`. */
export const connect = async (port: DomMessagePort): Promise<Client> => {
  const scope = await Effect.runPromise(Scope.make())
  const api = await Effect.runPromise(
    Effect.gen(function* () {
      const protocol = yield* Layer.build(clientProtocol(domPort(port)))
      return yield* RpcClient.make(Api).pipe(Effect.provideContext(protocol))
    }).pipe(Scope.provide(scope)),
  )
  return {
    status: (options = {}) => settle(api.Status(options.recheck === undefined ? {} : { recheck: options.recheck })),
    listProjects: () => settle(api.ListProjects()),
    openProject: (grant) => command((commandId) => api.OpenProject({ commandId, grant })),
    listTasks: (projectId) => settle(api.ListTasks({ projectId })),
    createTask: (input) => command((commandId) => api.CreateTask({ commandId, ...input })),
    getThread: (threadId, page = {}) => settle(api.GetThread({ threadId, ...page })),
    getThreadItem: (threadId, itemId) => settle(api.GetThreadItem({ threadId, itemId })),
    startSession: (input) => command((commandId) => api.StartSession({ commandId, ...input })),
    switchAgent: (input) => command((commandId) => api.SwitchAgent({ commandId, ...input })),
    setModel: (input) => command((commandId) => api.SetModel({ commandId, ...input })),
    interrupt: (threadId) => command((commandId) => api.Interrupt({ commandId, threadId })),
    stopSession: (threadId) => command((commandId) => api.StopSession({ commandId, threadId })),
    send: (input) => command((commandId) => api.Send({ commandId, ...input })),
    answer: (input) => command((commandId) => api.Answer({ commandId, ...input })),
    watch: (listener, since) => {
      let cursor = since
      // A stream that ends or breaks starts again from the last change heard, so nothing in between is missed.
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
    close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
  }
}

/** The port the preload hands the page, once the main process has made it. */
export const receivePort = (target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window): Promise<DomMessagePort> =>
  new Promise((resolve) => {
    const onMessage = (event: MessageEvent) => {
      const port = event.ports[0]
      if (event.data !== 'charrette:port' || port === undefined) return
      target.removeEventListener('message', onMessage)
      resolve(port)
    }
    target.addEventListener('message', onMessage)
  })
