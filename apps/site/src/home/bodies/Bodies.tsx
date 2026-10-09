import { type ComponentType, useEffect, useState } from 'react'

import { Close } from '../../shared/Close'
import { Current } from './Current'
import { Day } from './day/Day'
import { DesktopBody } from './desktop/DesktopBody'
import { OneTask } from './task/OneTask'
import s from './Pick.module.css'

/*
 * Prototype: everything under the first screen, in a few directions, so
 * each is seen on the real page under the real header. `?body=desktop`
 * picks one, the strip at the bottom (or the number keys) switches, and
 * `?shoot` hides the strip for screenshots.
 */

const BODIES: ReadonlyArray<{ id: string; name: string; Body: ComponentType }> = [
  { id: 'now', name: 'Now', Body: Current },
  { id: 'desktop', name: 'Desktop', Body: DesktopBody },
  { id: 'task', name: 'One task', Body: OneTask },
  { id: 'day', name: 'A day', Body: Day },
]

const fromAddress = () => {
  const id = new URLSearchParams(window.location.search).get('body')
  const at = BODIES.findIndex((b) => b.id === id)
  return at < 0 ? 1 : at
}

export function Bodies() {
  const [at, setAt] = useState(fromAddress)
  const shoot = new URLSearchParams(window.location.search).has('shoot')

  const pick = (i: number) => {
    setAt(i)
    const q = new URLSearchParams(window.location.search)
    q.set('body', BODIES[i]!.id)
    window.history.replaceState(null, '', `?${q}`)
  }

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const n = Number(e.key)
      if (Number.isInteger(n) && n >= 0 && n < BODIES.length) pick(n)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  const { Body, id } = BODIES[at]!
  return (
    <>
      <Body key={id} />
      {id === 'now' && <Close />}
      {!shoot && (
        <nav className={s.pick} aria-label="Directions (prototype)">
          {BODIES.map((b, i) => (
            <button key={b.id} type="button" aria-pressed={i === at} onClick={() => pick(i)}>
              <b>{i}</b>
              {b.name}
            </button>
          ))}
        </nav>
      )}
    </>
  )
}
