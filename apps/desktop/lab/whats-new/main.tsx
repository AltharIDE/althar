import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'
import '../../src/renderer/app.css'

import { createHashHistory, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { StrictMode, useEffect, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'

import { follow } from '../../src/renderer/data/feed'
import { makeQueryClient } from '../../src/renderer/data/reads'
import { ServicesProvider } from '../../src/renderer/data/services'
import { pageRoute } from '../../src/renderer/features/browser/route'
import { newProjectRoute } from '../../src/renderer/features/newProject/route'
import { projectRoute } from '../../src/renderer/features/project/route'
import { settingsRoute } from '../../src/renderer/features/settings/route'
import { startRoute } from '../../src/renderer/features/start/route'
import { taskRoute } from '../../src/renderer/features/task/route'
import { rootRoute } from '../../src/renderer/root'
import { PENDING } from '../../src/renderer/router'
import { fakeHost } from '../../tests/fixtures'
import { ALTHAR, makeClient, TABS } from './data'
import { go, setRouter, WHATS_NEW } from './go'
import { arrival, lab, useLab, type View } from './state'
import { WhatsNewScreen } from './WhatsNew'
import s from './lab.module.css'

/*
 * The What's new lab (README.md): the desktop app's window, whole, in the
 * browser, on made-up data, just restarted into Althar 0.10.0, with the
 * page's bar under it. The window opens where it was, Althar's tab beside the
 * home's with its dot; the bar walks through the rest, with keys too: R the
 * update again, 1 What's new, 2 Coming next, Q the quick settings' version
 * line (the way back to it), F updated from 0.8.0, N the narrowest window.
 */

// The tabs this window keeps, the same at every load.
window.localStorage.setItem('althar.tabs', JSON.stringify(TABS))
document.documentElement.dataset.theme = new URLSearchParams(window.location.search).get('theme') === 'dark' ? 'dark' : 'light'

const client = makeClient()
const host = fakeHost()
// The page is the window: the app reads its host from here.
Object.defineProperty(window, 'althar', { value: host, configurable: true })
const cache = makeQueryClient()
const services = { client, host, cache, feed: follow(client, cache) }

/** Althar's own place, which the app's routes don't have: under the window's tabs, as the settings' is. */
const whatsNewRoute = createRoute({ getParentRoute: () => rootRoute, path: WHATS_NEW, component: WhatsNewScreen })
const routeTree = rootRoute.addChildren([startRoute, newProjectRoute, projectRoute, taskRoute, settingsRoute, pageRoute, whatsNewRoute])
const router = createRouter({
  routeTree,
  history: createHashHistory(),
  context: { client, cache },
  defaultStaleTime: 0,
  defaultStaleReloadMode: 'blocking',
  defaultPendingMs: PENDING.after,
  defaultPendingMinMs: PENDING.atLeast,
})
setRouter(router)

/** The update again: the window opens where it was, a project of the person's, and Althar's tab has its dot. */
const restart = () => {
  lab.set(arrival)
  go.project(ALTHAR)
}

/** The quick settings, open, their foot saying the version and the way to What's new. */
const quick = () => document.querySelector<HTMLButtonElement>('[data-lab-window] button[aria-label="Althar settings"]')?.click()

const usePath = () =>
  useSyncExternalStore(
    (changed) => router.subscribe('onResolved', changed),
    () => router.state.location.pathname,
  )

const VIEWS: readonly { key: View; kbd: string; label: string }[] = [
  { key: 'new', kbd: '1', label: 'What’s new' },
  { key: 'coming', kbd: '2', label: 'Coming next' },
]

function Bar() {
  const { narrow, skipped, unseen, view } = useLab()
  const onPage = usePath() === WHATS_NEW
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (target !== null && (target.isContentEditable || target.closest('input, textarea, [contenteditable="true"]') !== null)) return
      const key = event.key.toLowerCase()
      const chosen = VIEWS.find((one) => one.kbd === key)
      if (chosen !== undefined) return go.althar(chosen.key)
      if (key === 'r') return restart()
      if (key === 'q') return quick()
      if (key === 'n') return lab.set({ narrow: !lab.get().narrow })
      if (key === 'f') return lab.set({ skipped: !lab.get().skipped })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <div className={s.bar} role="toolbar" aria-label="What’s new">
      <button type="button" aria-pressed={unseen && !onPage} onClick={restart}>
        <kbd>R</kbd> Just updated
      </button>
      <span className={s.round}>Althar’s tab</span>
      {VIEWS.map((one) => (
        <button key={one.key} type="button" aria-pressed={onPage && view === one.key} onClick={() => go.althar(one.key)}>
          <kbd>{one.kbd}</kbd> {one.label}
        </button>
      ))}
      <span className={s.round}>Later</span>
      <button type="button" onClick={quick}>
        <kbd>Q</kbd> From the version line
      </button>
      <span className={s.gap} />
      <button type="button" aria-pressed={skipped} onClick={() => lab.set({ skipped: !skipped })}>
        <kbd>F</kbd> From 0.8.0
      </button>
      <button type="button" aria-pressed={narrow} onClick={() => lab.set({ narrow: !narrow })}>
        <kbd>N</kbd> Narrow
      </button>
    </div>
  )
}

function Lab() {
  const { narrow } = useLab()
  // The first time, the window opens where it was after the update; a reload keeps where it is.
  useEffect(() => {
    if (window.location.hash === '' || window.location.hash === '#/') go.project(ALTHAR)
  }, [])
  return (
    <div className={s.lab}>
      <div className={s.desk}>
        <div className={s.window} data-narrow={narrow || undefined} data-lab-window>
          <ServicesProvider value={services}>
            <RouterProvider router={router} />
          </ServicesProvider>
        </div>
      </div>
      <Bar />
    </div>
  )
}

const root = document.getElementById('root')
if (root !== null)
  createRoot(root).render(
    <StrictMode>
      <Lab />
    </StrictMode>,
  )
