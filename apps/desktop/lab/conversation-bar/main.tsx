import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'
import '../../src/renderer/app.css'

import { RouterProvider } from '@tanstack/react-router'
import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'

import { follow } from '../../src/renderer/data/feed'
import { makeQueryClient } from '../../src/renderer/data/reads'
import { ServicesProvider } from '../../src/renderer/data/services'
import { makeRouter } from '../../src/renderer/router'
import { fakeHost } from '../../tests/fixtures'
import { ALTHAR, makeClient, TABS } from './data'
import { DIRECTIONS, lab, useLab } from './state'
import s from './lab.module.css'

/*
 * The conversation bar lab (README.md): the desktop app's window, whole, in
 * the browser, on made-up data, with the page's bar under it. The bar swaps
 * the direction of the bar over the coordinator's conversation in place
 * (0 today's, A–E, and C again in 1–4, with keys too), adds asides for the
 * crowded case (M), narrows the window to the app's narrowest (N), and gives
 * the asides the short names they would give themselves (S).
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
const router = makeRouter({ client, cache })

/** "Many" changes the world: the board is read again. */
lab.subscribe(() => void cache.invalidateQueries())

function Bar() {
  const { d, many, narrow, named } = useLab()
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (target !== null && (target.isContentEditable || target.closest('input, textarea, [contenteditable="true"]') !== null)) return
      const key = event.key.toLowerCase()
      const direction = DIRECTIONS.find((one) => one.kbd.toLowerCase() === key)
      if (direction !== undefined) return lab.set({ d: direction.key })
      if (key === 'm') return lab.set({ many: !lab.get().many })
      if (key === 'n') return lab.set({ narrow: !lab.get().narrow })
      if (key === 's') return lab.set({ named: !lab.get().named })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <div className={s.bar} role="toolbar" aria-label="Directions">
      {DIRECTIONS.filter((one) => one.round === 1).map((one) => (
        <button key={one.key} type="button" aria-pressed={d === one.key} onClick={() => lab.set({ d: one.key })}>
          <kbd>{one.kbd}</kbd> {one.label}
        </button>
      ))}
      <span className={s.round}>C again</span>
      {DIRECTIONS.filter((one) => one.round === 2).map((one) => (
        <button key={one.key} type="button" aria-pressed={d === one.key} onClick={() => lab.set({ d: one.key })}>
          <kbd>{one.kbd}</kbd> {one.label}
        </button>
      ))}
      <span className={s.gap} />
      <button type="button" aria-pressed={many} onClick={() => lab.set({ many: !many })}>
        <kbd>M</kbd> Many
      </button>
      <button type="button" aria-pressed={narrow} onClick={() => lab.set({ narrow: !narrow })}>
        <kbd>N</kbd> Narrow
      </button>
      <button type="button" aria-pressed={named} onClick={() => lab.set({ named: !named })}>
        <kbd>S</kbd> Self-named
      </button>
    </div>
  )
}

function Lab() {
  const { narrow } = useLab()
  // Opened on althar's project, the first time.
  useEffect(() => {
    if (window.location.hash === '' || window.location.hash === '#/')
      void router.navigate({ to: '/projects/$projectId', params: { projectId: ALTHAR } })
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
