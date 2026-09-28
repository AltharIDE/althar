import { Logo } from '../../../components/Logo'
import { homeHref } from '../../../paths'
import s from '../Research.module.css'

export function Close() {
  return (
    <>
      <div className={s.close}>
        <p className={s.closeQ}>
          Give the project durable memory. Give the coordinator the routine graph. Keep human attention for the decisions that are actually
          human.
        </p>
        <a href={homeHref} className={s.next}>
          {' '}
          <span className={s.nextK}>
            <Logo size={18} />
            Brief
          </span>{' '}
          <span className={s.nextT}>
            Agents come and go. The project stays.<span>The short version, with the product in motion.</span>
          </span>{' '}
          <span className={s.nextArrow} aria-hidden="true">
            →
          </span>{' '}
        </a>
      </div>
      <p className={s.foot}>
        <span>Charrette · open source</span>
        <span>github.com/thetastemakers/charrette</span>
      </p>
    </>
  )
}
