import type { BoardCall, BoardSnapshot, BoardTask, CoordinatorSnapshot } from '@althar/contracts'

import { card, change, coordinatorSnapshot, items } from '../../tests/fixtures'

/*
 * A project mid-week: two things wait on the person, three tasks run, two
 * plans are up next, a couple settled; and a short conversation with its
 * coordinator, a task card in it.
 */

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()

const task = (overrides: Partial<BoardTask>): BoardTask => ({
  ...card(),
  state: 'open',
  createdAt: minutesAgo(180),
  settledAt: null,
  changed: null,
  here: [],
  ...overrides,
})

const passed = change({
  draft: false,
  number: 412,
  checks: {
    outcome: 'passed',
    passed: 3,
    failed: 0,
    running: 0,
    total: 3,
    failing: [],
    list: [
      { name: 'test', state: 'passed', summary: null },
      { name: 'lint', state: 'passed', summary: null },
      { name: 'e2e', state: 'passed', summary: null },
    ],
  },
})

const permission: BoardCall = {
  id: 'call1',
  kind: 'permission',
  title: 'Run make deploy-staging',
  reason: 'Deploying or publishing always asks.',
  command: 'make deploy-staging',
  stuck: null,
  createdAt: minutesAgo(6),
  taskId: 't3',
  threadId: 'th3',
  taskTitle: 'Stage the refunds API',
  taskSlug: 'stage-the-refunds-api',
}

export const board: BoardSnapshot = {
  cursor: 9,
  tasks: [
    task({ taskId: 't1', threadId: 'th1', title: 'Retry webhooks with back-off', slug: 'retry-webhooks', phase: 'planned' }),
    task({ taskId: 't8', threadId: 'th8', title: 'Prototype: invoice PDF layout', slug: 'invoice-pdf', phase: 'planned', kind: 'plain' }),
    task({
      taskId: 't2',
      threadId: 'th2',
      title: 'Rate-limit the partner API',
      slug: 'rate-limit-partner',
      phase: 'running',
      step: 'implement',
      startedAt: minutesAgo(24),
    }),
    task({
      taskId: 't5',
      threadId: 'th5',
      title: 'Move sessions to Redis',
      slug: 'sessions-redis',
      phase: 'running',
      step: 'review',
      startedAt: minutesAgo(52),
    }),
    task({
      taskId: 't9',
      threadId: 'th9',
      title: 'Fix the flaky checkout test',
      slug: 'flaky-checkout',
      phase: 'running',
      step: 'implement',
      startedAt: minutesAgo(9),
    }),
    task({
      taskId: 't3',
      threadId: 'th3',
      title: 'Stage the refunds API',
      slug: 'stage-the-refunds-api',
      phase: 'waiting',
      startedAt: minutesAgo(40),
    }),
    task({
      taskId: 't4',
      threadId: 'th4',
      title: 'Show refund status on receipts',
      slug: 'refund-status',
      phase: 'ready',
      change: passed,
      summary: 'Receipts say whether a refund is pending, done or refused.',
    }),
    task({
      taskId: 't6',
      threadId: 'th6',
      title: 'Drop the legacy v1 routes',
      slug: 'drop-v1',
      phase: 'settled',
      state: 'done',
      settledAt: minutesAgo(300),
      change: change({ state: 'merged', number: 398 }),
    }),
    task({
      taskId: 't7',
      threadId: 'th7',
      title: 'Try Bun for the CLI',
      slug: 'bun-cli',
      phase: 'settled',
      state: 'abandoned',
      settledAt: minutesAgo(600),
    }),
  ],
  calls: [permission],
  settledTotal: 2,
}

export const coordinator: CoordinatorSnapshot = coordinatorSnapshot({
  project: { id: 'p1', name: 'meridian' },
  items: [
    items.you('Refunds are still slow to show up for customers. What’s left before we can stage them?'),
    items.says(
      'Two things. **Stage the refunds API** is waiting on you to allow `make deploy-staging`, and **Show refund status on receipts** is ready with its checks green (#412). Once both are in, staging has everything.\n\nI’d also back off webhook retries before the partners hit it; I’ve planned that below.',
    ),
    items.card(card({ taskId: 't1', threadId: 'th1', title: 'Retry webhooks with back-off', slug: 'retry-webhooks', phase: 'planned' })),
    items.you('Good. And the flaky checkout test, is someone on it?'),
    items.says(
      'Yes, **Fix the flaky checkout test** started nine minutes ago. It reproduced the failure on the second run; it looks like a clock in the fixture, not the checkout itself.',
    ),
  ],
})
