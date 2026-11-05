import { lazy, Suspense } from 'react'

import { DesktopBody } from './bodies/desktop/DesktopBody'
import { Footer } from '../shared/footer/Footer'
import { Nav, NavSpace } from '../shared/Nav'
import { RunsOn } from './bodies/RunsOn'
import s from './Home.module.css'
import { Hero } from './Hero'

/*
 * The developer page: the lens for a nav, the first screen coming in from
 * orbit (Hero), the systems it runs on, the product shown (bodies/desktop),
 * and the footer (shared/footer).
 */

/** Prototype: in development, the product's sections wear one of three looks, swapped in place (looks/). Never in the build. */
const Looks = import.meta.env.DEV ? lazy(() => import('./looks/Looks')) : null
/** Prototype: in development, the first screen is today's or one of the new ones, swapped from the same bar. */
const FirstScreen = import.meta.env.DEV ? lazy(() => import('./looks/Looks').then((m) => ({ default: m.FirstScreen }))) : null
/** Prototype: in development, the band under the first screen takes its ground (Orrery's night). */
const Band = import.meta.env.DEV ? lazy(() => import('./looks/Looks').then((m) => ({ default: m.Band }))) : null

export function Home() {
  return (
    <div className={s.page} id="top">
      <Nav opening />
      {FirstScreen ? (
        <Suspense fallback={<div style={{ height: 'clamp(640px, 100svh, 1060px)', background: '#050302' }} />}>
          <FirstScreen nav={<NavSpace />} />
        </Suspense>
      ) : (
        <Hero nav={<NavSpace />} />
      )}
      {Band ? (
        <Suspense fallback={<RunsOn />}>
          <Band>
            <RunsOn />
          </Band>
        </Suspense>
      ) : (
        <RunsOn />
      )}
      {Looks ? (
        <Suspense fallback={null}>
          <Looks />
        </Suspense>
      ) : (
        <DesktopBody />
      )}
      <Footer />
    </div>
  )
}
