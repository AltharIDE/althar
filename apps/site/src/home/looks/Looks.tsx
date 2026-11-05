import { Segmented } from '@althar/ui'
import { type ComponentType, lazy, type ReactNode, Suspense, useEffect, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import { useMedia } from '../../lib/browser'
import { DesktopBody } from '../bodies/desktop/DesktopBody'
import { Hero } from '../Hero'
import s from './Looks.module.css'
import { go, goHero, HEROES, type HeroLook, keepPlace, LOOKS, type Look, onKey, useHero, useLook } from './state'

/*
 * Prototype, in development only (Home.tsx): the homepage's sections between
 * the Runs on band and the footer, in one of five looks or as they are
 * today, with a bar along the foot of the window that swaps them in place;
 * and the first screen, today's or a new one (heroes/), swapped from the
 * same bar, which stands at the top of the window while you are on it.
 * The nav, the band and the footer are the page's own, untouched.
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

const loadHero = {
  Chart: () => import('./heroes/Chart').then((m) => ({ default: m.ChartHero })),
  Night: () => import('./heroes/Night').then((m) => ({ default: m.NightHero })),
  Cloud: () => import('./heroes/Cloud').then((m) => ({ default: m.CloudHero })),
  Dither: () => import('./heroes/Dither').then((m) => ({ default: m.DitherHero })),
}

const FIRST: Record<HeroLook, ComponentType<{ nav?: ReactNode }>> = {
  Today: Hero,
  Chart: lazy(loadHero.Chart),
  Night: lazy(loadHero.Night),
  Cloud: lazy(loadHero.Cloud),
  Dither: lazy(loadHero.Dither),
}

/** The first screen, today's or a new one; until a new one has loaded, the dark at today's height. */
export function FirstScreen({ nav }: { nav?: ReactNode }) {
  const Shown = FIRST[useHero()]
  return (
    <Suspense fallback={<div style={{ height: 'clamp(640px, 100svh, 1060px)', background: '#050302' }} />}>
      <Shown nav={nav} />
    </Suspense>
  )
}

/** The Runs on band, the page's own; under Orrery, in its night. */
export function Band({ children }: { children: ReactNode }) {
  return <div className={useHero() === 'Night' ? s.nightBand : undefined}>{children}</div>
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
  const hero = useHero()
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
    const idle = window.setTimeout(() => [...Object.values(load), ...Object.values(loadHero)].forEach((one) => void one()), 2500)
    return () => window.clearTimeout(idle)
  }, [])
  // On the first screen the bar stands at the top, off its console, with only the first screens; past it, at the foot, with both.
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
        <div className={`ch-root ${s.bar}`} data-look-bar="" data-top={past ? undefined : ''}>
          {past && (
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
          )}
          <span className={s.name}>Hero</span>
          <Segmented<HeroLook>
            label="First screen"
            value={hero}
            onChange={goHero}
            options={HEROES.map((one) => ({ value: one.value, label: one.name }))}
          />
          <span className={s.hint}>{past ? `1–${LOOKS.length} ← → · H` : 'H'}</span>
        </div>,
        document.body,
      )}
    </>
  )
}
