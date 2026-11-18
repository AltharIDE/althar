import { spawn } from 'node:child_process'
import { mkdtemp, readFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { cleanUp } from '@althar/provider-adapters'
import { Effect } from 'effect'

import { startApart } from './spawner'

/*
 * How Devices.ts reaches this computer's simulators and emulators: the
 * commands it runs, the one it leaves running (the Android emulator) and the
 * pictures it reads back. The desktop app gives the runtime `simulatorsHere()`;
 * a test gives a fake that answers as `simctl` and `adb` would.
 */

export interface DeviceCommand {
  readonly command: string
  readonly args: ReadonlyArray<string>
  /** What it prints is a picture, given back as base64. */
  readonly base64?: boolean
}

export interface DeviceRan {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
  /** The command isn't on this computer: Xcode or the Android SDK isn't installed. */
  readonly missing: boolean
}

export interface DeviceHost {
  readonly platform: NodeJS.Platform
  readonly env: Readonly<Record<string, string | undefined>>
  readonly home: string
  /** Runs a short command to its end, off the runtime's thread. */
  readonly run: (command: DeviceCommand) => Effect.Effect<DeviceRan>
  /** Starts a command that keeps running, the emulator, in a group of its own; `stop` ends it with its group. */
  readonly start: (command: DeviceCommand) => Effect.Effect<{ readonly stop: Effect.Effect<void> }, string>
  /** Runs a command that writes a picture to the path it is given, and gives the picture back as base64. */
  readonly picture: (command: (path: string) => DeviceCommand) => Effect.Effect<string, string>
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** A screen as a PNG is at most a few megabytes; past 32 the command is stopped. */
const MOST = 32 * 1024 * 1024

const ran = (command: DeviceCommand) =>
  Effect.promise(async (): Promise<DeviceRan> => {
    const ended = await startApart({
      command: command.command,
      args: command.args,
      env: process.env,
      detached: false,
      max: MOST,
      ...(command.base64 === true ? { base64: true } : {}),
    }).result
    return {
      code: ended.code,
      stdout: ended.stdout,
      stderr: ended.error?.message ?? ended.stderr,
      missing: ended.error?.code === 'ENOENT',
    }
  })

/** This computer's, as the desktop app runs it. */
export const simulatorsHere = (): DeviceHost => ({
  platform: process.platform,
  env: process.env,
  home: homedir(),
  run: ran,
  start: (command) =>
    Effect.try({
      try: () => {
        const child = spawn(command.command, [...command.args], {
          detached: process.platform !== 'win32',
          stdio: 'ignore',
          windowsHide: true,
        })
        child.on('error', () => undefined)
        child.unref()
        return {
          stop: Effect.sync(() => {
            if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return
            try {
              if (process.platform === 'win32') child.kill()
              else process.kill(-child.pid, 'SIGTERM')
            } catch {
              // It ended on its own meanwhile.
            }
          }),
        }
      },
      catch: (error) => messageOf(error),
    }),
  picture: (command) =>
    Effect.acquireUseRelease(
      Effect.tryPromise({ try: () => mkdtemp(join(tmpdir(), 'althar-device-')), catch: (error) => messageOf(error) }),
      (folder) =>
        Effect.gen(function* () {
          const path = join(folder, 'screen.png')
          const done = yield* ran(command(path))
          if (done.code !== 0) return yield* Effect.fail(done.stderr.trim() || `it exited ${String(done.code)}`)
          return yield* Effect.tryPromise({ try: () => readFile(path), catch: (error) => messageOf(error) })
        }).pipe(Effect.map((bytes) => bytes.toString('base64'))),
      (folder) => cleanUp(folder, 'where a device’s screenshot was written'),
    ),
})
