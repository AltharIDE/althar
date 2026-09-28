import type { ComponentProps } from 'react'

import { cx } from '../../lib/cx'
import s from './LinkButton.module.css'

export interface LinkButtonProps extends ComponentProps<'button'> {
  /** Stays out of sight until its row is hovered or it takes focus. The row sets data-reveal on hover. */
  reveal?: boolean
}

/** A secondary action in running text or at the end of a line: Undo, Show all, Reopen. */
export function LinkButton({ reveal, className, type = 'button', ...rest }: LinkButtonProps) {
  return <button type={type} className={cx(s.link, reveal && s.reveal, className)} {...rest} />
}
