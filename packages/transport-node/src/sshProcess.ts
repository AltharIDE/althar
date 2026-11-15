import { execFile, spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from 'node:child_process'
import { isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'

import { Effect, Option } from 'effect'

import { TransportError, transportError } from './errors'
import { sshArguments, sshEnvironment, type SshTarget } from './sshArguments'

export type SshSpawn = (program: string, args: ReadonlyArray<string>, options: SpawnOptionsWithoutStdio) => ChildProcessWithoutNullStreams
export interface SshRuntime {
  readonly spawn?: SshSpawn
  readonly executable?: string
  readonly environment?: NodeJS.ProcessEnv
}
const nativeSpawn: SshSpawn = (program, args, options) => spawn(program, [...args], { ...options, stdio: 'pipe' })
const unavailable = () =>
  transportError(
    'SshUnavailable',
    'Althar could not run OpenSSH. Check that it is installed and the host can be reached with your SSH configuration.',
  )
export const sshFailure = (diagnostics: string) => {
  if (/HOST IDENTIFICATION HAS CHANGED|Host key verification failed|No .*host key is known/i.test(diagnostics))
    return transportError(
      'SshHostKeyRejected',
      'SSH refused this server’s host key. Verify it independently and update your known hosts before reconnecting.',
    )
  if (/Permission denied|Authentication failed|no supported authentication methods/i.test(diagnostics))
    return transportError(
      'SshAuthenticationFailed',
      'SSH could not authenticate. Check your configured key or agent in a terminal, then reconnect.',
    )
  return unavailable()
}

export interface SshProcess {
  readonly child: ChildProcessWithoutNullStreams
  readonly closed: Promise<void>
  readonly ended: () => boolean
  readonly failure: () => TransportError
}
export const stopSsh = (resource: SshProcess) =>
  Effect.gen(function* () {
    if (resource.ended() || resource.child.pid === undefined) return
    const pid = resource.child.pid
    if (process.platform === 'win32') {
      yield* Effect.tryPromise({
        try: async () => {
          await promisify(execFile)(
            join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/taskkill.exe'),
            ['/PID', String(pid), '/T', '/F'],
            { timeout: 5000, windowsHide: true },
          )
        },
        catch: unavailable,
      }).pipe(Effect.ignore)
      resource.child.kill()
    } else {
      yield* Effect.sync(() => {
        try {
          process.kill(-pid, 'SIGTERM')
        } catch {
          resource.child.kill()
        }
      })
    }
    const stopped = yield* Effect.promise(() => resource.closed).pipe(Effect.timeoutOption('5 seconds'))
    if (Option.isNone(stopped)) {
      yield* Effect.sync(() => {
        try {
          if (process.platform === 'win32') resource.child.kill('SIGKILL')
          else process.kill(-pid, 'SIGKILL')
        } catch {
          /* Already reaped. */
        }
      })
      yield* Effect.promise(() => resource.closed).pipe(Effect.timeoutOption('5 seconds'), Effect.asVoid)
    }
  })

/** Own the dedicated SSH child and bounded diagnostics; none of its output becomes an exception message. */
export const startSsh = (target: SshTarget, homeId: string | undefined, runtime: SshRuntime = {}) =>
  Effect.acquireRelease(
    Effect.try({
      try: () => {
        const args = sshArguments(target, homeId)
        const environment = sshEnvironment(runtime.environment ?? process.env)
        const program =
          runtime.executable ??
          (process.env.FLATPAK_ID !== undefined
            ? '/app/bin/althar-host-ssh'
            : process.platform === 'win32'
              ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/OpenSSH/ssh.exe')
              : '/usr/bin/ssh')
        if (!isAbsolute(program)) throw unavailable()
        const child = (runtime.spawn ?? nativeSpawn)(program, args, {
          env: environment,
          windowsHide: true,
          detached: process.platform !== 'win32',
        })
        let diagnostics = Buffer.alloc(0)
        let ended = false
        const closed = new Promise<void>((resolve) => {
          const end = () => {
            ended = true
            resolve()
          }
          child.once('error', end)
          child.once('close', end)
        })
        child.stderr.on('data', (data: Buffer) => {
          const joined = Buffer.concat([diagnostics, data.subarray(-65_536)])
          diagnostics = joined.length > 65_536 ? Buffer.from(joined.subarray(-65_536)) : joined
        })
        child.stdin.on('error', () => undefined)
        child.stdout.on('error', () => undefined)
        child.stderr.on('error', () => undefined)
        return { child, closed, ended: () => ended, failure: () => sshFailure(diagnostics.toString('utf8')) }
      },
      catch: (error) => (error instanceof TransportError ? error : unavailable()),
    }),
    stopSsh,
  )
