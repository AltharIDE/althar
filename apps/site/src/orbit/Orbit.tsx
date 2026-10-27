import { DesktopBody } from '../home/bodies/desktop/DesktopBody'
import { RunsOn } from '../home/bodies/RunsOn'
import s from '../home/Home.module.css'
import { Footer } from '../shared/footer/Footer'
import { Nav, NavSpace } from '../shared/Nav'
import { OrbitHero } from './OrbitHero'

/*
 * A concept for the developer page's first screen (/orbit): the page as it
 * is, with the first screen seen from a space station as the view runs into
 * a time-lapse and the sun comes up. Linked from nowhere, kept out of
 * search, to be looked at beside / and /train.
 */

export function Orbit() {
  return (
    <div className={s.page} id="top">
      <Nav />
      <OrbitHero nav={<NavSpace />} />
      <RunsOn />
      <DesktopBody />
      <Footer />
    </div>
  )
}
