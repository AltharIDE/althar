import { Footer } from '../shared/footer/Footer'
import { Nav } from '../shared/Nav'
import s from './Changelog.module.css'
import { Log } from './takes/Log'

/*
 * What changed in Althar, release by release, with what has merged since the
 * last one and what's next, kept as the mission's flight log.
 */

export function Changelog() {
  return (
    <div className={s.page}>
      <Nav />
      <Log />
      <Footer />
    </div>
  )
}
