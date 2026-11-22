import { Footer } from '../shared/footer/Footer'
import { Nav, NavSpace } from '../shared/Nav'
import s from './Home.module.css'
import { Hero } from './Hero'
import { Story } from './story/Story'

/*
 * The developer page, in daylight: the lens for a nav, the first screen with
 * the flat orrery (Hero), the product told scene by scene as you scroll
 * (story/), and the footer (shared/footer).
 */

export function Home() {
  return (
    <div className={s.page} id="top">
      <Nav />
      <Hero nav={<NavSpace />} />
      <Story />
      <Footer />
    </div>
  )
}
