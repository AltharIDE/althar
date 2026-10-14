import type {
  BoardSnapshot,
  BoardTask,
  ChangeSummary,
  ChecksSummary,
  HomeEvent,
  HomeSnapshot,
  HomeTask,
  ProjectSummary,
} from '@althar/contracts'

import { type Facts, standingOf } from './standing'

/*
 * A morning on Althar's own board: real task titles from this repository,
 * each ready card in one of the states the brief asks for. `today` is the
 * runtime as it is: a ready task whose lead resolves a conflict goes back to
 * Running, and nothing else here reaches the card. The directions keep it
 * ready, as they'd need the runtime to, and read the facts below.
 */

/** Now, to the minute: the home reads the real clock, so every time here is said from it. */
export const NOW = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString()
const at = (minutesAgo: number) => new Date(new Date(NOW).getTime() - minutesAgo * 60_000).toISOString()

export const ALTHAR: ProjectSummary = {
  id: 'p-althar',
  name: 'althar',
  slug: 'althar',
  ink: 'slate',
  lastWorkAt: at(4),
  repository: '/Users/balazs/Projects/charrette-project/althar',
  repositories: ['althar'],
  worktrees: '/Users/balazs/Charrette/althar',
  tasks: 48,
  running: 1,
  waiting: 7,
  working: 1,
  ready: 7,
  usageLimit: 'move',
  rotateAccounts: false,
  onlyAccounts: null,
}

type CheckState = ChecksSummary['list'][number]['state']

/** The repository's own workflows, as GitHub names their jobs. */
const JOBS = ['desktop / verify', 'harness / verify', 'ui / verify', 'site / verify', 'Workers Builds: althar-pitch'] as const

/** A head's checks: each job's state, in the order above; a sixth for a change that packages the app. */
const checks = (states: ReadonlyArray<CheckState>, jobs: ReadonlyArray<string> = JOBS): ChecksSummary => {
  const list = states.map((state, i) => ({ name: jobs[i] ?? `check ${i + 1}`, state, summary: null }))
  const count = (state: CheckState) => list.filter((one) => one.state === state).length
  const failed = count('failed')
  const running = count('running') + count('queued')
  return {
    outcome: failed > 0 ? 'failed' : running > 0 ? 'running' : list.length === 0 ? 'none' : 'passed',
    passed: count('passed'),
    failed,
    running,
    total: list.length,
    failing: list.filter((one) => one.state === 'failed').map((one) => one.name),
    list,
  }
}

const passing = (n = 5) =>
  checks(
    Array.from({ length: n }, () => 'passed' as const),
    [...JOBS, 'desktop / package'],
  )

const pr = (
  number: number,
  title: string,
  add: number,
  del: number,
  given: ChecksSummary,
  more: Partial<ChangeSummary> = {},
): ChangeSummary => ({
  product: 'github',
  number,
  title,
  url: `https://github.com/AltharIDE/althar/pull/${number}`,
  state: 'open',
  draft: false,
  noun: 'pull request',
  short: 'PR',
  prefix: '#',
  repository: 'AltharIDE/althar',
  slug: null,
  additions: add,
  deletions: del,
  changedFiles: Math.max(1, Math.round((add + del) / 40)),
  checks: given,
  head: `${number}a7c3e`,
  listening: true,
  localHead: `${number}a7c3e`,
  unpushed: 0,
  diverged: null,
  ...more,
})

const task = (id: string, title: string, slug: string, more: Partial<BoardTask>): BoardTask => ({
  taskId: id,
  threadId: `th-${id}`,
  title,
  slug,
  phase: 'ready',
  kind: 'change',
  plan: {
    id: `pln-${id}`,
    steps: [
      { key: 'implement', agentId: 'claude-code', model: null, skipped: false },
      { key: 'review', agentId: 'codex', model: null, skipped: false },
    ],
    startsAt: null,
    reason: null,
    end: 'ready',
  },
  issue: null,
  change: null,
  step: null,
  summary: null,
  lead: 'claude-code',
  leadModel: null,
  leadEffort: null,
  branch: `althar/${slug}`,
  startedAt: at(95),
  waits: null,
  queued: null,
  state: 'open',
  createdAt: at(120),
  settledAt: null,
  changed: null,
  here: [],
  ...more,
})

/** One ready task per state, with what the card doesn't carry yet beside it. */
export interface Case {
  readonly key: string
  /** The state, as the shots caption it. */
  readonly state: string
  readonly task: BoardTask
  readonly facts: Facts
  /** On the board, or only on the sheet of states. */
  readonly onBoard: boolean
}

const QUERIES = 'packages/runtime/src/Queries.ts'

export const CASES: ReadonlyArray<Case> = [
  {
    key: 'clear',
    state: 'All clear',
    onBoard: true,
    facts: {},
    task: task('t164', 'Give Download the installer for this computer', 'give-download-the-installer-for-this-computer', {
      change: pr(164, 'Give Download the installer for this computer', 212, 40, passing(6)),
    }),
  },
  {
    key: 'running',
    state: 'Checks running (3 of 5)',
    onBoard: true,
    facts: {},
    task: task('t150', 'Copy button on code blocks in messages', 'copy-button-on-code-blocks-in-messages', {
      change: pr(150, 'Copy button on code blocks in messages', 86, 4, checks(['running', 'passed', 'running', 'passed', 'running'])),
    }),
  },
  {
    key: 'failed',
    state: 'Checks failing',
    onBoard: true,
    facts: {},
    task: task('t151', 'Let the person rename a task', 'let-the-person-rename-a-task', {
      change: pr(151, 'Let the person rename a task', 340, 22, checks(['failed', 'passed', 'passed', 'passed', 'passed'])),
    }),
  },
  {
    key: 'conflict',
    state: 'Conflict with main',
    onBoard: true,
    facts: { conflict: { files: [QUERIES], lead: 'none' } },
    task: task('t154', 'Settled count stuck at 30: show the real total', 'settled-count-stuck-at-30-show-the-real-total', {
      change: pr(154, 'Settled count stuck at 30: show the real total', 58, 11, passing()),
    }),
  },
  {
    key: 'resolving',
    state: 'Conflict, the lead resolving it',
    onBoard: true,
    facts: { conflict: { files: [QUERIES, 'packages/runtime/src/Changes.ts'], lead: 'resolving' } },
    task: task('t155', 'Don’t count idle servers toward the agents-at-once cap', 'don-t-count-idle-servers-toward-the-agents-at-on', {
      change: pr(155, 'Don’t count idle servers toward the agents-at-once cap', 120, 30, passing()),
    }),
  },
  {
    key: 'unpushed',
    state: '3 commits to push',
    onBoard: true,
    facts: {},
    task: task('t115', 'Let a lead ask Althar to push its new commits', 'let-a-lead-ask-althar-to-push-its-new-commits', {
      change: pr(115, 'Let a lead ask Althar to push its new commits', 410, 60, passing(), { unpushed: 3 }),
    }),
  },
  {
    key: 'two',
    state: 'Two at once: a check failing, 2 commits to push',
    onBoard: true,
    facts: {},
    task: task('t131', 'Handle a task branch that diverged from its PR', 'handle-a-task-branch-that-diverged-from-its-pr', {
      change: pr(
        131,
        'Handle a task branch that diverged from its PR',
        260,
        45,
        checks(['passed', 'failed', 'passed', 'passed', 'passed']),
        {
          unpushed: 2,
        },
      ),
    }),
  },
  {
    key: 'draft',
    state: 'Still a draft',
    onBoard: false,
    facts: {},
    task: task('t152', 'Finish each task with a summary of what was built', 'finish-each-task-with-a-summary-of-what-was-buil', {
      change: pr(152, 'Finish each task with a summary of what was built', 198, 31, passing(), { draft: true }),
    }),
  },
  {
    key: 'changes',
    state: 'Changes requested in review',
    onBoard: false,
    facts: { changesRequested: { by: 'okafor' } },
    task: task('t114', 'Hand the coordinator to a fresh session before it fills', 'hand-the-coordinator-to-a-fresh-session-before-i', {
      change: pr(114, 'Hand the coordinator to a fresh session before it fills', 530, 96, passing()),
    }),
  },
  {
    key: 'behind',
    state: 'Behind main (doesn’t block)',
    onBoard: false,
    facts: { behind: 14 },
    task: task('t132', 'Toggle to have the lead resolve merge conflicts itself', 'dev-85-toggle-to-have-the-lead-resolve-merge-conflicts', {
      change: pr(132, 'Toggle to have the lead resolve merge conflicts itself', 302, 18, passing()),
    }),
  },
]

/** Today, a ready task whose lead resolves a conflict is running again, on the step `conflict`. */
const asToday = (one: Case): BoardTask =>
  one.facts.conflict?.lead === 'resolving' ? { ...one.task, phase: 'running', step: 'conflict', startedAt: at(6) } : one.task

/** Each case's task as the page's mode has it. */
export const taskOf = (one: Case, today: boolean): BoardTask => (today ? asToday(one) : one.task)

const NEXT = task('t-mic', 'Choose the microphone used for dictation', 'choose-the-microphone-used-for-dictation', {
  phase: 'held',
  plan: {
    id: 'pln-mic',
    steps: [{ key: 'implement', agentId: 'claude-code', model: null, skipped: false }],
    startsAt: null,
    reason: null,
    end: 'ready',
  },
  startedAt: null,
  change: null,
})

const settled = (id: string, title: string, slug: string, number: number, minutesAgo: number): BoardTask =>
  task(id, title, slug, {
    phase: 'settled',
    state: 'done',
    settledAt: at(minutesAgo),
    change: { ...pr(number, title, 100, 20, passing()), state: 'merged', localHead: null },
  })

const SETTLED: ReadonlyArray<BoardTask> = [
  settled('t163', 'Keep quick tasks on this Mac, and let the lead make one a change', 'keep-quick-tasks-on-this-mac', 163, 38),
  settled('t159', 'Read a task’s kind from what it has', 'read-a-task-s-kind-from-what-it-has', 159, 410),
  settled('t157', 'Let a finished task go back to work and ship again', 'let-a-finished-task-go-back-to-work-and-ship-aga', 157, 1300),
]

/** The facts beside each task, by title, as the wrappers look them up. */
export const FACTS: ReadonlyMap<string, Facts> = new Map(CASES.map((one) => [one.task.title, one.facts]))

/** Ready ones in the order the lane would sort them: good to merge, then what's blocked, then what waits. */
const RANK = { merge: 0, blocked: 1, waiting: 2 } as const
export const sortedByGroup = (tasks: ReadonlyArray<BoardTask>) =>
  tasks.toSorted((a, b) => RANK[standingOf(a, FACTS.get(a.title)).group] - RANK[standingOf(b, FACTS.get(b.title)).group])

/** The board: one held up next, seven ready (today, one of them back in Running), three settled of 41. */
export const boardOf = (today: boolean, sort = false): BoardSnapshot => {
  const ready = CASES.filter((one) => one.onBoard).map((one) => taskOf(one, today))
  return {
    cursor: 1,
    tasks: [NEXT, ...(sort ? sortedByGroup(ready) : ready), ...SETTLED],
    calls: [],
    settledTotal: 41,
  }
}

const event = (id: string, minutesAgo: number, one: BoardTask, result: Extract<HomeEvent, { kind: 'step' }>['result']): HomeEvent => ({
  kind: 'step',
  id,
  at: at(minutesAgo),
  projectId: ALTHAR.id,
  task: { id: one.taskId, threadId: one.threadId, slug: one.slug, title: one.title },
  result,
})

const result = (step: 'implement' | 'review' | 'publish', more: Partial<Extract<HomeEvent, { kind: 'step' }>['result']> = {}) => ({
  step,
  round: 0,
  summary: '',
  change: null,
  verdict: null,
  findings: [],
  built: null,
  evidence: [],
  unverified: null,
  agentId: null,
  ...more,
})

/** The home: the same project's ready work, and what the loop did since the person looked, before lunch. */
export const homeOf = (today: boolean, sort = false): HomeSnapshot => {
  const board = boardOf(today, sort)
  const tasks: ReadonlyArray<HomeTask> = board.tasks
    .filter((one) => one.phase === 'ready' || one.phase === 'running')
    .map((one) => ({ ...one, projectId: ALTHAR.id }))
  const [clear, running, failed] = CASES.map((one) => one.task)
  return {
    cursor: 1,
    looked: at(190),
    since: at(190),
    tasks,
    calls: [],
    events: [
      ...(clear === undefined ? [] : [event('e1', 12, clear, result('publish', { change: clear.change, summary: 'Opened #164' }))]),
      ...(running === undefined ? [] : [event('e2', 30, running, result('review', { verdict: 'pass' }))]),
      ...(failed === undefined ? [] : [event('e3', 54, failed, result('implement'))]),
    ],
    projects: [ALTHAR],
  }
}
