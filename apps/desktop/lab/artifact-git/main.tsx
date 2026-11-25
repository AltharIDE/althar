import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'
import '../../src/renderer/app.css'

import { RouterProvider } from '@tanstack/react-router'
import { Room } from '@althar/ui'
import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'

import { follow } from '../../src/renderer/data/feed'
import { makeQueryClient } from '../../src/renderer/data/reads'
import { ServicesProvider } from '../../src/renderer/data/services'
import { askToOpen } from '../../src/renderer/features/canvases/opening'
import { makeRouter } from '../../src/renderer/router'
import { fakeHost } from '../../tests/fixtures'
import { CANVAS, KILN, makeClient, STORY, TABS } from './data'
import { DIRECTIONS, lab, MOMENTS, PEOPLE, useLab, whoOf } from './state'
import s from './lab.module.css'

/*
 * The artifact-in-git lab (README.md): the desktop app's window, whole, in
 * the browser, on made-up data, open on Kiln's Booking page in its own room,
 * with the page's bar under it. The bar swaps the direction in place (A–D,
 * keys too) and steps through its moments (1–4, or ← →); its end says whose
 * Althar the window is: Maya's, a designer's, for the first three; Ana's, an
 * engineer's, for the last. T turns it dark, N narrows it.
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

/** The artifact, open as itself in Kiln's Artifacts. */
const go = () => {
  askToOpen(KILN, CANVAS)
  void router.navigate({ to: '/projects/$projectId', params: { projectId: KILN }, search: { room: Room.Artifacts } })
}

/**
 * A press in the lab, or a new moment, changes the world: the window reads the artifact and its chat again. Only those:
 * reading everything again sets the project's screen back to its start.
 */
const changed = new Set(['canvases', 'canvas', 'thread'])
lab.subscribe(() => void cache.invalidateQueries({ predicate: (query) => changed.has(String(query.queryKey[0])) }))

function Bar() {
  const { d, m, dark, narrow } = useLab()
  const who = PEOPLE[whoOf({ m })]
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (target !== null && (target.isContentEditable || target.closest('input, textarea, [contenteditable="true"]') !== null)) return
      const key = event.key.toLowerCase()
      const found = DIRECTIONS.find((one) => one.kbd.toLowerCase() === key)
      const change =
        found !== undefined
          ? { d: found.key }
          : /^[1-4]$/.test(key)
            ? { m: Number(key) - 1 }
            : key === 'arrowright'
              ? { m: lab.get().m + 1 }
              : key === 'arrowleft'
                ? { m: lab.get().m - 1 }
                : key === 't'
                  ? { dark: !lab.get().dark }
                  : key === 'n'
                    ? { narrow: !lab.get().narrow }
                    : null
      if (change === null) return
      // The bar's keys are its own: the app's (b and c change its rooms) never hear them.
      event.preventDefault()
      event.stopImmediatePropagation()
      lab.set(change)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
  return (
    <div className={s.bar} role="toolbar" aria-label="The lab’s directions">
      {DIRECTIONS.map((one) => (
        <button key={one.key} type="button" aria-pressed={d === one.key} title={STORY[one.key]} onClick={() => lab.set({ d: one.key })}>
          <kbd>{one.kbd}</kbd> {one.label}
        </button>
      ))}
      <span className={s.round}>Moment</span>
      {MOMENTS[d].map((label, i) => (
        <button key={label} type="button" aria-pressed={m === i} onClick={() => lab.set({ m: i })}>
          <kbd>{i + 1}</kbd> {label}
        </button>
      ))}
      <span className={s.gap} />
      <button type="button" aria-pressed={narrow} onClick={() => lab.set({ narrow: !narrow })}>
        <kbd>N</kbd> Narrow
      </button>
      <button type="button" aria-pressed={dark} onClick={() => lab.set({ dark: !dark })}>
        <kbd>T</kbd> Dark
      </button>
      <span className={s.who}>
        <span className={s.face} data-ink={who.ink} aria-hidden="true">
          {who.name.charAt(0)}
        </span>
        {who.name}’s Althar · {who.role}
      </span>
    </div>
  )
}

function Lab() {
  const { narrow } = useLab()
  useEffect(go, [])
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
