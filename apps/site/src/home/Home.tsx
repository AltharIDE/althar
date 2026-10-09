import s from './Home.module.css'
import { Bodies } from './bodies/Bodies'

/*
 * The developer page. The first screen opens in Althar's light, as the app
 * does (Hero). Under it, prototypes of what follows (bodies/).
 */

export function Home() {
  return (
    <div className={s.page} id="top">
      <Bodies />
    </div>
  )
}
