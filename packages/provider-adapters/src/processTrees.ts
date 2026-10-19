import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { win32 } from 'node:path'

import { Duration, Effect } from 'effect'

import { keeper, keeperStartedAt } from './keeper'

/*
 * How Althar reaches every process an agent started, to see whether any still
 * runs and to stop them all (docs/architecture/02, Process tree). On macOS
 * and Linux the agent runs in a process group of its own, which a signal
 * reaches as a whole, even after the agent itself has exited. On Windows it
 * runs under a keeper (keeper.ts), in a Job Object that holds everything it
 * starts, whatever exits in between, and kills it all once the keeper has
 * gone: the keeper is the process Althar spawns, sees and kills, and the tree
 * runs exactly as long as it does. The keeper exits once the agent has, so
 * what the agent leaves running goes then; a Unix group's goes when Althar
 * stops it, which it does as soon as it sees the agent exit.
 */

/** What a tree is sent: on Windows only a kill can be sent from outside, as a console process there has no TERM. */
export type TreeSignal = 'SIGTERM' | 'SIGKILL'

/** A command as it is spawned for its tree to be reached. */
export interface Launch {
  readonly command: string
  readonly args: ReadonlyArray<string>
  /** In a process group of its own, on Unix; on Windows the keeper is not, and gives the command a console whose window is hidden. */
  readonly detached: boolean
}

export interface ProcessTrees {
  /** How a command is spawned for its tree to be reached: as it is on Unix, under a keeper on Windows; why it can't be, where it can't. */
  readonly launch: (command: string, args: ReadonlyArray<string>) => Effect.Effect<Launch, string>
  /** Whether it can ask a tree to stop before killing it; Windows can't. */
  readonly asks: boolean
  /** Whether a tree lives on once the process spawned has exited: a Unix group does, until it is stopped; a keeper's job goes with it. */
  readonly outlivesRoot: boolean
  /** Whether anything of the tree of the process spawned, `pid`, still runs. */
  readonly alive: (pid: number) => Effect.Effect<boolean>
  /** Sends the whole tree a signal; a tree already gone is fine. */
  readonly signal: (pid: number, signal: TreeSignal) => Effect.Effect<void>
  /** When the OS says a process started, as ISO 8601, or undefined if it can't say. */
  readonly startedAt: (pid: number) => Effect.Effect<string | undefined>
}

/** Unix: the process group whose id is the agent's pid. */
export const unixTrees: ProcessTrees = {
  launch: (command, args) => Effect.succeed({ command, args, detached: true }),
  asks: true,
  outlivesRoot: true,
  alive: (pid) =>
    Effect.sync(() => {
      try {
        process.kill(-pid, 0)
        return true
      } catch {
        return false
      }
    }),
  signal: (pid, signal) =>
    Effect.sync(() => {
      try {
        process.kill(-pid, signal)
      } catch {
        // The group has already exited.
      }
    }),
  startedAt: (pid) =>
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
    }),
}

export interface WindowsDependencies {
  /** The keeper's path, built where it has to be; why it can't be, where it can't. */
  readonly keeper: Effect.Effect<string, string>
  /** When the keeper at a path says a process started. */
  readonly startedAt: (keeper: string, pid: number) => Effect.Effect<string | undefined>
  /** Whether a file is there. */
  readonly exists: (path: string) => boolean
  /** Whether a process runs. */
  readonly alive: (pid: number) => boolean
  /** Kills one process; one already gone is fine. */
  readonly kill: (pid: number) => void
}

const running = (pid: number) => {
  try {
    // OpenProcess and its exit code, on Windows.
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const terminate = (pid: number) => {
  try {
    // TerminateProcess, on Windows, for any signal but 0.
    process.kill(pid, 'SIGKILL')
  } catch {
    // It has already exited.
  }
}

const windowsDependencies: WindowsDependencies = {
  keeper: keeper(),
  startedAt: keeperStartedAt,
  exists: existsSync,
  alive: running,
  kill: terminate,
}

/**
 * Windows: each tree under a keeper, whose job runs as long as the keeper
 * does, so the keeper running is the tree running, and killing it kills the
 * tree. A command named by its full path that isn't there fails as Node's
 * spawn would, where the keeper would only exit.
 */
export const windowsTrees = (dependencies: WindowsDependencies = windowsDependencies): ProcessTrees => ({
  launch: (command, args) =>
    win32.isAbsolute(command) && !dependencies.exists(command)
      ? Effect.fail(`spawn ${command} ENOENT`)
      : Effect.map(dependencies.keeper, (path) => ({ command: path, args: ['run', command, ...args], detached: false })),
  asks: false,
  outlivesRoot: false,
  alive: (pid) => Effect.sync(() => dependencies.alive(pid)),
  signal: (pid) => Effect.sync(() => dependencies.kill(pid)),
  startedAt: (pid) =>
    dependencies.keeper.pipe(
      Effect.flatMap((path) => dependencies.startedAt(path, pid)),
      Effect.orElseSucceed(() => undefined),
    ),
})

/** The trees of the platform Althar runs on. */
export const platformTrees = (platform: NodeJS.Platform = process.platform): ProcessTrees =>
  platform === 'win32' ? windowsTrees() : unixTrees

/** How stopping went: the last signal sent to the tree, and whether anything outlived it. */
export interface StopReport {
  readonly signal: 'none' | 'SIGTERM' | 'SIGKILL'
  readonly survivors: boolean
}

/** Waits for the tree to empty, up to a limit. */
const treeGone = (trees: ProcessTrees, pid: number, limit: Duration.Input) =>
  Effect.gen(function* () {
    const until = Date.now() + Duration.toMillis(Duration.fromInputUnsafe(limit))
    while ((yield* trees.alive(pid)) && Date.now() < until) yield* Effect.sleep('25 millis')
    return !(yield* trees.alive(pid))
  })

/**
 * Stops a tree: asks it to stop where the platform can (TERM), waits a grace
 * period, then kills it, and says whether anything outlived that. Where it
 * can't ask, as on Windows, the grace period is the time the provider has to
 * stop after being asked in its own protocol, and a tree that went in it was
 * sent nothing. A tree already gone is left alone.
 */
export const stopTree = (trees: ProcessTrees, pid: number, grace: Duration.Input): Effect.Effect<StopReport> =>
  Effect.gen(function* () {
    if (!(yield* trees.alive(pid))) return { signal: 'none', survivors: false }
    if (trees.asks) yield* trees.signal(pid, 'SIGTERM')
    if (yield* treeGone(trees, pid, grace)) return { signal: trees.asks ? 'SIGTERM' : 'none', survivors: false }
    yield* trees.signal(pid, 'SIGKILL')
    return { signal: 'SIGKILL', survivors: !(yield* treeGone(trees, pid, Duration.seconds(2))) }
  })
