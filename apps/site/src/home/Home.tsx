import { lazy, Suspense } from 'react'

import { DesktopBody } from './bodies/desktop/DesktopBody'
import { Footer } from '../shared/footer/Footer'
import { Nav, NavSpace } from '../shared/Nav'
import { RunsOn } from './bodies/RunsOn'
import s from './Home.module.css'
import { Hero } from './Hero'

/*
 * The developer page: the lens for a nav, the first screen an orrery in the
 * night (Hero), the systems it runs on in the same night, the product shown
 * (bodies/desktop), and the footer (shared/footer).
 */

/** Prototype: in development, the product's sections wear one of the looks, swapped in place (looks/). Never in the build. */
const Looks = import.meta.env.DEV ? lazy(() => import('./looks/Looks')) : null

export function Home() {
  return (
    <div className={s.page} id="top">
      <Nav opening />
      <Hero nav={<NavSpace />} />
      <div className={s.night}>
        <RunsOn />
      </div>
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
