import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { cpus, setPriority, tmpdir } from 'node:os'
import { join } from 'node:path'
import { monitorEventLoopDelay } from 'node:perf_hooks'

import { BACKGROUND } from '@althar/provider-adapters'
import { describe, expect, it } from 'vitest'

import { repository } from '../support'

/*
 * What running agents' work in the background buys Althar and costs the
 * agents, run by hand on this computer (vite.real.config.ts), never in CI,
 * outside a sandbox, where priorities can be set. A stand-in for agents'
 * builds keeps every core busy and two writers sync the disk, as it runs
 * today, then at each way of running it lower; meanwhile this process
 * measures what the runtime feels: how late its loop runs, how long thirty
 * git commands take one after another, and a fixed piece of its own work.
 * Then a build alone, at each priority, says what it costs a build where
 * nothing else is at work.
 */

const file = join(import.meta.dirname, '../../test-results/responsiveness-run.json')
const kept: Readonly<Record<string, string>> = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>) : {}
const runs = (kept.ALTHAR_RUN ?? process.env.ALTHAR_RUN ?? 'responsiveness') === 'priority'
const SECONDS = Number(kept.ALTHAR_SECONDS ?? 12)

type Way = 'normal' | 'nice' | 'utility' | 'background'

/** A process of the stand-in build, started the way named: as it is today, at niceness 10, or with macOS's task policy. */
const started = (way: Way, code: string): ChildProcess => {
  const node = [process.execPath, '-e', code]
  const child =
    way === 'utility'
      ? spawn('taskpolicy', ['-c', 'utility', ...node], { stdio: 'ignore' })
      : way === 'background'
        ? spawn('taskpolicy', ['-b', ...node], { stdio: 'ignore' })
        : spawn(node[0] ?? '', node.slice(1), { stdio: 'ignore' })
  if (way === 'nice' && child.pid !== undefined) setPriority(child.pid, BACKGROUND)
  return child
}

const SPIN = 'let x = 0; for (;;) { x = (x * 31 + 7) % 1000003 }'
const disk = (path: string) => `
  const fs = require('node:fs'); const chunk = Buffer.alloc(4 * 1024 * 1024, 7)
  for (;;) { const fd = fs.openSync(${JSON.stringify(path)}, 'w'); for (let i = 0; i < 8; i += 1) fs.writeSync(fd, chunk); fs.fsyncSync(fd); fs.closeSync(fd) }`

/** The runtime's side, for `seconds`: its loop's lateness, thirty git commands in a row, again and again, and a fixed piece of work. */
const felt = async (seconds: number, cwd: string) => {
  const histogram = monitorEventLoopDelay({ resolution: 10 })
  histogram.enable()
  const gits: Array<number> = []
  const works: Array<number> = []
  const until = performance.now() + seconds * 1000
  while (performance.now() < until) {
    const began = performance.now()
    for (let index = 0; index < 30; index += 1)
      await new Promise((resolve) => spawn('git', ['rev-parse', 'HEAD'], { cwd, stdio: 'ignore' }).once('close', resolve))
    gits.push(performance.now() - began)
    const working = performance.now()
    const big = Array.from({ length: 50_000 }, (_, index) => ({ index, name: `item ${index}`, tags: ['a', 'b', 'c'] }))
    JSON.parse(JSON.stringify(big))
    works.push(performance.now() - working)
    await new Promise((resolve) => setImmediate(resolve))
  }
  histogram.disable()
  const p = (times: ReadonlyArray<number>, share: number) =>
    Math.round([...times].sort((a, b) => a - b)[Math.floor(share * (times.length - 1))] ?? 0)
  return {
    loopP99: Math.round(histogram.percentile(99) / 1e6),
    loopMax: Math.round(histogram.max / 1e6),
    git30: { p50: p(gits, 0.5), p95: p(gits, 0.95) },
    work: { p50: p(works, 0.5), p95: p(works, 0.95) },
  }
}

/** A build alone, the way named: a fixed piece of CPU work on as many processes as cores, timed to its end. */
const build = async (way: Way) => {
  const began = performance.now()
  const code = 'let x = 0; for (let i = 0; i < 4e8; i += 1) { x = (x * 31 + 7) % 1000003 }'
  await Promise.all(Array.from({ length: cpus().length }, () => new Promise((resolve) => started(way, code).once('close', resolve))))
  return Math.round(performance.now() - began)
}

describe.runIf(runs)('agents in the background', () => {
  it('leave the runtime the computer while they build, and cost a build alone little', async () => {
    const cwd = repository()
    const folder = mkdtempSync(join(tmpdir(), 'althar-priority-'))
    const results: Record<string, unknown> = { quiet: await felt(SECONDS, cwd) }
    for (const way of ['normal', 'nice', 'utility', 'background'] as const) {
      const children = [
        ...Array.from({ length: cpus().length }, () => started(way, SPIN)),
        ...[0, 1].map((index) => started(way, disk(join(folder, `disk-${way}-${index}`)))),
      ]
      await new Promise((resolve) => setTimeout(resolve, 1500))
      results[way] = await felt(SECONDS, cwd)
      for (const child of children) child.kill('SIGKILL')
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
    const alone: Record<string, number> = {}
    for (const way of ['normal', 'nice', 'utility', 'background'] as const) alone[way] = await build(way)
    results.buildAlone = alone
    rmSync(folder, { recursive: true, force: true })
    writeFileSync(join(import.meta.dirname, '../../test-results/priority-probe.json'), JSON.stringify(results, null, 2))
    expect(execFileSync('git', ['rev-parse', 'HEAD'], { cwd }).toString().trim()).toMatch(/^[0-9a-f]{40}$/)
  })
})
