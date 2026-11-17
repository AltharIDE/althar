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
import { chooseFace } from '../../src/renderer/features/task/chosenFaces'
import { makeClient, TABS, TASK_ID, TASK_THREAD } from './data'
import { DIRECTIONS, ENDINGS, lab, useLab } from './state'
import s from './lab.module.css'

/*
 * The issue part lab (README.md): the desktop app's window, whole, in the
 * browser, on made-up data, opened on a task that came from DEV-211, with the
 * page's bar under it. The bar swaps the direction in place (0 today's, A–D),
 * where the task stands with its pull request (1 none yet, 2 #1012 open, 3 a
 * task that ends with none), a second issue for the crowded case (T), and the
 * app's narrowest window (N). Keys too.
 */

window.localStorage.setItem('althar.tabs', JSON.stringify(TABS))
// The task opens on its conversation, where its issue heads the thread.
chooseFace(TASK_ID, 'talk')
document.documentElement.dataset.theme = new URLSearchParams(window.location.search).get('theme') === 'dark' ? 'dark' : 'light'

const client = makeClient()
const host = fakeHost()
// The page is the window: the app reads its host from here.
Object.defineProperty(window, 'althar', { value: host, configurable: true })
const cache = makeQueryClient()
const services = { client, host, cache, feed: follow(client, cache) }
const router = makeRouter({ client, cache })

/** A new ending changes the task: its thread and the board are read again. */
let ending = lab.get().ending
lab.subscribe(() => {
  if (lab.get().ending === ending) return
  ending = lab.get().ending
  void cache.invalidateQueries()
})

function Bar() {
  const { d, ending, two, narrow } = useLab()
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (target !== null && (target.isContentEditable || target.closest('input, textarea, [contenteditable="true"]') !== null)) return
      const key = event.key.toLowerCase()
      const direction = DIRECTIONS.find((one) => one.kbd.toLowerCase() === key)
      if (direction !== undefined) return lab.set({ d: direction.key })
      const end = ENDINGS.find((one) => one.kbd === key)
      if (end !== undefined) return lab.set({ ending: end.key })
      if (key === 't') return lab.set({ two: !lab.get().two })
      if (key === 'n') return lab.set({ narrow: !lab.get().narrow })
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
      <span className={s.round}>Task</span>
      {ENDINGS.map((one) => (
        <button key={one.key} type="button" aria-pressed={ending === one.key} onClick={() => lab.set({ ending: one.key })}>
          <kbd>{one.kbd}</kbd> {one.label}
        </button>
      ))}
      <span className={s.gap} />
      <button type="button" aria-pressed={two} onClick={() => lab.set({ two: !two })}>
        <kbd>T</kbd> Two issues
      </button>
      <button type="button" aria-pressed={narrow} onClick={() => lab.set({ narrow: !narrow })}>
        <kbd>N</kbd> Narrow
      </button>
    </div>
  )
}

function Lab() {
  const { narrow } = useLab()
  // Opened on the task, the first time.
  useEffect(() => {
    if (window.location.hash === '' || window.location.hash === '#/')
      void router.navigate({ to: '/threads/$threadId', params: { threadId: TASK_THREAD } })
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
