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
import { ALTHAR, makeClient, makeHomes, TABS } from './data'
import { linkOf, pairingCode } from './pairing/code'
import { HOMES, phones } from './pairing/world'
import { type Direction, DIRECTIONS, lab, type LabState, useLab } from './state'
import s from './lab.module.css'

/*
 * The phone pairing lab (README.md): the desktop app's window, whole, in the
 * browser, on made-up data, with the lab's bar under it. The bar swaps the
 * direction in place (A–D, with keys), the window's home (H: This Mac or
 * studio), how many phones it has paired (P), whether a phone can reach it
 * yet (R), the shorter code (Q), a narrow window (N) and dark (T); and plays
 * the phone's part: S for the phone pressing Pair, X for the five minutes
 * running out.
 */

window.localStorage.setItem('althar.tabs', JSON.stringify(TABS))

const client = makeClient()
const host = fakeHost({ homes: makeHomes() })
Object.defineProperty(window, 'althar', { value: host, configurable: true })
const cache = makeQueryClient()
const services = { client, host, cache, feed: follow(client, cache) }
const router = makeRouter({ client, cache })

/** Where each direction is seen: Settings › Computers for A and B, althar's board for C and D. */
const goTo = (d: Direction) =>
  d === 'a' || d === 'b'
    ? void router.navigate({ to: '/settings/$section', params: { section: 'computers' as never } })
    : void router.navigate({ to: '/projects/$projectId', params: { projectId: ALTHAR } })

const PHONES = ['none', 'two', 'many'] as const

/** What the phone's camera opens without Althar on it: the site's pairing page, with the code the window shows now. */
const openPhonePage = (now: LabState) => {
  const home = HOMES[now.home]
  if (phones.get().invitations[now.home]?.state !== 'waiting') phones.issue(now.home)
  const invitation = phones.get().invitations[now.home]
  if (invitation === undefined) return
  window.open(
    `/phone.html${now.dark ? '?theme=dark' : ''}#${linkOf(pairingCode(home, invitation, now.short)).split('#')[1] ?? ''}`,
    '_blank',
  )
}

function Bar() {
  const { d, home, phones: count, reach, short, link, narrow, dark } = useLab()
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (target !== null && (target.isContentEditable || target.closest('input, textarea, [contenteditable="true"]') !== null)) return
      const key = event.key.toLowerCase()
      const direction = DIRECTIONS.find((one) => one.kbd.toLowerCase() === key)
      const now = lab.get()
      if (direction !== undefined) {
        lab.set({ d: direction.key })
        return goTo(direction.key)
      }
      if (key === 'h') return lab.set({ home: now.home === 'mac' ? 'studio' : 'mac' })
      if (key === 'p') return lab.set({ phones: PHONES[(PHONES.indexOf(now.phones) + 1) % PHONES.length] })
      if (key === 'r') return lab.set({ reach: !now.reach })
      if (key === 'q') return lab.set({ short: !now.short })
      if (key === 'l') return lab.set({ link: !now.link })
      if (key === 'o') return openPhonePage(now)
      if (key === 'n') return lab.set({ narrow: !now.narrow })
      if (key === 't') return lab.set({ dark: !now.dark })
      if (key === 's') return phones.pairs(now.home)
      if (key === 'x') return phones.runOut(now.home)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <div className={s.bar} role="toolbar" aria-label="Directions">
      {DIRECTIONS.map((one) => (
        <button
          key={one.key}
          type="button"
          aria-pressed={d === one.key}
          onClick={() => {
            lab.set({ d: one.key })
            goTo(one.key)
          }}
        >
          <kbd>{one.kbd}</kbd> {one.label}
        </button>
      ))}
      <span className={s.round}>World</span>
      <button type="button" aria-pressed={home === 'studio'} onClick={() => lab.set({ home: home === 'mac' ? 'studio' : 'mac' })}>
        <kbd>H</kbd> {home === 'mac' ? 'This Mac' : 'studio'}
      </button>
      <button type="button" onClick={() => lab.set({ phones: PHONES[(PHONES.indexOf(count) + 1) % PHONES.length] })}>
        <kbd>P</kbd> {count === 'none' ? 'No phones' : count === 'two' ? 'Two phones' : 'Many phones'}
      </button>
      <button type="button" aria-pressed={!reach} onClick={() => lab.set({ reach: !reach })}>
        <kbd>R</kbd> Not reachable
      </button>
      <button type="button" aria-pressed={short} onClick={() => lab.set({ short: !short })}>
        <kbd>Q</kbd> Short code
      </button>
      <button type="button" aria-pressed={link} onClick={() => lab.set({ link: !link })}>
        <kbd>L</kbd> One QR
      </button>
      <span className={s.round}>Phone</span>
      <button type="button" onClick={() => openPhonePage(lab.get())}>
        <kbd>O</kbd> Phone's page
      </button>
      <button type="button" onClick={() => phones.pairs(home)}>
        <kbd>S</kbd> Phone pairs
      </button>
      <button type="button" onClick={() => phones.runOut(home)}>
        <kbd>X</kbd> Run out
      </button>
      <span className={s.gap} />
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
  // Opened where the direction is seen, the first time.
  useEffect(() => {
    if (window.location.hash === '' || window.location.hash === '#/') goTo(lab.get().d)
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
