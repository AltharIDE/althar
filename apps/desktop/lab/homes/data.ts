import type { BoardSnapshot, BoardTask, ConnectionInfo, ProjectSummary, ThreadItem } from '@althar/contracts'

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
import { lab } from './state'
import { API_VERSION, HOST_VERSION, homeOf, stateOf } from './world'

/*
 * What each home's fake runtime says: this computer has althar and meridian;
 * hetzner-01 has ledger and infra, the studio Mac site, and the rest a
 * project each. Each project has a few tasks and a short conversation with
 * its coordinator. "Empty" in the lab's bar gives a home's window no projects.
 * A home's window refuses commands while its connection is down, as the
 * client does with no tunnel; what it read stays on screen.
 */

const opened = Date.now()
const minutesAgo = (minutes: number) => new Date(opened - minutes * 60_000).toISOString()

interface WorldTask {
  readonly slug: string
  readonly title: string
  readonly phase: BoardTask['phase']
  readonly ago: number
}
interface WorldProject {
  readonly id: string
  readonly name: string
  readonly ink: ProjectSummary['ink']
  readonly tasks: ReadonlyArray<WorldTask>
  readonly talk: ReadonlyArray<{ readonly who: 'you' | 'lead'; readonly text: string; readonly ago: number }>
}

const PROJECTS: Record<string, ReadonlyArray<WorldProject>> = {
  local: [
    {
      id: 'p_althar',
      name: 'althar',
      ink: 'clay',
      tasks: [
        { slug: 'small-changes-fast', title: 'Cut a small change’s overhead', phase: 'running', ago: 12 },
        { slug: 'gallery-landing', title: 'A gallery of the app on the landing page', phase: 'ready', ago: 50 },
        { slug: 'release-prep', title: 'Release 0.9.0', phase: 'planned', ago: 4 },
      ],
      talk: [
        { who: 'you', text: 'Is 0.9.0 ready to tag?', ago: 64 },
        {
          who: 'lead',
          text: 'Nearly. The release notes are still being written in **Release 0.9.0**. I’ll tag v0.9.0 once they land.',
          ago: 63,
        },
      ],
    },
    { id: 'p_meridian', name: 'meridian', ink: 'teal', tasks: [], talk: [] },
  ],
  hetzner: [
    {
      id: 'p_ledger',
      name: 'ledger',
      ink: 'moss',
      tasks: [
        { slug: 'nightly-import', title: 'Retry the nightly bank import on a 429', phase: 'running', ago: 8 },
        { slug: 'vat-report', title: 'Quarterly VAT report as CSV', phase: 'running', ago: 31 },
        { slug: 'currency-rounding', title: 'Round foreign amounts once, at booking', phase: 'ready', ago: 95 },
        { slug: 'drop-node-18', title: 'Drop Node 18', phase: 'planned', ago: 3 },
      ],
      talk: [
        { who: 'you', text: 'The bank import failed again last night. Make it retry.', ago: 20 },
        {
          who: 'lead',
          text: 'Started **Retry the nightly bank import on a 429**. The bank’s API answers 429 after the 500th call; it now waits as long as the answer says and carries on from the last page.',
          ago: 8,
        },
      ],
    },
    {
      id: 'p_infra',
      name: 'infra',
      ink: 'slate',
      tasks: [{ slug: 'caddy-renewals', title: 'Watch Caddy’s certificate renewals', phase: 'ready', ago: 200 }],
      talk: [],
    },
  ],
  studio: [
    {
      id: 'p_site',
      name: 'site',
      ink: 'plum',
      tasks: [{ slug: 'og-images', title: 'Open Graph images for every post', phase: 'running', ago: 14 }],
      talk: [],
    },
  ],
}

const projectsOf = (windowId: string): ReadonlyArray<WorldProject> => {
  if (windowId !== 'local' && lab.get().empty) return []
  return PROJECTS[windowId] ?? [{ id: `p_${windowId}_tools`, name: 'tools', ink: 'ochre', tasks: [], talk: [] }]
}

/** The projects on a home, as its window lists them, with how much runs and how much waits on you: Manage knows a home by them. */
export const projectsOn = (windowId: string) =>
  projectsOf(windowId).map((project) => ({
    id: project.id,
    name: project.name,
    ink: project.ink,
    running: project.tasks.filter((task) => task.phase === 'running').length,
    ready: project.tasks.filter((task) => task.phase === 'ready').length,
  }))
export type OnHome = ReturnType<typeof projectsOn>[number]

const summaryOf = (windowId: string, project: WorldProject): ProjectSummary => ({
  id: project.id,
  name: project.name,
  slug: project.name,
  ink: project.ink,
  lastWorkAt: project.tasks.length === 0 ? null : minutesAgo(Math.min(...project.tasks.map((task) => task.ago))),
  repository: windowId === 'local' ? `/Users/balazs/Code/${project.name}` : `/home/balazs/code/${project.name}`,
  repositories: [project.name],
  worktrees:
    windowId === 'local' ? `/Users/balazs/Charrette/${project.name}` : `/home/balazs/.local/share/althar-host/worktrees/${project.name}`,
  tasks: project.tasks.length,
  running: project.tasks.filter((task) => task.phase === 'running').length,
  yours: project.tasks.filter((task) => task.phase === 'ready').length,
  working: project.tasks.filter((task) => task.phase === 'running').length,
  usageLimit: 'move',
  rotateAccounts: false,
  onlyAccounts: null,
  coordinatorThreadId: `thc_${project.id}`,
})

const taskCard = (task: WorldTask): BoardTask => ({
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
    step: task.phase === 'running' ? 'implement' : null,
    lead: 'claude-code',
    startedAt: task.phase === 'planned' ? null : minutesAgo(task.ago),
  }),
  state: 'active',
  createdAt: minutesAgo(task.ago),
  settledAt: null,
  changed: null,
  here: [],
})

const said = (one: WorldProject['talk'][number]): ThreadItem =>
  ({ ...(one.who === 'you' ? items.you(one.text) : items.says(one.text, 'claude-code')), createdAt: minutesAgo(one.ago) }) as ThreadItem

/** Calls that change something: refused while the window's connection is down. Reads answer from what the runtime said. */
const reads = /^(status|list|get|read|find|search|watch|close|open|check|preview)/

const connectionInfo = (windowId: string): ConnectionInfo | undefined => {
  const home = homeOf(windowId)
  if (home === undefined) return undefined
  const position = { homeId: home.homeId, cursor: 3, checkpoint: '0'.repeat(32) } as ConnectionInfo['position']
  return {
    identity: { homeId: home.homeId, actorId: `act_${'a'.repeat(32)}`, deviceId: `dev_${'b'.repeat(32)}`, role: 'socket' },
    hostDeviceId: `dev_${'c'.repeat(32)}`,
    apiVersion: API_VERSION,
    appVersion: HOST_VERSION,
    position,
  } as ConnectionInfo
}

export const makeClient = (windowId: string): Client => {
  const projects = () => projectsOf(windowId)
  const find = (projectId: string) => projects().find((one) => one.id === projectId)
  let cursor = 3
  const board = (projectId: string): BoardSnapshot => {
    cursor += 1
    return { cursor, tasks: (find(projectId)?.tasks ?? []).map(taskCard), calls: [], settledTotal: 12 }
  }
  const info = connectionInfo(windowId)
  const client = fakeClient({
    ...(info === undefined ? {} : { connection: info }),
    listProjects: async () => ({ cursor: 3, projects: projects().map((one) => summaryOf(windowId, one)) }),
    openProject: async (projectId) => summaryOf(windowId, find(projectId) ?? projects()[0]!),
    getHome: async () =>
      home({ looked: minutesAgo(180), since: minutesAgo(180), projects: projects().map((one) => summaryOf(windowId, one)) }),
    getBoard: async (projectId) => board(projectId),
    getCoordinator: async (projectId) =>
      coordinatorSnapshot({
        threadId: `thc_${projectId}`,
        project: { id: projectId, name: find(projectId)?.name ?? '' },
        host: { product: 'github', name: 'GitHub', webUrl: 'https://github.com', connected: true },
        items: (find(projectId)?.talk ?? []).map(said),
      }),
    getThread: async (threadId) => {
      const all = projects().flatMap((project) => project.tasks.map((task) => ({ project, task })))
      const found = all.find(({ task }) => `th_${task.slug}` === threadId)
      const base = snapshot()
      return snapshot({
        threadId,
        project: { id: found?.project.id ?? '', name: found?.project.name ?? '' },
        task: { ...base.task, id: `t_${found?.task.slug ?? ''}`, title: found?.task.title ?? '', slug: found?.task.slug ?? '' },
      })
    },
    getRepositories: async () => repositories.slice(0, 1),
    listConnections: async () => ({ ...connectionList, connections: [githubConnection] }),
  }).client
  if (windowId === 'local') return client
  // With no tunnel, a command is refused before it goes; what was read stays.
  return new Proxy(client, {
    get(target, key, receiver): unknown {
      const value = Reflect.get(target, key, receiver)
      if (typeof key !== 'string' || typeof value !== 'function' || reads.test(key)) return value
      return (...args: unknown[]) => {
        const now = stateOf(windowId)
        if (now.connection !== 'connected')
          return Promise.reject(new Error(`${homeOf(windowId)?.name ?? 'The home'} isn’t connected. Reconnect, then try again.`))
        return (value as (...args: unknown[]) => unknown).apply(target, args)
      }
    },
  })
}

/** The tabs a home's window keeps at its first load: every project, the first on its board beside its conversation. */
export const tabsOf = (windowId: string) => {
  const ids = projectsOf(windowId).map((one) => one.id)
  return { open: ids, places: {}, rooms: Object.fromEntries(ids.map((id) => [id, 'both'])) }
}
export const firstProjectOf = (windowId: string) => projectsOf(windowId)[0]?.id ?? null
