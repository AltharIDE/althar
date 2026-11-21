import type { BoardCall, BoardSnapshot, BoardTask, WorkPlaces } from '@althar/contracts'
import { Brand, type LoadGlance, type LoadPoint, type LoadRow, MemoryPressure, ProjectInk } from '@althar/ui'

import { lanesOf, type Lanes } from '../../src/renderer/features/board/lanes'
import { card } from '../../tests/fixtures'

/*
 * What the lab draws from: the workers this home's agents work on (ADR-103:
 * This Mac itself, the person's own machines, Althar Cloud), each with its
 * own places, its own number and its own reason to have fewer for a while;
 * the board of Meridian that waits on them; and how hard this computer works.
 * Made up, and the same on every load.
 *
 * The runtime gives today only this computer's places (`WorkPlaces`), with no
 * workers, no holder's project and no reason for a lowered number. The lab's
 * places carry them.
 */

export const SCENES = [
  { key: 'mac', label: 'This Mac lowered' },
  { key: 'full', label: 'All in use' },
  { key: 'away', label: 'A computer away' },
  { key: 'cap', label: 'Cloud cap reached' },
  { key: 'free', label: 'Room to spare' },
  { key: 'tight', label: 'Work waits, no cloud' },
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

/** Why fewer places for a while: the computer is short of memory or CPU, or a cloud's spending cap is reached. */
export type Why = 'memory' | 'cpu' | 'cap'

export interface Machine {
  /** The number Althar suggests for it. */
  readonly count: number
  readonly memory: number
  readonly cores: number
}

/** A worker's places. */
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
}

export type WorkerKind = 'this' | 'own' | 'cloud'

/** Somewhere this home's agents work: this computer, one of the person's own, or Althar Cloud. */
export interface Worker {
  readonly id: string
  readonly name: string
  readonly kind: WorkerKind
  /** What it is, in a word or two: This computer, Linux, macOS, Cloud. */
  readonly what: string
  readonly places: Places
  /** Out of reach since when: its places can't be counted, and the work on it as last seen. */
  readonly away: { readonly since: string } | null
  /** A cloud's month: spent and its cap. */
  readonly spend: { readonly spent: number; readonly cap: number; readonly resets: string } | null
  /** Tasks that can start only here, waiting for it, and why only here: a local checkout, a platform. */
  readonly pinned: readonly PinnedTask[]
  /** How hard it works, 0 to 1, as the computer says; none for the cloud, whose computers are Althar's. */
  readonly load: { readonly cpu: number; readonly memory: number } | null
}

export interface PinnedTask {
  readonly taskId: string
  readonly title: string
  readonly project: string
  readonly why: string
}

export const PROJECTS = [
  { id: 'meridian', name: 'Meridian', ink: ProjectInk.Teal },
  { id: 'halyard', name: 'Halyard', ink: ProjectInk.Clay },
  { id: 'tessera', name: 'Tessera', ink: ProjectInk.Moss },
] as const

const claude = { agent: 'Claude Code', mark: Brand.ClaudeCode } as const
const codex = { agent: 'Codex', mark: Brand.Codex } as const
const turn: Doing = { kind: 'turn' }

/** The tasks, by key: what they are and whose. */
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
  refunds: { title: 'Rate-limit refunds', long: 'Rate-limit refunds per merchant and per card', project: 'Meridian', ...codex },
  vite: {
    title: 'Upgrade to Vite 8',
    long: 'Upgrade to Vite 8 and move the test runner to its browser mode',
    project: 'Halyard',
    ...claude,
  },
  notes: {
    title: 'Search across notes',
    long: 'Move the notes index to SQLite FTS5 and drop the old trigram tables',
    project: 'Tessera',
    ...codex,
  },
  audit: {
    title: 'Paginate the audit log',
    long: 'Paginate the audit log and keep the filters in the address',
    project: 'Meridian',
    ...claude,
  },
  emails: {
    title: 'Translate the onboarding emails',
    long: 'Translate the onboarding emails into German and French',
    project: 'Meridian',
    ...codex,
  },
  flaky: {
    title: 'Quarantine the flaky upload test',
    long: 'Quarantine the flaky upload test and file what makes it flaky',
    project: 'Halyard',
    ...codex,
  },
  icons: {
    title: 'Swap the icon set',
    long: 'Swap the icon set for the new outline icons across every screen',
    project: 'Tessera',
    ...claude,
  },
  webhooks: {
    title: 'Sign outgoing webhooks',
    long: 'Sign outgoing webhooks and document how to check them',
    project: 'Meridian',
    ...claude,
  },
  cache: { title: 'Cache the build in CI', long: 'Cache the build in CI between runs of the same branch', project: 'Halyard', ...claude },
  sync: { title: 'Sync notes offline', long: 'Sync notes offline and settle conflicts by the newest edit', project: 'Tessera', ...codex },
  csv: { title: 'Export invoices as CSV', long: 'Export invoices as CSV with the tax lines split out', project: 'Meridian', ...claude },
  docs: { title: 'Write the API guide', long: 'Write the API guide with an example for every endpoint', project: 'Halyard', ...claude },
  tags: { title: 'Tag notes by hand', long: 'Tag notes by hand and suggest tags from the text', project: 'Tessera', ...codex },
  perf: {
    title: 'Profile the board',
    long: 'Profile the board with a thousand cards and fix what is slow',
    project: 'Meridian',
    ...claude,
  },
  lint: { title: 'Turn on strict lint', long: 'Turn on strict lint and fix what it finds', project: 'Halyard', ...codex },
  sso: { title: 'Add SAML sign-in', long: 'Add SAML sign-in for the enterprise plan', project: 'Meridian', ...claude },
  pdf: { title: 'Render notes as PDF', long: 'Render notes as PDF with their images and links', project: 'Tessera', ...claude },
  onboard: {
    title: 'Rework the onboarding checklist',
    long: 'Rework the onboarding checklist so each step can be skipped and come back to',
    project: 'Meridian',
    ...claude,
  },
  charts: {
    title: 'Draw the usage charts',
    long: 'Draw the usage charts with the new palette and a table beside each',
    project: 'Halyard',
    ...codex,
  },
  share: { title: 'Share a note by link', long: 'Share a note by link with an expiry and a password', project: 'Tessera', ...claude },
} as const
type TaskKey = keyof typeof TASKS

/** An agent of a task in a place: lead by default, at a turn. */
const at = (key: TaskKey, crowded: boolean, more: { role?: Role; doing?: Doing; cpu?: number; memory?: string; n?: number } = {}): Held => {
  const task = TASKS[key]
  const role = more.role ?? 'lead'
  return {
    id: `${key}-${role}-${more.n ?? 0}`,
    taskId: key,
    title: crowded ? task.long : task.title,
    project: task.project,
    role,
    agent: task.agent,
    mark: task.mark,
    doing: more.doing ?? turn,
    cpu: more.cpu ?? 0.06,
    memory: more.memory ?? '1.1 GB',
  }
}

const places = (machine: Machine, held: readonly Held[], lowered?: { atOnce: number; why: Why }): Places => ({
  configured: machine.count,
  atOnce: lowered?.atOnce ?? machine.count,
  why: lowered?.why ?? null,
  held,
  machine,
  own: false,
})

const worker = (
  one: Omit<Worker, 'away' | 'spend' | 'pinned' | 'load'> & Partial<Pick<Worker, 'away' | 'spend' | 'pinned' | 'load'>>,
): Worker => ({
  away: null,
  spend: null,
  pinned: [],
  load: null,
  ...one,
})

/** Up next's first task, where it can start on one worker alone. */
const pinnedTo = (title: string, why: string): PinnedTask => ({ taskId: 'line-0', title, project: 'Meridian', why })

/**
 * The workers, by scene. Crowded: a bigger Mac, and a Mac mini besides, all with long titles. Only this Mac: no other
 * worker, as with no worker enrolled.
 */
export const workersOf = (scene: Scene, crowded: boolean, onlyMac: boolean): Worker[] => {
  const k = crowded
  const a = (key: TaskKey, more?: Parameters<typeof at>[2]) => at(key, k, more)
  const mac: Machine = crowded ? { count: 8, memory: 64, cores: 20 } : { count: 5, memory: 32, cores: 14 }
  const box: Machine = { count: 8, memory: 64, cores: 16 }
  const mini: Machine = { count: 4, memory: 16, cores: 10 }
  const cloud: Machine = { count: 6, memory: 0, cores: 0 }
  const test: Doing = { kind: 'background', command: crowded ? 'bun run test:e2e --project=chromium' : 'bun run test' }

  const thisMac = (held: Held[], lowered?: { atOnce: number; why: Why }, pinned: PinnedTask[] = []) =>
    worker({
      id: 'this',
      name: 'This Mac',
      kind: 'this',
      what: 'This computer',
      places: places(mac, held, lowered),
      pinned,
      load: { cpu: LOAD[scene].cpu, memory: LOAD[scene].memory },
    })
  const buildBox = (held: Held[], more: Partial<Worker> = {}, lowered?: { atOnce: number; why: Why }) =>
    worker({
      id: 'build-box',
      name: 'build-box',
      kind: 'own',
      what: 'Linux',
      places: places(box, held, lowered),
      load: BOX_LOAD[scene],
      ...more,
    })
  const macMini = (held: Held[]) =>
    worker({ id: 'mac-mini', name: 'Mac mini', kind: 'own', what: 'macOS', places: places(mini, held), load: { cpu: 0.34, memory: 0.58 } })
  const cloudOf = (held: Held[], spent: number, closed = false) =>
    worker({
      id: 'cloud',
      name: 'Althar Cloud',
      kind: 'cloud',
      what: 'Cloud',
      places: places(cloud, held, closed ? { atOnce: 0, why: 'cap' } : undefined),
      spend: { spent, cap: 20, resets: '1 Dec' },
    })

  const all = (() => {
    switch (scene) {
      case 'mac':
        return [
          thisMac(
            [
              a('login', { cpu: 0.16, memory: '2.4 GB' }),
              a('safari', { cpu: 0.09, memory: '1.8 GB' }),
              ...(k ? [a('login', { role: 'helper', n: 1 })] : []),
            ],
            { atOnce: 1, why: 'memory' },
            [pinnedTo('Dark mode for Settings', 'Its local checkout')],
          ),
          buildBox([a('vite', { doing: test, cpu: 0.31 }), a('vite', { role: 'helper' }), a('notes', { doing: { kind: 'starting' } })]),
          ...(k ? [macMini([a('icons'), a('pdf')])] : []),
          cloudOf([a('refunds', { role: 'reviewer' }), ...(k ? [a('emails')] : [])], 6.4),
        ]
      case 'full':
        return [
          thisMac([
            a('login'),
            a('safari'),
            a('audit'),
            a('audit', { role: 'helper' }),
            a('webhooks'),
            ...(k ? [a('perf'), a('perf', { role: 'reviewer' }), a('sso')] : []),
          ]),
          buildBox([
            a('vite', { doing: test }),
            a('vite', { role: 'helper' }),
            a('notes'),
            a('flaky'),
            a('cache'),
            a('docs'),
            a('lint'),
            a('lint', { role: 'reviewer' }),
          ]),
          ...(k ? [macMini([a('icons'), a('pdf'), a('tags'), a('tags', { role: 'helper' })])] : []),
          cloudOf([a('refunds', { role: 'reviewer' }), a('emails'), a('sync'), a('onboard'), a('charts'), a('share')], 11.8),
        ]
      case 'away':
        return [
          thisMac([a('login'), a('safari'), a('audit')]),
          buildBox([a('vite', { doing: test }), a('vite', { role: 'helper' }), a('flaky')], {
            away: { since: '23:02' },
            load: null,
            pinned: [pinnedTo('Rebuild the staging database', 'Needs Linux')],
          }),
          ...(k ? [macMini([a('icons')])] : []),
          cloudOf([a('refunds', { role: 'reviewer' }), a('emails')], 8.2),
        ]
      case 'cap':
        return [
          thisMac([
            a('login'),
            a('safari'),
            a('audit'),
            a('audit', { role: 'helper' }),
            a('webhooks'),
            ...(k ? [a('perf'), a('sso'), a('csv')] : []),
          ]),
          buildBox([
            a('vite', { doing: test }),
            a('vite', { role: 'helper' }),
            a('notes'),
            a('flaky'),
            a('cache'),
            a('docs'),
            a('lint'),
            a('sync'),
          ]),
          ...(k ? [macMini([a('icons'), a('pdf'), a('tags'), a('emails')])] : []),
          cloudOf([], 20, true),
        ]
      case 'free':
        return [thisMac([a('login'), a('safari')]), buildBox([a('vite', { doing: test })]), ...(k ? [macMini([])] : []), cloudOf([], 3.1)]
      case 'tight':
        // No cloud linked: This Mac short of CPU, build-box of memory, both full, and the line waits.
        return [
          thisMac([a('login', { cpu: 0.24 }), a('safari', { cpu: 0.21 }), a('audit', { cpu: 0.18 }), ...(k ? [a('perf'), a('sso')] : [])], {
            atOnce: k ? 5 : 3,
            why: 'cpu',
          }),
          buildBox(
            [a('vite', { doing: test }), a('vite', { role: 'helper' }), a('notes'), a('flaky'), a('cache'), a('docs')],
            {},
            { atOnce: 6, why: 'memory' },
          ),
          ...(k ? [macMini([a('icons'), a('pdf'), a('tags'), a('emails')])] : []),
        ]
    }
  })()
  // With no other worker, what can start only on This Mac is the whole line, which waits as it does today.
  return onlyMac ? all.filter((one) => one.kind === 'this').map((one) => ({ ...one, pinned: [] })) : all
}

/** This computer, which every home has among its workers. */
export const thisMacOf = (workers: readonly Worker[]) => workers.find((one) => one.kind === 'this')!

/** A worker with no free place it can start in: full, closed for a while, or out of reach. */
export const isFull = (one: Worker) => one.away !== null || one.places.held.length >= one.places.atOnce

/**
 * Every place across the computers: at work and as many as there are on those in reach (`busy` of `of`, as the words
 * say it); and, for what draws them, every place there is, out of reach too, and how many of them are closed for now.
 */
export const poolOf = (workers: readonly Worker[]) => {
  const near = workers.filter((one) => one.away === null)
  return {
    busy: near.reduce((sum, one) => sum + one.places.held.length, 0),
    of: near.reduce((sum, one) => sum + one.places.configured, 0),
    /** Where a task could start now: free and not closed for a while. */
    free: near.reduce((sum, one) => sum + Math.max(0, one.places.atOnce - one.places.held.length), 0),
    all: workers.reduce((sum, one) => sum + one.places.configured, 0),
    closed: workers.reduce(
      (sum, one) =>
        sum +
        (one.away !== null
          ? one.places.configured
          : Math.max(0, one.places.configured - Math.max(one.places.atOnce, one.places.held.length))),
      0,
    ),
  }
}

/** The places as the runtime gives them today, for the board as built: this computer's only. */
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

/** A task in Up next that can start only on one worker, and which: its row says so in place of the board's words. */
export interface Pinned {
  readonly taskId: string
  readonly worker: string
}

/** A task waiting to start, in any project: for a free place anywhere, or for the one computer it can start on. */
export interface Waiting {
  readonly taskId: string
  readonly title: string
  readonly project: string
  /** The computer it can start on alone, and why only there; null where any can take it. */
  readonly only: { readonly worker: string; readonly why: string } | null
  /** How long it has waited, in minutes. */
  readonly minutes: number
}

/** Up next in the other projects, behind Meridian's, while every place is taken. */
const ELSEWHERE = [
  { title: 'Bump Node to 24 in CI', project: 'Halyard' },
  { title: 'Fix the export dialog on small screens', project: 'Tessera' },
] as const

/**
 * What waits, by what the workers have free. Anything can start wherever a place is free, so with room anywhere only
 * work that can start on one worker alone waits: a local checkout on This Mac, a Linux build on build-box. With
 * every worker full, every project's line waits, in order, the first for longest.
 */
export const waitingOf = (workers: readonly Worker[], crowded: boolean): Waiting[] => {
  const anyRoom = workers.some((one) => !isFull(one))
  if (anyRoom)
    return workers.flatMap((one) => one.pinned.map((task) => ({ ...task, only: { worker: one.name, why: task.why }, minutes: 6 })))
  const meridian = [
    'Dark mode for Settings',
    'Show receipts in the customer portal',
    ...(crowded ? ['Retry failed payouts overnight', 'Let admins export every workspace setting as one file'] : []),
  ].map((title, i) => ({ taskId: `line-${i}`, title, project: 'Meridian' }))
  const others = ELSEWHERE.map((one, i) => ({ taskId: `else-${i}`, ...one }))
  const line = [meridian[0]!, others[0]!, ...meridian.slice(1), others[1]!]
  return line.map((one, i) => ({ ...one, only: null, minutes: Math.max(2, 25 - i * 7) }))
}

/** Up next on Meridian's board: its own waiting tasks, and which wait for one worker. */
const lineOf = (workers: readonly Worker[], crowded: boolean) => {
  const mine = waitingOf(workers, crowded).filter((one) => one.project === 'Meridian')
  return {
    titles: mine.map((one) => one.title),
    pinned: mine.flatMap((one): Pinned[] => (one.only === null ? [] : [{ taskId: one.taskId, worker: one.only.worker }])),
  }
}

/** Meridian's board: what runs there, what waits up next for a place, and a call. */
export const boardOf = (workers: readonly Worker[], crowded: boolean): { lanes: Lanes; pinned: readonly Pinned[] } => {
  const here = workers.filter((one) => one.away === null)
  const queued = { busy: poolOf(workers).busy, atOnce: here.reduce((sum, one) => sum + one.places.atOnce, 0) }
  const mine = here.flatMap((one) => one.places.held).filter((held) => held.project === 'Meridian')
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
  const { titles, pinned } = lineOf(workers, crowded)
  const line = titles.map((title, i) =>
    task({
      taskId: `line-${i}`,
      threadId: `th-line-${i}`,
      title,
      slug: `line-${i}`,
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
    workPlaces: workPlacesOf(thisMacOf(workers).places),
  } as BoardSnapshot
  return { lanes: lanesOf(snapshot), pinned }
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
  mac: { cpu: 0.52, memory: 0.94, pressure: MemoryPressure.Critical },
  full: { cpu: 0.78, memory: 0.7, pressure: MemoryPressure.Normal },
  away: { cpu: 0.45, memory: 0.6, pressure: MemoryPressure.Normal },
  cap: { cpu: 0.8, memory: 0.72, pressure: MemoryPressure.Normal },
  free: { cpu: 0.3, memory: 0.48, pressure: MemoryPressure.Normal },
  tight: { cpu: 0.93, memory: 0.68, pressure: MemoryPressure.Normal },
}

/** build-box's load, as it says it. */
const BOX_LOAD: Record<Scene, { cpu: number; memory: number }> = {
  mac: { cpu: 0.46, memory: 0.41 },
  full: { cpu: 0.71, memory: 0.63 },
  away: { cpu: 0, memory: 0 },
  cap: { cpu: 0.74, memory: 0.66 },
  free: { cpu: 0.18, memory: 0.22 },
  tight: { cpu: 0.64, memory: 0.91 },
}

/** The load meter's reading, this computer's: Althar's work on it by task, most CPU first. */
export const loadOf = (scene: Scene, places: Places, crowded: boolean): LoadGlance => {
  const now = LOAD[scene]
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
