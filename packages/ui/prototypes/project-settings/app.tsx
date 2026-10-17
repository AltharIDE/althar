// Scrappy: the real desktop app (its router, tabs, project screen and Settings tab) on the tests' fake client, with althar's own repository, tracker and notes.
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '../../src/styles/global.css'
import '../../../../apps/desktop/src/renderer/app.css'

import { createRoot } from 'react-dom/client'

import { Segmented } from '../../src/primitives/Segmented/Segmented'
import { connectionsOf, data, notesOf, projectsOf, repositoryOf, tasksOf } from './data'
import { createBrowserHistory, type HomeTask, RouterProvider } from './deps'
import { Overlays } from './parts'
import css from './parts.module.css'
import { type Connection, type Direction, type Notes, proto, type Section, SECTIONS, type Showing, type Tracker, useProto } from './state'

import { follow } from '../../../../apps/desktop/src/renderer/data/feed'
import { makeQueryClient } from '../../../../apps/desktop/src/renderer/data/reads'
import { ServicesProvider } from '../../../../apps/desktop/src/renderer/data/services'
import { makeRouter } from '../../../../apps/desktop/src/renderer/router'
import { coordinatorSnapshot, fakeClient, fakeHost, home, items } from '../../../../apps/desktop/tests/fixtures'

/* ——— The fake runtime: what it says follows the picker and what was changed on the page. ——— */

const coordinatorItems = [
  items.you('Our settings look really ugly at the project level. Can you plan a prototype of a few directions?'),
  items.tool({ title: 'Read apps/desktop/src/renderer/features/project/ProjectSettings.tsx' }),
  items.says(
    'Today they’re a Control Center panel whose modules move about with what the project has, and its rules open on a screen of their own. I planned a prototype: Home, Conversation and Board in the bar, then Settings as a view of its own, in four layouts.',
  ),
]

const { client } = fakeClient({
  listProjects: async () => ({ cursor: 3, projects: projectsOf() }),
  getRepositories: async () => [repositoryOf(proto.get().connection)],
  getHome: async () =>
    home({
      projects: projectsOf(),
      tasks: tasksOf(proto.get().tracker)
        .filter((one) => one.phase !== 'planned')
        .map((one): HomeTask => ({ ...one, projectId: 'p1' })),
    }),
  getBoard: async () => ({ cursor: 1, tasks: tasksOf(proto.get().tracker), calls: [], settledTotal: 214 }),
  getCoordinator: async () =>
    coordinatorSnapshot({
      project: { id: 'p1', name: data.get().name },
      host: { product: 'github', name: 'GitHub', webUrl: 'https://github.com', connected: proto.get().connection !== 'host' },
      runnables: data.get().runnables,
      items: coordinatorItems,
    }),
  listConnections: async () => connectionsOf(proto.get().connection),
  getProjectRules: async () => data.get().rules,
  setProjectRules: async (change) => {
    data.set({ rules: { ...data.get().rules, ...change, projectId: 'p1' } })
    return data.get().rules
  },
  getProjectNotes: async () => notesOf(proto.get().notes),
  dropProjectNote: async (_projectId: string, noteId: string) => data.set({ dropped: new Set([...data.get().dropped, noteId]) }),
  renameProject: async (_projectId: string, name: string) => data.set({ name }),
  setProjectInk: async (_projectId: string, ink) => data.set({ ink }),
  removeProject: async () => undefined,
  getRepositoryScripts: async () => [],
})

const host = fakeHost()
const cache = makeQueryClient()
const services = { client, host, cache, feed: follow(client, cache) }

// What the picker or the page changed: the screens read again, as they would on the runtime's word.
let read = { tracker: proto.get().tracker, connection: proto.get().connection, notes: proto.get().notes }
proto.subscribe(() => {
  const { tracker, connection, notes } = proto.get()
  if (tracker === read.tracker && connection === read.connection && notes === read.notes) return
  read = { tracker, connection, notes }
  void cache.invalidateQueries()
})
data.subscribe(() => {
  void cache.invalidateQueries({ queryKey: ['projects'] })
  void cache.invalidateQueries({ queryKey: ['notes'] })
  void cache.invalidateQueries({ queryKey: ['coordinator'] })
})

/* ——— The switcher under the window: which direction, and the project's state; the URL keeps them. ——— */

const DIRECTIONS: ReadonlyArray<{ value: Direction; name: string; about: string }> = [
  { value: 'Today', name: 'Today', about: 'The project’s settings as built: a Control Center from the front page’s Settings button' },
  {
    value: 'A',
    name: 'As the app’s',
    about: 'Settings in the bar; laid out as the app’s Settings tab: switches and sections down the side, one on a sheet',
  },
  {
    value: 'B',
    name: 'Tabs',
    about: 'Settings in the bar; the project’s name and switches on top, its sections as tabs, the open one page-wide',
  },
  {
    value: 'C',
    name: 'One page',
    about: 'Settings in the bar; every section on one page, labelled down the left as the rules are, a jump bar held on top',
  },
  {
    value: 'D',
    name: 'Overview',
    about: 'Settings in the bar; a card per section saying what it holds now, each opening a page of its own',
  },
]

const TRACKERS: ReadonlyArray<{ value: Tracker; label: string }> = [
  { value: 'linear', label: 'Linear, found' },
  { value: 'two', label: 'Linear + Jira' },
  { value: 'none', label: 'No tracker' },
]
const CONNECTIONS: ReadonlyArray<{ value: Connection; label: string }> = [
  { value: 'ok', label: 'Connected' },
  { value: 'tracker', label: 'Linear not connected' },
  { value: 'host', label: 'GitHub signed out' },
]
const NOTES: ReadonlyArray<{ value: Notes; label: string }> = [
  { value: 'few', label: '2 notes' },
  { value: 'many', label: '9 notes' },
]
const SHOWING: ReadonlyArray<{ value: Showing; label: string }> = [
  { value: 'closed', label: 'Closed' },
  { value: 'open', label: 'Open' },
  { value: 'notes', label: 'Notes open' },
]
const SECTION_WORDS: ReadonlyArray<{ value: Section | 'overview' }> = [...SECTIONS.map((value) => ({ value })), { value: 'overview' }]

const directionOf = (word: string | null) => DIRECTIONS.find((one) => one.value.toLowerCase() === word?.toLowerCase())?.value
const pick = <V extends string>(list: ReadonlyArray<{ value: V }>, word: string | null) => list.find((one) => one.value === word)?.value

const titled = (direction: Direction) => {
  const one = DIRECTIONS.find((each) => each.value === direction)
  document.title = `${direction === 'Today' ? 'Today' : `${direction} · ${one?.name ?? ''}`} · Project settings`
}

// The URL says what the page shows, so a link opens it again: ?d=B&tracker=none&conn=tracker&notes=many&open=notes.
proto.subscribe(() => {
  const { direction, tracker, connection, notes, showing, section } = proto.get()
  const params = new URLSearchParams(window.location.search)
  params.set('d', direction)
  params.set('tracker', tracker)
  params.set('conn', connection)
  params.set('notes', notes)
  params.set('open', showing)
  if (direction === 'Today' || showing === 'closed') params.delete('s')
  else params.set('s', section ?? 'overview')
  const next = `${window.location.pathname}?${params.toString()}${window.location.hash}`
  if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`)
    window.history.replaceState(window.history.state, '', next)
  titled(direction)
})

/** Another direction, on the same screen and state; back on the project, as each puts its settings there. */
const go = (direction: Direction) => {
  proto.set({ direction })
  if (!window.location.hash.startsWith('#/projects/p1')) window.location.hash = '#/projects/p1'
}

/** Keys 1 to 5 pick a direction, ← and → step through them; never while typing, or inside a menu, dialog or list. */
const onKey = (event: KeyboardEvent) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return
  const target = event.target instanceof Element ? event.target : null
  if (target?.closest('input, textarea, select, [contenteditable], [role=menu], [role=dialog], [role=listbox]')) return
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
  event.stopPropagation()
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
          tooltip: { label: one.about, kbd: String(at + 1) },
        }))}
      />
      <span className={css.grow} />
      <Segmented<Tracker> label="Tracker" value={p.tracker} onChange={(tracker) => proto.set({ tracker })} options={TRACKERS} />
      <Segmented<Connection>
        label="Connections"
        value={p.connection}
        onChange={(connection) => proto.set({ connection })}
        options={CONNECTIONS}
      />
      <Segmented<Notes> label="Notes" value={p.notes} onChange={(notes) => proto.set({ notes })} options={NOTES} />
      <Segmented<Showing>
        label="Settings"
        value={p.direction !== 'Today' && p.showing !== 'closed' && p.section === 'notes' ? 'notes' : p.showing}
        onChange={(showing) =>
          // In A to D, Notes open is their Settings at Notes; Open, at the start.
          p.direction === 'Today'
            ? proto.set({ showing })
            : proto.set({
                showing: showing === 'closed' ? 'closed' : 'open',
                section: showing === 'notes' ? 'notes' : p.direction === 'D' ? null : 'general',
              })
        }
        options={SHOWING}
      />
    </div>
  )
}

type Location = ReturnType<NonNullable<NonNullable<Parameters<typeof createBrowserHistory>[0]>['parseLocation']>>

/** The app's location, from the hash alone: its own hash history would read the page's query into every route's search. */
const locationOf = (): Location => {
  const href = window.location.hash.replace(/^#/, '') || '/'
  const at = href.indexOf('?')
  return {
    href,
    pathname: at === -1 ? href : href.slice(0, at),
    search: at === -1 ? '' : href.slice(at),
    hash: '',
    state: window.history.state ?? { __TSR_index: 0, key: 'first', __TSR_key: 'first' },
  } as Location
}

const history = createBrowserHistory({
  parseLocation: locationOf,
  createHref: (path: string) => `${window.location.pathname}${window.location.search}#${path}`,
})

/** Opens the app on the direction and state the URL says. */
export const boot = () => {
  const params = new URLSearchParams(window.location.search)
  proto.set({
    direction: directionOf(params.get('d')) ?? 'A',
    tracker: pick(TRACKERS, params.get('tracker')) ?? 'linear',
    connection: pick(CONNECTIONS, params.get('conn')) ?? 'ok',
    notes: pick(NOTES, params.get('notes')) ?? 'many',
    showing: pick(SHOWING, params.get('open')) ?? 'closed',
    section: (() => {
      const word = pick(SECTION_WORDS, params.get('s'))
      const direction = directionOf(params.get('d')) ?? 'A'
      if (direction !== 'Today' && params.get('open') === 'notes') return 'notes'
      return word === undefined ? (direction === 'D' ? null : 'general') : word === 'overview' ? null : word
    })(),
    bare: params.has('bare'),
  })
  // Every page opens on althar's tab, whatever another page kept.
  window.localStorage.removeItem('althar.tabs')
  if (window.location.hash === '' || window.location.hash === '#/') window.location.hash = '#/projects/p1?room=both'
  if (!params.has('bare')) window.addEventListener('keydown', onKey, true)
  const router = makeRouter({ client, cache }, history)
  const element = document.getElementById('root')
  if (element === null) throw new Error('The page has no #root')
  createRoot(element).render(
    <ServicesProvider value={services}>
      <div className={params.has('bare') ? css.bare : css.frame}>
        <RouterProvider router={router} />
      </div>
      <Overlays />
      <Switcher />
    </ServicesProvider>,
  )
}
