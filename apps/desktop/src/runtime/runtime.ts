import { mkdirSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'

import { emitterPort } from '@charrette/contracts'
import { connection, Folders, services } from '@charrette/runtime'
import { Cause, Context, Effect, Exit, Fiber, Layer, Queue } from 'effect'

/*
 * The runtime, in Electron's utility process (ADR-003). It opens the profile,
 * reconciles what an earlier launch left, and serves the API to each window
 * over the port the main process hands it. Asked to shut down, it stops
 * every session, records it, and exits.
 */

type Port = Parameters<typeof emitterPort>[0]
interface ParentMessage {
  readonly data: unknown
  readonly ports: ReadonlyArray<Port>
}

const parent = (
  process as unknown as {
    parentPort: { on(event: 'message', listener: (message: ParentMessage) => void): void; postMessage(message: unknown): void }
  }
).parentPort

/** The main process says where the profile and worktrees are; without them there is nothing to open. */
const required = (name: string) => {
  const value = process.env[name]
  if (value === undefined || value === '') throw new Error(`The runtime needs ${name}`)
  return value
}

const profile = required('CHARRETTE_PROFILE')
mkdirSync(profile, { recursive: true })

const options = {
  database: join(profile, 'charrette.sqlite'),
  worktreeRoot: required('CHARRETTE_WORKTREES'),
  appVersion: process.env.CHARRETTE_APP_VERSION ?? '0.0.0',
  deviceName: hostname(),
}

/* Ports and folders that arrive before the runtime is ready wait here. */
const early: Array<Port> = []
let accept = (port: Port) => void early.push(port)
let isReady: (context: Context.Context<Folders>) => void = () => {}
const ready = new Promise<Context.Context<Folders>>((resolve) => {
  isReady = resolve
})

const program = Effect.gen(function* () {
  // The end-to-end tests drive the app against a scripted agent. Packaged builds leave this out.
  const fake =
    __CHARRETTE_TEST_HOOKS__ && process.env.CHARRETTE_FAKE_AGENTS === '1'
      ? (yield* Effect.promise(() => import('./fakeAgents'))).fakeAgents
      : undefined
  const context = yield* Layer.build(services(fake === undefined ? options : { ...options, agents: fake }))
  isReady(context)
  const ports = yield* Queue.unbounded<Port>()
  accept = (port) => void Queue.offerUnsafe(ports, port)
  for (const port of early.splice(0)) accept(port)
  for (;;) {
    const port = yield* Queue.take(ports)
    // Each window's connection lives until its port closes, as when it reloads.
    yield* Effect.forkScoped(Layer.launch(connection(emitterPort(port))).pipe(Effect.provideContext(context)))
  }
})

const fiber = Effect.runFork(Effect.scoped(program))

fiber.addObserver((exit) => {
  if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)) {
    process.stderr.write(`${Cause.pretty(exit.cause)}\n`)
    process.exit(1)
  }
  process.exit(0)
})

/** A folder the person chose, from the main process: its grant goes back, for the window to open it by. */
const allowFolder = (requestId: string, path: string) =>
  void ready.then((context) =>
    Effect.runPromise(Context.get(context, Folders).allow(path)).then((grant) =>
      parent.postMessage({ type: 'folder-allowed', requestId, grant }),
    ),
  )

parent.on('message', (message) => {
  const data = message.data as { readonly type?: string; readonly requestId?: string; readonly path?: string } | null
  const port = message.ports[0]
  if (data?.type === 'connect' && port !== undefined) accept(port)
  if (data?.type === 'allow-folder' && data.requestId !== undefined && data.path !== undefined) allowFolder(data.requestId, data.path)
  // Interrupting the program closes its scope: every session is stopped and recorded first.
  if (data?.type === 'shutdown') Effect.runFork(Fiber.interrupt(fiber))
})
