import {
  type BoardSnapshot,
  type BoardTask,
  type GoalControl,
  nextGoal,
  type ProjectSummary,
  type ThreadGoal,
  type ThreadItem,
  type ThreadSnapshot,
} from '@althar/contracts'

import type { Client } from '../../src/renderer/data/client'
import {
  card,
  connectionList,
  coordinatorSnapshot,
  fakeClient,
  githubConnection,
  home,
  items,
  repositories,
  snapshot,
} from '../../tests/fixtures'
import type { Surface } from './commands'
import { lab } from './state'

/*
 * What the lab's fake runtime says: althar's board with a few tasks, an aside
 * on Scratch, the coordinator's conversation, and the task the lab opens on,
 * whose lead has just said the spec it wrote fails on CI: what a goal is for.
 * A goal set, changed, paused or cleared is kept here, so the task's next read
 * agrees with the press, and lands in the thread as the direction on show
 * says it should: as what the person said (A, C), or as Althar's line (B, D).
 */

export const ALTHAR = 'p_althar'

const opened = Date.now()
const minutesAgo = (minutes: number) => new Date(opened - minutes * 60_000).toISOString()

export const TASK = 'th_onboarding'
export const ASIDE = 'th_dock-flicker'
export const COORDINATOR = 'thc_althar'

/** Which composer a draft is (the app keys drafts `coordinator:…`, `thread:…`, `artifact:…`), and its thread. */
export const whereOf = (draft: string): { surface: Surface; threadId: string } => {
  const [kind = '', id = ''] = draft.split(/:(.*)/s)
  if (kind === 'coordinator') return { surface: 'coordinator', threadId: COORDINATOR }
  if (kind === 'thread') return { surface: id === ASIDE ? 'aside' : 'task', threadId: id }
  return { surface: 'artifact', threadId: id }
}

/** The goal as the lab opens on it: none, or one at work or paused (?goal=active|paused). */
const ACTIVE: ThreadGoal = {
  revision: 3,
  objective: 'Get e2e/onboarding.spec.ts passing on CI’s Linux run',
  status: 'active',
  rounds: 3,
  roundLimit: 12,
  progress: 'Waits for the fonts before the first shot; Linux still times out on the GitHub step.',
  detail: null,
  waiting: false,
}
export const GOAL_PRESETS = {
  none: null,
  active: ACTIVE,
  paused: { ...ACTIVE, status: 'paused' as const },
} satisfies Record<string, ThreadGoal | null>
export type GoalPreset = keyof typeof GOAL_PRESETS

const asked = new URLSearchParams(window.location.search).get('goal')
const goals = new Map<string, ThreadGoal | null>([[TASK, GOAL_PRESETS[(asked ?? 'none') as GoalPreset] ?? null]])
/** What landed in each thread after it opened: the commands, as each direction says them, and the lead's answers. */
const landed = new Map<string, ThreadItem[]>()
const listeners = new Set<() => void>()
const changed = () => {
  for (const listener of listeners) listener()
}

export const world = {
  goal: (threadId: string) => goals.get(threadId) ?? null,
  preset: (threadId: string, preset: GoalPreset) => {
    goals.set(threadId, GOAL_PRESETS[preset])
    landed.delete(threadId)
    changed()
  },
  presetOf: (threadId: string): GoalPreset => {
    const goal = goals.get(threadId) ?? null
    return goal === null ? 'none' : goal.status === 'active' ? 'active' : 'paused'
  },
  onChange: (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

/** A sample command sent in the lab: said in the thread as words, as the ones to come aren't wired. */
let sequence = 0
const at = () => {
  sequence += 1
  return new Date(Date.now() + sequence).toISOString()
}

const land = (threadId: string, item: ThreadItem) => {
  landed.set(threadId, [...(landed.get(threadId) ?? []), { ...item, createdAt: at() } as ThreadItem])
}

/** The command as the person typed it. */
const typed = (control: GoalControl) =>
  control.action === 'set'
    ? `/goal ${control.objective}`
    : control.action === 'edit'
      ? `/goal edit ${control.objective}`
      : `/goal ${control.action}`

/** The command as Althar says it happened. */
const told = (control: GoalControl, before: ThreadGoal | null, after: ThreadGoal | null) => {
  switch (control.action) {
    case 'set':
      return before === null ? `You set a goal: ${after?.objective ?? ''}` : `You replaced the goal: ${after?.objective ?? ''}`
    case 'edit':
      return `You changed the goal: ${after?.objective ?? ''}`
    case 'pause':
      return 'You paused the goal.'
    case 'resume':
      return 'You resumed the goal.'
    case 'clear':
      return 'You cleared the goal.'
  }
}

/** What the lead says as a goal starts it, a moment after. */
const ANSWER: Record<'set' | 'resume', string> = {
  set: 'Working toward it. First the GitHub step: it waits on a device code the fake host never sends on Linux.',
  resume: 'Picking it up again from the GitHub step.',
}

const setGoal = async ({ threadId, control }: { threadId: string; control: GoalControl }) => {
  const before = world.goal(threadId)
  const after = nextGoal(before, control)
  goals.set(threadId, after)
  const d = lab.get().d
  if (d === 'b' || d === 'd') land(threadId, items.notice({ title: told(control, before, after), source: 'runtime' }, null))
  else if (d !== 'today') land(threadId, items.you(typed(control), null))
  changed()
  if (control.action === 'set' || control.action === 'resume') {
    const answer = ANSWER[control.action]
    window.setTimeout(() => {
      land(threadId, items.says(answer, 'claude-code'))
      changed()
    }, 900)
  }
  return after
}

interface Said {
  readonly who: 'you' | 'lead'
  readonly text: string
  readonly ago: number
}

const said = (one: Said): ThreadItem =>
  ({ ...(one.who === 'you' ? items.you(one.text) : items.says(one.text, 'claude-code')), createdAt: minutesAgo(one.ago) }) as ThreadItem

const ONBOARDING: ReadonlyArray<Said> = [
  {
    who: 'you',
    text: 'Put a short onboarding checklist on the home: connect GitHub, add a project, start a first task. Each item ticks itself once it’s done.',
    ago: 52,
  },
  {
    who: 'lead',
    text: 'Done. The checklist sits over the home’s projects and ticks each item from what Althar already knows: a connection, a project, a task. It goes once all three are done.\n\n`e2e/onboarding.spec.ts` passes here, but CI’s Linux run fails at the GitHub step: it times out waiting for the connection to show as connected.',
    ago: 41,
  },
]

const DOCK: ReadonlyArray<Said> = [
  { who: 'you', text: 'Why does the dock flicker on wake?', ago: 9 },
  {
    who: 'lead',
    text: 'It draws once with an empty board before the first read comes back after the Mac wakes. Keeping the last board it drew until the read answers would stop it.',
    ago: 8,
  },
]

const CHAT: ReadonlyArray<Said> = [
  { who: 'you', text: 'Is 0.9.0 ready to tag?', ago: 64 },
  {
    who: 'lead',
    text: 'Nearly. **#958** is green and waits on your merge, and the release notes are still being written in **Release 0.9.0**. I’ll tag v0.9.0 once both land.',
    ago: 63,
  },
]

const project: ProjectSummary = {
  id: ALTHAR,
  name: 'althar',
  slug: 'althar',
  ink: 'clay',
  lastWorkAt: minutesAgo(2),
  repository: '/Users/you/Code/althar',
  repositories: ['althar'],
  worktrees: '/Users/you/Charrette/althar',
  tasks: 3,
  running: 1,
  yours: 1,
  working: 1,
  usageLimit: 'move',
  rotateAccounts: false,
  onlyAccounts: null,
  coordinatorThreadId: COORDINATOR,
}

interface WorldTask {
  readonly threadId: string
  readonly title: string
  readonly phase: BoardTask['phase']
  readonly ago: number
  readonly scratch?: boolean
}

const TASKS: ReadonlyArray<WorldTask> = [
  { threadId: TASK, title: 'Onboarding checklist on the home', phase: 'ready', ago: 41 },
  { threadId: 'th_small-changes', title: 'Cut a small change’s overhead', phase: 'running', ago: 12 },
  { threadId: 'th_release', title: 'Release 0.9.0', phase: 'planned', ago: 4 },
  { threadId: ASIDE, title: 'Why does the dock flicker on wake?', phase: 'ready', ago: 8, scratch: true },
]

const slugOf = (threadId: string) => threadId.replace(/^th_/, '')
const taskIdOf = (threadId: string) => `t_${slugOf(threadId)}`

const boardCard = (task: WorldTask): BoardTask => ({
  ...card({
    taskId: taskIdOf(task.threadId),
    threadId: task.threadId,
    title: task.title,
    slug: slugOf(task.threadId),
    phase: task.phase,
    kind: task.scratch === true ? 'plain' : 'change',
    branch: task.scratch === true ? null : `althar/${slugOf(task.threadId)}`,
    plan: null,
    change: null,
    step: task.phase === 'running' ? 'implement' : null,
    lead: 'claude-code',
    startedAt: task.phase === 'planned' ? null : minutesAgo(task.ago),
  }),
  state: 'active',
  createdAt: minutesAgo(task.ago),
  settledAt: null,
  changed: null,
  here: [],
  ...(task.scratch === true ? { scratch: true } : {}),
})

let cursor = 3
const board = (): BoardSnapshot => {
  cursor += 1
  return { cursor, tasks: TASKS.map(boardCard), calls: [], settledTotal: 41 }
}

const thread = (threadId: string): ThreadSnapshot => {
  const task = TASKS.find((one) => one.threadId === threadId) ?? TASKS[0]!
  const base = snapshot()
  const lines = threadId === TASK ? ONBOARDING : threadId === ASIDE ? DOCK : []
  cursor += 1
  return snapshot({
    threadId,
    cursor,
    project: { id: ALTHAR, name: 'althar' },
    task: {
      ...base.task,
      id: taskIdOf(threadId),
      title: task.title,
      slug: slugOf(threadId),
      ...(task.scratch === true ? { scratch: true } : {}),
      kind: task.scratch === true ? 'plain' : 'change',
      branch: task.scratch === true ? null : `althar/${slugOf(threadId)}`,
      worktree: task.scratch === true ? null : `/Users/you/Charrette/althar/${slugOf(threadId)}`,
      phase: 'ready',
      steps: [{ key: 'implement', agentId: 'claude-code', model: null, skipped: false }],
      lead: { agentId: 'claude-code', model: null, account: null },
      startedAt: minutesAgo(task.ago),
      goal: world.goal(threadId),
    },
    session: {
      ...(base.session as NonNullable<ThreadSnapshot['session']>),
      turnRunning: false,
      turnStartedAt: null,
      // A command isn't said to the lead: no turn waits on it, so the thread doesn't show the lead thinking after it.
      turnEndedAt: landed.get(threadId)?.at(-1)?.createdAt ?? null,
    },
    items: [...lines.map(said), ...(landed.get(threadId) ?? [])],
  })
}

export const makeClient = (): Client =>
  fakeClient({
    listProjects: async () => ({ cursor: 3, projects: [project] }),
    openProject: async () => project,
    getHome: async () => home({ looked: minutesAgo(180), since: minutesAgo(180), projects: [project] }),
    getBoard: async () => board(),
    getCoordinator: async () =>
      coordinatorSnapshot({
        threadId: COORDINATOR,
        project: { id: ALTHAR, name: 'althar' },
        host: { product: 'github', name: 'GitHub', webUrl: 'https://github.com', connected: true },
        items: CHAT.map(said),
      }),
    getThread: async (threadId) => thread(threadId),
    setThreadGoal: setGoal,
    getRepositories: async () => repositories.slice(0, 1).map((one) => ({ ...one, name: 'althar', path: '/Users/you/Code/althar' })),
    listConnections: async () => ({ ...connectionList, connections: [githubConnection] }),
  }).client

/** The tabs the window keeps at every load: althar's, on its conversation beside its board. */
export const TABS = { open: [ALTHAR], places: {}, rooms: { [ALTHAR]: 'both' } }
