import childProcess, { type ChildProcess, spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { Session } from 'node:inspector/promises'
import { cpus, setPriority, tmpdir } from 'node:os'
import { join } from 'node:path'
import { monitorEventLoopDelay } from 'node:perf_hooks'

import { BACKGROUND } from '@althar/provider-adapters'
import { Tracer } from 'effect'

/*
 * What the responsiveness run (responsiveness.test.ts) loads the computer
 * with and reads off the runtime: agents' builds stood in for by processes
 * that keep every core busy and others that write to the disk and sync it,
 * at the priority a test names; how late the event loop runs; the spans the
 * runtime's statements and steps make, by name; and a CPU profile of it all.
 * Run by hand, never in CI: it takes the computer for minutes.
 */

/** How agents' processes run: at the priority they're given today, or in the background, as Althar starts them now. */
export type Priority = 'normal' | 'background'

/** A load on the computer, as agents' builds and tests put on it: every core busy, and the disk written to and synced. */
export const stress = (priority: Priority, cores = cpus().length, disks = 2) => {
  const folder = mkdtempSync(join(tmpdir(), 'althar-stress-'))
  const children: Array<ChildProcess> = []
  const start = (code: string) => {
    const child = spawn(process.execPath, ['-e', code], { stdio: 'ignore' })
    // A build's processes in the background, as Althar starts agents and what they start now.
    if (priority === 'background' && child.pid !== undefined) setBackground(child.pid)
    children.push(child)
  }
  for (let index = 0; index < cores; index += 1) start('let x = 0; for (;;) { x = (x * 31 + 7) % 1000003 }')
  for (let index = 0; index < disks; index += 1)
    start(`
      const fs = require('node:fs')
      const file = ${JSON.stringify(join(folder, `disk-${index}`))}
      const chunk = Buffer.alloc(4 * 1024 * 1024, 7)
      for (;;) { const fd = fs.openSync(file, 'w'); for (let i = 0; i < 8; i += 1) fs.writeSync(fd, chunk); fs.fsyncSync(fd); fs.closeSync(fd); fs.rmSync(file) }
    `)
  return {
    stop: () => {
      for (const child of children) child.kill('SIGKILL')
      rmSync(folder, { recursive: true, force: true })
    },
  }
}

/** Puts a process in the background, as Althar starts agents (provider-adapters' process.ts). */
const setBackground = (pid: number) => setPriority(pid, BACKGROUND)

/** How late the event loop ran, while it was watched: its mean, p50, p99 and worst, in milliseconds. */
export const lag = () => {
  const histogram = monitorEventLoopDelay({ resolution: 10 })
  histogram.enable()
  return {
    read: () => {
      histogram.disable()
      const ms = (ns: number) => Math.round(ns / 1e5) / 10
      return {
        mean: ms(histogram.mean),
        p50: ms(histogram.percentile(50)),
        p99: ms(histogram.percentile(99)),
        max: ms(histogram.max),
      }
    },
  }
}

/** Every span the runtime makes, timed, by name: a statement by its text, and what each statement or step costs in all. */
export const spans = () => {
  const ended: Array<{ name: string; ms: number }> = []
  const children = new Map<string, Array<{ name: string; ms: number }>>()
  const long: Array<{ ms: number; inside: Array<{ name: string; ms: number }> }> = []
  const tracer = Tracer.make({
    span(options) {
      const span = new Tracer.NativeSpan(options)
      const end = span.end.bind(span)
      const parent = options.parent._tag === 'Some' ? options.parent.value.spanId : undefined
      span.end = (endTime, exit) => {
        end(endTime, exit)
        const text = span.attributes.get('db.query.text')
        const name = typeof text === 'string' ? `sql: ${text.replace(/\s+/g, ' ').slice(0, 140)}` : span.name
        const ms = Number(endTime - span.startTime) / 1e6
        ended.push({ name, ms })
        if (parent !== undefined) {
          const of = children.get(parent) ?? []
          if (of.length < 40) of.push({ name: name.slice(0, 100), ms: Math.round(ms) })
          children.set(parent, of)
        }
        if (span.name === 'sql.transaction' && ms > 300) long.push({ ms: Math.round(ms), inside: children.get(span.spanId) ?? [] })
        children.delete(span.spanId)
      }
      return span
    },
  })
  return {
    tracer,
    clear: () => {
      ended.splice(0)
      long.splice(0)
    },
    long: () => long.toSorted((a, b) => b.ms - a.ms).slice(0, 8),
    top: (count = 25) => {
      const by = new Map<string, { n: number; total: number; max: number }>()
      for (const one of ended) {
        const was = by.get(one.name) ?? { n: 0, total: 0, max: 0 }
        by.set(one.name, { n: was.n + 1, total: was.total + one.ms, max: Math.max(was.max, one.ms) })
      }
      return [...by.entries()]
        .sort(([, a], [, b]) => b.total - a.total)
        .slice(0, count)
        .map(([name, { n, total, max }]) => ({
          name,
          n,
          total: Math.round(total),
          mean: Math.round((total / n) * 10) / 10,
          max: Math.round(max),
        }))
    },
  }
}

/** A CPU profile of this process while it runs, and its costliest functions by their own time. */
export const profiled = async () => {
  const session = new Session()
  session.connect()
  await session.post('Profiler.enable')
  await session.post('Profiler.setSamplingInterval', { interval: 500 })
  await session.post('Profiler.start')
  // Where the profile's clock starts, on the clock stalls are read by: the two count from different points.
  const startedAt = Number(process.hrtime.bigint() / 1000n)
  return {
    stop: async () => {
      const { profile } = await session.post('Profiler.stop')
      session.disconnect()
      const self = new Map<string, number>()
      const interval = (profile.endTime - profile.startTime) / Math.max(1, profile.samples?.length ?? 1)
      const byId = new Map(profile.nodes.map((node) => [node.id, node]))
      const hits = new Map<number, number>()
      for (const sample of profile.samples ?? []) hits.set(sample, (hits.get(sample) ?? 0) + 1)
      for (const [id, count] of hits) {
        const node = byId.get(id)
        if (node === undefined) continue
        const { functionName, url, lineNumber } = node.callFrame
        const file = url.replace(/^.*\/(packages|node_modules)\//, '$1/')
        const key = `${functionName || '(anonymous)'} ${file}:${lineNumber + 1}`
        self.set(key, (self.get(key) ?? 0) + count * interval)
      }
      const top = [...self.entries()]
        .sort(([, a], [, b]) => b - a)
        .slice(0, 30)
        .map(([name, us]) => ({ name, ms: Math.round(us / 1000) }))
      return { profile: { ...profile, startedAt }, top }
    },
  }
}

/** p50, p95 and worst of some timings, in milliseconds. */
export const summary = (times: ReadonlyArray<number>) => {
  const sorted = [...times].sort((a, b) => a - b)
  const at = (share: number) => sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))] ?? 0
  return { n: sorted.length, p50: Math.round(at(0.5)), p95: Math.round(at(0.95)), max: Math.round(sorted.at(-1) ?? 0) }
}

/** Every process this thread starts, by its command and first words: how many, how long starting it held the loop, and who. */
export const spawns = () => {
  const by = new Map<string, { n: number; blocked: number; ran: number; from: string }>()
  const prototype = childProcess.ChildProcess.prototype as unknown as {
    spawn: (options: { file: string; args: ReadonlyArray<string> }) => unknown
  }
  const original = prototype.spawn
  prototype.spawn = function (this: ChildProcess, options) {
    const words = options.args.slice(1).filter((word) => !word.startsWith('-c') && word !== 'core.hooksPath=/dev/null')
    const key = `${options.file.split('/').at(-1)} ${words.slice(0, 2).join(' ')}`.slice(0, 60)
    const from = (new Error().stack ?? '').split('\n').find((line) => line.includes('/packages/') && !line.includes('load.ts')) ?? ''
    const began = performance.now()
    const result = original.call(this, options)
    const blocked = performance.now() - began
    const was = by.get(key) ?? {
      n: 0,
      blocked: 0,
      ran: 0,
      from: from
        .trim()
        .replace(/^.*\/packages\//, '')
        .slice(0, 80),
    }
    was.n += 1
    was.blocked += blocked
    by.set(key, was)
    this.once('close', () => {
      was.ran += performance.now() - began
    })
    return result
  }
  return {
    clear: () => by.clear(),
    top: (count = 25) =>
      [...by.entries()]
        .sort(([, a], [, b]) => b.blocked - a.blocked)
        .slice(0, count)
        .map(([name, { n, blocked, ran, from }]) => ({
          name,
          n,
          blocked: Math.round(blocked),
          blockedEach: Math.round((blocked / n) * 10) / 10,
          ranEach: Math.round(ran / n),
          from,
        })),
  }
}

/** Where the loop stood still: every gap of more than `over` ms between ticks of a 10 ms timer, by the monotonic clock in µs. */
export const stalls = (over = 300) => {
  const windows: Array<{ readonly from: number; readonly to: number }> = []
  let last = process.hrtime.bigint()
  // oxlint-disable-next-line althar/one-clock -- the loop's own ticks are what it measures
  const tick = setInterval(() => {
    const now = process.hrtime.bigint()
    if (now - last > BigInt(over) * 1_000_000n) windows.push({ from: Number(last / 1000n), to: Number(now / 1000n) })
    last = now
  }, 10)
  return {
    windows: () => windows.map((one) => ({ ...one, ms: Math.round((one.to - one.from) / 1000) })),
    stop: () => clearInterval(tick),
  }
}

/** What the profile was doing while the loop stood still: each stack's own frames, nearest the runtime's code first, by time. */
export const stalledOn = (
  profile: {
    nodes: Array<{ id: number; callFrame: { functionName: string; url: string; lineNumber: number } }>
    startTime: number
    startedAt: number
    samples?: Array<number> | undefined
    timeDeltas?: Array<number> | undefined
  },
  windows: ReadonlyArray<{ readonly from: number; readonly to: number }>,
) => {
  const byId = new Map(profile.nodes.map((node) => [node.id, node]))
  const parents = new Map<number, number>()
  for (const node of profile.nodes as Array<{ id: number; children?: Array<number> }>)
    for (const child of node.children ?? []) parents.set(child, node.id)
  const by = new Map<string, number>()
  let at = profile.startedAt
  const samples = profile.samples ?? []
  const deltas = profile.timeDeltas ?? []
  for (let index = 0; index < samples.length; index += 1) {
    at += deltas[index] ?? 0
    if (!windows.some((one) => at >= one.from && at <= one.to)) continue
    const frames: Array<string> = []
    for (let id: number | undefined = samples[index]; id !== undefined && frames.length < 40; id = parents.get(id)) {
      const node = byId.get(id)
      if (node === undefined) break
      const { functionName, url, lineNumber } = node.callFrame
      if (url.includes('/packages/') && !url.includes('node_modules'))
        frames.push(`${functionName || '(anonymous)'} ${url.replace(/^.*\/packages\//, '')}:${lineNumber + 1}`)
    }
    const leaf = byId.get(samples[index] ?? -1)?.callFrame
    const key = `${leaf?.functionName || '(anonymous)'} <- ${frames.slice(0, 4).join(' <- ')}`
    by.set(key, (by.get(key) ?? 0) + (deltas[index] ?? 0))
  }
  return [...by.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 15)
    .map(([stack, us]) => ({ stack: stack.slice(0, 400), ms: Math.round(us / 1000) }))
}
