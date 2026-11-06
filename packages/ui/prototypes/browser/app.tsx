// Scrappy: the real desktop app (its router, tabs, project and task screens) on the tests' fake client, with a browser of Althar's own drawn
// three ways (and a fourth), switched in place by the strip under the window.
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '../../src/styles/global.css'
import '../../../../apps/desktop/src/renderer/app.css'
import './parts/icons'

import { Fragment } from 'react'
import { createRoot } from 'react-dom/client'

import { commandDown } from '../../src/foundations/keys'
import { LinkButton } from '../../src/primitives/LinkButton/LinkButton'
import { Segmented } from '../../src/primitives/Segmented/Segmented'
import { type HomeTask, RouterProvider } from './deps'

import { follow } from '../../../../apps/desktop/src/renderer/data/feed'
import { makeQueryClient } from '../../../../apps/desktop/src/renderer/data/reads'
import { ServicesProvider } from '../../../../apps/desktop/src/renderer/data/services'
import { makeRouter } from '../../../../apps/desktop/src/renderer/router'
import { change, coordinatorSnapshot, fakeClient, fakeHost, home, models, snapshot } from '../../../../apps/desktop/tests/fixtures'
import { RUNS } from './addresses'
import s from './app.module.css'
import { althar, coordinatorItems, launchOf, OTHER, REQUEST, repository, runnables, TASK, tasks, threadItems } from './data'
import { type Destination, type Direction, DIRECTIONS, proto, sideScope, threadHere, useProto } from './state'

/* ——— What the fake runtime holds. ——— */

const projects = [althar]

/** What the agents offer: the lead on Opus 5.5. */
const agentModels = models.map((one) =>
  one.agentId === 'claude-code'
    ? { ...one, models: [{ ...one.models[0]!, id: 'claude-opus-5-5', name: 'Opus 5.5', description: null }], model: 'claude-opus-5-5' }
    : one,
)

const minutes = (n: number) => new Date(Date.now() - n * 60_000).toISOString()

const taskSnapshot = (threadId: string) => {
  const mine = threadId === TASK.threadId
  const base = snapshot()
  return snapshot({
    threadId,
    project: { id: 'p1', name: 'althar' },
    task: {
      ...base.task,
      id: mine ? TASK.id : OTHER.id,
      title: mine ? TASK.title : OTHER.title,
      slug: mine ? TASK.slug : 'changelog-cards',
      branch: mine ? TASK.branch : 'althar/changelog-cards',
      worktree: mine ? TASK.worktree : '/Users/balazs/Althar/althar/changelog-cards',
      request: mine ? REQUEST : 'Give the changelog one card per release, newest first.',
      phase: mine ? 'ready' : 'running',
      step: mine ? null : 'implement',
      startedAt: minutes(mine ? 42 : 12),
      lead: { agentId: 'claude-code', model: 'claude-opus-5-5', account: null },
      steps: [
        { key: 'implement', agentId: 'claude-code', model: 'claude-opus-5-5', skipped: false },
        { key: 'review', agentId: 'codex', model: null, skipped: false },
      ],
      changes: mine
        ? [
            change({
              draft: true,
              number: 641,
              title: TASK.title,
              repository: 'AltharIDE/althar',
              url: 'https://github.com/AltharIDE/althar/pull/641',
              checks: { outcome: 'passed', passed: 6, failed: 0, running: 0, total: 6, failing: [], list: [] },
            }),
          ]
        : [],
      files: mine
        ? [
            { path: 'apps/site/src/home/bodies/RunsOn.tsx', add: 24, del: 4 },
            { path: 'apps/site/src/home/bodies/RunsOn.module.css', add: 14, del: 2 },
          ]
        : [],
      commits: mine ? 2 : 0,
      runnables,
      launches: mine ? [launchOf('task', 9)] : [],
      actions: ['stop', 'abandon'],
    } as unknown as typeof base.task,
    session: { ...base.session!, model: 'claude-opus-5-5', models: ['claude-opus-5-5'], turnRunning: !mine },
    items: [...(mine ? threadItems : []), ...(proto.get().sent[threadId] ?? [])],
  })
}

const { client } = fakeClient({
  listProjects: async () => ({ cursor: 3, projects }),
  getRepositories: async () => [repository],
  getModels: async () => agentModels,
  getHome: async () => home({ projects, tasks: tasks.map((one): HomeTask => ({ ...one, projectId: 'p1' }) as unknown as HomeTask) }),
  getBoard: async () => ({ cursor: 1, tasks, calls: [], settledTotal: 41 }),
  getCoordinator: async () =>
    coordinatorSnapshot({
      project: { id: 'p1', name: 'althar' },
      runnables,
      launches: [launchOf('main', 21), launchOf('task', 9)],
      items: [...coordinatorItems, ...(proto.get().sent.thc ?? [])],
    }),
  getThread: async (threadId: string) => taskSnapshot(threadId),
})

const host = fakeHost()
const cache = makeQueryClient()
const services = { client, host, cache, feed: follow(client, cache) }

// What was sent: the threads read again, as they would on the runtime's word.
let sent = proto.get().sent
proto.subscribe(() => {
  if (proto.get().sent === sent) return
  sent = proto.get().sent
  void cache.invalidateQueries({ queryKey: ['thread'] })
  void cache.invalidateQueries({ queryKey: ['coordinator'] })
})

/* ——— Links: the app's own open in Althar's browser or the person's, as the direction has it. ——— */

/** Where a link was pressed: a task's thread is the task's, anything else the coordinator's. */
const fromHere = (): Destination =>
  window.location.hash.startsWith(`#/threads/${TASK.threadId}`)
    ? { kind: 'task', taskId: TASK.id }
    : window.location.hash.startsWith(`#/threads/${OTHER.threadId}`)
      ? { kind: 'task', taskId: OTHER.id }
      : { kind: 'coordinator' }

document.addEventListener(
  'click',
  (event) => {
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null
    const href = link?.getAttribute('href')
    if (href == null || !/^(https?|file):/i.test(href)) return
    event.preventDefault()
    proto.open(href, fromHere())
  },
  true,
)
window.open = ((url?: string | URL) => {
  if (url !== undefined) proto.open(String(url), fromHere())
  return null
}) as typeof window.open

/* ——— The switcher under the window, and the keys. ——— */

const titled = (direction: Direction) => {
  const one = DIRECTIONS.find((each) => each.value === direction)
  document.title = `${direction} · ${one?.name ?? ''} · Althar’s browser`
}

const go = (direction: Direction) => {
  proto.set({
    direction,
    pointing: null,
    draft: null,
    page: direction === 'A' || direction === 'E' ? proto.get().page : null,
    face: direction === 'A' ? false : proto.get().face,
  })
  titled(direction)
  const params = new URLSearchParams(window.location.search)
  params.set('d', direction)
  window.history.replaceState(window.history.state, '', `${window.location.pathname}?${params.toString()}${window.location.hash}`)
}

const typing = (target: EventTarget | null) =>
  target instanceof Element &&
  target.closest('input, textarea, select, [contenteditable], [role=menu], [role=dialog], [role=listbox], [role=textbox]') !== null

const onTask = () => window.location.hash.startsWith(`#/threads/${TASK.threadId}`)

/** Where pointing goes now: A's tab with the window, B–D's preview, E's page beside the conversation the window is on. */
const scopeNow = (): string | null => {
  const p = proto.get()
  if (p.direction === 'A' || (p.direction === 'E' && p.page !== null)) return p.page
  if (p.direction === 'E') return p.side[threadHere()] === undefined ? null : sideScope(threadHere())
  return p.face && onTask() ? 'preview' : null
}

const onKey = (event: KeyboardEvent) => {
  const p = proto.get()
  // ⇧⌘C points at the page that has the window, as a browser's inspector does; again, it stops.
  if (commandDown(event) && event.shiftKey && event.key.toLowerCase() === 'c') {
    const scope = scopeNow()
    if (scope === null) return
    event.preventDefault()
    proto.point(p.pointing === scope ? null : scope)
    return
  }
  // ⌘T: a new page, in A.
  if (commandDown(event) && !event.shiftKey && event.key.toLowerCase() === 't' && p.direction === 'A') {
    event.preventDefault()
    proto.newPage()
    return
  }
  if (event.metaKey || event.ctrlKey || event.altKey || typing(event.target)) return
  // E: p puts the task's run beside its conversation, and again takes it away.
  if (p.direction === 'E' && onTask() && p.page === null && event.key === 'p') {
    event.preventDefault()
    if (p.side[TASK.threadId] === undefined) proto.beside(TASK.threadId, RUNS.task.address)
    else proto.closeSide(TASK.threadId)
    return
  }
  // p shows the task's preview, as c, o and g show its other faces.
  if (p.direction !== 'A' && p.direction !== 'E' && onTask() && p.page === null) {
    if (event.key === 'p') {
      event.preventDefault()
      proto.set({ face: true })
      return
    }
    if (event.key === 'c' || event.key === 'o' || event.key === 'g') proto.set({ face: false, pointing: null })
  }
  if (p.pointing !== null) return
  const at = DIRECTIONS.findIndex((one) => one.value === p.direction)
  const picked =
    event.key === ']'
      ? DIRECTIONS[(at + 1) % DIRECTIONS.length]
      : event.key === '['
        ? DIRECTIONS[(at - 1 + DIRECTIONS.length) % DIRECTIONS.length]
        : /^[1-5]$/.test(event.key)
          ? DIRECTIONS[Number(event.key) - 1]
          : undefined
  if (picked === undefined) return
  event.preventDefault()
  go(picked.value)
}

const open = (hash: string) => {
  proto.set({ page: null })
  window.location.assign(hash)
}

function Switcher() {
  const p = useProto()
  if (p.bare) return null
  const scope = p.direction === 'A' || p.direction === 'E' ? scopeNow() : p.face ? 'preview' : null
  return (
    <div className={s.strip}>
      <Segmented<Direction>
        label="Direction"
        value={p.direction}
        onChange={go}
        options={DIRECTIONS.map((one, at) => ({
          value: one.value,
          label: `${one.value} · ${one.name}`,
          tooltip: { label: one.about, kbd: String(at + 1) },
        }))}
      />
      <span className={s.gap} />
      <LinkButton onClick={() => open(`#/threads/${TASK.threadId}`)}>Task</LinkButton>
      <LinkButton onClick={() => open('#/projects/p1?room=both')}>Project</LinkButton>
      {scope !== null && (
        <LinkButton onClick={() => proto.line(scope, { kind: 'permission', what: 'camera', host: 'localhost:5321' })}>
          The page asks for the camera
        </LinkButton>
      )}
      {p.direction === 'D' && <LinkButton onClick={() => proto.drive()}>The lead checks the page</LinkButton>}
      <LinkButton onClick={proto.startOver}>Start over</LinkButton>
      <span className={s.grow} />
      {p.outside !== null ? <span className={s.outside}>→ {p.outside}</span> : <span>1–5 or [ ] switch</span>}
    </div>
  )
}

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

/** Opens the app on the direction the URL says (?d=B), else A, on the task's thread; ?face=preview opens its preview. */
export const boot = () => {
  const params = new URLSearchParams(window.location.search)
  const shown = DIRECTIONS.find((one) => one.value.toLowerCase() === params.get('d')?.toLowerCase())?.value ?? 'A'
  proto.set({
    direction: shown,
    bare: params.has('bare'),
    face: params.get('face') === 'preview',
    running: params.get('run') === 'off' ? 'off' : 'up',
    mode: (params.get('mode') as 'side' | 'swipe' | 'onion' | null) ?? 'side',
    width: params.get('width') === 'narrow' ? 'narrow' : 'wide',
  })
  const address = params.get('page')
  if (address !== null && shown === 'A') proto.open(address === 'new' ? '' : address, { kind: 'task', taskId: TASK.id })
  if (address === 'new' && shown === 'A') {
    proto.closePage(proto.get().page ?? '')
    proto.newPage()
  }
  titled(shown)
  window.localStorage.removeItem('althar.tabs')
  if (window.location.hash === '' || window.location.hash === '#/') window.location.hash = `#/threads/${TASK.threadId}`
  // E, ?side=run: the task's run open beside its conversation; ?side=<address>, another page.
  const side = params.get('side')
  if (side !== null && shown === 'E') proto.beside(threadHere(), side === 'run' ? RUNS.task.address : side)
  window.addEventListener('keydown', onKey)
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

export { RUNS }
