// Scrappy: the real desktop app (its router, tabs, project and task screens) on the tests' fake client, with this repository's runnables.
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '../../src/styles/global.css'
import '../../../../apps/desktop/src/renderer/app.css'

import { createRoot } from 'react-dom/client'

import { LinkButton } from '../../src/primitives/LinkButton/LinkButton'
import { Segmented } from '../../src/primitives/Segmented/Segmented'
import { type BoardTask, type HomeTask, type ProjectSummary, RouterProvider } from './deps'

import { follow } from '../../../../apps/desktop/src/renderer/data/feed'
import { makeQueryClient } from '../../../../apps/desktop/src/renderer/data/reads'
import { ServicesProvider } from '../../../../apps/desktop/src/renderer/data/services'
import { makeRouter } from '../../../../apps/desktop/src/renderer/router'
import {
  card,
  change,
  coordinatorSnapshot,
  fakeClient,
  fakeHost,
  home,
  items,
  project,
  repositories,
  snapshot,
} from '../../../../apps/desktop/tests/fixtures'
import { css, label } from './parts'
import { type Direction, type Opening, proto, type Run, type Scenario, TASK, useProto } from './state'

/* ——— What the fake runtime holds: althar, its board of real tasks, a task under way. ——— */

const althar: ProjectSummary = {
  ...project,
  name: 'althar',
  slug: 'althar',
  ink: 'clay',
  repository: '/Users/balazs/Projects/charrette-project/althar',
  repositories: ['althar'],
  worktrees: '/Users/balazs/Althar/althar',
  running: 2,
  working: 2,
}
const projects = [althar]

const repository = {
  ...repositories[0]!,
  id: 'repo_althar',
  name: 'althar',
  path: '/Users/balazs/Projects/charrette-project/althar',
  host: {
    ...repositories[0]!.host!,
    path: 'AltharIDE/althar',
    url: 'https://github.com/AltharIDE/althar',
    account: { login: 'balazs', state: 'ready' as const },
  },
  tasks: 3,
}

const boardTask = (overrides: Partial<BoardTask>): BoardTask => ({
  ...card(),
  state: 'open',
  createdAt: '2026-10-14T09:00:00.000Z',
  settledAt: null,
  changed: null,
  here: [],
  ...overrides,
  branch: overrides.branch ?? `althar/${overrides.slug ?? 'task'}`,
})

const tasks: BoardTask[] = [
  boardTask({
    taskId: 't1',
    threadId: 'th1',
    title: TASK.title,
    slug: 'download-the-installer',
    branch: TASK.branch,
    phase: 'running',
    step: 'implement',
    startedAt: '2026-10-14T09:10:00.000Z',
  }),
  boardTask({
    taskId: 't2',
    threadId: 'th2',
    title: 'Keep quick tasks on this Mac, and let the lead make one a change',
    slug: 'quick-tasks-on-this-mac',
    phase: 'running',
    step: 'review',
    startedAt: '2026-10-14T08:40:00.000Z',
  }),
  boardTask({
    taskId: 't3',
    threadId: 'th3',
    title: 'Let a finished task go back to work and ship again',
    slug: 'back-to-work',
    phase: 'planned',
  }),
  boardTask({
    taskId: 't4',
    threadId: 'th4',
    title: 'Read a task’s kind from what it has',
    slug: 'task-kind',
    phase: 'ready',
    change: change({ draft: false, number: 159, title: 'Read a task’s kind from what it has', repository: 'AltharIDE/althar' }),
    summary: 'Cards that have nothing to press read as plain, reviews and ⌘K included.',
  }),
  boardTask({
    taskId: 't5',
    threadId: 'th5',
    title: 'Green main’s e2e again',
    slug: 'green-e2e',
    phase: 'ready',
    changed: { files: 4, add: 31, del: 12 },
  }),
]

const iso = (ms: number) => new Date(ms).toISOString()

/** A run as the runtime would hand it on: what the Running pill over the composer reads. */
const launchOf = (run: Run) => {
  const runnable = proto.get().runnables.find((one) => one.id === run.runnableId)
  return {
    id: run.id,
    command: runnable?.command ?? '',
    ...(runnable === undefined ? {} : { label: label(runnable) }),
    url: run.url,
    startedAt: iso(run.startedAt),
    ended: run.endedAt === null ? null : { at: iso(run.endedAt), code: run.code },
    taskId: run.place === 'task' ? 't1' : null,
    where: run.place === 'task' ? TASK.title : 'main',
  }
}

/** Today's one command: the repository's, where it has one. */
const todays = () => (proto.get().scenario === 'empty' ? null : 'bun run dev')

const { client } = fakeClient({
  listProjects: async () => ({ cursor: 3, projects }),
  getRepositories: async () => [repository],
  getHome: async () =>
    home({
      projects,
      tasks: tasks.filter((one) => one.phase !== 'planned').map((one): HomeTask => ({ ...one, projectId: 'p1' })),
    }),
  getBoard: async () => ({ cursor: 1, tasks, calls: [], settledTotal: 41 }),
  getCoordinator: async () =>
    coordinatorSnapshot({
      project: { id: 'p1', name: 'althar' },
      runCommand: todays(),
      launches: proto.get().runs.map(launchOf),
      items: [
        items.you('Can you plan a task to make the Download button on the site offer the installer for the visitor’s computer?'),
        items.tool({ title: 'Read apps/site/src/Download.tsx' }),
        items.says(
          'The button links to the releases page whatever the computer. I planned a task to pick the .dmg, the AppImage or the .exe.',
        ),
        items.card(
          card({
            taskId: 't1',
            threadId: 'th1',
            title: TASK.title,
            slug: 'download-the-installer',
            phase: 'running',
            step: 'implement',
            branch: TASK.branch,
          }),
          'c1',
        ),
      ],
    }),
  getThread: async () =>
    snapshot({
      project: { id: 'p1', name: 'althar' },
      task: {
        ...snapshot().task,
        title: TASK.title,
        slug: 'download-the-installer',
        branch: TASK.branch,
        worktree: '/Users/balazs/Althar/althar/download-the-installer',
        runCommand: todays(),
        launches: proto
          .get()
          .runs.filter((one) => one.place === 'task')
          .map(launchOf),
      },
      items: [
        items.you('Make the Download button offer the installer for the visitor’s computer: the .dmg on a Mac, the AppImage on Linux.'),
        items.tool({ title: 'Read apps/site/src/Download.tsx' }),
        items.says(
          'The button always links to the releases page. I’ll read the platform from the browser and pick the asset, with the page as the fallback.',
        ),
        items.tool({ title: 'Edit apps/site/src/Download.tsx' }),
      ],
    }),
  runProject: async (_projectId: string, taskId: string | null) => {
    const runnable = proto.get().runnables[0]
    if (runnable !== undefined) proto.run(runnable.id, taskId === null ? 'main' : 'task')
    return launchOf(proto.get().runs[0]!)
  },
  stopLaunch: async (id: string) => proto.stop(id),
  clearLaunch: async (id: string) => proto.clear(id),
})

const host = fakeHost()
const cache = makeQueryClient()
const services = { client, host, cache, feed: follow(client, cache) }

// What runs changed: the screens read their runs again, as they would on the runtime's word.
proto.subscribe(() => {
  void cache.invalidateQueries({ queryKey: ['coordinator'] })
  void cache.invalidateQueries({ queryKey: ['thread'] })
})

/* ——— The strip under the window: which state the page shows, and which screen. ——— */

const SCENARIOS: ReadonlyArray<{ value: Scenario; label: string }> = [
  { value: 'empty', label: 'Nothing known yet' },
  { value: 'one', label: 'One' },
  { value: 'many', label: 'Many' },
  { value: 'busy', label: 'Several running' },
]

function Strip({ name }: { name: string }) {
  const p = useProto()
  if (p.bare) return null
  return (
    <div className={css.strip}>
      <span className={css.name}>
        {p.direction} · {name}
      </span>
      <Segmented<Scenario>
        label="What the project knows to run"
        value={p.scenario}
        onChange={(scenario) => proto.scenario(scenario)}
        options={SCENARIOS}
      />
      <LinkButton onClick={() => window.location.assign('#/projects/p1?room=both')}>Project</LinkButton>
      <LinkButton onClick={() => window.location.assign('#/threads/th1')}>Task</LinkButton>
      <span className={css.grow} />
      <LinkButton onClick={() => window.location.assign('./index.html')}>All directions</LinkButton>
    </div>
  )
}

export const boot = (direction: Direction, name: string) => {
  const params = new URLSearchParams(window.location.search)
  const scenario = (params.get('s') as Scenario | null) ?? 'many'
  proto.set({ direction, opening: (params.get('open') as Opening | null) ?? null, bare: params.has('bare') })
  proto.scenario(scenario)
  // Every page opens on althar's tab, whatever another page kept.
  window.localStorage.removeItem('althar.tabs')
  if (window.location.hash === '' || window.location.hash === '#/') window.location.hash = '#/projects/p1?room=both'
  const router = makeRouter({ client, cache })
  const element = document.getElementById('root')
  if (element === null) throw new Error('The page has no #root')
  document.title = `${direction} · ${name}`
  createRoot(element).render(
    <ServicesProvider value={services}>
      <div className={params.has('bare') ? css.bare : css.frame}>
        <RouterProvider router={router} />
      </div>
      <Strip name={name} />
    </ServicesProvider>,
  )
}
