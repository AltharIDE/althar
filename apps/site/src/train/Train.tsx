import { DesktopBody } from '../home/bodies/desktop/DesktopBody'
import { RunsOn } from '../home/bodies/RunsOn'
import s from '../home/Home.module.css'
import { Footer } from '../shared/footer/Footer'
import { Nav, NavSpace } from '../shared/Nav'
import { TrainHero } from './TrainHero'

/*
 * A concept for the developer page's first screen (/train): the page as it
 * is, with the first screen seen from a train that pulls away and gathers
 * speed. Linked from nowhere, kept out of search, to be looked at beside /.
 */

export function Train() {
  return (
    <div className={s.page} id="top">
      <Nav />
      <TrainHero nav={<NavSpace />} />
      <RunsOn />
      <DesktopBody />
      <Footer />
    </div>
  )
}
