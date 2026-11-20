import type { BoardSnapshot, BoardTask, PlanUsage, ProjectSummary, ThreadItem, ThreadSnapshot } from '@althar/contracts'

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
import { HOUR, MIN, NOW } from './facts.ts'
import { thisWeek } from './measures.ts'

/*
 * What the lab's fake runtime says to the window around the Usage view: two
 * projects, althar's board with the work going on now, a word or two with
 * its coordinator, and the plans' usage as the window's gauge reads it, the
 * same weeks the Plans direction draws.
 */

export const ALTHAR = 'p_althar'
export const MERIDIAN = 'p_meridian'

const ago = (minutes: number) => new Date(NOW - minutes * MIN).toISOString()

const BOARD: ReadonlyArray<{ slug: string; title: string; phase: BoardTask['phase']; ago: number; lead?: string }> = [
  { slug: 'usage-and-analytics', title: 'Prototype: usage and analytics of your work', phase: 'running', ago: 25 },
  { slug: 'small-changes-fast', title: 'Cut a small change’s overhead', phase: 'running', ago: 70 },
  { slug: 'review-controls', title: 'Keep stopped work Up next', phase: 'running', ago: 40, lead: 'codex' },
]

const taskCard = (task: (typeof BOARD)[number]): BoardTask => ({
  ...card({
    taskId: `t_${task.slug}`,
    threadId: `th_${task.slug}`,
    title: task.title,
    slug: task.slug,
    phase: task.phase,
    kind: 'change',
    branch: `althar/${task.slug}`,
    plan: null,
    change: null,
    step: 'implement',
    lead: task.lead ?? 'claude-code',
    startedAt: ago(task.ago),
  }),
  state: 'active',
  createdAt: ago(task.ago),
  settledAt: null,
  changed: null,
  here: [],
})

const projectOf = (projectId: string): ProjectSummary => {
  const name = projectId === ALTHAR ? 'althar' : 'meridian'
  return {
    id: projectId,
    name,
    slug: name,
    ink: projectId === ALTHAR ? 'clay' : 'teal',
    lastWorkAt: ago(2),
    repository: `/Users/balazs/Code/${name}`,
    repositories: [name],
    worktrees: `/Users/balazs/Charrette/${name}`,
    tasks: projectId === ALTHAR ? BOARD.length : 0,
    running: projectId === ALTHAR ? BOARD.length : 0,
    yours: 0,
    working: projectId === ALTHAR ? BOARD.length : 0,
    usageLimit: 'move',
    rotateAccounts: false,
    onlyAccounts: null,
    coordinatorThreadId: `thc_${projectId}`,
  }
}

const projects = [projectOf(ALTHAR), projectOf(MERIDIAN)]

let cursor = 3
const boardOf = (projectId: string): BoardSnapshot => {
  cursor += 1
  return projectId === ALTHAR
    ? { cursor, tasks: BOARD.map(taskCard), calls: [], settledTotal: 777 }
    : { cursor, tasks: [], calls: [], settledTotal: 64 }
}

const said = (who: 'you' | 'lead', text: string, minutes: number): ThreadItem =>
  ({ ...(who === 'you' ? items.you(text) : items.says(text, 'claude-code')), createdAt: ago(minutes) }) as ThreadItem

const COORDINATOR = [
  said('you', 'help me prototype some ideas to take the concept from t3 code in althar', 30),
  said('lead', 'Started **Prototype: usage and analytics of your work** on Claude Opus 5.5 at xhigh: four directions on a live page.', 29),
]

const threadOf = (threadId: string): ThreadSnapshot => {
  const task = BOARD.find((one) => `th_${one.slug}` === threadId) ?? BOARD[0]!
  const base = snapshot()
  return snapshot({
    threadId,
    project: { id: ALTHAR, name: 'althar' },
    task: { ...base.task, id: `t_${task.slug}`, title: task.title, slug: task.slug, branch: `althar/${task.slug}`, phase: task.phase },
  })
}

/** The plans as the window's gauge reads them: this week's use, and the five hours'. */
const planUsage = (): PlanUsage => {
  const account = (agent: 'claude-code' | 'codex', fiveHours: number): PlanUsage['accounts'][number] => {
    const week = thisWeek(agent)
    return {
      agentId: agent,
      agentName: agent === 'codex' ? 'Codex' : 'Claude Code',
      accountId: `acc_${agent}`,
      accountName: 'personal',
      paidBy: 'plan',
      source: 'agent',
      observedAt: ago(1),
      plan: agent === 'codex' ? 'pro' : 'max',
      windows: [
        { kind: 'five_hour', label: null, usedPercent: fiveHours, resetsAt: new Date(NOW + 2.4 * HOUR).toISOString() },
        { kind: 'weekly', label: null, usedPercent: Math.round(week.used), resetsAt: new Date(week.to).toISOString() },
      ],
      resetWindows: [],
      fault: null,
      noReading: null,
      resetSince: false,
    }
  }
  return { accounts: [account('claude-code', 38), account('codex', 12)] }
}

export const makeClient = (): Client =>
  fakeClient({
    listProjects: async () => ({ cursor: 3, projects }),
    openProject: async (projectId) => projectOf(projectId),
    getHome: async () => home({ looked: ago(180), since: ago(180), projects }),
    getBoard: async (projectId) => boardOf(projectId),
    getCoordinator: async (projectId) =>
      coordinatorSnapshot({
        threadId: `thc_${projectId}`,
        project: { id: projectId, name: projectOf(projectId).name },
        host: { product: 'github', name: 'GitHub', webUrl: 'https://github.com', connected: true },
        items: projectId === ALTHAR ? COORDINATOR : [],
      }),
    getThread: async (threadId) => threadOf(threadId),
    getRepositories: async () => repositories.slice(0, 1).map((one) => ({ ...one, name: 'althar', path: '/Users/balazs/Code/althar' })),
    listConnections: async () => ({ ...connectionList, connections: [githubConnection] }),
    getPlanUsage: async () => planUsage(),
  }).client

/** The tabs the window keeps at every load: althar's, on Usage, and meridian's. */
export const TABS = { open: [ALTHAR, MERIDIAN], places: {}, rooms: { [ALTHAR]: 'usage', [MERIDIAN]: 'usage' } }
