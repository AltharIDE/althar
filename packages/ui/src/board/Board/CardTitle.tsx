import type { ReactNode } from 'react'

import { cx } from '../../lib/cx'
import s from './Board.module.css'

/**
 * A card's or row's title. With `onOpen` it is the button that opens the
 * card, its target stretched over the whole card; without, it is the words.
 * Internal to the board's cards.
 */
export function CardTitle({ onOpen, className, children }: { onOpen?: () => void; className?: string; children: ReactNode }) {
  if (!onOpen) return <span className={cx(s.cardTitle, className)}>{children}</span>
  return (
    <button type="button" className={cx(s.cardTitle, s.open, className)} onClick={onOpen}>
      {children}
    </button>
  )
}
