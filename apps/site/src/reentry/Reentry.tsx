import { DesktopBody } from '../home/bodies/desktop/DesktopBody'
import { RunsOn } from '../home/bodies/RunsOn'
import s from '../home/Home.module.css'
import { Footer } from '../shared/footer/Footer'
import { Nav, NavSpace } from '../shared/Nav'
import { ReentryHero } from './ReentryHero'

/*
 * A concept for the developer page's first screen (/reentry): the page as it
 * is, with the first screen inside a capsule coming in from orbit, the fire
 * building past its windows until it breaks into sky. Linked from nowhere,
 * kept out of search, to be looked at beside / and the other concepts.
 */

export function Reentry() {
  return (
    <div className={s.page} id="top">
      <Nav />
      <ReentryHero nav={<NavSpace />} />
      <RunsOn />
      <DesktopBody />
      <Footer />
    </div>
  )
}
