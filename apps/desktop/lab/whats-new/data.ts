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
  status,
} from '../../tests/fixtures'

/*
 * What the lab's fake runtime says, as the conversation bar lab's world has
 * it: two projects, althar's board with a few tasks and its asides on
 * Scratch, the coordinator's conversation and each aside's, and Althar just
 * restarted into 0.10.0.
 */

export const ALTHAR = 'p_althar'
export const MERIDIAN = 'p_meridian'

const opened = Date.now()
export const minutesAgo = (minutes: number) => new Date(opened - minutes * 60_000).toISOString()

interface Said {
  readonly who: 'you' | 'lead'
  readonly text: string
  readonly ago: number
}

interface WorldAside {
  readonly slug: string
  /** Its title as today: the person's first line, cut to fit. */
  readonly title: string
  /** The name it would give itself, in a few words ("Self-named" in the lab's bar). */
  readonly short?: string
  readonly ago: number
  readonly running?: boolean
  readonly thread: ReadonlyArray<Said>
  /** Only with "Many" on. */
  readonly many?: boolean
}

/** The asides, the latest first: one at work, the person's "hi", a long title, and those a week old that fold into "N older". */
const ASIDES: ReadonlyArray<WorldAside> = [
  {
    slug: 'dock-flicker',
    title: 'Why does the dock flicker on wake?',
    short: 'Dock flicker on wake',
    ago: 2,
    running: true,
    thread: [
      { who: 'you', text: 'Why does the dock flicker on wake?', ago: 3 },
      {
        who: 'lead',
        text: 'Looking at how the dock reads the board after the Mac wakes: it seems to draw once with an empty board first.',
        ago: 2,
      },
    ],
  },
  {
    slug: 'hi',
    title: 'hi',
    ago: 9,
    thread: [
      { who: 'you', text: 'hi', ago: 10 },
      { who: 'lead', text: 'Hi. What would you like to look at on the side?', ago: 9 },
    ],
  },
  {
    slug: 'merge-queue-reruns',
    title: 'Why the merge queue reran every check after the rebase on main',
    short: 'Merge queue reruns',
    ago: 34,
    thread: [
      { who: 'you', text: 'Why the merge queue reran every check after the rebase on main', ago: 36 },
      {
        who: 'lead',
        text: 'The queue builds a fresh merge commit for each entry, so every check keys on a new head. Checks that only read changed files could reuse their last result; GitHub has no switch for it, but the workflow can skip itself when nothing it covers moved.',
        ago: 34,
      },
    ],
  },
  {
    slug: 'webhook-retries',
    title: 'Webhook retries',
    ago: 80,
    thread: [
      { who: 'you', text: 'How many times does the GitHub webhook retry before giving up?', ago: 82 },
      {
        who: 'lead',
        text: 'GitHub doesn’t retry failed deliveries on its own. You can redeliver one by hand, or through the API, for up to three days.',
        ago: 80,
      },
    ],
  },
  {
    slug: 'release-notes-wording',
    title: 'Release notes wording',
    ago: 200,
    thread: [
      { who: 'you', text: 'Read the 0.9.0 notes and tell me which lines narrate instead of saying what changed', ago: 202 },
      { who: 'lead', text: 'Three lines narrate. The rest say what changed.', ago: 200 },
    ],
  },
  { slug: 'sqlite-wal', title: 'SQLite WAL size after a week', short: 'SQLite WAL size', ago: 260, many: true, thread: [] },
  {
    slug: 'codex-sandbox',
    title: 'Does Codex keep its sandbox between turns?',
    short: 'Codex sandbox',
    ago: 300,
    many: true,
    running: true,
    thread: [],
  },
  { slug: 'font-weights', title: 'Inter weights on Windows', ago: 420, many: true, thread: [] },
  { slug: 'signing', title: 'Notarization failing on the Intel build', short: 'Intel notarization', ago: 600, many: true, thread: [] },
  { slug: 'tray-icon', title: 'Tray icon in dark menu bars', short: 'Dark tray icon', ago: 900, many: true, thread: [] },
  // A week and more: folded into "N older".
  { slug: 'old-export', title: 'Export a thread as Markdown', short: 'Thread export', ago: 60 * 24 * 9, thread: [] },
  { slug: 'old-ports', title: 'Which ports the lab servers use', short: 'Lab ports', ago: 60 * 24 * 12, thread: [] },
]

interface WorldTask {
  readonly slug: string
  readonly title: string
  readonly phase: BoardTask['phase']
  readonly ago: number
  readonly pr?: number
  readonly lead?: string
}

const TASKS: ReadonlyArray<WorldTask> = [
  { slug: 'small-changes-fast', title: 'Cut a small change’s overhead', phase: 'running', ago: 12 },
  { slug: 'gallery-landing', title: 'A gallery of the app on the landing page', phase: 'ready', ago: 50, pr: 963 },
  { slug: 'review-controls', title: 'Keep stopped work Up next', phase: 'running', ago: 25, lead: 'codex' },
  { slug: 'release-prep', title: 'Release 0.10.1', phase: 'planned', ago: 4 },
]

/** What the person did to asides here: cleared ones are gone, ones made a task are on the board. */
const cleared = new Set<string>()
const madeWork = new Set<string>()

const titleOf = (one: WorldAside) => one.title

const threadIdOf = (slug: string) => `th_${slug}`
const taskIdOf = (slug: string) => `t_${slug}`
const coordinatorOf = (projectId: string) => `thc_${projectId}`

const shownAsides = () => ASIDES.filter((one) => one.many !== true && !cleared.has(taskIdOf(one.slug)))

const base = (ago: number): Omit<BoardTask, keyof ReturnType<typeof card>> => ({
  state: 'active',
  createdAt: minutesAgo(ago),
  settledAt: null,
  changed: null,
  here: [],
})

const asideCard = (one: WorldAside): BoardTask => {
  const last = one.thread.at(-1)
  const scratch = !madeWork.has(taskIdOf(one.slug))
  return {
    ...card({
      taskId: taskIdOf(one.slug),
      threadId: threadIdOf(one.slug),
      title: titleOf(one),
      slug: one.slug,
      phase: one.running === true ? 'running' : 'ready',
      kind: 'plain',
      plan: null,
      branch: null,
      step: one.running === true ? 'implement' : null,
      startedAt: minutesAgo(one.ago),
    }),
    ...base(one.ago),
    ...(scratch ? { scratch: true } : {}),
    latest: { at: minutesAgo(one.ago), by: last?.who === 'you' ? 'person' : 'lead', said: last?.text ?? one.title },
  }
}

const taskCard = (task: WorldTask): BoardTask => ({
  ...card({
    taskId: taskIdOf(task.slug),
    threadId: threadIdOf(task.slug),
    title: task.title,
    slug: task.slug,
    phase: task.phase,
    kind: 'change',
    branch: `althar/${task.slug}`,
    plan:
      task.phase === 'planned'
        ? {
            id: `pln_${task.slug}`,
            steps: [
              { key: 'implement', agentId: 'claude-code', model: null, skipped: false },
              { key: 'review', agentId: 'codex', model: null, skipped: false },
            ],
            startsAt: new Date(Date.now() + 10 * 60_000).toISOString(),
            reason: null,
            end: null,
          }
        : null,
    change:
      task.pr === undefined
        ? null
        : change({
            number: task.pr,
            title: task.title,
            url: `https://github.com/AltharIDE/althar/pull/${task.pr}`,
            repository: 'AltharIDE/althar',
            draft: false,
            checks: { outcome: 'passed', passed: 4, failed: 0, running: 0, total: 4, failing: [], list: [] },
          }),
    step: task.phase === 'running' ? 'implement' : null,
    lead: task.lead ?? 'claude-code',
    startedAt: task.phase === 'planned' ? null : minutesAgo(task.ago),
  }),
  ...base(task.ago),
})

const projectOf = (projectId: string): ProjectSummary => ({
  id: projectId,
  name: projectId === ALTHAR ? 'althar' : 'meridian',
  slug: projectId === ALTHAR ? 'althar' : 'meridian',
  ink: projectId === ALTHAR ? 'clay' : 'teal',
  lastWorkAt: minutesAgo(2),
  repository: `/Users/balazs/Code/${projectId === ALTHAR ? 'althar' : 'meridian'}`,
  repositories: [projectId === ALTHAR ? 'althar' : 'meridian'],
  worktrees: `/Users/balazs/Charrette/${projectId === ALTHAR ? 'althar' : 'meridian'}`,
  tasks: projectId === ALTHAR ? TASKS.length : 0,
  running: projectId === ALTHAR ? 2 : 0,
  yours: projectId === ALTHAR ? 1 : 0,
  working: projectId === ALTHAR ? 2 : 0,
  usageLimit: 'move',
  rotateAccounts: false,
  onlyAccounts: null,
  coordinatorThreadId: coordinatorOf(projectId),
})

const projects = [projectOf(ALTHAR), projectOf(MERIDIAN)]

let cursor = 3
const boardOf = (projectId: string): BoardSnapshot => {
  cursor += 1
  if (projectId !== ALTHAR) return { cursor, tasks: [], calls: [], settledTotal: 0 }
  return {
    cursor,
    tasks: [...TASKS.map(taskCard), ...shownAsides().map(asideCard)],
    calls: [],
    settledTotal: 41,
  }
}

const said = (one: Said, agentId: string): ThreadItem =>
  ({ ...(one.who === 'you' ? items.you(one.text) : items.says(one.text, agentId)), createdAt: minutesAgo(one.ago) }) as ThreadItem

/** The coordinator's conversation in althar: the same in every direction. */
const COORDINATOR: ReadonlyArray<Said> = [
  { who: 'you', text: 'Is 0.10.1 ready to tag?', ago: 64 },
  {
    who: 'lead',
    text: 'Nearly. **#958** is green and waits on your merge, and the release notes are still being written in **Release 0.10.1**. I’ll tag v0.10.1 once both land.',
    ago: 63,
  },
  { who: 'you', text: 'The last one-line fix took forty minutes. Make small changes fast.', ago: 15 },
  {
    who: 'lead',
    text: 'Started **Cut a small change’s overhead** on Claude Code. It begins by timing where those forty minutes went (setup, the review, CI) and cuts the biggest first.\n\nI’ll say here when it has numbers.',
    ago: 12,
  },
]

const asideThread = (threadId: string): ThreadSnapshot => {
  const one = ASIDES.find((candidate) => threadIdOf(candidate.slug) === threadId)
  const task = TASKS.find((candidate) => threadIdOf(candidate.slug) === threadId)
  const base = snapshot()
  const title = (one === undefined ? undefined : titleOf(one)) ?? task?.title ?? 'New aside'
  const slug = one?.slug ?? task?.slug ?? 'new'
  const running = one?.running === true || task?.phase === 'running'
  return snapshot({
    threadId,
    project: { id: ALTHAR, name: 'althar' },
    task: {
      ...base.task,
      id: taskIdOf(slug),
      title,
      slug,
      ...(one === undefined || madeWork.has(taskIdOf(one.slug)) ? {} : { scratch: true }),
      kind: one === undefined ? 'change' : 'plain',
      branch: one === undefined ? `althar/${slug}` : null,
      worktree: null,
      phase: running ? 'running' : 'ready',
      steps: [{ key: 'implement', agentId: 'claude-code', model: null, skipped: false }],
      lead: { agentId: 'claude-code', model: null, account: null },
      startedAt: minutesAgo(one?.ago ?? task?.ago ?? 0),
    },
    session: {
      ...(base.session as NonNullable<ThreadSnapshot['session']>),
      turnRunning: running,
      turnStartedAt: running ? minutesAgo(1) : null,
    },
    items: (one?.thread ?? []).map((line) => said(line, 'claude-code')),
  })
}

export const makeClient = (): Client =>
  fakeClient({
    // Althar has just restarted into 0.10.0.
    status: async () => ({ ...status, appVersion: '0.10.0' }),
    listProjects: async () => ({ cursor: 3, projects }),
    openProject: async (projectId) => projectOf(projectId),
    getHome: async () => home({ looked: minutesAgo(180), since: minutesAgo(180), projects }),
    getBoard: async (projectId) => boardOf(projectId),
    getCoordinator: async (projectId) =>
      coordinatorSnapshot({
        threadId: coordinatorOf(projectId),
        project: { id: projectId, name: projectOf(projectId).name },
        host: { product: 'github', name: 'GitHub', webUrl: 'https://github.com', connected: true },
        items: projectId === ALTHAR ? COORDINATOR.map((one) => said(one, 'claude-code')) : [],
      }),
    getThread: async (threadId) => asideThread(threadId),
    getRepositories: async () => repositories.slice(0, 1).map((one) => ({ ...one, name: 'althar', path: '/Users/balazs/Code/althar' })),
    listConnections: async () => ({ ...connectionList, connections: [githubConnection] }),
    markTaskDone: async (taskId) => void cleared.add(taskId),
    shelveTask: async (taskId) => void madeWork.add(taskId),
  }).client

/** The tabs the window keeps at every load: althar's and meridian's, althar's on its conversation beside its board. */
export const TABS = { open: [ALTHAR, MERIDIAN], places: {}, rooms: { [ALTHAR]: 'both', [MERIDIAN]: 'both' } }
