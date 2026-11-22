import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'
import '../../src/renderer/app.css'

import { createHashHistory, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { StrictMode, useEffect } from 'react'
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
import { arrival, DIRECTIONS, type Direction, lab, LOOKS, useLab } from './state'
import { WhatsNewScreen } from './WhatsNew'
import s from './lab.module.css'

/*
 * The What's new lab (README.md): the desktop app's window, whole, in the
 * browser, on made-up data, just restarted into Althar 0.10.0, with the
 * page's bar under it. The bar swaps the direction in place (A–D, with keys
 * too), and each opens as the window would on its first launch after the
 * update; R does that again. 1, 2 and 3 switch how the page looks, in
 * every direction: Althar's light, the real thing, or the site's flight
 * log, and open it. N narrows the window to the app's narrowest; F
 * says the person updated from 0.8.0, so two releases are new to them.
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

/** What's new's own place, which the app's routes don't have: under the window's tabs, as the settings' is. */
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

/** Where the window opens, the first time after the update: What's new's tab in A, the home in C, where it was (althar) else. */
const land = (d: Direction) => {
  if (d === 'a') return go.whatsNew()
  if (d === 'c') return go.home()
  go.project(ALTHAR)
}

/** The update again, in a direction: the window as it opens on 0.10.0 for the first time. */
const restart = (d: Direction) => {
  lab.set({ d, ...arrival(d) })
  land(d)
}

/** A look, seen: the page opens on What's new where it isn't. */
const see = (look: (typeof LOOKS)[number]['key']) => {
  lab.set({ look, view: 'new' })
  go.whatsNew()
}

function Bar() {
  const { d, narrow, skipped, look } = useLab()
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (target !== null && (target.isContentEditable || target.closest('input, textarea, [contenteditable="true"]') !== null)) return
      const key = event.key.toLowerCase()
      const direction = DIRECTIONS.find((one) => one.kbd.toLowerCase() === key)
      if (direction !== undefined) return restart(direction.key)
      const chosen = LOOKS.find((one) => one.kbd === key)
      if (chosen !== undefined) return see(chosen.key)
      if (key === 'r') return restart(lab.get().d)
      if (key === 'n') return lab.set({ narrow: !lab.get().narrow })
      if (key === 'f') return lab.set({ skipped: !lab.get().skipped })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <div className={s.bar} role="toolbar" aria-label="Directions">
      {DIRECTIONS.map((one) => (
        <button key={one.key} type="button" aria-pressed={d === one.key} onClick={() => restart(one.key)}>
          <kbd>{one.kbd}</kbd> {one.label}
        </button>
      ))}
      <span className={s.round}>Looks</span>
      {LOOKS.map((one) => (
        <button key={one.key} type="button" aria-pressed={look === one.key} onClick={() => see(one.key)}>
          <kbd>{one.kbd}</kbd> {one.label}
        </button>
      ))}
      <span className={s.gap} />
      <button type="button" onClick={() => restart(d)}>
        <kbd>R</kbd> Update again
      </button>
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
  // The first time, the window opens as the direction has it after the update; a reload keeps where it was.
  useEffect(() => {
    if (window.location.hash === '' || window.location.hash === '#/') land(lab.get().d)
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
