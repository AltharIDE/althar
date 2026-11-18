import type { BoardSnapshot, BoardTask, Launch, ProjectSummary, Runnable, ThreadItem } from '@althar/contracts'

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
} from '../../tests/fixtures'
import { type Run, RUNNABLES, world } from './world'

/*
 * What the lab's fake runtime says: althar, of two repositories (althar and
 * althar-mobile), with a few tasks on its board and its coordinator's
 * conversation; what it runs and each run of it, from the lab's world
 * (world.ts), each with its card in the conversation where it was started;
 * and, in C, each command typed in the conversation's terminal, as a card
 * of its own there.
 */

export const ALTHAR = 'p_althar'
export const MERIDIAN = 'p_meridian'

const opened = Date.now()
const minutesAgo = (minutes: number) => new Date(opened - minutes * 60_000).toISOString()
const iso = (at: number) => new Date(at).toISOString()

interface WorldTask {
  readonly slug: string
  readonly title: string
  readonly phase: BoardTask['phase']
  readonly ago: number
  readonly pr?: number
}

const TASKS: ReadonlyArray<WorldTask> = [
  { slug: 'small-changes-fast', title: 'Cut a small change’s overhead', phase: 'running', ago: 12 },
  { slug: 'board-cards-phone', title: 'Board cards on the phone', phase: 'running', ago: 30 },
  { slug: 'gallery-landing', title: 'A gallery of the app on the landing page', phase: 'ready', ago: 50, pr: 963 },
  { slug: 'release-prep', title: 'Release 0.9.0', phase: 'planned', ago: 4 },
]

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
    lead: 'claude-code',
    startedAt: task.phase === 'planned' ? null : minutesAgo(task.ago),
  }),
  state: 'active',
  createdAt: minutesAgo(task.ago),
  settledAt: null,
  changed: null,
  here: [],
})

const projectOf = (projectId: string): ProjectSummary => ({
  id: projectId,
  name: projectId === ALTHAR ? 'althar' : 'meridian',
  slug: projectId === ALTHAR ? 'althar' : 'meridian',
  ink: projectId === ALTHAR ? 'clay' : 'teal',
  lastWorkAt: minutesAgo(2),
  repository: `/Users/balazs/Projects/charrette-project/${projectId === ALTHAR ? 'althar' : 'meridian'}`,
  repositories: projectId === ALTHAR ? ['althar', 'althar-mobile'] : ['meridian'],
  worktrees: `/Users/balazs/Charrette/${projectId === ALTHAR ? 'althar' : 'meridian'}`,
  tasks: projectId === ALTHAR ? TASKS.length : 0,
  running: projectId === ALTHAR ? 2 : 0,
  yours: projectId === ALTHAR ? 1 : 0,
  working: projectId === ALTHAR ? 2 : 0,
  usageLimit: 'move',
  rotateAccounts: false,
  onlyAccounts: null,
  coordinatorThreadId: `thc_${projectId}`,
})

const projects = [projectOf(ALTHAR), projectOf(MERIDIAN)]

let cursor = 3
const boardOf = (projectId: string): BoardSnapshot => {
  cursor += 1
  return { cursor, tasks: projectId === ALTHAR ? TASKS.map(taskCard) : [], calls: [], settledTotal: projectId === ALTHAR ? 41 : 0 }
}

/** The coordinator's conversation in althar before anything ran: the same in every direction. */
const COORDINATOR: ReadonlyArray<{ readonly who: 'you' | 'lead'; readonly text: string; readonly ago: number }> = [
  { who: 'you', text: 'Where is the phone app at? I want to try the board cards on the simulator.', ago: 24 },
  {
    who: 'lead',
    text: '**Board cards on the phone** is under way in althar-mobile: the cards show their branch and where they stand, and the lead is on the lanes now.\n\nTo try main as it is, run **Mobile on iOS simulator** from Run.',
    ago: 23,
  },
]

const RUNNABLE_LIST: ReadonlyArray<Runnable> = RUNNABLES.map((one) => ({
  id: one.id,
  name: one.name,
  command: one.command,
  repository: one.repository,
  own: false,
  from: 'person',
}))

/** A run, as the runtime says it. */
const launchOf = (run: Run): Launch => ({
  id: run.id,
  command: run.command,
  name: run.name,
  url: run.url,
  startedAt: iso(run.startedAt),
  ended: run.ended === null ? null : { at: iso(run.ended.at), code: run.ended.code },
  taskId: null,
  runnableId: run.runnableId,
  where: run.folder.branch,
  branch: null,
})

const launches = (): Launch[] => world.get().runs.map(launchOf)

/** A run's card, and in C a command typed in the conversation, as the runtime keeps them in the thread. */
const saidItems = (): ThreadItem[] =>
  world.get().said.flatMap((said, n): ThreadItem[] => {
    const base = { id: `said_${n}`, sequence: 100 + n, createdAt: iso(said.at), agentId: null, kind: 'run' as const }
    if (said.kind === 'run') {
      const run = world.run(said.id)
      if (run === undefined) return []
      return [
        {
          ...base,
          content: {
            launchId: run.id,
            taskId: null,
            runnableId: run.runnableId,
            name: run.name,
            where: run.folder.branch,
            command: run.command,
            url: run.url,
            startedAt: iso(run.startedAt),
            ended:
              run.ended === null ? null : { at: iso(run.ended.at), code: run.ended.code, stopped: run.ended.stopped, last: run.ended.last },
          },
        } as ThreadItem,
      ]
    }
    const entry = world.entry(said.id)
    if (entry === undefined) return []
    return [
      {
        ...base,
        content: {
          launchId: entry.id,
          taskId: null,
          where: entry.folder.repository,
          command: entry.command,
          url: null,
          startedAt: iso(entry.at),
          ended: entry.running ? null : { at: iso(entry.at), code: entry.exit, stopped: entry.exit === 130, last: null },
        },
      } as ThreadItem,
    ]
  })

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
        items:
          projectId === ALTHAR
            ? [
                // Each read says the same messages, by the same ids and order, so the thread keeps them where they were.
                ...COORDINATOR.map(
                  (one, n) =>
                    ({
                      ...(one.who === 'you' ? items.you(one.text) : items.says(one.text, 'claude-code')),
                      id: `said_before_${n}`,
                      sequence: 1 + n,
                      createdAt: minutesAgo(one.ago),
                    }) as ThreadItem,
                ),
                ...saidItems(),
              ]
            : [],
        runnables: projectId === ALTHAR ? [...RUNNABLE_LIST] : [],
        launches: projectId === ALTHAR ? launches() : [],
      }),
    getRepositories: async (projectId) =>
      (projectId === ALTHAR ? ['althar', 'althar-mobile'] : ['meridian']).map((name) => ({
        ...repositories[0]!,
        id: `repo_${name}`,
        name,
        path: `/Users/balazs/Projects/charrette-project/${name}`,
        host: { ...repositories[0]!.host!, path: `AltharIDE/${name}`, url: `https://github.com/AltharIDE/${name}` },
      })),
    getRunnableRefs: async () => [],
    listConnections: async () => ({ ...connectionList, connections: [githubConnection] }),
    runProject: async (_projectId, _taskId, _threadId, runnableId) => {
      const run = runnableId === undefined ? undefined : world.start(runnableId)
      if (run === undefined) throw new Error('Nothing to run.')
      return launchOf(run)
    },
    stopLaunch: async (id) => world.stop(id),
    clearLaunch: async (id) => world.clear(id),
    readLaunchOutput: async (id) => ({ text: (world.run(id)?.lines ?? []).join('\n'), dropped: 0 }),
  }).client

/** The tabs this window keeps at every load: althar's and meridian's, althar's on its conversation beside its board. */
export const TABS = { open: [ALTHAR, MERIDIAN], places: {}, rooms: { [ALTHAR]: 'both', [MERIDIAN]: 'both' } }
