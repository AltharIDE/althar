import type { BoardSnapshot, BoardTask, ChangeSummary, ChecksSummary, HomeSnapshot } from '@althar/contracts'

import { card, change, home, project } from '../../tests/fixtures'

/*
 * One project's board, as the runtime would give it, with work ready to
 * accept in every state that can stand between the person and merging it.
 * What the card already knows comes on its pull request (checks, draft,
 * commits not on it); what it doesn't yet (a conflict and whether the lead
 * is resolving it, a review asking for changes, how far behind main it is)
 * is kept beside it, by the task's slug, as Queries would add it.
 */

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()

type CheckState = ChecksSummary['list'][number]['state']

/** A head's checks, by name: those passed, failed and still running. */
const checks = (passed: string[], failed: string[] = [], running: string[] = []): ChecksSummary => {
  const list = [
    ...failed.map((name) => ({ name, state: 'failed' as CheckState, summary: name === 'test' ? '3 tests failed' : '2 type errors' })),
    ...running.map((name) => ({ name, state: 'running' as CheckState, summary: null })),
    ...passed.map((name) => ({ name, state: 'passed' as CheckState, summary: null })),
  ]
  return {
    outcome: failed.length > 0 ? 'failed' : running.length > 0 ? 'running' : passed.length > 0 ? 'passed' : 'none',
    passed: passed.length,
    failed: failed.length,
    running: running.length,
    total: list.length,
    failing: failed,
    list,
  }
}

const ALL = ['test', 'lint', 'typecheck', 'build', 'e2e']

const pr = (number: number, title: string, add: number, del: number, overrides: Partial<ChangeSummary> = {}): ChangeSummary =>
  change({
    number,
    title,
    url: `https://github.com/meridian/api/pull/${number}`,
    draft: false,
    additions: add,
    deletions: del,
    checks: checks(ALL),
    localHead: 'b08a6e4c11',
    unpushed: 0,
    ...overrides,
  })

const task = (n: number, slug: string, title: string, overrides: Partial<BoardTask> = {}): BoardTask => ({
  ...card({ taskId: `t${n}`, threadId: `th${n}`, slug, title, branch: `althar/${slug}`, lead: 'claude-code', leadModel: 'opus' }),
  state: 'open',
  createdAt: minutesAgo(200 - n),
  settledAt: null,
  changed: null,
  here: [],
  ...overrides,
})

const ready = (n: number, slug: string, title: string, change: ChangeSummary): BoardTask =>
  task(n, slug, title, {
    phase: 'ready',
    change: { ...change, title },
    startedAt: minutesAgo(90 - n),
    plan: { ...card().plan!, startsAt: null },
  })

/** What stands between the person and accepting a task, as its card would know it. */
export interface Extra {
  /** Merging it into main as main is now conflicts, in these files; resolving: its lead is on it. */
  conflict?: { files: string[]; resolving: boolean }
  /** A reviewer on the host asked for changes. */
  changesBy?: string
  /** Commits on main it doesn't have. */
  behind?: number
}

/** Which of the states a card is shown in, in the brief's order, then the others it asked to consider. */
export type StateKey = 'clear' | 'running' | 'failing' | 'conflict' | 'resolving' | 'push' | 'two' | 'draft' | 'changes' | 'behind'

export interface Shown {
  readonly key: StateKey
  readonly name: string
  readonly task: BoardTask
  readonly extra: Extra
}

export const states: ReadonlyArray<Shown> = [
  {
    key: 'clear',
    name: 'All clear',
    task: ready(1, 'retry-charges', 'Retry charges the host rate-limits', pr(214, '', 86, 14)),
    extra: {},
  },
  {
    key: 'running',
    name: 'Checks still running',
    task: ready(
      2,
      'drop-legacy-pdf',
      'Drop the legacy invoice PDF path',
      pr(221, '', 12, 340, { checks: checks(['lint', 'typecheck'], [], ['test', 'build', 'e2e']) }),
    ),
    extra: {},
  },
  {
    key: 'failing',
    name: 'Checks failing',
    task: ready(
      3,
      'cache-rates',
      'Cache exchange rates for an hour',
      pr(223, '', 64, 8, { checks: checks(['lint', 'build', 'e2e'], ['test', 'typecheck']) }),
    ),
    extra: {},
  },
  {
    key: 'conflict',
    name: 'Conflicts with main',
    task: ready(4, 'split-ledger', 'Split ledger writes by account', pr(218, '', 140, 52)),
    extra: { conflict: { files: ['src/ledger/write.ts', 'src/ledger/accounts.ts'], resolving: false } },
  },
  {
    key: 'resolving',
    name: 'Conflict, the lead resolving it',
    task: ready(5, 'refund-status', 'Show refund status on the receipt', pr(217, '', 58, 11)),
    extra: { conflict: { files: ['src/receipts/render.tsx'], resolving: true } },
  },
  {
    key: 'push',
    name: 'Commits to push',
    task: ready(6, 'status-rate-limit', 'Rate-limit the public status API', pr(225, '', 44, 6, { unpushed: 3, head: '91ac2d7e55' })),
    extra: {},
  },
  {
    key: 'two',
    name: 'Two at once: a check failing, and commits to push',
    task: ready(
      7,
      'dispute-emails',
      'Email the merchant when a dispute opens',
      pr(226, '', 97, 3, { checks: checks(['lint', 'typecheck', 'build', 'e2e'], ['test']), unpushed: 2, head: '91ac2d7e55' }),
    ),
    extra: {},
  },
  {
    key: 'draft',
    name: 'Still a draft',
    task: ready(8, 'dispute-csv', 'Add a CSV export for disputes', pr(227, '', 120, 0, { draft: true })),
    extra: {},
  },
  {
    key: 'changes',
    name: 'A reviewer asked for changes',
    task: ready(9, 'payout-states', 'Rename the payout states', pr(212, '', 77, 61)),
    extra: { changesBy: 'Dana' },
  },
  {
    key: 'behind',
    name: 'Behind main, nothing else',
    task: ready(10, 'stripe-sdk', 'Bump the Stripe SDK to v18', pr(220, '', 31, 29)),
    extra: { behind: 14 },
  },
]

/** The seven the brief asks for: the board holds these. */
export const core: ReadonlyArray<Shown> = states.slice(0, 7)

/** What is known of a ready task beside its pull request, by its slug and by its title (the home's line has only its title). */
export const extraOf = (slugOrTitle: string): Extra | undefined =>
  states.find((one) => one.task.slug === slugOrTitle || one.task.title === slugOrTitle)?.extra
export const taskOf = (slugOrTitle: string): BoardTask | undefined =>
  states.find((one) => one.task.slug === slugOrTitle || one.task.title === slugOrTitle)?.task

/** The rest of the board: a plan held, work running, work settled. */
const others: ReadonlyArray<BoardTask> = [
  task(20, 'paginate-refunds', 'Paginate the refunds export', { phase: 'held', plan: { ...card().plan!, startsAt: null } }),
  task(21, 'webhooks-queue', 'Move webhooks to the new queue', { phase: 'running', step: 'implement', startedAt: minutesAgo(14) }),
  task(22, 'idempotency-key', 'Log the idempotency key on each charge', {
    phase: 'settled',
    state: 'done',
    settledAt: minutesAgo(65),
    change: pr(209, '', 22, 4, { state: 'merged' }),
  }),
]

/** The board, its ready work in the order given (by readiness, for C). */
export const boardOf = (order: ReadonlyArray<BoardTask> = core.map((one) => one.task)): BoardSnapshot => ({
  cursor: 7,
  tasks: [...others, ...order],
  calls: [],
})

/** The home, with the same project, its ready work in the order given. */
export const homeOf = (order: ReadonlyArray<BoardTask> = core.map((one) => one.task)): HomeSnapshot =>
  home({
    looked: minutesAgo(180),
    since: minutesAgo(180),
    tasks: [...others, ...order].map((one) => ({ ...one, projectId: project.id })),
    projects: [{ ...project, lastWorkAt: minutesAgo(3), tasks: 10, ready: order.length, running: 1, working: 1 }],
  })
