import type { BoardSnapshot, BoardTask, ProjectSummary, ThreadItem, ThreadSnapshot } from '@althar/contracts'

import type { Client } from '../../src/renderer/data/client'
import {
  card,
  change,
  connectionList,
  coordinatorSnapshot,
  fakeClient,
  githubConnection,
  home,
  items,
  repositories,
  snapshot,
} from '../../tests/fixtures'
import { lab } from './state'

/*
 * What the lab's fake runtime says: althar, the project a team of four works
 * on (two engineers' worth of work on its board, a designer's change, a PM's
 * intent and a QA run), and meridian, empty, which is what the running app
 * shows in the preview. Who is at the window follows the exploration: Maya,
 * the designer, in A and B; Ana, the engineer, in C, D and E.
 */

export const ALTHAR = 'p_althar'
export const MERIDIAN = 'p_meridian'

const opened = Date.now()
export const minutesAgo = (minutes: number) => new Date(opened - minutes * 60_000).toISOString()

/** The team, as git and the code host know them: names from commits, faces from the host. */
export interface Person {
  readonly id: 'ana' | 'maya' | 'sam' | 'lee'
  readonly name: string
  readonly login: string
  readonly role: 'Engineer' | 'Designer' | 'Product' | 'QA'
  /** The project ink their face is drawn in. */
  readonly ink: string
  readonly email: string
}

export const PEOPLE: ReadonlyArray<Person> = [
  { id: 'ana', name: 'Ana Ferreira', login: 'anaferreira', role: 'Engineer', ink: 'clay', email: 'ana@althar.dev' },
  { id: 'maya', name: 'Maya Lindqvist', login: 'mayalq', role: 'Designer', ink: 'teal', email: 'maya@althar.dev' },
  { id: 'sam', name: 'Sam Okafor', login: 'samokafor', role: 'Product', ink: 'ochre', email: 'sam@althar.dev' },
  { id: 'lee', name: 'Lee Park', login: 'leepark', role: 'QA', ink: 'plum', email: 'lee@althar.dev' },
]
export const personOf = (id: Person['id']) => PEOPLE.find((one) => one.id === id) as Person
export const firstName = (id: Person['id']) => personOf(id).name.split(' ')[0] as string

/** Who is at the window. */
export const whoIsHere = (): Person['id'] =>
  ['a', 'b'].includes(lab.get().d) || (lab.get().d === 'd' && lab.get().m === 1) ? 'maya' : 'ana'

interface Said {
  readonly who: 'you' | 'lead'
  readonly text: string
  readonly ago: number
}

const threadIdOf = (slug: string) => `th_${slug}`
export const taskIdOf = (slug: string) => `t_${slug}`
const coordinatorOf = (projectId: string) => `thc_${projectId}`

/** Maya's change: the board's empty lanes in warmer words. */
export const MAYA_TASK = 'warmer-empty-board'
export const MAYA_TITLE = 'Warmer words on an empty board'

interface WorldTask {
  readonly slug: string
  readonly title: string
  readonly phase: BoardTask['phase']
  readonly ago: number
  readonly pr?: number
  readonly lead?: string
  /** Whose it is, where it isn't the person's at the window. */
  readonly by?: Person['id']
}

/** Ana's own work, on her board in every exploration. */
const ANA_TASKS: ReadonlyArray<WorldTask> = [
  { slug: 'small-changes-fast', title: 'Cut a small change’s overhead', phase: 'running', ago: 12 },
  { slug: 'review-controls', title: 'Keep stopped work Up next', phase: 'running', ago: 25, lead: 'codex' },
  { slug: 'release-prep', title: 'Release 0.9.0', phase: 'planned', ago: 4 },
]

/** What the team did elsewhere, as the code host shows it: in E, on Ana's board. */
export const TEAM_TASKS: ReadonlyArray<WorldTask> = [
  { slug: 'sam-bug-screenshots', title: 'File a bug with a screenshot from the app', phase: 'planned', ago: 40, by: 'sam' },
  { slug: 'lee-regression-pass', title: 'Regression pass on Ship and Merge', phase: 'running', ago: 18, by: 'lee' },
  { slug: MAYA_TASK, title: MAYA_TITLE, phase: 'ready', ago: 30, pr: 1031, by: 'maya' },
]

const base = (ago: number) => ({
  state: 'active' as const,
  createdAt: minutesAgo(ago),
  settledAt: null,
  changed: null,
  here: [],
})

const mayaChange = (merged = false) =>
  change({
    number: 1031,
    title: MAYA_TITLE,
    url: 'https://github.com/AltharIDE/althar/pull/1031',
    repository: 'AltharIDE/althar',
    draft: false,
    state: merged ? 'merged' : 'open',
    additions: 9,
    deletions: 9,
    changedFiles: 2,
    checks: { outcome: 'passed', passed: 6, failed: 0, running: 0, total: 6, failing: [], list: [] },
  })

const taskCard = (task: WorldTask): BoardTask => ({
  ...card({
    taskId: taskIdOf(task.slug),
    threadId: threadIdOf(task.slug),
    title: task.title,
    slug: task.slug,
    phase: task.phase,
    kind: 'change',
    branch: task.by === undefined ? `althar/${task.slug}` : `${personOf(task.by).login}/${task.slug}`,
    plan:
      task.phase === 'planned'
        ? {
            id: `pln_${task.slug}`,
            steps: [
              { key: 'implement', agentId: 'claude-code', model: null, skipped: false },
              { key: 'review', agentId: 'codex', model: null, skipped: false },
            ],
            startsAt: null,
            reason: null,
            end: null,
          }
        : null,
    change:
      task.pr === undefined
        ? null
        : task.slug === MAYA_TASK
          ? mayaChange(lab.get().d === 'c' && lab.get().m === 2)
          : change({ number: task.pr, title: task.title, repository: 'AltharIDE/althar', draft: false }),
    step: task.phase === 'running' ? 'implement' : null,
    lead: task.lead ?? 'claude-code',
    startedAt: task.phase === 'planned' ? null : minutesAgo(task.ago),
  }),
  ...base(task.ago),
})

export const projectOf = (projectId: string): ProjectSummary => ({
  id: projectId,
  name: projectId === ALTHAR ? 'althar' : 'meridian',
  slug: projectId === ALTHAR ? 'althar' : 'meridian',
  ink: projectId === ALTHAR ? 'clay' : 'teal',
  lastWorkAt: minutesAgo(2),
  repository: `/Users/you/Code/${projectId === ALTHAR ? 'althar' : 'meridian'}`,
  repositories: [projectId === ALTHAR ? 'althar' : 'meridian'],
  worktrees: `/Users/you/Althar/${projectId === ALTHAR ? 'althar' : 'meridian'}`,
  tasks: projectId === ALTHAR ? 3 : 0,
  running: projectId === ALTHAR ? 2 : 0,
  yours: projectId === ALTHAR ? 1 : 0,
  working: projectId === ALTHAR ? 2 : 0,
  usageLimit: 'move',
  rotateAccounts: false,
  onlyAccounts: null,
  coordinatorThreadId: coordinatorOf(projectId),
})

const projects = [projectOf(ALTHAR), projectOf(MERIDIAN)]

/** What the board holds, for whoever is at the window, in this exploration. */
const tasksNow = (): ReadonlyArray<WorldTask> => {
  const { d, m } = lab.get()
  if (whoIsHere() === 'maya') {
    // Maya's own: the change, once Maya has asked for it.
    const hers = d === 'b' || (d === 'a' && m === 2) || d === 'd'
    return hers ? [{ slug: MAYA_TASK, title: MAYA_TITLE, phase: 'ready', ago: 30 }] : []
  }
  if (d === 'c') return [...ANA_TASKS, TEAM_TASKS[2] as WorldTask]
  if (d === 'e') return [...ANA_TASKS, ...TEAM_TASKS]
  return ANA_TASKS
}

let cursor = 3
const boardOf = (projectId: string): BoardSnapshot => {
  cursor += 1
  if (projectId !== ALTHAR) return { cursor, tasks: [], calls: [], settledTotal: 0 }
  return { cursor, tasks: tasksNow().map(taskCard), calls: [], settledTotal: 41 }
}

const said = (one: Said, agentId: string): ThreadItem =>
  ({ ...(one.who === 'you' ? items.you(one.text) : items.says(one.text, agentId)), createdAt: minutesAgo(one.ago) }) as ThreadItem

/** The coordinator's conversation, for whoever is at the window. */
const coordinatorItems = (): ReadonlyArray<Said> => {
  const { d, m } = lab.get()
  if (whoIsHere() === 'maya') {
    const first: Said[] = [
      {
        who: 'lead',
        text: 'Hi Maya. Beside us is althar as it runs now, on its own copy, so nothing you try here reaches anyone until Ana says yes.\n\nPoint at anything you’d change, a word, a gap, a colour, and say how you want it. I’ll make it, show it to you running, and send it to Ana when you’re happy.',
        ago: 6,
      },
    ]
    if (d === 'a' && m === 2)
      return [
        ...first,
        { who: 'you', text: 'These read cold for someone’s first day. Warmer, and say what to do next.', ago: 4 },
        {
          who: 'lead',
          text: 'Started **Warmer words on an empty board**. The four empty lanes now say what will be there and how it gets there, in a friendlier voice; it’s running beside us.\n\nSay if any line should change, or **Send to Ana** when it reads right.',
          ago: 1,
        },
      ]
    return first
  }
  return [
    { who: 'you', text: 'Is 0.9.0 ready to tag?', ago: 64 },
    {
      who: 'lead',
      text: 'Nearly. **#958** is green and waits on your merge, and the release notes are still being written in **Release 0.9.0**. I’ll tag v0.9.0 once both land.',
      ago: 63,
    },
    ...(d === 'c'
      ? [
          {
            who: 'lead' as const,
            text: 'Maya sent you **Warmer words on an empty board** to approve: copy only, two files in the board’s words, checks green, and the review found nothing.',
            ago: 3,
          },
        ]
      : []),
  ]
}

/** Maya's task's conversation: her request, the lead's work in plain words. */
export const mayaThread = (): ReadonlyArray<Said> => [
  ...MAYA_WORDS,
  ...(lab.get().d === 'd'
    ? [
        { who: 'you' as const, text: 'Also, keep the lanes open when the window is narrow. They fold too soon.', ago: 3 },
        {
          who: 'lead' as const,
          text: 'The lanes fold in the board’s layout code, which works out how many fit. Changing when they fold changes how the board behaves, not its words.',
          ago: 2,
        },
      ]
    : []),
]

const MAYA_WORDS: ReadonlyArray<Said> = [
  { who: 'you', text: 'These read cold for someone’s first day. Warmer, and say what to do next.', ago: 30 },
  {
    who: 'lead',
    text: 'Changed the four empty lanes’ words: each says what will be there, then how it gets there. Nothing else on the board moved.\n\n- **Up next:** “Nothing lined up yet”\n- **Running:** “Quiet for now”\n- **Needs you:** “You’re all caught up”\n- **Settled:** “Nothing finished yet”',
    ago: 26,
  },
]

const taskThread = (threadId: string): ThreadSnapshot => {
  const all = [...ANA_TASKS, ...TEAM_TASKS]
  const task = all.find((candidate) => threadIdOf(candidate.slug) === threadId)
  const base = snapshot()
  const slug = task?.slug ?? MAYA_TASK
  const title = task?.title ?? MAYA_TITLE
  const maya = slug === MAYA_TASK
  const running = !maya && task?.phase === 'running'
  return snapshot({
    threadId,
    project: { id: ALTHAR, name: 'althar' },
    task: {
      ...base.task,
      id: taskIdOf(slug),
      title,
      slug,
      kind: 'change',
      branch: maya ? `mayalq/${slug}` : `althar/${slug}`,
      worktree: `/Users/you/Althar/althar/${slug}`,
      phase: running ? 'running' : 'ready',
      steps: [
        { key: 'implement', agentId: 'claude-code', model: null, skipped: false },
        { key: 'review', agentId: 'codex', model: null, skipped: false },
      ],
      lead: { agentId: 'claude-code', model: null, account: null },
      startedAt: minutesAgo(task?.ago ?? 30),
      changes: maya && whoIsHere() === 'ana' ? [mayaChange(lab.get().m === 2)] : [],
    },
    session: {
      ...(base.session as NonNullable<ThreadSnapshot['session']>),
      turnRunning: running,
      turnStartedAt: running ? minutesAgo(1) : null,
    },
    items: maya ? mayaThread().map((line) => said(line, 'claude-code')) : [],
  })
}

export const makeClient = (): Client =>
  fakeClient({
    listProjects: async () => ({ cursor: 3, projects }),
    openProject: async (projectId) => projectOf(projectId),
    getHome: async () => home({ looked: minutesAgo(180), since: minutesAgo(180), projects }),
    getBoard: async (projectId) => boardOf(projectId),
    getCoordinator: async (projectId) =>
      coordinatorSnapshot({
        threadId: coordinatorOf(projectId),
        project: { id: projectId, name: projectOf(projectId).name },
        host: { product: 'github', name: 'GitHub', webUrl: 'https://github.com', connected: true },
        items: projectId === ALTHAR ? coordinatorItems().map((one) => said(one, 'claude-code')) : [],
      }),
    getThread: async (threadId) => taskThread(threadId),
    getRepositories: async () => repositories.slice(0, 1).map((one) => ({ ...one, name: 'althar', path: '/Users/you/Code/althar' })),
    listConnections: async () => ({ ...connectionList, connections: [githubConnection] }),
  }).client

/** The tabs the window keeps at every load. */
export const TABS = { open: [ALTHAR], places: {}, rooms: { [ALTHAR]: 'both', [MERIDIAN]: 'both' } }
export const MAYA_THREAD = threadIdOf(MAYA_TASK)
export const MAYA_TASK_ID = taskIdOf(MAYA_TASK)
