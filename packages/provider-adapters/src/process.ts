import { spawn } from 'node:child_process'
import { Readable, Writable } from 'node:stream'

import { Deferred, Duration, Effect, type Scope } from 'effect'

import { AgentStartFailed } from './errors'
import type { LaunchSpec } from './registry'

/*
 * An agent process Charrette owns (docs/architecture/02). It runs in its own
 * process group, so stopping it reaches every process it started. Stopping is
 * staged: TERM to the group, a grace period, then KILL. It is never found by
 * name or by a pid that may have been reused; the handle is the only way in.
 */

export interface ProcessExit {
  readonly code: number | null
  readonly signal: string | null
}

export interface OwnedProcess {
  readonly pid: number
  readonly stdin: WritableStream<Uint8Array>
  readonly stdout: ReadableStream<Uint8Array>
  /** Completes when the process has exited. */
  readonly exited: Deferred.Deferred<ProcessExit>
  /** The last few kilobytes the process wrote to stderr, for diagnostics. */
  readonly stderrTail: () => string
}

const STDERR_KEPT = 8_192

export const spawnOwned = (
  spec: LaunchSpec,
  cwd: string,
  options: { readonly grace?: Duration.Input } = {},
): Effect.Effect<OwnedProcess, AgentStartFailed, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.gen(function* () {
      const exited = yield* Deferred.make<ProcessExit>()
      const child = yield* Effect.try({
        try: () =>
          spawn(spec.command, [...spec.args], {
            cwd,
            detached: true,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, ...spec.env },
          }),
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
      return {
        pid,
        stdin: Writable.toWeb(child.stdin),
        stdout: Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
        exited,
        stderrTail: () => stderr,
      } satisfies OwnedProcess
    }),
    (owned) =>
      Effect.gen(function* () {
        if (yield* Deferred.isDone(owned.exited)) return
        signalGroup(owned.pid, 'SIGTERM')
        const stopped = yield* Deferred.await(owned.exited).pipe(Effect.timeoutOption(options.grace ?? Duration.seconds(2)))
        if (stopped._tag === 'None') {
          signalGroup(owned.pid, 'SIGKILL')
          yield* Deferred.await(owned.exited).pipe(Effect.timeoutOption(Duration.seconds(2)))
        }
      }),
  )

/** Signals the whole process group; a group that is already gone is fine. */
const signalGroup = (pid: number, signal: NodeJS.Signals) => {
  try {
    process.kill(-pid, signal)
  } catch {
    // The group has already exited.
  }
}
