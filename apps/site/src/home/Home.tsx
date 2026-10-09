import { DesktopBody } from './bodies/desktop/DesktopBody'
import { Nav, NavSpace } from './bodies/nav/Navs'
import { RunsOn } from './bodies/RunsOn'
import s from './Home.module.css'
import { Hero } from './Hero'

/*
 * The developer page: the island for a nav, the first screen in Althar's
 * light, the systems it runs on, then the product shown (bodies/desktop).
 */

export function Home() {
  return (
    <div className={s.page} id="top">
      <Nav />
      <Hero nav={<NavSpace />} />
      <RunsOn />
      <DesktopBody />
    </div>
  )
}
