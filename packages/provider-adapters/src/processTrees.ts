import { execFile } from 'node:child_process'

import { Duration, Effect } from 'effect'

/*
 * How Althar reaches every process an agent started, to see whether any still
 * runs and to stop them all (docs/architecture/02, Process tree). On macOS
 * and Linux the agent runs in a process group of its own, which a signal
 * reaches as a whole, even after the agent itself has exited. Windows has no
 * process groups to signal: there the tree is read from the OS's list of
 * processes, each one's parent and when it started, and each process in it
 * is killed by its pid.
 *
 * Why not a Job Object on Windows: Node can't make one, so it would take a
 * native module, or a PowerShell that compiles one at every start and sits
 * between Althar and the agent's protocol. What a walk of the tree misses is a
 * process whose own parent, below the agent, has already exited: Windows keeps
 * the pid of a process's parent, not its ancestry. The agent's own children
 * are found even after the agent has gone.
 */

/** What a tree is sent: on Windows only a kill can be sent from outside, as a console process there has no TERM. */
export type TreeSignal = 'SIGTERM' | 'SIGKILL'

export interface ProcessTrees {
  /** How a process is spawned for its tree to be reached: in a group of its own on Unix; on Windows, sharing a hidden console with what it starts. */
  readonly spawn: { readonly detached: boolean }
  /** Whether it can ask a tree to stop before killing it; Windows can't. */
  readonly asks: boolean
  /** Whether the process, or anything it started, still runs. `startedAt` is when the OS says it started, where that was recorded. */
  readonly alive: (pid: number, startedAt?: string) => Effect.Effect<boolean>
  /** Sends every process in the tree a signal; a tree already gone is fine. */
  readonly signal: (pid: number, signal: TreeSignal, startedAt?: string) => Effect.Effect<void>
  /** When the OS says a process started, as ISO 8601, or undefined if it can't say. */
  readonly startedAt: (pid: number) => Effect.Effect<string | undefined>
}

/** Unix: the process group whose id is the agent's pid. */
export const unixTrees: ProcessTrees = {
  spawn: { detached: true },
  asks: true,
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

/** A process as Windows lists it: its pid, its parent's, and when it started, as ISO 8601. */
export interface Listed {
  readonly pid: number
  readonly parent: number
  readonly startedAt: string
}

/**
 * The processes in the tree of `pid`, it first where it still runs, from a
 * listing of every process. A process belongs when its parent does and it
 * started no earlier than its parent: Windows keeps a parent's pid after the
 * parent exits, and may give that pid to a later process. Where the root is
 * gone, `startedAt` says when it started, and its children are those started
 * after then and before any later process given its pid; without it, nothing
 * proves a child of a gone root is its, and none is.
 */
export const treeOf = (listing: ReadonlyArray<Listed>, pid: number, startedAt?: string): ReadonlyArray<Listed> => {
  const holder = listing.find((listed) => listed.pid === pid)
  const root = holder !== undefined && (startedAt === undefined || holder.startedAt === startedAt) ? holder : undefined
  const from = startedAt ?? holder?.startedAt
  if (from === undefined) return []
  const until = root === undefined ? holder?.startedAt : undefined
  const members: Array<Listed> = root === undefined ? [] : [root]
  const seen = new Set(members.map((member) => member.pid))
  const queue: Array<{ readonly pid: number; readonly from: string; readonly until?: string }> = [
    { pid, from, ...(until === undefined ? {} : { until }) },
  ]
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    for (const listed of listing) {
      if (listed.parent !== next.pid || seen.has(listed.pid) || listed.startedAt < next.from) continue
      if (next.until !== undefined && listed.startedAt >= next.until) continue
      seen.add(listed.pid)
      members.push(listed)
      queue.push({ pid: listed.pid, from: listed.startedAt })
    }
  }
  return members
}

/** PowerShell's lines for every process: its pid, its parent's and when it started, in UTC to the millisecond. */
const LISTING_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  'Get-CimInstance -ClassName Win32_Process -Property ProcessId,ParentProcessId,CreationDate | ForEach-Object {',
  "  if ($_.CreationDate) { '{0} {1} {2}' -f $_.ProcessId, $_.ParentProcessId, $_.CreationDate.ToUniversalTime().ToString(\"yyyy-MM-dd'T'HH:mm:ss.fff'Z'\") }",
  '}',
].join('\n')

/** The listing PowerShell printed, as processes; a line it can't read is left out. */
export const listingOf = (text: string): ReadonlyArray<Listed> =>
  text.split(/\r?\n/).flatMap((line) => {
    const match = /^(\d+) (\d+) (\S+)$/.exec(line.trim())
    if (match === null) return []
    const started = new Date(match[3] ?? '')
    return Number.isNaN(started.getTime()) ? [] : [{ pid: Number(match[1]), parent: Number(match[2]), startedAt: started.toISOString() }]
  })

const system32 = (env: Readonly<Record<string, string | undefined>> = process.env) => `${env.SystemRoot ?? 'C:\\Windows'}\\System32`

/** Every process Windows runs, or none where it can't list them. Read by PowerShell from its full path, its window hidden. */
export const listWindowsProcesses: Effect.Effect<ReadonlyArray<Listed> | undefined> = Effect.callback((resume) => {
  execFile(
    `${system32()}\\WindowsPowerShell\\v1.0\\powershell.exe`,
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
      Buffer.from(LISTING_SCRIPT, 'utf16le').toString('base64'),
    ],
    { timeout: 15_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
    (error, stdout) => resume(Effect.succeed(error === null ? listingOf(stdout) : undefined)),
  )
})

export interface WindowsDependencies {
  /** Every process the OS runs, or undefined where it can't say. */
  readonly list: Effect.Effect<ReadonlyArray<Listed> | undefined>
  /** Kills one process by its pid; one already gone is fine. */
  readonly kill: (pid: number) => void
}

const terminate = (pid: number) => {
  try {
    // TerminateProcess, on Windows, for any signal but 0.
    process.kill(pid, 'SIGKILL')
  } catch {
    // It has already exited.
  }
}

/** How many times a kill lists the tree again, for a process started while the last was killed. */
const KILL_ROUNDS = 3

/**
 * Windows: the tree read from the list of processes. A kill goes to every
 * process in it by pid, leaves first, and the tree is listed again for any
 * process started meanwhile. Where the processes can't be listed, the root
 * alone is reached, as `process.kill` can.
 */
export const windowsTrees = ({ list, kill }: WindowsDependencies = { list: listWindowsProcesses, kill: terminate }): ProcessTrees => {
  const members = (pid: number, startedAt?: string) =>
    Effect.map(list, (listing) => (listing === undefined ? undefined : treeOf(listing, pid, startedAt)))
  const rootAlive = (pid: number) => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }
  return {
    spawn: { detached: false },
    asks: false,
    alive: (pid, startedAt) => Effect.map(members(pid, startedAt), (tree) => (tree === undefined ? rootAlive(pid) : tree.length > 0)),
    signal: (pid, _signal, startedAt) =>
      Effect.gen(function* () {
        for (let round = 0; round < KILL_ROUNDS; round += 1) {
          const tree = yield* members(pid, startedAt)
          if (tree === undefined) return kill(pid)
          if (tree.length === 0) return
          for (const member of tree.toReversed()) kill(member.pid)
        }
      }),
    startedAt: (pid) => Effect.map(list, (listing) => listing?.find((listed) => listed.pid === pid)?.startedAt),
  }
}

/** The trees of the platform Althar runs on. */
export const platformTrees = (platform: NodeJS.Platform = process.platform): ProcessTrees =>
  platform === 'win32' ? windowsTrees() : unixTrees

/** How stopping went: the last signal sent to the tree, and whether anything outlived it. */
export interface StopReport {
  readonly signal: 'none' | 'SIGTERM' | 'SIGKILL'
  readonly survivors: boolean
}

/** Waits for the tree to empty, up to a limit. */
const treeGone = (trees: ProcessTrees, pid: number, limit: Duration.Input, startedAt?: string) =>
  Effect.gen(function* () {
    const until = Date.now() + Duration.toMillis(Duration.fromInputUnsafe(limit))
    while ((yield* trees.alive(pid, startedAt)) && Date.now() < until) yield* Effect.sleep('25 millis')
    return !(yield* trees.alive(pid, startedAt))
  })

/**
 * Stops a tree: asks it to stop where the platform can (TERM), waits a grace
 * period, then kills it, and says whether anything outlived that. Where it
 * can't ask, as on Windows, the grace period is the time the provider has to
 * stop after being asked in its own protocol, and a tree that went in it was
 * sent nothing. A tree already gone is left alone.
 */
export const stopTree = (trees: ProcessTrees, pid: number, grace: Duration.Input, startedAt?: string): Effect.Effect<StopReport> =>
  Effect.gen(function* () {
    if (!(yield* trees.alive(pid, startedAt))) return { signal: 'none', survivors: false }
    if (trees.asks) yield* trees.signal(pid, 'SIGTERM', startedAt)
    if (yield* treeGone(trees, pid, grace, startedAt)) return { signal: trees.asks ? 'SIGTERM' : 'none', survivors: false }
    yield* trees.signal(pid, 'SIGKILL', startedAt)
    return { signal: 'SIGKILL', survivors: !(yield* treeGone(trees, pid, Duration.seconds(2), startedAt)) }
  })
