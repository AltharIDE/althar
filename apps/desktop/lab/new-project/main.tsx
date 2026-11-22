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
import { makeClient } from './data'
import { Guide } from './directions/b'
import { startNew, useGuide, wire } from './entries'
import { DIRECTIONS, lab, useLab, WELCOMES } from './state'
import './welcome/transition.css'
import { HOME, homesHost, onOpenProject, world } from './world'
import s from './lab.module.css'

/*
 * The new project lab (README.md): the desktop app's window, whole, in the
 * browser, on a made-up home, with the page's bar under it. The bar swaps
 * the welcome an empty home opens on (1–4, 0 for none, starting over), the
 * direction its New project goes on with in place (A–D, keys too), the home the window is on (H:
 * runner-1 or this Mac), light and dark (T), the app's narrowest window (N),
 * whether the home's next clone drops partway (F), and Settings on the home
 * as today rather than as proposed (S). R starts over.
 */

const client = makeClient()
const host = fakeHost({ homes: homesHost })
// The page is the window: the app reads its host from here.
Object.defineProperty(window, 'althar', { value: host, configurable: true })
const cache = makeQueryClient()
const services = { client, host, cache, feed: follow(client, cache) }
const router = makeRouter({ client, cache })
wire(router, client)

// What the home changes is read again, as the runtime's feed would have it: a frame at most.
let pending = false
world.subscribe(() => {
  if (pending) return
  pending = true
  requestAnimationFrame(() => {
    pending = false
    void cache.invalidateQueries()
  })
})
onOpenProject((projectId) => {
  if (projectId === '__new__') return startNew()
  void router.navigate({ to: '/projects/$projectId', params: { projectId } })
})

function Bar() {
  const { w, d, home, dark, narrow, fail, settings } = useLab()
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (target !== null && (target.isContentEditable || target.closest('input, textarea, [contenteditable="true"]') !== null)) return
      const key = event.key.toLowerCase()
      const direction = DIRECTIONS.find((one) => one.kbd.toLowerCase() === key)
      if (direction !== undefined) return lab.set({ d: direction.key })
      const welcome = WELCOMES.find((one) => one.key === key)
      if (welcome !== undefined) return lab.restart({ w: welcome.key })
      if (key === 'h') return lab.restart({ home: lab.get().home === 'mac' ? 'runner' : 'mac' })
      if (key === 't') return lab.set({ dark: !lab.get().dark })
      if (key === 'n') return lab.set({ narrow: !lab.get().narrow })
      if (key === 'f') return lab.restart({ fail: !lab.get().fail })
      if (key === 's') return lab.reload({ settings: lab.get().settings === 'today' ? 'proposed' : 'today' })
      if (key === 'r') return lab.restart()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <div className={s.bar} role="toolbar" aria-label="Directions">
      <span className={s.group}>Welcome</span>
      {WELCOMES.map((one) => (
        <button
          key={one.key}
          type="button"
          aria-pressed={w === one.key}
          onClick={() => lab.restart({ w: one.key })}
          title="Starts over on the home, with this welcome"
        >
          <kbd>{one.key}</kbd> {one.label}
        </button>
      ))}
      <span className={s.group}>then</span>
      {DIRECTIONS.map((one) => (
        <button key={one.key} type="button" aria-pressed={d === one.key} onClick={() => lab.set({ d: one.key })}>
          <kbd>{one.kbd}</kbd> {one.label}
        </button>
      ))}
      <span className={s.gap} />
      <button type="button" onClick={() => lab.restart({ home: home === 'mac' ? 'runner' : 'mac' })} title="Starts over on the other home">
        <kbd>H</kbd> {home === 'mac' ? 'This Mac' : 'runner-1'}
      </button>
      <button type="button" aria-pressed={dark} onClick={() => lab.set({ dark: !dark })}>
        <kbd>T</kbd> Dark
      </button>
      <button type="button" aria-pressed={narrow} onClick={() => lab.set({ narrow: !narrow })}>
        <kbd>N</kbd> Narrow
      </button>
      <button
        type="button"
        aria-pressed={fail}
        onClick={() => lab.restart({ fail: !fail })}
        title="Starts over, with the next clone dropping partway"
      >
        <kbd>F</kbd> Drops
      </button>
      <button
        type="button"
        aria-pressed={settings === 'today'}
        onClick={() => lab.reload({ settings: settings === 'today' ? 'proposed' : 'today' })}
        title="Settings on the home: as today, or by whose each setting is"
      >
        <kbd>S</kbd> Old settings
      </button>
      <button type="button" onClick={() => lab.restart()}>
        <kbd>R</kbd> Restart
      </button>
    </div>
  )
}

function Lab() {
  const { narrow, d } = useLab()
  const guiding = useGuide()
  return (
    <div className={s.lab}>
      <div className={s.desk}>
        <div className={s.window} data-narrow={narrow || undefined} data-lab-window>
          <ServicesProvider value={services}>
            <RouterProvider router={router} />
            {guiding && d === 'b' && <Guide router={router} />}
          </ServicesProvider>
        </div>
      </div>
      <Bar />
    </div>
  )
}

document.title = `New project lab · ${HOME.name}`
const root = document.getElementById('root')
if (root !== null)
  createRoot(root).render(
    <StrictMode>
      <Lab />
    </StrictMode>,
  )
