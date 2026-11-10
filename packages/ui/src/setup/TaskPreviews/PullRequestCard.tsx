import type { ReactNode } from 'react'

import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import s from './PullRequestCard.module.css'

export type PullRequestCardProps = RootProps<
  'figure',
  {
    /** What it is, for a screen reader: A pull request as GitHub shows it. */
    label: string
    title: string
    /** Its number as the host writes it: #212. */
    number: string
    /** Before the title, as the host puts its state there: Draft, Open. */
    state?: ReactNode
    /** The start of its description, and what follows it. */
    children: ReactNode
  }
>

/**
 * A pull request as the code host shows it: its title and number in a head,
 * then whatever of its page the setting makes. A picture of a page elsewhere,
 * shared by what a setting puts on one: the review seal, the pull request a
 * finished task opens.
 */
export function PullRequestCard({ label, title, number, state, children, className, ...rest }: PullRequestCardProps) {
  return (
    <figure className={cx(s.pullRequest, className)} aria-label={label} {...rest}>
      <div className={s.head}>
        {state}
        <span className={s.name}>
          <span className={s.title}>{title}</span> <span className={s.number}>{number}</span>
        </span>
      </div>
      {children}
    </figure>
  )
}
