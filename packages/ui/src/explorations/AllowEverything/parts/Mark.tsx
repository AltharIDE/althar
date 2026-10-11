import type { ReactNode } from 'react'

import { Icon } from '../../../foundations/Icon/Icon'
import { cx } from '../../../lib/cx'
import type { RootProps } from '../../../lib/props'
import { VisuallyHidden } from '../../../primitives/VisuallyHidden/VisuallyHidden'
import { ExploreIcon, type ExploreIconName } from '../ExploreIcon'
import s from './Mark.module.css'

/*
 * That a task or a project allows everything, said in a word with its
 * glyph, in ink: it isn't work in motion (cobalt), nothing waits on you
 * (violet), and nothing failed (red). The same mark wherever the task is
 * shown, so it is learnt once: the task's bar, its card on the board, the
 * line over the composer.
 */

export type MarkProps = RootProps<
  'span',
  {
    /** The word: Unrestricted, Allows everything. */
    word: ReactNode
    /** After it, quieter: how long is left, whose it is. */
    detail?: ReactNode
    icon?: ExploreIconName
    /** small: in a card's line of 11px text. */
    size?: 'medium' | 'small'
    /** What it means, said to a screen reader after it: what shows on hover. */
    about?: string
  }
>

export function Mark({ word, detail, icon = 'unlocked', size = 'medium', about, className, ...rest }: MarkProps) {
  return (
    <span className={cx(s.mark, size === 'small' && s.small, className)} {...rest}>
      <ExploreIcon name={icon} size={size === 'small' ? 11 : 13} />
      <span className={s.word}>{word}</span>
      {detail != null && <span className={s.detail}>· {detail}</span>}
      {about !== undefined && <VisuallyHidden>, {about}</VisuallyHidden>}
    </span>
  )
}

export type MarkButtonProps = RootProps<
  'button',
  {
    /** Before the word, quieter: Project default, This task. */
    lead?: ReactNode
    word: ReactNode
    detail?: ReactNode
    /** The glyph; none where the mark says nothing out of the ordinary. */
    icon?: ExploreIconName | null
    /** It says everything is allowed: ink, and weighted. */
    strong?: boolean
  }
>

/** The mark as a button that opens what it is about, in the window's bar: a ChromeButton's shape, with its words in two weights. */
export function MarkButton({
  lead,
  word,
  detail,
  icon = 'unlocked',
  strong = false,
  className,
  type = 'button',
  ...rest
}: MarkButtonProps) {
  return (
    <button type={type} className={cx(s.button, strong && s.strong, className)} {...rest}>
      {icon !== null && <ExploreIcon name={icon} size={13} />}
      {lead != null && <span className={s.lead}>{lead} ·</span>}
      <span className={s.word}>{word}</span>
      {detail != null && <span className={s.detail}>· {detail}</span>}
      <Icon name="chevronD" size={9} className={s.chev} />
    </button>
  )
}
