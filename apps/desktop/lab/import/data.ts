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
import { AGENTS, type Conversation, CONVERSATIONS, type Worktree, WORKTREES, world } from './world'

/*
 * What the lab's fake runtime says. Arriving, althar is the one project,
 * just added, its board only what was brought in. Later, it has its own
 * work too, and meridian beside it. A worktree brought in is a task in
 * place: its folder stays where the other tool made it, its branch and pull
 * request its own, and the conversations that ran in it its thread. One of
 * the project's own folder is a chat on Scratch.
 */

export const ALTHAR = 'p_althar'
export const MERIDIAN = 'p_meridian'

const opened = Date.now()
export const minutesAgo = (minutes: number) => new Date(opened - minutes * 60_000).toISOString()

export const threadOfWorktree = (id: string) => `th_wt_${id}`
export const threadOfConversation = (id: string) => `th_cv_${id}`
const taskOfWorktree = (id: string) => `t_wt_${id}`
const taskOfConversation = (id: string) => `t_cv_${id}`
const coordinatorOf = (projectId: string) => `thc_${projectId}`

/** What a thread brought in is: the worktree it was, with the conversations that ran there, or one conversation. */
export const broughtOf = (threadId: string): { readonly worktree?: Worktree; readonly conversations: readonly Conversation[] } | null => {
  if (threadId.startsWith('th_wt_')) {
    const worktree = WORKTREES.find((one) => threadOfWorktree(one.id) === threadId)
    if (worktree === undefined) return null
    return { worktree, conversations: CONVERSATIONS.filter((one) => one.in === worktree.id && world.brought().conversations.has(one.id)) }
  }
  const one = CONVERSATIONS.find((candidate) => threadOfConversation(candidate.id) === threadId)
  return one === undefined ? null : { conversations: [one] }
}

/** Althar's own work, later: what it has done since the move. */
const OWN: ReadonlyArray<{ slug: string; title: string; phase: BoardTask['phase']; ago: number; pr?: number }> = [
  { slug: 'small-changes-fast', title: 'Cut a small change’s overhead', phase: 'running', ago: 12 },
  { slug: 'gallery-landing', title: 'A gallery of the app on the landing page', phase: 'ready', ago: 50, pr: 963 },
  { slug: 'release-prep', title: 'Release 0.9.0', phase: 'planned', ago: 4 },
]

const base = (at: string): Omit<BoardTask, keyof ReturnType<typeof card>> => ({
  state: 'active',
  createdAt: at,
  settledAt: null,
  changed: null,
  here: [],
})

/** A worktree brought in, as the task it is: stopped where it was left, Resume to pick it up; a passing pull request waits on you. */
const worktreeCard = (one: Worktree): BoardTask => {
  const pr = one.pr
  const phase: BoardTask['phase'] =
    pr?.state === 'merged'
      ? 'settled'
      : pr !== null && pr.checks.failed === 0 && one.uncommitted === null && one.unpushed === 0 && pr.theirs === undefined
        ? 'ready'
        : 'stopped'
  const said = CONVERSATIONS.filter((c) => c.in === one.id && world.brought().conversations.has(c.id))
  const last = said[0]
  return {
    ...card({
      taskId: taskOfWorktree(one.id),
      threadId: threadOfWorktree(one.id),
      title: one.title,
      slug: one.branch.split('/').at(-1) ?? one.id,
      phase,
      kind: pr?.theirs === undefined ? 'change' : 'review',
      plan: null,
      branch: one.branch,
      step: null,
      lead: last?.agent ?? 'claude-code',
      startedAt: one.touched,
      change:
        pr === null
          ? null
          : change({
              number: pr.number,
              title: pr.title,
              url: `https://github.com/AltharIDE/althar/pull/${pr.number}`,
              repository: 'AltharIDE/althar',
              state: pr.state === 'merged' ? 'merged' : 'open',
              draft: pr.state === 'draft',
              additions: one.uncommitted?.add ?? 120,
              deletions: one.uncommitted?.del ?? 18,
              unpushed: one.unpushed,
              checks: {
                outcome: pr.checks.failed > 0 ? 'failed' : 'passed',
                passed: pr.checks.passed,
                failed: pr.checks.failed,
                running: 0,
                total: pr.checks.passed + pr.checks.failed,
                failing: pr.checks.failing === undefined ? [] : [pr.checks.failing],
                list: [],
              },
            }),
    }),
    ...base(one.touched),
    ...(phase === 'settled' ? { settledAt: one.touched } : {}),
    ...(last === undefined ? {} : { latest: { at: last.at, by: 'lead' as const, said: last.title } }),
  }
}

/** A conversation of the project's own folder, brought in: a chat on Scratch, at its own date. */
const conversationCard = (one: Conversation): BoardTask => {
  const last = one.said?.at(-1)
  return {
    ...card({
      taskId: taskOfConversation(one.id),
      threadId: threadOfConversation(one.id),
      title: one.title,
      slug: one.id,
      phase: 'ready',
      kind: 'plain',
      plan: null,
      branch: null,
      step: null,
      lead: one.agent,
      startedAt: one.at,
    }),
    ...base(one.at),
    scratch: true,
    latest: {
      at: one.at,
      by: last?.who === 'you' ? 'person' : 'lead',
      said: last?.text ?? `${AGENTS[one.agent].name} · ${one.messages} messages`,
    },
  }
}

const ownCard = (task: (typeof OWN)[number]): BoardTask => ({
  ...card({
    taskId: `t_${task.slug}`,
    threadId: `th_${task.slug}`,
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
    startedAt: task.phase === 'planned' ? null : minutesAgo(task.ago),
  }),
  ...base(minutesAgo(task.ago)),
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
  tasks: 0,
  running: 0,
  yours: 0,
  working: 0,
  usageLimit: 'move',
  rotateAccounts: false,
  onlyAccounts: null,
  coordinatorThreadId: coordinatorOf(projectId),
})

const projects = () => (world.era() === 'later' ? [projectOf(ALTHAR), projectOf(MERIDIAN)] : [projectOf(ALTHAR)])

let cursor = 3
const boardOf = (projectId: string): BoardSnapshot => {
  cursor += 1
  if (projectId !== ALTHAR) return { cursor, tasks: [], calls: [], settledTotal: 0 }
  const b = world.brought()
  const tasks = [
    ...(world.era() === 'later' ? OWN.map(ownCard) : []),
    ...WORKTREES.filter((one) => b.worktrees.has(one.id)).map(worktreeCard),
    ...CONVERSATIONS.filter((one) => one.in === null && b.conversations.has(one.id)).map(conversationCard),
  ]
  return { cursor, tasks, calls: [], settledTotal: world.era() === 'later' ? 41 : 0 }
}

/** What was said, at its own time; one the lab has no words for shows its first and last. */
const saidOf = (one: Conversation): ThreadItem[] => {
  const lines =
    one.said ??
    ([
      { who: 'you', text: one.title, ago: 0 },
      { who: 'agent', text: `…`, ago: 0 },
    ] as const)
  const at = Date.parse(one.at)
  return lines.map(
    (line, i) =>
      ({
        ...(line.who === 'you' ? items.you(line.text) : items.says(line.text, one.agent)),
        id: `${one.id}-${i}`,
        createdAt: new Date(at - (lines.length - i) * 4 * 60_000).toISOString(),
      }) as ThreadItem,
  )
}

const threadOf = (threadId: string): ThreadSnapshot => {
  const brought = broughtOf(threadId)
  const own = OWN.find((one) => `th_${one.slug}` === threadId)
  const shell = snapshot()
  const worktree = brought?.worktree
  const first = brought?.conversations[0]
  const title = worktree?.title ?? first?.title ?? own?.title ?? 'Task'
  return snapshot({
    threadId,
    project: { id: ALTHAR, name: 'althar' },
    task: {
      ...shell.task,
      id: threadId.replace(/^th_/, 't_'),
      title,
      slug: worktree?.branch.split('/').at(-1) ?? first?.id ?? own?.slug ?? 'task',
      ...(worktree === undefined && own === undefined ? { scratch: true } : {}),
      kind: worktree === undefined && own === undefined ? 'plain' : 'change',
      branch: worktree?.branch ?? (own === undefined ? null : `althar/${own.slug}`),
      worktree: worktree === undefined ? null : worktree.path.replace('~', '/Users/balazs'),
      phase: worktree === undefined ? 'ready' : 'stopped',
      steps: [{ key: 'implement', agentId: first?.agent ?? 'claude-code', model: null, skipped: false }],
      lead: { agentId: first?.agent ?? 'claude-code', model: null, account: null },
      startedAt: worktree?.touched ?? first?.at ?? minutesAgo(30),
    },
    session: { ...(shell.session as NonNullable<ThreadSnapshot['session']>), turnRunning: false, turnStartedAt: null },
    items: [...(brought?.conversations ?? [])].reverse().flatMap(saidOf),
  })
}

/** The coordinator's first word, arriving: what came in, and the one thing that needs a look. */
const coordinatorItems = (): ThreadItem[] => {
  const b = world.brought()
  if (world.era() === 'later' || b.worktrees.size === 0) return []
  return [
    {
      ...items.says(
        `${b.worktrees.size} tasks came in from other tools, each in its own folder where it was, with ${b.conversations.size} conversations as their history and on Scratch.${b.worktrees.has('lima') ? '\n\n**Reset the usage meter at the window’s edge** has a failing macOS e2e on #941 and two commits not pushed. Want me to pick it up?' : ''}`,
        'claude-code',
      ),
      createdAt: minutesAgo(0.2),
    } as ThreadItem,
  ]
}

export const makeClient = (): Client =>
  fakeClient({
    listProjects: async () => ({ cursor: 3, projects: projects() }),
    openProject: async (projectId) => projectOf(projectId),
    getHome: async () => home({ looked: minutesAgo(180), since: minutesAgo(180), projects: projects() }),
    getBoard: async (projectId) => boardOf(projectId),
    getCoordinator: async (projectId) =>
      coordinatorSnapshot({
        threadId: coordinatorOf(projectId),
        project: { id: projectId, name: projectOf(projectId).name },
        host: { product: 'github', name: 'GitHub', webUrl: 'https://github.com', connected: true },
        items: projectId === ALTHAR ? coordinatorItems() : [],
      }),
    getThread: async (threadId) => threadOf(threadId),
    getRepositories: async () => repositories.slice(0, 1).map((one) => ({ ...one, name: 'althar', path: '/Users/balazs/Code/althar' })),
    listConnections: async () => ({ ...connectionList, connections: [githubConnection] }),
  }).client

/** The tabs the window keeps: althar's, on its conversation beside its board. */
export const tabsOf = () =>
  world.era() === 'later'
    ? { open: [ALTHAR, MERIDIAN], places: {}, rooms: { [ALTHAR]: 'both', [MERIDIAN]: 'both' } }
    : { open: [ALTHAR], places: {}, rooms: { [ALTHAR]: 'both' } }
