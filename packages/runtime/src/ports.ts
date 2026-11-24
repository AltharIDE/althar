import { execFile } from 'node:child_process'

import { Clock, Effect } from 'effect'

/*
 * Where something an agent left running answers, found from the machine, not
 * from what it printed (ADR-022): the TCP ports its processes listen on. A
 * server that writes to a log file, holds its output back, starts slowly or
 * prints an address that isn't its own still has a port. Read with `lsof`
 * (macOS and Linux), `ss` (Linux without it) or `netstat` (Windows), and the
 * processes' tree from `ps`, or from PowerShell on Windows.
 */

/** A process and its parent, from `ps -A -o pid=,ppid=`'s lines or PowerShell's `pid ppid` lines. */
export const parentsOf = (listing: string): ReadonlyMap<number, number> => {
  const parents = new Map<number, number>()
  for (const line of listing.split('\n')) {
    const [own, parent] = line.trim().split(/\s+/)
    if (own === undefined || parent === undefined || !/^\d+$/.test(own) || !/^\d+$/.test(parent)) continue
    parents.set(Number(own), Number(parent))
  }
  return parents
}

/** `roots` and everything they started, from each process's parent. */
export const treeOf = (parents: ReadonlyMap<number, number>, roots: ReadonlyArray<number>): ReadonlySet<number> => {
  const children = new Map<number, Array<number>>()
  for (const [own, parent] of parents) children.set(parent, [...(children.get(parent) ?? []), own])
  const tree = new Set<number>()
  const queue = [...roots]
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    if (tree.has(next)) continue
    tree.add(next)
    queue.push(...(children.get(next) ?? []))
  }
  return tree
}

/** A port a process listens on. */
export interface Listener {
  readonly pid: number
  readonly port: number
}

const portOf = (address: string) => {
  const port = /:(\d{1,5})$/.exec(address.trim())?.[1]
  return port === undefined ? null : Number(port)
}

/** An address on this machine, or open to all of it: not one on a network interface, which a browser here has no use for. */
const reachableHere = (address: string) =>
  /^(\*|0\.0\.0\.0|\[?::\]?|127\.\d+\.\d+\.\d+|\[?::1\]?|localhost)$/.test(address.replace(/:\d{1,5}$/, ''))

/** `lsof -nP -iTCP -sTCP:LISTEN -F pn`'s lines: a `p` line for a process, then an `n` line for each address it listens on. */
export const listenersOfLsof = (output: string): ReadonlyArray<Listener> => {
  const found: Array<Listener> = []
  let pid: number | null = null
  for (const line of output.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1))
    else if (line.startsWith('n') && pid !== null && Number.isFinite(pid)) {
      const address = line.slice(1)
      const port = portOf(address)
      if (port !== null && reachableHere(address)) found.push({ pid, port })
    }
  }
  return found
}

/** `ss -H -ltnp`'s lines: `LISTEN 0 511 127.0.0.1:5173 0.0.0.0:* users:(("node",pid=4242,fd=19))`. */
export const listenersOfSs = (output: string): ReadonlyArray<Listener> =>
  output.split('\n').flatMap((line) => {
    const columns = line.trim().split(/\s+/)
    const address = columns[3] ?? ''
    const port = portOf(address)
    if (columns[0] !== 'LISTEN' || port === null || !reachableHere(address)) return []
    return [...line.matchAll(/pid=(\d+)/g)].map((one) => ({ pid: Number(one[1]), port }))
  })

/** `netstat -ano -p tcp`'s lines on Windows: `TCP  0.0.0.0:5173  0.0.0.0:0  LISTENING  4242`. */
export const listenersOfNetstat = (output: string): ReadonlyArray<Listener> =>
  output.split('\n').flatMap((line) => {
    const columns = line.trim().split(/\s+/)
    const address = columns[1] ?? ''
    const port = portOf(address)
    const pid = Number(columns[4])
    if (columns[0]?.toUpperCase() !== 'TCP' || columns[3]?.toUpperCase() !== 'LISTENING' || port === null || !Number.isFinite(pid))
      return []
    return reachableHere(address) ? [{ pid, port }] : []
  })

/** How a command the lookup ran went: which, how long it took, and why it gave nothing where it didn't. */
export interface Ran {
  readonly command: string
  readonly ms: number
  /** Null where it gave what it printed. */
  readonly failed: string | null
}

/** What a command printed, or null where it can't be run or fails: not having it is no reason to stop. */
const printedRan = (file: string, args: ReadonlyArray<string>): Effect.Effect<{ readonly out: string | null; readonly ran: Ran }> =>
  Effect.gen(function* () {
    const began = yield* Clock.currentTimeMillis
    const { out, failed } = yield* Effect.callback<{ readonly out: string | null; readonly failed: string | null }>((resume) => {
      try {
        execFile(file, [...args], { timeout: 10_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
          // `lsof` exits 1 where it finds nothing.
          const kept = error === null || (typeof error.code === 'number' && stdout !== '')
          const why = error?.killed === true ? 'killed (timed out)' : `code ${String(error?.code)}`
          resume(Effect.succeed({ out: kept ? stdout : null, failed: kept ? null : `${why}: ${error?.message ?? ''}` }))
        })
      } catch (error) {
        // Not allowed to run it, as in a sandbox.
        resume(Effect.succeed({ out: null, failed: `couldn't run: ${String(error)}` }))
      }
    })
    return { out, ran: { command: file, ms: (yield* Clock.currentTimeMillis) - began, failed } }
  })

const printed = (file: string, args: ReadonlyArray<string>): Effect.Effect<string | null> =>
  Effect.map(printedRan(file, args), (result) => result.out)

const processesRan = (windows: boolean) =>
  (windows
    ? printedRan('powershell', [
        '-NoProfile',
        '-Command',
        'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }',
      ])
    : printedRan('ps', ['-A', '-o', 'pid=,ppid='])
  ).pipe(Effect.map(({ out, ran }) => ({ parents: out === null ? new Map<number, number>() : parentsOf(out), ran: [ran] })))

/** Every process and its parent. */
export const processes = (windows = process.platform === 'win32'): Effect.Effect<ReadonlyMap<number, number>> =>
  Effect.map(processesRan(windows), (result) => result.parents)

const listenersRan = (windows: boolean): Effect.Effect<{ readonly listening: ReadonlyArray<Listener>; readonly ran: ReadonlyArray<Ran> }> =>
  Effect.gen(function* () {
    if (windows) {
      const netstat = yield* printedRan('netstat', ['-ano', '-p', 'tcp'])
      return { listening: listenersOfNetstat(netstat.out ?? ''), ran: [netstat.ran] }
    }
    const lsof = yield* printedRan('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pn'])
    if (lsof.out !== null) return { listening: listenersOfLsof(lsof.out), ran: [lsof.ran] }
    const ss = yield* printedRan('ss', ['-H', '-ltnp'])
    return { listening: listenersOfSs(ss.out ?? ''), ran: [lsof.ran, ss.ran] }
  })

/** Every TCP port something on this machine listens on, with its process. */
export const listeners = (windows = process.platform === 'win32'): Effect.Effect<ReadonlyArray<Listener>> =>
  Effect.map(listenersRan(windows), (result) => result.listening)

/** The processes that hold a file open: the one a background command's output goes to is held by its shell. Nothing where `lsof` can't say. */
export const holding = (path: string): Effect.Effect<ReadonlyArray<number>> =>
  process.platform === 'win32'
    ? Effect.succeed([])
    : printed('lsof', ['-t', '--', path]).pipe(
        Effect.map((out) =>
          (out ?? '')
            .split('\n')
            .filter((line) => /^\d+$/.test(line.trim()))
            .map(Number),
        ),
      )

/**
 * What one lookup of the ports below `roots` saw: how many processes the
 * machine listed, the tree they make from the roots, every port something
 * listened on, and the commands it ran. Kept for whoever watches the lookups
 * (`RuntimeOptions.serving`), as a test does to say what it saw.
 */
export interface PortsSeen {
  readonly roots: ReadonlyArray<number>
  readonly processes: number
  readonly tree: ReadonlyArray<number>
  readonly listening: ReadonlyArray<Listener>
  readonly ports: ReadonlyArray<number>
  readonly ran: ReadonlyArray<Ran>
}

/** The ports the processes in the trees of `roots` listen on, in the order the machine lists them, with what the lookup saw. */
export const portsSeenBelow = (roots: ReadonlyArray<number>, windows = process.platform === 'win32'): Effect.Effect<PortsSeen> =>
  Effect.gen(function* () {
    if (roots.length === 0) return { roots, processes: 0, tree: [], listening: [], ports: [], ran: [] }
    // The two listings don't depend on each other, and every agent turn waits on them: read them side by side.
    const [parents, listening] = yield* Effect.all([processesRan(windows), listenersRan(windows)], { concurrency: 'unbounded' })
    const tree = treeOf(parents.parents, roots)
    const ports: Array<number> = []
    for (const { pid, port } of listening.listening) if (tree.has(pid) && !ports.includes(port)) ports.push(port)
    return {
      roots,
      processes: parents.parents.size,
      tree: [...tree],
      listening: listening.listening,
      ports,
      ran: [...parents.ran, ...listening.ran],
    }
  })

/** The ports the processes in the trees of `roots` listen on, in the order the machine lists them. */
export const portsBelow = (roots: ReadonlyArray<number>): Effect.Effect<ReadonlyArray<number>> =>
  Effect.map(portsSeenBelow(roots), (seen) => seen.ports)

/**
 * The port one is found to listen on, from what listens in the tree it can be
 * told apart in. `found` are the ports in that tree; `claimed`, those another
 * entry answers on. Where the tree is its own (`own`: the processes holding
 * its output file), its first port not claimed is it. Where it is the agent's
 * whole tree, which every other command shares, it is only the one new port
 * (not in `known`, what listened before it started) where no other command is
 * left without an address: a second could as well be the one that listens.
 */
export const portFor = (input: {
  readonly found: ReadonlyArray<number>
  readonly claimed: ReadonlySet<number>
  readonly own: boolean
  readonly known: ReadonlySet<number>
  readonly rivals: number
}): number | null => {
  const free = input.found.filter((port) => !input.claimed.has(port))
  if (input.own) return free[0] ?? null
  const fresh = free.filter((port) => !input.known.has(port))
  return input.rivals === 0 && fresh.length === 1 ? (fresh[0] ?? null) : null
}

/**
 * One look for where something an agent left running answers: what its tree
 * listened on as the turn began (`before`; `seen` null where that lookup ran
 * out of time), or one look for one command's port, with all `portFor` was
 * given and what it answered.
 */
export type PortLook =
  | { readonly kind: 'before'; readonly at: number; readonly agent: number | null; readonly seen: PortsSeen | null }
  | {
      readonly kind: 'look'
      readonly at: number
      readonly id: string
      readonly outputPath: string | null
      readonly held: ReadonlyArray<number>
      readonly seen: PortsSeen
      readonly known: ReadonlyArray<number>
      readonly claimed: ReadonlyArray<number>
      readonly rivals: number
      readonly own: boolean
      readonly port: number | null
    }

/** Where a server on `port` answers, as a browser opens it. */
export const localAddress = (port: number) => `http://localhost:${port}/`
