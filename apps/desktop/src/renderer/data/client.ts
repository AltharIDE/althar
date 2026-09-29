import {
  Api,
  ApiError,
  clientProtocol,
  type DomMessagePort,
  domPort,
  type ProjectSummary,
  type Status,
  type TaskSummary,
  type ThreadSnapshot,
  type WatchEvent,
} from '@charrette/contracts'
import { Cause, Effect, Exit, Fiber, Layer, Scope, Stream } from 'effect'
import { RpcClient } from 'effect/rpc'

/*
 * The data layer (ADR-010): the only code that talks to the runtime. It is
 * Effect inside; what it hands the view models is plain promises and a
 * subscription, so they stay ordinary React hooks.
 */

export interface Client {
  readonly status: () => Promise<Status>
  readonly listProjects: () => Promise<ReadonlyArray<ProjectSummary>>
  readonly openProject: (path: string) => Promise<ProjectSummary>
  readonly listTasks: (projectId: string) => Promise<ReadonlyArray<TaskSummary>>
  readonly createTask: (input: {
    readonly projectId: string
    readonly title: string
    readonly description?: string
  }) => Promise<TaskSummary>
  readonly getThread: (threadId: string) => Promise<ThreadSnapshot>
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
  /** Calls `listener` with each change until the returned function is called. */
  readonly watch: (listener: (event: WatchEvent) => void) => () => void
  readonly close: () => Promise<void>
}

/** What went wrong with a call, in words a view can show. */
export const messageOf = (error: unknown): string => {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return String(error)
}

/** Runs a call and settles its promise with the call's own failure, not Effect's wrapper around it. */
const settle = <A>(effect: Effect.Effect<A, unknown>): Promise<A> =>
  Effect.runPromiseExit(effect).then((exit) => {
    if (Exit.isSuccess(exit)) return exit.value
    throw Cause.squash(exit.cause)
  })

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
    status: () => settle(api.Status()),
    listProjects: () => settle(api.ListProjects()),
    openProject: (path) => settle(api.OpenProject({ path })),
    listTasks: (projectId) => settle(api.ListTasks({ projectId })),
    createTask: (input) => settle(api.CreateTask(input)),
    getThread: (threadId) => settle(api.GetThread({ threadId })),
    startSession: (input) => settle(api.StartSession(input)),
    switchAgent: (input) => settle(api.SwitchAgent(input)),
    setModel: (input) => settle(api.SetModel(input)),
    interrupt: (threadId) => settle(api.Interrupt({ threadId })),
    stopSession: (threadId) => settle(api.StopSession({ threadId })),
    send: (input) => settle(api.Send(input)),
    answer: (input) => settle(api.Answer(input)),
    watch: (listener) => {
      const fiber = Effect.runFork(Stream.runForEach(api.Watch(), (event) => Effect.sync(() => listener(event))))
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
