// Scrappy: the real desktop app (its router, tabs, coordinator and task screens) on the tests' fake client, with a message holding links.
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'
import '../../src/renderer/app.css'

import type { BoardTask, ProjectSummary } from '@althar/contracts'
import { RouterProvider } from '@tanstack/react-router'
import { createRoot } from 'react-dom/client'

import { LinkButton, Segmented } from '@althar/ui'

import { follow } from '../../src/renderer/data/feed'
import { makeQueryClient } from '../../src/renderer/data/reads'
import { ServicesProvider } from '../../src/renderer/data/services'
import { makeRouter } from '../../src/renderer/router'
import { card, coordinatorSnapshot, fakeClient, fakeHost, home, project, repositories, snapshot } from '../../tests/fixtures'
import { coordinatorItems, TASK, taskItems } from './data'
import css from './parts.module.css'
import { type Direction, proto, type Scenario, useProto } from './state'

/* ——— What the fake runtime holds: althar, a few of its tasks, the coordinator's thread and one task's. ——— */

const althar: ProjectSummary = {
  ...project,
  name: 'althar',
  slug: 'althar',
  ink: 'clay',
  repository: '/Users/balazs/Projects/charrette-project/althar',
  repositories: ['althar'],
  worktrees: '/Users/balazs/Althar/althar',
  running: 1,
  working: 1,
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
  createdAt: new Date(Date.now() - 40 * 60_000).toISOString(),
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
    slug: TASK.slug,
    branch: TASK.branch,
    phase: 'running',
    step: 'implement',
    startedAt: new Date(Date.now() - 12 * 60_000).toISOString(),
  }),
  boardTask({ taskId: 't2', threadId: 'th2', title: 'Green the Linux end-to-end run again', slug: 'green-linux-e2e', phase: 'planned' }),
  boardTask({
    taskId: 't3',
    threadId: 'th3',
    title: 'Give Download the installer for this computer',
    slug: 'download-the-installer',
    phase: 'ready',
    changed: { files: 4, add: 31, del: 12 },
  }),
]

const { client } = fakeClient({
  listProjects: async () => ({ cursor: 3, projects }),
  getRepositories: async () => [repository],
  getHome: async () => home({ projects }),
  getBoard: async () => ({ cursor: 1, tasks, calls: [], settledTotal: 41 }),
  getCoordinator: async () =>
    coordinatorSnapshot({ project: { id: 'p1', name: 'althar' }, items: [...coordinatorItems(proto.get().scenario)] }),
  getThread: async () =>
    snapshot({
      project: { id: 'p1', name: 'althar' },
      task: {
        ...snapshot().task,
        title: TASK.title,
        slug: TASK.slug,
        branch: TASK.branch,
        worktree: `/Users/balazs/Althar/althar/${TASK.slug}`,
        startedAt: new Date(Date.now() - 12 * 60_000).toISOString(),
      },
      items: [...taskItems(proto.get().scenario)],
    }),
})

const host = fakeHost()
const cache = makeQueryClient()
const services = { client, host, cache, feed: follow(client, cache) }

// Another message: the screens read their threads again, as they would on the runtime's word.
let was = proto.get().scenario
proto.subscribe(() => {
  if (proto.get().scenario === was) return
  was = proto.get().scenario
  void cache.invalidateQueries({ queryKey: ['coordinator'] })
  void cache.invalidateQueries({ queryKey: ['thread'] })
})

/* ——— The strip under the window: which message, which thread, and the way back to every direction. ——— */

const SCENARIOS: ReadonlyArray<{ value: Scenario; label: string }> = [
  { value: 'short', label: 'Short, one link' },
  { value: 'long', label: 'Long, one link' },
  { value: 'two', label: 'Two links' },
  { value: 'agent', label: 'The agent’s link' },
]

const COORDINATOR = '#/projects/p1?room=both'
const THREAD = '#/threads/th1'

function Strip({ name }: { name: string }) {
  const p = useProto()
  if (p.bare) return null
  return (
    <div className={css.strip}>
      <span className={css.name}>
        {p.direction === 'T' ? 'Today' : p.direction} · {name}
      </span>
      <Segmented<Scenario>
        label="The person’s message"
        value={p.scenario}
        onChange={(scenario) => proto.set({ scenario })}
        options={SCENARIOS}
      />
      <LinkButton onClick={() => window.location.assign(COORDINATOR)}>Coordinator</LinkButton>
      <LinkButton onClick={() => window.location.assign(THREAD)}>Task</LinkButton>
      <span className={css.grow} />
      <LinkButton onClick={() => window.location.assign('./index.html')}>All directions</LinkButton>
    </div>
  )
}

export const boot = (direction: Direction, name: string) => {
  const params = new URLSearchParams(window.location.search)
  proto.set({
    direction,
    scenario: (params.get('s') as Scenario | null) ?? 'short',
    short: params.has('short'),
    bare: params.has('bare'),
  })
  // Every page opens on althar's tab, whatever another page kept.
  window.localStorage.removeItem('althar.tabs')
  if (window.location.hash === '' || window.location.hash === '#/') window.location.hash = COORDINATOR
  const router = makeRouter({ client, cache })
  const element = document.getElementById('root')
  if (element === null) throw new Error('The page has no #root')
  document.title = `${direction === 'T' ? 'Today' : direction} · ${name}`
  createRoot(element).render(
    <ServicesProvider value={services}>
      <div className={params.has('bare') ? css.bare : css.frame}>
        <RouterProvider router={router} />
      </div>
      <Strip name={name} />
    </ServicesProvider>,
  )
}
