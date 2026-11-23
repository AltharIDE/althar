import type { BoardSnapshot, BoardTask, ChangeSummary, Queued, ThreadSnapshot } from '@althar/contracts'
import { Brand, type LoadAgents, type LoadGlance, type LoadPoint, type LoadRow, MemoryPressure } from '@althar/ui'

import { lanesOf, type Lanes } from '../../src/renderer/features/board/lanes'
import { card, change, items, snapshot } from '../../tests/fixtures'

/*
 * What the lab draws from, made up and the same on every load: one project's
 * board (Meridian), This Mac's load and agents, and the thread of the task
 * first in line. In each scene this Mac lets some number of agents work at
 * once, fewer than the person's number while memory or the CPU is under
 * pressure, and the tasks in line that would be at work but for that are
 * held back: the first `configured - busy` of them. What waits beyond those
 * waits for an agent to finish anyway.
 */

export const NOW = '2026-11-23T21:10:00.000Z'

export const SCENES = [
  { key: 'memory', label: 'Memory', idea: 'Memory under pressure: 1 at a time of 4, two tasks held back' },
  {
    key: 'cpu',
    label: 'CPU',
    idea: 'The CPU under pressure: 2 at a time of 4, a review that goes on and a task held back, two more in line',
  },
  { key: 'crowded', label: 'Crowded', idea: 'Memory, 2 at a time of 8, six held back with long titles, two going on' },
  { key: 'calm', label: 'Calm', idea: 'Nothing held back: every agent of 4 busy, two in line, as today' },
] as const
export type Scene = (typeof SCENES)[number]['key']

export type Why = 'memory' | 'cpu'

/** This Mac's agents in a scene: the person's number, how many may work for now and why fewer, and the tasks at work. */
interface Pace {
  configured: number
  atOnce: number
  why: Why | null
}

interface Line {
  id: string
  title: string
  /** Under way already: it goes on with a step (Review), rather than starts. */
  continues?: string
}

interface Work {
  id: string
  title: string
  step: 'implement' | 'review' | 'checks_running' | 'merge_queue'
  /** Its agent is at work, holding a place. */
  agent: boolean
  pr?: number
  add?: number
  del?: number
  checks?: [passed: number, total: number]
  /** Started anyway, just now, by the person. */
  now?: boolean
}

interface Draft {
  pace: Pace
  running: Work[]
  line: Line[]
  memory: number
  cpu: number
}

const RUNNING: Work[] = [
  { id: 'webhooks', title: 'Sign outgoing webhooks', step: 'checks_running', agent: false, pr: 412, add: 318, del: 41, checks: [30, 48] },
  { id: 'audit', title: 'Paginate the audit log', step: 'merge_queue', agent: false, pr: 409, add: 355, del: 115, checks: [39, 39] },
  { id: 'emails', title: 'Translate the welcome emails', step: 'implement', agent: true },
]

const DRAFTS: Record<Scene, Draft> = {
  memory: {
    pace: { configured: 4, atOnce: 1, why: 'memory' },
    running: RUNNING,
    line: [
      { id: 'worker', title: 'Add a worker as easily as connecting a home' },
      { id: 'receipts', title: 'Show receipts in the customer portal' },
    ],
    memory: 0.93,
    cpu: 0.46,
  },
  cpu: {
    pace: { configured: 4, atOnce: 2, why: 'cpu' },
    running: [...RUNNING, { id: 'vite', title: 'Upgrade to Vite 8', step: 'implement', agent: true }],
    line: [
      { id: 'login', title: 'Fix the login redirect', continues: 'Review' },
      { id: 'worker', title: 'Add a worker as easily as connecting a home' },
      { id: 'receipts', title: 'Show receipts in the customer portal' },
      { id: 'payouts', title: 'Retry failed payouts overnight' },
    ],
    memory: 0.61,
    cpu: 0.97,
  },
  crowded: {
    pace: { configured: 8, atOnce: 2, why: 'memory' },
    running: [
      ...RUNNING,
      { id: 'vite', title: 'Upgrade to Vite 8 and move the test runner to its browser mode', step: 'implement', agent: true },
    ],
    line: [
      { id: 'login', title: 'Fix the login redirect after an SSO sign-in times out on Safari', continues: 'Review' },
      { id: 'flaky', title: 'Fix the flaky checkout test that times out when the payment sandbox is slow', continues: '' },
      { id: 'worker', title: 'Add a worker as easily as connecting a home, with the same QR and nothing to type' },
      { id: 'receipts', title: 'Show receipts in the customer portal, with a download for each month' },
      { id: 'payouts', title: 'Retry failed payouts overnight and tell the finance channel what was retried' },
      { id: 'seed', title: 'Seed the staging database with a month of anonymised orders' },
      { id: 'export', title: 'Fix the export dialog on small screens, where its buttons fall off the edge' },
    ],
    memory: 0.95,
    cpu: 0.58,
  },
  calm: {
    pace: { configured: 4, atOnce: 4, why: null },
    running: [
      ...RUNNING,
      { id: 'vite', title: 'Upgrade to Vite 8', step: 'implement', agent: true },
      { id: 'login', title: 'Fix the login redirect', step: 'review', agent: true },
      { id: 'flaky', title: 'Fix the flaky checkout test', step: 'implement', agent: true },
    ],
    line: [
      { id: 'worker', title: 'Add a worker as easily as connecting a home' },
      { id: 'receipts', title: 'Show receipts in the customer portal' },
    ],
    memory: 0.58,
    cpu: 0.52,
  },
}

/** Plans the person holds, under Planned, whatever the scene: what the person's own board had. */
const PLANS = [
  { id: 'stream', title: 'The coordinator’s reply streams in place, with no jumps' },
  { id: 'brief', title: 'Slim the coordinator’s brief' },
]

/** Agents of other projects, at work on this Mac too: the number counts every agent, wherever its project. */
const ELSEWHERE: Record<Scene, number> = { memory: 0, cpu: 0, crowded: 0, calm: 0 }

/** The scene as it stands, with the tasks the person started anyway (`started`), each now at work past the number. */
export interface World {
  scene: Scene
  configured: number
  atOnce: number
  why: Why | null
  busy: number
  /** The tasks in line, in their order, without those started. */
  line: readonly Line[]
  /** Of the line, those held back: they would be at work now but for the pressure. */
  held: readonly string[]
  running: readonly Work[]
  memory: number
  cpu: number
}

export const worldOf = (scene: Scene, started: readonly string[]): World => {
  const draft = DRAFTS[scene]
  const going = draft.line.filter((one) => started.includes(one.id))
  const line = draft.line.filter((one) => !started.includes(one.id))
  const running: Work[] = [
    ...draft.running,
    ...going.map((one): Work => ({
      id: one.id,
      title: one.title,
      step: one.continues === undefined ? 'implement' : 'review',
      agent: true,
      now: true,
    })),
  ]
  const busy = running.filter((one) => one.agent).length + ELSEWHERE[scene]
  const { configured, atOnce, why } = draft.pace
  // Those that would start now with the person's number: as many as it has room for beyond the busy ones.
  const room = why === null ? 0 : Math.max(0, configured - Math.max(busy, atOnce))
  return {
    scene,
    configured,
    atOnce,
    why,
    busy,
    line,
    held: line.slice(0, room).map((one) => one.id),
    running,
    memory: draft.memory,
    cpu: draft.cpu,
  }
}

/* ---- the board ------------------------------------------------------------------------------------------ */

const task = (overrides: Partial<BoardTask>): BoardTask => ({
  ...card(),
  state: 'open',
  createdAt: '2026-11-23T19:00:00.000Z',
  settledAt: null,
  changed: null,
  here: [],
  ...overrides,
})

const checksOf = ([passed, total]: [number, number]): ChangeSummary['checks'] => ({
  outcome: passed === total ? 'passed' : 'running',
  passed,
  failed: 0,
  running: total - passed,
  total,
  failing: [],
  list: [],
})

export const queuedOf = (world: World): Queued => ({ busy: world.busy, atOnce: world.atOnce, configured: world.configured })

/** Meridian's board: what runs, what waits in line for an agent, the plans the person holds, and something settled. */
export const boardOf = (world: World): Lanes => {
  const queued = queuedOf(world)
  const running = world.running.map((one, i) =>
    task({
      taskId: one.id,
      threadId: `th-${one.id}`,
      title: one.title,
      slug: one.id,
      branch: `althar/${one.id}`,
      phase: 'running',
      step: one.step,
      startedAt:
        one.now === true ? NOW : `2026-11-23T${String(18 + (i % 3)).padStart(2, '0')}:${String(10 + i * 7).padStart(2, '0')}:00.000Z`,
      ...(one.pr === undefined
        ? {}
        : {
            change: change({
              number: one.pr,
              title: one.title,
              url: `https://github.com/meridian/api/pull/${one.pr}`,
              draft: false,
              repository: 'meridian/api',
              additions: one.add ?? 0,
              deletions: one.del ?? 0,
              checks: one.checks === undefined ? null : checksOf(one.checks),
              ...(one.step === 'merge_queue' ? { queued: true } : {}),
            }),
          }),
    }),
  )
  const line = world.line.map((one, i) =>
    task({
      taskId: one.id,
      threadId: `th-${one.id}`,
      title: one.title,
      slug: one.id,
      phase: 'running',
      queued,
      place: i + 1,
      ...(one.continues === undefined
        ? { inLine: true }
        : { continues: true, step: one.continues === 'Review' ? 'review' : 'implement', startedAt: '2026-11-23T17:40:00.000Z' }),
      createdAt: `2026-11-23T19:${String(10 + i).padStart(2, '0')}:00.000Z`,
    }),
  )
  const plans = PLANS.map((one, i) =>
    task({
      taskId: one.id,
      threadId: `th-${one.id}`,
      title: one.title,
      slug: one.id,
      phase: 'held',
      plan: { ...card().plan!, id: `plan-${one.id}`, startsAt: null },
      createdAt: `2026-11-23T20:${String(10 + i).padStart(2, '0')}:00.000Z`,
    }),
  )
  const settled = task({
    taskId: 'done-1',
    threadId: 'th-done-1',
    title: 'Retry webhooks with backoff',
    slug: 'retry-webhooks',
    branch: 'althar/retry-webhooks',
    phase: 'settled',
    state: 'done',
    settledAt: '2026-11-23T16:40:00.000Z',
  })
  const snapshot = { cursor: 1, tasks: [...running, ...line, ...plans, settled], calls: [], settledTotal: 1 } as BoardSnapshot
  return lanesOf(snapshot)
}

/* ---- This Mac --------------------------------------------------------------------------------------------- */

export const SLOTS = 40

const grain = (i: number) => Math.sin(i * 1.7) * 0.5 + Math.sin(i * 0.43 + 1) * 0.5
const historyTo = (to: LoadPoint): LoadPoint[] =>
  Array.from({ length: SLOTS }, (_, i) => {
    if (i === SLOTS - 1) return to
    const k = i / (SLOTS - 1) < 0.55 ? 0.7 : 0.7 + (i / (SLOTS - 1) - 0.55) * 0.66
    const cpu = Math.min(1, Math.max(0, to.cpu * k + grain(i) * 0.05))
    return { cpu, work: Math.min(cpu, Math.max(0, to.work * k + grain(i) * 0.03)) }
  })

const SHARE: Record<string, { cpu: number; memory: number }> = {
  emails: { cpu: 0.14, memory: 2.6 },
  vite: { cpu: 0.31, memory: 3.4 },
  login: { cpu: 0.08, memory: 1.9 },
  flaky: { cpu: 0.1, memory: 1.4 },
  worker: { cpu: 0.12, memory: 2.1 },
  receipts: { cpu: 0.09, memory: 1.7 },
  webhooks: { cpu: 0.01, memory: 2.8 },
}

const ALTHAR: LoadRow = { id: 'althar', title: 'Althar', opens: false, cpu: 0.03, memory: '0.7 GB', processes: 6 }

/** This Mac's reading, as the bar's meter and its popover draw it: its work by task, most CPU first. */
export const loadOf = (world: World): LoadGlance => {
  const total = 32
  const rows: LoadRow[] = world.running
    .filter((one) => one.agent || one.id === 'webhooks')
    .map((one) => {
      const share = SHARE[one.id] ?? { cpu: 0.06, memory: 1.2 }
      return {
        id: one.id,
        title: one.title,
        project: 'Meridian',
        agent: 'Claude Code',
        mark: Brand.ClaudeCode,
        cpu: world.why === 'cpu' ? share.cpu * 2 : share.cpu,
        memory: `${share.memory.toFixed(1)} GB`,
        processes: one.id === 'webhooks' ? 3 : 9,
      }
    })
  const all = [...rows, ALTHAR].toSorted((a, b) => b.cpu - a.cpu)
  const work = Math.min(
    world.cpu,
    all.reduce((sum, row) => sum + row.cpu, 0),
  )
  return {
    cpu: world.cpu,
    work,
    memory: world.memory,
    workMemory: Math.min(world.memory, all.reduce((sum, row) => sum + Number.parseFloat(row.memory), 0) / total),
    memoryUsed: `${(world.memory * total).toFixed(1)} GB`,
    memoryTotal: `${total} GB`,
    pressure: world.memory > 0.9 ? MemoryPressure.Warning : MemoryPressure.Normal,
    rows: all,
    history: historyTo({ cpu: world.cpu, work }),
  }
}

export const agentsOf = (world: World): LoadAgents => ({
  busy: world.busy,
  configured: world.configured,
  atOnce: world.atOnce,
  why: world.why,
  waiting: world.line.length,
})

/* ---- the task first in line --------------------------------------------------------------------------- */

/** The thread of the task first in line, as its own view reads it: waiting for an agent, nothing said yet but its brief. */
export const threadOf = (world: World): ThreadSnapshot => {
  const first = world.line[0] ?? { id: 'worker', title: 'Add a worker as easily as connecting a home' }
  const base = snapshot()
  return snapshot({
    threadId: `th-${first.id}`,
    project: { id: 'meridian', name: 'Meridian' },
    task: {
      ...base.task,
      id: first.id,
      title: first.title,
      slug: first.id,
      branch: `althar/${first.id}`,
      worktree: `/Users/you/Charrette/meridian/${first.id}`,
      phase: 'running',
      queued: {
        ...queuedOf(world),
        holders: world.running
          .filter((one) => one.agent)
          .map((one) => ({ taskId: one.id, title: one.title, threadId: `th-${one.id}`, kept: false, running: [] })),
      },
      place: 1,
      front: false,
      steps: [
        { key: 'implement', agentId: 'claude-code', model: 'opus', skipped: false },
        { key: 'review', agentId: 'codex', model: null, skipped: false },
      ] as ThreadSnapshot['task']['steps'],
    } as ThreadSnapshot['task'],
    session: null,
    items: [
      items.you(
        'Adding a worker should be as easy as connecting a home: scan the QR on the worker, and it joins, with nothing to type. Keep Settings › Computers as it is.',
      ),
    ],
  })
}
