/*
 * The coordinator's side of the demo world: task 432 from a Linear issue, its
 * plan, and its life as a card over time. Not part of the package's API.
 */
import type { IssueRefProps } from '../coordinator/Issue/Issue'
import type { LaunchStep } from '../coordinator/TaskLaunch/TaskLaunch'
import type { LeadOption } from '../thread/LeadPick/LeadPick'
import { Brand } from '../foundations/brands/brands'
import { IssuePriority, IssueStatus, TaskStatus } from '../foundations/vocabulary'
import { CODEX, GEMINI_PRO, OPUS, SONNET } from './models'

export const MER_231 = {
  mark: Brand.Linear,
  source: 'Linear',
  id: 'MER-231',
  title: 'Backfill idempotency keys on refunds created before PR 1184',
  href: 'https://linear.app/meridian/issue/MER-231',
  status: { state: IssueStatus.Todo, label: 'Todo' },
  priority: { level: IssuePriority.High, label: 'High' },
  meta: 'Due 2.20 · Partner success',
  tone: 'linear' as const,
}

export const FROM_231: IssueRefProps = { mark: Brand.Linear, id: 'MER-231', linear: true }

export const PLAN_432: LaunchStep[] = [
  { id: 'impl', label: 'Implement', agents: [OPUS], why: 'recommended · writes to money records', fixed: 'the lead' },
  { id: 'dry', label: 'Dry run on a copy', agents: [CODEX], why: 'replays against last night’s snapshot', optional: true },
  { id: 'review', label: 'Review', agents: [SONNET, GEMINI_PRO], why: 'two labs, combined', optional: true },
  { id: 'sec', label: 'Security review', agents: [SONNET], why: 'required by your rule for money handling', fixed: 'Meridian’s rule' },
]

/** Claude Code is out, so Codex leads, and Security review waits for the reset. */
export const PLAN_433: LaunchStep[] = [
  { id: 'impl', label: 'Implement', agents: [CODEX], why: 'Claude Code is out; Codex is free', fixed: 'the lead' },
  { id: 'review', label: 'Review', agents: [GEMINI_PRO], why: 'a different lab from the lead', optional: true },
  { id: 'sec', label: 'Security review', agents: [SONNET], why: 'required by your rule', fixed: 'Meridian’s rule', waits: true },
]

export const T432 = {
  task: '432',
  title: 'Backfill idempotency keys on refunds created before PR 1184',
  from: FROM_231,
  lead: OPUS,
  branch: 'ch/432-backfill-idempotency',
  steps: ['Implement', 'Dry run on a copy', 'Review', 'Security review', 'Draft PR'],
}

/** Each status change of task 432, as the card it posted and the mark it folded into. */
export const STAGES = [
  {
    status: TaskStatus.Running,
    step: 0,
    at: '11:02',
    verb: 'started',
    detail: 'Opus 5 leads',
    now: 'Implement · reading the refunds schema',
    started: 'started 11:02',
    label: 'Implement',
  },
  {
    status: TaskStatus.Running,
    step: 1,
    at: '11:31',
    verb: 'moved to Dry run on a copy',
    detail: '3 files, one migration',
    now: 'Dry run · replaying last night’s snapshot',
    started: 'started 11:02',
    label: 'Dry run',
  },
  {
    status: TaskStatus.Running,
    step: 2,
    at: '11:44',
    verb: 'moved to Review',
    detail: 'dry run clean on 18,402 refunds',
    now: 'Review · Sonnet 5 and Gemini 3 Pro',
    started: 'started 11:02',
    label: 'Review',
  },
  {
    status: TaskStatus.Running,
    step: 0,
    seen: 2,
    at: '11:50',
    verb: 'went back to Implement',
    detail: 'review asked for 2 fixes',
    now: 'Implement · round 2 · fixing what review found',
    started: 'started 11:02',
    label: 'Implement, round 2',
  },
  {
    status: TaskStatus.Yours,
    step: 3,
    at: '12:05',
    verb: 'waited on you',
    detail: 'to run a command on staging',
    now: 'Security review · a command that reaches staging',
    started: 'started 11:02',
    label: 'Waiting on you',
  },
  {
    status: TaskStatus.Done,
    step: 5,
    at: '12:20',
    verb: 'is done',
    detail: 'Draft PR 1191; checks passed',
    now: 'Draft PR opened; checks passed',
    started: 'took 1h 18m',
    label: 'Done',
    pr: 'Draft PR 1191',
  },
] as const

/** Who could lead task 432, and why the coordinator picked Opus. */
export const LEAD_OPTIONS: LeadOption[] = [
  { model: OPUS, note: 'Recommended · led 8 tasks on Meridian, 7 merged after one review round' },
  { model: CODEX, note: 'Codex · 38% of this week used · led 3 tasks on Meridian' },
  { model: GEMINI_PRO, note: 'API key, about $1.90 for a task this size · no tasks on Meridian yet' },
]
export const LEAD_REASONS = [
  'The task changes src/refunds, which Meridian’s rules mark as money handling',
  'Opus led 8 of the last 10 tasks in src/refunds; 7 merged after one review round',
  'Claude Code has 60% of this week left; tasks this size used about 9%',
]

/** Issues the coordinator drafted on the person's trackers, before they file them. */
export const DRAFT_LINEAR = {
  mark: Brand.Linear,
  source: 'Linear',
  container: 'Meridian',
  title: 'Refund webhooks retry too fast after a 429',
  body: 'The partner webhook retries a refund notice after 2s, 4s and 8s, whatever the partner says. Stripe answers 429 with a Retry-After of 30s, so all three retries fail and the refund is marked undelivered.\n\nHonour Retry-After, and cap the wait at 5 minutes.',
  labels: ['refunds', 'webhooks', 'bug'],
}

export const DRAFT_JIRA = {
  mark: Brand.Jira,
  source: 'Jira',
  container: 'Payments',
  title: 'Nightly partner export takes 40 minutes',
  body: 'The export scans every refund since launch. It could start from the last export’s cursor.',
  labels: [],
}

export const DRAFT_GITHUB = {
  mark: Brand.GitHub,
  source: 'GitHub',
  container: 'meridian/refunds',
  title: 'Document the idempotency key on POST /refunds',
  body: '',
  labels: ['docs'],
}

/** A draft with a body long enough to fold: the coordinator's notes on what it found. */
export const DRAFT_LONG = {
  ...DRAFT_LINEAR,
  title: 'Backfill idempotency keys on refunds created before PR 1184',
  body: [
    'Refunds created before PR 1184 have no idempotency key, so a retried request can refund twice.',
    '',
    'What I found:',
    '- 18,402 refunds have no key; the oldest is from March 2023.',
    '- 41 of them were refunded twice; the partner reconciled 39 by hand.',
    '- The key is derived from the charge and the amount since PR 1184, so the old rows can take the same.',
    '',
    'What the backfill should do:',
    '- Derive each missing key the way PR 1184 does.',
    '- Dry-run on last night’s snapshot first, and report collisions instead of writing them.',
    '- Write in batches of 500, so the table stays readable during the run.',
  ].join('\n'),
}

export const FILED_LINEAR = { key: 'MER-244', href: 'https://linear.app/meridian/issue/MER-244' }

/** Changes the coordinator proposed to two issues on Linear, on one card. */
export const CHANGES_LINEAR = {
  issues: [
    {
      mark: Brand.Linear,
      source: 'Linear',
      key: 'DEV-67',
      href: 'https://linear.app/meridian/issue/DEV-67',
      title: 'Refunds skip the rate limiter',
      changes: [{ field: 'status' as const, to: 'Done' }],
    },
    {
      mark: Brand.Linear,
      source: 'Linear',
      key: 'DEV-142',
      href: 'https://linear.app/meridian/issue/DEV-142',
      title: 'Nightly partner export takes 40 minutes',
      changes: [
        { field: 'priority' as const, to: 'Low' },
        { field: 'labels' as const, add: ['perf'], remove: ['bug'] },
        { field: 'assignee' as const, to: 'Ana Ruiz' },
      ],
    },
  ],
}

/** Althar's offer to move a task's issue to review, as its pull request opened. */
export const CHANGES_IN_REVIEW = {
  note: 'PR #212 opened.',
  issues: [
    {
      mark: Brand.Linear,
      source: 'Linear',
      key: 'MER-231',
      href: 'https://linear.app/meridian/issue/MER-231',
      title: 'Rate-limit refunds like charges',
      changes: [{ field: 'status' as const, to: 'In Review' }],
    },
  ],
}

/** A task's lead commented on its issue, at once. */
export const COMMENTED_LINEAR = {
  issues: [
    {
      mark: Brand.Linear,
      source: 'Linear',
      key: 'MER-231',
      href: 'https://linear.app/meridian/issue/MER-231',
      title: 'Rate-limit refunds like charges',
      changes: [
        {
          field: 'comment' as const,
          to: 'Refunds now share the charge limiter: 20 a second per account. The partner export is left out, since it batches its own.',
        },
      ],
    },
  ],
}
