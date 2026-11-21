import type { BoardCall, BoardSnapshot, BoardTask, WorkPlaces } from '@althar/contracts'
import { Brand, type LoadGlance, type LoadPoint, type LoadRow, MemoryPressure, ProjectInk } from '@althar/ui'

import { lanesOf, type Lanes } from '../../src/renderer/features/board/lanes'
import { card } from '../../tests/fixtures'

/*
 * What the lab draws from: the places this computer's agents work in, as
 * each scene has them, the board of Meridian that waits on them, and how
 * hard the computer works. Made up, and the same on every load.
 *
 * The lab's places carry more than the runtime gives today (`WorkPlaces`):
 * each holder's project, why the number is lowered, and each holder's share
 * of the computer. Each direction says which it needs.
 */

export const SCENES = [
  { key: 'memory', label: 'Lowered for memory' },
  { key: 'cpu', label: 'Lowered for CPU' },
  { key: 'full', label: 'All in use' },
  { key: 'free', label: 'Room to spare' },
] as const
export type Scene = (typeof SCENES)[number]['key']

export type Role = 'lead' | 'reviewer' | 'helper'
export type Doing = { readonly kind: 'starting' } | { readonly kind: 'turn' } | { readonly kind: 'background'; readonly command: string }

/** An agent holding a place: whose, what it is, and what it takes of the computer. */
export interface Held {
  readonly id: string
  readonly taskId: string
  readonly title: string
  readonly project: string
  readonly role: Role
  readonly agent: 'Claude Code' | 'Codex'
  readonly mark: Brand
  readonly doing: Doing
  /** Its share of all the CPU, 0 to 1. */
  readonly cpu: number
  readonly memory: string
}

export type Why = 'memory' | 'cpu'

export interface Machine {
  readonly count: number
  readonly memory: number
  readonly cores: number
}

/** The places this computer's agents work in. */
export interface Places {
  /** Agents at once: the person's number, or the default. */
  readonly configured: number
  /** As many as start now: the configured number, or fewer for a while. */
  readonly atOnce: number
  /** Why fewer, while it is. */
  readonly why: Why | null
  readonly held: readonly Held[]
  readonly machine: Machine
  /** The person set their own number. */
  readonly own: boolean
  /** Work across every project waiting for a place. */
  readonly waiting: number
}

export const PROJECTS = [
  { id: 'meridian', name: 'Meridian', ink: ProjectInk.Teal },
  { id: 'halyard', name: 'Halyard', ink: ProjectInk.Clay },
  { id: 'tessera', name: 'Tessera', ink: ProjectInk.Moss },
] as const

const claude = { agent: 'Claude Code', mark: Brand.ClaudeCode } as const
const codex = { agent: 'Codex', mark: Brand.Codex } as const
const turn: Doing = { kind: 'turn' }

const BASE: Record<string, Held> = {
  login: {
    id: 'login',
    taskId: 'login',
    title: 'Fix the login redirect',
    project: 'Meridian',
    role: 'lead',
    ...claude,
    doing: turn,
    cpu: 0.16,
    memory: '2.4 GB',
  },
  refunds: {
    id: 'refunds',
    taskId: 'refunds',
    title: 'Rate-limit refunds',
    project: 'Meridian',
    role: 'reviewer',
    ...codex,
    doing: turn,
    cpu: 0.05,
    memory: '0.9 GB',
  },
  vite: {
    id: 'vite',
    taskId: 'vite',
    title: 'Upgrade to Vite 8',
    project: 'Halyard',
    role: 'lead',
    ...claude,
    doing: { kind: 'background', command: 'bun run test' },
    cpu: 0.31,
    memory: '3.6 GB',
  },
  viteHelper: {
    id: 'vite-h',
    taskId: 'vite',
    title: 'Upgrade to Vite 8',
    project: 'Halyard',
    role: 'helper',
    ...claude,
    doing: turn,
    cpu: 0.03,
    memory: '0.5 GB',
  },
  notes: {
    id: 'notes',
    taskId: 'notes',
    title: 'Search across notes',
    project: 'Tessera',
    role: 'lead',
    ...codex,
    doing: { kind: 'starting' },
    cpu: 0.02,
    memory: '0.4 GB',
  },
}

const CROWDED: Record<string, Held> = {
  login: { ...BASE.login!, title: 'Fix the login redirect after an SSO sign-in times out on Safari' },
  loginHelper1: {
    ...BASE.login!,
    id: 'login-h1',
    role: 'helper',
    title: 'Fix the login redirect after an SSO sign-in times out on Safari',
    cpu: 0.02,
    memory: '0.4 GB',
  },
  loginHelper2: {
    ...BASE.login!,
    id: 'login-h2',
    role: 'helper',
    title: 'Fix the login redirect after an SSO sign-in times out on Safari',
    cpu: 0.02,
    memory: '0.4 GB',
  },
  refunds: BASE.refunds!,
  vite: { ...BASE.vite!, doing: { kind: 'background', command: 'bun run test:e2e --project=chromium' } },
  viteReview: { ...BASE.vite!, id: 'vite-r', role: 'reviewer', ...codex, doing: turn, cpu: 0.04, memory: '0.8 GB' },
  notes: BASE.notes!,
  fts: {
    id: 'fts',
    taskId: 'fts',
    title: 'Move the notes index to SQLite FTS5 and drop the old trigram tables',
    project: 'Tessera',
    role: 'lead',
    ...codex,
    doing: turn,
    cpu: 0.09,
    memory: '1.7 GB',
  },
}

const pick = (from: Record<string, Held>, keys: readonly string[]) => keys.map((key) => from[key]!)

/** The places, by scene; crowded, a bigger computer with more of them, all across three projects. */
export const placesOf = (scene: Scene, crowded: boolean): Places => {
  if (crowded) {
    const machine = { count: 8, memory: 64, cores: 20 }
    const all = Object.keys(CROWDED)
    const base = { configured: 8, machine, own: false, waiting: 6 }
    switch (scene) {
      case 'memory':
        return { ...base, atOnce: 3, why: 'memory', held: pick(CROWDED, ['login', 'loginHelper1', 'vite', 'notes', 'fts']) }
      case 'cpu':
        return { ...base, atOnce: 7, why: 'cpu', held: pick(CROWDED, all.slice(0, 7)) }
      case 'full':
        return { ...base, atOnce: 8, why: null, held: pick(CROWDED, all) }
      case 'free':
        return { ...base, atOnce: 8, why: null, waiting: 0, held: pick(CROWDED, ['login', 'loginHelper1', 'refunds', 'fts']) }
    }
  }
  const machine = { count: 5, memory: 32, cores: 14 }
  const base = { configured: 5, machine, own: false, waiting: 3 }
  switch (scene) {
    case 'memory':
      return { ...base, atOnce: 1, why: 'memory', held: pick(BASE, ['login', 'vite']) }
    case 'cpu':
      return { ...base, atOnce: 4, why: 'cpu', held: pick(BASE, ['login', 'refunds', 'vite', 'viteHelper']) }
    case 'full':
      return { ...base, atOnce: 5, why: null, held: pick(BASE, ['login', 'refunds', 'vite', 'viteHelper', 'notes']) }
    case 'free':
      return { ...base, atOnce: 5, why: null, waiting: 0, held: pick(BASE, ['login', 'refunds']) }
  }
}

/** The places as the runtime gives them today, for the board as built. */
export const workPlacesOf = (places: Places): WorkPlaces => ({
  busy: places.held.length,
  atOnce: places.atOnce,
  configured: places.configured,
  offline: false,
  holders: places.held.map((held) => ({
    taskId: held.taskId,
    title: held.title,
    threadId: `th-${held.taskId}`,
    kept: held.doing.kind === 'background',
    agentId: held.agent === 'Codex' ? 'codex' : 'claude-code',
    role: held.role,
    reason: held.doing.kind === 'starting' ? 'starting' : held.doing.kind === 'background' ? 'background' : 'turn',
    running: [],
  })),
})

/* ---- the board of Meridian ----------------------------------------------------------- */

export const NOW = '2026-11-20T23:12:00.000Z'

const task = (overrides: Partial<BoardTask>): BoardTask => ({
  ...card(),
  state: 'open',
  createdAt: '2026-11-20T21:00:00.000Z',
  settledAt: null,
  changed: null,
  here: [],
  ...overrides,
})

const permission: BoardCall = {
  id: 'call-ship',
  kind: 'permission',
  title: 'Run make deploy-staging',
  reason: 'Deploying or publishing always asks.',
  command: 'make deploy-staging',
  stuck: null,
  createdAt: '2026-11-20T23:02:00.000Z',
  taskId: 'ship',
  threadId: 'th-ship',
  taskTitle: 'Ship the billing fix',
  taskSlug: 'ship-the-billing-fix',
}

/** Meridian's board: what runs there, what waits up next for a place, and a call. */
export const boardOf = (places: Places, crowded: boolean): Lanes => {
  const queued = { busy: places.held.length, atOnce: places.atOnce }
  const mine = places.held.filter((held) => held.project === 'Meridian')
  const running = [...new Map(mine.map((held) => [held.taskId, held])).values()].map((held) =>
    task({
      taskId: held.taskId,
      threadId: `th-${held.taskId}`,
      title: held.title,
      slug: held.taskId,
      phase: 'running',
      step: held.role === 'reviewer' ? 'review' : 'implement',
      startedAt: '2026-11-20T22:31:00.000Z',
    }),
  )
  const reviewing = mine.some((held) => held.taskId === 'refunds')
  const waits = places.waiting > 0
  const line = [
    ...(waits && !reviewing
      ? [
          task({
            taskId: 'refunds',
            threadId: 'th-refunds',
            title: 'Rate-limit refunds',
            slug: 'rate-limit-refunds',
            phase: 'running',
            step: 'review',
            queued,
            continues: true,
            place: 1,
          }),
        ]
      : []),
    ...(waits
      ? [
          'Dark mode for Settings',
          'Export invoices as CSV',
          ...(crowded ? ['Paginate the audit log', 'Translate the onboarding emails into German and French'] : []),
        ].map((title, i) =>
          task({
            taskId: `line-${i}`,
            threadId: `th-line-${i}`,
            title,
            slug: `line-${i}`,
            phase: 'running',
            queued,
            inLine: true,
            place: i + 2,
          }),
        )
      : []),
  ]
  const planned = task({
    taskId: 'tour',
    threadId: 'th-tour',
    title: 'Prototype the onboarding tour',
    slug: 'onboarding-tour',
    phase: 'planned',
    kind: 'plain',
    plan: { ...card().plan!, startsAt: '2026-11-20T23:15:00.000Z' },
  })
  const settled = task({
    taskId: 'done-1',
    threadId: 'th-done-1',
    title: 'Retry webhooks with backoff',
    slug: 'retry-webhooks',
    phase: 'settled',
    state: 'done',
    settledAt: '2026-11-20T20:40:00.000Z',
  })
  const ship = task({ taskId: 'ship', threadId: 'th-ship', title: 'Ship the billing fix', slug: 'ship-the-billing-fix', phase: 'waiting' })
  const snapshot: BoardSnapshot = {
    cursor: 1,
    tasks: [...running, ...line, planned, ship, settled],
    calls: [permission],
    settledTotal: 1,
    workPlaces: workPlacesOf(places),
  } as BoardSnapshot
  return lanesOf(snapshot)
}

/* ---- how hard the computer works ------------------------------------------------------- */

export const SLOTS = 40

const grain = (i: number) => Math.sin(i * 1.7) * 0.5 + Math.sin(i * 0.43 + 1) * 0.5
const historyTo = (to: LoadPoint): LoadPoint[] =>
  Array.from({ length: SLOTS }, (_, i) => {
    if (i === SLOTS - 1) return to
    const t = i / (SLOTS - 1)
    const k = t < 0.55 ? 0.6 : 0.6 + (t - 0.55) * 0.9
    const cpu = Math.min(1, Math.max(0, to.cpu * k + grain(i) * 0.04))
    return { cpu, work: Math.min(cpu, Math.max(0, to.work * k + grain(i) * 0.03)) }
  })

/** What else of Althar's runs and holds no place: each project's coordinator, and Althar itself. */
const NO_PLACE: readonly LoadRow[] = [
  {
    id: 'coordinator',
    title: 'Coordinator',
    project: 'Meridian',
    agent: 'Claude Code',
    mark: Brand.ClaudeCode,
    cpu: 0.01,
    memory: '0.3 GB',
    processes: 2,
  },
  { id: 'althar', title: 'Althar', opens: false, cpu: 0.03, memory: '0.6 GB', processes: 6 },
]

const LOAD: Record<Scene, { cpu: number; memory: number; pressure: MemoryPressure }> = {
  memory: { cpu: 0.52, memory: 0.94, pressure: MemoryPressure.Critical },
  cpu: { cpu: 0.97, memory: 0.68, pressure: MemoryPressure.Normal },
  full: { cpu: 0.71, memory: 0.63, pressure: MemoryPressure.Normal },
  free: { cpu: 0.3, memory: 0.48, pressure: MemoryPressure.Normal },
}

/** The load meter's reading: Althar's work by task, most CPU first. */
export const loadOf = (scene: Scene, places: Places, crowded: boolean): LoadGlance => {
  const at = LOAD[scene]
  const total = crowded ? 64 : 32
  const byTask = new Map<string, LoadRow>()
  for (const held of places.held) {
    const was = byTask.get(held.taskId)
    const gb = Number.parseFloat(held.memory)
    byTask.set(held.taskId, {
      id: held.taskId,
      title: held.title,
      project: held.project,
      agent: held.agent,
      mark: held.mark,
      cpu: (was?.cpu ?? 0) + held.cpu,
      memory: `${(Number.parseFloat(was?.memory ?? '0') + gb).toFixed(1)} GB`,
      processes: (was?.processes ?? 0) + 4,
    })
  }
  const rows = [...byTask.values(), ...NO_PLACE].toSorted((a, b) => b.cpu - a.cpu)
  const work = Math.min(
    at.cpu,
    rows.reduce((sum, row) => sum + row.cpu, 0),
  )
  return {
    cpu: at.cpu,
    work,
    memory: at.memory,
    workMemory: Math.min(at.memory, rows.reduce((sum, row) => sum + Number.parseFloat(row.memory), 0) / total),
    memoryUsed: `${(at.memory * total).toFixed(1)} GB`,
    memoryTotal: `${total} GB`,
    pressure: at.pressure,
    rows,
    history: historyTo({ cpu: at.cpu, work }),
  }
}
