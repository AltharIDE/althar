import { useEffect, useState } from 'react'

import { Hero } from '../Hero'
import { DesktopBody } from './desktop/DesktopBody'
import { Nav, NavSpace } from './nav/Navs'
import s from './Pick.module.css'
import { Bar, type BarLook } from './platforms/Bars'
import { Platforms, type PlatformsLook } from './platforms/Platforms'

/*
 * The developer page as it is being drawn: the island for a nav, the first
 * screen, a section on the systems Althar runs on, and the product shown
 * (desktop/). Prototype: the systems section in eleven ways: three with
 * pictures of the app, three without, and five quiet bands (platforms/Bars);
 * `?os=rise` picks one, the strip at the bottom switches, and `?shoot` hides
 * the strip for screenshots.
 */

type Look = PlatformsLook | BarLook
const BARS: readonly string[] = ['strip', 'ticker', 'rule', 'install', 'downloads']

const LOOKS: ReadonlyArray<{ id: Look; name: string }> = [
  { id: 'rise', name: 'Rise' },
  { id: 'morph', name: 'Morph' },
  { id: 'row', name: 'Row' },
  { id: 'buttons', name: 'Buttons' },
  { id: 'icons', name: 'Icons' },
  { id: 'roll', name: 'Roll' },
  { id: 'strip', name: 'Strip' },
  { id: 'ticker', name: 'Ticker' },
  { id: 'rule', name: 'Rule' },
  { id: 'install', name: 'Install' },
  { id: 'downloads', name: 'Downloads' },
]

const param = (name: string) => new URLSearchParams(window.location.search).get(name)

export function Bodies() {
  const [look, setLook] = useState<Look>(() => LOOKS.find((l) => l.id === param('os'))?.id ?? 'rise')
  const shoot = param('shoot') !== null

  const pick = (id: Look) => {
    setLook(id)
    const q = new URLSearchParams(window.location.search)
    q.set('os', id)
    window.history.replaceState(null, '', `?${q}`)
  }

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const n = Number(e.key)
      if (Number.isInteger(n) && n >= 1 && n <= 9 && LOOKS[n - 1]) pick(LOOKS[n - 1]!.id)
      if (e.key === '0' && LOOKS[9]) pick(LOOKS[9].id)
      if (e.key === '-' && LOOKS[10]) pick(LOOKS[10].id)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  return (
    <>
      <Nav />
      <Hero nav={<NavSpace />} />
      {BARS.includes(look) ? <Bar key={look} look={look as BarLook} /> : <Platforms key={look} look={look as PlatformsLook} />}
      <DesktopBody />
      {!shoot && (
        <div className={s.dock}>
          <nav className={s.pick} aria-label="Systems section (prototype)">
            <span className={s.label}>Systems</span>
            {LOOKS.map((l, i) => (
              <span key={l.id} className={s.group}>
                {(i === 3 || i === 6) && <span className={s.sep} />}
                <button type="button" aria-pressed={l.id === look} onClick={() => pick(l.id)}>
                  <b>{i + 1}</b>
                  {l.name}
                </button>
              </span>
            ))}
          </nav>
        </div>
      )}
    </>
  )
}
