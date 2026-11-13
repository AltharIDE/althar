import type {
  BoardCall,
  BoardSnapshot,
  BoardTask,
  ChangeSummary,
  FoundTask,
  ProjectNote,
  ProjectSummary,
  ThreadItem,
  ThreadSnapshot,
} from '@althar/contracts'

import type { Client } from '../../src/renderer/data/client'
import {
  automationSummary,
  automationsSnapshot,
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
import { ALTHAR, CONVERSATIONS, ERZA, MERIDIAN, NOTES, PROJECTS, type Said, TASKS, type WorldTask, projectOf, taskOf } from './world'

/*
 * What the fake runtime says, read from the world (world.ts): the projects,
 * each board, each coordinator's conversation and each task's thread, as
 * the desktop tests' client answers them. Today's ⌘K searches here too, as
 * the runtime's index does: every word typed as the start of a word.
 */

export const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

export const threadIdOf = (slug: string) => `th_${slug}`
export const taskIdOf = (slug: string) => `t_${slug}`
export const coordinatorOf = (projectId: string) => `thc_${projectId}`

const host = (projectId: string) => projectOf(projectId).repository

export const pullUrl = (projectId: string, number: number) => `https://github.com/${host(projectId) ?? 'meridian/api'}/pull/${number}`

const changeOf = (task: WorldTask): ChangeSummary | null => {
  if (task.pr === undefined) return null
  const running = task.phase === 'running'
  return change({
    number: task.pr,
    title: task.title,
    url: pullUrl(task.project, task.pr),
    repository: host(task.project) ?? 'meridian/api',
    state: task.phase === 'settled' ? 'merged' : 'open',
    draft: running,
    checks: {
      outcome: running ? 'running' : 'passed',
      passed: running ? 2 : 4,
      failed: 0,
      running: running ? 2 : 0,
      total: 4,
      failing: [],
      list: ['ui', 'desktop', 'harness', 'site'].map((name, at) => ({
        name,
        state: running && at >= 2 ? ('running' as const) : ('passed' as const),
        summary: null,
      })),
    },
  })
}

const issueOf = (task: WorldTask) => {
  if (task.issue === undefined) return null
  const linear = projectOf(task.project).tracker === 'linear'
  return {
    product: linear ? ('linear' as const) : ('github' as const),
    key: task.issue,
    title: task.title,
    url: linear
      ? `https://linear.app/charrette/issue/${task.issue}`
      : `https://github.com/${host(task.project)}/issues/${task.issue.slice(1)}`,
  }
}

const boardTaskOf = (task: WorldTask): BoardTask => ({
  ...card({
    taskId: taskIdOf(task.slug),
    threadId: threadIdOf(task.slug),
    title: task.title,
    slug: task.slug,
    phase: task.phase,
    kind: task.kind ?? 'change',
    branch: `althar/${task.slug}`,
    plan:
      task.phase === 'planned' || task.phase === 'held'
        ? {
            id: `pln_${task.slug}`,
            steps: [
              { key: 'implement', agentId: 'claude-code', model: null, skipped: false },
              { key: 'review', agentId: 'codex', model: null, skipped: false },
            ],
            startsAt: task.phase === 'planned' ? new Date(Date.now() + 90_000).toISOString() : null,
            reason: null,
            end: null,
          }
        : null,
    issue: issueOf(task),
    change: changeOf(task),
    step: task.phase === 'running' ? 'implement' : null,
    summary: task.summary ?? null,
    lead: task.lead ?? 'claude-code',
    startedAt: task.phase === 'settled' ? null : minutesAgo(task.ago),
  }),
  state: task.state ?? 'open',
  createdAt: minutesAgo(task.ago),
  settledAt: task.phase === 'settled' ? minutesAgo(task.ago) : null,
  changed: null,
  here: [],
})

const callOf = (task: WorldTask): BoardCall => ({
  id: `call_${task.slug}`,
  kind: 'permission',
  title: task.asks ?? 'Run a command',
  reason: 'Listening on a port asks while the sandbox is on.',
  command: (task.asks ?? '').replace(/^Run /, ''),
  stuck: null,
  createdAt: minutesAgo(6),
  taskId: taskIdOf(task.slug),
  threadId: threadIdOf(task.slug),
  taskTitle: task.title,
  taskSlug: task.slug,
})

const tasksIn = (projectId: string) => TASKS.filter((task) => task.project === projectId)

const summaryOf = (projectId: string): ProjectSummary => {
  const project = projectOf(projectId)
  const tasks = tasksIn(projectId)
  return {
    id: project.id,
    name: project.name,
    slug: project.name,
    ink: project.ink,
    lastWorkAt: minutesAgo(Math.min(...tasks.map((one) => one.ago))),
    repository: `/Users/balazs/Code/${project.name}`,
    repositories: [project.name],
    worktrees: `/Users/balazs/Charrette/${project.name}`,
    tasks: tasks.length,
    running: tasks.filter((one) => one.phase === 'running').length,
    yours: tasks.filter((one) => one.phase === 'waiting' || one.phase === 'ready').length,
    working: tasks.filter((one) => one.phase === 'running').length,
    usageLimit: 'move',
    rotateAccounts: false,
    onlyAccounts: null,
    coordinatorThreadId: coordinatorOf(projectId),
  }
}

export const projects = PROJECTS.map((one) => summaryOf(one.id))

const boardOf = (projectId: string): BoardSnapshot => {
  const tasks = tasksIn(projectId)
  return {
    cursor: 3,
    tasks: tasks.map(boardTaskOf),
    calls: tasks.filter((one) => one.asks !== undefined).map(callOf),
    settledTotal: tasks.filter((one) => one.phase === 'settled').length,
  }
}

const said = (one: Said, agentId: string): ThreadItem =>
  ({ ...(one.who === 'you' ? items.you(one.text) : items.says(one.text, agentId)), createdAt: minutesAgo(one.ago) }) as ThreadItem

const threadOf = (threadId: string): ThreadSnapshot => {
  const task = TASKS.find((one) => threadIdOf(one.slug) === threadId) ?? (TASKS[0] as WorldTask)
  const project = projectOf(task.project)
  const lead = task.lead ?? 'claude-code'
  const base = snapshot()
  const thread = task.thread ?? [
    { who: 'you' as const, text: task.title, ago: task.ago + 30 },
    ...(task.summary === undefined ? [] : [{ who: 'lead' as const, text: task.summary, ago: task.ago + 5 }]),
  ]
  return snapshot({
    threadId,
    project: { id: project.id, name: project.name },
    task: {
      ...base.task,
      id: taskIdOf(task.slug),
      title: task.title,
      slug: task.slug,
      branch: `althar/${task.slug}`,
      worktree: `/Users/balazs/Charrette/${project.name}/${task.slug}/${project.name}`,
      phase: task.phase,
      state: task.state === undefined ? 'active' : task.state,
      step: task.phase === 'running' ? 'implement' : null,
      stepAt: minutesAgo(task.ago),
      startedAt: minutesAgo(task.ago),
      settledAt: task.phase === 'settled' ? minutesAgo(task.ago) : null,
      issue: null,
      changes: (() => {
        const one = changeOf(task)
        return one === null ? [] : [one]
      })(),
      steps: [{ key: 'implement', agentId: lead, model: null, skipped: false }],
      lead: { agentId: lead, model: null, account: null },
      actions: task.phase === 'settled' ? [] : ['stop', 'abandon'],
    },
    session: {
      ...(base.session as NonNullable<ThreadSnapshot['session']>),
      agentId: lead,
      agentName: lead === 'codex' ? 'Codex' : 'Claude Code',
      turnRunning: task.phase === 'running',
    },
    items: thread.map((one) => said(one, lead)),
  })
}

/** Today's ⌘K: the tasks holding every word typed, each as the start of a word, title first, then newest. */
const searchTasks: Client['searchTasks'] = async ({ projectId, text }) => {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean)
  const starts = (hay: string, word: string) =>
    new RegExp(`(^|[^\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\#]/g, '\\$&')}`, 'iu').test(hay)
  const found = TASKS.filter((task) => projectId === undefined || task.project === projectId)
    .map((task) => {
      const asked = (task.thread ?? []).map((one) => one.text).join(' ')
      const refs = [
        task.pr === undefined ? '' : `#${task.pr} ${task.pr}`,
        task.issue ?? '',
        `althar/${task.slug}`,
        ...(task.files ?? []),
      ].join(' ')
      const rest = `${asked} ${task.summary ?? ''} ${refs}`
      if (!words.every((word) => starts(task.title, word) || starts(rest, word))) return null
      const inTitle = words.filter((word) => starts(task.title, word)).length
      const first = words.find((word) => !starts(task.title, word))
      const matched = first === undefined ? null : snippet(rest, first)
      return { task, score: inTitle * 10 - task.ago / 10_000, matched }
    })
    .filter((one) => one !== null)
    .sort((a, b) => (words.length === 0 ? a.task.ago - b.task.ago : b.score - a.score))
    .slice(0, 50)
  return {
    tasks: found.map(({ task, matched }): FoundTask => ({
      taskId: taskIdOf(task.slug),
      threadId: threadIdOf(task.slug),
      projectId: task.project,
      title: task.title,
      slug: task.slug,
      phase: task.phase,
      state: task.state ?? 'open',
      pullRequest: task.pr === undefined ? null : `#${task.pr}`,
      changedAt: minutesAgo(task.ago),
      matched,
    })),
  }
}

/** A few words either side of where `word` starts, as the runtime's index cuts them. */
const snippet = (text: string, word: string) => {
  const at = text.toLowerCase().indexOf(word)
  if (at < 0) return null
  const from = Math.max(0, text.lastIndexOf(' ', Math.max(0, at - 40)))
  const end = text.indexOf(' ', at + word.length + 40)
  const to = end < 0 ? text.length : end
  const hitEnd = text.slice(at).search(/[^\p{L}\p{N}#-]/u)
  const hitTo = hitEnd < 0 ? text.length : at + hitEnd
  return [
    { text: `${from > 0 ? '…' : ''}${text.slice(from, at).trimStart()}`, hit: false },
    { text: text.slice(at, hitTo), hit: true },
    { text: `${text.slice(hitTo, to)}${to < text.length ? '…' : ''}`, hit: false },
  ]
}

const notesOf = (projectId: string): ReadonlyArray<ProjectNote> =>
  NOTES.filter((note) => note.project === projectId)
    .map((note) => ({ id: note.id, body: note.body, createdAt: minutesAgo(note.ago), keptBy: 'coordinator' as const }))
    .reverse()

const linear = {
  ...githubConnection,
  id: 'conn_linear',
  product: 'linear' as const,
  name: 'Linear',
  webUrl: 'https://linear.app',
  account: { login: 'balazs', name: 'Balázs' },
}

const AUTOMATIONS = [
  automationSummary({
    id: 'auto_review',
    projectId: ALTHAR,
    name: 'Review each new pull request',
    prompt: 'Review each pull request opened by someone other than me.',
  }),
  automationSummary({
    id: 'auto_bumps',
    projectId: ALTHAR,
    name: 'Bump dependencies on Mondays',
    prompt: 'Update dependencies that have a new minor or patch version, one pull request for all.',
    work: 'task',
    schedule: { every: 'week', days: [1], at: '08:00' },
    latest: [],
  }),
]

export const makeClient = (): Client =>
  fakeClient({
    listProjects: async () => ({ cursor: 3, projects }),
    openProject: async (projectId) => summaryOf(projectId),
    getHome: async () =>
      home({
        looked: minutesAgo(180),
        since: minutesAgo(180),
        projects,
        tasks: TASKS.filter((task) => task.phase !== 'settled').map((task) => ({ ...boardTaskOf(task), projectId: task.project })),
        calls: TASKS.filter((task) => task.asks !== undefined).map((task) => ({ ...callOf(task), projectId: task.project })),
      }),
    getBoard: async (projectId) => boardOf(projectId),
    getCoordinator: async (projectId) =>
      coordinatorSnapshot({
        threadId: coordinatorOf(projectId),
        project: { id: projectId, name: projectOf(projectId).name },
        host: projectId === ERZA ? null : { product: 'github', name: 'GitHub', webUrl: 'https://github.com', connected: true },
        items: [...(CONVERSATIONS[projectId] ?? [])].sort((a, b) => b.ago - a.ago).map((one) => said(one, 'claude-code')),
      }),
    getThread: async (threadId) => threadOf(threadId),
    searchTasks,
    getProjectNotes: async (projectId) => notesOf(projectId),
    getRepositories: async (projectId) =>
      repositories
        .slice(0, 1)
        .map((one) => ({ ...one, name: projectOf(projectId).name, path: `/Users/balazs/Code/${projectOf(projectId).name}` })),
    listConnections: async () => ({ ...connectionList, connections: [githubConnection, linear] }),
    getAutomations: async (projectId) => automationsSnapshot({ automations: AUTOMATIONS.filter((one) => one.projectId === projectId) }),
  }).client

export { ALTHAR, ERZA, MERIDIAN, taskOf }

/** The tabs the window keeps at every load: althar's, meridian's and erza's, each on its board and conversation. */
export const TABS = { open: [ALTHAR, MERIDIAN, ERZA], places: {}, rooms: { [ALTHAR]: 'both', [MERIDIAN]: 'both', [ERZA]: 'both' } }
