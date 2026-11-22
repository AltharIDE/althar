import type { BoardSnapshot, BoardTask, ProjectSummary } from '@althar/contracts'

import type { HomeState, HomesHost, HomesOverview, RemoteHome } from '../../src/homes'
import type { Client } from '../../src/renderer/data/client'
import { card, coordinatorSnapshot, fakeClient, home, load } from '../../tests/fixtures'
import { lab } from './state'

/*
 * What the lab's fake runtime says: althar and meridian, a few tasks on
 * althar's board, this computer's load and agents, and two Linux workers, as
 * the Computers task reads them (GetPlaces, GetWorkers). The homes host says
 * which home the window is on: This Mac, or studio, a home over SSH, as the
 * lab's bar picks it.
 */

export const ALTHAR = 'p_althar'
export const MERIDIAN = 'p_meridian'

const opened = Date.now()
const minutesAgo = (minutes: number) => new Date(opened - minutes * 60_000).toISOString()

const projectOf = (projectId: string): ProjectSummary => {
  const name = projectId === ALTHAR ? 'althar' : 'meridian'
  return {
    id: projectId,
    name,
    slug: name,
    ink: projectId === ALTHAR ? 'clay' : 'teal',
    lastWorkAt: minutesAgo(2),
    repository: `/Users/balazs/Code/${name}`,
    repositories: [name],
    worktrees: `/Users/balazs/Charrette/${name}`,
    tasks: projectId === ALTHAR ? 3 : 0,
    running: projectId === ALTHAR ? 1 : 0,
    yours: projectId === ALTHAR ? 1 : 0,
    working: projectId === ALTHAR ? 1 : 0,
    usageLimit: 'move',
    rotateAccounts: false,
    onlyAccounts: null,
    coordinatorThreadId: `thc_${projectId}`,
  }
}
const projects = [projectOf(ALTHAR), projectOf(MERIDIAN)]

const TASKS = [
  { slug: 'phone-pairing', title: 'Where the desktop shows a phone’s pairing QR', phase: 'running' as const, ago: 20 },
  { slug: 'worker-merges', title: 'Redesign what the worker merges put on screen', phase: 'ready' as const, ago: 90 },
  { slug: 'changelog-0-10', title: 'Changelog entry for 0.10.0', phase: 'ready' as const, ago: 300 },
]

const taskCard = (task: (typeof TASKS)[number]): BoardTask => ({
  ...card({
    taskId: `t_${task.slug}`,
    threadId: `th_${task.slug}`,
    title: task.title,
    slug: task.slug,
    phase: task.phase,
    kind: 'change',
    branch: `althar/${task.slug}`,
    plan: null,
    step: task.phase === 'running' ? 'implement' : null,
    lead: 'claude-code',
    startedAt: minutesAgo(task.ago),
  }),
  state: 'active',
  createdAt: minutesAgo(task.ago),
  settledAt: null,
  changed: null,
  here: [],
})

let cursor = 3
const boardOf = (projectId: string): BoardSnapshot => {
  cursor += 1
  return { cursor, tasks: projectId === ALTHAR ? TASKS.map(taskCard) : [], calls: [], settledTotal: 41 }
}

/* GetPlaces and GetWorkers, as the Computers task's contracts have them (not on main yet). */
interface Places {
  readonly busy: number
  readonly configured: number
  readonly atOnce: number
  readonly why: 'memory' | 'cpu' | null
  readonly waiting: number
}
interface HomeWorkers {
  readonly enabled: boolean
  readonly workers: ReadonlyArray<{
    readonly workerId: string
    readonly connected: boolean
    readonly busy: boolean
    readonly capacity?: {
      readonly platform: 'linux' | 'macos' | 'windows'
      readonly architecture: 'x64' | 'arm64'
      readonly cpuCores: number
      readonly freeMemoryMib: number
      readonly freeDiskMib: number
    }
    readonly providers: ReadonlyArray<string>
    readonly projects: ReadonlyArray<{ readonly id: string; readonly name: string }>
    readonly task: { readonly taskId: string; readonly threadId: string; readonly title: string; readonly project: string } | null
  }>
}

const PLACES: Places = { busy: 2, configured: 5, atOnce: 5, why: null, waiting: 0 }

const WORKERS: HomeWorkers = {
  enabled: true,
  workers: [
    {
      workerId: 'wrk_3c3f9a2b1d0e4f5a6b7c8d9e0f1a2b3c',
      connected: true,
      busy: true,
      capacity: { platform: 'linux', architecture: 'arm64', cpuCores: 8, freeMemoryMib: 12_700, freeDiskMib: 182_000 },
      providers: ['claude-code', 'codex'],
      projects: [{ id: ALTHAR, name: 'althar' }],
      task: {
        taskId: 't_worker-merges',
        threadId: 'th_worker-merges',
        title: 'Redesign what the worker merges put on screen',
        project: 'althar',
      },
    },
    {
      workerId: 'wrk_7d1e8a9b0c2d3e4f5a6b7c8d9e0f1a2b',
      connected: false,
      busy: false,
      providers: [],
      projects: [{ id: ALTHAR, name: 'althar' }],
      task: null,
    },
  ],
}

export const makeClient = (): Client =>
  fakeClient({
    listProjects: async () => ({ cursor: 3, projects }),
    openProject: async (projectId) => projectOf(projectId),
    getHome: async () => home({ looked: minutesAgo(180), since: minutesAgo(180), projects }),
    getBoard: async (projectId) => boardOf(projectId),
    getCoordinator: async (projectId) =>
      coordinatorSnapshot({
        threadId: `thc_${projectId}`,
        project: { id: projectId, name: projectOf(projectId).name },
        host: { product: 'github', name: 'GitHub', webUrl: 'https://github.com', connected: true },
        items: [],
      }),
    getLoad: async () => load,
    getPlaces: async () => PLACES,
    getWorkers: async () => WORKERS,
    removeWorker: async () => undefined,
  } as Partial<Client>).client

/** The tabs the window keeps at every load: althar's, on its board beside the coordinator. */
export const TABS = { open: [ALTHAR, MERIDIAN], places: {}, rooms: { [ALTHAR]: 'both', [MERIDIAN]: 'both' } }

/* ---- the homes: This Mac, or studio over SSH ---- */

export const STUDIO: RemoteHome = {
  id: 'saved_studio',
  name: 'studio',
  homeId: 'home_8e2b41c07a9d4e3f9b6c5d4e3f2a1b0c',
  ssh: { target: 'althar@studio' },
}

const stateOf = (): HomeState =>
  lab.get().home === 'studio'
    ? { current: { kind: 'ssh', home: STUDIO }, connection: 'connected' }
    : { current: { kind: 'local' }, connection: 'local' }

const overviewOf = (): HomesOverview => ({
  homes: [STUDIO],
  windows: lab.get().home === 'studio' ? { [STUDIO.homeId]: 'connected' } : { local: 'local' },
  projects: {},
  opened: { [STUDIO.id]: opened - 3 * 3_600_000 },
})

export const makeHomes = (): HomesHost => {
  const states = new Set<(state: HomeState) => void>()
  const overviews = new Set<(overview: HomesOverview) => void>()
  lab.subscribe(() => {
    for (const listener of states) listener(stateOf())
    for (const listener of overviews) listener(overviewOf())
  })
  const nothing = async () => undefined
  return {
    state: async () => stateOf(),
    list: async () => [STUDIO],
    overview: async () => overviewOf(),
    inspect: async () => {
      throw new Error('Not in the lab')
    },
    connect: nothing,
    save: nothing,
    open: async (id) => lab.set({ home: id === 'local' ? 'mac' : 'studio' }),
    rename: nothing,
    change: nothing,
    forget: nothing,
    restore: nothing,
    cancelCheck: nothing,
    reconnect: nothing,
    report: () => undefined,
    onState: (listener) => {
      states.add(listener)
      return () => states.delete(listener)
    },
    onOverview: (listener) => {
      overviews.add(listener)
      return () => overviews.delete(listener)
    },
    onOpen: () => () => undefined,
    onProject: () => () => undefined,
  }
}
