import { Duration, Effect } from 'effect'

import { startApart } from './spawner'

/*
 * How much CPU an agent and everything it started have used: the sign of life
 * a turn shows while nothing it says reaches Althar, such as a long build or
 * a test run (Stalls.ts). Read from `ps`, which macOS and Linux both have,
 * started on the runner's thread.
 */

/** `ps`'s CPU time, `[[dd-]hh:]mm:ss[.cc]`, in milliseconds. */
export const cpuTimeOf = (text: string): number | null => {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(text.trim())
  if (match === null) return null
  const [, days, hours, minutes, seconds] = match
  return Math.round(((Number(days ?? 0) * 24 + Number(hours ?? 0)) * 60 * 60 + Number(minutes) * 60 + Number(seconds)) * 1000)
}

/** `ps`'s lines as each process's CPU time and its children. */
const listed = (listing: string) => {
  const children = new Map<number, Array<number>>()
  const cpu = new Map<number, number>()
  for (const line of listing.split('\n')) {
    const [own, parent, time] = line.trim().split(/\s+/)
    const ms = cpuTimeOf(time ?? '')
    if (own === undefined || parent === undefined || ms === null) continue
    cpu.set(Number(own), ms)
    children.set(Number(parent), [...(children.get(Number(parent)) ?? []), Number(own)])
  }
  return { children, cpu }
}

/** The CPU time of `pid` and each of its descendants, by process, from `ps -A -o pid=,ppid=,time=`'s lines; null where `pid` isn't among them. */
export const treeMembersOf = (listing: string, pid: number): ReadonlyMap<number, number> | null => {
  const { children, cpu } = listed(listing)
  if (!cpu.has(pid)) return null
  const members = new Map<number, number>()
  const queue = [pid]
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    if (members.has(next)) continue
    members.set(next, cpu.get(next) ?? 0)
    queue.push(...(children.get(next) ?? []))
  }
  return members
}

/** The CPU time of `pid` and its descendants, from `ps -A -o pid=,ppid=,time=`'s lines; null where `pid` isn't among them. */
export const treeCpuOf = (listing: string, pid: number): number | null => {
  const members = treeMembersOf(listing, pid)
  return members === null ? null : [...members.values()].reduce((sum, ms) => sum + ms, 0)
}

/**
 * Whether a process tree did work between two readings `ms` apart, as far as
 * `ps` shows it. The total of a tree falls when a process in it ends, taking
 * its time with it, so it can't be told by subtracting totals: work is a
 * process that started or ended since, or CPU time rising, process by
 * process, by at least `share` of a core over the time. What `ps` can't show
 * is a worker that started, worked and ended between the two readings: its
 * time is gone with it, and its parent's own time doesn't include it. That
 * work is caught only by a reading that finds the worker alive, so the readings
 * are often (Busy.ts) and a tree counts until none has shown work for a
 * while.
 */
export const workedBetween = (before: ReadonlyMap<number, number>, after: ReadonlyMap<number, number>, ms: number, share: number) => {
  if (before.size !== after.size) return true
  let spent = 0
  for (const [pid, cpu] of after) {
    const was = before.get(pid)
    if (was === undefined) return true
    spent += Math.max(0, cpu - was)
  }
  return spent >= share * ms
}

/** How long `ps` may take before Althar stops waiting for it, and how much of what it prints Althar reads. */
const PS_WAIT = Duration.seconds(10)
const PS_MOST = 8 * 1024 * 1024

/**
 * Every process's id, parent and CPU time, as `ps -A -o pid=,ppid=,time=`
 * lists them, or null where it can't say. It starts on the runner's thread
 * (spawner.ts), never the one that answers the window: Busy.ts reads it
 * every couple of seconds while an agent has left something running, and
 * starting a process holds the thread that starts it.
 */
export const processListing = (start: typeof startApart = startApart): Effect.Effect<string | null> =>
  Effect.suspend(() => {
    const started = start({ command: 'ps', args: ['-A', '-o', 'pid=,ppid=,time='], env: process.env, detached: false, max: PS_MOST })
    return Effect.promise(() => started.result).pipe(
      Effect.map((ended) => (ended.error === null && ended.code === 0 && !ended.over ? ended.stdout : null)),
      Effect.timeoutOrElse({ duration: PS_WAIT, orElse: () => Effect.sync(() => (started.stop(), null)) }),
      Effect.onInterrupt(() => Effect.sync(started.stop)),
    )
  })

/**
 * The CPU time each of `pids` and everything it started have used, in
 * milliseconds, or null once it's gone or `ps` can't say: from one listing,
 * however many there are.
 */
export const treeCpus = (pids: ReadonlyArray<number>, listing = processListing()): Effect.Effect<ReadonlyMap<number, number | null>> =>
  pids.length === 0
    ? Effect.succeed(new Map())
    : Effect.map(listing, (listed) => new Map(pids.map((pid) => [pid, listed === null ? null : treeCpuOf(listed, pid)])))

/**
 * The CPU time of each process in the tree of each of `pids`, by process, or
 * null once it's gone or `ps` can't say: from one listing, however many there are.
 */
export const treeMembers = (
  pids: ReadonlyArray<number>,
  listing = processListing(),
): Effect.Effect<ReadonlyMap<number, ReadonlyMap<number, number> | null>> =>
  pids.length === 0
    ? Effect.succeed(new Map())
    : Effect.map(listing, (listed) => new Map(pids.map((pid) => [pid, listed === null ? null : treeMembersOf(listed, pid)])))
