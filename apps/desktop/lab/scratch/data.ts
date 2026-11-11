import type { BoardSnapshot, BoardTask, ThreadItem } from '@althar/contracts'

import { card, change, items } from '../../tests/fixtures'

/*
 * What the lab's project holds: a board with a little of everything, the
 * coordinator's conversation, and the chats (Scratch today), each with its
 * latest exchange. Times are from now, so the screen's "4m" reads true.
 */

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

const task = (overrides: Partial<BoardTask>): BoardTask => ({
  ...card(),
  state: 'open',
  createdAt: ago(90),
  settledAt: null,
  changed: null,
  here: [],
  ...overrides,
})

/** A chat as the lab knows it: a task with only a conversation, and what was said last. */
export interface Chat {
  readonly id: string
  readonly title: string
  readonly by: 'person' | 'lead'
  readonly said: string
  /** Minutes since its latest exchange. */
  readonly minutes: number
  readonly running?: boolean
  /** Another project's, where a direction reaches across them. */
  readonly project?: string
}

export const CHATS: ReadonlyArray<Chat> = [
  {
    id: 'c1',
    title: 'Why does the retry back off twice?',
    by: 'lead',
    said: 'It backs off once in the client and once in the queue: the queue’s wait is the one to drop.',
    minutes: 4,
    running: true,
  },
  {
    id: 'c2',
    title: 'Which Stripe API version are we on?',
    by: 'lead',
    said: '2025-09-30.acacia, pinned in payments/client.ts.',
    minutes: 52,
  },
  {
    id: 'c3',
    title: 'Name for the refunds export',
    by: 'person',
    said: 'Let’s go with “Refund ledger” and see how it reads.',
    minutes: 60 * 26,
  },
  {
    id: 'c4',
    title: 'Is the webhook signature checked twice?',
    by: 'lead',
    said: 'Only once, in middleware/stripe.ts; the handler trusts it.',
    minutes: 60 * 24 * 9,
  },
  {
    id: 'c5',
    title: 'What does the ledger table index on?',
    by: 'lead',
    said: 'account_id, then created_at descending.',
    minutes: 60 * 24 * 12,
  },
]

/** Chats in other projects, for a direction that reaches across them. */
export const ELSEWHERE: ReadonlyArray<Chat> = [
  { id: 'x1', title: 'Font for the pricing page', by: 'lead', said: 'Inter at 15, as the site uses.', minutes: 180, project: 'site' },
  {
    id: 'x2',
    title: 'Is the nightly backup still running?',
    by: 'lead',
    said: 'Yes: last ran at 03:10, 41 MB.',
    minutes: 60 * 30,
    project: 'infra',
  },
]

/** Untouched for a week or more: what "Clear the old ones" would clear. */
export const OLD_DAYS = 7
export const isOld = (chat: Chat) => chat.minutes >= OLD_DAYS * 24 * 60

export const chatTask = (chat: Chat, onBoard = false): BoardTask =>
  task({
    taskId: chat.id,
    threadId: `th-${chat.id}`,
    title: chat.title,
    slug: chat.id,
    kind: 'plain',
    phase: chat.running === true ? 'running' : 'ready',
    plan: null,
    branch: null,
    startedAt: ago(chat.minutes + 3),
    createdAt: ago(chat.minutes + 3),
    ...(onBoard ? {} : { scratch: true }),
    latest: { at: ago(chat.minutes), by: chat.by, said: chat.said },
  })

/** The board's work, chats aside. */
const work = (): ReadonlyArray<BoardTask> => [
  task({
    taskId: 't1',
    threadId: 'th1',
    title: 'Refund ledger export',
    slug: 'refund-ledger-export',
    plan: { ...card().plan!, startsAt: new Date(Date.now() + 40_000).toISOString() },
  }),
  task({
    taskId: 't2',
    threadId: 'th2',
    title: 'Retry backs off once',
    slug: 'retry-backs-off-once',
    phase: 'running',
    step: 'implement',
    startedAt: ago(12),
  }),
  task({
    taskId: 't3',
    threadId: 'th3',
    title: 'Rate-limit refunds',
    slug: 'rate-limit-refunds',
    phase: 'ready',
    change: change({ draft: false }),
    startedAt: ago(140),
  }),
  task({
    taskId: 't4',
    threadId: 'th4',
    title: 'Partner budget shared with refunds',
    slug: 'partner-budget',
    phase: 'settled',
    state: 'merged',
    settledAt: ago(300),
  }),
]

/**
 * The board as the lab draws it: the chats on Scratch, as today, or on the
 * board's lanes as tasks (`onBoard`), or not at all (a direction that draws
 * them itself).
 */
export const boardOf = (chats: 'scratch' | 'quiet' | 'none', cleared: ReadonlySet<string>): BoardSnapshot => ({
  cursor: 3,
  tasks: [
    ...work(),
    ...(chats === 'none'
      ? []
      : CHATS.filter((chat) => !cleared.has(chat.id) && (chats === 'scratch' || chat.running === true)).map((chat) =>
          chatTask(chat, chats === 'quiet'),
        )),
  ],
  calls: [],
  settledTotal: 1,
})

/** The coordinator's conversation: a request, its answer, and the plan it made. */
export const coordinatorItems = (chats: ReadonlyArray<Chat> | null = null): ReadonlyArray<ThreadItem> => [
  items.you('The retry in checkout feels slow when Stripe is down. Can we make it back off only once?'),
  items.says(
    'It backs off in two places: the client waits, and so does the queue. I’ll plan a change that keeps the client’s wait and drops the queue’s.',
  ),
  items.card(
    card({
      taskId: 't2',
      threadId: 'th2',
      title: 'Retry backs off once',
      slug: 'retry-backs-off-once',
      phase: 'running',
      step: 'implement',
      startedAt: ago(12),
    }),
  ),
  items.you('And the refunds export, whenever there’s room.'),
  items.card(card({ taskId: 't1', threadId: 'th1', title: 'Refund ledger export', slug: 'refund-ledger-export' })),
  // Where the chats began: asked of the coordinator, which started each as a chat of its own.
  ...(chats === null ? [] : chats.toReversed().flatMap((chat) => [items.you(chat.title), items.card(chatCard(chat))])),
]

/** A chat's card in the conversation where it began, as the coordinator's start_task leaves it. */
const chatCard = (chat: Chat) =>
  card({
    taskId: chat.id,
    threadId: `th-${chat.id}`,
    title: chat.title,
    slug: chat.id,
    kind: 'plain',
    phase: chat.running === true ? 'running' : 'ready',
    plan: null,
    branch: null,
    startedAt: ago(chat.minutes + 3),
    summary: chat.said,
  })
