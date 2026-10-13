import type { BoardSnapshot, BoardTask, HomeSnapshot, HomeTask, ThreadSnapshot } from '@althar/contracts'

import { card, change, home, project, snapshot } from '../../tests/fixtures'
import type { Direction, InLine, Scene } from './scene'
import { upNext } from './words'

/*
 * One project, meridian, on a Mac that runs four agents at once, all four
 * busy; the work that waits, as the runtime would give it, in each state the
 * brief asks for. Waiting work's `queued` carries its place in line, as
 * Queries would add it from Busy's queue.
 */

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()

const PLAN_STEPS = card().plan!.steps
const STEP = { implement: 'Implement', review: 'Review' } as const

const task = (n: number, slug: string, title: string, overrides: Partial<BoardTask> = {}): BoardTask => ({
  ...card({
    taskId: `t${n}`,
    threadId: `th${n}`,
    slug,
    title,
    branch: `althar/${slug}`,
    lead: 'claude-code',
    leadModel: 'opus',
    phase: 'running',
    step: 'implement',
    plan: { id: `pln${n}`, steps: PLAN_STEPS, startsAt: null, reason: null, end: 'draft' },
  }),
  state: 'open',
  createdAt: minutesAgo(300 - n),
  settledAt: null,
  changed: null,
  here: [],
  ...overrides,
})

/* Four at work: this Mac's four. */
const running = [
  task(1, 'rate-limit-partner-api', 'Rate-limit the partner API', { startedAt: minutesAgo(34) }),
  task(2, 'export-refund-ledger', 'Export the refund ledger as CSV', { step: 'review', startedAt: minutesAgo(52) }),
  task(3, 'move-charges-http-client', 'Move charges to the new HTTP client', {
    startedAt: minutesAgo(12),
    lead: 'codex',
    leadModel: 'gpt-5.2-codex',
  }),
  task(4, 'fix-flaky-checkout-test', 'Fix the flaky checkout test', { step: 'review', startedAt: minutesAgo(21) }),
]

/* What waits, not started: its plan's first step waits for a place, so it is running to the runtime. */
const fresh = {
  w1: task(5, 'webhook-retry', 'Add a retry to webhook delivery'),
  w2: task(6, 'split-invoices-module', 'Split the invoices module', { lead: 'codex', leadModel: 'gpt-5.2-codex' }),
  w3: task(7, 'upgrade-stripe-sdk', 'Upgrade the Stripe SDK to v18'),
}

/* Under way, its lead asked a question; the person answered while all four were busy, so the answer waits for a place. */
const midway = task(8, 'cache-exchange-rates', 'Cache exchange rates for a day', { startedAt: minutesAgo(40) })

const planned = task(9, 'rename-billing-flag', 'Rename the billing feature flag', {
  phase: 'planned',
  step: null,
  plan: { id: 'pln9', steps: PLAN_STEPS, startsAt: new Date(Date.now() + 18_000).toISOString(), reason: null, end: 'draft' },
})
const held = task(10, 'drop-legacy-coupons', 'Drop the legacy coupons table', { phase: 'held', step: null })

const settled = task(11, 'log-refund-partner', 'Log refunds with their partner id', {
  phase: 'settled',
  step: null,
  state: 'done',
  startedAt: minutesAgo(200),
  settledAt: minutesAgo(130),
  change: change({ number: 418, state: 'merged', draft: false }),
})

/** Its place in line, carried where the runtime has only room for `Queued`. */
const line = (q: InLine): BoardTask['queued'] => q

/** Waiting, in its place, under way or not. */
const waits = (one: BoardTask, place: number, direction: Direction, started = false): BoardTask => ({
  ...one,
  queued: line({ busy: 4, atOnce: 4, place, started, step: STEP[(one.step ?? 'implement') as 'implement'], direction }),
  ...(started ? {} : { planWaits: true }),
})

export interface State {
  readonly key: string
  readonly name: string
  /** The board's work, waiting work with its place, in a direction. */
  readonly tasks: (direction: Direction) => ReadonlyArray<BoardTask>
  /** What just started. */
  readonly fresh?: string
}

const ready4 = task(4, 'fix-flaky-checkout-test', 'Fix the flaky checkout test', {
  phase: 'ready',
  step: null,
  startedAt: minutesAgo(21),
  change: change({
    number: 421,
    title: 'Fix the flaky checkout test',
    draft: false,
    checks: { outcome: 'passed', passed: 5, failed: 0, running: 0, total: 5, failing: [], list: [] },
  }),
})

export const states: ReadonlyArray<State> = [
  { key: 'one', name: 'One waiting', tasks: (d) => [...running, waits(fresh.w1, 1, d), settled] },
  {
    key: 'three',
    name: 'Three waiting, in order',
    tasks: (d) => [...running, waits(fresh.w1, 1, d), waits(fresh.w2, 2, d), waits(fresh.w3, 3, d), settled],
  },
  {
    key: 'mixed',
    name: 'Waiting beside a planned and a held task',
    tasks: (d) => [...running, waits(fresh.w1, 1, d), waits(fresh.w2, 2, d), planned, held, settled],
  },
  {
    key: 'midway',
    name: 'A task under way whose next turn waits',
    tasks: (d) => [...running, waits(fresh.w1, 1, d), waits(midway, 2, d, true), settled],
  },
  {
    key: 'freed',
    name: 'An agent frees: the first in line starts',
    // Fix the flaky checkout test finished its review: its place went to the first in line, and the rest moved up.
    tasks: (d) => [
      ...running.slice(0, 3),
      { ...fresh.w1, startedAt: minutesAgo(0.2) },
      waits(fresh.w2, 1, d),
      waits(fresh.w3, 2, d),
      ready4,
      settled,
    ],
    fresh: fresh.w1.slug,
  },
]

export const boardOf = (tasks: ReadonlyArray<BoardTask>): BoardSnapshot => ({ cursor: 1, tasks, calls: [] })

/** The board's lanes as the direction lays them out: waiting work first up next, in its order, where it goes there. */
export const sceneOf = (state: State, direction: Direction): Scene => {
  const tasks = state.tasks(direction)
  const line = (one: BoardTask) => one.queued as InLine | null
  const waiting = tasks.filter((one) => line(one) !== null && upNext(line(one)!)).toSorted((a, b) => line(a)!.place - line(b)!.place)
  const rest = tasks
    .filter((one) => one.phase === 'planned' || one.phase === 'held')
    .toSorted((a, b) => (a.plan?.startsAt ?? '￿').localeCompare(b.plan?.startsAt ?? '￿'))
  return {
    direction,
    tasks,
    next: [...waiting, ...rest].map((one) => one.slug),
    ...(state.fresh === undefined ? {} : { fresh: state.fresh }),
  }
}

/* The home: meridian's four running, two waiting to start and one under way waiting for a turn; atlas has a pull request ready. */
const atlas = { ...project, id: 'p2', name: 'atlas', slug: 'atlas', ink: 'rose' as const, lastWorkAt: minutesAgo(30) }

export const homeOf = (direction: Direction): HomeSnapshot => {
  const counts = { fresh: 2, under: 1 }
  const at = (one: BoardTask, projectId = 'p1'): HomeTask => {
    const q = one.queued as InLine | null
    return { ...one, projectId, ...(q === null ? {} : { queued: { ...q, ...counts } }) }
  }
  return home({
    looked: minutesAgo(90),
    projects: [{ ...project, lastWorkAt: minutesAgo(2) }, atlas],
    tasks: [
      ...running.map((one) => at(one)),
      at(waits(fresh.w1, 1, direction)),
      at(waits(midway, 2, direction, true)),
      at(waits(fresh.w2, 3, direction)),
      at(
        task(12, 'search-by-merchant', 'Search payouts by merchant', {
          phase: 'ready',
          step: null,
          startedAt: minutesAgo(70),
          change: change({ number: 77, title: 'Search payouts by merchant', draft: false, repository: 'atlas/web' }),
        }),
        'p2',
      ),
    ],
  })
}

/** A waiting task's own screen, as GetThread gives it: not started, or under way. */
export const threadOf = (direction: Direction, started: boolean): ThreadSnapshot => {
  const one = started ? waits(midway, 2, direction, true) : waits(fresh.w1, 1, direction)
  return snapshot({
    threadId: one.threadId,
    task: {
      ...snapshot().task,
      id: one.taskId,
      title: one.title,
      slug: one.slug,
      branch: one.branch,
      phase: 'running',
      queued: one.queued,
      step: 'implement',
      startedAt: one.startedAt,
      steps: PLAN_STEPS.map((step) => ({ ...step, effort: null })),
    },
    session: started ? { ...snapshot().session!, turnRunning: false } : null,
  })
}

/** The card the coordinator posted for a waiting task, in the project's conversation. */
export const cardOf = (direction: Direction) => {
  const one = waits(fresh.w1, 1, direction)
  return card({ ...one, plan: { ...one.plan!, reason: 'It wrote the webhook sender.' }, planWaits: true })
}
