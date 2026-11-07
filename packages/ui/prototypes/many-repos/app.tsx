// Scrappy: the real desktop app (its router, tabs, project and task screens) on the tests' fake client, open on a task whose change spans several repositories.
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '../../src/styles/global.css'
import '../../../../apps/desktop/src/renderer/app.css'

import { createRoot } from 'react-dom/client'

import { LinkButton } from '../../src/primitives/LinkButton/LinkButton'
import { Segmented } from '../../src/primitives/Segmented/Segmented'
import { Select } from '../../src/primitives/Select/Select'
import { Switch } from '../../src/primitives/Switch/Switch'
import { type BoardTask, type ProjectSummary, RouterProvider } from './deps'

import { follow } from '../../../../apps/desktop/src/renderer/data/feed'
import { makeQueryClient } from '../../../../apps/desktop/src/renderer/data/reads'
import { ServicesProvider } from '../../../../apps/desktop/src/renderer/data/services'
import { makeRouter } from '../../../../apps/desktop/src/renderer/router'
import { Outputs } from '../../../../apps/desktop/src/renderer/features/task/Outputs'
import { card, fakeClient, fakeHost, models, project, repositories } from '../../../../apps/desktop/tests/fixtures'
import { cx } from '../../src/lib/cx'
import { SCENARIOS, scenarioOf, urlOf } from './data'
import { p, Showing } from './parts'
import { snapshotOf } from './snapshot'
import { type Direction, proto, useProto } from './state'

/* ——— What the fake runtime holds: the project, its board, the task. ——— */

const projectOf = (name: 'fnt' | 'meridian'): ProjectSummary => ({
  ...project,
  name,
  slug: name,
  ink: name === 'fnt' ? 'clay' : 'teal',
  repository: `/Users/balazs/code/${name}`,
  repositories: proto.get().scenario.repos.map((repo) => repo.slug),
  worktrees: `/Users/balazs/Althar/${name}`,
  running: 0,
  working: 1,
  ready: 1,
})

const repositoriesOf = () =>
  proto.get().scenario.repos.map((repo, at) => ({
    ...repositories[0]!,
    id: `repo_${repo.slug}`,
    name: repo.slug,
    path: `/Users/balazs/code/${proto.get().scenario.project}/${repo.slug}`,
    host: {
      ...repositories[0]!.host!,
      product: repo.host,
      name: repo.host === 'gitlab' ? 'GitLab' : 'GitHub',
      path: repo.path,
      url: urlOf(repo).replace(/\/(-\/merge_requests|pull)\/.*$/, ''),
      account: repo.connected ? { login: 'balazs', state: 'ready' as const } : null,
    },
    tasks: at === 0 ? 2 : 1,
  }))

const boardTask = (overrides: Partial<BoardTask>): BoardTask => ({
  ...card(),
  state: 'open',
  createdAt: '2026-11-06T09:00:00.000Z',
  settledAt: null,
  changed: null,
  here: [],
  ...overrides,
  branch: overrides.branch ?? `althar/${overrides.slug ?? 'task'}`,
})

const tasksOf = (): BoardTask[] => {
  const { scenario } = proto.get()
  return [
    boardTask({
      taskId: 't1',
      threadId: 'th1',
      title: scenario.title,
      slug: scenario.branch.slice('althar/'.length),
      branch: scenario.branch,
      phase: 'ready',
    }),
    boardTask({
      taskId: 't2',
      threadId: 'th2',
      title: 'Rate-limit the chat endpoint per workspace',
      slug: 'rate-limit-chat',
      phase: 'running',
      step: 'implement',
    }),
  ]
}

// Codex's models, with the one that reviewed: so the review line names it as the app does.
const withTerra = models.map((one) =>
  one.agentId === 'codex' ? { ...one, models: [{ ...one.models[0]!, id: 'gpt-6.1-terra', name: 'GPT-6.1 Terra' }, ...one.models] } : one,
)

const slugOfUrl = (url: string | undefined) => proto.get().repos.find((repo) => repo.number !== null && urlOf(repo) === url)?.slug

const { client } = fakeClient({
  listProjects: async () => ({ cursor: 3, projects: [projectOf(proto.get().scenario.project)] }),
  getRepositories: async () => repositoriesOf(),
  getBoard: async () => ({ cursor: 1, tasks: tasksOf(), calls: [], settledTotal: 12 }),
  getModels: async () => withTerra,
  getThread: async () => snapshotOf(proto.get().scenario, proto.get().repos),
  // As built, its buttons do here what the runtime would: mark a draft ready, merge one after the other.
  markReady: async (_taskId: string, url?: string) => {
    const slug = slugOfUrl(url)
    if (slug !== undefined) proto.markReady([slug])
  },
  merge: async (_taskId: string, _head: string, url?: string) => {
    const slug = slugOfUrl(url)
    if (slug !== undefined) proto.merge([slug])
    await new Promise((done) => setTimeout(done, 1500))
  },
})

const host = fakeHost()
const cache = makeQueryClient()
const services = { client, host, cache, feed: follow(client, cache) }

// What pressing changed: the task is read again, as it would be on the runtime's word.
let read = proto.get().repos
proto.subscribe(() => {
  const { repos } = proto.get()
  if (repos === read) return
  read = repos
  void cache.invalidateQueries({ queryKey: ['thread'] })
  void cache.invalidateQueries({ queryKey: ['board'] })
  void cache.invalidateQueries({ queryKey: ['projects'] })
})

/* ——— The strip under the window: which direction, which state, which view; the URL keeps them. ——— */

const DIRECTIONS: ReadonlyArray<{ value: Direction; name: string; what: string }> = [
  { value: 'A', name: 'Rows', what: 'One change, a row per repository, one press for all of them' },
  { value: 'B', name: 'Sections', what: 'A summary over a section per repository' },
  { value: 'C', name: 'Merge track', what: 'Repositories as numbered stops in the order they merge, files a tab each' },
  { value: 'Today', name: 'As built', what: 'Today’s card, the real one, on this state' },
]

const directionOf = (word: string | null): Direction | undefined =>
  DIRECTIONS.find((one) => one.value.toLowerCase() === word?.toLowerCase())?.value

const titled = () => {
  const { direction, scenario } = proto.get()
  const one = DIRECTIONS.find((each) => each.value === direction)
  document.title = `${direction === 'Today' ? 'As built' : `${direction} · ${one?.name ?? ''}`} · ${scenario.label}`
}

const go = (direction: Direction) => proto.set({ direction })
const state = (key: string) => proto.scenario(key)
const step = (by: number) => {
  const at = SCENARIOS.findIndex((one) => one.key === proto.get().scenario.key)
  state(SCENARIOS[(at + by + SCENARIOS.length) % SCENARIOS.length]!.key)
}

// The URL says what the page shows, so a link opens it again: ?d=B&s=failing&v=all.
let said = ''
proto.subscribe(() => {
  const { direction, scenario, view, narrow } = proto.get()
  const now = `${direction}/${scenario.key}/${view}/${narrow}`
  if (now === said) return
  said = now
  titled()
  const params = new URLSearchParams(window.location.search)
  params.set('d', direction)
  params.set('s', scenario.key)
  if (view === 'all') params.set('v', 'all')
  else params.delete('v')
  if (narrow) params.set('narrow', '')
  else params.delete('narrow')
  window.history.replaceState(
    window.history.state,
    '',
    `${window.location.pathname}?${params.toString().replace('narrow=', 'narrow')}${window.location.hash}`,
  )
})

/** 1 to 4 or ← → pick a direction; ↑ ↓ step through the states; never while typing, or inside a menu, dialog or list. */
const onKey = (event: KeyboardEvent) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return
  const target = event.target instanceof Element ? event.target : null
  if (target?.closest('input, textarea, select, [contenteditable], [role=menu], [role=dialog], [role=listbox]')) return
  if (event.key.startsWith('Arrow') && target?.closest('[role=radiogroup]')) return
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    step(event.key === 'ArrowDown' ? 1 : -1)
    return
  }
  const at = DIRECTIONS.findIndex((one) => one.value === proto.get().direction)
  const picked =
    event.key === 'ArrowRight'
      ? DIRECTIONS[(at + 1) % DIRECTIONS.length]
      : event.key === 'ArrowLeft'
        ? DIRECTIONS[(at - 1 + DIRECTIONS.length) % DIRECTIONS.length]
        : /^[1-4]$/.test(event.key)
          ? DIRECTIONS[Number(event.key) - 1]
          : undefined
  if (picked === undefined) return
  event.preventDefault()
  go(picked.value)
}

function Strip() {
  const now = useProto()
  if (now.bare) return null
  return (
    <div className={p.strip}>
      <Segmented<Direction>
        label="Direction"
        value={now.direction}
        onChange={go}
        options={DIRECTIONS.map((one, at) => ({
          value: one.value,
          label: one.value === 'Today' ? one.name : `${one.value} · ${one.name}`,
          tooltip: { label: one.what, kbd: String(at + 1) },
        }))}
      />
      <Select<string>
        label="State"
        variant="filled"
        width={200}
        value={now.scenario.key}
        onChange={state}
        options={SCENARIOS.map((one) => ({ value: one.key, label: one.label }))}
      />
      <Segmented<'screen' | 'all'>
        label="View"
        value={now.view}
        onChange={(view) => proto.set({ view })}
        options={[
          { value: 'screen', label: 'Task screen' },
          { value: 'all', label: 'Every state' },
        ]}
      />
      <label className={p.row} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Switch checked={now.narrow} onChange={(narrow) => proto.set({ narrow })} label="Narrow window" />
        Narrow
      </label>
      <LinkButton onClick={() => proto.scenario(now.scenario.key)}>Start over</LinkButton>
      <span className={p.grow} />
      <span>1–4 or ← → direction · ↑ ↓ state</span>
    </div>
  )
}

const noop = () => undefined

/** Every state of the direction, side by side, each through the real Outputs at the width its side column gives the card. */
function Gallery() {
  const { direction } = useProto()
  return (
    <div className={p.gallery}>
      <div className={p.galleryInner}>
        {SCENARIOS.map((scenario) => (
          <div key={scenario.key} className={p.galleryCell}>
            <p className={p.galleryCaption}>
              {scenario.label} <span>· {scenario.project}</span>
            </p>
            <Showing.Provider value={{ direction, scenario, repos: scenario.repos, live: false }}>
              <div className="gallery-outputs">
                <Outputs
                  snapshot={snapshotOf(scenario, scenario.repos, { story: false })}
                  pending={false}
                  error={null}
                  onAccept={noop}
                  onMergeHere={noop}
                  onOpenChange={noop}
                  onPush={noop}
                  onMarkReady={noop}
                  onOpenFile={noop}
                  onPushBranch={noop}
                  onConnect={noop}
                  onReplace={noop}
                  onBringIn={noop}
                />
              </div>
            </Showing.Provider>
          </div>
        ))}
      </div>
    </div>
  )
}

function Page({ router }: { router: ReturnType<typeof makeRouter> }) {
  const now = useProto()
  return (
    <div className={cx(now.bare ? p.bare : p.frame, now.narrow && p.narrowFrame)}>
      {now.view === 'all' ? <Gallery /> : <RouterProvider router={router} />}
    </div>
  )
}

/** Opens the app on the direction and state the URL says, or A on both drafts. */
export const boot = () => {
  const params = new URLSearchParams(window.location.search)
  proto.scenario(scenarioOf(params.get('s'))?.key ?? 'drafts')
  proto.set({
    direction: directionOf(params.get('d')) ?? 'A',
    view: params.get('v') === 'all' ? 'all' : 'screen',
    narrow: params.has('narrow'),
    bare: params.has('bare'),
  })
  titled()
  window.localStorage.removeItem('althar.tabs')
  if (window.location.hash === '' || window.location.hash === '#/') window.location.hash = '#/threads/th1'
  if (!params.has('bare')) window.addEventListener('keydown', onKey)
  const router = makeRouter({ client, cache })
  const element = document.getElementById('root')
  if (element === null) throw new Error('The page has no #root')
  createRoot(element).render(
    <ServicesProvider value={services}>
      <Page router={router} />
      <Strip />
    </ServicesProvider>,
  )
}
