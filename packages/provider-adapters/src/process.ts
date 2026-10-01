import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { Readable, Writable } from 'node:stream'

import { Deferred, Duration, Effect, type Scope } from 'effect'

import { AgentStartFailed } from './errors'
import type { LaunchSpec } from './registry'

/*
 * An agent process Charrette owns (docs/architecture/02). It runs in its own
 * process group, so stopping it reaches every process it started, even after
 * the agent itself has exited. Stopping is staged: TERM to the group, a grace
 * period, then KILL, and anything still alive after that is reported. It is
 * never found by name or by a pid that may have been reused; the handle is the
 * only way in.
 */

/**
 * The environment variables a child inherits from Charrette (docs/architecture
 * 07: an allowlist, never the whole environment). Provider API keys are not on
 * it: one could decide which account pays, over the plan the sign-in check
 * reported. An agent that needs one gets it through its launch spec. Nor is
 * the person's SSH agent: Charrette pushes for agents, so their shells get
 * none of the person's ways into a code host (ADR-011).
 */
const INHERITED =
  /^(PATH|HOME|USER|LOGNAME|SHELL|TMPDIR|TMP|TEMP|LANG|LANGUAGE|TERM|TZ|COLORTERM|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE|SSL_CERT_DIR|LC_[A-Z_]+|XDG_[A-Z_]+|(HTTPS?|NO|ALL)_PROXY|(https?|no|all)_proxy)$/

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

/** Under Electron, `node` is Electron's own binary, which runs as plain Node only when told to. */
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

/** How stopping went: the last signal sent to the group, and whether anything outlived it. */
export interface StopReport {
  readonly signal: 'none' | 'SIGTERM' | 'SIGKILL'
  readonly survivors: boolean
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
}

export interface SpawnOptions {
  readonly grace?: Duration.Input
  /** Called with every chunk of the raw protocol, for the raw capture of docs/architecture/07. */
  readonly capture?: (frame: CapturedFrame) => void
}

const STDERR_KEPT = 8_192

const groupAlive = (pid: number) => {
  try {
    process.kill(-pid, 0)
    return true
  } catch {
    return false
  }
}

/** Signals the whole process group; a group that is already gone is fine. */
const signalGroup = (pid: number, signal: NodeJS.Signals) => {
  try {
    process.kill(-pid, signal)
  } catch {
    // The group has already exited.
  }
}

/** Waits for the group to empty, up to a limit. */
const groupGone = (pid: number, limit: Duration.Input) =>
  Effect.gen(function* () {
    const until = Date.now() + Duration.toMillis(Duration.fromInputUnsafe(limit))
    while (groupAlive(pid) && Date.now() < until) yield* Effect.sleep('25 millis')
    return !groupAlive(pid)
  })

/** When the OS says a process started, as ISO 8601, or undefined if it can't say. With the pid, it tells a process from a later one given the same pid. */
export const osStartTime = (pid: number): Effect.Effect<string | undefined> =>
  Effect.callback<string | undefined>((resume) => {
    execFile(
      'ps',
      ['-o', 'lstart=', '-p', String(pid)],
      { timeout: 2_000, env: { LC_ALL: 'C', PATH: process.env.PATH ?? '' } },
      (error, stdout) => {
        const started = error === null ? new Date(stdout.trim()) : undefined
        resume(Effect.succeed(started !== undefined && !Number.isNaN(started.getTime()) ? started.toISOString() : undefined))
      },
    )
  })

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

export const spawnOwned = (
  spec: LaunchSpec,
  cwd: string,
  options: SpawnOptions = {},
): Effect.Effect<OwnedProcess, AgentStartFailed, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.gen(function* () {
      const exited = yield* Deferred.make<ProcessExit>()
      const stopped = yield* Deferred.make<StopReport>()
      const env = childEnvironment(spec)
      const child = yield* Effect.try({
        try: () => spawn(spec.command, [...spec.args], { cwd, detached: true, stdio: ['pipe', 'pipe', 'pipe'], env }),
        catch: (cause) => new AgentStartFailed({ command: spec.command, reason: String(cause) }),
      })
      let stderr = ''
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-STDERR_KEPT)
      })
      child.once('exit', (code, signal) => Deferred.doneUnsafe(exited, Effect.succeed({ code, signal })))
      const pid = yield* Effect.callback<number, AgentStartFailed>((resume) => {
        child.once('spawn', () => resume(Effect.succeed(child.pid ?? 0)))
        child.once('error', (error) => resume(Effect.fail(new AgentStartFailed({ command: spec.command, reason: error.message }))))
      })
      const osStartedAt = yield* osStartTime(pid)
      let sequence = 0
      const next = () => ++sequence
      return {
        pid,
        ...(osStartedAt === undefined ? {} : { osStartedAt }),
        environmentDigest: environmentDigest(env),
        stdin: tapped(Writable.toWeb(child.stdin), 'to_agent', options.capture, next),
        stdout: tapped(Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>, 'from_agent', options.capture, next),
        exited,
        stopped,
        stderrTail: () => stderr,
      } satisfies OwnedProcess
    }),
    (owned) =>
      Effect.gen(function* () {
        const stop = yield* stopProcessGroup(owned.pid, options.grace ?? Duration.seconds(2))
        // The report waits until the OS has reaped the agent itself, so its pid is free when the report says so.
        yield* Deferred.await(owned.exited).pipe(Effect.timeoutOption(Duration.seconds(2)))
        yield* Deferred.succeed(owned.stopped, stop)
      }),
  )

/**
 * Stops a process group Charrette owns: TERM, a grace period, then KILL, and
 * says whether anything outlived it. A group that has already gone is left
 * alone. The runtime also uses it for a group an earlier launch left behind,
 * once it has checked the group's leader is the process it recorded.
 */
export const stopProcessGroup = (pid: number, grace: Duration.Input): Effect.Effect<StopReport> =>
  Effect.gen(function* () {
    if (!groupAlive(pid)) return { signal: 'none', survivors: false }
    signalGroup(pid, 'SIGTERM')
    if (yield* groupGone(pid, grace)) return { signal: 'SIGTERM', survivors: false }
    signalGroup(pid, 'SIGKILL')
    return { signal: 'SIGKILL', survivors: !(yield* groupGone(pid, Duration.seconds(2))) }
  })
