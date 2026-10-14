// Scrappy: the real desktop app (its router, tabs, coordinator and task screens) on the tests' fake client, with a message holding links, and a switcher that swaps the direction in place.
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'
import '../../src/renderer/app.css'

import type { BoardTask, ProjectSummary } from '@althar/contracts'
import { RouterProvider, useRouterState } from '@tanstack/react-router'
import { useEffect } from 'react'
import { createRoot } from 'react-dom/client'

import { Segmented, Switch } from '@althar/ui'

import { follow } from '../../src/renderer/data/feed'
import { makeQueryClient } from '../../src/renderer/data/reads'
import { ServicesProvider } from '../../src/renderer/data/services'
import { makeRouter } from '../../src/renderer/router'
import { card, coordinatorSnapshot, fakeClient, fakeHost, home, project, repositories, snapshot } from '../../tests/fixtures'
import { coordinatorItems, TASK, taskItems } from './data'
import css from './parts.module.css'
import { type Direction, DIRECTIONS, proto, type Scenario, useProto } from './state'

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

/* ——— The switcher under the window: the direction, swapped in place; the message; the thread. ——— */

const SCENARIOS: ReadonlyArray<{ value: Scenario; label: string }> = [
  { value: 'short', label: 'Short' },
  { value: 'long', label: 'Long' },
  { value: 'two', label: 'Two links' },
  { value: 'agent', label: 'Agent’s link' },
]

type Screen = 'coordinator' | 'task'
const SCREENS: ReadonlyArray<{ value: Screen; label: string }> = [
  { value: 'coordinator', label: 'Coordinator' },
  { value: 'task', label: 'Task' },
]
const PLACES: Record<Screen, string> = { coordinator: '#/projects/p1?room=both', task: '#/threads/th1' }

const OPTIONS = DIRECTIONS.map((one, at) => ({ value: one.value, label: one.short, tooltip: { label: one.name, kbd: String(at + 1) } }))

const router = makeRouter({ client, cache })

/** Whether a key is meant for a field or a control of its own: pressed in a text box or a choice of options, or with a modifier (TaskView's `typing`). */
const typing = (event: KeyboardEvent) => {
  const target = event.target
  return (
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    (target instanceof HTMLElement &&
      (target.isContentEditable ||
        target.closest('input, textarea, select, [role="textbox"], [role="radiogroup"], [role="menu"]') !== null))
  )
}

// 1 to 9 pick a direction, ← and → step through them: never while typing.
window.addEventListener('keydown', (event) => {
  if (event.defaultPrevented || typing(event)) return
  const picked = /^[1-9]$/.test(event.key) ? DIRECTIONS[Number(event.key) - 1] : undefined
  if (picked !== undefined) proto.set({ direction: picked.value })
  else if (event.key === 'ArrowLeft') proto.step(-1)
  else if (event.key === 'ArrowRight') proto.step(1)
  else return
  event.preventDefault()
})

function Switcher() {
  const p = useProto()
  const screen: Screen = useRouterState({ router, select: (at) => (at.location.pathname.startsWith('/threads/') ? 'task' : 'coordinator') })
  const name = DIRECTIONS.find((one) => one.value === p.direction)?.name ?? ''
  useEffect(() => {
    document.title = `${p.direction === 'T' ? 'Today' : p.direction} · ${name}`
  }, [p.direction, name])
  if (p.bare) return null
  return (
    <div className={css.switcher}>
      <Segmented<Direction> label="Direction" value={p.direction} onChange={(direction) => proto.set({ direction })} options={OPTIONS} />
      <span className={css.keys}>1–6 · ← →</span>
      <span className={css.grow} />
      {(p.direction === 'B' || p.direction === 'C') && (
        <span className={css.toggle}>
          <Switch checked={p.keys} onChange={(keys) => proto.set({ keys })} labelledBy="keys-label" />
          <span id="keys-label">Show the address as its key</span>
        </span>
      )}
      <Segmented<Scenario>
        label="The person’s message"
        value={p.scenario}
        onChange={(scenario) => proto.set({ scenario })}
        options={SCENARIOS}
      />
      <Segmented<Screen> label="Thread" value={screen} onChange={(next) => window.location.assign(PLACES[next])} options={SCREENS} />
    </div>
  )
}

// The page opens on althar's tab, whatever an earlier visit kept, on the coordinator unless the URL says the task.
window.localStorage.removeItem('althar.tabs')
if (window.location.hash === '' || window.location.hash === '#/') window.location.hash = PLACES.coordinator
const element = document.getElementById('root')
if (element === null) throw new Error('The page has no #root')
proto.set({})
createRoot(element).render(
  <ServicesProvider value={services}>
    <div className={proto.get().bare ? css.bare : css.frame}>
      <RouterProvider router={router} />
    </div>
    <Switcher />
  </ServicesProvider>,
)
