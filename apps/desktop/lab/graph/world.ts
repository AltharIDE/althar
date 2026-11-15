/*
 * The lab's world: requests the coordinator split into tasks, each task with
 * what it depends on, and a simulation of the work as it would run. A task
 * waits until every task it depends on has merged, starts by itself, works,
 * is reviewed, opens its pull request, runs its checks, and waits for the
 * person to merge it. Some ask the person something on the way; one fails a
 * check and fixes it; one fails for good and leaves what depends on it
 * stuck. The person's moves (start now, stop waiting for one, hold, answer,
 * merge, try again) are kept with the time they were made, so the whole
 * thing is a pure function of the time: scrubbing back replays it.
 *
 * Time is in minutes of work. The page plays it at a minute a second, times
 * its speed.
 */

export type ScenarioKey = 'two' | 'six' | 'twelve'

export interface TaskSpec {
  readonly key: string
  readonly title: string
  /** A word or two, where the graph is drawn small. */
  readonly short: string
  readonly deps: ReadonlyArray<string>
  readonly lead: 'claude-code' | 'codex'
  readonly model: string
  readonly pr: number
  /** Minutes each part takes. `ready` is how long the person takes to merge, where they don't press Merge. */
  readonly takes: { readonly implement: number; readonly review: number; readonly checks: number; readonly ready: number }
  /** Asks the person something, this far into implementing, and is answered after `for` where nobody presses. */
  readonly asks?: { readonly after: number; readonly for: number; readonly what: string; readonly command: string }
  /** A check fails once, and the lead fixes it in this long. */
  readonly flaky?: { readonly fix: number; readonly check: string }
  /** A check fails and the lead can't fix it: it stops, and waits for the person. */
  readonly breaks?: { readonly check: string }
}

export interface Scenario {
  readonly key: ScenarioKey
  /** The request, in a few words: what the graph is called. */
  readonly name: string
  /** What the person asked, in their words. */
  readonly asked: string
  /** What the coordinator answered, splitting it. */
  readonly answer: string
  readonly tasks: ReadonlyArray<TaskSpec>
}

const opus = 'claude-opus-5-5'
const sol = 'gpt-6.1-sol'

export const SCENARIOS: Readonly<Record<ScenarioKey, Scenario>> = {
  two: {
    key: 'two',
    name: 'Rename plans to tiers',
    asked: 'Rename plans to tiers everywhere, the API first and then the dashboard.',
    answer: 'Two tasks: the API and its schema first, then the dashboard once that merges, so it builds on the new names.',
    tasks: [
      {
        key: 'api',
        title: 'Rename plans to tiers in the API',
        short: 'API',
        deps: [],
        lead: 'claude-code',
        model: opus,
        pr: 431,
        takes: { implement: 11, review: 5, checks: 4, ready: 3 },
      },
      {
        key: 'dashboard',
        title: 'Rename plans to tiers in the dashboard',
        short: 'Dashboard',
        deps: ['api'],
        lead: 'claude-code',
        model: opus,
        pr: 434,
        takes: { implement: 9, review: 4, checks: 4, ready: 3 },
      },
    ],
  },
  six: {
    key: 'six',
    name: 'Pay in instalments',
    asked:
      'Let customers pay in instalments: plans in the schema, an API for them, charging each one when it’s due, checkout offering them, receipts listing them, and a guide in the docs.',
    answer:
      'Six tasks. The schema goes first; the API and charging start when it merges. Checkout follows the API, receipts follow both, and the guide comes last.',
    tasks: [
      {
        key: 'schema',
        title: 'Instalment plans in the schema',
        short: 'Schema',
        deps: [],
        lead: 'claude-code',
        model: opus,
        pr: 412,
        takes: { implement: 7, review: 4, checks: 3, ready: 3 },
      },
      {
        key: 'api',
        title: 'API for instalment plans',
        short: 'API',
        deps: ['schema'],
        lead: 'claude-code',
        model: opus,
        pr: 415,
        takes: { implement: 12, review: 5, checks: 4, ready: 3 },
      },
      {
        key: 'charges',
        title: 'Charge each instalment when it’s due',
        short: 'Charges',
        deps: ['schema'],
        lead: 'codex',
        model: sol,
        pr: 416,
        takes: { implement: 10, review: 5, checks: 4, ready: 4 },
        asks: { after: 4, for: 9, what: 'Asks to run docker compose up', command: 'docker compose up -d queue' },
      },
      {
        key: 'checkout',
        title: 'Offer instalments at checkout',
        short: 'Checkout',
        deps: ['api'],
        lead: 'claude-code',
        model: opus,
        pr: 419,
        takes: { implement: 13, review: 5, checks: 4, ready: 3 },
        flaky: { fix: 5, check: 'e2e' },
      },
      {
        key: 'receipts',
        title: 'Receipts list each instalment',
        short: 'Receipts',
        deps: ['api', 'charges'],
        lead: 'codex',
        model: sol,
        pr: 421,
        takes: { implement: 8, review: 4, checks: 4, ready: 3 },
      },
      {
        key: 'docs',
        title: 'A guide to instalments in the docs',
        short: 'Docs',
        deps: ['checkout', 'receipts'],
        lead: 'claude-code',
        model: opus,
        pr: 424,
        takes: { implement: 6, review: 3, checks: 3, ready: 3 },
      },
    ],
  },
  twelve: {
    key: 'twelve',
    name: 'Billing on the new ledger',
    asked:
      'Move billing onto the new ledger: its tables, importing the old invoices, charges and refunds writing to it, invoices and balances reading from it, webhooks, reconciliation, the dashboard, then drop the old tables and write it up.',
    answer:
      'Twelve tasks. The ledger’s tables go first; the import and the API client start when they merge, and the rest follow what they read or write. Dropping the old tables waits for everything that still reads them.',
    tasks: [
      {
        key: 'tables',
        title: 'Ledger tables and migrations',
        short: 'Tables',
        deps: [],
        lead: 'claude-code',
        model: opus,
        pr: 501,
        takes: { implement: 8, review: 4, checks: 3, ready: 2 },
      },
      {
        key: 'import',
        title: 'Import old invoices into the ledger',
        short: 'Import',
        deps: ['tables'],
        lead: 'codex',
        model: sol,
        pr: 503,
        takes: { implement: 11, review: 4, checks: 4, ready: 3 },
        breaks: { check: 'migrations' },
      },
      {
        key: 'client',
        title: 'Ledger client in the API',
        short: 'Client',
        deps: ['tables'],
        lead: 'claude-code',
        model: opus,
        pr: 504,
        takes: { implement: 9, review: 4, checks: 3, ready: 2 },
      },
      {
        key: 'charges',
        title: 'Charges write to the ledger',
        short: 'Charges',
        deps: ['client'],
        lead: 'claude-code',
        model: opus,
        pr: 507,
        takes: { implement: 10, review: 4, checks: 3, ready: 3 },
        asks: { after: 3, for: 8, what: 'Asks to run the payments sandbox', command: 'stripe listen --forward-to localhost:4000' },
      },
      {
        key: 'refunds',
        title: 'Refunds write to the ledger',
        short: 'Refunds',
        deps: ['client'],
        lead: 'codex',
        model: sol,
        pr: 508,
        takes: { implement: 8, review: 4, checks: 3, ready: 2 },
      },
      {
        key: 'invoices',
        title: 'Invoices read from the ledger',
        short: 'Invoices',
        deps: ['import', 'client'],
        lead: 'claude-code',
        model: opus,
        pr: 510,
        takes: { implement: 9, review: 4, checks: 3, ready: 2 },
      },
      {
        key: 'balance',
        title: 'Balance endpoint',
        short: 'Balance',
        deps: ['charges', 'refunds'],
        lead: 'claude-code',
        model: opus,
        pr: 512,
        takes: { implement: 7, review: 3, checks: 3, ready: 2 },
      },
      {
        key: 'webhooks',
        title: 'Webhooks from ledger events',
        short: 'Webhooks',
        deps: ['charges'],
        lead: 'codex',
        model: sol,
        pr: 513,
        takes: { implement: 8, review: 4, checks: 3, ready: 2 },
        flaky: { fix: 4, check: 'integration' },
      },
      {
        key: 'reconcile',
        title: 'Nightly reconciliation job',
        short: 'Reconcile',
        deps: ['import', 'charges', 'refunds'],
        lead: 'claude-code',
        model: opus,
        pr: 515,
        takes: { implement: 10, review: 4, checks: 3, ready: 2 },
      },
      {
        key: 'dashboard',
        title: 'Ledger view in the dashboard',
        short: 'Dashboard',
        deps: ['invoices', 'balance'],
        lead: 'claude-code',
        model: opus,
        pr: 518,
        takes: { implement: 11, review: 4, checks: 3, ready: 2 },
      },
      {
        key: 'drop',
        title: 'Drop the old billing tables',
        short: 'Drop old',
        deps: ['invoices', 'dashboard', 'reconcile'],
        lead: 'claude-code',
        model: opus,
        pr: 521,
        takes: { implement: 5, review: 3, checks: 3, ready: 2 },
      },
      {
        key: 'guide',
        title: 'A guide to the ledger in the docs',
        short: 'Guide',
        deps: ['balance', 'webhooks'],
        lead: 'claude-code',
        model: opus,
        pr: 522,
        takes: { implement: 6, review: 3, checks: 2, ready: 2 },
      },
    ],
  },
}

/* ——— the simulation ——— */

export type Phase = 'waits' | 'starting' | 'implement' | 'asks' | 'review' | 'checks' | 'fixing' | 'failed' | 'ready' | 'merged'

/** What the person did, and when. */
export type Move =
  | { readonly at: number; readonly kind: 'start'; readonly key: string }
  | { readonly at: number; readonly kind: 'unlink'; readonly key: string; readonly dep: string }
  | { readonly at: number; readonly kind: 'hold'; readonly key: string }
  | { readonly at: number; readonly kind: 'release'; readonly key: string }
  | { readonly at: number; readonly kind: 'answer'; readonly key: string }
  | { readonly at: number; readonly kind: 'merge'; readonly key: string }
  | { readonly at: number; readonly kind: 'retry'; readonly key: string }

export interface TaskNow {
  readonly key: string
  readonly phase: Phase
  /** When it came into this phase. */
  readonly since: number
  /** What it depends on now: the person may have taken one away. */
  readonly deps: ReadonlyArray<string>
  /** Held by the person: it won't start until they say. */
  readonly held: boolean
  /** When it started work; null before. */
  readonly startedAt: number | null
  readonly mergedAt: number | null
  /** It failed a check once already and fixed it. */
  readonly fixedOnce: boolean
  /** The pull request is open: after its review. */
  readonly prOpen: boolean
}

export interface WorldNow {
  readonly t: number
  readonly tasks: ReadonlyArray<TaskNow>
  /** Every task merged. */
  readonly done: boolean
  /** When anything last changed phase. */
  readonly lastChange: number
}

/** How long a task counts down before it starts by itself, once nothing holds it. */
const STARTING = 1.5
/** The simulation's step. */
const STEP = 0.25

interface Mutable {
  key: string
  phase: Phase
  since: number
  deps: string[]
  held: boolean
  startedAt: number | null
  mergedAt: number | null
  fixedOnce: boolean
  asked: boolean
  prOpen: boolean
  /** Minutes worked in the current phase; asking pauses implementing. */
  worked: number
  /** Started by the person, whatever it waits for. */
  forced: boolean
}

export function simulate(scenario: Scenario, moves: ReadonlyArray<Move>, until: number): WorldNow {
  const specs = new Map(scenario.tasks.map((one) => [one.key, one]))
  const tasks: Mutable[] = scenario.tasks.map((one) => ({
    key: one.key,
    phase: 'waits',
    since: 0,
    deps: [...one.deps],
    held: false,
    startedAt: null,
    mergedAt: null,
    fixedOnce: false,
    asked: false,
    prOpen: false,
    worked: 0,
    forced: false,
  }))
  const byKey = new Map(tasks.map((one) => [one.key, one]))
  const sorted = moves.toSorted((a, b) => a.at - b.at)
  let next = 0
  let lastChange = 0
  const go = (task: Mutable, phase: Phase, t: number) => {
    task.phase = phase
    task.since = t
    task.worked = 0
    lastChange = t
  }
  const apply = (move: Move, t: number) => {
    const task = byKey.get(move.key)
    if (task === undefined) return
    switch (move.kind) {
      case 'start':
        if (task.phase === 'waits') {
          task.forced = true
          task.held = false
          go(task, 'implement', t)
          task.startedAt = t
        }
        return
      case 'unlink':
        task.deps = task.deps.filter((one) => one !== move.dep)
        return
      case 'hold':
        if (task.phase === 'waits' || task.phase === 'starting') {
          task.held = true
          go(task, 'waits', t)
        }
        return
      case 'release':
        task.held = false
        return
      case 'answer':
        if (task.phase === 'asks') {
          task.asked = true
          task.phase = 'implement'
          task.since = t
        }
        return
      case 'merge':
        if (task.phase === 'ready') {
          go(task, 'merged', t)
          task.mergedAt = t
        }
        return
      case 'retry':
        if (task.phase === 'failed') go(task, 'fixing', t)
        return
    }
  }
  for (let t = 0; t <= until + 1e-9; t += STEP) {
    while (next < sorted.length && (sorted[next] as Move).at <= t + 1e-9) {
      apply(sorted[next] as Move, t)
      next += 1
    }
    for (const task of tasks) {
      const spec = specs.get(task.key) as TaskSpec
      const elapsed = t - task.since
      switch (task.phase) {
        case 'waits': {
          if (task.held) break
          const ready = task.deps.every((dep) => byKey.get(dep)?.phase === 'merged')
          if (ready) go(task, 'starting', t)
          break
        }
        case 'starting':
          if (elapsed >= STARTING) {
            go(task, 'implement', t)
            task.startedAt = t
          }
          break
        case 'implement':
          task.worked += STEP
          if (spec.asks !== undefined && !task.asked && task.worked >= spec.asks.after) {
            task.phase = 'asks'
            task.since = t
            break
          }
          if (task.worked >= spec.takes.implement) go(task, 'review', t)
          break
        case 'asks':
          if (spec.asks !== undefined && elapsed >= spec.asks.for) {
            task.asked = true
            task.phase = 'implement'
            task.since = t
          }
          break
        case 'review':
          if (elapsed >= spec.takes.review) {
            go(task, 'checks', t)
            task.prOpen = true
          }
          break
        case 'checks':
          if (elapsed >= spec.takes.checks) {
            if (spec.flaky !== undefined && !task.fixedOnce) {
              go(task, 'fixing', t)
              task.fixedOnce = true
            } else if (spec.breaks !== undefined && !task.fixedOnce) {
              go(task, 'failed', t)
              task.fixedOnce = true
            } else go(task, 'ready', t)
          }
          break
        case 'fixing':
          if (elapsed >= (spec.flaky?.fix ?? 5)) go(task, 'checks', t)
          break
        case 'failed':
          break
        case 'ready':
          if (elapsed >= spec.takes.ready) {
            go(task, 'merged', t)
            task.mergedAt = t
          }
          break
        case 'merged':
          break
      }
    }
  }
  return {
    t: until,
    tasks: tasks.map((one) => ({
      key: one.key,
      phase: one.phase,
      since: one.since,
      deps: one.deps,
      held: one.held,
      startedAt: one.startedAt,
      mergedAt: one.mergedAt,
      fixedOnce: one.fixedOnce,
      prOpen: one.prOpen,
    })),
    done: tasks.every((one) => one.phase === 'merged'),
    lastChange,
  }
}

/** When the last thing changes where nobody does anything more: every task merged, or what's left waits on the person. */
export function endOf(scenario: Scenario, moves: ReadonlyArray<Move>): number {
  const last = Math.max(0, ...moves.map((one) => one.at))
  return simulate(scenario, moves, last + 300).lastChange
}
