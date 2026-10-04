import { execFile } from 'node:child_process'

import { Effect } from 'effect'

/*
 * How much CPU an agent and everything it started have used: the sign of life
 * a turn shows while nothing it says reaches Althar, such as a long build or
 * a test run (Stalls.ts). Read from `ps`, which macOS and Linux both have.
 */

/** `ps`'s CPU time, `[[dd-]hh:]mm:ss[.cc]`, in milliseconds. */
export const cpuTimeOf = (text: string): number | null => {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(text.trim())
  if (match === null) return null
  const [, days, hours, minutes, seconds] = match
  return Math.round(((Number(days ?? 0) * 24 + Number(hours ?? 0)) * 60 * 60 + Number(minutes) * 60 + Number(seconds)) * 1000)
}

/** The CPU time of `pid` and its descendants, from `ps -A -o pid=,ppid=,time=`'s lines; null where `pid` isn't among them. */
export const treeCpuOf = (listing: string, pid: number): number | null => {
  const children = new Map<number, Array<number>>()
  const cpu = new Map<number, number>()
  for (const line of listing.split('\n')) {
    const [own, parent, time] = line.trim().split(/\s+/)
    const ms = cpuTimeOf(time ?? '')
    if (own === undefined || parent === undefined || ms === null) continue
    cpu.set(Number(own), ms)
    children.set(Number(parent), [...(children.get(Number(parent)) ?? []), Number(own)])
  }
  if (!cpu.has(pid)) return null
  let total = 0
  const seen = new Set<number>()
  const queue = [pid]
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    if (seen.has(next)) continue
    seen.add(next)
    total += cpu.get(next) ?? 0
    queue.push(...(children.get(next) ?? []))
  }
  return total
}

/**
 * The CPU time each of `pids` and everything it started have used, in
 * milliseconds, or null once it's gone or `ps` can't say: from one listing,
 * however many there are.
 */
export const treeCpus = (pids: ReadonlyArray<number>): Effect.Effect<ReadonlyMap<number, number | null>> =>
  Effect.callback<ReadonlyMap<number, number | null>>((resume) => {
    if (pids.length === 0) return resume(Effect.succeed(new Map()))
    execFile('ps', ['-A', '-o', 'pid=,ppid=,time='], { timeout: 10_000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
      resume(Effect.succeed(new Map(pids.map((pid) => [pid, error === null ? treeCpuOf(stdout, pid) : null]))))
    })
  })
