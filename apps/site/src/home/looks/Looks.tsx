import { Segmented } from '@althar/ui'
import { type ComponentType, useEffect, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import { useMedia } from '../../lib/browser'
import { DesktopBody } from '../bodies/desktop/DesktopBody'
import { FlightDeckBody } from './A'
import { OrbitBody } from './B'
import { RulerBody } from './C'
import s from './Looks.module.css'
import { go, keepPlace, LOOKS, type Look, onKey, useLook } from './state'

/*
 * Prototype, in development only (Home.tsx): the homepage's sections between
 * the Runs on band and the footer, in one of three looks or as they are
 * today, with a bar along the foot of the window that swaps them in place.
 * Everything above and below them is the page's own, untouched.
 */

const BODIES: Record<Look, ComponentType> = {
  A: FlightDeckBody,
  B: OrbitBody,
  C: RulerBody,
  Today: DesktopBody,
}

export default function Looks() {
  const look = useLook()
  const Body = BODIES[look]
  // Letters alone where the names don't fit.
  const narrow = useMedia('(max-width: 700px)')
  useEffect(() => {
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  // The bar keeps off the first screen, whose console it would cover; the keys work everywhere.
  const [past, setPast] = useState(false)
  useEffect(() => {
    const check = () => setPast(window.scrollY > window.innerHeight * 0.6)
    check()
    window.addEventListener('scroll', check, { passive: true })
    return () => window.removeEventListener('scroll', check)
  }, [])
  // The section being read stays where it was: once laid out, and again once the pictures have measured themselves.
  useLayoutEffect(() => {
    keepPlace()
    const frame = requestAnimationFrame(keepPlace)
    return () => cancelAnimationFrame(frame)
  }, [look])
  useEffect(() => {
    const name = LOOKS.find((one) => one.value === look)?.name ?? look
    document.title = look === 'Today' ? 'Today · Althar' : `${look} · ${name} · Althar`
  }, [look])
  return (
    <>
      <Body key={look} />
      {createPortal(
        <div className={`ch-root ${s.bar}`} data-look-bar="" data-tucked={past ? undefined : ''} inert={!past}>
          <Segmented<Look>
            label="Look"
            value={look}
            onChange={go}
            options={LOOKS.map((one, at) => ({
              value: one.value,
              label: one.value === 'Today' ? one.name : narrow ? one.value : `${one.value} · ${one.name}`,
              kbd: String(at + 1),
            }))}
          />
          <span className={s.hint}>1–{LOOKS.length} or ← →</span>
        </div>,
        document.body,
      )}
    </>
  )
}
