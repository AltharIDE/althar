import { Fragment } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { Popover } from '../../primitives/Popover/Popover'
import s from './ReachLine.module.css'

/*
 * What a task's lead can reach, as one sentence under the task's header:
 * Reads ninemate's branch · runs nothing of it · no network · posts nothing
 * until you do. Each phrase opens what it means, in a sentence or two. The
 * words are the consumer's, since they say what this task can reach.
 */

/** One phrase of the sentence, and what it means. */
export interface ReachPhrase {
  id: string
  /** As the sentence says it: no network. */
  words: string
  /** What it means, in a sentence or two. */
  means: string
}

export type ReachLineProps = RootProps<
  'p',
  {
    phrases: readonly ReachPhrase[]
    /** The phrase whose meaning starts open. */
    defaultOpen?: string
  }
>

export function ReachLine({ phrases, defaultOpen, className, ...rest }: ReachLineProps) {
  return (
    <p className={cx(s.reach, className)} {...rest}>
      <Icon name="lock" size={12} className={s.lock} />
      {phrases.map((phrase, index) => (
        <Fragment key={phrase.id}>
          {index > 0 && (
            <span className={s.dot} aria-hidden="true">
              ·
            </span>
          )}
          <Popover
            label={phrase.words}
            width={320}
            initialFocus="panel"
            defaultOpen={phrase.id === defaultOpen}
            trigger={<LinkButton className={s.phrase}>{phrase.words}</LinkButton>}
          >
            <div className={s.pop}>
              <p className={s.title}>{phrase.words}</p>
              <p className={s.means}>{phrase.means}</p>
            </div>
          </Popover>
        </Fragment>
      ))}
    </p>
  )
}
