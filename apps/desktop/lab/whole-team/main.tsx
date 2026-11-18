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
import { pages } from '../../src/renderer/features/browser/pages'
import { makeRouter } from '../../src/renderer/router'
import { fakeHost } from '../../tests/fixtures'
import { ALTHAR, MAYA_TASK_ID, MAYA_THREAD, MERIDIAN, makeClient, personOf, TABS, whoIsHere } from './data'
import { warmer } from './preview'
import { PhoneDesk } from './seams/Phone'
import { DIRECTIONS, directionOf, lab, useLab } from './state'
import s from './lab.module.css'

/*
 * The whole-team lab (README.md): the desktop app's window, whole, in the
 * browser, on made-up data, with the page's bar under it. The bar swaps the
 * exploration in place (A–E, with keys too) and steps through its moments
 * (1, 2, 3, or ← →); C goes to the engineer's phone with P.
 *
 * With `?app`, the page is the app the team works on, as it runs from a
 * task's copy: althar itself, on an empty project. `&after` is it with
 * Maya's change in. That is what the preview beside a conversation shows.
 */

const params = new URLSearchParams(window.location.search)
const preview = params.has('app')
if (preview && params.has('after')) warmer()

// The tabs this window keeps, the same at every load.
window.localStorage.setItem(
  'althar.tabs',
  JSON.stringify(preview ? { open: [MERIDIAN], places: {}, rooms: { [MERIDIAN]: 'board' } } : TABS),
)
window.localStorage.removeItem('althar.pages')
document.documentElement.dataset.theme = params.get('theme') === 'dark' ? 'dark' : 'light'

const client = makeClient()
const host = fakeHost()
// The page is the window: the app reads its host from here.
Object.defineProperty(window, 'althar', { value: host, configurable: true })
const cache = makeQueryClient()
const services = { client, host, cache, feed: follow(client, cache) }
const router = makeRouter({ client, cache })

/** Where each exploration's moment is, in the app. */
const go = () => {
  if (preview) return void router.navigate({ to: '/projects/$projectId', params: { projectId: MERIDIAN } })
  const { d, m } = lab.get()
  const onTask = (d === 'b' || (d === 'c' && m > 0) || (d === 'd' && m === 1)) && !lab.get().phone
  // The page beside a conversation: the running app, beside Maya's.
  pages.hide(ALTHAR)
  pages.hide(MAYA_TASK_ID)
  if (d === 'a') pages.place(ALTHAR, 'beside', { kind: 'project', projectId: ALTHAR, draft: `coordinator:${ALTHAR}` })
  if (d === 'b' || (d === 'd' && m === 1))
    pages.place(MAYA_TASK_ID, 'beside', { kind: 'task', threadId: MAYA_THREAD, draft: `thread:${MAYA_THREAD}` })
  if (onTask) void router.navigate({ to: '/threads/$threadId', params: { threadId: MAYA_THREAD } })
  else if (d === 'd')
    void router.navigate({ to: '/projects/$projectId', params: { projectId: ALTHAR }, search: { room: Room.Settings, section: 'rules' } })
  else void router.navigate({ to: '/projects/$projectId', params: { projectId: ALTHAR }, search: { room: Room.Both } })
}

/** A new moment changes the world: everything is read again. */
lab.subscribe(() => {
  void cache.invalidateQueries()
  go()
})

const Who = () => {
  const who = personOf(whoIsHere())
  return (
    <span className={s.who}>
      <span className={s.face} data-ink={who.ink} aria-hidden>
        {who.name[0]}
      </span>
      {who.name.split(' ')[0]} · {who.role.toLowerCase()}
    </span>
  )
}

function Bar() {
  const { d, m, phone } = useLab()
  const direction = directionOf(d)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (target !== null && (target.isContentEditable || target.closest('input, textarea, [contenteditable="true"]') !== null)) return
      const key = event.key.toLowerCase()
      const found = DIRECTIONS.find((one) => one.kbd.toLowerCase() === key)
      if (found !== undefined) return lab.set({ d: found.key })
      if (/^[1-9]$/.test(key)) return lab.set({ m: Number(key) - 1 })
      if (key === 'arrowright') return lab.set({ m: lab.get().m + 1 })
      if (key === 'arrowleft') return lab.set({ m: lab.get().m - 1 })
      if (key === 'p') return lab.set({ phone: !lab.get().phone })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <div className={s.bar} role="toolbar" aria-label="Explorations">
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
      {d === 'c' && (
        <button type="button" aria-pressed={phone} onClick={() => lab.set({ phone: !phone })}>
          <kbd>P</kbd> Phone
        </button>
      )}
      <span className={s.gap} />
      <Who />
    </div>
  )
}

function Lab() {
  const { d, phone } = useLab()
  useEffect(go, [])
  if (preview)
    return (
      <div className={s.window} data-preview>
        <ServicesProvider value={services}>
          <RouterProvider router={router} />
        </ServicesProvider>
      </div>
    )
  return (
    <div className={s.lab}>
      <div className={s.desk}>
        {d === 'c' && phone ? (
          <PhoneDesk />
        ) : (
          <div className={s.window} data-lab-window>
            <ServicesProvider value={services}>
              <RouterProvider router={router} />
            </ServicesProvider>
          </div>
        )}
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
