// Scrappy: the real desktop app (its router, tabs, home, board, Talk room, task, settings) on the tests' fake client, with a bar underneath that switches how plan usage and steering show, which scenario the accounts are in, and the screen, in place.
import './clock'
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'
import '../../src/renderer/app.css'
import './page.css'

import type { CoordinatorSnapshot, ProjectRulesView, ThreadSnapshot } from '@althar/contracts'
import { Segmented, Switch } from '@althar/ui'
import { createBrowserHistory, RouterProvider } from '@tanstack/react-router'
import { useEffect, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'

import { follow } from '../../src/renderer/data/feed'
import { readModelsAhead } from '../../src/renderer/data/models'
import { keys, makeQueryClient } from '../../src/renderer/data/reads'
import { ServicesProvider } from '../../src/renderer/data/services'
import { makeRouter } from '../../src/renderer/router'
import { fakeClient, fakeHost, repositories, status } from '../../tests/fixtures'
import b from './bar.module.css'
import { agentsOf, althar, modelsOf, PINS, shownTask, T, type TaskKey } from './data'
import { boardOf, coordinatorOf, homeOf, itemOf, rulesOf, taskListOf, threadOf, usageOf } from './runtime'
import {
  type Direction,
  DIRECTIONS,
  get,
  type Level,
  LEVELS,
  type Rule,
  RULES,
  type Screen,
  SCREENS,
  set,
  subscribe,
  useProto,
} from './store'

/* ——— What the fake runtime says: worked out from the page's state each time ——— */

/** Warnings the person said Seen to, in ninemate's: gone until the scenario changes. */
const seen = new Set<string>()
const usageNow = () => {
  const usage = usageOf(get())
  return { ...usage, warnings: usage.warnings.filter((one) => !seen.has(`${one.accountId}:${one.windowKey}`)) }
}

const repository = { ...repositories[0]!, id: 'repo_althar', name: 'althar', path: `${althar.repository}`, tasks: 3 }

const { client, emit: _emit } = fakeClient({
  status: async () => ({ ...status, agents: agentsOf(get()) }),
  listProjects: async () => ({ cursor: 3, projects: [{ ...althar, usageLimit: get().rule }] }),
  openProject: async () => ({ ...althar, usageLimit: get().rule }),
  listTasks: async () => ({ cursor: 4, tasks: taskListOf(get()) }),
  getHome: async () => homeOf(get()),
  getBoard: async () => boardOf(get()),
  getOlderSettled: async () => [],
  getCoordinator: async () => coordinatorOf(get()),
  getThread: async (threadId: string) => threadOf(get(), threadId),
  getThreadItem: async (threadId: string, itemId: string) => {
    const item = itemOf(get(), threadId, itemId)
    if (item === undefined) throw new Error(`No item ${itemId}`)
    return item
  },
  getRepositories: async () => [repository],
  getModels: async () => modelsOf(get()),
  getPlanUsage: async () => usageNow(),
  acknowledgeUsageWarnings: async (warnings: ReadonlyArray<{ readonly accountId: string; readonly windowKey: string }>) => {
    for (const one of warnings) seen.add(`${one.accountId}:${one.windowKey}`)
  },
  getProjectRules: async (projectId: string) => rulesOf(get(), projectId),
  // The project's usage-limit rule, changed in its settings, is the bar's.
  setProjectRules: async (change: { readonly projectId: string; readonly usageLimit?: Rule }) => {
    if (change.usageLimit !== undefined) set({ rule: change.usageLimit })
    return { ...rulesOf(get(), change.projectId), ...change } as ProjectRulesView
  },
} as Parameters<typeof fakeClient>[0])

const cache = makeQueryClient()
const services = { client, host: fakeHost(), cache, feed: follow(client, cache) }

/* ——— Where the page starts: what the address names ——— */

const params = new URLSearchParams(window.location.search)
const pick = <V extends string>(list: ReadonlyArray<{ readonly value: V }>, key: string, fallback: V): V =>
  list.find((one) => one.value === params.get(key))?.value ?? fallback
set({
  d: DIRECTIONS.find((one) => one.key === params.get('d'))?.key ?? 'N',
  level: pick<Level>(LEVELS, 's', 'nearly'),
  several: params.get('several') === '1',
  silent: params.get('silent') === '1',
  rule: pick<Rule>(RULES, 'rule', 'move'),
  screen: pick<Screen>(SCREENS, 'v', 'board'),
})
const bare = params.has('bare')

const threadOfTask = (key: TaskKey) => T[key].threadId
const hashOf = (screen: Screen): string => {
  switch (screen) {
    case 'home':
      return '#/'
    case 'board':
      return '#/projects/p1?room=board'
    case 'talk':
      return '#/projects/p1?room=talk'
    case 'task':
    case 'picker':
      return `#/threads/${threadOfTask(shownTask(get()))}`
    case 'accounts':
      return '#/settings/agents'
    default:
      return '#/'
  }
}

window.localStorage.removeItem('althar.tabs')
window.localStorage.setItem('althar.models', JSON.stringify({ pins: PINS }))
window.location.hash = hashOf(get().screen)

const quietly = window.history.replaceState.bind(window.history)

/** The app's own hash history, reading its search from the hash alone: the page's own address (?d=…) stays out of the app's routes. */
const history = createBrowserHistory({
  parseLocation: () => {
    const [path = '/', ...rest] = window.location.hash.split('#').slice(1)
    const href = `${path}${rest.length === 0 ? '' : `#${rest.join('#')}`}`
    const hashAt = href.indexOf('#')
    const searchAt = href.indexOf('?')
    const end = (at: number) => (at === -1 ? href.length : at)
    return {
      href,
      pathname: href.slice(0, Math.min(end(searchAt), end(hashAt))),
      search: searchAt === -1 ? '' : href.slice(searchAt, hashAt === -1 ? undefined : hashAt),
      hash: hashAt === -1 ? '' : href.slice(hashAt),
      state: window.history.state ?? { __TSR_index: 0, key: 'first', __TSR_key: 'first' },
    }
  },
  createHref: (href) => `${window.location.pathname}${window.location.search}#${href}`,
})
const router = makeRouter({ client, cache }, history)

/** The screen showing, by the router's place. */
const shownScreen = (): Screen => {
  const { pathname, search } = router.state.location
  if (pathname.startsWith('/threads/')) return get().screen === 'picker' ? 'picker' : 'task'
  if (pathname.startsWith('/settings')) return 'accounts'
  if (pathname.startsWith('/projects/')) return (search as { room?: string }).room === 'talk' ? 'talk' : 'board'
  return 'home'
}
const useShownScreen = () => useSyncExternalStore((listener) => router.subscribe('onResolved', listener), shownScreen)

/** The page's address, kept to what it shows. */
const keep = () => {
  const st = get()
  const now = new URLSearchParams(window.location.search)
  now.set('d', st.d)
  now.set('s', st.level)
  for (const [key, on] of [
    ['several', st.several],
    ['silent', st.silent],
  ] as const) {
    if (on) now.set(key, '1')
    else now.delete(key)
  }
  now.set('rule', st.rule)
  now.set('v', shownScreen())
  now.delete('u')
  const next = `${window.location.pathname}?${now.toString()}${window.location.hash}`
  if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) quietly(window.history.state, '', next)
}
subscribe(keep)
router.subscribe('onResolved', keep)

/* ——— A scenario changed: the runtime says it all again, as its feed would ——— */

let shownScenario = JSON.stringify([get().level, get().several, get().silent, get().rule])
const reread = () => {
  const st = get()
  const scenario = JSON.stringify([st.level, st.several, st.silent, st.rule])
  if (scenario !== shownScenario) seen.clear()
  shownScenario = scenario
  // The threads put back whole, as a fresh read would, so nothing of the scenario before stays.
  cache.setQueryData<CoordinatorSnapshot>(keys.coordinator('p1'), coordinatorOf(st))
  for (const key of Object.keys(T) as TaskKey[])
    cache.setQueryData<ThreadSnapshot>(keys.thread(T[key].threadId), threadOf(st, T[key].threadId))
  cache.setQueryData(keys.planUsage, usageNow())
  void cache.invalidateQueries()
  readModelsAhead(client)
}
subscribe(reread)

/* ——— Going to a screen, as the person would ——— */

const until = async <E,>(find: () => E | null, tries = 50): Promise<E | null> => {
  for (let at = 0; at < tries; at += 1) {
    const found = find()
    if (found !== null) return found
    await new Promise((done) => window.setTimeout(done, 100))
  }
  return null
}

/** The task's composer's model picker, opened as the person would. */
const openPicker = async () => {
  const chip = await until(() => document.querySelector<HTMLButtonElement>('form button[aria-label^="Lead:"]'))
  if (chip !== null && chip.getAttribute('aria-expanded') !== 'true') chip.click()
}

const go = (screen: Screen) => {
  set({ screen })
  void router.navigate({ href: hashOf(screen).slice(1) }).then(() => {
    if (screen === 'picker') void openPicker()
  })
}

// The task steering touched changes with the scenario: the Task screen follows it.
let shownThread = threadOfTask(shownTask(get()))
subscribe(() => {
  const next = threadOfTask(shownTask(get()))
  if (next === shownThread) return
  shownThread = next
  const screen = shownScreen()
  if (screen === 'task' || screen === 'picker') go(screen)
})

/* ——— The bar ——— */

const forThePage = (event: KeyboardEvent) => {
  const target = event.target
  return !(
    event.defaultPrevented ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    (target instanceof HTMLElement &&
      (target.isContentEditable ||
        target.closest('form, input, textarea, select, [role="textbox"], [role="menu"], [role="listbox"], [role="dialog"]') !== null))
  )
}

function Bar() {
  const st = useProto()
  const screen = useShownScreen()
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!forThePage(event)) return
      const at = DIRECTIONS.findIndex((one) => one.key === get().d)
      const to =
        event.key === 'ArrowRight'
          ? DIRECTIONS[(at + 1) % DIRECTIONS.length]
          : event.key === 'ArrowLeft'
            ? DIRECTIONS[(at - 1 + DIRECTIONS.length) % DIRECTIONS.length]
            : /^[1-4]$/.test(event.key)
              ? DIRECTIONS[Number(event.key) - 1]
              : undefined
      if (to === undefined) return
      event.preventDefault()
      set({ d: to.key })
    }
    // Caught first, so the bar's own radio groups don't take the arrows as a move without a pick.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
  if (bare) return null
  return (
    <div className={b.bar}>
      <div className={b.row}>
        <Segmented<Direction>
          label="Direction"
          value={st.d}
          onChange={(d) => set({ d })}
          options={DIRECTIONS.map((one, index) => ({ value: one.key, label: `${one.short} · ${one.name}`, kbd: String(index + 1) }))}
        />
        <span className={b.grow} />
        <span className={b.name}>Screen</span>
        <Segmented<Screen>
          label="Screen"
          value={screen}
          onChange={go}
          options={SCREENS.map((one) => ({ value: one.value, label: one.label, tooltip: { label: one.tip } }))}
        />
      </div>
      <div className={b.row}>
        <span className={b.name}>Scenario</span>
        <Segmented<Level>
          label="Scenario"
          value={st.level}
          onChange={(level) => set({ level })}
          options={LEVELS.map((one) => ({ value: one.value, label: one.label, tooltip: { label: one.tip } }))}
        />
        <label className={b.toggle}>
          <Switch checked={st.several} onChange={(several) => set({ several })} label="Several accounts" />
          Several accounts
        </label>
        <label className={b.toggle}>
          <Switch checked={st.silent} onChange={(silent) => set({ silent })} label="Agents with no reading" />
          Agents with no reading
        </label>
        <span className={b.grow} />
        <span className={b.name}>When an account is nearly out</span>
        <Segmented<Rule>
          label="The project’s usage-limit rule"
          value={st.rule}
          onChange={(rule) => set({ rule })}
          options={RULES.map((one) => ({ value: one.value, label: one.label, tooltip: { label: one.tip } }))}
        />
      </div>
    </div>
  )
}

function Page() {
  return (
    <ServicesProvider value={services}>
      <div className={bare ? b.bare : b.frame}>
        <RouterProvider router={router} />
      </div>
      <Bar />
    </ServicesProvider>
  )
}

const element = document.getElementById('root')
if (element === null) throw new Error('The page has no #root')
createRoot(element).render(<Page />)

// For pictures: the picker opened, or ⌘U pressed, once the screen is up.
if (get().screen === 'picker') void openPicker()
if (params.get('u') === '1')
  void (async () => {
    await until(() => document.querySelector('main, form, [class*="__frame__"]'))
    await new Promise((done) => window.setTimeout(done, 600))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'u', code: 'KeyU', metaKey: true, bubbles: true }))
  })()
