import type { ReactNode } from 'react'

import { cx } from '../../lib/cx'
import s from './Kbd.module.css'

export interface KbdProps {
  children: ReactNode
  /** On a filled (violet or ink) surface. */
  onFill?: boolean
  className?: string
}

/** A key or shortcut, as a keycap. */
export function Kbd({ children, onFill, className }: KbdProps) {
  return <kbd className={cx(s.kbd, onFill && s.onFill, className)}>{children}</kbd>
}
