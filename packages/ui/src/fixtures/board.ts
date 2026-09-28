import { Outcome, TaskStatus, Wait } from '../foundations/vocabulary'
import type { AcceptCardProps } from '../board/AcceptCard/AcceptCard'
import type { CallCardProps } from '../board/CallCard/CallCard'
import type { NextRowProps } from '../board/NextRow/NextRow'
import type { SettledRowProps } from '../board/SettledRow/SettledRow'
import type { WorkCardProps } from '../board/WorkCard/WorkCard'
import { CODEX, GEMINI_PRO, OPUS, SONNET } from './models'
import { GITHUB } from './outputs'

/* What a card is given, without what the board wires to it. */
type Data<P> = Omit<P, 'onOpen' | 'current' | 'text'>

/* Meridian's board on a Tuesday afternoon: what is up next, running, waiting on you, and settled. */

export const NEXT: Omit<Data<NextRowProps>, 'place'>[] = [
  {
    task: '422',
    kind: 'Delivery',
    title: 'Extract rate-limit policy into a shared module',
    wait: Wait.You,
    reason: 'Waiting on the API fallback decision',
  },
  {
    task: '429',
    kind: 'Delivery',
    title: 'Sign webhook v2 payloads with rotating keys',
    wait: Wait.After,
    reason: 'Starts when 419 merges',
  },
  {
    task: '427',
    kind: 'Delivery',
    title: 'Backfill idempotency keys on refunds created before PR 1184',
    wait: Wait.Workers,
    reason: 'Next up · 4 of 4 workers busy',
  },
  { task: '428', kind: 'Question', title: 'Which partners still call the v1 webhook endpoint?', wait: Wait.After, reason: 'After 427' },
]

export const RUNNING: Data<WorkCardProps>[] = [
  {
    task: '418',
    kind: 'Delivery',
    title: 'Repair token refresh on privilege change',
    steps: ['Requirements', 'Implement', 'Review', 'Repair', 'Security review', 'Verify'],
    at: 4,
    elapsed: '6m',
    lead: OPUS,
    onStep: [SONNET],
    added: 1,
  },
  {
    task: '419',
    kind: 'Delivery',
    title: 'Migrate billing webhooks to the v2 endpoint',
    steps: ['Requirements', 'Implement', 'Review', 'Verify'],
    at: 1,
    elapsed: '22m',
    lead: OPUS,
  },
  {
    task: '431',
    kind: 'Delivery',
    title: 'Refunds rate-limit like charges',
    status: TaskStatus.Paused,
    steps: ['Triage', 'Implement', 'Review', 'Verify', 'Draft PR'],
    at: 2,
    elapsed: '31m',
    lead: CODEX,
    onStep: [SONNET, GEMINI_PRO],
    note: 'Resumes at 14:00',
  },
  {
    task: '424',
    kind: 'Session',
    title: 'Find a shape for webhook queue sharding',
    steps: ['Frame', 'Spike A', 'Spike B', 'Spike C', 'Replay', 'Note'],
    at: 3,
    elapsed: '22m',
    lead: OPUS,
  },
]

export const CALLS: Data<CallCardProps>[] = [
  {
    kind: 'Decision',
    title: 'Queue or fail when a refund retry hits the rate limit?',
    because: 'Two defensible behaviours, and no convention in the project covers it.',
    options: ['Queue and retry with backoff', 'Fail fast to the caller'],
    holds: ['422'],
    at: '18m ago',
  },
  {
    kind: 'Approval',
    title: 'Drop the legacy_session table',
    because: 'It can’t be undone without a restore, and the project’s rules keep that for you.',
    options: ['Approve the migration', 'Hold and keep the table'],
    holds: ['421'],
    at: '1h ago',
  },
  {
    kind: 'Contradiction',
    title: 'Two notes disagree on the token refresh window',
    because: 'Tasks will be told both until one is settled.',
    options: ['Keep the observed 5 minutes', 'Keep both, by environment'],
    from: 'Project knowledge',
    at: '2h ago',
  },
]

/* A task that couldn't finish, on the board: no choices here; they are in the task. */
export const STUCK_CALL: Data<CallCardProps> = {
  kind: 'Stuck',
  title: 'Verify can’t pass on refunds made before PR 1184',
  because: 'Tried three ways round it. It needs the backfill in MER-231, or a word from you.',
  options: [],
  holds: [],
  from: 'Verify · task 419',
  at: '4m ago',
}

export const READY: Data<AcceptCardProps> = {
  task: '416',
  title: 'Return 409 when a refund idempotency key is reused',
  prs: [{ repo: 'meridian-api', number: 1191, add: 48, del: 9 }],
  host: GITHUB,
  checks: 3,
  at: '9m ago',
}

export const READY_TWO_REPOS: Data<AcceptCardProps> = {
  task: '418',
  title: 'Repair token refresh on privilege change',
  prs: [
    { repo: 'meridian-api', number: 1187, add: 126, del: 31 },
    { repo: 'meridian-web', number: 412, add: 14, del: 3 },
  ],
  host: GITHUB,
  checks: 4,
  at: 'just now',
}

export const SETTLED: Data<SettledRowProps>[] = [
  {
    outcome: Outcome.Answered,
    task: '425',
    kind: 'Question',
    title: 'Why do refunds fail fast when webhooks retry?',
    meta: 'Nothing built · 1 note proposed',
    at: '11m ago',
  },
  {
    outcome: Outcome.Merged,
    task: '414',
    kind: 'Delivery',
    title: 'Add idempotency keys to the refund endpoint',
    meta: 'PR 1184 · 2 review rounds',
    at: '3h ago',
  },
  {
    outcome: Outcome.Artifact,
    task: '411',
    kind: 'Delivery',
    title: 'Audit third-party script loading',
    meta: 'No code changed · 9 findings',
    at: 'yesterday',
  },
  {
    outcome: Outcome.Abandoned,
    task: '409',
    kind: 'Session',
    title: 'Reduce cold start on the checkout worker',
    meta: 'The approach didn’t hold · reasoning kept',
    at: '2 days ago',
  },
  {
    outcome: Outcome.Knowledge,
    task: '407',
    kind: 'Delivery',
    title: 'Document the webhook retry contract',
    meta: 'Now a project note',
    at: '3 days ago',
  },
]
