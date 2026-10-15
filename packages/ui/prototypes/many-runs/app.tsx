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
import { SCRIPTS } from './scripts'
import { type Direction, type Goes, type Opening, proto, type Run, type Scenario, TASK, useProto } from './state'

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
    runnableId: run.runnableId,
    url: run.url,
    startedAt: iso(run.startedAt),
    ended: run.endedAt === null ? null : { at: iso(run.endedAt), code: run.code },
    taskId: run.place === 'task' ? 't1' : null,
    where: run.place === 'task' ? TASK.title : 'main',
  }
}

// The conversations, made once: read again, they keep their ids, so the thread doesn't take them for new ones.
const coordinatorItems = [
  items.you('Can you plan a task to make the Download button on the site offer the installer for the visitor’s computer?'),
  items.tool({ title: 'Read apps/site/src/Download.tsx' }),
  items.says('The button links to the releases page whatever the computer. I planned a task to pick the .dmg, the AppImage or the .exe.'),
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
]
const threadItems = [
  items.you('Make the Download button offer the installer for the visitor’s computer: the .dmg on a Mac, the AppImage on Linux.'),
  items.tool({ title: 'Read apps/site/src/Download.tsx' }),
  items.says(
    'The button always links to the releases page. I’ll read the platform from the browser and pick the asset, with the page as the fallback.',
  ),
  items.tool({ title: 'Edit apps/site/src/Download.tsx' }),
]

/** What the project runs, as the runtime hands it on (ADR-042): in its order, the first its default. */
const runnablesOf = () => {
  const { runnables, defaultId } = proto.get()
  const first = runnables.find((one) => one.id === defaultId)
  return [...(first === undefined ? [] : [first]), ...runnables.filter((one) => one !== first)].map((one) => ({
    id: one.id,
    name: one.name ?? null,
    command: one.command,
    repository: 'althar',
    own: one.source === 'repository',
    from: one.source,
  }))
}

/** How a run of a command goes, in the page: what serves on which port, what opens a window, what finishes. */
const goesOf = (command: string): Goes =>
  /storybook/.test(command)
    ? { kind: 'serves', port: 6006 }
    : /preview/.test(command)
      ? { kind: 'serves', port: 4290 }
      : /site/.test(command)
        ? { kind: 'serves', port: 5320 }
        : /desktop.* dev/.test(command)
          ? { kind: 'window' }
          : /\bdev\b/.test(command)
            ? { kind: 'serves', port: 5290 }
            : { kind: 'finishes' }

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
      runnables: runnablesOf(),
      launches: proto.get().runs.map(launchOf),
      items: coordinatorItems,
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
        runnables: runnablesOf(),
        launches: proto
          .get()
          .runs.filter((one) => one.place === 'task')
          .map(launchOf),
      },
      items: threadItems,
    }),
  runProject: async (_projectId: string, taskId: string | null, _threadId: string | null, runnableId?: string) => {
    const id = runnableId ?? runnablesOf()[0]?.id
    if (id !== undefined) proto.run(id, taskId === null ? 'main' : 'task')
    return launchOf(proto.get().runs[0]!)
  },
  stopLaunch: async (id: string) => proto.stop(id),
  clearLaunch: async (id: string) => proto.clear(id),
  keepRunnable: async ({ id, name, command }) => {
    const was = proto.get().runnables.find((one) => one.id === id)
    if (was !== undefined) {
      proto.edit(was.id, { name: name ?? undefined, command: command ?? was.command })
      return { id: was.id }
    }
    const kept = command ?? 'bun run dev'
    return { id: proto.add({ ...(name === null ? {} : { name }), command: kept, where: 'here', source: 'person', goes: goesOf(kept) }) }
  },
  dropRunnable: async (_projectId: string, id: string) => proto.remove(id),
  orderRunnables: async (_projectId: string, ids: ReadonlyArray<string>) => proto.order(ids),
  getRepositoryScripts: async () =>
    SCRIPTS.map((one) => ({ repository: 'althar', package: one.pkg, name: one.name, body: one.body, command: one.command })),
})

const host = fakeHost()
const cache = makeQueryClient()
const services = { client, host, cache, feed: follow(client, cache) }

// What runs changed: the screens read their runs again, as they would on the runtime's word; a switch of direction reads nothing.
let read = { runs: proto.get().runs, runnables: proto.get().runnables, defaultId: proto.get().defaultId }
proto.subscribe(() => {
  const { runs, runnables, defaultId } = proto.get()
  if (runs === read.runs && runnables === read.runnables && defaultId === read.defaultId) return
  read = { runs, runnables, defaultId }
  void cache.invalidateQueries({ queryKey: ['coordinator'] })
  void cache.invalidateQueries({ queryKey: ['thread'] })
})

/* ——— The switcher under the window: which direction, which state, which screen; the URL keeps them. ——— */

/** The directions in the switcher's order, each with its key: 1 to 6. */
const DIRECTIONS: ReadonlyArray<{ value: Direction; name: string }> = [
  { value: 'A', name: 'Split button' },
  { value: 'B', name: 'Runs panel' },
  { value: 'C', name: 'Chips' },
  { value: 'D', name: 'Launcher' },
  { value: 'E', name: 'Dock' },
  { value: 'Today', name: 'A as built' },
]

/** The states, with the words the URL uses for them. */
const SCENARIOS: ReadonlyArray<{ value: Scenario; url: string; label: string }> = [
  { value: 'empty', url: 'nothing-yet', label: 'Nothing yet' },
  { value: 'one', url: 'one', label: 'One' },
  { value: 'many', url: 'many', label: 'Many' },
  { value: 'busy', url: 'several-running', label: 'Several running' },
]

const directionOf = (word: string | null): Direction | undefined =>
  DIRECTIONS.find((one) => one.value.toLowerCase() === word?.toLowerCase())?.value
const scenarioOf = (word: string | null): Scenario | undefined => SCENARIOS.find((one) => one.url === word || one.value === word)?.value
const nameOf = (direction: Direction) => DIRECTIONS.find((one) => one.value === direction)?.name ?? direction

const titled = (direction: Direction) => {
  document.title = `${direction === 'Today' ? nameOf(direction) : `${direction} · ${nameOf(direction)}`} · Many things to run`
}

/** Swaps the direction in place: the same screen, the same state. */
const go = (direction: Direction) => {
  proto.set({ direction, opening: null })
  titled(direction)
}

// The URL says what the page shows, so a link opens it again: ?d=B&s=several-running, the screen after the #.
let said = ''
proto.subscribe(() => {
  const { direction, scenario } = proto.get()
  const now = `${direction}/${scenario}`
  if (now === said) return
  said = now
  const params = new URLSearchParams(window.location.search)
  params.set('d', direction)
  params.set('s', SCENARIOS.find((one) => one.value === scenario)?.url ?? scenario)
  window.history.replaceState(window.history.state, '', `${window.location.pathname}?${params.toString()}${window.location.hash}`)
})

/** Keys 1 to 6 pick a direction, ← and → step through them; never while typing, or inside a menu, dialog or list. */
const onKey = (event: KeyboardEvent) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return
  const target = event.target instanceof Element ? event.target : null
  if (target?.closest('input, textarea, select, [contenteditable], [role=menu], [role=dialog], [role=listbox]')) return
  // A switch of the page's own takes the arrows; the digits still pick a direction from it.
  if (event.key.startsWith('Arrow') && target?.closest('[role=radiogroup]')) return
  const at = DIRECTIONS.findIndex((one) => one.value === proto.get().direction)
  const picked =
    event.key === 'ArrowRight'
      ? DIRECTIONS[(at + 1) % DIRECTIONS.length]
      : event.key === 'ArrowLeft'
        ? DIRECTIONS[(at - 1 + DIRECTIONS.length) % DIRECTIONS.length]
        : /^[1-9]$/.test(event.key)
          ? DIRECTIONS[Number(event.key) - 1]
          : undefined
  if (picked === undefined) return
  event.preventDefault()
  go(picked.value)
}

function Switcher() {
  const p = useProto()
  if (p.bare) return null
  return (
    <div className={css.strip}>
      <Segmented<Direction>
        label="Direction"
        value={p.direction}
        onChange={go}
        options={DIRECTIONS.map((one, at) => ({
          value: one.value,
          label: one.value === 'Today' ? one.name : `${one.value} · ${one.name}`,
          tooltip: {
            label: one.value === 'Today' ? 'The split Run button as built, the real one, on this page’s data' : one.name,
            kbd: String(at + 1),
          },
        }))}
      />
      <Segmented<Scenario>
        label="What the project knows to run"
        value={p.scenario}
        onChange={(scenario) => proto.scenario(scenario)}
        options={SCENARIOS.map(({ value, label: words }) => ({ value, label: words }))}
      />
      <LinkButton onClick={() => window.location.assign('#/projects/p1?room=both')}>Project</LinkButton>
      <LinkButton onClick={() => window.location.assign('#/threads/th1')}>Task</LinkButton>
      <span className={css.grow} />
      <span>1–6 or ← → switch</span>
      <LinkButton onClick={() => window.location.assign('./compare.html')}>Screenshots</LinkButton>
    </div>
  )
}

/** Opens the app on the direction and state the URL says, or the page's own. */
export const boot = (direction: Direction = 'A') => {
  const params = new URLSearchParams(window.location.search)
  const shown = directionOf(params.get('d')) ?? direction
  proto.set({ direction: shown, opening: (params.get('open') as Opening | null) ?? null, bare: params.has('bare') })
  proto.scenario(scenarioOf(params.get('s')) ?? 'many')
  titled(shown)
  // Every page opens on althar's tab, whatever another page kept.
  window.localStorage.removeItem('althar.tabs')
  if (window.location.hash === '' || window.location.hash === '#/') window.location.hash = '#/projects/p1?room=both'
  if (!params.has('bare')) window.addEventListener('keydown', onKey)
  const router = makeRouter({ client, cache })
  const element = document.getElementById('root')
  if (element === null) throw new Error('The page has no #root')
  createRoot(element).render(
    <ServicesProvider value={services}>
      <div className={params.has('bare') ? css.bare : css.frame}>
        <RouterProvider router={router} />
      </div>
      <Switcher />
    </ServicesProvider>,
  )
}
