// Scrappy: what the fake runtime answers, worked out from the page's state each time it is asked, so the app reads each scenario as the runtime would send it.
import type {
  BoardCall,
  BoardSnapshot,
  BoardTask,
  CoordinatorSnapshot,
  HomeSnapshot,
  PlanStep,
  ProjectRulesView,
  SessionSummary,
  TaskSummary,
  ThreadItem,
  ThreadSnapshot,
} from '@althar/contracts'

import { card as cardOf, change, coordinatorSnapshot, home, items, projectRules, snapshot } from '../../tests/fixtures'
import { minutesAgo } from './clock'
import { agentName, althar, COORDINATOR, ROOT, type Steer, steerOf, T, type TaskKey } from './data'
import type { State } from './store'
import { routeOf } from './usage'
import { usageOf } from './data'

/* ——— Who does what ——— */

/** The account a session runs on: the agent's account with most room. */
const accountFor = (s: State, agentId: string): string | null => routeOf(usageOf(s), agentId)?.account.accountId ?? null

const session = (s: State, agentId: string, model: string, turnRunning: boolean, id: string): SessionSummary => ({
  ...snapshot().session!,
  id,
  agentId,
  agentName: agentName(agentId),
  model,
  account: accountFor(s, agentId),
  effort: 'medium',
  models: [],
  turnRunning,
  turnStartedAt: turnRunning ? minutesAgo(1) : null,
  turnEndedAt: turnRunning ? null : minutesAgo(3),
})

/** The steering, where it touched this task. */
const steeredHere = (s: State, key: TaskKey): Steer | null => {
  const steer = steerOf(s)
  return steer !== null && steer.task === key ? steer : null
}

/**
 * Held for the person: they are asked (the project's rule), or, in C, the
 * account is out and the work waits for it, which C puts in Needs you.
 */
const callFor = (s: State, steer: Steer | null): boolean =>
  steer !== null && (steer.action === 'asks' || (s.d === 'C' && steer.action === 'waits' && steer.left === 0))

/** The steps of a task with a plan: implement, then review, each on its planned model, or where steering sent it. */
const stepsOf = (steer: Steer | null): ReadonlyArray<PlanStep> => {
  const moved = (key: PlanStep['key'], agentId: string, model: string): PlanStep => {
    const to = steer !== null && steer.step === key && steer.to !== null ? steer.to : null
    return { key, agentId: to?.agentId ?? agentId, model: to?.model ?? model, effort: 'medium', skipped: false }
  }
  return [moved('implement', 'claude-code', 'opus'), moved('review', 'codex', 'gpt-5.5')]
}

const waitsOf = (steer: Steer | null): BoardTask['waits'] =>
  steer === null || steer.action !== 'waits'
    ? null
    : {
        agentId: steer.from.agentId,
        until: steer.resetsAt,
        accountId: steer.from.accountId,
        why: 'waits',
        choices: steer.choices,
        ...(steer.left > 0 ? { left: steer.left } : {}),
      }

const boardTask = (key: TaskKey, over: Partial<BoardTask>): BoardTask => ({
  ...cardOf({ plan: null, issue: null }),
  ...T[key],
  kind: 'change',
  branch: `althar/${T[key].slug}`,
  state: 'active',
  createdAt: minutesAgo(60),
  settledAt: null,
  changed: { files: 3, add: 48, del: 9 },
  here: [],
  ...over,
})

const plan = (key: TaskKey, steps: ReadonlyArray<PlanStep>, reason: string | null = 'It knows the composer.') => ({
  id: `pln_${key}`,
  steps,
  startsAt: null,
  reason,
  end: 'draft' as const,
})

/** The project's tasks, as the board has them. */
export const tasksOf = (s: State): ReadonlyArray<BoardTask> => {
  const scroll = steeredHere(s, 'scroll')
  const keep = steeredHere(s, 'keep')
  const keepSteps = stepsOf(keep)
  const keepLead = keepSteps[0]!
  return [
    boardTask('scroll', {
      phase: callFor(s, scroll) ? 'waiting' : 'running',
      plan: plan('scroll', stepsOf(scroll)),
      step: 'review',
      lead: 'claude-code',
      leadModel: 'opus',
      leadEffort: 'medium',
      startedAt: minutesAgo(52),
      waits: waitsOf(scroll),
    }),
    boardTask('keep', {
      phase: callFor(s, keep) ? 'waiting' : 'running',
      plan: plan('keep', keepSteps),
      step: 'implement',
      lead: keepLead.agentId,
      leadModel: keepLead.model,
      leadEffort: 'medium',
      startedAt: minutesAgo(keep === null ? 11 : 2),
      waits: waitsOf(keep),
      changed: keep === null ? { files: 2, add: 31, del: 4 } : null,
    }),
    boardTask('flicker', {
      kind: 'plain',
      phase: 'running',
      lead: 'codex',
      leadModel: 'gpt-5.5',
      leadEffort: 'medium',
      startedAt: minutesAgo(23),
      branch: null,
      changed: null,
    }),
    boardTask('branch', {
      phase: 'ready',
      plan: plan('branch', stepsOf(null)),
      lead: 'claude-code',
      leadModel: 'opus',
      startedAt: minutesAgo(190),
      summary: 'Branches are named after their issue’s key and title, as the project’s pattern says.',
      change: change({
        title: T.branch.title,
        number: 331,
        repository: 'AltharIDE/althar',
        url: 'https://github.com/AltharIDE/althar/pull/331',
        draft: false,
        checks: {
          outcome: 'passed',
          passed: 3,
          failed: 0,
          running: 0,
          total: 3,
          failing: [],
          list: [
            { name: 'verify', state: 'passed', summary: null },
            { name: 'e2e', state: 'passed', summary: null },
            { name: 'lint', state: 'passed', summary: null },
          ],
        },
      }),
    }),
    boardTask('checks', {
      phase: 'held',
      plan: plan('checks', stepsOf(null), 'Claude Code wrote the task card.'),
      lead: 'claude-code',
      leadModel: 'opus',
      startedAt: null,
      changed: null,
      branch: null,
    }),
  ]
}

/** The calls waiting on the person: the step steering held for them, where it did. */
export const callsOf = (s: State): ReadonlyArray<BoardCall> => {
  const steer = steerOf(s)
  if (steer === null || !callFor(s, steer)) return []
  const task = T[steer.task]
  return [
    {
      id: 'call_limit',
      kind: 'stuck',
      title: steer.step === 'review' ? 'Review' : 'Implement',
      reason: '',
      command: null,
      createdAt: minutesAgo(2),
      stuck: {
        step: steer.step,
        why: 'usage_limit',
        detail: null,
        agentId: steer.from.agentId,
        round: 0,
        open: 0,
        limit: {
          accountId: steer.from.accountId,
          resetsAt: steer.resetsAt,
          choices: steer.choices,
          ...(steer.left > 0 ? { left: steer.left } : {}),
        },
      },
      taskId: task.taskId,
      threadId: task.threadId,
      taskTitle: task.title,
      taskSlug: task.slug,
    } as BoardCall,
  ]
}

export const boardOf = (s: State): BoardSnapshot => ({ cursor: 1, tasks: tasksOf(s), calls: callsOf(s), settledTotal: 0 })

export const homeOf = (s: State): HomeSnapshot => {
  const steer = steerOf(s)
  const task = steer === null ? null : T[steer.task]
  return home({
    looked: minutesAgo(40),
    since: minutesAgo(40),
    projects: [althar],
    tasks: tasksOf(s).map((one) => ({ ...one, projectId: 'p1' })),
    calls: callsOf(s).map((one) => ({ ...one, projectId: 'p1' })),
    // What the loop dealt with while the person was away: the step it moved.
    events:
      steer === null || task === null || (steer.action !== 'moved' && steer.action !== 'account')
        ? []
        : [
            {
              kind: 'dealt',
              id: 'ev_steer',
              at: minutesAgo(3),
              projectId: 'p1',
              task: { id: task.taskId, threadId: task.threadId, slug: task.slug, title: task.title },
              about: 'limit',
              title: steer.words,
              description: null,
            },
          ],
  })
}

export const taskListOf = (s: State): ReadonlyArray<TaskSummary> =>
  tasksOf(s).map((one) => ({
    id: one.taskId,
    projectId: 'p1',
    title: one.title,
    slug: one.slug,
    threadId: one.threadId,
    state: 'active',
    branch: one.branch,
    agentId: one.lead,
    waiting: one.phase === 'waiting' ? 1 : 0,
    createdAt: one.createdAt,
  }))

export const rulesOf = (s: State, projectId: string): ProjectRulesView => ({ ...projectRules, projectId, usageLimit: s.rule })

/* ——— The threads ——— */

let made = 0
/** An item, at a moment, after every one before it. */
const at = (item: ThreadItem, minutes: number, id?: string): ThreadItem => {
  made += 1
  return { ...item, id: id ?? `x${made}`, sequence: made, createdAt: minutesAgo(minutes) } as ThreadItem
}

const tool = (title: string, toolKind: string, agentId: string, extra: Record<string, unknown> = {}) =>
  items.tool({ title, toolKind, status: 'completed', ...extra } as Parameters<typeof items.tool>[0], agentId)

/** Althar's own line in the thread: what steering did, and why. */
const steered = (steer: Steer) => at(items.notice({ source: 'runtime', severity: 'info', title: steer.words }, null), 3, `n_${steer.task}`)

const cardItem = (s: State, key: TaskKey) => {
  const task = tasksOf(s).find((one) => one.taskId === T[key].taskId)!
  const { state: _state, createdAt: _created, settledAt: _settled, changed: _changed, here: _here, ...content } = task
  return items.card(content, `card_${key}`)
}

export const coordinatorOf = (s: State): CoordinatorSnapshot => ({
  ...coordinatorSnapshot({ project: { id: 'p1', name: althar.name } }),
  threadId: COORDINATOR,
  session: session(s, 'codex', 'gpt-5.5', false, 's_coordinator'),
  suggested: { agentId: 'codex', agentName: 'Codex', model: 'gpt-5.5', effort: 'medium', available: true },
  items: [
    at(items.you('Show the checks’ names on the task card, not only how many failed.'), 75, 'c1'),
    at(items.says('Planned. It waits for you to start it.', 'codex'), 74, 'c2'),
    at(cardItem(s, 'checks'), 74, 'c3'),
    at(
      items.you(
        'Two things for the composer: let a long dictation scroll instead of growing past the window, and keep what’s typed when I move between screens and back.',
      ),
      58,
      'c4',
    ),
    at(
      items.says(
        'Two tasks, then. Claude Code leads both on Opus 5.5, since it wrote the composer; Codex reviews each on GPT-5.5.',
        'codex',
      ),
      57,
      'c5',
    ),
    at(cardItem(s, 'scroll'), 57, 'c6'),
    at(cardItem(s, 'keep'), 57, 'c7'),
  ],
})

const head = (s: State, key: TaskKey, over: Partial<ThreadSnapshot['task']>): ThreadSnapshot['task'] => {
  const task = tasksOf(s).find((one) => one.taskId === T[key].taskId)!
  return {
    ...snapshot().task,
    id: task.taskId,
    title: task.title,
    slug: task.slug,
    branch: task.branch,
    worktree: `${ROOT}/${task.slug}/althar`,
    phase: task.phase,
    kind: task.kind,
    waits: task.waits,
    steps: task.plan?.steps ?? [],
    lead: task.lead === null ? null : { agentId: task.lead, model: task.leadModel, account: accountFor(s, task.lead) },
    step: task.step,
    stepAt: task.startedAt,
    startedAt: task.startedAt,
    actions: ['stop', 'abandon'],
    planId: task.plan?.id ?? null,
    ...over,
  }
}

const attentionOf = (s: State, key: TaskKey): ThreadSnapshot['attention'] =>
  callsOf(s)
    .filter((call) => call.taskId === T[key].taskId)
    .map(({ taskId: _task, threadId: _thread, taskTitle: _title, taskSlug: _slug, ...request }) => request)

export const threadOf = (s: State, threadId: string): ThreadSnapshot => {
  const base = snapshot()
  const key = (Object.keys(T) as TaskKey[]).find((one) => T[one].threadId === threadId)
  if (key === undefined) return { ...base, threadId, project: { id: 'p1', name: althar.name } }
  const steer = steeredHere(s, key)
  const stands = steer === null || steer.action === 'moved' || steer.action === 'account'
  const withProject = { ...base, threadId, project: { id: 'p1', name: althar.name }, attention: attentionOf(s, key), reports: [] }
  switch (key) {
    case 'scroll': {
      const reviewer = stepsOf(steer)[1]!
      const items_: ThreadItem[] = [
        at(items.you('Let a long dictation scroll in the composer, instead of growing the field past the window.'), 52, 's1'),
        at(
          items.says(
            'I’ll cap the composer’s height at 40% of the window and let the field scroll past that, so a long dictation never pushes the thread away.',
          ),
          51,
          's2',
        ),
        at(tool('Read Composer.tsx', 'read', 'claude-code'), 50, 's3'),
        at(tool('Edit Composer.module.css', 'edit', 'claude-code'), 48, 's4'),
        at(tool('Edit useAutosize.ts', 'edit', 'claude-code'), 46, 's5'),
        at(tool('Run the composer’s tests', 'execute', 'claude-code', { command: 'bunx vp test run composer --maxWorkers=1' }), 44, 's6'),
        at(
          items.says(
            'Done: the field stops growing at 40% of the window and scrolls inside from there; the send row stays put. Checked in the composer’s story with a dictation of 900 words.',
          ),
          42,
          's7',
        ),
        at(
          items.step({
            step: 'implement',
            summary: 'Capped the composer at 40% of the window; the field scrolls inside it.',
            agentId: 'claude-code',
          }),
          41,
          's8',
        ),
        ...(steer === null || steer.action === 'asks' ? [] : [steered(steer)]),
        ...(stands
          ? [
              at(tool('Read the change', 'read', reviewer.agentId), 2, 's9'),
              at(tool('Read useAutosize.ts', 'read', reviewer.agentId, { status: 'in_progress' }), 1, 's10'),
            ]
          : []),
      ]
      return {
        ...withProject,
        task: head(s, 'scroll', {}),
        session: stands
          ? session(s, reviewer.agentId, reviewer.model ?? 'gpt-5.5', true, 's_scroll_review')
          : session(s, 'claude-code', 'opus', false, 's_scroll'),
        items: items_,
      }
    }
    case 'keep': {
      const lead = stepsOf(steer)[0]!
      const items_: ThreadItem[] = [
        at(items.you('Keep what’s typed in the composer when I move between screens and back.'), stands && steer !== null ? 3 : 12, 'k1'),
        ...(steer === null || steer.action === 'asks' ? [] : [steered(steer)]),
        ...(stands
          ? [
              at(
                items.says(
                  'I’ll keep each composer’s draft by its thread in the window’s store, and put it back when that screen opens again.',
                  lead.agentId,
                ),
                steer === null ? 11 : 2,
                'k2',
              ),
              at(tool('Read drafts.ts', 'read', lead.agentId), steer === null ? 10 : 2, 'k3'),
              at(tool('Edit drafts.ts', 'edit', lead.agentId, { status: 'in_progress' }), 1, 'k4'),
            ]
          : []),
      ]
      return {
        ...withProject,
        task: head(s, 'keep', {}),
        session: session(s, lead.agentId, lead.model ?? 'opus', stands, 's_keep'),
        items: items_,
      }
    }
    case 'flicker':
      return {
        ...withProject,
        task: head(s, 'flicker', { steps: [], planId: null }),
        session: session(s, 'codex', 'gpt-5.5', true, 's_flicker'),
        items: [
          at(items.you('The dock flickers once when the Mac wakes. Find out why before changing anything.'), 23, 'f1'),
          at(items.says('I’ll watch what the dock draws as the window comes back, and when.', 'codex'), 22, 'f2'),
          at(tool('Read DockView.tsx', 'read', 'codex'), 20, 'f3'),
          at(tool('Search for powerMonitor', 'search', 'codex', { status: 'in_progress' }), 1, 'f4'),
        ],
      }
    case 'branch':
      return {
        ...withProject,
        task: head(s, 'branch', { changes: [tasksOf(s).find((one) => one.taskId === T.branch.taskId)!.change!] }),
        session: session(s, 'claude-code', 'opus', false, 's_branch'),
        items: [
          at(items.you('Name each task’s branch after the issue it came from.'), 190, 'b1'),
          at(items.says('Done: the branch takes the issue’s key and title, as the project’s pattern says.'), 150, 'b2'),
        ],
      }
    case 'checks':
      return {
        ...withProject,
        task: head(s, 'checks', {}),
        session: null,
        items: [at(items.you('Show the checks’ names on the task card, not only how many failed.'), 6, 'h1')],
      }
    default:
      return withProject
  }
}

/** A thread's item, read again by its id. */
export const itemOf = (s: State, threadId: string, itemId: string): ThreadItem | undefined =>
  (threadId === COORDINATOR ? coordinatorOf(s).items : threadOf(s, threadId).items).find((item) => item.id === itemId)

export { usageOf }
