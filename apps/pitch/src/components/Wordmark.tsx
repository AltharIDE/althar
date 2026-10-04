import { Logo } from './Logo'
import s from './Wordmark.module.css'

/** The mark and the name across the bottom of the page, standing on its lower edge. Decorative. */
export function Wordmark() {
  return (
    <p className={s.mark} aria-hidden="true">
      <Logo className={s.logo} />
      Althar
    </p>
  )
}
