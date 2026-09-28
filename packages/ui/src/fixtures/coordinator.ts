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

/** A project's "always ask me" list, and which of it is on. */
export const ALWAYS_ASK = [
  { id: 'prod', label: 'Deploys, and anything that reaches production' },
  { id: 'staging', label: 'Commands that reach staging' },
  { id: 'main', label: 'Pushing to main' },
  { id: 'spend', label: 'Spending more than $5 on one task' },
  { id: 'outside', label: 'Deleting files outside the task’s workspace' },
  { id: 'people', label: 'Messages to people: email, Slack, issue comments' },
] as const
export const ALWAYS_ON = ['prod', 'staging', 'main', 'spend', 'outside'] as const

/** A project's "never" list: refused outright, whatever the policy. */
export const NEVER = [
  { id: 'secrets', label: 'Reading .env files, keys and other secrets' },
  { id: 'force', label: 'Force-pushing, or rewriting pushed history' },
  { id: 'proddb', label: 'Writing to the production database' },
  { id: 'install', label: 'Installing packages from outside the lockfile’s registries' },
] as const
export const NEVER_ON = ['secrets', 'force', 'proddb'] as const

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
