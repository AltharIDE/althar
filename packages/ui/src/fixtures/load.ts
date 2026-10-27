import type { LoadGlance, LoadPoint, LoadRow } from '../chrome/LoadMeter/load'
import { Brand } from '../foundations/brands/brands'
import { MemoryPressure } from '../foundations/vocabulary'

/*
 * A 32 GB MacBook Pro on a Tuesday afternoon, while Meridian's work runs
 * beside Halyard's and Tessera's: how hard it works, for the load meter.
 * Every number is made up, and the same on every run.
 */

/** Two minutes of readings, one every three seconds. */
export const LOAD_SLOTS = 40

const clamp = (n: number) => Math.min(1, Math.max(0, n))
const smooth = (t: number) => t * t * (3 - 2 * t)
/* a little grain, so a quiet line still looks measured: -1 to 1 */
const grain = (i: number) => Math.sin(i * 1.7) * 0.5 + Math.sin(i * 0.43 + 1) * 0.5

/** Readings that hold near `from`, turn towards `to` after `turn` of the way, and end exactly on it. */
function history(from: LoadPoint, to: LoadPoint, turn = 0.6, wobble = 0.04, length = LOAD_SLOTS): LoadPoint[] {
  return Array.from({ length }, (_, i) => {
    if (i === length - 1) return to
    const t = i / (LOAD_SLOTS - 1)
    const k = t <= turn ? 0 : smooth((t - turn) / (1 - turn))
    const w = grain(i) * wobble
    const cpu = clamp(from.cpu + (to.cpu - from.cpu) * k + w)
    return { cpu, work: Math.min(cpu, clamp(from.work + (to.work - from.work) * k + w * 0.8)) }
  })
}

const row = (id: string, title: string, project: string, cpu: number, memory: string, processes: number, codex = false): LoadRow => ({
  id,
  title,
  project,
  agent: codex ? 'Codex' : 'Claude Code',
  mark: codex ? Brand.Codex : Brand.ClaudeCode,
  cpu,
  memory,
  processes,
})

/** Althar itself: the app, its windows and the runtime. */
const althar = (cpu: number, memory: string, processes: number): LoadRow => ({
  id: 'althar',
  title: 'Althar',
  opens: false,
  cpu,
  memory,
  processes,
})

const at = (cpu: number, work: number): LoadPoint => ({ cpu, work })

const calm = { pressure: MemoryPressure.Normal, memoryTotal: '32 GB' } as const

/** Nothing of Althar's runs: the Mac on its own. */
export const LOAD_NOTHING_RUNNING: LoadGlance = {
  ...calm,
  cpu: 0.05,
  work: 0,
  memory: 0.38,
  workMemory: 0,
  memoryUsed: '12.2 GB',
  rows: [],
  history: history(at(0.06, 0), at(0.05, 0), 1, 0.02),
}

/** One task, its lead waiting on the model: an agent thinking barely touches the CPU. */
export const LOAD_IDLE: LoadGlance = {
  ...calm,
  cpu: 0.07,
  work: 0.02,
  memory: 0.42,
  workMemory: 0.03,
  memoryUsed: '13.4 GB',
  rows: [row('task 418', 'Repair token refresh on privilege change', 'Meridian', 0.02, '0.9 GB', 3)],
  history: history(at(0.08, 0.02), at(0.07, 0.02), 1, 0.025),
}

/** One task, whose lead started the test suite a minute ago. */
export const LOAD_ONE_TASK: LoadGlance = {
  ...calm,
  cpu: 0.34,
  work: 0.27,
  memory: 0.47,
  workMemory: 0.07,
  memoryUsed: '15.0 GB',
  rows: [row('task 418', 'Repair token refresh on privilege change', 'Meridian', 0.27, '2.1 GB', 14)],
  history: history(at(0.08, 0.02), at(0.34, 0.27), 0.5),
}

/** Four pieces of work across two projects: a build, a test run, a coordinator and a lead reading code. */
export const LOAD_BUSY: LoadGlance = {
  ...calm,
  cpu: 0.63,
  work: 0.54,
  memory: 0.61,
  workMemory: 0.21,
  memoryUsed: '19.5 GB',
  rows: [
    row('task 419', 'Migrate billing webhooks to the v2 endpoint', 'Meridian', 0.22, '2.8 GB', 18),
    row('task 418', 'Repair token refresh on privilege change', 'Meridian', 0.14, '2.1 GB', 14),
    row('task h12', 'Cache upstream health checks', 'Halyard', 0.1, '1.2 GB', 9, true),
    row('coordinator meridian', 'Coordinator', 'Meridian', 0.05, '0.8 GB', 4),
    althar(0.03, '1.1 GB', 9),
  ],
  history: history(at(0.3, 0.2), at(0.63, 0.54), 0.35, 0.06),
}

/** Five tasks, two of them running integration suites, and the default branch running: every core busy, and memory tight. */
export const LOAD_NEAR_MAX: LoadGlance = {
  pressure: MemoryPressure.Warning,
  memoryTotal: '32 GB',
  cpu: 0.96,
  work: 0.88,
  memory: 0.91,
  workMemory: 0.5,
  memoryUsed: '29.1 GB',
  rows: [
    row('task 419', 'Migrate billing webhooks to the v2 endpoint', 'Meridian', 0.31, '6.4 GB', 31),
    row('task 418', 'Repair token refresh on privilege change', 'Meridian', 0.21, '3.9 GB', 22),
    row('task h12', 'Cache upstream health checks', 'Halyard', 0.14, '2.2 GB', 12, true),
    row('task t7', 'Name the limits better', 'Tessera', 0.11, '1.6 GB', 9, true),
    row('task 424', 'Find a shape for webhook queue sharding', 'Meridian', 0.05, '0.9 GB', 4),
    { id: 'run meridian', title: 'Default branch', project: 'Meridian', cpu: 0.02, memory: '0.4 GB', processes: 2 },
    althar(0.04, '1.3 GB', 11),
  ],
  history: history(at(0.62, 0.5), at(0.96, 0.88), 0.25, 0.05),
}

/** Busy, and macOS moving memory to disk: the one strain the meter says in a word. */
export const LOAD_MEMORY_SHORT: LoadGlance = {
  ...LOAD_BUSY,
  pressure: MemoryPressure.Critical,
  memory: 0.97,
  workMemory: 0.41,
  memoryUsed: '31.0 GB',
}

/** Just opened: the first reading, and no line yet to draw. */
export const LOAD_FIRST_READING: LoadGlance = { ...LOAD_ONE_TASK, history: history(at(0.34, 0.27), at(0.34, 0.27), 1, 0, 1) }

/** Where the system says nothing of memory pressure, nor of Althar's processes, as on Windows. */
export const LOAD_UNKNOWN_WORK: LoadGlance = { ...LOAD_BUSY, work: null, workMemory: null, pressure: null, rows: null }
