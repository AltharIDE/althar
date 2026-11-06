// Scrappy: the real desktop app (router, tabs, project screen, board, task threads and settings) on the tests' fake client, as althar stands on 6 November.
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '../../src/styles/global.css'
import '../../../../apps/desktop/src/renderer/app.css'

import { Fragment } from 'react'
import { createRoot } from 'react-dom/client'

import { LinkButton } from '../../src/primitives/LinkButton/LinkButton'
import { Segmented } from '../../src/primitives/Segmented/Segmented'
import { type HomeTask, type ProjectSummary, RouterProvider } from './deps'

import { follow } from '../../../../apps/desktop/src/renderer/data/feed'
import { makeQueryClient } from '../../../../apps/desktop/src/renderer/data/reads'
import { ServicesProvider } from '../../../../apps/desktop/src/renderer/data/services'
import { makeRouter } from '../../../../apps/desktop/src/renderer/router'
import {
  coordinatorSnapshot,
  fakeClient,
  fakeHost,
  home,
  installedSkill,
  models,
  project,
  projectRules,
  repositories,
} from '../../../../apps/desktop/tests/fixtures'
import { coordinatorTalk } from './data'
import { boardOf, threadOf } from './runtime'
import s from './app.module.css'
import { type Direction, proto, SURFACES, type Surface, surfaceOf, useProto } from './state'

/* ——— What the fake runtime holds: althar, its tasks, its rules and skills. ——— */

const althar: ProjectSummary = {
  ...project,
  name: 'althar',
  slug: 'althar',
  ink: 'clay',
  repository: '/Users/balazs/Projects/charrette-project/althar',
  repositories: ['althar'],
  worktrees: '/Users/balazs/Althar/althar',
  running: 3,
  waiting: 1,
  working: 3,
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
  tasks: 5,
}

/** What the agents offer: Claude Code on Opus 5.5 and Sonnet 5.5, Codex on GPT-6.1 Sol. */
const agentModels = models.map((one) =>
  one.agentId === 'claude-code'
    ? {
        ...one,
        models: [
          { ...one.models[0]!, id: 'claude-opus-5-5', name: 'Opus 5.5', description: null },
          { ...one.models[0]!, id: 'claude-sonnet-5-5', name: 'Sonnet 5.5', description: null },
          { ...one.models[0]!, id: 'claude-haiku-5-5', name: 'Haiku 5.5', description: null },
        ],
        model: 'claude-opus-5-5',
      }
    : one.agentId === 'codex'
      ? { ...one, models: [{ ...one.models[0]!, id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', description: null }], model: 'gpt-6.1-sol' }
      : one,
)

const skill = (id: string, description: string) => ({ ...installedSkill, id, description })

const { client } = fakeClient({
  listProjects: async () => ({ cursor: 3, projects }),
  getRepositories: async () => [repository],
  getModels: async () => agentModels,
  getHome: async () =>
    home({ projects, tasks: boardOf().tasks.map((one): HomeTask => ({ ...one, projectId: 'p1' }) as unknown as HomeTask) }),
  getBoard: async () => boardOf(),
  getCoordinator: async () => coordinatorSnapshot({ project: { id: 'p1', name: 'althar' }, items: coordinatorTalk() }),
  getThread: async (threadId: string) => threadOf(threadId),
  getProjectRules: async () => ({ ...projectRules, conventions: [{ repository: 'althar', branch: null, title: null, template: null }] }),
  listSkills: async () => ({
    enabled: true,
    catalogRevision: null,
    skills: [
      skill('brainstorming', 'Use before building a new feature or change whose intent or design is not settled yet.'),
      skill('systematic-debugging', 'Use when a bug’s cause isn’t known yet.'),
      skill('frontend-design', 'Use when building or restyling an interface.'),
    ],
  }),
})

const host = fakeHost()
const cache = makeQueryClient()
const services = { client, host, cache, feed: follow(client, cache) }

// What the person did on the page reaches the screens as the runtime's news would: the board and threads read again.
let seen = proto.get()
proto.subscribe(() => {
  const now = proto.get()
  if (
    now.surface !== seen.surface ||
    now.answered !== seen.answered ||
    now.childHeld !== seen.childHeld ||
    now.off !== seen.off ||
    now.week !== seen.week
  )
    void cache.invalidateQueries()
  seen = now
})

/* ——— The switcher under the window: which surface, which direction, and where in the app. ——— */

const titled = () => {
  const p = proto.get()
  const surface = surfaceOf(p.surface)
  const direction = surface.directions.find((one) => one.value === p.direction)
  document.title = `${surface.name} · ${direction?.value === 'Today' ? 'Today' : `${p.direction} · ${direction?.name ?? ''}`}`
}

/** The surface and direction, kept for a reload; not in the address, whose search the app's router reads as its own. */
const remember = () => {
  const p = proto.get()
  window.sessionStorage.setItem('capable', JSON.stringify({ s: p.surface, d: p.direction }))
  titled()
}

/** The direction, as it is, or the surface's first where it has no such one. */
const fitting = (surface: Surface, direction: Direction): Direction => {
  const ones = surfaceOf(surface).directions
  return ones.some((one) => one.value === direction) ? direction : ones[0]!.value
}

const goSurface = (surface: Surface) => {
  const first = surfaceOf(surface).places[0]!
  proto.set({ surface, direction: fitting(surface, proto.get().direction), week: false, ...first.set })
  window.location.assign(first.hash)
  remember()
}

const goDirection = (direction: Direction) => {
  proto.set({ direction })
  remember()
}

/** Keys 1 to 6 pick a surface, A to C and T a direction, [ and ] step through them; never while typing, or inside a menu or dialog. */
const onKey = (event: KeyboardEvent) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return
  const target = event.target instanceof Element ? event.target : null
  if (target?.closest('input, textarea, select, [contenteditable], [role=menu], [role=dialog], [role=listbox], [role=textbox]')) return
  const p = proto.get()
  const ones = surfaceOf(p.surface).directions
  const at = ones.findIndex((one) => one.value === p.direction)
  const key = event.key.toLowerCase()
  if (/^[1-6]$/.test(key)) {
    event.preventDefault()
    goSurface(SURFACES[Number(key) - 1]!.value)
    return
  }
  const picked =
    key === ']'
      ? ones[(at + 1) % ones.length]
      : key === '['
        ? ones[(at - 1 + ones.length) % ones.length]
        : ones.find((one) => (one.value === 'Today' ? 't' : one.value.toLowerCase()) === key)
  if (picked === undefined) return
  event.preventDefault()
  goDirection(picked.value)
}

function Switcher() {
  const p = useProto()
  if (p.bare) return null
  const surface = surfaceOf(p.surface)
  return (
    <div className={s.strip}>
      <Segmented<Surface>
        label="Surface"
        value={p.surface}
        onChange={goSurface}
        options={SURFACES.map((one, at) => ({
          value: one.value,
          label: one.short ?? one.name,
          tooltip: { label: one.name, kbd: String(at + 1) },
        }))}
      />
      {surface.directions.length > 1 && (
        <Segmented<Direction>
          label="Direction"
          value={p.direction}
          onChange={goDirection}
          options={surface.directions.map((one) => ({
            value: one.value,
            label: one.value === 'Today' ? one.name : `${one.value} · ${one.name}`,
            tooltip: { label: one.about, kbd: one.value === 'Today' ? 'T' : one.value },
          }))}
        />
      )}
      <span className={s.gap} />
      {surface.places.map((place) => (
        <LinkButton
          key={place.label}
          onClick={() => {
            if (place.set !== undefined) proto.set(place.set)
            window.location.assign(place.hash)
          }}
        >
          {place.label}
        </LinkButton>
      ))}
      <LinkButton onClick={proto.startOver}>Start over</LinkButton>
      <span className={s.grow} />
      <span className={s.keys}>1–6 · A–C T · [ ]</span>
    </div>
  )
}

/** The app, opened again whenever the direction changes, so each draws its screens as it would. */
function App({ router }: { router: ReturnType<typeof makeRouter> }) {
  const p = useProto()
  return (
    <Fragment key={`${p.surface}-${p.direction}-${p.week}`}>
      <div className={p.bare ? s.bare : s.frame}>
        <RouterProvider router={router} />
      </div>
    </Fragment>
  )
}

/** Opens the app on the surface and direction the URL says, or the first, at the surface's first place. */
export const boot = () => {
  // ?s=rules&d=B opens on a surface and direction (&week: a week after sync was turned on), once: taken off the address, so the router doesn't read it.
  const params = new URLSearchParams(window.location.search)
  const kept = JSON.parse(window.sessionStorage.getItem('capable') ?? '{}') as { s?: string; d?: string }
  const surface = SURFACES.find((one) => one.value === (params.get('s') ?? kept.s))?.value ?? SURFACES[0]!.value
  const named = params.get('d') ?? kept.d ?? null
  const direction = fitting(surface, (named === 'Today' ? 'Today' : (named?.toUpperCase() ?? 'A')) as Direction)
  proto.set({ surface, direction, bare: params.has('bare'), week: params.has('week') })
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.hash}`)
  remember()
  window.localStorage.removeItem('althar.tabs')
  if (window.location.hash === '' || window.location.hash === '#/') window.location.hash = surfaceOf(surface).places[0]!.hash
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
