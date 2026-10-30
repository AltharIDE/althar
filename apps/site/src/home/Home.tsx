import { DesktopBody } from './bodies/desktop/DesktopBody'
import { Footer } from '../shared/footer/Footer'
import { Nav, NavSpace } from '../shared/Nav'
import { RunsOn } from './bodies/RunsOn'
import s from './Home.module.css'
import { Hero } from './Hero'
import { HeroLab, HeroSwitch, STYLES, useHeroAsked } from './lab/HeroLab'

/*
 * The developer page: the lens for a nav, the first screen coming in from
 * orbit (Hero), the systems it runs on, the product shown (bodies/desktop),
 * and the footer (shared/footer).
 */

export function Home() {
  // An experiment's style for the first screen, while they're compared (lab/HeroLab).
  const asked = useHeroAsked()
  const style = STYLES.find((one) => one.id === asked)?.id
  return (
    <div className={s.page} id="top">
      <Nav opening />
      {style ? <HeroLab id={style} nav={<NavSpace />} /> : <Hero nav={<NavSpace />} />}
      {asked && <HeroSwitch current={style ?? 'photo'} />}
      <RunsOn />
      <DesktopBody />
      <Footer />
    </div>
  )
}
