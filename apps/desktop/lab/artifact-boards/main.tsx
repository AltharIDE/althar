import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'
import '../../src/renderer/app.css'

import { RouterProvider } from '@tanstack/react-router'
import { Room } from '@althar/ui'
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { follow } from '../../src/renderer/data/feed'
import { makeQueryClient } from '../../src/renderer/data/reads'
import { ServicesProvider } from '../../src/renderer/data/services'
import { pages } from '../../src/renderer/features/browser/pages'
import { chooseFace } from '../../src/renderer/features/task/chosenFaces'
import { makeRouter } from '../../src/renderer/router'
import { fakeHost } from '../../tests/fixtures'
import { GIFT_TASK_ID, GIFT_THREAD, KILN, makeClient, TABS } from './data'
import { live } from './live'
import { momentOf, seed } from './moments'
import { GIT, NOTES, PICK } from './notes'
import { Shared } from './Shared'
import { DIRECTIONS, directionOf, lab, useLab } from './state'
import s from './lab.module.css'

/*
 * The artifact boards lab (README.md): the desktop app's window, whole, in
 * the browser, on made-up data, with the page's bar under it. The bar swaps
 * the direction in place (A–D, with keys too), steps through its moments
 * (1, 2, 3…), opens what the direction is for and what it would take (N),
 * and turns the window dark (T). From each moment on, everything is live.
 */

// The tabs this window keeps, the same at every load; the canvas beside a conversation as wide as leaves the conversation room.
window.localStorage.setItem('althar.tabs', JSON.stringify(TABS))
window.localStorage.removeItem('althar.pages')
window.localStorage.setItem('althar.bench.page', String(Math.max(480, window.innerWidth - 480)))

const theme = (dark: boolean) => {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
}
theme(lab.get().dark)

const client = makeClient()
const host = fakeHost()
// The page is the window: the app reads its host from here.
Object.defineProperty(window, 'althar', { value: host, configurable: true })
const cache = makeQueryClient()
const services = { client, host, cache, feed: follow(client, cache) }
const router = makeRouter({ client, cache })

/** Where each direction's moment is in the app: Gift a class's conversation, its canvas beside it (A, D); the project's Artifacts (B, C). */
const go = () => {
  const { d } = lab.get()
  pages.hide(GIFT_TASK_ID)
  if (d === 'b' || d === 'c') {
    void router.navigate({ to: '/projects/$projectId', params: { projectId: KILN }, search: { room: Room.Artifacts } })
    return
  }
  chooseFace(GIFT_TASK_ID, 'talk')
  void router.navigate({ to: '/threads/$threadId', params: { threadId: GIFT_THREAD } })
}

// What is said on the canvas shows in the conversation at once.
live.subscribe(() => void cache.invalidateQueries())

/** A new moment starts the world afresh, and the app where the moment is; a change of theme changes only the theme. */
let was = { d: lab.get().d, m: lab.get().m, dark: lab.get().dark }
seed(was.d, was.m)
lab.subscribe(() => {
  const now = lab.get()
  theme(now.dark)
  if (now.dark !== was.dark && now.d === was.d && now.m === was.m) {
    was = now
    return
  }
  was = now
  seed(now.d, now.m)
  void cache.invalidateQueries()
  void router.navigate({ to: '/projects/$projectId', params: { projectId: KILN }, search: { room: Room.Both } }).then(go)
})

function Bar({ note, onNote }: { note: boolean; onNote: (open: boolean) => void }) {
  const { d, m, dark } = useLab()
  const direction = directionOf(d)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
      if (target !== null && (target.isContentEditable || target.closest('input, textarea, [contenteditable="true"]') !== null)) return
      const key = event.key.toLowerCase()
      const found = DIRECTIONS.find((one) => one.kbd.toLowerCase() === key)
      if (found !== undefined) return lab.set({ d: found.key })
      if (/^[1-9]$/.test(key)) return lab.set({ m: Number(key) - 1 })
      if (key === 'n') return onNote(!note)
      if (key === 't') return lab.set({ dark: !lab.get().dark })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [note, onNote])
  return (
    <div className={s.bar} role="toolbar" aria-label="The lab's directions">
      {DIRECTIONS.map((one) => (
        <button key={one.key} type="button" aria-pressed={d === one.key} onClick={() => lab.set({ d: one.key })}>
          <kbd>{one.kbd}</kbd> {one.label}
        </button>
      ))}
      <span className={s.round}>Moment</span>
      {direction.moments.map((label, i) => (
        <button key={label} type="button" aria-pressed={m === i} onClick={() => lab.set({ m: i })}>
          <kbd>{i + 1}</kbd> {label}
        </button>
      ))}
      <span className={s.gap} />
      <button type="button" aria-pressed={note} onClick={() => onNote(!note)}>
        <kbd>N</kbd> What it’s for
      </button>
      <button type="button" aria-pressed={dark} onClick={() => lab.set({ dark: !dark })}>
        <kbd>T</kbd> {dark ? 'Dark' : 'Light'}
      </button>
    </div>
  )
}

function Note({ onClose }: { onClose: () => void }) {
  const { d } = useLab()
  const note = NOTES[d]
  return (
    <aside className={s.note} aria-label="What this direction is for">
      <div className={s.noteHead}>
        <span className={s.noteKey}>{directionOf(d).kbd}</span>
        <span className={s.noteTitle}>{directionOf(d).label}</span>
        <button type="button" className={s.noteClose} onClick={onClose} aria-label="Close the note">
          ×
        </button>
      </div>
      <h3>What it’s for</h3>
      <p>{note.for}</p>
      <h3>What it would take</h3>
      <p>{note.build}</p>
      <p className={s.noteSize}>{note.size}</p>
      <h3>Saving to a repo, in every direction</h3>
      <p>{GIT.for}</p>
      <p>{GIT.build}</p>
      <p className={s.notePick}>{PICK}</p>
    </aside>
  )
}

function Lab() {
  const { d, m } = useLab()
  const [note, setNote] = useState(new URLSearchParams(window.location.search).get('note') === '1')
  useEffect(go, [])
  const guest = momentOf(d, m).guest === true
  return (
    <div className={s.lab}>
      <div className={s.desk}>
        <div className={s.window} data-lab-window hidden={guest}>
          <ServicesProvider value={services}>
            <RouterProvider router={router} />
          </ServicesProvider>
        </div>
        {guest && <Shared />}
        {note && <Note onClose={() => setNote(false)} />}
      </div>
      <Bar note={note} onNote={setNote} />
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
