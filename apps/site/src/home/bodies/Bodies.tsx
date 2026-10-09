import { useEffect, useState } from 'react'

import { Hero } from '../Hero'
import { DesktopBody } from './desktop/DesktopBody'
import { Nav, NavSpace } from './nav/Navs'
import s from './Pick.module.css'
import { Platforms, type PlatformsLook } from './platforms/Platforms'

/*
 * The developer page as it is being drawn: the island for a nav, the first
 * screen, a section on the systems Althar runs on, and the product shown
 * (desktop/). Prototype: the systems section in three ways; `?os=rise`
 * picks one, the strip at the bottom (or 1–3) switches, and `?shoot` hides
 * the strip for screenshots.
 */

const LOOKS: ReadonlyArray<{ id: PlatformsLook; name: string }> = [
  { id: 'rise', name: 'Rise' },
  { id: 'morph', name: 'Morph' },
  { id: 'row', name: 'Row' },
]

const param = (name: string) => new URLSearchParams(window.location.search).get(name)

export function Bodies() {
  const [look, setLook] = useState<PlatformsLook>(() => LOOKS.find((l) => l.id === param('os'))?.id ?? 'rise')
  const shoot = param('shoot') !== null

  const pick = (id: PlatformsLook) => {
    setLook(id)
    const q = new URLSearchParams(window.location.search)
    q.set('os', id)
    window.history.replaceState(null, '', `?${q}`)
  }

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const n = Number(e.key)
      if (Number.isInteger(n) && n >= 1 && n <= LOOKS.length) pick(LOOKS[n - 1]!.id)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  return (
    <>
      <Nav />
      <Hero nav={<NavSpace />} />
      <Platforms key={look} look={look} />
      <DesktopBody />
      {!shoot && (
        <div className={s.dock}>
          <nav className={s.pick} aria-label="Systems section (prototype)">
            <span className={s.label}>Systems</span>
            {LOOKS.map((l, i) => (
              <button key={l.id} type="button" aria-pressed={l.id === look} onClick={() => pick(l.id)}>
                <b>{i + 1}</b>
                {l.name}
              </button>
            ))}
          </nav>
        </div>
      )}
    </>
  )
}
