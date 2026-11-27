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
import { makeClient, STOREFRONT, TABS } from './data'
import { DIRECTIONS, lab, ROLES, useLab } from './state'
import s from './lab.module.css'

/*
 * The role lenses lab (README.md): the desktop app's window, whole, in the
 * browser, on made-up data, with the page's bar under it. The bar swaps the
 * direction in place (A Minimal, B Panels, C Feature-first), the lens on
 * (1–4), opens Saved carts' timeline (F) and the lens menu (L). ?theme=dark
 * draws it dark.
 */

window.localStorage.setItem('althar.tabs', JSON.stringify(TABS))
document.documentElement.dataset.theme = new URLSearchParams(window.location.search).get('theme') === 'dark' ? 'dark' : 'light'

const client = makeClient()
const host = fakeHost()
Object.defineProperty(window, 'althar', { value: host, configurable: true })
const cache = makeQueryClient()
const services = { client, host, cache, feed: follow(client, cache) }
const router = makeRouter({ client, cache })

function Bar() {
  const { d, role, feature, menu } = useLab()
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (target !== null && (target.isContentEditable || target.closest('input, textarea, [contenteditable="true"]') !== null)) return
      const key = event.key.toLowerCase()
      const direction = DIRECTIONS.find((one) => one.kbd.toLowerCase() === key)
      if (direction !== undefined) return lab.set({ d: direction.key })
      const lens = ROLES.find((one) => one.kbd === key)
      if (lens !== undefined) return lab.set({ role: lens.key, pinned: [], unpinned: [] })
      if (key === 'f') return lab.set({ feature: lab.get().feature === null ? 'saved-carts' : null })
      if (key === 'l') return lab.set({ menu: !lab.get().menu })
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
      <span className={s.round}>Lens</span>
      {ROLES.map((one) => (
        <button
          key={one.key}
          type="button"
          aria-pressed={role === one.key}
          onClick={() => lab.set({ role: one.key, pinned: [], unpinned: [] })}
        >
          <kbd>{one.kbd}</kbd> {one.label}
        </button>
      ))}
      <span className={s.gap} />
      <button type="button" aria-pressed={feature !== null} onClick={() => lab.set({ feature: feature === null ? 'saved-carts' : null })}>
        <kbd>F</kbd> Saved carts’ timeline
      </button>
      <button type="button" aria-pressed={menu} onClick={() => lab.set({ menu: !menu })}>
        <kbd>L</kbd> Lens menu
      </button>
    </div>
  )
}

function Lab() {
  useEffect(() => {
    if (window.location.hash === '' || window.location.hash === '#/')
      void router.navigate({ to: '/projects/$projectId', params: { projectId: STOREFRONT } })
  }, [])
  const { menu, d } = useLab()
  return (
    <div className={s.lab}>
      <div className={s.desk}>
        {/* Keyed on the menu and the direction, so a menu asked open by the address opens. */}
        <div className={s.window} data-lab-window key={`${menu}`} data-d={d}>
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
