import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

import type { LaunchSpec } from '@althar/provider-adapters'
import { Effect } from 'effect'

import { git } from './git'

/*
 * A run's own process, as Althar starts it for the person (Launches.ts): the
 * shell line it runs, the environment it gets, how it ended in words, and the
 * packages of the copy of the default branch it runs in.
 */

/**
 * What a run gets of Althar's environment beyond what every child does
 * (provider-adapters' process.ts): what a desktop app it opens, such as an
 * Electron app, needs of the person's session on Linux, the display it opens
 * its window on, the X server's key and the session's bus. macOS and Windows
 * need nothing more: a window opens there from the allowlist alone.
 */
export const RUN_INHERITS: ReadonlyArray<string> = ['DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'DBUS_SESSION_BUS_ADDRESS']

/** How a run's line is started: by the system's shell, with what it is told beside what it inherits. */
export const runSpec = (line: string, env: Readonly<Record<string, string>>, platform: NodeJS.Platform = process.platform): LaunchSpec =>
  platform === 'win32'
    ? // The line as it is: cmd.exe takes off the outer quotes (/s).
      { command: 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], verbatim: true, env, inheritEnv: RUN_INHERITS }
    : { command: '/bin/sh', args: ['-c', line], env, inheritEnv: RUN_INHERITS }

/** Signals a process gets for its own fault, rather than from someone stopping it. */
const CRASHES = new Set(['SIGSEGV', 'SIGBUS', 'SIGILL', 'SIGFPE', 'SIGABRT', 'SIGTRAP', 'SIGSYS'])

/**
 * The numbers the shell a run runs in gives signals: Linux's, or, elsewhere off
 * Windows, the BSDs' and macOS's. Not os.constants.signals, which is the
 * numbering of the machine Althar runs on (Windows' own SIGABRT is 22).
 */
const SIGNAL_NUMBERS = {
  shared: {
    SIGHUP: 1,
    SIGINT: 2,
    SIGQUIT: 3,
    SIGILL: 4,
    SIGTRAP: 5,
    SIGABRT: 6,
    SIGFPE: 8,
    SIGKILL: 9,
    SIGSEGV: 11,
    SIGPIPE: 13,
    SIGALRM: 14,
    SIGTERM: 15,
  },
  linux: { SIGBUS: 7, SIGUSR1: 10, SIGUSR2: 12, SIGSYS: 31 },
  bsd: { SIGBUS: 10, SIGSYS: 12, SIGUSR1: 30, SIGUSR2: 31 },
} as const

const signalNamed = (number: number, platform: NodeJS.Platform) =>
  Object.entries({ ...SIGNAL_NUMBERS.shared, ...SIGNAL_NUMBERS[platform === 'linux' ? 'linux' : 'bsd'] }).find(
    ([, value]) => value === number,
  )?.[0]

const killedBy = (signal: string) => `killed by ${signal}${CRASHES.has(signal) ? ', so it crashed' : ''}`

/**
 * How a run ended by itself, in words after "ended at once": the signal that
 * killed it, its exit code, and, where the shell running it says a signal as
 * 128 and its number, or Windows a fault as an NTSTATUS code, which it was.
 */
export const endedHow = (
  exit: { readonly code: number | null; readonly signal: string | null },
  platform: NodeJS.Platform = process.platform,
): string => {
  if (exit.signal !== null) return `, ${killedBy(exit.signal)}`
  if (exit.code === null) return ''
  if (platform === 'win32' && exit.code >= 0xc0000000) return `, with exit code 0x${exit.code.toString(16).toUpperCase()}, so it crashed`
  const signal = platform !== 'win32' && exit.code > 128 ? signalNamed(exit.code - 128, platform) : undefined
  return `, with exit code ${exit.code}${signal === undefined ? '' : `: ${killedBy(signal)}`}`
}

/** The lockfiles a copy installs its packages from. */
const LOCKFILES = ['bun.lock', 'bun.lockb', 'pnpm-lock.yaml', 'yarn.lock', 'package-lock.json'].flatMap((name) => [name, `**/${name}`])

/** Where a copy notes which lockfiles the packages in it are installed from: beside it, as git's cleaning leaves it alone. */
const installedNote = (copy: string) => `${copy}.installed`

/**
 * Makes the packages in a copy of the default branch, freshened just now,
 * those of its lockfiles: where they changed since its packages were
 * installed, or Althar never noted it, all git ignores in it goes, its
 * packages first, so the setup a run does first, which installs only where
 * nothing is installed (runCommand.ts), installs them again. Without it, a
 * copy installed once runs every later default branch on its first packages:
 * a dependency added since is missing, and so is a package whose own install
 * never ran, as Electron's binary.
 */
export const installedAsLocked = (copy: string) =>
  Effect.gen(function* () {
    const locks = yield* git(copy, 'ls-files', '--stage', '--', ...LOCKFILES)
    const digest = createHash('sha256').update(locks).digest('hex')
    const note = installedNote(copy)
    if (existsSync(note) && readFileSync(note, 'utf8') === digest) return
    yield* git(copy, 'clean', '-fdqX')
    // Unnoted, it is only cleaned again next time.
    yield* Effect.try(() => writeFileSync(note, digest)).pipe(
      Effect.catch((error) => Effect.logWarning('Could not note what a run’s copy is installed from', error)),
    )
  })
