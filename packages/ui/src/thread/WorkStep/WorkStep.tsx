import type { ReactNode } from 'react'

import { cx } from '../../lib/cx'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import type { RootProps } from '../../lib/props'
import { Rhythm } from '../../lib/rhythm'
import s from './WorkStep.module.css'

export type WorkStepProps = RootProps<
  'p',
  {
    /** What happened, in a word or two: "New change", "Shipped", "Merged". */
    stamp: string
    /** A change started is work under way, in cobalt; one shipped or merged is done, in green. */
    tone?: 'new' | 'done'
    /** A few words: the change named in ink, its branch as code. */
    children: ReactNode
    /** The whole of it, on hover, where it doesn't fit on its line. */
    title?: string
    /** Its one way on, at the end of its line: "Keep them together", "Drop it". */
    action?: { readonly label: string; readonly onPress: () => void; readonly busy?: boolean }
  }
>

/**
 * A step of the work in a task's thread (a task is a conversation plus
 * parts, "How it reads"): a new change, a change shipped, a pull request
 * merged. A small stamp where Althar's name stands on its other lines, then
 * a few words, and its button at their end. It never wraps: what doesn't
 * fit ends in an ellipsis, the whole on hover.
 */
export function WorkStep({ stamp, tone = 'new', children, title, action, className, ...rest }: WorkStepProps) {
  return (
    <p className={cx(s.step, className)} data-rhythm={Rhythm.Fold} title={title} {...rest}>
      <span className={cx(s.stamp, tone === 'done' && s.done)}>{stamp}</span>
      <span className={s.words}>{children}</span>
      {action !== undefined && (
        <LinkButton className={s.action} aria-busy={action.busy || undefined} disabled={action.busy} onClick={action.onPress}>
          {action.label}
        </LinkButton>
      )}
    </p>
  )
}
