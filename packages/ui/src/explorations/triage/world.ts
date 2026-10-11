/*
 * The exploration's own demo: one Meridian task at its triage moment. Kept
 * beside the exploration rather than in src/fixtures, so the folder can go
 * as a whole once a direction is chosen.
 */
import { CODEX, OPUS, SONNET } from '../../fixtures/models'
import type { QuestionPart } from '../../thread/Question/Question'
import { Stakes, type Assumption } from './model'

export const TASK = {
  task: '436',
  kind: 'Delivery',
  title: 'Rate-limit refunds the way charges are limited',
  /* Triage is the start of Implement, not a step of its own. */
  steps: ['Implement', 'Review', 'Verify', 'Draft PR'],
  lead: OPUS,
  elapsed: '3m',
}

/** A task beside it on the board, running as usual, so a checkpoint is seen among other work. */
export const NEIGHBOUR = {
  task: '419',
  kind: 'Delivery',
  title: 'Migrate billing webhooks to the v2 endpoint',
  steps: ['Implement', 'Review', 'Verify'],
  at: 1,
  elapsed: '22m',
  lead: OPUS,
  onStep: [SONNET],
}

/** How the lead means to go about it, in a line or two. */
export const APPROACH =
  'Wrap the refund router in the limiter charges already use, keyed by partner, and answer 429 with Retry-After when a partner is over.'

/** The same, as the lead says it in its turn. */
export const APPROACH_SAID =
  'I’ll put the refund router behind withPartnerLimit, the limiter charges use, and answer 429 with Retry-After when a partner is over.'

export const SAME_BUDGET: Assumption = {
  id: 'budget',
  says: 'Refunds share each partner’s budget with charges, rather than having one of their own',
  because: 'withPartnerLimit is keyed by partner alone',
  anchor: { quote: 'the way charges are' },
}

export const PUBLIC_ONLY: Assumption = {
  id: 'public',
  says: 'Only the public API is limited; refunds made in the admin dashboard stay unlimited',
  because: 'admin calls go through src/admin/refunds.ts, which the charges limiter skips too',
  anchor: { quote: 'the public API' },
}

export const REFUSED: Assumption = {
  id: 'refused',
  says: 'Over the limit, a refund is refused, as a charge is; nothing is queued',
  because: 'the project note says refunds never wait',
  anchor: { file: 'src/refunds/router.ts' },
}

export const THREE: readonly Assumption[] = [SAME_BUDGET, PUBLIC_ONLY, REFUSED]
export const ONE: readonly Assumption[] = [SAME_BUDGET]

/** What a person writes in place of the first. */
export const OWN_BUDGET = 'Refunds get their own budget: 30 a minute per partner'

/** The task as it was asked for, which direction D reads the assumptions onto. */
export const BRIEF = [
  'Refunds should be rate-limited ',
  { id: SAME_BUDGET.id, text: 'the way charges are' },
  '. During reconciliation partners hammer the refund endpoint, and on 3 February that took ',
  { id: PUBLIC_ONLY.id, text: 'the public API' },
  ' down. Keep it simple: partner success shouldn’t have to explain anything new.',
] as const

/** The one thing worth stopping for, and why it is one. */
export const OVER_LIMIT: QuestionPart = {
  id: 'over-limit',
  question: 'Should a partner over the limit get the refund queued, or refused?',
  options: [
    {
      id: 'refuse',
      label: 'Refuse with 429 and Retry-After',
      note: 'As charges do. The partner retries after the window; nothing new to run.',
    },
    {
      id: 'queue',
      label: 'Queue it and return 202',
      note: 'No refund is lost, but it needs a table, a worker, and a webhook partners subscribe to.',
    },
  ],
}

export const ASKED = {
  stakes: [Stakes.Redo, Stakes.Outward],
  /** What the lead says before it asks: why this one isn’t a guess. */
  said: 'The project note says refunds never wait, but MER-240 says no partner refund may be lost. Those pull opposite ways, and queueing would change most of this task, so I’m asking rather than assuming.',
  /** The rest it is still assuming, which carry on with your answer. */
  also: [SAME_BUDGET, PUBLIC_ONLY] as readonly Assumption[],
  /** On the board, in the lane of what needs you. */
  call: {
    kind: 'Question',
    title: OVER_LIMIT.question,
    because: 'Asked, not assumed: a wrong guess would redo most of the task, and partners would see it.',
    options: OVER_LIMIT.options.map((o) => o.label),
    holds: ['436'],
    at: 'just now',
  },
}

/** When it carries on, and when it did. */
export const DUE = '11:06'
export const CONTINUED_AT = '11:06'

/** The end of the pull request's description, where what was assumed is kept. */
export const PR_ASSUMED = `## Assumed

The lead checked these with you before it began. It carried on by itself at 11:06; you corrected one.

- Refunds share each partner’s budget with charges, rather than having one of their own.
  **Corrected by you:** refunds get their own budget, 30 a minute per partner.
- Only the public API is limited; refunds made in the admin dashboard stay unlimited.
  _Why: admin calls go through \`src/admin/refunds.ts\`, which the charges limiter skips too._
- Over the limit, a refund is refused, as a charge is; nothing is queued.
  _Why: the project note says refunds never wait._
`

/** The same, when the checkpoint had nothing in it. */
export const PR_NOTHING = `## Assumed

Nothing worth checking: the lead went ahead as the task asked.
`

/** What the coordinator settled with you in the plan, and what it leaves for the lead to check. */
export const SCOPE = {
  decided: [
    { id: 'd1', says: 'The same limiter as charges, withPartnerLimit' },
    { id: 'd2', says: 'Over the limit: 429 with Retry-After, nothing queued' },
    { id: 'd3', says: 'No new webhook for partners' },
  ],
  left: [
    { id: 'l1', says: 'Whether refunds share charges’ budget or get their own' },
    { id: 'l2', says: 'Whether refunds from the admin dashboard count' },
  ],
  /** The same, settled while planning. */
  settled: [
    { id: 's1', says: 'Refunds share charges’ budget' },
    { id: 's2', says: 'Admin refunds don’t count' },
  ],
  /** All of it, still open: a task handed over in a sentence. */
  open: [
    { id: 'o1', says: 'Which limiter refunds go behind' },
    { id: 'o2', says: 'What a partner over the limit gets back' },
    { id: 'o3', says: 'Whether partners hear of it' },
    { id: 'o4', says: 'Whether refunds share charges’ budget or get their own' },
    { id: 'o5', says: 'Whether refunds from the admin dashboard count' },
  ],
}

/** A second task at its checkpoint at the same time, for the board. */
export const SECOND = {
  task: '437',
  kind: 'Delivery',
  title: 'Log the partner on every failed refund',
  steps: ['Implement', 'Review', 'Draft PR'],
  lead: CODEX,
  elapsed: '2m',
  assumptions: [
    {
      id: 'ids',
      says: 'Partner ids may go in the logs; customer emails may not',
      because: 'notes/logging.md lists emails as personal data',
    },
  ] as readonly Assumption[],
}
