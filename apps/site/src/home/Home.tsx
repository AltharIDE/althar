import '@fontsource-variable/instrument-sans'
import '@fontsource/instrument-serif/400-italic.css'

import { Footer } from '../shared/footer/Footer'
import { Nav, NavSpace } from '../shared/Nav'
import { Bar } from './Bar'
import s from './Home.module.css'
import { Hero } from './Hero'
import { Story } from './story/Story'

/*
 * The developer page, in daylight: its own bar across the top (Bar; on a
 * phone, the site's nav and its menu), the first screen with the flat orrery
 * (Hero), the product told scene by scene as you scroll (story/), and the
 * footer (shared/footer).
 */

export function Home() {
  return (
    <div className={s.page} id="top">
      <Bar />
      <div className={s.narrow}>
        <Nav />
      </div>
      <Hero
        nav={
          <div className={s.narrow}>
            <NavSpace />
          </div>
        }
      />
      <Story />
      <Footer />
    </div>
  )
}
