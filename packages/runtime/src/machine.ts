import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { type CpuInfo, cpus, freemem, totalmem } from 'node:os'

import type { MemoryPressure } from '@althar/contracts'
import { Effect } from 'effect'

import { cpuTimeOf } from './processTree'

/*
 * What this computer says of how hard it works, read the cheapest way each
 * system has: every core's time so far from Node; memory in use from
 * `vm_stat` on a Mac, counted as Activity Monitor does (apps, wired and
 * compressed, not cache), and from /proc/meminfo on Linux; the memory
 * pressure macOS reports, from `sysctl`; and every process with its parent,
 * CPU time and resident memory, from one `ps` listing, as on macOS and Linux
 * both. A reading costs a few milliseconds, the listing most of them (about
 * 15 ms for 600 processes on an M-series Mac). What used how much is worked
 * out between two readings (`MachineLoad.ts`).
 */

/** A process in a listing: its parent, the CPU time it has used so far in milliseconds, and the memory it has resident, in bytes. */
export interface Listed {
  readonly parent: number
  readonly cpu: number
  readonly memory: number
}

export interface Reading {
  /** When it was read, in milliseconds since the epoch. */
  readonly at: number
  /** Every core's time so far, busy and all of it, in milliseconds, and how many cores. */
  readonly cores: { readonly busy: number; readonly total: number; readonly count: number }
  readonly memory: { readonly used: number; readonly total: number }
  /** Null where the system doesn't say. */
  readonly pressure: MemoryPressure | null
  /** Every process by its pid; null where they can't be listed, as on Windows. */
  readonly processes: ReadonlyMap<number, Listed> | null
}

/** Every core's time so far, added up. */
export const coresOf = (infos: ReadonlyArray<Pick<CpuInfo, 'times'>>): Reading['cores'] => {
  let busy = 0
  let total = 0
  for (const { times } of infos) {
    const used = times.user + times.nice + times.sys + times.irq
    busy += used
    total += used + times.idle
  }
  return { busy, total, count: infos.length }
}

/** The processes in `ps -A -o pid=,ppid=,time=,rss=`'s lines; a line that isn't one is left out. */
export const listingOf = (text: string): Map<number, Listed> => {
  const listed = new Map<number, Listed>()
  for (const line of text.split('\n')) {
    const [pid, parent, time, rss] = line.trim().split(/\s+/)
    const cpu = cpuTimeOf(time ?? '')
    if (cpu === null || !/^\d+$/.test(pid ?? '') || !/^\d+$/.test(parent ?? '') || !/^\d+$/.test(rss ?? '')) continue
    listed.set(Number(pid), { parent: Number(parent), cpu, memory: Number(rss) * 1024 })
  }
  return listed
}

/**
 * Memory in use from `vm_stat`, in bytes, as Activity Monitor counts it:
 * what apps hold (anonymous pages, less what may be purged), what is wired
 * and what the compressor occupies. Null where it doesn't say all of them.
 */
export const usedOfVmStat = (text: string): number | null => {
  const size = /page size of (\d+) bytes/.exec(text)?.[1]
  const pages = new Map<string, number>()
  for (const line of text.split('\n')) {
    const match = /^"?([^":]+)"?:\s+(\d+)\.?\s*$/.exec(line.trim())
    if (match?.[1] !== undefined && match[2] !== undefined) pages.set(match[1], Number(match[2]))
  }
  const anonymous = pages.get('Anonymous pages')
  const purgeable = pages.get('Pages purgeable')
  const wired = pages.get('Pages wired down')
  const compressed = pages.get('Pages occupied by compressor')
  if (size === undefined || anonymous === undefined || purgeable === undefined || wired === undefined || compressed === undefined)
    return null
  return (Math.max(0, anonymous - purgeable) + wired + compressed) * Number(size)
}

/** Memory in use and all of it from /proc/meminfo, in bytes: all of it less what is available. Null where it doesn't say both. */
export const memoryOfMeminfo = (text: string): Reading['memory'] | null => {
  const kb = (name: string) => {
    const found = new RegExp(`^${name}:\\s+(\\d+) kB$`, 'm').exec(text)?.[1]
    return found === undefined ? undefined : Number(found) * 1024
  }
  const total = kb('MemTotal')
  const available = kb('MemAvailable')
  return total === undefined || available === undefined ? null : { used: Math.max(0, total - available), total }
}

/** macOS's `kern.memorystatus_vm_pressure_level`: 1 normal, 2 warning, 4 critical. */
export const pressureOf = (level: string): MemoryPressure | null => {
  switch (level.trim()) {
    case '1':
      return 'normal'
    case '2':
      return 'warning'
    case '4':
      return 'critical'
    default:
      return null
  }
}

/** What each piece of work used between two readings. */
export interface Used {
  /** CPU time, in milliseconds. */
  readonly cpu: number
  /** Memory resident now, in bytes. */
  readonly memory: number
  readonly processes: number
}

/**
 * What each piece of work used between two listings: the processes it was
 * started as, by `key`, and everything they started, each process counted
 * once, for the first piece that reaches it. A process new since the first
 * listing used all its time since; one that ended between them is gone, with
 * what it used. A root no longer listed has nothing.
 */
export const usedBy = (
  roots: ReadonlyArray<{ readonly pid: number; readonly key: string }>,
  before: ReadonlyMap<number, Listed>,
  after: ReadonlyMap<number, Listed>,
): Map<string, Used> => {
  const children = new Map<number, Array<number>>()
  for (const [pid, { parent }] of after) children.set(parent, [...(children.get(parent) ?? []), pid])
  const seen = new Set<number>()
  const used = new Map<string, Used>()
  for (const { pid: root, key } of roots) {
    let { cpu, memory, processes } = used.get(key) ?? { cpu: 0, memory: 0, processes: 0 }
    const queue = [root]
    for (let pid = queue.shift(); pid !== undefined; pid = queue.shift()) {
      const now = after.get(pid)
      if (seen.has(pid) || now === undefined) continue
      seen.add(pid)
      const was = before.get(pid)
      // A pid seen with more time than it has now was another process's, since reused.
      cpu += was === undefined || was.cpu > now.cpu ? now.cpu : now.cpu - was.cpu
      memory += now.memory
      processes += 1
      queue.push(...(children.get(pid) ?? []))
    }
    if (processes > 0) used.set(key, { cpu, memory, processes })
  }
  return used
}

/** What a command printed, or null where it couldn't run or failed. */
const output = (command: string, args: ReadonlyArray<string>): Effect.Effect<string | null> =>
  Effect.callback<string | null>((resume) => {
    try {
      execFile(command, [...args], { timeout: 5_000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
        resume(Effect.succeed(error === null ? stdout : null))
      })
    } catch {
      // A sandbox that won't let it start says so at once, not through the callback.
      resume(Effect.succeed(null))
    }
  })

const memoryOn = (platform: NodeJS.Platform): Effect.Effect<Reading['memory']> =>
  Effect.gen(function* () {
    const total = totalmem()
    // Elsewhere, and where these can't be read, free memory is all Node says: on a Mac it counts cache as in use.
    const fallback = { used: Math.max(0, total - freemem()), total }
    if (platform === 'darwin') {
      const text = yield* output('vm_stat', [])
      const used = text === null ? null : usedOfVmStat(text)
      return used === null ? fallback : { used: Math.min(used, total), total }
    }
    if (platform === 'linux') {
      const text = yield* Effect.promise(() => readFile('/proc/meminfo', 'utf8').catch(() => null))
      return (text === null ? null : memoryOfMeminfo(text)) ?? fallback
    }
    return fallback
  })

/** This computer as it is now. */
export const readMachine = (platform: NodeJS.Platform = process.platform): Effect.Effect<Reading> =>
  Effect.gen(function* () {
    const at = Date.now()
    const cores = coresOf(cpus())
    const [memory, level, listing] = yield* Effect.all(
      [
        memoryOn(platform),
        platform === 'darwin' ? output('sysctl', ['-n', 'kern.memorystatus_vm_pressure_level']) : Effect.succeed(null),
        platform === 'darwin' || platform === 'linux' ? output('ps', ['-A', '-o', 'pid=,ppid=,time=,rss=']) : Effect.succeed(null),
      ],
      { concurrency: 'unbounded' },
    )
    return {
      at,
      cores,
      memory,
      pressure: level === null ? null : pressureOf(level),
      processes: listing === null ? null : listingOf(listing),
    }
  })
