// Scrappy: the real desktop app (its router, tabs, Rules, task and board screens) on the tests' fake client, with a bar underneath that switches the path in place.
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'
import '../../src/renderer/app.css'

import type { ProjectRulesChange } from '../../src/renderer/data/client'
import { Button, Segmented } from '@althar/ui'
import { createBrowserHistory, RouterProvider } from '@tanstack/react-router'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'

import { follow } from '../../src/renderer/data/feed'
import { keys, makeQueryClient } from '../../src/renderer/data/reads'
import { ServicesProvider } from '../../src/renderer/data/services'
import { makeRouter } from '../../src/renderer/router'
import { fakeClient, fakeHost, home } from '../../tests/fixtures'
import b from './bar.module.css'
import { Compare } from './compare'
import { boardOf, meridian, threadOf } from './data'
import { nav } from './nav'
import { page } from './page'
import {
  answered,
  changeRules,
  get,
  onChange,
  type Path,
  PATHS,
  setChipOpen,
  setMenuOpen,
  setPath,
  start,
  type Start,
  startOf,
  STARTS,
  useProto,
  type View,
  VIEWS,
} from './store'

/* ——— What the fake runtime says: read from the page's state each time, so the app reads it as it changes ——— */

const { client } = fakeClient({
  listProjects: async () => ({ cursor: 3, projects: [meridian] }),
  getHome: async () => home({ projects: [meridian] }),
  getBoard: async () => boardOf(get().rules, get().waiting),
  getThread: async () => threadOf(get().rules, get().waiting, false),
  getProjectRules: async () => get().rules,
  readOutput: async () => ({ text: ' ✓ session/refresh (12)\n ✓ session/remember-me (4)\n\n 16 pass, 0 fail\n', dropped: 0 }),
  setProjectRules: async (change: ProjectRulesChange) => {
    const { projectId: _project, expectedRevision: _revision, ...rest } = change as ProjectRulesChange & { expectedRevision?: number }
    changeRules(rest)
    return get().rules
  },
  answer: async (input: { readonly attentionId: string }) => {
    answered(input.attentionId)
  },
} as Parameters<typeof fakeClient>[0])

const cache = makeQueryClient()
const services = { client, host: fakeHost(), cache, feed: follow(client, cache) }

// A change on the page is a change the runtime would announce: what shows it is read again.
onChange((next, was) => {
  if (next.rules !== was.rules) void cache.invalidateQueries({ queryKey: keys.rules('p1') })
  if (next.rules !== was.rules || next.waiting !== was.waiting) {
    void cache.invalidateQueries({ queryKey: keys.thread('th1') })
    void cache.invalidateQueries({ queryKey: keys.board('p1') })
    void cache.invalidateQueries({ queryKey: keys.home })
  }
})

/* ——— Where the page starts: the path, the screen and the state the address names ——— */

const params = new URLSearchParams(window.location.search)
const asked = params.get('d')
const firstPath: Path = PATHS.find((one) => one.key === asked)?.key ?? 'T'
const firstView = VIEWS.find((one) => one.key === params.get('v')) ?? VIEWS[0]!
const firstStart = (STARTS.find((one) => one.key === params.get('s'))?.key ?? 'fresh') as Start

// Every load opens on meridian's tab and the screen asked for, whatever another load kept.
window.localStorage.removeItem('althar.tabs')
window.location.hash = firstView.hash
start(firstStart, firstPath)
if (page.open === 'chip') setChipOpen(true)
if (page.open === 'menu') setMenuOpen(true)

// The page's address changes without the router hearing it, which listens on replaceState once it starts.
const quietly = window.history.replaceState.bind(window.history)

/**
 * The app's own hash history, but reading its search from the hash alone: the page's own address (?d=…&v=…&s=…) is the
 * prototype's, and stays out of the app's routes.
 */
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
nav.go = (to) => history.push(to)

const viewOf = (pathname: string): View => (pathname.endsWith('/rules') ? 'rules' : pathname.startsWith('/threads') ? 'task' : 'board')

/** The page's address, kept to what it shows: the path, the screen and the state. */
const keep = () => {
  const now = new URLSearchParams(window.location.search)
  now.set('d', get().path)
  now.set('v', viewOf(router.state.location.pathname))
  now.set('s', startOf(get()))
  now.delete('o')
  const next = `${window.location.pathname}?${now.toString()}${window.location.hash}`
  if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) quietly(window.history.state, '', next)
}
onChange(keep)
router.subscribe('onResolved', keep)

const useView = () =>
  useSyncExternalStore(
    (listener) => router.subscribe('onResolved', listener),
    () => viewOf(router.state.location.pathname),
  )

/* ——— The bar ——— */

/** Whether a key is the page's: not typed, nor meant for a card, a menu or a dialog. */
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

function Bar({ onCompare }: { onCompare: () => void }) {
  const st = useProto()
  const view = useView()
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!forThePage(event)) return
      const at = PATHS.findIndex((one) => one.key === get().path)
      const to =
        event.key === 'ArrowRight'
          ? PATHS[(at + 1) % PATHS.length]
          : event.key === 'ArrowLeft'
            ? PATHS[(at - 1 + PATHS.length) % PATHS.length]
            : /^[1-9]$/.test(event.key)
              ? PATHS[Number(event.key) - 1]
              : undefined
      if (to === undefined) return
      event.preventDefault()
      setPath(to.key)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  if (page.bare) return null
  return (
    <div className={b.bar}>
      <Segmented<Path>
        label="Path"
        value={st.path}
        onChange={setPath}
        options={PATHS.map((one, index) => ({
          value: one.key,
          label: one.key === 'T' ? one.short : `${one.short} · ${one.name}`,
          kbd: String(index + 1),
        }))}
      />
      <span className={b.grow} />
      <Segmented<View>
        label="Screen"
        value={view}
        onChange={(next) => nav.go(VIEWS.find((one) => one.key === next)!.hash.slice(1))}
        options={VIEWS.map((one) => ({ value: one.key, label: one.label }))}
      />
      <Segmented<Start>
        label="State"
        value={startOf(st)}
        onChange={(next) => start(next)}
        options={STARTS.map((one) => ({ value: one.key, label: one.label, tooltip: { label: one.tip } }))}
      />
      <Button variant="quiet" size="small" onClick={onCompare}>
        Compare
      </Button>
    </div>
  )
}

function Page() {
  const [comparing, setComparing] = useState(page.open === 'compare')
  return (
    <ServicesProvider value={services}>
      <div className={page.bare ? b.bare : b.frame}>
        <RouterProvider router={router} />
      </div>
      <Bar onCompare={() => setComparing(true)} />
      {comparing && <Compare onClose={() => setComparing(false)} />}
    </ServicesProvider>
  )
}

const element = document.getElementById('root')
if (element === null) throw new Error('The page has no #root')
createRoot(element).render(<Page />)
