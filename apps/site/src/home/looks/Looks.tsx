import { Segmented } from '@althar/ui'
import { type ComponentType, lazy, type ReactNode, Suspense, useEffect, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import { useMedia } from '../../lib/browser'
import { DesktopBody } from '../bodies/desktop/DesktopBody'
import s from './Looks.module.css'
import { go, keepPlace, LOOKS, type Look, onKey, useLook } from './state'

/*
 * Prototype, in development only (Home.tsx): the homepage's sections between
 * the Runs on band and the footer, in one of five looks or as they are
 * today, with a bar along the foot of the window that swaps them in place,
 * once you are past the first screen. The first screen, the nav, the band
 * and the footer are the page's own, untouched.
 *
 * Each look loads on its own, so one being worked on never breaks another;
 * once the page has opened, the others load in the background, so a swap is
 * instant.
 */

const load = {
  A: () => import('./A').then((m) => ({ default: m.ChartBody })),
  B: () => import('./B').then((m) => ({ default: m.ApproachBody })),
  C: () => import('./C').then((m) => ({ default: m.CabinBody })),
  D: () => import('./D').then((m) => ({ default: m.CloudBody })),
  E: () => import('./D').then((m) => ({ default: m.DitherBody })),
}

const BODIES: Record<Look, ComponentType> = {
  A: lazy(load.A),
  B: lazy(load.B),
  C: lazy(load.C),
  D: lazy(load.D),
  E: lazy(load.E),
  Today: DesktopBody,
}

/** Puts the reader back where they were once the look has mounted, and again once its pictures have measured themselves. */
function Kept({ children }: { children: ReactNode }) {
  useLayoutEffect(() => {
    keepPlace()
    const frame = requestAnimationFrame(keepPlace)
    return () => cancelAnimationFrame(frame)
  }, [])
  return children
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
  // The other looks, loaded while the page is idle; not in an automated browser, which looks at one at a time.
  useEffect(() => {
    if (navigator.webdriver) return
    const idle = window.setTimeout(() => Object.values(load).forEach((one) => void one()), 2500)
    return () => window.clearTimeout(idle)
  }, [])
  // Away while the first screen is in view, off its console.
  const [past, setPast] = useState(false)
  useEffect(() => {
    const check = () => setPast(window.scrollY > window.innerHeight * 0.6)
    check()
    window.addEventListener('scroll', check, { passive: true })
    return () => window.removeEventListener('scroll', check)
  }, [])
  useEffect(() => {
    const name = LOOKS.find((one) => one.value === look)?.name ?? look
    document.title = look === 'Today' ? 'Today · Althar' : `${look} · ${name} · Althar`
  }, [look])
  return (
    <>
      <Suspense fallback={<div style={{ minHeight: '300vh' }} />}>
        <Kept key={look}>
          <Body />
        </Kept>
      </Suspense>
      {createPortal(
        <div className={`ch-root ${s.bar}`} data-look-bar="" data-away={past ? undefined : ''} inert={!past}>
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
          <span className={s.hint}>{`1–${LOOKS.length} ← →`}</span>
        </div>,
        document.body,
      )}
    </>
  )
}
