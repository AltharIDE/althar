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
import { DIRECTIONS, lab, useLab } from './state.ts'
import { ALTHAR, makeClient, TABS } from './world.ts'
import s from './lab.module.css'

/*
 * The usage lab (README.md): the desktop app's window, whole, in the browser,
 * on made-up data, opened on althar's Usage view, with the page's bar under
 * it. The bar swaps the direction in place (A–D, with keys too), draws it
 * dark (T), and narrows the window to the app's narrowest (N).
 */

// The tabs this window keeps, the same at every load.
window.localStorage.setItem('althar.tabs', JSON.stringify(TABS))

const client = makeClient()
const host = fakeHost()
// The page is the window: the app reads its host from here.
Object.defineProperty(window, 'althar', { value: host, configurable: true })
const cache = makeQueryClient()
const services = { client, host, cache, feed: follow(client, cache) }
const router = makeRouter({ client, cache })

function Bar() {
  const { d, dark, narrow } = useLab()
  useEffect(() => {
    // Before the app's own keys (c and b show its panes): the lab's keys are the lab's.
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (target !== null && (target.isContentEditable || target.closest('input, textarea, [contenteditable="true"]') !== null)) return
      const key = event.key.toLowerCase()
      const direction = DIRECTIONS.find((one) => one.kbd.toLowerCase() === key)
      const act =
        direction !== undefined
          ? () => lab.set({ d: direction.key })
          : key === 't'
            ? () => lab.set({ dark: !lab.get().dark })
            : key === 'n'
              ? () => lab.set({ narrow: !lab.get().narrow })
              : null
      if (act === null) return
      event.preventDefault()
      event.stopImmediatePropagation()
      act()
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [])
  return (
    <div className={s.bar} role="toolbar" aria-label="Directions">
      {DIRECTIONS.map((one) => (
        <button key={one.key} type="button" aria-pressed={d === one.key} onClick={() => lab.set({ d: one.key })}>
          <kbd>{one.kbd}</kbd> {one.label}
        </button>
      ))}
      <span className={s.gap} />
      <button type="button" aria-pressed={dark} onClick={() => lab.set({ dark: !dark })}>
        <kbd>T</kbd> Dark
      </button>
      <button type="button" aria-pressed={narrow} onClick={() => lab.set({ narrow: !narrow })}>
        <kbd>N</kbd> Narrow
      </button>
    </div>
  )
}

function Lab() {
  const { narrow } = useLab()
  // Opened on althar's Usage, the first time.
  useEffect(() => {
    if (window.location.hash === '' || window.location.hash === '#/')
      void router.navigate({ to: '/projects/$projectId', params: { projectId: ALTHAR }, search: { room: 'usage' as never } })
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
