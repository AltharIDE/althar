import { Children, type ReactNode, useId } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { HomeLane, unreachable } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Heading, type HeadingLevel } from '../../primitives/Heading/Heading'
import { LiveDot } from '../../primitives/LiveDot/LiveDot'
import s from './HomeSection.module.css'

/*
 * One of the home's sections, in the order you deal with them: what waits on
 * you, what runs, and what the loop did since you last looked. Each is headed
 * by its glyph, as the board's lanes are, and says how many it holds. Violet
 * is only for what waits on you, and only while something does.
 */

export interface HomeSectionText {
  title: Record<HomeLane, string>
  /** The last section's title, with when you last looked: 3 h ago. */
  since: (when: string) => string
  /** A section with nothing in it. */
  empty: Record<HomeLane, string>
}

export const homeSectionText: HomeSectionText = {
  title: {
    [HomeLane.Yours]: 'Needs you',
    [HomeLane.Running]: 'Running',
    [HomeLane.Since]: 'Since you looked',
  },
  since: (when) => `Since you looked, ${when}`,
  empty: {
    [HomeLane.Yours]: 'Nothing is waiting on you.',
    [HomeLane.Running]: 'Nothing is running.',
    [HomeLane.Since]: 'Nothing has happened since.',
  },
}

export type HomeSectionProps = RootProps<
  'section',
  {
    lane: HomeLane
    /** How many it holds; shown beside the title. */
    count: number
    /** When you last looked, for the last section: 3 h ago. */
    when?: string
    /** Its rows or cards. With none, the section says it is empty; a line just answered still shows. */
    children?: ReactNode
    /** The title's rank in the page's outline. */
    headingLevel?: HeadingLevel
    text?: Partial<HomeSectionText>
  }
>

function Glyph({ lane, count }: { lane: HomeLane; count: number }) {
  switch (lane) {
    case HomeLane.Yours:
      return <span className={count > 0 ? s.you : s.none} aria-hidden="true" />
    case HomeLane.Running:
      return <LiveDot ping={count > 0} />
    case HomeLane.Since:
      return <Icon name="clock" size={12} className={s.since} />
    default:
      return unreachable(lane)
  }
}

export function HomeSection({ lane, count, when, children, headingLevel = 2, className, text, ...rest }: HomeSectionProps) {
  const t = { ...homeSectionText, ...text }
  const id = useId()
  const title = lane === HomeLane.Since && when ? t.since(when) : t.title[lane]
  return (
    <section aria-labelledby={id} className={cx(s.section, className)} {...rest}>
      <header className={s.head}>
        <Glyph lane={lane} count={count} />
        <Heading level={headingLevel} id={id} className={s.title}>
          {title}
        </Heading>
        {count > 0 && lane !== HomeLane.Since && <span className={cx(s.count, lane === HomeLane.Yours && s.countYou)}>{count}</span>}
      </header>
      {Children.toArray(children).length > 0 ? children : <p className={s.empty}>{t.empty[lane]}</p>}
    </section>
  )
}
