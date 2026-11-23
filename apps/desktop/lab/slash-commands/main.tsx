import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'
import '../../src/renderer/app.css'

import { RouterProvider } from '@tanstack/react-router'
import { StrictMode, useEffect, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'

import { follow } from '../../src/renderer/data/feed'
import { makeQueryClient } from '../../src/renderer/data/reads'
import { ServicesProvider } from '../../src/renderer/data/services'
import { makeRouter } from '../../src/renderer/router'
import { fakeHost } from '../../tests/fixtures'
import { openConversation } from './asides'
import { ALTHAR, ASIDE, type GoalPreset, makeClient, TABS, TASK, world } from './data'
import { DIRECTIONS, lab, type Place, PLACES, useLab } from './state'
import s from './lab.module.css'

/*
 * The slash commands lab (README.md): the desktop app's window, whole, in the
 * browser, on made-up data, with the page's bar under it. The bar swaps the
 * direction of the composer's commands in place (0 today's, A–D, with keys
 * too), opens the composer of a task, an aside or the coordinator (1–3), sets
 * the task's goal as it stands (G: none, at work, paused), lists the commands
 * to come beside /goal (M), narrows the window to the app's narrowest (N), and
 * turns the appearance dark (T). Keys go to the bar only outside a field.
 */

window.localStorage.setItem('althar.tabs', JSON.stringify(TABS))
window.localStorage.removeItem('althar.drafts')

const client = makeClient()
const host = fakeHost()
// The page is the window: the app reads its host from here.
Object.defineProperty(window, 'althar', { value: host, configurable: true })
const cache = makeQueryClient()
const services = { client, host, cache, feed: follow(client, cache) }
const router = makeRouter({ client, cache })

/** What the fake runtime holds changed (a goal set, something landed in a thread): the window reads again. */
world.onChange(() => void cache.invalidateQueries())

const threadOf = (place: Place) => (place === 'aside' ? ASIDE : TASK)

const go = (place: Place) => {
  if (place === 'task') {
    void router.navigate({ to: '/threads/$threadId', params: { threadId: TASK } })
    return
  }
  void router.navigate({ to: '/projects/$projectId', params: { projectId: ALTHAR } }).then(() => {
    openConversation(place === 'aside' ? 't_dock-flicker' : null)
  })
}

const PRESETS: ReadonlyArray<GoalPreset> = ['none', 'active', 'paused']
const GOAL_WORDS: Record<GoalPreset, string> = { none: 'No goal', active: 'Goal at work', paused: 'Goal paused' }
const nextPreset = (place: Place) => {
  const now = world.presetOf(threadOf(place))
  world.preset(threadOf(place), PRESETS[(PRESETS.indexOf(now) + 1) % PRESETS.length] ?? 'none')
}

function Bar() {
  const { d, place, more, narrow, dark } = useLab()
  const preset = useSyncExternalStore(world.onChange, () => world.presetOf(threadOf(place)))
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (target !== null && (target.isContentEditable || target.closest('input, textarea, [contenteditable="true"]') !== null)) return
      const key = event.key.toLowerCase()
      const direction = DIRECTIONS.find((one) => one.kbd.toLowerCase() === key)
      if (direction !== undefined) return lab.set({ d: direction.key })
      const where = PLACES.find((one) => one.kbd === key)
      if (where !== undefined) {
        lab.set({ place: where.key })
        return go(where.key)
      }
      if (key === 'g') return nextPreset(lab.get().place)
      if (key === 'm') return lab.set({ more: !lab.get().more })
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
      <span className={s.round}>In</span>
      {PLACES.map((one) => (
        <button
          key={one.key}
          type="button"
          aria-pressed={place === one.key}
          onClick={() => {
            lab.set({ place: one.key })
            go(one.key)
          }}
        >
          <kbd>{one.kbd}</kbd> {one.label}
        </button>
      ))}
      <span className={s.gap} />
      <button type="button" disabled={place === 'coordinator'} onClick={() => nextPreset(place)}>
        <kbd>G</kbd> {place === 'coordinator' ? 'No goals here' : GOAL_WORDS[preset]}
      </button>
      <button type="button" aria-pressed={more} onClick={() => lab.set({ more: !more })}>
        <kbd>M</kbd> More commands
      </button>
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
  useEffect(() => go(lab.get().place), [])
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
