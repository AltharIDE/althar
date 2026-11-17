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
import { NewProjectArrival, WelcomeArrival } from './Arrival'
import { ALTHAR, makeClient, tabsOf } from './data'
import { DIRECTIONS, type Direction, eraOf, lab, type Place, useLab } from './state'
import { world } from './world'
import s from './lab.module.css'

/*
 * The import lab (README.md): the desktop app's window, whole, in the
 * browser, on made-up data, with the page's bar under it. Arriving (A–J):
 * the first run's welcome (W) or a New project tab (P), then the project's
 * board. Later (1–3): weeks on, from Settings. R starts again, T the dark
 * appearance.
 */

// The era the address asks for, so a reload opens on the same world.
const era = eraOf(lab.get().d)
if (world.era() !== era) world.reset(era)
// Opened on the board after the way in, as if it had come through it with nothing changed; C leaves it all to the board.
if (era === 'arriving' && lab.get().place === 'app' && lab.get().d !== 'c') world.arrived()
// Keeping in step opens with Conductor and Claude Code kept, as someone who still uses both would have them.
if (lab.get().d === '3') for (const who of ['conductor', 'claude-code'] as const) world.keep(who, true)
window.localStorage.setItem('althar.tabs', JSON.stringify(tabsOf()))
document.documentElement.dataset.theme = lab.get().dark ? 'dark' : 'light'

const client = makeClient()
const host = fakeHost()
// The page is the window: the app reads its host from here.
Object.defineProperty(window, 'althar', { value: host, configurable: true })
const cache = makeQueryClient()
const services = { client, host, cache, feed: follow(client, cache) }
const router = makeRouter({ client, cache })

/** What was brought in changes the world: the board and threads are read again. */
world.subscribe(() => void cache.invalidateQueries())

/** Where a direction opens in the app: the board, or where in Settings it lives. */
const openApp = (d: Direction) => {
  if (d === '2') return void router.navigate({ to: '/settings/$section', params: { section: 'other-tools' as never } })
  if (d === '1' || d === '3')
    return void router.navigate({
      to: '/projects/$projectId',
      params: { projectId: ALTHAR },
      search: { room: 'settings', section: 'import' } as never,
    })
  void router.navigate({ to: '/projects/$projectId', params: { projectId: ALTHAR }, search: {} as never })
}

/** Starts over, on a direction and place: the world as it was, read afresh. */
const restart = (d: Direction, place: Place) => {
  lab.set({ d, place: eraOf(d) === 'later' ? 'app' : place })
  world.reset(eraOf(d))
  window.location.hash = ''
  window.location.reload()
}

function Bar() {
  const { d, place, dark } = useLab()
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (target !== null && (target.isContentEditable || target.closest('input, textarea, [contenteditable="true"]') !== null)) return
      const key = event.key.toLowerCase()
      const direction = DIRECTIONS.find((one) => one.kbd.toLowerCase() === key)
      const now = lab.get()
      if (direction !== undefined) {
        // Within a set, the direction swaps in place; between sets, the world is another time.
        if (eraOf(direction.key) === eraOf(now.d) && now.place !== 'app') return lab.set({ d: direction.key })
        return restart(direction.key, now.place === 'app' ? 'welcome' : now.place)
      }
      if (key === 'w') return restart(eraOf(now.d) === 'later' ? 'a' : now.d, 'welcome')
      if (key === 'p') return restart(eraOf(now.d) === 'later' ? 'a' : now.d, 'new')
      if (key === 'r') return restart(now.d, eraOf(now.d) === 'later' ? 'app' : 'welcome')
      if (key === 't') return lab.set({ dark: !now.dark })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const pick = (key: Direction) => {
    if (eraOf(key) === eraOf(d) && place !== 'app') lab.set({ d: key })
    else restart(key, place === 'app' ? 'welcome' : place)
  }
  const set = (group: (typeof DIRECTIONS)[number]['group']) =>
    DIRECTIONS.filter((one) => one.group === group).map((one) => (
      <button key={one.key} type="button" aria-pressed={d === one.key} onClick={() => pick(one.key)}>
        <kbd>{one.kbd}</kbd> {one.label}
      </button>
    ))
  const arriving = eraOf(d) === 'arriving'
  return (
    <div className={s.bar} role="toolbar" aria-label="Directions">
      {(['Arriving', 'Shortcuts', 'Later'] as const).map((group) => (
        <span key={group} className={s.group}>
          <span className={s.round}>{group}</span>
          {set(group)}
        </span>
      ))}
      <span className={s.gap} />
      <button type="button" aria-pressed={arriving && place === 'welcome'} onClick={() => restart(arriving ? d : 'a', 'welcome')}>
        <kbd>W</kbd> First run
      </button>
      <button type="button" aria-pressed={arriving && place === 'new'} onClick={() => restart(arriving ? d : 'a', 'new')}>
        <kbd>P</kbd> New project
      </button>
      <button type="button" onClick={() => restart(d, arriving ? 'welcome' : 'app')}>
        <kbd>R</kbd> Start over
      </button>
      <button type="button" aria-pressed={dark} onClick={() => lab.set({ dark: !dark })}>
        <kbd>T</kbd> Dark
      </button>
    </div>
  )
}

function App() {
  const { d } = useLab()
  useEffect(() => {
    if (window.location.hash === '' || window.location.hash === '#/') openApp(lab.get().d)
  }, [])
  void d
  return (
    <ServicesProvider value={services}>
      <RouterProvider router={router} />
    </ServicesProvider>
  )
}

function Lab() {
  const { place } = useLab()
  const toApp = () => {
    lab.set({ place: 'app' })
    window.localStorage.setItem('althar.tabs', JSON.stringify(tabsOf()))
  }
  return (
    <div className={s.lab}>
      <div className={s.desk}>
        <div className={s.window} data-lab-window>
          {place === 'welcome' ? <WelcomeArrival onOpen={toApp} /> : place === 'new' ? <NewProjectArrival onCreated={toApp} /> : <App />}
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
