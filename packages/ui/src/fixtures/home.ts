import type { AgentMark } from '../chrome/AgentMarks/AgentMarks'
import { Brand } from '../foundations/brands/brands'
import { RuntimeState, TaskStatus } from '../foundations/vocabulary'
import type { ProjectRowProps } from '../home/ProjectRow/ProjectRow'
import type { ProjectRef } from '../home/ProjectWord/ProjectWord'
import type { RunRowProps } from '../home/RunRow/RunRow'
import type { SinceRowProps } from '../home/SinceRow/SinceRow'
import { MARKED } from './marks'
import { CODEX, OPUS, SONNET } from './models'
import { GITHUB } from './outputs'

/* The home on a Tuesday afternoon, three hours after you last looked: the
   projects on this Mac (marks.ts), what waits on you across them, what runs,
   and what the loop did meanwhile. Also a quiet morning and a day with
   something broken. */

/* What the home screen is given for each row; the same shapes as its own types. */
type HomeRun = Omit<RunRowProps, 'onOpen' | 'current' | 'text'> & { id: string }
type HomeEvent = Omit<SinceRowProps, 'text'> & { id: string }
type HomeProject = Omit<ProjectRowProps, 'onOpen' | 'className' | 'text'> & { id: string }

const ref = (id: string): ProjectRef => {
  const p = MARKED.find((m) => m.id === id)
  if (!p) throw new Error(`No demo project ${id}`)
  return { seed: p.id, ink: p.ink, name: p.name }
}

export const MERIDIAN = ref('meridian')
export const HALYARD = ref('halyard')
export const TESSERA = ref('tessera')
export const FERROUS = ref('ferrous')

/* ---- what waits on you: each kind of call, as a NeedCard is given it ---- */

export const PUBLISH = {
  kind: 'Permission',
  project: HALYARD,
  task: '212',
  title: 'Publish the gateway’s next release',
  at: '4m ago',
  command: 'npm publish --tag next --access public',
  agent: CODEX,
  step: 'Release',
}

export const READY = {
  kind: 'Ready to accept',
  project: MERIDIAN,
  task: '416',
  title: 'Return 409 when a refund idempotency key is reused',
  at: '22m ago',
  change: { host: GITHUB, repo: 'meridian-api', number: 1191, add: 212, del: 41, checks: 3, lead: OPUS, reviewer: SONNET },
}

export const DECISION = {
  kind: 'Decision',
  project: MERIDIAN,
  task: '423',
  title: 'Queue or fail when a refund retry hits the rate limit?',
  at: '1h ago',
  options: [
    { id: 'queue', label: 'Queue and retry with backoff' },
    { id: 'fail', label: 'Fail fast to the caller' },
  ],
}

export const SIGNED_OUT = {
  kind: 'Sign-in',
  project: TESSERA,
  task: '88',
  title: 'Codex is signed out',
  at: '9m ago',
  because: 'The review on 88 waits for it. Codex signs in with its own tool, in Terminal.',
}

export const STUCK = {
  kind: 'Stuck',
  project: MERIDIAN,
  task: '424',
  title: 'Spike C stalled twice',
  at: '14m ago',
  because: 'It went quiet at 12:10 and was started afresh on Opus 5. At 12:41 it went quiet again: no output and no CPU for 20 minutes.',
}

/* ---- what runs ---- */

const STEPS = ['Plan', 'Implement', 'Review', 'Fix', 'PR']

export const RUNNING: HomeRun[] = [
  {
    id: 'm418',
    project: MERIDIAN,
    task: '418',
    title: 'Repair token refresh on privilege change',
    steps: ['Requirements', 'Implement', 'Review', 'Repair', 'Security review', 'Verify'],
    at: 4,
    who: SONNET,
    elapsed: '6m',
  },
  {
    id: 'h207',
    project: HALYARD,
    task: '207',
    title: 'Rate-limit the admin routes per token',
    steps: STEPS,
    at: 2,
    who: CODEX,
    elapsed: '41m',
  },
  { id: 't88', project: TESSERA, task: '88', title: 'Tokens for the project inks', steps: STEPS, at: 1, who: SONNET, elapsed: '1h 32m' },
  {
    id: 'h209',
    project: HALYARD,
    task: '209',
    title: 'Retry failed upstream calls with backoff',
    status: TaskStatus.Paused,
    steps: STEPS,
    at: 1,
    who: SONNET,
    elapsed: '1h 05m',
    note: 'Waits for Claude Code’s reset at 14:20',
  },
  {
    id: 'm424',
    project: MERIDIAN,
    task: '424',
    title: 'Find a shape for webhook queue sharding',
    steps: ['Spike A', 'Spike B', 'Spike C', 'Compare'],
    at: 2,
    who: OPUS,
    elapsed: '22m',
  },
]

/* ---- what the loop did since you looked ---- */

export const SINCE: HomeEvent[] = [
  {
    id: 's1',
    icon: 'pr',
    project: MERIDIAN,
    task: '416',
    what: 'Pull request #1191 opened',
    detail: 'after Sonnet 5’s review passed on the second round',
    at: '12:58',
  },
  {
    id: 's2',
    icon: 'agents',
    project: HALYARD,
    task: '207',
    what: 'Review moved from Claude Code to Codex',
    detail: 'Claude Code reached its usage limit',
    at: '12:31',
  },
  {
    id: 's3',
    icon: 'check',
    project: HALYARD,
    task: '212',
    what: 'Review found 2 issues; Opus 5 fixed them',
    detail: 'the second review passed',
    at: '12:14',
  },
  {
    id: 's4',
    icon: 'clock',
    project: MERIDIAN,
    task: '423',
    what: 'Implement went quiet; started afresh on Opus 5',
    detail: 'it carried on and finished the step',
    at: '12:05',
  },
  { id: 's5', icon: 'lock', what: 'Leads answered 9 permission asks', detail: 'within the projects’ rules', at: 'since 10:52' },
]

/* ---- the projects ---- */

export const PROJECT_LIST: HomeProject[] = [
  { id: 'meridian', project: MERIDIAN, running: 2, yours: 2, now: { step: 'Security review', task: '418', who: SONNET }, kbd: '⌘1' },
  { id: 'halyard', project: HALYARD, running: 2, yours: 1, now: { step: 'Review', task: '207', who: CODEX }, kbd: '⌘2' },
  { id: 'tessera', project: TESSERA, running: 1, yours: 0, now: { step: 'Implement', task: '88', who: SONNET }, kbd: '⌘3' },
  { id: 'ferrous', project: FERROUS, running: 0, yours: 0, note: 'Last task 11 days ago', kbd: '⌘4' },
]

/* ---- the agents, in the bar ---- */

export const AGENTS_READY: AgentMark[] = [
  { id: 'claude-code', name: 'Claude Code', brand: Brand.ClaudeCode, state: RuntimeState.Ready },
  { id: 'codex', name: 'Codex', brand: Brand.Codex, state: RuntimeState.Ready },
  { id: 'opencode', name: 'OpenCode', state: RuntimeState.Ready },
]

export const AGENTS_TROUBLED: AgentMark[] = [
  { id: 'claude-code', name: 'Claude Code', brand: Brand.ClaudeCode, state: RuntimeState.OutOfUsage, back: '14:20' },
  { id: 'codex', name: 'Codex', brand: Brand.Codex, state: RuntimeState.SignedOut },
  { id: 'opencode', name: 'OpenCode', state: RuntimeState.Ready },
]

/* ---- a quiet morning ---- */

export const RUNNING_QUIET: HomeRun[] = [
  { id: 't88', project: TESSERA, task: '88', title: 'Tokens for the project inks', steps: STEPS, at: 2, who: CODEX, elapsed: '2h 10m' },
]

export const SINCE_QUIET: HomeEvent[] = [
  {
    id: 'q1',
    icon: 'clock',
    project: HALYARD,
    task: '209',
    what: 'Resumed after Claude Code’s reset',
    detail: 'it had waited since 23:40',
    at: '02:00',
  },
  {
    id: 'q2',
    icon: 'file',
    project: MERIDIAN,
    task: '424',
    what: 'Spike finished; the comparison is in the task',
    detail: 'three shapes, side by side',
    at: '01:12',
  },
  { id: 'q3', icon: 'lock', what: 'Leads answered 4 permission asks', detail: 'within the projects’ rules', at: 'overnight' },
]

export const PROJECTS_QUIET: HomeProject[] = [
  { id: 'tessera', project: TESSERA, running: 1, yours: 0, now: { step: 'Review', task: '88', who: CODEX }, kbd: '⌘3' },
  { id: 'meridian', project: MERIDIAN, running: 0, yours: 0, note: 'Last task an hour ago', kbd: '⌘1' },
  { id: 'halyard', project: HALYARD, running: 0, yours: 0, note: 'Last task at 02:00', kbd: '⌘2' },
  { id: 'ferrous', project: FERROUS, running: 0, yours: 0, note: 'Last task 11 days ago', kbd: '⌘4' },
]
