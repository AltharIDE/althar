import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'
import '../../src/renderer/app.css'

import { RouterProvider } from '@tanstack/react-router'
import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'

import { ServicesProvider } from '../../src/renderer/data/services'
import { PARTS } from './directions'
import { HomeConnections } from './seam/HomeConnections'
import { DIRECTIONS, lab, useLab } from './state'
import { forgetWindow, rereadAll, windowOf } from './windows'
import { againOf, homeOf, stateOf, useWorld, world } from './world'
import s from './lab.module.css'

/*
 * The homes lab (README.md): the desktop app's window, whole, in the
 * browser, on made-up data, with the page's bar under it. The bar swaps the
 * direction in place (0 as #982 has it, A–D, with keys too), brings a
 * window to the front (this computer's, or a home's once one is open),
 * drops the front window's connection (X) or makes its next connection fail
 * (F), and turns on many saved homes (M), a home with no projects (E), the
 * app's narrowest window (N) and dark (T). ⌘⇧H, Ctrl+Shift+H off a Mac, is
 * the File menu's Homes…, as #982 adds it.
 */

const theme = (dark: 'light' | 'dark') => {
  document.documentElement.dataset.theme = dark
}
theme(lab.get().theme)
lab.subscribe(() => theme(lab.get().theme))

// The page is the window: what reads it from here reads this computer's.
Object.defineProperty(window, 'althar', { value: windowOf('local').services.host, configurable: true })

/** "Many" and "Empty" change the world: every window reads again. */
let was = { many: lab.get().many, empty: lab.get().empty }
lab.subscribe(() => {
  const { many, empty } = lab.get()
  if (many !== was.many || empty !== was.empty) rereadAll()
  was = { many, empty }
})

const label = (id: string) => (id === 'local' ? 'This computer' : (homeOf(id)?.name ?? id))

function Bar() {
  const { d, w, many, empty, narrow, theme: dark } = useLab()
  useWorld()
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null
      // ⌘⇧H, Ctrl+Shift+H: the File menu's Homes…
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'h') {
        event.preventDefault()
        world.showHomes(lab.get().w)
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (target !== null && (target.isContentEditable || target.closest('input, textarea, select, [contenteditable="true"]') !== null))
        return
      if (document.querySelector('[role="dialog"], [role="menu"]') !== null && event.key !== 'Escape') {
        // A dialog or menu has the keys; the bar's letters wait.
        if (!/^[0abcd]$/i.test(event.key)) return
      }
      const key = event.key.toLowerCase()
      const direction = DIRECTIONS.find((one) => one.kbd.toLowerCase() === key)
      if (direction !== undefined) return lab.set({ d: direction.key })
      if (key === 'x') return world.drop(lab.get().w)
      if (key === 'f') return world.failNext()
      if (key === 'm') return lab.set({ many: !lab.get().many })
      if (key === 'e') return lab.set({ empty: !lab.get().empty })
      if (key === 'n') return lab.set({ narrow: !lab.get().narrow })
      if (key === 't') return lab.set({ theme: lab.get().theme === 'dark' ? 'light' : 'dark' })
      if (key === 'w') {
        const all = world.windows()
        return lab.set({ w: all[(all.indexOf(lab.get().w) + 1) % all.length] ?? 'local' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const remote = w !== 'local'
  return (
    <div className={s.bar} role="toolbar" aria-label="Directions">
      {DIRECTIONS.map((one) => (
        <button key={one.key} type="button" aria-pressed={d === one.key} onClick={() => lab.set({ d: one.key })}>
          <kbd>{one.kbd}</kbd> {one.label}
        </button>
      ))}
      <span className={s.round}>Window</span>
      {world.windows().map((id) => (
        <span key={id} className={s.windowChip}>
          <button type="button" aria-pressed={w === id} onClick={() => lab.set({ w: id })}>
            {label(id)}
          </button>
          {id !== 'local' && (
            <button
              type="button"
              className={s.closeWindow}
              aria-label={`Close ${label(id)}’s window`}
              onClick={() => {
                forgetWindow(id)
                world.closeWindow(id)
              }}
            >
              ×
            </button>
          )}
        </span>
      ))}
      <button type="button" disabled={!remote} onClick={() => world.drop(w)}>
        <kbd>X</kbd> Drop
      </button>
      <button type="button" aria-pressed={world.failing()} onClick={() => world.failNext()}>
        <kbd>F</kbd> Fail next
      </button>
      <span className={s.gap} />
      <button type="button" aria-pressed={many} onClick={() => lab.set({ many: !many })}>
        <kbd>M</kbd> Many
      </button>
      <button type="button" aria-pressed={empty} onClick={() => lab.set({ empty: !empty })}>
        <kbd>E</kbd> Empty home
      </button>
      <button type="button" aria-pressed={narrow} onClick={() => lab.set({ narrow: !narrow })}>
        <kbd>N</kbd> Narrow
      </button>
      <button type="button" aria-pressed={dark === 'dark'} onClick={() => lab.set({ theme: dark === 'dark' ? 'light' : 'dark' })}>
        <kbd>T</kbd> Dark
      </button>
    </div>
  )
}

/** The window in front: a home's, before it has connected, is the direction's opening. */
function Front() {
  const { d, w } = useLab()
  useWorld()
  const one = windowOf(w)
  const state = stateOf(w)
  const opening = w !== 'local' && !againOf(w) && state.connection !== 'connected'
  const { Opening, Around } = PARTS[d]
  const app = (
    <ServicesProvider value={one.services}>
      <HomeConnections host={one.services.host} windowId={w} />
      {opening ? <Opening windowId={w} /> : <RouterProvider router={one.router} />}
    </ServicesProvider>
  )
  return Around === undefined || opening ? app : <Around>{app}</Around>
}

function Lab() {
  const { narrow, w } = useLab()
  return (
    <div className={s.lab}>
      <div className={s.desk}>
        <div className={s.window} data-narrow={narrow || undefined} data-lab-window>
          <Front key={w} />
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
