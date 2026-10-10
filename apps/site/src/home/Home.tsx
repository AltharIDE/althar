import { DesktopBody } from './bodies/desktop/DesktopBody'
import { Footer } from '../shared/footer/Footer'
import { Nav, NavSpace } from '../shared/Nav'
import { RunsOn } from './bodies/RunsOn'
import s from './Home.module.css'
import { Hero } from './Hero'

/*
 * The developer page: the island for a nav, the first screen in Althar's
 * light, the systems it runs on, the product shown (bodies/desktop), and
 * the footer (shared/footer).
 */

export function Home() {
  return (
    <div className={s.page} id="top">
      <Nav />
      <Hero nav={<NavSpace />} />
      <RunsOn />
      <DesktopBody />
      <Footer />
    </div>
  )
}
