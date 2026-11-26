import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { setPriority, tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'

import { Clock, Deferred, Duration, Effect, type Scope } from 'effect'

import { AgentStartFailed } from './errors'
import { platformTrees, type ProcessTrees, type StopReport, stopTree } from './processTrees'
import type { LaunchSpec } from './registry'
import { cleanUp } from './removal'

export { platformTrees, type ProcessTrees, type StopReport } from './processTrees'

/*
 * An agent process Althar owns (docs/architecture/02). Stopping it reaches
 * every process it started (processTrees.ts): on Unix its process group, even
 * after the agent itself has exited; on Windows the Job Object its keeper
 * holds it in. Stopping is staged: TERM to the group where the platform can ask,
 * a grace period, then KILL, and anything still alive after that is reported.
 * No console window opens for it or anything it starts on Windows. It is
 * never found by name or by a pid that may have been reused; the handle is the
 * only way in.
 */

/**
 * The environment variables a child inherits from Althar (docs/architecture
 * 07: an allowlist, never the whole environment). Provider API keys are not on
 * it: one could decide which account pays, over the plan the sign-in check
 * reported. Code-host sign-ins and the SSH agent are inherited (ADR-097), as
 * are ANTHROPIC_BASE_URL and OPENAI_BASE_URL, which point agents at a local
 * replay server (ADEMark) when set.
 * Althar's own secrets and provider API keys are still excluded.
 */
const INHERITED =
  /^(ALTHAR_WORKER|PATH|HOME|USER|LOGNAME|SHELL|TMPDIR|TMP|TEMP|LANG|LANGUAGE|TERM|TZ|COLORTERM|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE|SSL_CERT_DIR|LC_[A-Z_]+|XDG_[A-Z_]+|(HTTPS?|NO|ALL)_PROXY|(https?|no|all)_proxy|GH_(TOKEN|ENTERPRISE_TOKEN|CONFIG_DIR|HOST)|GITHUB_(TOKEN|ENTERPRISE_TOKEN)|GLAB_(TOKEN|CONFIG_DIR)|GITLAB_(TOKEN|ACCESS_TOKEN|HOST)|(ANTHROPIC|OPENAI)_BASE_URL|SSH_AUTH_SOCK|SSH_AGENT_PID|SSH_ASKPASS|GIT_(SSH|SSH_COMMAND|ASKPASS|CONFIG_GLOBAL|CONFIG_SYSTEM|CONFIG_NOSYSTEM))$/

export const childEnvironment = (
  spec: LaunchSpec,
  parent: NodeJS.ProcessEnv = process.env,
  underElectron = process.versions.electron !== undefined,
): Record<string, string> => {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(parent)) {
    if (value !== undefined && (INHERITED.test(key) || spec.inheritEnv?.includes(key) === true)) env[key] = value
  }
  return { ...env, ...asNode(spec, underElectron), ...spec.env }
}

/**
 * The Node the bundled adapters run on (ADR-033). The packaged app ships a
 * Node of its own and names it in ALTHAR_NODE, since Althar's binary doesn't
 * run as Node there (its `runAsNode` fuse is off). Without one, in dev and
 * the tests, it is the binary this runs on: Electron's, run as Node (`asNode`),
 * or the tests' own Node.
 */
export const adapterNode = (env: Readonly<Record<string, string | undefined>> = process.env): string =>
  env.ALTHAR_NODE !== undefined && env.ALTHAR_NODE !== '' ? env.ALTHAR_NODE : process.execPath

/**
 * Under Electron, `node` is Electron's own binary, which runs as plain Node only when told to: in dev, where
 * the `runAsNode` fuse is on. The packaged app's adapters run on the Node it ships, and need nothing.
 */
export const asNode = (spec: LaunchSpec, underElectron = process.versions.electron !== undefined): Record<string, string> =>
  underElectron && spec.command === process.execPath ? { ELECTRON_RUN_AS_NODE: '1' } : {}

/** A digest of the environment a child started with, for the process record: which variables, and their values. */
export const environmentDigest = (env: Readonly<Record<string, string>>): string =>
  createHash('sha256')
    .update(JSON.stringify(Object.entries(env).toSorted(([a], [b]) => (a < b ? -1 : 1))))
    .digest('hex')

export interface ProcessExit {
  readonly code: number | null
  readonly signal: string | null
}

/** One chunk of the raw protocol, numbered in the order it crossed, in either direction. */
export interface CapturedFrame {
  readonly sequence: number
  readonly direction: 'to_agent' | 'from_agent'
  readonly bytes: Uint8Array
}

export interface OwnedProcess {
  readonly pid: number
  /** The OS's record of when the process started, to tell it from a later process given the same pid. */
  readonly osStartedAt?: string
  readonly environmentDigest: string
  readonly stdin: WritableStream<Uint8Array>
  readonly stdout: ReadableStream<Uint8Array>
  /** Completes when the process itself has exited. */
  readonly exited: Deferred.Deferred<ProcessExit>
  /** Completes when the scope has stopped the process group. */
  readonly stopped: Deferred.Deferred<StopReport>
  /** The last few kilobytes the process wrote to stderr, for diagnostics. */
  readonly stderrTail: () => string
  /** Its temporary folder, where its launch asked for one of its own (`privateTemp`). */
  readonly temp?: string
}

/** A temporary folder of a process's own, as its launch asks (`privateTemp`), and the variables that name it. */
export const privateTemp = (spec: LaunchSpec): { readonly folder: string; readonly env: Readonly<Record<string, string>> } | undefined => {
  if (spec.privateTemp !== true) return undefined
  const folder = mkdtempSync(join(tmpdir(), 'althar-agent-'))
  return { folder, env: { TMPDIR: folder, TEMP: folder, TMP: folder } }
}

/**
 * Removes a process's own temporary folder, once nothing of it runs. It never fails: where the folder is still held, as
 * Windows holds one a moment after the process has gone, it is logged and left, and what stopping the process found
 * still says so (`stopped`).
 */
export const removeTemp = (folder: string | undefined): Effect.Effect<void> =>
  folder === undefined ? Effect.void : cleanUp(folder, "a process's own temporary folder")

export interface SpawnOptions {
  readonly grace?: Duration.Input
  /** Called with every chunk of the raw protocol, for the raw capture of docs/architecture/07. */
  readonly capture?: (frame: CapturedFrame) => void
  /** Called with everything the process writes to stderr, as it comes and with its pid, for the app's log of agents. */
  readonly stderr?: (chunk: string, pid: number) => void
  /** How its tree is reached: the platform's, unless a test says otherwise. */
  readonly trees?: ProcessTrees
  /** On Unix, ties the process group to an OS pipe that closes if its launcher dies. */
  readonly stopWithOwner?: boolean
  /**
   * Agents' work, run in the background (`BACKGROUND`): below what the person waits on, so Althar's window, and every
   * other app, answers while agents build and test. What the process starts takes its priority from it.
   */
  readonly background?: boolean
  /** How a process's priority is set: the system's, unless a test says. */
  readonly prioritize?: (pid: number, priority: number) => void
}

/**
 * How agents' work runs (`SpawnOptions.background`): niceness 10 on macOS and Linux, Below normal on Windows, which is
 * what Node makes of 10 there. The scheduler gives the rest of the computer the cores first while it is busy, and
 * agents all of them while it isn't: a build on an idle computer takes as long as before.
 */
export const BACKGROUND = 10

/** Sets a process's priority, or leaves it as it is where the system won't, as inside a sandbox that forbids it. */
const setPriorityOf = (pid: number, priority: number) => {
  try {
    setPriority(pid, priority)
  } catch {
    // Left at the priority it started with: it runs as it always did.
  }
}

/** One scheduling identity for every command of a native session, isolated from earlier runtime instances. */
const resourceInstance = `${process.pid}-${randomUUID()}`
let anonymousWorker = 0
export const workerOwner = (env: Readonly<Record<string, string | undefined>>) =>
  createHash('sha256')
    .update(`${resourceInstance}:${env.ALTHAR_WORKER ?? env.ALTHAR_WORK ?? `anonymous-${++anonymousWorker}`}`)
    .digest('hex')
    .slice(0, 32)

const STDERR_KEPT = 8_192

// The watcher belongs to the run's group. Only it keeps the read end of fd 3, so closing the launcher's end
// stops the group even if the command's shell already exited. The command keeps its original PID and stdio.
const WATCH_OWNER = `
(
  IFS= read -r _ <&3
  kill -KILL "-$$"
) </dev/null >/dev/null 2>&1 &
exec "$@" 3<&-
`

/** When the OS says a process started, as ISO 8601, or undefined if it can't say. With the pid, it tells a process from a later one given the same pid. */
export const osStartTime = (pid: number, trees: ProcessTrees = platformTrees()): Effect.Effect<string | undefined> => trees.startedAt(pid)

const tapped = <T extends ReadableStream<Uint8Array> | WritableStream<Uint8Array>>(
  stream: T,
  direction: CapturedFrame['direction'],
  capture: ((frame: CapturedFrame) => void) | undefined,
  next: () => number,
): T => {
  if (capture === undefined) return stream
  const tap = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      capture({ sequence: next(), direction, bytes: chunk })
      controller.enqueue(chunk)
    },
  })
  if (stream instanceof ReadableStream) return stream.pipeThrough(tap) as T
  // A write that fails because the process has gone surfaces through the connection, not here.
  tap.readable.pipeTo(stream).catch(() => undefined)
  return tap.writable as T
}

/**
 * A tree that goes with its root (a Windows keeper's job) is gone once the
 * root has been reaped, and its pid is then free for the OS to give to
 * another process: looked up or killed by that pid, it would be that other
 * process, as a test runner's worker once was. Until Node has seen the root
 * exit it holds the root's handle, so the pid is still the root's; after, the
 * tree is not looked for or sent anything.
 */
const whileUnreaped = (trees: ProcessTrees, exited: Deferred.Deferred<ProcessExit>): ProcessTrees =>
  trees.outlivesRoot
    ? trees
    : {
        ...trees,
        alive: (pid) => Effect.suspend(() => (Deferred.isDoneUnsafe(exited) ? Effect.succeed(false) : trees.alive(pid))),
        signal: (pid, signal) => Effect.suspend(() => (Deferred.isDoneUnsafe(exited) ? Effect.void : trees.signal(pid, signal))),
      }

export const spawnOwned = (
  spec: LaunchSpec,
  cwd: string,
  options: SpawnOptions = {},
): Effect.Effect<OwnedProcess, AgentStartFailed, Scope.Scope> =>
  Effect.suspend(() => {
    let releaseScheduling: Effect.Effect<void> = Effect.void
    let closeOwnerPipe = () => {}
    let schedulingReleased = false
    return Effect.acquireRelease(
      Effect.gen(function* () {
        const trees = options.trees ?? platformTrees()
        const exited = yield* Deferred.make<ProcessExit>()
        const stopped = yield* Deferred.make<StopReport>()
        const temp = privateTemp(spec)
        const inherited = { ...childEnvironment(spec), ...temp?.env }
        // A command that lives out on the device (a Flatpak's host) is run there, with what this assembled; what it runs may inherit more of Althar's environment, as reaching the device needs.
        const launched = spec.onDevice === undefined ? spec : spec.onDevice({ cwd, env: inherited })
        const env = launched === spec ? inherited : childEnvironment(launched)
        const launch = yield* trees
          .launch(
            launched.command,
            launched.args,
            options.background === true ? { background: true, owner: workerOwner(env), cwd, path: env.PATH ?? '/usr/bin:/bin' } : {},
          )
          .pipe(
            Effect.mapError((reason) => new AgentStartFailed({ command: launched.command, reason })),
            Effect.tapError(() => removeTemp(temp?.folder)),
          )
        releaseScheduling = Effect.suspend(() => {
          if (schedulingReleased) return Effect.void
          schedulingReleased = true
          return launch.release ?? Effect.void
        })
        const watchOwner = options.stopWithOwner === true && launch.detached && process.platform !== 'win32'
        const child = yield* Effect.try({
          try: () =>
            spawn(
              watchOwner ? '/bin/sh' : launch.command,
              watchOwner ? ['-c', WATCH_OWNER, 'althar-run', launch.command, ...launch.args] : [...launch.args],
              {
                cwd,
                detached: launch.detached,
                windowsHide: true,
                // Joined as they are, the program's own path quoted, as Node's own `shell: true` runs cmd.exe.
                ...(launched.verbatim === true ? { windowsVerbatimArguments: true, argv0: `"${launch.command}"` } : {}),
                stdio: watchOwner ? ['pipe', 'pipe', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'],
                env,
              },
            ),
          catch: (cause) => new AgentStartFailed({ command: launched.command, reason: String(cause) }),
        }).pipe(Effect.tapError(() => Effect.andThen(releaseScheduling, removeTemp(temp?.folder))))
        const ownerPipe = child.stdio[3]
        ownerPipe?.on('error', () => {}) // The watcher can go before the launcher closes its end.
        closeOwnerPipe = () => void ownerPipe?.destroy()
        let stderr = ''
        child.stderr.on('data', (chunk: Buffer) => {
          const text = chunk.toString()
          stderr = (stderr + text).slice(-STDERR_KEPT)
          options.stderr?.(text, child.pid ?? 0)
        })
        // Taken hold of at once: a process that exits while its start is still being read would otherwise have what it
        // printed thrown away, as Node discards the output of a child that exited with no one reading it.
        let sequence = 0
        const next = () => ++sequence
        const stdin = tapped(Writable.toWeb(child.stdin), 'to_agent', options.capture, next)
        const stdout = tapped(Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>, 'from_agent', options.capture, next)
        child.once('exit', (code, signal) => Deferred.doneUnsafe(exited, Effect.succeed({ code, signal })))
        const pid = yield* Effect.callback<number, AgentStartFailed>((resume) => {
          child.once('spawn', () => resume(Effect.succeed(child.pid ?? 0)))
          child.once('error', (error) =>
            resume(
              Effect.andThen(
                removeTemp(temp?.folder),
                Effect.fail(new AgentStartFailed({ command: launched.command, reason: error.message })),
              ),
            ),
          )
        })
        return {
          pid,
          environmentDigest: environmentDigest(env),
          stdin,
          stdout,
          exited,
          stopped,
          stderrTail: () => stderr,
          ...(temp === undefined ? {} : { temp: temp.folder }),
        } satisfies OwnedProcess
      }).pipe(
        Effect.onError(() =>
          Effect.andThen(
            Effect.sync(() => closeOwnerPipe()),
            releaseScheduling,
          ),
        ),
      ),
      (owned) =>
        Effect.gen(function* () {
          const stop = yield* stopProcessGroup(
            owned.pid,
            options.grace ?? Duration.seconds(2),
            whileUnreaped(options.trees ?? platformTrees(), owned.exited),
          )
          // The report waits until the OS has reaped the agent itself, so its pid is free when the report says so.
          yield* Deferred.await(owned.exited).pipe(Effect.timeoutOption(Duration.seconds(2)))
          // A scheduling group can still contain a child that detached from the Unix process group.
          yield* releaseScheduling
          // Its own temporary folder goes once nothing of it is left to use it.
          if (!stop.survivors) yield* removeTemp(owned.temp)
          yield* Deferred.succeed(owned.stopped, stop)
        }).pipe(
          Effect.ensuring(
            Effect.andThen(
              Effect.sync(() => closeOwnerPipe()),
              releaseScheduling,
            ),
          ),
          Effect.provideService(Clock.Clock, Clock.Clock.defaultValue()),
        ),
    ).pipe(
      Effect.flatMap((owned) =>
        Effect.gen(function* () {
          // The scope already owns the group. A failed lookup or interruption here cannot lose it.
          if (options.background === true) (options.prioritize ?? setPriorityOf)(owned.pid, BACKGROUND)
          const osStartedAt = yield* osStartTime(owned.pid, options.trees)
          return osStartedAt === undefined ? owned : { ...owned, osStartedAt }
        }),
      ),
    )
  })

/**
 * Stops a process tree Althar owns (processTrees.ts): TERM where the platform
 * can ask, a grace period, then KILL, and says whether anything outlived it.
 * A tree that has already gone is left alone. The runtime also uses it for a
 * tree an earlier launch left behind, once it has checked the tree is the one
 * it recorded.
 */
export const stopProcessGroup = (pid: number, grace: Duration.Input, trees: ProcessTrees = platformTrees()): Effect.Effect<StopReport> =>
  stopTree(trees, pid, grace)
