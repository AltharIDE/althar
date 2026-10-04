import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'

import { emitterPort } from '@charrette/contracts'
import { connection, Folders, Nudges, Secrets, SecretsUnavailable, services } from '@charrette/runtime'
import { Cause, Context, Duration, Effect, Exit, Fiber, Layer, Queue, Stream } from 'effect'
import { openInTerminal } from './terminal'

/*
 * The runtime, in Electron's utility process (ADR-003). It opens the profile,
 * reconciles what an earlier launch left, and serves the API to each window
 * over the port the main process hands it. What comes to need the person, it
 * tells the main process, which notifies them. Asked to shut down, it stops
 * every session, records it, and exits. Its secrets are kept sealed in the
 * profile; the main process seals and opens them.
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

/**
 * The public ids of Charrette's own apps registered with code hosts and
 * trackers, for their browser sign-in, as the build or the environment gives
 * them. A service without one takes a pasted token.
 */
const clientIds = Object.fromEntries(
  (
    [
      ['github', process.env.CHARRETTE_GITHUB_CLIENT_ID],
      ['gitlab', process.env.CHARRETTE_GITLAB_CLIENT_ID],
      ['linear', process.env.CHARRETTE_LINEAR_CLIENT_ID],
    ] as const
  ).flatMap(([product, id]) => (id === undefined || id === '' ? [] : [[product, id]])),
)

/* Secrets the main process is sealing or opening, by request. */
const sealing = new Map<string, (answer: { readonly value?: string; readonly error?: string }) => void>()

/** Asks the main process to seal a secret, or open one; it alone holds the key. */
const askMain = (type: 'seal' | 'open', value: string) =>
  Effect.callback<string, SecretsUnavailable>((resume) => {
    const requestId = randomUUID()
    sealing.set(requestId, (answer) =>
      resume(
        answer.value === undefined
          ? Effect.fail(new SecretsUnavailable({ reason: answer.error ?? 'Charrette couldn’t open its keychain.' }))
          : Effect.succeed(answer.value),
      ),
    )
    parent.postMessage({ type, requestId, value })
    return Effect.sync(() => void sealing.delete(requestId))
  }).pipe(
    Effect.timeoutOrElse({
      duration: Duration.seconds(15),
      orElse: () => Effect.fail(new SecretsUnavailable({ reason: 'Charrette’s keychain didn’t answer.' })),
    }),
  )

const secrets = Secrets.sealed(join(profile, 'secrets'), {
  seal: (value) => askMain('seal', value),
  open: (sealed) => askMain('open', sealed),
})

const options = {
  database: join(profile, 'charrette.sqlite'),
  worktreeRoot: required('CHARRETTE_WORKTREES'),
  accountsRoot: join(profile, 'accounts'),
  openTerminal: openInTerminal,
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
  // The end-to-end tests drive the app against a scripted agent and a fake code host, keeping tokens in memory. Packaged builds leave this out.
  const fake =
    __CHARRETTE_TEST_HOOKS__ && process.env.CHARRETTE_FAKE_AGENTS === '1'
      ? {
          agents: (yield* Effect.promise(() => import('./fakeAgents'))).fakeAgents,
          connectors: (yield* Effect.promise(() => import('./fakeConnectors'))).fakeConnectors,
          secrets: Secrets.memory(),
          // Nothing opens in Terminal while the tests drive the app.
          openTerminal: () => Effect.succeed(false),
        }
      : undefined
  const context = yield* Layer.build(services(fake === undefined ? { ...options, clientIds, secrets } : { ...options, ...fake }))
  isReady(context)
  // What needs the person goes to the main process, which notifies them and keeps the Dock's count.
  yield* Effect.forkScoped(
    Stream.runForEach(Context.get(context, Nudges).events, (event) => Effect.sync(() => parent.postMessage({ type: 'nudge', event }))),
  )
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
  const data = message.data as {
    readonly type?: string
    readonly requestId?: string
    readonly path?: string
    readonly value?: string
    readonly error?: string
  } | null
  const port = message.ports[0]
  if (data?.type === 'sealed' && data.requestId !== undefined) {
    sealing.get(data.requestId)?.({
      ...(data.value === undefined ? {} : { value: data.value }),
      ...(data.error === undefined ? {} : { error: data.error }),
    })
    sealing.delete(data.requestId)
  }
  if (data?.type === 'connect' && port !== undefined) accept(port)
  if (data?.type === 'allow-folder' && data.requestId !== undefined && data.path !== undefined) allowFolder(data.requestId, data.path)
  // Interrupting the program closes its scope: every session is stopped and recorded first.
  if (data?.type === 'shutdown') Effect.runFork(Fiber.interrupt(fiber))
})
