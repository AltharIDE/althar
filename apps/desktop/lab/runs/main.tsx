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
import { Tray } from './Below'
import { ALTHAR, makeClient, TABS } from './data'
import { TabScreen } from './OwnTab'
import { DIRECTIONS, lab, SCENES, useLab } from './state'
import { toggleTerminal } from './terminal'
import { world } from './world'
import s from './lab.module.css'

/*
 * The runs and terminal lab (README.md): the desktop app's window, whole, in
 * the browser, on made-up data, with the page's bar under it. The bar swaps
 * where a run and a terminal live in place (0 today's, A–D, with keys too),
 * opens the world on a scene (Q nothing ran, F a run failed, M many), narrows
 * the window to the app's narrowest (N), and turns the theme (T).
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

// What the app's own screens read changed (a run started, answered, ended): they read it again, once a frame.
let asked = false
world.onStructure(() => {
  if (asked) return
  asked = true
  requestAnimationFrame(() => {
    asked = false
    void cache.invalidateQueries()
  })
})

// Another scene, or another direction, starts the world again from it.
let was = lab.get()
lab.subscribe(() => {
  const now = lab.get()
  if (now.scene !== was.scene || now.d !== was.d) world.reset(now.scene)
  was = now
})

function Bar() {
  const { d, scene, narrow, dark } = useLab()
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Ctrl+`: the terminal, wherever the direction keeps it, from anywhere.
      if (event.ctrlKey && event.key === '`') {
        event.preventDefault()
        toggleTerminal()
        return
      }
      const target = event.target as HTMLElement | null
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (target !== null && (target.isContentEditable || target.closest('input, textarea, [contenteditable="true"]') !== null)) return
      const key = event.key.toLowerCase()
      const direction = DIRECTIONS.find((one) => one.kbd.toLowerCase() === key)
      if (direction !== undefined) return lab.set({ d: direction.key })
      const picked = SCENES.find((one) => one.kbd.toLowerCase() === key)
      if (picked !== undefined) return lab.set({ scene: picked.key })
      if (key === 'n') return lab.set({ narrow: !lab.get().narrow })
      if (key === 't') return lab.set({ dark: !lab.get().dark })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <div className={s.bar} role="toolbar" aria-label="Directions">
      {DIRECTIONS.map((one) => (
        <button key={one.key} type="button" aria-pressed={d === one.key} onClick={() => lab.set({ d: one.key })}>
          <kbd>{one.kbd}</kbd> {one.label}
        </button>
      ))}
      <span className={s.gap} />
      {SCENES.map((one) => (
        <button key={one.key} type="button" aria-pressed={scene === one.key} onClick={() => lab.set({ scene: one.key })}>
          <kbd>{one.kbd}</kbd> {one.label}
        </button>
      ))}
      <span className={s.rule} />
      <button type="button" aria-pressed={narrow} onClick={() => lab.set({ narrow: !narrow })}>
        <kbd>N</kbd> Narrow
      </button>
      <button type="button" aria-pressed={dark} onClick={() => lab.set({ dark: !dark })}>
        <kbd>T</kbd> Dark
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
            <div className={s.app}>
              <RouterProvider router={router} />
            </div>
            <Tray />
            <TabScreen />
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
