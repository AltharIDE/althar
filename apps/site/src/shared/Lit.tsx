import type { ReactNode } from 'react'

import { addDisplay } from '../home/display'
import { cx } from '../lib/cx'
import { Glow } from './Glow'
import s from './Lit.module.css'

/*
 * A page's head, in the site's light: the light standing up off its foot
 * with the words white inside it, as the first screen has them, in the
 * display cut, light, with what matters heavy. Under the island, which
 * floats over it. `children` stand under the words, in the light.
 */

addDisplay()

export function Lit({
  kicker,
  title,
  lead,
  children,
  className,
}: {
  kicker: ReactNode
  title: ReactNode
  lead?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <header className={cx(s.lit, className)}>
      <div className={s.light}>
        <Glow heart={typeof window !== 'undefined' && window.innerWidth < 700 ? 0.8 : 0.56} className={s.glow} />
      </div>
      <div className={s.words}>
        <p className={s.kicker}>
          <i aria-hidden="true" />
          {kicker}
        </p>
        <h1 className={s.title}>{title}</h1>
        {lead && <p className={s.lead}>{lead}</p>}
        {children}
      </div>
    </header>
  )
}
