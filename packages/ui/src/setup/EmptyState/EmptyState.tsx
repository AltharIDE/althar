import { type ReactNode, useId } from 'react'

import { Icon, type IconName } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Heading, type HeadingLevel } from '../../primitives/Heading/Heading'
import s from './EmptyState.module.css'

/*
 * What a part of the settings will hold, while it holds nothing: its mark in
 * a round glyph, what will be here as its title, one line on how it gets
 * here (the person's own action, in plain words), and what to press, where
 * there is something. Calm: no violet, nothing to fix. As a card, it stands
 * where a section's whole content would be; flush, it takes a list's or a
 * row's place inside a sheet that is already there. It is as tall as its
 * words from the first frame, so nothing moves when what it stands for
 * arrives and takes its place.
 */

export type EmptyStateProps = RootProps<
  'section',
  {
    /** The section's mark, drawn in the round glyph. */
    icon?: IconName
    /** A mark of its own in the glyph's place, where the icon won't do: a brand's. Wins over `icon`. */
    mark?: ReactNode
    /** What will be here: No notes yet. */
    title: ReactNode
    /** How it gets here, in one line: the person's action, or what brings it. */
    line: ReactNode
    /** What to press: a Button or two, a LinkButton. Left out, the state says only what and how. */
    actions?: ReactNode
    /** `card` stands alone where a section's content would be; `flush` sits inside a sheet or a list already drawn. */
    variant?: 'card' | 'flush'
    headingLevel?: HeadingLevel
  }
>

/** A designed empty state: a mark, what will be here, how it gets here, and what to press. */
export function EmptyState({ icon, mark, title, line, actions, variant = 'card', headingLevel = 3, className, ...rest }: EmptyStateProps) {
  const titleId = useId()
  const glyph = mark ?? (icon === undefined ? null : <Icon name={icon} size={variant === 'card' ? 17 : 15} />)
  return (
    <section aria-labelledby={titleId} className={cx(s.empty, s[variant], className)} {...rest}>
      {glyph !== null && (
        <span className={s.glyph} aria-hidden="true">
          {glyph}
        </span>
      )}
      <div className={s.words}>
        <Heading level={headingLevel} id={titleId} className={s.title}>
          {title}
        </Heading>
        <p className={s.line}>{line}</p>
        {actions !== undefined && actions !== null && actions !== false && <div className={s.actions}>{actions}</div>}
      </div>
    </section>
  )
}
