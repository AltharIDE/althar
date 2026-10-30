import { execFile } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { type CpuInfo, cpus, freemem, totalmem } from 'node:os'

import type { MemoryPressure } from '@althar/contracts'
import { Clock, Effect } from 'effect'

import { processReader, runReader } from './processReader'
import { cpuTimeOf } from './processTree'

/*
 * What this computer says of how hard it works, read the cheapest way each
 * system has: every core's time so far from Node; memory in use from
 * `vm_stat` on a Mac, counted as Activity Monitor does (apps, wired and
 * compressed, not cache), and from /proc/meminfo on Linux; the memory
 * pressure macOS reports, from `sysctl`; and every process with its parent,
 * when it started, its CPU time and its memory. A process's CPU time counts
 * what the children it has reaped used too, so work that started and ended
 * between two readings isn't lost: on a Mac the kernel says it to a small
 * reader Althar builds (processReader.ts), and on Linux /proc does. Where
 * neither can, `ps` lists them, each with its own time only. A reading costs
 * a few milliseconds, the listing most of them (about 10 ms for 800 processes
 * on an M-series Mac). What used how much is worked out between two readings
 * (`MachineLoad.ts`).
 *
 * Everything Althar starts for a piece of work carries it in its environment,
 * `ALTHAR_WORK` (`workOf`), and so does everything that starts in turn, so a
 * process that has left its tree, as a server started in the background
 * does once the shell that started it exits, is still known to be that
 * work's. The environment is read only for a process no tree reaches, once.
 */

/** A process in a listing: its parent, the CPU time it has used so far in milliseconds, and the memory it holds, in bytes. */
export interface Listed {
  readonly parent: number
  readonly cpu: number
  readonly memory: number
  /** When it started, in whatever units the listing has, to tell it from a later process given the same pid; absent where the listing doesn't say. */
  readonly started?: number
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
  /** Whether each process's CPU time counts what the children it has reaped used; two readings that differ can't be measured between. */
  readonly reaped?: boolean
}

/** The variable that says whose work a process is. */
export const WORK = 'ALTHAR_WORK'

/** Althar itself, as a piece of work: the app, its windows and the runtime. */
export const ALTHAR = 'althar'

/** A piece of work as `ALTHAR_WORK` says it: a task's, a project's coordinator's, or a run of its default branch. */
export const workOf = (work: {
  readonly kind: 'task' | 'coordinator' | 'run'
  readonly projectId: string
  readonly taskId: string | null
}) => (work.taskId === null ? `${work.kind}:${work.projectId}` : `task:${work.taskId}`)

/** What `workOf` said, read back; null for anything else. */
export const workIn = (
  key: string,
): { readonly kind: 'task'; readonly taskId: string } | { readonly kind: 'coordinator' | 'run'; readonly projectId: string } | null => {
  const match = /^(task|coordinator|run):(\S+)$/.exec(key)
  if (match?.[1] === undefined || match[2] === undefined) return null
  return match[1] === 'task' ? { kind: 'task', taskId: match[2] } : { kind: match[1] as 'coordinator' | 'run', projectId: match[2] }
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

/** The processes in the Mac reader's lines (processReader.ts): pid, parent, started, CPU time with its reaped children's, footprint. */
export const listingOfReader = (text: string): Map<number, Listed> => {
  const listed = new Map<number, Listed>()
  for (const line of text.split('\n')) {
    const fields = line.trim().split(' ')
    if (fields.length !== 5 || !fields.every((field) => /^\d+$/.test(field))) continue
    const [pid, parent, started, cpu, memory] = fields.map(Number) as [number, number, number, number, number]
    listed.set(pid, { parent, cpu, memory, started })
  }
  return listed
}

/** Linux's clock ticks a second, as /proc counts CPU time in: 100 on every kernel Althar runs on. */
const TICKS = 100

/**
 * A process from its /proc/<pid>/stat: its parent, when it started after boot
 * in ticks, its CPU time with its reaped children's, and what it has resident
 * in pages of `page` bytes. Null where it isn't one. The name in brackets
 * may hold anything, so the fields are read after its last bracket.
 */
export const listedOfStat = (text: string, page: number): Listed | null => {
  const close = text.lastIndexOf(')')
  if (close < 0) return null
  // From the state, the third field: the parent is the fourth, the CPU times the 14th to 17th, the start the 22nd, resident pages the 24th.
  const fields = text
    .slice(close + 2)
    .trim()
    .split(' ')
  const field = (n: number) => Number(fields[n - 3])
  const [parent, user, system, childUser, childSystem, started, resident] = [4, 14, 15, 16, 17, 22, 24].map(field)
  if ([parent, user, system, childUser, childSystem, started, resident].some((n) => n === undefined || !Number.isFinite(n))) return null
  return {
    parent: parent as number,
    cpu: (((user as number) + (system as number) + (childUser as number) + (childSystem as number)) * 1000) / TICKS,
    memory: (resident as number) * page,
    started: started as number,
  }
}

/** A variable's value in /proc/<pid>/environ's NUL-separated text; null where it isn't set, or holds a space. */
export const valueInEnviron = (text: string, name: string): string | null => {
  for (const entry of text.split('\0'))
    if (entry.startsWith(`${name}=`)) {
      const value = entry.slice(name.length + 1)
      return value === '' || /\s/.test(value) ? null : value
    }
  return null
}

/**
 * The value of `name` in each process of `ps -wwE -o pid=,command=`'s lines,
 * which give a process's environment after its command line. Its last
 * mention is the environment's, but a command line that names it while the
 * environment doesn't is read as setting it: only where the reader can't
 * be built.
 */
export const valuesOfPs = (text: string, name: string): Map<number, string> => {
  const values = new Map<number, string>()
  const pattern = new RegExp(`(?:^|\\s)${name}=(\\S+)`, 'g')
  for (const line of text.split('\n')) {
    const pid = /^\s*(\d+)\s/.exec(line)?.[1]
    if (pid === undefined) continue
    const last = [...line.matchAll(pattern)].at(-1)?.[1]
    if (last !== undefined) values.set(Number(pid), last)
  }
  return values
}

/** The reader's "pid value" lines, for one variable. */
export const valuesOfReader = (text: string): Map<number, string> => {
  const values = new Map<number, string>()
  for (const line of text.split('\n')) {
    const match = /^(\d+) (\S+)$/.exec(line.trim())
    if (match?.[1] !== undefined && match[2] !== undefined) values.set(Number(match[1]), match[2])
  }
  return values
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

/** Whether two listings' processes under one pid are the same process: by when it started where both say, else by its time not falling. */
export const sameProcess = (was: Listed | undefined, now: Listed | undefined): boolean =>
  was !== undefined &&
  now !== undefined &&
  (was.started !== undefined && now.started !== undefined ? was.started === now.started : was.cpu <= now.cpu)

/**
 * Whose work each process is, by pid: everything the processes each piece of
 * work was started as started, for the first that reaches it; then the app's
 * own (`app`, as `ALTHAR`); then whatever is left that carries a piece of work
 * in its environment (`marks`), with everything it started. A process none of
 * these reaches is no one's.
 */
export const ownersOf = (
  listing: ReadonlyMap<number, Listed>,
  roots: ReadonlyArray<{ readonly pid: number; readonly key: string }>,
  app: number | null,
  marks: ReadonlyMap<number, string> = new Map(),
): Map<number, string> => {
  const children = new Map<number, Array<number>>()
  for (const [pid, { parent }] of listing) if (parent !== pid) children.set(parent, [...(children.get(parent) ?? []), pid])
  const owners = new Map<number, string>()
  const claim = (root: number, key: string) => {
    const queue = [root]
    for (let pid = queue.shift(); pid !== undefined; pid = queue.shift()) {
      if (owners.has(pid) || !listing.has(pid)) continue
      owners.set(pid, key)
      queue.push(...(children.get(pid) ?? []))
    }
  }
  for (const { pid, key } of roots) claim(pid, key)
  if (app !== null) claim(app, ALTHAR)
  // Marked processes, those that started first first: each claims what it started, marked or not.
  for (const [pid, key] of [...marks].sort(([a], [b]) => (listing.get(a)?.started ?? a) - (listing.get(b)?.started ?? b)))
    if (!owners.has(pid)) claim(pid, key)
  return owners
}

/** What each piece of work used between two readings. */
export interface Used {
  /** CPU time, in milliseconds. */
  readonly cpu: number
  /** Memory held now, in bytes. */
  readonly memory: number
  readonly processes: number
}

/**
 * What each piece of work used between two listings, by whose each process
 * is now (`ownersOf`): each process's time since the first listing, or all of
 * it for one new since. Where a process's time counts what its reaped
 * children used (`reaped`), one that ended in between has its time added to
 * whichever of its forebears reaped it, the time it had then included, so
 * that time is taken off the forebear's, as it was counted before: what
 * remains is what the ended one used since, and what anything that started
 * and ended in between used, all of it. A process reaped by one that isn't
 * any work's, as an orphan is, takes the end of its time with it; one whose
 * parent ended before it, while the grandparent reaped the parent, is taken
 * off once too often, so a piece of work's time never falls below none.
 */
export const usedOf = (
  owners: ReadonlyMap<number, string>,
  before: ReadonlyMap<number, Listed>,
  after: ReadonlyMap<number, Listed>,
  reaped: boolean,
): Map<string, Used> => {
  const used = new Map<string, { cpu: number; memory: number; processes: number }>()
  for (const [pid, key] of owners) {
    const now = after.get(pid)
    if (now === undefined) continue
    const was = before.get(pid)
    const its = used.get(key) ?? { cpu: 0, memory: 0, processes: 0 }
    its.cpu += sameProcess(was, now) ? now.cpu - (was as Listed).cpu : now.cpu
    its.memory += now.memory
    its.processes += 1
    used.set(key, its)
  }
  if (reaped)
    for (const [pid, was] of before) {
      if (sameProcess(was, after.get(pid))) continue
      // Its nearest forebear still running, through any that ended with it.
      let forebear = was.parent
      for (let steps = 0; steps < 64 && !sameProcess(before.get(forebear), after.get(forebear)); steps += 1) {
        const up = before.get(forebear)
        if (up === undefined || up.parent === forebear) break
        forebear = up.parent
      }
      const key = sameProcess(before.get(forebear), after.get(forebear)) ? owners.get(forebear) : undefined
      const its = key === undefined ? undefined : used.get(key)
      if (its !== undefined) its.cpu -= was.cpu
    }
  return new Map([...used].map(([key, its]) => [key, { ...its, cpu: Math.max(0, its.cpu) }]))
}

/** What a command printed, or null where it couldn't run or failed; `failing`, what it printed all the same, as `ps -p` fails for a pid gone. */
const output = (command: string, args: ReadonlyArray<string>, failing = false): Effect.Effect<string | null> =>
  Effect.callback<string | null>((resume) => {
    try {
      execFile(command, [...args], { timeout: 5_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
        resume(Effect.succeed(error === null || (failing && typeof error.code === 'number') ? stdout : null))
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

let pageSize: number | undefined

/** Every process in /proc, read at once; null where there is no /proc. */
const procListing = Effect.gen(function* () {
  pageSize ??= Number((yield* output('getconf', ['PAGESIZE']))?.trim()) || 4096
  const page = pageSize
  return yield* Effect.promise(async () => {
    const names = await readdir('/proc').catch(() => null)
    if (names === null) return null
    const listed = new Map<number, Listed>()
    await Promise.all(
      names
        .filter((name) => /^\d+$/.test(name))
        .map(async (name) => {
          // One that has ended since the folder was read is left out.
          const text = await readFile(`/proc/${name}/stat`, 'utf8').catch(() => null)
          const one = text === null ? null : listedOfStat(text, page)
          if (one !== null) listed.set(Number(name), one)
        }),
    )
    return listed
  })
})

/** Every process, and whether its time counts its reaped children's: the Mac reader's where it is built, /proc on Linux, `ps` otherwise. */
const processesOn = (platform: NodeJS.Platform): Effect.Effect<Pick<Reading, 'processes' | 'reaped'>> =>
  Effect.gen(function* () {
    if (platform === 'linux') {
      const listed = yield* procListing
      if (listed !== null && listed.size > 0) return { processes: listed, reaped: true }
    }
    const reader = platform === 'darwin' ? processReader() : null
    if (reader !== null) {
      const text = yield* Effect.promise(() => runReader(reader))
      if (text !== null) return { processes: listingOfReader(text), reaped: true }
    }
    if (platform !== 'darwin' && platform !== 'linux') return { processes: null, reaped: false }
    const text = yield* output('ps', ['-A', '-o', 'pid=,ppid=,time=,rss='])
    return { processes: text === null ? null : listingOf(text), reaped: false }
  })

/** Every process as it is now, by its pid; null where they can't be listed, as on Windows. */
export const listProcesses = (platform: NodeJS.Platform = process.platform): Effect.Effect<ReadonlyMap<number, Listed> | null> =>
  Effect.map(processesOn(platform), (listed) => listed.processes)

/** This computer as it is now. */
export const readMachine = (platform: NodeJS.Platform = process.platform): Effect.Effect<Reading> =>
  Effect.gen(function* () {
    const at = yield* Clock.currentTimeMillis
    const cores = coresOf(cpus())
    const [memory, level, listing] = yield* Effect.all(
      [
        memoryOn(platform),
        platform === 'darwin' ? output('sysctl', ['-n', 'kern.memorystatus_vm_pressure_level']) : Effect.succeed(null),
        processesOn(platform),
      ],
      { concurrency: 'unbounded' },
    )
    return { at, cores, memory, pressure: level === null ? null : pressureOf(level), ...listing }
  })

/** How many pids go to one reading of their environments: a command line has room for them. */
const BATCH = 500

/**
 * Whose work each of `pids` carries in its environment (`ALTHAR_WORK`), by
 * pid, for those that carry one: from /proc on Linux, from the reader on a
 * Mac where it is built, from `ps` otherwise.
 */
export const marksOf =
  (platform: NodeJS.Platform = process.platform) =>
  (pids: ReadonlyArray<number>): Effect.Effect<ReadonlyMap<number, string>> =>
    Effect.gen(function* () {
      if (pids.length === 0) return new Map()
      if (platform === 'linux')
        return yield* Effect.promise(async () => {
          const values = new Map<number, string>()
          await Promise.all(
            pids.map(async (pid) => {
              const text = await readFile(`/proc/${pid}/environ`, 'latin1').catch(() => null)
              const value = text === null ? null : valueInEnviron(text, WORK)
              if (value !== null) values.set(pid, value)
            }),
          )
          return values
        })
      if (platform !== 'darwin') return new Map()
      const reader = processReader()
      const values = new Map<number, string>()
      for (let from = 0; from < pids.length; from += BATCH) {
        const batch = pids.slice(from, from + BATCH).map(String)
        if (reader !== null) {
          const text = yield* Effect.promise(() => runReader(reader, [WORK, ...batch]))
          for (const [pid, value] of valuesOfReader(text ?? '')) values.set(pid, value)
        } else {
          const text = yield* output('ps', ['-wwE', '-o', 'pid=,command=', '-p', batch.join(',')], true)
          for (const [pid, value] of valuesOfPs(text ?? '', WORK)) values.set(pid, value)
        }
      }
      return values
    })
