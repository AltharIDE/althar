import childProcess, { type ChildProcess, spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { Session } from 'node:inspector/promises'
import { cpus, setPriority, tmpdir } from 'node:os'
import { join } from 'node:path'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { Worker } from 'node:worker_threads'

import { Tracer } from 'effect'

/*
 * What the responsiveness run (responsiveness.test.ts) loads the computer
 * with and reads off the runtime: agents' builds stood in for by processes
 * that keep every core busy and others that write to the disk and sync it,
 * at the priority a test names; how late the event loop runs; the spans the
 * runtime's statements and steps make, by name; the processes it starts, on
 * its own thread and on the runner's; and a CPU profile of it all.
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

/** Puts a process in the background, as Althar starts agents (provider-adapters' process.ts, `BACKGROUND`): niceness 10. */
const setBackground = (pid: number) => setPriority(pid, 10)

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

/**
 * Every span the runtime makes, timed, by name: a statement by its text, and what each statement or step costs in all.
 * Counted as they end, so a run of minutes holds only one line for each name. A span that isn't a statement and whose
 * name matches `kept` keeps each of its times too, for the steps a later commit may name (the card watcher's rounds).
 */
export const spans = (kept = /card|round/i) => {
  const by = new Map<string, { n: number; total: number; max: number }>()
  const times = new Map<string, Array<number>>()
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
        // A card worked out says whether it was kept, and why not (Queries.ts).
        const wasKept = span.attributes.get('kept')
        const name =
          typeof text === 'string'
            ? `sql: ${text.replace(/\s+/g, ' ').slice(0, 140)}`
            : wasKept === undefined
              ? span.name
              : `${span.name}: ${wasKept === true ? 'kept' : `not kept, ${String(span.attributes.get('unsure'))}`}`
        const ms = Number(endTime - span.startTime) / 1e6
        const was = by.get(name) ?? { n: 0, total: 0, max: 0 }
        by.set(name, { n: was.n + 1, total: was.total + ms, max: Math.max(was.max, ms) })
        if (typeof text !== 'string' && kept.test(name)) {
          const of = times.get(name) ?? []
          of.push(ms)
          times.set(name, of)
        }
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
  /** The spans by name, `matching` where given. */
  const lines = (matching?: RegExp) => [...by.entries()].filter(([name]) => matching === undefined || matching.test(name))
  return {
    tracer,
    clear: () => {
      by.clear()
      times.clear()
      long.splice(0)
    },
    long: () => long.toSorted((a, b) => b.ms - a.ms).slice(0, 8),
    /** How many ended, and what they took in all, of those `matching`: statements are `sql: …`. */
    count: (matching?: RegExp) =>
      lines(matching).reduce((sum, [, one]) => ({ n: sum.n + one.n, ms: Math.round(sum.ms + one.total) }), { n: 0, ms: 0 }),
    /** The times of each span kept by name (`kept`), named by the runtime rather than a statement. */
    named: () => Object.fromEntries(times),
    top: (count = 25, matching?: RegExp) =>
      lines(matching)
        .sort(([, a], [, b]) => b.total - a.total)
        .slice(0, count)
        .map(([name, { n, total, max }]) => ({
          name,
          n,
          total: Math.round(total),
          mean: Math.round((total / n) * 10) / 10,
          max: Math.round(max),
        })),
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

/**
 * Every process the runtime starts, by its command and first words: on this thread, how many, how long starting each
 * held the loop, and who; and on the runner thread (spawner.ts), where the runtime's own commands start, how many and
 * how long each ran, read off what this thread asks of the runner.
 */
export const spawns = () => {
  const by = new Map<string, { n: number; blocked: number; ran: number; from: string; apart: boolean }>()
  const keyOf = (file: string, args: ReadonlyArray<string>) => {
    const words = args.filter((word) => !word.startsWith('-') && !word.includes('=') && !word.startsWith('/'))
    return `${file.split('/').at(-1)} ${words.slice(0, 2).join(' ')}`.slice(0, 60)
  }
  const prototype = childProcess.ChildProcess.prototype as unknown as {
    spawn: (options: { file: string; args: ReadonlyArray<string> }) => unknown
  }
  const original = prototype.spawn
  prototype.spawn = function (this: ChildProcess, options) {
    const key = keyOf(options.file, options.args.slice(1))
    const from = (new Error().stack ?? '').split('\n').find((line) => line.includes('/packages/') && !line.includes('load.ts')) ?? ''
    const began = performance.now()
    const result = original.call(this, options)
    const blocked = performance.now() - began
    const was = by.get(key) ?? {
      n: 0,
      blocked: 0,
      ran: 0,
      apart: false,
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
  // The runner's: each command it is asked to start, by its job's id, until it says the job ended.
  const runners = new WeakSet<Worker>()
  const jobs = new Map<number, { readonly key: string; readonly began: number }>()
  const post = Reflect.get(Worker.prototype, 'postMessage') as (this: Worker, message: unknown, transfer?: never) => void
  Worker.prototype.postMessage = function (this: Worker, message: unknown, transfer?: never) {
    const asked = message as { kind?: string; job?: { id: number; command: string; args: ReadonlyArray<string> } } | null
    const job = asked?.job
    if (asked?.kind === 'start' && job !== undefined) {
      const key = keyOf(job.command, job.args)
      const was = by.get(key) ?? { n: 0, blocked: 0, ran: 0, apart: true, from: 'spawner.ts (its runner)' }
      was.n += 1
      by.set(key, was)
      jobs.set(job.id, { key, began: performance.now() })
      if (!runners.has(this)) {
        runners.add(this)
        this.on('message', (ended: { kind?: string; id?: number } | null) => {
          const one = ended?.kind === 'ended' && ended.id !== undefined ? jobs.get(ended.id) : undefined
          if (one === undefined || ended?.id === undefined) return
          jobs.delete(ended.id)
          const of = by.get(one.key)
          if (of !== undefined) of.ran += performance.now() - one.began
        })
      }
    }
    return post.call(this, message, transfer)
  }
  return {
    clear: () => by.clear(),
    /** How many were started in all, of those whose name matches where given, on either thread. */
    count: (matching?: RegExp) =>
      [...by.entries()].reduce((sum, [name, one]) => sum + (matching === undefined || matching.test(name) ? one.n : 0), 0),
    top: (count = 25) =>
      [...by.entries()]
        .sort(([, a], [, b]) => b.n - a.n || b.blocked - a.blocked)
        .slice(0, count)
        .map(([name, { n, blocked, ran, from, apart }]) => ({
          name,
          n,
          where: apart ? 'runner' : 'here',
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
