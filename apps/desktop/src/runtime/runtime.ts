import { existsSync, mkdirSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { join } from 'node:path'

import type { Fetch } from '@althar/connectors'
import { emitterPort } from '@althar/contracts'
import type { EndpointRead } from '@althar/provider-adapters'
import { backupsIn, connection, Connectivity, databaseIn, Failures, Folders, Nudges, Secrets, services, UsageData } from '@althar/runtime'
import { Cause, Context, Effect, Exit, Fiber, Layer, Logger, Queue, Stream } from 'effect'
import { net } from 'electron'
import { appFetchOf } from './appFetch'
import { handledOf, watchCrashes } from './crashes'
import { editorsHere, openInEditor } from './editors'
import { runtimeFacts, runtimeNames } from './facts'
import { agentsLog, stdoutLogger } from './logging'
import { type Device, deviceHere } from './onDevice'
import { profileInUse } from './profileInUse'
import { screenshotsWith, type Taken } from './screenshots'
import { sealingWith } from './sealing'
import { openInBrowser, openInTerminal } from './terminal'

/*
 * The runtime, in Electron's utility process (ADR-003). It opens the profile,
 * reconciles what an earlier launch left, and serves the API to each window
 * over the port the main process hands it. What comes to need the person, it
 * tells the main process, which notifies them. Asked to shut down, it stops
 * every session, records it, and exits. Its secrets are kept sealed in the
 * profile; the main process seals and opens them. If an update couldn't move
 * the store (it couldn't be copied first, or a migration didn't finish), it
 * tells the main process what stopped it and where the copy is, serves
 * nothing, and waits to be shut down: a restart would only stop the same way.
 * What usage data says happened goes to the main process too, which sends it
 * only while the person allows it, and so does what it couldn't handle, for
 * a crash report (crashes.ts).
 */

type Port = Parameters<typeof emitterPort>[0]
interface ParentMessage {
  readonly data: unknown
  readonly ports: ReadonlyArray<Port>
}

/** What a fake usage endpoint answers: nothing, or one five-hour window at the share used a test names. */
const fakePlan = (used: string | undefined): EndpointRead => {
  const usedPercent = Number(used)
  if (used === undefined || used === '' || !Number.isFinite(usedPercent)) return { kind: 'none' }
  const now = Date.now()
  return {
    kind: 'usage',
    stale: false,
    usage: {
      source: 'endpoint',
      observedAt: new Date(now).toISOString(),
      windows: [{ kind: 'five_hour', minutes: 300, usedPercent, resetsAt: new Date(now + 2 * 3_600_000).toISOString() }],
    },
  }
}

const parent = (
  process as unknown as {
    parentPort: { on(event: 'message', listener: (message: ParentMessage) => void): void; postMessage(message: unknown): void }
  }
).parentPort

/* What the runtime couldn't handle goes to the main process, from the start, for a crash report (crashes.ts). */
const crashes = watchCrashes((message) => parent.postMessage(message))

/** The main process says where the profile and worktrees are; without them there is nothing to open. */
const required = (name: string) => {
  const value = process.env[name]
  if (value === undefined || value === '') throw new Error(`The runtime needs ${name}`)
  return value
}

const profile = required('ALTHAR_PROFILE')
mkdirSync(profile, { recursive: true })

/* What agents' processes write to stderr, in agents.log, where the main process keeps the app's logs (DEV-61). */
const agents = agentsLog(process.env.ALTHAR_LOGS)

/**
 * The public ids of Althar's own apps registered with code hosts and
 * trackers, for their browser sign-in, as the build or the environment gives
 * them. A service without one takes a pasted token.
 */
const clientIds = Object.fromEntries(
  (
    [
      ['github', process.env.ALTHAR_GITHUB_CLIENT_ID],
      ['gitlab', process.env.ALTHAR_GITLAB_CLIENT_ID],
      ['linear', process.env.ALTHAR_LINEAR_CLIENT_ID],
    ] as const
  ).flatMap(([product, id]) => (id === undefined || id === '' ? [] : [[product, id]])),
)

/** Althar's GitHub App, by its slug, for where it is installed on an owner; with its id, GitHub's browser sign-in asks to be let in. */
const githubApp =
  process.env.ALTHAR_GITHUB_APP === undefined || process.env.ALTHAR_GITHUB_APP === '' ? undefined : process.env.ALTHAR_GITHUB_APP

/* Secrets the main process is sealing or opening (sealing.ts). */
const { ask: askMain, answer: answerSealed } = sealingWith((message) => parent.postMessage(message))

const secrets = Secrets.sealed(join(profile, 'secrets'), {
  seal: (value) => askMain('seal', value),
  open: (sealed) => askMain('open', sealed),
})

/* Screenshots agents ask for, which the main process draws, with Chromium (screenshots.ts). */
const screenshots = screenshotsWith((message) => parent.postMessage(message))

/** Code hosts and trackers are called over the app's own network, Chromium's (appFetch.ts). */
const appFetch: Fetch = appFetchOf(net)

/** OpenRouter's public list of models, with each one's scores and prices (ADR-015). */
const MODEL_LIST = 'https://openrouter.ai/api/v1/models'

/* The device outside a Flatpak, once its reach is measured at startup; everything is local until then, and anywhere but a Flatpak (onDevice.ts). */
let device: Device | undefined
/*
 * The end-to-end tests' update that can't move the store: a migration after
 * every real one that always fails, so it is never recorded. Packaged builds
 * leave this out.
 */
const failingUpdate =
  __ALTHAR_TEST_HOOKS__ && process.env.ALTHAR_FAIL_MIGRATION === '1'
    ? { extraMigrations: [{ key: '9999_fails_on_purpose', statements: ['INSERT INTO no_such_table VALUES (1)'] }] }
    : {}

const options = {
  database: databaseIn(profile),
  // A copy of the store before an update migrates it, the newest three.
  backups: backupsIn(profile),
  ...failingUpdate,
  worktreeRoot: required('ALTHAR_WORKTREES'),
  accountsRoot: join(profile, 'accounts'),
  // Pictures agents hand back and what commands print, by digest; the main process serves the pictures from here.
  artifactsRoot: join(profile, 'artifacts'),
  // Agents the person asked Althar to download, kept in the profile, never on their PATH.
  agentsRoot: join(profile, 'agents'),
  openTerminal: openInTerminal,
  openUrl: openInBrowser,
  screenshot: screenshots.ask,
  editors: {
    list: () =>
      device === undefined
        ? editorsHere()
        : editorsHere(homedir(), existsSync, process.platform, (known) =>
            known.cli === undefined ? null : (device?.onDevice.where(known.cli.name) ?? null),
          ),
    open: (editor: string, folder: string, file: string | null, line: number | null) =>
      device === undefined
        ? openInEditor(editor, folder, file, line)
        : openInEditor(editor, folder, file, line, process.platform, {
            find: (name) => device?.onDevice.where(name) ?? null,
            start: device.start,
            path: device.path,
          }),
  },
  appVersion: process.env.ALTHAR_APP_VERSION ?? '0.0.0',
  deviceName: hostname(),
  ...(agents === null ? {} : { agentStderr: agents.stderr }),
  // Althar itself, on the load meter, is the app's main process and what it started: its windows, its GPU and this runtime.
  load: { app: process.ppid },
}

/** The machine the end-to-end tests name in `ALTHAR_MACHINE`, as `cores,GB`; without one, a large one: 64 cores and 256 GB. */
const machineIn = (named: string | undefined) => {
  const [cores, memory] = (named ?? '').split(',').map(Number)
  return cores !== undefined && memory !== undefined && cores > 0 && memory > 0
    ? { cores, memory: memory * 1024 ** 3 }
    : { cores: 64, memory: 256 * 1024 ** 3 }
}

/* Ports and folders that arrive before the runtime is ready wait here. */
const early: Array<Port> = []
let accept = (port: Port) => void early.push(port)
/* Everything the runtime's services provide, for the main process's requests to reach. */
type Ready = Context.Context<Layer.Success<ReturnType<typeof services>>>
let isReady: (context: Ready) => void = () => {}
let readyNow = false
const ready = new Promise<Ready>((resolve) => {
  isReady = (context) => {
    readyNow = true
    resolve(context)
  }
})

/** The store an update couldn't move: what stopped, the copy from before (if one was made), and what was said. */
const storeStopped = (stopped: 'moving' | 'copying', backup: string | null, reason: string) =>
  Effect.andThen(
    Effect.sync(() => parent.postMessage({ type: 'store-failed', stopped, backup, reason })),
    Effect.never,
  )

const program = Effect.gen(function* () {
  // In a Flatpak, the person's own agents and editors live outside the sandbox: where they are, and how to run them there.
  device = yield* deviceHere()
  // The Codex its adapter drives, out on the device, where Codex's own sandbox works (flatpak/codex-host.sh says why, and what to do without one).
  if (process.env.FLATPAK_ID !== undefined) process.env.CODEX_PATH = '/app/bin/althar-host-codex'
  // The end-to-end tests drive the app against a scripted agent and a fake code host, keeping tokens in memory. Packaged builds leave this out.
  // A real agent against the fake GitHub, for a test of what a real lead does on a pull request (e2e/real-tools.spec.ts).
  const fakeHost =
    __ALTHAR_TEST_HOOKS__ && process.env.ALTHAR_FAKE_AGENTS !== '1' && process.env.ALTHAR_FAKE_CONNECTORS === 'github'
      ? {
          connectors: (yield* Effect.promise(() => import('./fakeConnectors'))).fakeConnectors,
          secrets: Secrets.memory(),
        }
      : undefined
  const fake =
    __ALTHAR_TEST_HOOKS__ && process.env.ALTHAR_FAKE_AGENTS === '1'
      ? {
          agents: (yield* Effect.promise(() => import('./fakeAgents'))).fakeAgents,
          // Every service, on a demo profile; else the end-to-end tests' GitHub.
          connectors: yield* Effect.promise(() =>
            import('./fakeConnectors').then((loaded) =>
              process.env.ALTHAR_FAKE_CONNECTORS === 'demo' ? loaded.demoConnectors : loaded.fakeConnectors,
            ),
          ),
          secrets: Secrets.memory(),
          // Nothing opens in Terminal while the tests drive the app.
          openTerminal: () => Effect.succeed(false),
          openUrl: () => Effect.succeed(false),
          // How many agents work at once comes from the machine a test names (`cores,GB`), else a large one, never the one running them.
          busy: { machine: machineIn(process.env.ALTHAR_MACHINE) },
          // No sign-in of the person's is read for its usage: every provider's endpoint answers that there is none,
          // or, where a test names a share used (`ALTHAR_FAKE_PLAN`), each plan's five hours at that, resetting in two hours.
          usage: { readEndpoint: () => Promise.resolve(fakePlan(process.env.ALTHAR_FAKE_PLAN)) },
          // The person's own agents are looked for on the PATH the test gives alone (e2e/support.ts): not in the usual places
          // outside it, such as Homebrew's, which are this computer's.
          agentSearch: { env: process.env, dirs: [] },
        }
      : undefined
  const context = yield* Layer.build(
    services(
      fake === undefined
        ? {
            ...(device === undefined ? options : { ...options, onDevice: device.onDevice, probeRoot: join(profile, 'probe') }),
            clientIds,
            ...(githubApp === undefined ? {} : { githubApp }),
            secrets,
            fetch: appFetch,
            // What is known of models, for the coordinator to weigh (ADR-015): fetched as the runtime starts, kept in the profile.
            modelFacts: { url: MODEL_LIST, cache: join(profile, 'model-facts.json'), fetch: appFetch },
            ...fakeHost,
          }
        : { ...options, ...fake },
    ),
  ).pipe(
    Effect.catchTags({
      MigrationFailed: (failure) => storeStopped('moving', failure.backup, failure.reason),
      ForeignKeyViolations: (failure) =>
        storeStopped('moving', failure.backup, `Rows in ${failure.tables.join(', ')} point at rows that aren’t there.`),
      BackupFailed: (failure) => storeStopped('copying', null, failure.reason),
      DatabaseInUse: () => profileInUse((message) => parent.postMessage(message)),
    }),
  )
  isReady(context)
  yield* Effect.logInfo('Runtime ready').pipe(Effect.annotateLogs({ version: options.appVersion, pid: process.pid }))
  // What needs the person goes to the main process, which notifies them and keeps the Dock's count.
  yield* Effect.forkScoped(
    Stream.runForEach(Context.get(context, Nudges).events, (event) => Effect.sync(() => parent.postMessage({ type: 'nudge', event }))),
  )
  yield* Effect.forkScoped(
    Stream.runForEach(Context.get(context, UsageData).events, (usage) => Effect.sync(() => parent.postMessage({ type: 'usage', usage }))),
  )
  // What the runtime kept to what it belonged to and carried on past goes too, as a handled crash report (crashes.ts, ADR-047).
  yield* Effect.forkScoped(
    Stream.runForEach(Context.get(context, Failures).events, (failure) =>
      Effect.sync(() => parent.postMessage({ type: 'crash', crash: handledOf(failure) })),
    ),
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

// The runtime's own lines go to stdout, for the main process to keep in runtime.log.
const fiber = Effect.runFork(Effect.scoped(program).pipe(Effect.provide(Logger.layer([stdoutLogger]))))

fiber.addObserver((exit) => {
  if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)) {
    // What it stopped on is a defect of the runtime's: the main process hears of it before it exits.
    crashes.defect(Cause.squash(exit.cause))
    process.stderr.write(`${Cause.pretty(exit.cause)}\n`)
    process.exit(1)
  }
  process.exit(0)
})

/**
 * What a report needs from the runtime (facts.ts), for the main process:
 * whatever goes wrong reading it, an answer goes back, and at once while the
 * store isn't open, so main says what it can itself.
 */
const tellFacts = (requestId: string, threadId: string | null) => {
  if (!readyNow) return parent.postMessage({ type: 'facts', requestId, error: 'The store isn’t open.' })
  void ready
    .then((context) => Effect.runPromise(runtimeFacts(threadId).pipe(Effect.provideContext(context))))
    .then(
      (value) => parent.postMessage({ type: 'facts', requestId, value }),
      (error: unknown) => parent.postMessage({ type: 'facts', requestId, error: error instanceof Error ? error.message : String(error) }),
    )
}

/** The projects' and repositories' names, for the main process to hide in a crash report; at once, with none, while the store isn't open. */
const tellNames = (requestId: string) => {
  if (!readyNow) return parent.postMessage({ type: 'names', requestId, error: 'The store isn’t open.' })
  void ready
    .then((context) => Effect.runPromise(runtimeNames.pipe(Effect.provideContext(context))))
    .then(
      (value) => parent.postMessage({ type: 'names', requestId, value }),
      (error: unknown) => parent.postMessage({ type: 'names', requestId, error: error instanceof Error ? error.message : String(error) }),
    )
}

/** A folder the person chose, from the main process: its grant goes back, for the window to open it by. */
const allowFolder = (requestId: string, path: string) =>
  void ready.then((context) =>
    Effect.runPromise(Context.get(context, Folders).allow(path)).then((grant) =>
      parent.postMessage({ type: 'folder-allowed', requestId, grant }),
    ),
  )

/** Whether the computer is online, as the main process reads it (ADR-060): the last said, once the store is open. */
const tellOnline = (online: boolean) => void ready.then((context) => Effect.runPromise(Context.get(context, Connectivity).set(online)))

parent.on('message', (message) => {
  const data = message.data as {
    readonly type?: string
    readonly requestId?: string
    readonly path?: string
    readonly value?: string
    readonly error?: string
    readonly keyring?: boolean
    readonly unreadable?: boolean
    readonly threadId?: string
    readonly shot?: unknown
    readonly online?: boolean
  } | null
  const port = message.ports[0]
  if (data?.type === 'sealed' && data.requestId !== undefined) {
    answerSealed(data.requestId, data)
  }
  if (data?.type === 'screenshot-taken' && data.requestId !== undefined) screenshots.answer(data.requestId, data as Taken)
  if (data?.type === 'connect' && port !== undefined) accept(port)
  if (data?.type === 'allow-folder' && data.requestId !== undefined && data.path !== undefined) allowFolder(data.requestId, data.path)
  if (data?.type === 'facts' && data.requestId !== undefined) tellFacts(data.requestId, data.threadId ?? null)
  if (data?.type === 'names' && data.requestId !== undefined) tellNames(data.requestId)
  if (data?.type === 'online' && typeof data.online === 'boolean') tellOnline(data.online)
  // Interrupting the program closes its scope: every session is stopped and recorded first.
  if (data?.type === 'shutdown') {
    Effect.runFork(Effect.logInfo('Runtime stopping').pipe(Effect.provide(Logger.layer([stdoutLogger]))))
    Effect.runFork(Fiber.interrupt(fiber))
  }
})
