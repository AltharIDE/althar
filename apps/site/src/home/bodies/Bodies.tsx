import { type ComponentType, useEffect, useState } from 'react'

import { Close } from '../../shared/Close'
import { Hero } from '../Hero'
import { Current } from './Current'
import { Day } from './day/Day'
import { DesktopBody } from './desktop/DesktopBody'
import { FloatingNav, heroNavOf, NAVS, type NavId } from './nav/Navs'
import s from './Pick.module.css'
import { Slabs } from './slabs/Slabs'

/*
 * Prototype: the page under the first screen in a few directions, and the
 * nav in a few ways, so each is seen on the real page. `?body=desktop` and
 * `?nav=island` pick them, the strips at the bottom switch them (number keys
 * pick a body, shift with a number a nav), and `?shoot` hides the strips for
 * screenshots.
 */

const BODIES: ReadonlyArray<{ id: string; name: string; Body: ComponentType }> = [
  { id: 'now', name: 'Now', Body: Current },
  { id: 'desktop', name: 'Desktop', Body: DesktopBody },
  { id: 'day', name: 'A day', Body: Day },
  { id: 'slabs', name: 'Slabs', Body: Slabs },
]

const param = (name: string) => new URLSearchParams(window.location.search).get(name)
const bodyFromAddress = () => {
  const at = BODIES.findIndex((b) => b.id === param('body'))
  return at < 0 ? 1 : at
}
const navFromAddress = (): NavId => NAVS.find((n) => n.id === param('nav'))?.id ?? 'bar'
const SHIFTED = ['!', '@', '#', '$', '%', '^']

export function Bodies() {
  const [at, setAt] = useState(bodyFromAddress)
  const [nav, setNav] = useState(navFromAddress)
  const shoot = param('shoot') !== null

  const remember = (name: string, value: string) => {
    const q = new URLSearchParams(window.location.search)
    q.set(name, value)
    window.history.replaceState(null, '', `?${q}`)
  }
  const pick = (i: number) => {
    setAt(i)
    remember('body', BODIES[i]!.id)
  }
  const pickNav = (id: NavId) => {
    setNav(id)
    remember('nav', id)
  }

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const shifted = SHIFTED.indexOf(e.key)
      if (shifted >= 0 && NAVS[shifted]) return pickNav(NAVS[shifted].id)
      const n = Number(e.key)
      if (Number.isInteger(n) && n >= 0 && n < BODIES.length) pick(n)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  const { Body, id } = BODIES[at]!
  return (
    <>
      <FloatingNav id={nav} />
      <Hero nav={heroNavOf(nav)} />
      <Body key={id} />
      {id === 'now' && <Close />}
      {!shoot && (
        <div className={s.dock}>
          <nav className={s.pick} aria-label="Navs (prototype)">
            <span className={s.label}>Nav</span>
            {NAVS.map((n) => (
              <button key={n.id} type="button" aria-pressed={n.id === nav} onClick={() => pickNav(n.id)}>
                {n.name}
              </button>
            ))}
          </nav>
          <nav className={s.pick} aria-label="Directions (prototype)">
            {BODIES.map((b, i) => (
              <button key={b.id} type="button" aria-pressed={i === at} onClick={() => pick(i)}>
                <b>{i}</b>
                {b.name}
              </button>
            ))}
          </nav>
        </div>
      )}
    </>
  )
}
