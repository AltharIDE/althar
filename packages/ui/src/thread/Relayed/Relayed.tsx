import { useState } from 'react'

import { HalftoneMark } from '../../foundations/HalftoneMark/HalftoneMark'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { Markdown } from '../Markdown/Markdown'
import s from './Relayed.module.css'

export interface RelayedText {
  /** Who passed it on, over it. */
  from: string
  showAll: string
  showLess: string
}

export const relayedText: RelayedText = { from: 'From the coordinator', showAll: 'Show all', showLess: 'Show less' }

export type RelayedProps = RootProps<
  'div',
  {
    /** What it is, in a few words, where it says: One more round. */
    title?: string | null
    /** What it passed on, as markdown. */
    body: string
    text?: Partial<RelayedText>
  }
>

/**
 * What the coordinator passed on to a task's lead: an ask, on the person's
 * side, as what they say is, since it is what they asked the coordinator for.
 * What it is in a line, three lines of the rest, and all of it on a click,
 * with Althar's mark printed faint in its corner, coming up dot by dot.
 */
export function Relayed({ title, body, text, className, ...rest }: RelayedProps) {
  const t = { ...relayedText, ...text }
  const [all, setAll] = useState(false)
  return (
    <div className={cx(s.relayed, className)} {...rest}>
      <p className={s.from}>{t.from}</p>
      <div className={s.bubble}>
        <span className={s.mark} aria-hidden="true">
          <HalftoneMark size={120} rise />
        </span>
        <div className={s.words}>
          {title != null && title !== '' && <p className={s.title}>{title}</p>}
          <div className={all ? s.body : s.clamp}>
            <Markdown source={body} />
          </div>
          <LinkButton className={s.more} onClick={() => setAll(!all)} aria-expanded={all}>
            {all ? t.showLess : t.showAll}
          </LinkButton>
        </div>
      </div>
    </div>
  )
}
