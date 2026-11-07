// Scrappy: the real desktop app (its router, tabs, project screen, board and settings) on the tests' fake client, opened on althar's coordinator.
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
  snapshot,
} from '../../../../apps/desktop/tests/fixtures'
import { clearingCard, gitlabCard, TASKS } from './data'
import s from './app.module.css'
import { type Direction, DIRECTIONS, proto, useProto } from './state'

/* ——— What the fake runtime holds: althar, its tasks, its notes. ——— */

const althar: ProjectSummary = {
  ...project,
  name: 'althar',
  slug: 'althar',
  ink: 'clay',
  repository: '/Users/balazs/Projects/charrette-project/althar',
  repositories: ['althar'],
  worktrees: '/Users/balazs/Althar/althar',
  running: 1,
  waiting: 0,
  working: 1,
  ready: 0,
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

const minutes = (n: number) => new Date(Date.now() - n * 60_000).toISOString()

const boardTask = (content: ReturnType<typeof card>, at: number): BoardTask =>
  ({
    ...content,
    state: 'open',
    createdAt: minutes(at),
    settledAt: content.phase === 'settled' ? minutes(at - 60) : null,
    changed: null,
    here: [],
  }) as unknown as BoardTask

const tasks: BoardTask[] = [
  boardTask(gitlabCard(), 188),
  boardTask(clearingCard(), 24),
  boardTask(card({ ...TASKS.flatpak, phase: 'settled', plan: null, step: null, lead: 'claude-code', leadModel: 'claude-opus-5-5' }), 600),
]

/** What the agents offer, as their lists say: the coordinator on Opus 5.5, the reviewer on GPT-6.1 Sol. */
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

const notes = [
  {
    id: 'note-prototypes',
    body: 'Prototypes use the real UI kit and real screens, on one live local page with an in-view A/B/C switcher bar.',
    keptBy: 'coordinator' as const,
    createdAt: minutes(60 * 24 * 20),
  },
  {
    id: 'note-copy',
    body: 'UI copy never narrates what’s plainly happening on screen; keep only lines that tell the person something they need.',
    keptBy: 'coordinator' as const,
    createdAt: minutes(60 * 24 * 10),
  },
  {
    id: 'note-links',
    body: 'The coordinator writes every web address it gives the person as a clickable link.',
    keptBy: 'coordinator' as const,
    createdAt: minutes(60 * 24 * 7),
  },
]

const { client } = fakeClient({
  listProjects: async () => ({ cursor: 3, projects }),
  getRepositories: async () => [repository],
  getModels: async () => agentModels,
  getHome: async () => home({ projects, tasks: tasks.map((one): HomeTask => ({ ...one, projectId: 'p1' }) as unknown as HomeTask) }),
  getBoard: async () => ({ cursor: 1, tasks, calls: [], settledTotal: 41 }),
  // The thread's items and session are the page's (seams/useProject.ts); the rest is the coordinator's head.
  getCoordinator: async () => coordinatorSnapshot({ project: { id: 'p1', name: 'althar' } }),
  getThread: async (threadId: string) => snapshot({ threadId }),
  getProjectNotes: async () => notes,
})

const host = fakeHost()
const cache = makeQueryClient()
const services = { client, host, cache, feed: follow(client, cache) }

/* ——— The switcher under the window: which direction, and where in the project; the URL keeps the direction. ——— */

const titled = (direction: Direction) => {
  const one = DIRECTIONS.find((each) => each.value === direction)
  document.title = `${direction === 'Today' ? 'Today' : `${direction} · ${one?.name ?? ''}`} · Clearing a coordinator chat`
}

/** Swaps the direction in place: the project opened again as that direction has it, its conversation as that direction left it. */
const go = (direction: Direction) => {
  proto.set({ direction })
  titled(direction)
  const params = new URLSearchParams(window.location.search)
  params.set('d', direction)
  window.history.replaceState(window.history.state, '', `${window.location.pathname}?${params.toString()}${window.location.hash}`)
}

/** Keys 1 to 4 pick a direction, [ and ] step through them; never while typing, or inside a menu, dialog or list. */
const onKey = (event: KeyboardEvent) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return
  const target = event.target instanceof Element ? event.target : null
  if (target?.closest('input, textarea, select, [contenteditable], [role=menu], [role=dialog], [role=listbox], [role=textbox]')) return
  const at = DIRECTIONS.findIndex((one) => one.value === proto.get().direction)
  const picked =
    event.key === ']'
      ? DIRECTIONS[(at + 1) % DIRECTIONS.length]
      : event.key === '['
        ? DIRECTIONS[(at - 1 + DIRECTIONS.length) % DIRECTIONS.length]
        : /^[1-4]$/.test(event.key)
          ? DIRECTIONS[Number(event.key) - 1]
          : undefined
  if (picked === undefined) return
  event.preventDefault()
  go(picked.value)
}

const open = (hash: string) => window.location.assign(hash)

function Switcher() {
  const p = useProto()
  if (p.bare) return null
  return (
    <div className={s.strip}>
      <Segmented<Direction>
        label="Direction"
        value={p.direction}
        onChange={go}
        options={DIRECTIONS.map((one, at) => ({
          value: one.value,
          label: one.value === 'Today' ? one.name : `${one.value} · ${one.name}`,
          tooltip: { label: one.about, kbd: String(at + 1) },
        }))}
      />
      <span className={s.gap} />
      <LinkButton onClick={() => open('#/projects/p1?room=both')}>Conversation</LinkButton>
      <LinkButton onClick={proto.startOver}>Start over</LinkButton>
      <span className={s.grow} />
      <span>1–4 or [ ] switch</span>
    </div>
  )
}

/** The app, opened again whenever the direction changes, so each draws the project as it would. */
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

/** Opens the app on the direction the URL says, or A, on althar's conversation beside its board. */
export const boot = () => {
  const params = new URLSearchParams(window.location.search)
  const shown = DIRECTIONS.find((one) => one.value.toLowerCase() === params.get('d')?.toLowerCase())?.value ?? 'A'
  proto.set({ direction: shown, bare: params.has('bare') })
  titled(shown)
  window.localStorage.removeItem('althar.tabs')
  if (window.location.hash === '' || window.location.hash === '#/') window.location.hash = '#/projects/p1?room=both'
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
