import { Brand } from '../../foundations/brands/brands'
import { MemoryPressure, ThermalState, type Usage, type UsagePoint, type UsageShare } from './usage'

/*
 * A 32 GB MacBook Pro on a Tuesday afternoon, while Meridian's work runs
 * beside Halyard's and Tessera's. Every number is made up, and the same on
 * every run.
 */

/** The last two minutes, one sample every three seconds. */
export const SAMPLES = 40

const clamp = (n: number) => Math.min(1, Math.max(0, n))
const smooth = (t: number) => t * t * (3 - 2 * t)
/* a little grain, so a quiet line still looks measured: -1 to 1 */
const grain = (i: number) => Math.sin(i * 1.7) * 0.5 + Math.sin(i * 0.43 + 1) * 0.5

/** A history that holds near `from`, turns towards `to` after `turn` of the way, and ends exactly on it. */
function history(from: UsagePoint, to: UsagePoint, turn = 0.6, wobble = 0.04): UsagePoint[] {
  return Array.from({ length: SAMPLES }, (_, i) => {
    if (i === SAMPLES - 1) return to
    const t = i / (SAMPLES - 1)
    const k = t <= turn ? 0 : smooth((t - turn) / (1 - turn))
    const w = grain(i) * wobble
    const cpu = clamp(from.cpu + (to.cpu - from.cpu) * k + w)
    return { cpu, althar: Math.min(cpu, clamp(from.althar + (to.althar - from.althar) * k + w * 0.8)) }
  })
}

const share = (id: string, title: string, project: string, cpu: number, memory: string, processes: number, codex = false): UsageShare => ({
  id,
  title,
  project,
  agent: codex ? 'Codex' : 'Claude Code',
  mark: codex ? Brand.Codex : Brand.ClaudeCode,
  cpu,
  memory,
  processes,
})

const at = (cpu: number, althar: number): UsagePoint => ({ cpu, althar })

const calm = { pressure: MemoryPressure.Normal, thermal: ThermalState.Nominal, memoryTotal: '32 GB' } as const

/** No task runs: the Mac on its own. */
export const NOTHING_RUNNING: Usage = {
  ...calm,
  cpu: 0.05,
  althar: 0,
  memory: 0.38,
  altharMemory: 0,
  memoryUsed: '12.2 GB',
  shares: [],
  history: history(at(0.06, 0), at(0.05, 0), 1, 0.02),
}

/** One task runs, and its lead is waiting on the model: an agent thinking barely touches the CPU. */
export const IDLE: Usage = {
  ...calm,
  cpu: 0.07,
  althar: 0.02,
  memory: 0.42,
  altharMemory: 0.03,
  memoryUsed: '13.4 GB',
  shares: [share('418', 'Repair token refresh on privilege change', 'Meridian', 0.02, '0.9 GB', 3)],
  history: history(at(0.08, 0.02), at(0.07, 0.02), 1, 0.025),
}

/** One task, whose lead started the test suite a minute ago. */
export const ONE_AGENT: Usage = {
  ...calm,
  cpu: 0.34,
  althar: 0.27,
  memory: 0.47,
  altharMemory: 0.07,
  memoryUsed: '15.0 GB',
  shares: [share('418', 'Repair token refresh on privilege change', 'Meridian', 0.27, '2.1 GB', 14)],
  history: history(at(0.08, 0.02), at(0.34, 0.27), 0.5),
}

/** Four tasks across two projects: a build, a test run, and two leads reading code. */
export const BUSY: Usage = {
  ...calm,
  thermal: ThermalState.Fair,
  cpu: 0.63,
  althar: 0.51,
  memory: 0.61,
  altharMemory: 0.18,
  memoryUsed: '19.5 GB',
  shares: [
    share('419', 'Migrate billing webhooks to the v2 endpoint', 'Meridian', 0.22, '2.8 GB', 18),
    share('418', 'Repair token refresh on privilege change', 'Meridian', 0.14, '2.1 GB', 14),
    share('h12', 'Cache upstream health checks', 'Halyard', 0.1, '1.2 GB', 9, true),
    share('424', 'Find a shape for webhook queue sharding', 'Meridian', 0.05, '0.8 GB', 4),
  ],
  history: history(at(0.3, 0.2), at(0.63, 0.51), 0.35, 0.06),
}

/** Five tasks, two of them running integration suites: every core busy, memory tight, and the Mac warm enough to slow itself. */
export const NEAR_MAX: Usage = {
  pressure: MemoryPressure.Warning,
  thermal: ThermalState.Serious,
  memoryTotal: '32 GB',
  cpu: 0.96,
  althar: 0.82,
  memory: 0.91,
  altharMemory: 0.46,
  memoryUsed: '29.1 GB',
  shares: [
    share('419', 'Migrate billing webhooks to the v2 endpoint', 'Meridian', 0.31, '6.4 GB', 31),
    share('418', 'Repair token refresh on privilege change', 'Meridian', 0.21, '3.9 GB', 22),
    share('h12', 'Cache upstream health checks', 'Halyard', 0.14, '2.2 GB', 12, true),
    share('t7', 'Name the limits better', 'Tessera', 0.11, '1.6 GB', 9, true),
    share('424', 'Find a shape for webhook queue sharding', 'Meridian', 0.05, '0.9 GB', 4),
  ],
  history: history(at(0.62, 0.5), at(0.96, 0.82), 0.25, 0.05),
}

/** Busy, with memory the one thing short: the strain each direction says in words. */
export const MEMORY_TIGHT: Usage = {
  ...BUSY,
  pressure: MemoryPressure.Warning,
  thermal: ThermalState.Nominal,
  memory: 0.88,
  altharMemory: 0.41,
  memoryUsed: '28.2 GB',
}

/*
 * The live loop: leads thinking, a build, a test suite that fills the Mac
 * for a while, then quiet again. Three minutes at a sample every two
 * seconds, round and round.
 */
const LOOP: UsagePoint[] = Array.from({ length: 90 }, (_, i) => {
  const t = i / 90
  const build = Math.exp(-(((t - 0.28) / 0.06) ** 2)) * 0.38
  const suite = t > 0.45 && t < 0.78 ? 0.55 + grain(i) * 0.12 : 0
  const thinking = 0.04 + grain(i * 3) * 0.02
  const althar = clamp(thinking + build + suite)
  return { cpu: clamp(althar + 0.1 + grain(i + 7) * 0.04), althar }
})

/** Where the live loop stands at tick `n`: BUSY's tasks, scaled to the moment. */
export function liveAt(n: number): Usage {
  const now = LOOP[n % LOOP.length] ?? at(0, 0)
  const scale = BUSY.althar > 0 ? now.althar / BUSY.althar : 0
  const hot = now.cpu > 0.85
  return {
    ...BUSY,
    cpu: now.cpu,
    althar: now.althar,
    memory: 0.5 + now.althar * 0.3,
    altharMemory: 0.1 + now.althar * 0.25,
    memoryUsed: `${(32 * (0.5 + now.althar * 0.3)).toFixed(1)} GB`,
    thermal: hot ? ThermalState.Serious : ThermalState.Fair,
    shares: BUSY.shares.map((s) => ({ ...s, cpu: s.cpu * scale })),
    history: Array.from({ length: SAMPLES }, (_, i) => LOOP[(n - SAMPLES + 1 + i + LOOP.length * 10) % LOOP.length] ?? at(0, 0)),
  }
}
