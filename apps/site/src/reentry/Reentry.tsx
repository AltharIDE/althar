import { DesktopBody } from '../home/bodies/desktop/DesktopBody'
import { RunsOn } from '../home/bodies/RunsOn'
import s from '../home/Home.module.css'
import { Footer } from '../shared/footer/Footer'
import { Nav, NavSpace } from '../shared/Nav'
import { ReentryHero } from './ReentryHero'

/*
 * The developer page (/reentry) with its first screen inside a capsule
 * coming in from orbit, the fire building past its window until it breaks
 * into sky. Linked from nowhere and kept out of search for now, to be looked
 * at beside /.
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
