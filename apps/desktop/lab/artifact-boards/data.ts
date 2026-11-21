import type { BoardSnapshot, BoardTask, ProjectSummary, ThreadItem, ThreadSnapshot } from '@althar/contracts'

import type { Client } from '../../src/renderer/data/client'
import { card, connectionList, coordinatorSnapshot, fakeClient, githubConnection, home, repositories, snapshot } from '../../tests/fixtures'
import { artifactOf, GIFT } from './artifacts'
import { live } from './live'

/*
 * What the lab's fake runtime says: kiln, a pottery studio's bookings site,
 * and the tasks whose leads drew its artifacts. Gift a class is the one the
 * person is in: its conversation runs from the first ask to v4, the canvas
 * of four directions at every size, and then what is said on the canvas,
 * live, with each version the lead publishes as a canvas line.
 */

export const KILN = 'p_kiln'

const opened = Date.now()
const minutesAgo = (minutes: number) => new Date(opened - minutes * 60_000).toISOString()

const threadIdOf = (slug: string) => `th_${slug}`
const taskIdOf = (slug: string) => `t_${slug}`
const coordinatorOf = (projectId: string) => `thc_${projectId}`

export const GIFT_SLUG = 'gift-a-class'
export const GIFT_THREAD = threadIdOf(GIFT_SLUG)
export const GIFT_TASK_ID = taskIdOf(GIFT_SLUG)

interface Work {
  readonly slug: string
  readonly title: string
  readonly phase: BoardTask['phase']
  readonly ago: number
  readonly state?: string
}

const WORK: ReadonlyArray<Work> = [
  { slug: GIFT_SLUG, title: 'Gift a class', phase: 'ready', ago: 4 },
  { slug: 'bigger-photos', title: 'Bigger photos on Classes', phase: 'running', ago: 9 },
  { slug: 'calmer-checkout', title: 'A calmer checkout', phase: 'ready', ago: 52 },
  { slug: 'class-page-phones', title: 'The class page on phones', phase: 'planned', ago: 30 },
  { slug: 'warmer-empty', title: 'Warmer words on Your bookings', phase: 'settled', state: 'merged', ago: 60 * 26 },
]

const taskCard = (work: Work): BoardTask => ({
  ...card({
    taskId: taskIdOf(work.slug),
    threadId: threadIdOf(work.slug),
    title: work.title,
    slug: work.slug,
    phase: work.slug === GIFT_SLUG && live.get().working ? 'running' : work.phase,
    kind: 'change',
    branch: `althar/${work.slug}`,
    plan:
      work.phase === 'planned'
        ? {
            id: `pln_${work.slug}`,
            steps: [{ key: 'implement', agentId: 'claude-code', model: null, skipped: false }],
            startsAt: null,
            reason: null,
            end: null,
          }
        : null,
    change: null,
    step: work.phase === 'running' ? 'implement' : null,
    lead: 'claude-code',
    startedAt: work.phase === 'planned' ? null : minutesAgo(work.ago),
  }),
  state: work.state ?? 'active',
  createdAt: minutesAgo(work.ago),
  settledAt: work.phase === 'settled' ? minutesAgo(work.ago - 30) : null,
  changed: null,
  here: [],
})

export const projectOf = (projectId: string): ProjectSummary => ({
  id: projectId,
  name: 'kiln',
  slug: 'kiln',
  ink: 'clay',
  lastWorkAt: minutesAgo(2),
  repository: '/Users/you/Code/kiln',
  repositories: ['kiln'],
  worktrees: '/Users/you/Althar/kiln',
  tasks: WORK.length,
  running: 1,
  yours: 2,
  working: 1,
  usageLimit: 'move',
  rotateAccounts: false,
  onlyAccounts: null,
  coordinatorThreadId: coordinatorOf(projectId),
})

const projects = [projectOf(KILN)]

let cursor = 3
const boardOf = (): BoardSnapshot => {
  cursor += 1
  return { cursor, tasks: WORK.map(taskCard), calls: [], settledTotal: 1 }
}

/* ——— a conversation's lines, with ids that hold from one read to the next ——— */

type Said =
  | { readonly who: 'you' | 'lead'; readonly text: string; readonly ago: number }
  | { readonly who: 'canvas'; readonly version: number; readonly note: string; readonly ago: number; readonly open?: boolean }

const itemOf = (threadId: string, one: Said, index: number): ThreadItem => {
  const base = { id: `${threadId}-${index}`, sequence: index + 1, createdAt: minutesAgo(one.ago) }
  if (one.who === 'canvas') return canvasItem(base, one)
  if (one.who === 'you')
    return {
      ...base,
      agentId: null,
      kind: 'user_message',
      content: { text: one.text, links: [], pictures: [], files: [] },
      input: { state: 'delivered', interrupting: false },
    } as ThreadItem
  return { ...base, agentId: 'claude-code', kind: 'agent_message', content: { text: one.text, pictures: [], files: [] } } as ThreadItem
}

const canvasItem = (
  base: { readonly id: string; readonly sequence: number; readonly createdAt: string },
  one: Extract<Said, { who: 'canvas' }>,
): ThreadItem => {
  const gift = artifactOf(GIFT)
  return {
    ...base,
    agentId: 'claude-code',
    kind: 'canvas',
    content: {
      canvasId: gift.id,
      name: gift.name,
      title: gift.title,
      canvasKind: 'html',
      version: one.version,
      note: one.note,
      action: 'published',
      open: one.open ?? false,
    },
  } as ThreadItem
}

/** Gift a class, from the first ask to the canvas of directions. */
export const GIFT_SO_FAR: ReadonlyArray<Said> = [
  { who: 'you', text: 'A page where someone can give a friend a pottery class as a present.', ago: 52 },
  { who: 'lead', text: 'A plain gift card form to start from: three amounts, who it’s for, and a note.', ago: 50 },
  { who: 'canvas', version: 1, note: 'A gift card form', ago: 50 },
  { who: 'you', text: 'Make it feel like a present, not a checkout.', ago: 44 },
  { who: 'lead', text: 'The card your friend gets comes first now, and fills in as you type. The form sits beside it.', ago: 41 },
  { who: 'canvas', version: 2, note: 'The card first', ago: 41 },
  {
    who: 'you',
    text: 'Name the amounts after what they buy. Then try a few directions beside it, and lay the one you like at every size.',
    ago: 30,
  },
  {
    who: 'lead',
    text: 'Each amount is named after what it buys now: an evening on the wheel, a weekend of hand-building, a month of open studio.',
    ago: 27,
  },
  { who: 'canvas', version: 3, note: 'Named amounts', ago: 27 },
  {
    who: 'lead',
    text: 'Four directions side by side on the first page: **A present first**, **The card leads**, **Pick the class** and **A letter**. A present first is at every size on the second page, and how it got here is on the third.',
    ago: 4,
  },
  { who: 'canvas', version: 4, note: 'Four directions, at every size', ago: 4, open: true },
]

/** What is said on the canvas, after what came before: the lead's lines that made a version, with that version's canvas line. */
const saidSince = (): ReadonlyArray<Said> =>
  live
    .get()
    .lines.flatMap((one): ReadonlyArray<Said> => [
      { who: one.who, text: one.text, ago: (opened - (one.at ?? opened)) / 60_000 },
      ...(one.version === undefined
        ? []
        : [{ who: 'canvas' as const, version: one.version, note: 'Changed on the canvas', ago: (opened - (one.at ?? opened)) / 60_000 }]),
    ])

const coordinatorSaid: ReadonlyArray<Said> = [
  { who: 'you', text: 'What’s new to look at?', ago: 6 },
  {
    who: 'lead',
    text: '**Gift a class** has four directions side by side, at every size. **Bigger photos on Classes** is changing the class cards; its boards update as it goes.',
    ago: 5,
  },
]

const taskThread = (threadId: string): ThreadSnapshot => {
  const start = snapshot()
  const work = WORK.find((one) => threadIdOf(one.slug) === threadId) ?? (WORK[0] as Work)
  const gift = work.slug === GIFT_SLUG
  const running = work.phase === 'running' || (gift && live.get().working)
  const lines: ReadonlyArray<Said> = gift
    ? [...GIFT_SO_FAR, ...saidSince()]
    : [
        { who: 'you', text: `${work.title}.`, ago: work.ago + 4 },
        { who: 'lead', text: 'On it: the boards are on the project’s Artifacts.', ago: work.ago },
      ]
  return snapshot({
    threadId,
    project: { id: KILN, name: 'kiln' },
    task: {
      ...start.task,
      id: taskIdOf(work.slug),
      title: work.title,
      slug: work.slug,
      kind: 'change',
      branch: `althar/${work.slug}`,
      worktree: `/Users/you/Althar/kiln/${work.slug}`,
      phase: running ? 'running' : 'ready',
      steps: [{ key: 'implement', agentId: 'claude-code', model: null, skipped: false }],
      lead: { agentId: 'claude-code', model: null, account: null },
      startedAt: minutesAgo(work.ago),
      changes: [],
    },
    session: {
      ...(start.session as NonNullable<ThreadSnapshot['session']>),
      turnRunning: running,
      turnStartedAt: running ? minutesAgo(0) : null,
    },
    items: lines.map((one, i) => itemOf(threadId, one, i)),
  })
}

export const makeClient = (): Client =>
  fakeClient({
    listProjects: async () => ({ cursor: 3, projects }),
    openProject: async (projectId) => projectOf(projectId),
    getHome: async () => home({ looked: minutesAgo(180), since: minutesAgo(180), projects }),
    getBoard: async () => boardOf(),
    getCoordinator: async (projectId) =>
      coordinatorSnapshot({
        threadId: coordinatorOf(projectId),
        project: { id: projectId, name: projectOf(projectId).name },
        host: { product: 'github', name: 'GitHub', webUrl: 'https://github.com', connected: true },
        items: coordinatorSaid.map((one, i) => itemOf(coordinatorOf(projectId), one, i)),
      }),
    getThread: async (threadId) => taskThread(threadId),
    getRepositories: async () => repositories.slice(0, 1).map((one) => ({ ...one, name: 'kiln', path: '/Users/you/Code/kiln' })),
    listConnections: async () => ({ ...connectionList, connections: [githubConnection] }),
  }).client

/** The tabs the window keeps at every load. */
export const TABS = { open: [KILN], places: {}, rooms: { [KILN]: 'both' } }
