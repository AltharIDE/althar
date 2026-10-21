import { execFile } from 'node:child_process'

import { Effect } from 'effect'

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

/** What a command printed, or null where it can't be run or fails: not having it is no reason to stop. */
const printed = (file: string, args: ReadonlyArray<string>): Effect.Effect<string | null> =>
  Effect.callback<string | null>((resume) => {
    try {
      execFile(file, [...args], { timeout: 10_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
        // `lsof` exits 1 where it finds nothing.
        resume(Effect.succeed(error === null || (typeof error.code === 'number' && stdout !== '') ? stdout : null))
      })
    } catch {
      // Not allowed to run it, as in a sandbox.
      resume(Effect.succeed(null))
    }
  })

/** Every process and its parent. */
export const processes = (windows = process.platform === 'win32'): Effect.Effect<ReadonlyMap<number, number>> =>
  (windows
    ? printed('powershell', [
        '-NoProfile',
        '-Command',
        'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }',
      ])
    : printed('ps', ['-A', '-o', 'pid=,ppid='])
  ).pipe(Effect.map((listing) => (listing === null ? new Map<number, number>() : parentsOf(listing))))

/** Every TCP port something on this machine listens on, with its process. */
export const listeners = (windows = process.platform === 'win32'): Effect.Effect<ReadonlyArray<Listener>> =>
  Effect.gen(function* () {
    if (windows) return listenersOfNetstat((yield* printed('netstat', ['-ano', '-p', 'tcp'])) ?? '')
    const lsof = yield* printed('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pn'])
    if (lsof !== null) return listenersOfLsof(lsof)
    return listenersOfSs((yield* printed('ss', ['-H', '-ltnp'])) ?? '')
  })

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

/** The ports the processes in the trees of `roots` listen on, in the order the machine lists them. */
export const portsBelow = (roots: ReadonlyArray<number>): Effect.Effect<ReadonlyArray<number>> =>
  Effect.gen(function* () {
    if (roots.length === 0) return []
    const tree = treeOf(yield* processes(), roots)
    const ports: Array<number> = []
    for (const { pid, port } of yield* listeners()) if (tree.has(pid) && !ports.includes(port)) ports.push(port)
    return ports
  })

/** Where a server on `port` answers, as a browser opens it. */
export const localAddress = (port: number) => `http://localhost:${port}/`
