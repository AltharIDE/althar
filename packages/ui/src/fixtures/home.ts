import type { AgentMark } from '../chrome/AgentMarks/AgentMarks'
import { Brand } from '../foundations/brands/brands'
import { RuntimeState, TaskStatus } from '../foundations/vocabulary'
import type { ProjectRef } from '../home/ProjectWord/ProjectWord'
import type { HomeEvent, HomeProject, HomeRun } from '../screens/Home/Home'
import { MARKED } from './marks'

/* The home on a Tuesday afternoon, three hours after you last looked: the
   projects on this Mac (marks.ts), what waits on you across them, what runs,
   and what the loop did meanwhile. Also a quiet morning and a day with
   something broken. */

const ref = (id: string): ProjectRef => {
  const p = MARKED.find((m) => m.id === id)
  if (!p) throw new Error(`No demo project ${id}`)
  return { seed: p.id, ink: p.ink, name: p.name }
}

export const MERIDIAN = ref('meridian')
export const HALYARD = ref('halyard')
export const TESSERA = ref('tessera')
export const FERROUS = ref('ferrous')

/* ---- what waits on you: each kind of call, as a NeedLine is given it ---- */

export const PUBLISH = {
  kind: 'Permission',
  project: HALYARD,
  task: '212',
  title: 'Publish the gateway’s next release',
  command: 'npm publish --tag next --access public',
}

/** A permission meridian's lead asked for, as allowed always on the home. */
export const STATUS = {
  kind: 'Permission',
  project: MERIDIAN,
  task: '416',
  title: 'Run git status -s',
  command: 'git status -s',
}

export const READY = {
  kind: 'Ready to accept',
  project: MERIDIAN,
  task: '416',
  title: 'Return 409 when a refund idempotency key is reused',
  change: {
    repo: 'meridian-api',
    number: 1191,
    add: 212,
    del: 41,
  },
}

export const DECISION = {
  kind: 'Decision',
  project: MERIDIAN,
  task: '423',
  title: 'Queue or fail when a refund retry hits the rate limit?',
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
  because: 'The review on 88 waits for it. Codex signs in with its own tool, in Terminal.',
}

export const STUCK = {
  kind: 'Stuck',
  project: MERIDIAN,
  task: '424',
  title: 'Spike C stalled twice',
  because: 'It went quiet at 12:10 and was started afresh on Opus 5. At 12:41 it went quiet again: no output and no CPU for 20 minutes.',
}

/* ---- what runs ---- */

export const RUNNING: HomeRun[] = [
  {
    id: 'm418',
    project: MERIDIAN,
    title: 'Repair token refresh on privilege change',
  },
  {
    id: 'h207',
    project: HALYARD,
    title: 'Rate-limit the admin routes per token',
  },
  { id: 't88', project: TESSERA, title: 'Tokens for the project inks' },
  {
    id: 'h209',
    project: HALYARD,
    title: 'Retry failed upstream calls with backoff',
    status: TaskStatus.Paused,
  },
  {
    id: 'm424',
    project: MERIDIAN,
    title: 'Find a shape for webhook queue sharding',
  },
]

/* ---- what the loop did since you looked ---- */

export const SINCE: HomeEvent[] = [
  {
    id: 's1',
    icon: 'pr',
    project: MERIDIAN,
    what: 'Pull request #1191 opened',
    detail: 'after Sonnet 5’s review passed on the second round',
    at: '12:58',
  },
  {
    id: 's2',
    icon: 'agents',
    project: HALYARD,
    what: 'Review moved from Claude Code to Codex',
    detail: 'Claude Code reached its usage limit',
    at: '12:31',
  },
  {
    id: 's3',
    icon: 'check',
    project: HALYARD,
    what: 'Review found 2 issues; Opus 5 fixed them',
    detail: 'the second review passed',
    at: '12:14',
  },
  {
    id: 's4',
    icon: 'clock',
    project: MERIDIAN,
    what: 'Implement went quiet; started afresh on Opus 5',
    detail: 'it carried on and finished the step',
    at: '12:05',
  },
  { id: 's5', icon: 'lock', what: 'Leads answered 9 permission asks', detail: 'within the projects’ rules', at: 'since 10:52' },
]

/* ---- the projects ---- */

export const PROJECT_LIST: HomeProject[] = [
  { id: 'meridian', project: MERIDIAN, yours: 2 },
  { id: 'halyard', project: HALYARD, yours: 1 },
  { id: 'tessera', project: TESSERA, yours: 0 },
  { id: 'ferrous', project: FERROUS, yours: 0, note: 'Last task 11 days ago' },
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

export const RUNNING_QUIET: HomeRun[] = [{ id: 't88', project: TESSERA, title: 'Tokens for the project inks' }]

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
  { id: 'tessera', project: TESSERA, yours: 0 },
  { id: 'meridian', project: MERIDIAN, yours: 0, note: 'Last task an hour ago' },
  { id: 'halyard', project: HALYARD, yours: 0, note: 'Last task at 02:00' },
  { id: 'ferrous', project: FERROUS, yours: 0, note: 'Last task 11 days ago' },
]
