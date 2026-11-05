// Scrappy: the real desktop app (its router, tabs, board and task screens) on the tests' fake client, with two of this repository's tasks.
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '../../src/styles/global.css'
import '../../../../apps/desktop/src/renderer/app.css'

import { Fragment } from 'react'
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
  coordinatorSnapshot,
  fakeClient,
  fakeHost,
  home,
  models,
  project,
  repositories,
} from '../../../../apps/desktop/tests/fixtures'
import { type TaskKey, TASKS } from './data'
import { findingsOf, snapshotOf } from './snapshots'
import s from './app.module.css'
import { type Direction, DIRECTIONS, proto, useProto } from './state'

/* ——— What the fake runtime holds: althar, its two tasks. ——— */

const althar: ProjectSummary = {
  ...project,
  name: 'althar',
  slug: 'althar',
  ink: 'clay',
  repository: '/Users/balazs/Projects/charrette-project/althar',
  repositories: ['althar'],
  worktrees: '/Users/balazs/Althar/althar',
  running: 1,
  waiting: 1,
  working: 1,
  ready: 1,
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
  tasks: 2,
}

const boardTask = (key: TaskKey): BoardTask => {
  const snap = snapshotOf(TASKS[key].threadId)!
  return {
    ...card(),
    taskId: snap.task.id,
    threadId: snap.threadId,
    title: snap.task.title,
    slug: snap.task.slug,
    branch: snap.task.branch ?? '',
    phase: snap.task.phase as BoardTask['phase'],
    step: snap.task.step as BoardTask['step'],
    state: 'open',
    createdAt: snap.task.startedAt ?? '',
    startedAt: snap.task.startedAt,
    settledAt: null,
    changed: null,
    here: [],
    change: snap.task.changes.at(-1) ?? null,
  } as BoardTask
}
const tasks: BoardTask[] = [boardTask('long'), boardTask('short')]

/** What the agents offer, as their lists say: the lead on Opus 5.5, the reviewer on GPT-6.1 Sol. */
const agentModels = models.map((one) =>
  one.agentId === 'claude-code'
    ? {
        ...one,
        models: [{ ...one.models[0]!, id: 'claude-opus-5-5', name: 'Opus 5.5', description: null }],
        model: 'claude-opus-5-5',
      }
    : one.agentId === 'codex'
      ? { ...one, models: [{ ...one.models[0]!, id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', description: null }], model: 'gpt-6.1-sol' }
      : one,
)

const { client } = fakeClient({
  listProjects: async () => ({ cursor: 3, projects }),
  getRepositories: async () => [repository],
  getModels: async () => agentModels,
  getHome: async () => home({ projects, tasks: tasks.map((one): HomeTask => ({ ...one, projectId: 'p1' }) as HomeTask) }),
  getBoard: async () => ({ cursor: 1, tasks, calls: [], settledTotal: 41 }),
  getCoordinator: async () => coordinatorSnapshot({ project: { id: 'p1', name: 'althar' } }),
  getThread: async (threadId: string) => snapshotOf(threadId) ?? snapshotOf(TASKS.long.threadId)!,
  getTaskFindings: async (taskId: string) => ({ findings: [...findingsOf(taskId)], review: null }),
})

const host = fakeHost()
const cache = makeQueryClient()
const services = { client, host, cache, feed: follow(client, cache) }

/* ——— The switcher under the window: which direction, which task; the URL keeps them. ——— */

const titled = (direction: Direction) => {
  const one = DIRECTIONS.find((each) => each.value === direction)
  document.title = `${direction === 'Today' ? 'Today' : `${direction} · ${one?.name ?? ''}`} · A thread that leads with the handoff`
}

/** Swaps the direction in place: the same task, opened again as that direction opens it. */
const go = (direction: Direction) => {
  proto.set({ direction })
  titled(direction)
  const params = new URLSearchParams(window.location.search)
  params.set('d', direction)
  window.history.replaceState(window.history.state, '', `${window.location.pathname}?${params.toString()}${window.location.hash}`)
}

/** Keys 1 to 6 pick a take, [ and ] step through them; never while typing, or inside a menu, dialog or list. */
const onKey = (event: KeyboardEvent) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return
  const target = event.target instanceof Element ? event.target : null
  if (target?.closest('input, textarea, select, [contenteditable], [role=menu], [role=dialog], [role=listbox]')) return
  const at = DIRECTIONS.findIndex((one) => one.value === proto.get().direction)
  const picked =
    event.key === ']'
      ? DIRECTIONS[(at + 1) % DIRECTIONS.length]
      : event.key === '['
        ? DIRECTIONS[(at - 1 + DIRECTIONS.length) % DIRECTIONS.length]
        : /^[1-6]$/.test(event.key)
          ? DIRECTIONS[Number(event.key) - 1]
          : undefined
  if (picked === undefined) return
  event.preventDefault()
  go(picked.value)
}

const open = (key: TaskKey) => window.location.assign(`#/threads/${TASKS[key].threadId}`)

function Switcher() {
  const p = useProto()
  if (p.bare) return null
  return (
    <div className={s.strip}>
      <Segmented<Direction>
        label="Take"
        value={p.direction}
        onChange={go}
        options={DIRECTIONS.map((one, at) => ({
          value: one.value,
          label: one.value === 'Today' ? one.name : `${one.value} · ${one.name}`,
          tooltip: { label: one.about, kbd: String(at + 1) },
        }))}
      />
      <span className={s.gap} />
      <LinkButton onClick={() => open('long')}>Long task</LinkButton>
      <LinkButton onClick={() => open('short')}>Short task</LinkButton>
      <LinkButton onClick={() => window.location.assign('#/projects/p1?room=both')}>Board</LinkButton>
      <span className={s.grow} />
      <span>1–6 or [ ] switch</span>
    </div>
  )
}

/** The app, opened again whenever the direction changes, so each opens the task as it would. */
function App({ router }: { router: ReturnType<typeof makeRouter> }) {
  const p = useProto()
  return (
    <Fragment key={p.direction}>
      <div className={p.bare ? s.bare : s.frame}>
        <RouterProvider router={router} />
      </div>
    </Fragment>
  )
}

/** Opens the app on the take and task the URL says, or B on the long task. */
export const boot = () => {
  const params = new URLSearchParams(window.location.search)
  const shown = DIRECTIONS.find((one) => one.value.toLowerCase() === params.get('d')?.toLowerCase())?.value ?? 'B'
  const review = /^r(\d+)$/.exec(params.get('open') ?? '')?.[1]
  proto.set({
    direction: shown,
    bare: params.has('bare'),
    opening: {
      review: review === undefined ? null : Number(review) - 1,
      top: params.get('scroll') === 'top',
    },
  })
  // Opened at the thread's start, for a screenshot of it scrolled back: once the thread has followed its end.
  if (params.get('scroll') === 'top')
    for (const ms of [500, 900])
      window.setTimeout(() => {
        const thread = document.querySelector('section[aria-label="Thread"]')
        for (let box = thread?.parentElement ?? null; box !== null; box = box.parentElement)
          if (getComputedStyle(box).overflowY === 'auto' || getComputedStyle(box).overflowY === 'scroll') {
            box.scrollTop = 0
            break
          }
      }, ms)
  titled(shown)
  window.localStorage.removeItem('althar.tabs')
  if (window.location.hash === '' || window.location.hash === '#/') window.location.hash = `#/threads/${TASKS.long.threadId}`
  if (!params.has('bare')) window.addEventListener('keydown', onKey)
  const router = makeRouter({ client, cache })
  const element = document.getElementById('root')
  if (element === null) throw new Error('The page has no #root')
  createRoot(element).render(
    <ServicesProvider value={services}>
      <App router={router} />
      <Switcher />
    </ServicesProvider>,
  )
}
