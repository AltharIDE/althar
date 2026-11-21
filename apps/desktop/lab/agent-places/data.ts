import type { BoardCall, BoardSnapshot, BoardTask, WorkPlaces } from '@althar/contracts'
import { Brand, type LoadGlance, type LoadPoint, type LoadRow, MemoryPressure, ProjectInk } from '@althar/ui'

import { lanesOf, type Lanes } from '../../src/renderer/features/board/lanes'
import { card } from '../../tests/fixtures'

/*
 * What the lab draws from: this computer's agents (the runtime's `WorkPlaces`:
 * how many work, its number, a number lowered for now, and each agent's task,
 * role and what it does), how hard the computer works (`GetLoad`), and
 * Meridian's board, whose Up next waits on them. Made up, and the same on
 * every load. The runtime doesn't say why it lowers the number; the lab does
 * (memory or CPU, which its pressure check knows).
 */

export const SCENES = [
  { key: 'memory', label: 'Lowered, memory' },
  { key: 'full', label: 'All at work' },
  { key: 'cpu', label: 'Lowered, CPU' },
  { key: 'free', label: 'Room to spare' },
] as const
export type Scene = (typeof SCENES)[number]['key']

export type Role = 'lead' | 'reviewer' | 'helper'
export type Doing = 'starting' | 'turn' | 'background'

/** An agent at work: the task it works for, its part in it, and what it does now. */
export interface Agent {
  readonly id: string
  readonly taskId: string
  readonly title: string
  readonly project: string
  readonly role: Role
  readonly agent: 'Claude Code' | 'Codex'
  readonly mark: Brand
  readonly doing: Doing
}

/** Why the number is lowered for now. */
export type Why = 'memory' | 'cpu'

export interface Machine {
  /** The number Althar suggests for it. */
  readonly count: number
  readonly memory: number
  readonly cores: number
}

/** This computer's agents. */
export interface Places {
  /** Agents at once: the person's number, or the default. */
  readonly configured: number
  /** As many as may work now: the number, or fewer for a while. */
  readonly atOnce: number
  /** Why fewer, while it is. */
  readonly why: Why | null
  readonly agents: readonly Agent[]
  readonly machine: Machine
}

/** Lowered for now: fewer may work than the number says. */
export const isLowered = (places: Places) => places.atOnce < places.configured

/** How many more could start now. */
export const freeOf = (places: Places) => Math.max(0, places.atOnce - places.agents.length)

/** Of the number, how many can't be used for now: lowered away, and not at work. */
export const closedOf = (places: Places) => Math.max(0, places.configured - Math.max(places.atOnce, places.agents.length))

export const PROJECTS = [
  { id: 'meridian', name: 'Meridian', ink: ProjectInk.Teal },
  { id: 'halyard', name: 'Halyard', ink: ProjectInk.Clay },
  { id: 'tessera', name: 'Tessera', ink: ProjectInk.Moss },
] as const

const claude = { agent: 'Claude Code', mark: Brand.ClaudeCode } as const
const codex = { agent: 'Codex', mark: Brand.Codex } as const

const TASKS = {
  login: {
    title: 'Fix the login redirect',
    long: 'Fix the login redirect after an SSO sign-in times out on Safari',
    project: 'Meridian',
    ...claude,
  },
  safari: {
    title: 'Fix the date picker on Safari',
    long: 'Fix the date picker on Safari when the locale starts the week on Monday',
    project: 'Tessera',
    ...claude,
  },
  audit: {
    title: 'Paginate the audit log',
    long: 'Paginate the audit log and keep the filters in the address',
    project: 'Meridian',
    ...claude,
  },
  vite: {
    title: 'Upgrade to Vite 8',
    long: 'Upgrade to Vite 8 and move the test runner to its browser mode',
    project: 'Halyard',
    ...codex,
  },
  webhooks: {
    title: 'Sign outgoing webhooks',
    long: 'Sign outgoing webhooks and document how to check them',
    project: 'Meridian',
    ...codex,
  },
  notes: {
    title: 'Search across notes',
    long: 'Move the notes index to SQLite FTS5 and drop the old trigram tables',
    project: 'Tessera',
    ...codex,
  },
  perf: {
    title: 'Profile the board',
    long: 'Profile the board with a thousand cards and fix what is slow',
    project: 'Meridian',
    ...claude,
  },
} as const
type TaskKey = keyof typeof TASKS

/** An agent of a task: its lead, in a turn, unless said otherwise. */
const agentOf = (key: TaskKey, crowded: boolean, role: Role = 'lead', doing: Doing = 'turn'): Agent => {
  const task = TASKS[key]
  return {
    id: `${key}-${role}`,
    taskId: key,
    title: crowded ? task.long : task.title,
    project: task.project,
    role,
    agent: task.agent,
    mark: task.mark,
    doing,
  }
}

/** This computer's agents, by scene; crowded, a bigger Mac with more of them and long titles. */
export const placesOf = (scene: Scene, crowded: boolean): Places => {
  const a = (key: TaskKey, role?: Role, doing?: Doing) => agentOf(key, crowded, role, doing)
  const machine: Machine = crowded ? { count: 8, memory: 64, cores: 20 } : { count: 5, memory: 32, cores: 14 }
  const at = (agents: Agent[], lowered?: { atOnce: number; why: Why }): Places => ({
    configured: machine.count,
    atOnce: lowered?.atOnce ?? machine.count,
    why: lowered?.why ?? null,
    agents,
    machine,
  })
  switch (scene) {
    case 'memory':
      return at([a('login'), a('safari'), ...(crowded ? [a('login', 'helper')] : [])], { atOnce: 1, why: 'memory' })
    case 'full':
      return at([
        a('login'),
        a('safari'),
        a('audit'),
        a('audit', 'helper', 'background'),
        a('webhooks', 'reviewer'),
        ...(crowded ? [a('vite'), a('notes'), a('perf', 'lead', 'starting')] : []),
      ])
    case 'cpu':
      return at([a('login'), a('safari'), a('vite', 'lead', 'background'), ...(crowded ? [a('notes'), a('perf')] : [])], {
        atOnce: crowded ? 5 : 3,
        why: 'cpu',
      })
    case 'free':
      return at([a('login'), a('safari'), ...(crowded ? [a('audit')] : [])])
  }
}

/** What the runtime gives the board today, for the take as built. */
const workPlacesOf = (places: Places): WorkPlaces => ({
  busy: places.agents.length,
  atOnce: places.atOnce,
  configured: places.configured,
  offline: false,
  holders: places.agents.map((one) => ({
    taskId: one.taskId,
    title: one.title,
    threadId: `th-${one.taskId}`,
    kept: one.doing === 'background',
    agentId: one.agent === 'Codex' ? 'codex' : 'claude-code',
    role: one.role,
    reason: one.doing,
    running: [],
  })),
})

/* ---- what waits for an agent ----------------------------------------------------------- */

/** A task that waits to start, in any project, the first for longest. */
export interface Waiting {
  readonly taskId: string
  readonly title: string
  readonly project: string
}

/** What waits, on every board: nothing while one more could start. */
export const waitingOf = (places: Places, crowded: boolean): Waiting[] => {
  if (freeOf(places) > 0) return []
  return [
    { taskId: 'line-0', title: 'Dark mode for Settings', project: 'Meridian' },
    { taskId: 'else-0', title: 'Bump Node to 24 in CI', project: 'Halyard' },
    { taskId: 'line-1', title: 'Show receipts in the customer portal', project: 'Meridian' },
    ...(crowded
      ? [
          { taskId: 'line-2', title: 'Retry failed payouts overnight', project: 'Meridian' },
          { taskId: 'else-1', title: 'Fix the export dialog on small screens', project: 'Tessera' },
        ]
      : []),
  ]
}

/* ---- the board of Meridian ----------------------------------------------------------- */

export const NOW = '2026-11-21T18:59:00.000Z'

const task = (overrides: Partial<BoardTask>): BoardTask => ({
  ...card(),
  state: 'open',
  createdAt: '2026-11-21T17:00:00.000Z',
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
  createdAt: '2026-11-21T18:50:00.000Z',
  taskId: 'ship',
  threadId: 'th-ship',
  taskTitle: 'Ship the billing fix',
  taskSlug: 'ship-the-billing-fix',
}

/** Meridian's board: what runs there, what waits in Up next for an agent, a plan, a call and something settled. */
export const boardOf = (places: Places, waiting: readonly Waiting[], asBuilt: boolean): Lanes => {
  const queued = { busy: places.agents.length, atOnce: places.atOnce }
  const mine = places.agents.filter((one) => one.project === 'Meridian')
  const running = [...new Map(mine.map((one) => [one.taskId, one])).values()].map((one) =>
    task({
      taskId: one.taskId,
      threadId: `th-${one.taskId}`,
      title: one.title,
      slug: one.taskId,
      phase: 'running',
      step: one.role === 'reviewer' ? 'review' : 'implement',
      startedAt: '2026-11-21T18:31:00.000Z',
    }),
  )
  const line = waiting
    .filter((one) => one.project === 'Meridian')
    .map((one, i) =>
      task({
        taskId: one.taskId,
        threadId: `th-${one.taskId}`,
        title: one.title,
        slug: one.taskId,
        phase: 'running',
        queued,
        inLine: true,
        place: i + 1,
      }),
    )
  const planned = task({
    taskId: 'tour',
    threadId: 'th-tour',
    title: 'Prototype the onboarding tour',
    slug: 'onboarding-tour',
    phase: 'planned',
    kind: 'plain',
    plan: { ...card().plan!, startsAt: '2026-11-21T19:15:00.000Z' },
  })
  const settled = task({
    taskId: 'done-1',
    threadId: 'th-done-1',
    title: 'Retry webhooks with backoff',
    slug: 'retry-webhooks',
    phase: 'settled',
    state: 'done',
    settledAt: '2026-11-21T16:40:00.000Z',
  })
  const ship = task({ taskId: 'ship', threadId: 'th-ship', title: 'Ship the billing fix', slug: 'ship-the-billing-fix', phase: 'waiting' })
  const snapshot = {
    cursor: 1,
    tasks: [...running, ...line, planned, ship, settled],
    calls: [permission],
    settledTotal: 1,
    // As built, the board draws the banner from these; a take takes them away.
    ...(asBuilt ? { workPlaces: workPlacesOf(places) } : {}),
  } as BoardSnapshot
  return lanesOf(snapshot)
}

/* ---- how hard this computer works ------------------------------------------------------- */

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

/** What else of Althar's runs and has no agent at work: each project's coordinator, and Althar itself. */
const NO_AGENT: readonly LoadRow[] = [
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
  full: { cpu: 0.71, memory: 0.68, pressure: MemoryPressure.Normal },
  cpu: { cpu: 0.96, memory: 0.61, pressure: MemoryPressure.Normal },
  free: { cpu: 0.3, memory: 0.48, pressure: MemoryPressure.Normal },
}

/** Each task's share of the CPU and the memory it holds, made up but steady. */
const SHARE: Record<TaskKey, { cpu: number; memory: number }> = {
  login: { cpu: 0.16, memory: 2.4 },
  safari: { cpu: 0.09, memory: 1.8 },
  audit: { cpu: 0.12, memory: 1.6 },
  vite: { cpu: 0.34, memory: 3.1 },
  webhooks: { cpu: 0.05, memory: 0.9 },
  notes: { cpu: 0.11, memory: 1.4 },
  perf: { cpu: 0.08, memory: 1.2 },
}

/** The load meter's reading: Althar's work on this computer by task, most CPU first. */
export const loadOf = (scene: Scene, places: Places, crowded: boolean): LoadGlance => {
  const now = LOAD[scene]
  const total = crowded ? 64 : 32
  const byTask = new Map<string, LoadRow>()
  for (const one of places.agents) {
    if (byTask.has(one.taskId)) continue
    const share = SHARE[one.taskId as TaskKey]
    byTask.set(one.taskId, {
      id: one.taskId,
      title: one.title,
      project: one.project,
      agent: one.agent,
      mark: one.mark,
      cpu: scene === 'cpu' ? share.cpu * 1.6 : share.cpu,
      memory: `${share.memory.toFixed(1)} GB`,
      processes: places.agents.filter((other) => other.taskId === one.taskId).length * 4,
    })
  }
  const rows = [...byTask.values(), ...NO_AGENT].toSorted((a, b) => b.cpu - a.cpu)
  const work = Math.min(
    now.cpu,
    rows.reduce((sum, row) => sum + row.cpu, 0),
  )
  return {
    cpu: now.cpu,
    work,
    memory: now.memory,
    workMemory: Math.min(now.memory, rows.reduce((sum, row) => sum + Number.parseFloat(row.memory), 0) / total),
    memoryUsed: `${(now.memory * total).toFixed(1)} GB`,
    memoryTotal: `${total} GB`,
    pressure: now.pressure,
    rows,
    history: historyTo({ cpu: now.cpu, work }),
  }
}
