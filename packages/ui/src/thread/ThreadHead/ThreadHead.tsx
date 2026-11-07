import type { ReactNode } from 'react'

import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { ThreadMeasure } from '../Thread/Thread'
import s from './ThreadHead.module.css'

export type ThreadHeadProps = RootProps<
  'section',
  {
    /** Whose conversation it is. */
    title: string
    /** Its actions, after the title. */
    children?: ReactNode
  }
>

/**
 * A bar above a thread that names whose conversation it is and holds its
 * actions, at hand while the thread is read. It stays in the thread's measure,
 * so the actions sit over the column they act on.
 */
export function ThreadHead({ title, children, className, ...rest }: ThreadHeadProps) {
  return (
    <section aria-label={title} className={cx(s.bar, className)} {...rest}>
      <ThreadMeasure>
        <div className={s.head}>
          <span className={s.title} aria-hidden="true">
            {title}
          </span>
          <div className={s.actions}>{children}</div>
        </div>
      </ThreadMeasure>
    </section>
  )
}
