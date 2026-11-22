import type { BoardCall, BoardSnapshot, BoardTask } from '@althar/contracts'
import { Brand, type LoadGlance, type LoadPoint, type LoadRow, MemoryPressure, ProjectInk } from '@althar/ui'

import { lanesOf, type Lanes } from '../../src/renderer/features/board/lanes'
import { card } from '../../tests/fixtures'

/*
 * What the lab draws from: the window's home and its workers, the home first.
 * The home is this Mac, or a home the window is connected to (studio), and is
 * a worker too. Each worker has its agents (the runtime's `WorkPlaces`: how
 * many work, its number, a number lowered for now and each agent's task), how
 * hard it works (`GetLoad`), whether it can be reached, and what it is. Made
 * up, and the same on every load: the runtime knows this Mac's agents and
 * load, and only a worker's id, its agents and whether it is busy (#1120).
 */

/** Where the window is: on this computer's own home, or connected to studio. */
export type Pov = 'local' | 'remote'

export const SCENES = [
  { key: 'memory', label: 'The home lowered' },
  { key: 'full', label: 'All at work' },
  { key: 'down', label: 'A worker offline' },
  { key: 'calm', label: 'Room to spare' },
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

/** A worker's agents. */
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

export type Provider = 'Claude Code' | 'Codex'

/** A computer the home runs work on: the home itself, this Mac, or one enrolled. */
export interface Worker extends Places {
  readonly id: string
  readonly name: string
  /** This Mac, the computer the window is on. */
  readonly here: boolean
  /** The window's home: it keeps the projects and runs the coordinator. */
  readonly home: boolean
  readonly system: 'macOS' | 'Linux'
  /** Where the home reaches it; this Mac has none of its own. */
  readonly address: string | null
  /** The agents signed in on it, which it can run. */
  readonly providers: readonly Provider[]
  /** Althar's version on it. */
  readonly version: string
  /** How hard it works, now: shares of the whole. */
  readonly cpu: number
  readonly memory: number
  readonly pressure: MemoryPressure
  /** Out of reach: since when, and the tasks whose work is there, waiting for it. */
  readonly offline: { readonly for: string; readonly holding: number } | null
}

/** Lowered for now: fewer may work than the number says. */
export const isLowered = (places: Places) => places.atOnce < places.configured

/** How many more could start now. */
export const freeOf = (places: Places) => Math.max(0, places.atOnce - places.agents.length)

/** A worker that needs a look: out of reach, or lowered for now. */
export const troubled = (worker: Worker) => worker.offline !== null || isLowered(worker)

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
  cache: {
    title: 'Cache the CI dependencies',
    long: 'Cache the CI dependencies between runs and key them on the lockfile',
    project: 'Halyard',
    ...codex,
  },
  emails: {
    title: 'Translate the welcome emails',
    long: 'Translate the welcome emails into German and French and check their layout',
    project: 'Meridian',
    ...claude,
  },
  export: {
    title: 'Fix the export dialog',
    long: 'Fix the export dialog on small screens, where its buttons fall off the edge',
    project: 'Tessera',
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

/* ---- the workers, by scene ------------------------------------------------------------------------------- */

interface Draft {
  id: string
  name: string
  here?: boolean
  home?: boolean
  system?: Worker['system']
  address?: string
  providers?: Provider[]
  version?: string
  machine: Machine
  agents: Agent[]
  cpu: number
  memory: number
  lowered?: { atOnce: number; why: Why }
  offline?: Worker['offline']
}

const worker = (draft: Draft): Worker => ({
  id: draft.id,
  name: draft.name,
  here: draft.here ?? false,
  home: draft.home ?? false,
  system: draft.system ?? 'Linux',
  address: draft.address ?? null,
  providers: draft.providers ?? ['Claude Code', 'Codex'],
  version: draft.version ?? '0.9.4',
  configured: draft.machine.count,
  atOnce: draft.lowered?.atOnce ?? draft.machine.count,
  why: draft.lowered?.why ?? null,
  agents: draft.offline === undefined ? draft.agents : [],
  machine: draft.machine,
  cpu: draft.offline === undefined ? draft.cpu : 0,
  memory: draft.offline === undefined ? draft.memory : 0,
  pressure: draft.memory > 0.9 ? MemoryPressure.Critical : MemoryPressure.Normal,
  offline: draft.offline ?? null,
})

/** The home's workers, this Mac first; crowded, a bigger Mac, more workers, long names and long titles. Alone, this Mac only. */
const localOf = (scene: Scene, crowded: boolean, alone: boolean): Worker[] => {
  const a = (key: TaskKey, role?: Role, doing?: Doing) => agentOf(key, crowded, role, doing)
  const mac: Machine = crowded ? { count: 8, memory: 64, cores: 20 } : { count: 5, memory: 32, cores: 14 }
  const box: Machine = { count: 4, memory: 64, cores: 16 }
  const mini: Machine = { count: 2, memory: 16, cores: 8 }
  const here = (agents: Agent[], cpu: number, memory: number, lowered?: Draft['lowered']) =>
    worker({
      id: 'here',
      name: 'This Mac',
      here: true,
      home: true,
      system: 'macOS',
      machine: mac,
      agents,
      cpu,
      memory,
      ...(lowered ? { lowered } : {}),
    })
  const buildBox = (agents: Agent[], cpu: number, memory: number, rest: Partial<Draft> = {}) =>
    worker({ id: 'build-box', name: 'build-box', address: 'build-box.tail9c2e.ts.net', machine: box, agents, cpu, memory, ...rest })
  const macMini = (agents: Agent[], cpu: number, memory: number, rest: Partial<Draft> = {}) =>
    worker({
      id: 'mac-mini',
      name: 'mac-mini',
      system: 'macOS',
      address: 'mac-mini.tail9c2e.ts.net',
      providers: ['Claude Code'],
      machine: mini,
      agents,
      cpu,
      memory,
      ...rest,
    })
  // Crowded: two more, one with a long name.
  const more = (agents: [Agent[], Agent[]], offline = false) =>
    crowded
      ? [
          worker({
            id: 'gpu',
            name: 'gpu-box',
            address: 'gpu-box.tail9c2e.ts.net',
            providers: ['Codex'],
            machine: { count: 6, memory: 128, cores: 32 },
            agents: agents[0],
            cpu: 0.44,
            memory: 0.38,
          }),
          worker({
            id: 'frankfurt',
            name: 'ci-runner-frankfurt-02.internal',
            address: 'ci-runner-frankfurt-02.internal:7443',
            version: '0.9.2',
            machine: { count: 3, memory: 32, cores: 8 },
            agents: agents[1],
            cpu: 0.58,
            memory: 0.66,
            ...(offline ? { offline: { for: '3 h', holding: 1 } } : {}),
          }),
        ]
      : []

  const all = (() => {
    switch (scene) {
      case 'memory':
        return [
          here([a('login'), a('safari'), ...(crowded ? [a('login', 'helper')] : [])], 0.52, 0.94, { atOnce: 1, why: 'memory' }),
          buildBox([a('vite'), a('notes'), a('audit'), a('audit', 'helper', 'background')], 0.62, 0.55),
          macMini([a('webhooks'), a('webhooks', 'reviewer')], 0.48, 0.71),
          ...more([
            [a('perf'), a('cache'), a('emails'), a('emails', 'reviewer'), a('export'), a('export', 'helper')],
            [a('vite', 'reviewer'), a('notes', 'helper'), a('cache', 'helper')],
          ]),
        ]
      case 'full':
        return [
          here(
            [
              a('login'),
              a('safari'),
              a('audit'),
              a('audit', 'helper', 'background'),
              a('webhooks', 'reviewer'),
              ...(crowded ? [a('perf'), a('cache'), a('emails', 'lead', 'starting')] : []),
            ],
            0.71,
            0.68,
          ),
          buildBox([a('vite'), a('notes'), a('perf', crowded ? 'reviewer' : 'lead'), a('emails', crowded ? 'helper' : 'lead')], 0.81, 0.62),
          macMini([a('cache', crowded ? 'reviewer' : 'lead'), a('export')], 0.66, 0.74),
          ...more([
            [
              a('webhooks'),
              a('safari', 'reviewer'),
              a('login', 'reviewer'),
              a('audit', 'reviewer'),
              a('export', 'reviewer'),
              a('notes', 'reviewer'),
            ],
            [a('vite', 'reviewer'), a('vite', 'helper'), a('cache', 'helper')],
          ]),
        ]
      case 'down':
        return [
          here([a('login'), a('safari'), a('audit')], 0.46, 0.58),
          buildBox([], 0, 0, { offline: { for: '12 min', holding: 2 } }),
          macMini([a('webhooks')], 0.96, 0.52, { lowered: { atOnce: 1, why: 'cpu' } }),
          ...more([[a('perf'), a('emails')], []], true),
        ]
      case 'calm':
        return [
          here([a('login'), a('safari')], 0.3, 0.48),
          buildBox([a('vite')], 0.22, 0.31),
          macMini([], 0.04, 0.27),
          ...more([[a('perf')], []]),
        ]
    }
  })()
  return alone ? all.slice(0, 1) : all
}

/** studio, a home on a server the window is connected to, a worker too: in this Mac's place, its agents and load. */
export const STUDIO = { name: 'studio', address: 'studio.tail9c2e.ts.net', version: '0.9.3', latest: '0.9.4' } as const

/**
 * The window's home and its workers, the home first, and This Mac, among them or not. On studio, the server takes
 * this Mac's place, and the mac-mini serves this computer only; this Mac is one of studio's workers only where it
 * is lent.
 */
export const workersOf = (scene: Scene, crowded: boolean, alone: boolean, pov: Pov, lent: boolean): { workers: Worker[]; mac: Worker } => {
  const local = localOf(scene, crowded, alone)
  if (pov === 'local') return { workers: local, mac: local[0]! }
  const [mac, ...rest] = local
  const studio: Worker = {
    ...mac!,
    id: 'studio',
    name: STUDIO.name,
    here: false,
    system: 'Linux',
    address: STUDIO.address,
    version: STUDIO.version,
    machine: { count: 6, memory: 32, cores: 8 },
    configured: 6,
    atOnce: mac!.why === null ? 6 : mac!.atOnce,
  }
  const lentMac: Worker = { ...mac!, home: false, agents: [], cpu: 0.14, memory: 0.46, atOnce: mac!.configured, why: null }
  return { workers: [studio, ...rest.filter((one) => one.id !== 'mac-mini'), ...(lent ? [lentMac] : [])], mac: lentMac }
}

/* ---- what waits for an agent ----------------------------------------------------------- */

/** A task that waits to start, in any project, the first for longest. */
export interface Waiting {
  readonly taskId: string
  readonly title: string
  readonly project: string
}

/** What waits, on every board: nothing while a worker that can be reached could start one more. */
export const waitingOf = (workers: readonly Worker[], crowded: boolean): Waiting[] => {
  if (workers.some((one) => one.offline === null && freeOf(one) > 0)) return []
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

/** Meridian's board: what runs there on any worker, what waits in Up next for an agent, a plan, a call and something settled. */
export const boardOf = (workers: readonly Worker[], waiting: readonly Waiting[]): Lanes => {
  const here = workers[0]!
  const queued = { busy: here.agents.length, atOnce: here.atOnce }
  const mine = workers.flatMap((one) => one.agents).filter((one) => one.project === 'Meridian')
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
  } as BoardSnapshot
  return lanesOf(snapshot)
}

/* ---- how hard a worker works ------------------------------------------------------- */

export const SLOTS = 40

const grain = (i: number, seed: number) => Math.sin(i * 1.7 + seed) * 0.5 + Math.sin(i * 0.43 + 1 + seed) * 0.5
const historyTo = (to: LoadPoint, seed: number): LoadPoint[] =>
  Array.from({ length: SLOTS }, (_, i) => {
    if (i === SLOTS - 1) return to
    const t = i / (SLOTS - 1)
    const k = t < 0.55 ? 0.6 : 0.6 + (t - 0.55) * 0.9
    const cpu = Math.min(1, Math.max(0, to.cpu * k + grain(i, seed) * 0.04))
    return { cpu, work: Math.min(cpu, Math.max(0, to.work * k + grain(i, seed) * 0.03)) }
  })

/** What else of Althar's runs and has no agent at work: at the home, each project's coordinator; on this Mac, Althar itself. */
const COORDINATOR: LoadRow = {
  id: 'coordinator',
  title: 'Coordinator',
  project: 'Meridian',
  agent: 'Claude Code',
  mark: Brand.ClaudeCode,
  cpu: 0.01,
  memory: '0.3 GB',
  processes: 2,
}
const ALTHAR: LoadRow = { id: 'althar', title: 'Althar', opens: false, cpu: 0.03, memory: '0.6 GB', processes: 6 }

/** Each task's share of the CPU and the memory it holds, made up but steady. */
const SHARE: Record<TaskKey, { cpu: number; memory: number }> = {
  login: { cpu: 0.16, memory: 2.4 },
  safari: { cpu: 0.09, memory: 1.8 },
  audit: { cpu: 0.12, memory: 1.6 },
  vite: { cpu: 0.34, memory: 3.1 },
  webhooks: { cpu: 0.05, memory: 0.9 },
  notes: { cpu: 0.11, memory: 1.4 },
  perf: { cpu: 0.08, memory: 1.2 },
  cache: { cpu: 0.14, memory: 1.1 },
  emails: { cpu: 0.06, memory: 0.8 },
  export: { cpu: 0.07, memory: 1.3 },
}

/** A worker's reading as the load meter draws it: its work by task, most CPU first; this Mac's with Althar's own. */
export const loadOf = (worker: Worker): LoadGlance => {
  const total = worker.machine.memory
  const busy = worker.cpu > 0.9
  const byTask = new Map<string, LoadRow>()
  for (const one of worker.agents) {
    if (byTask.has(one.taskId)) continue
    const share = SHARE[one.taskId as TaskKey]
    byTask.set(one.taskId, {
      id: one.taskId,
      title: one.title,
      project: one.project,
      agent: one.agent,
      mark: one.mark,
      cpu: busy ? share.cpu * 2.4 : share.cpu,
      memory: `${share.memory.toFixed(1)} GB`,
      processes: worker.agents.filter((other) => other.taskId === one.taskId).length * 4,
    })
  }
  const rows = [...byTask.values(), ...(worker.home ? [COORDINATOR] : []), ...(worker.here || worker.home ? [ALTHAR] : [])].toSorted(
    (a, b) => b.cpu - a.cpu,
  )
  const work = Math.min(
    worker.cpu,
    rows.reduce((sum, row) => sum + row.cpu, 0),
  )
  return {
    cpu: worker.cpu,
    work,
    memory: worker.memory,
    workMemory: Math.min(worker.memory, rows.reduce((sum, row) => sum + Number.parseFloat(row.memory), 0) / total),
    memoryUsed: `${(worker.memory * total).toFixed(1)} GB`,
    memoryTotal: `${total} GB`,
    pressure: worker.pressure,
    rows,
    history: historyTo({ cpu: worker.cpu, work }, worker.name.length),
  }
}
