import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import s from './Kbd.module.css'

export type KbdProps = RootProps<
  'kbd',
  {
    /** On a filled (violet or ink) surface. */
    onFill?: boolean
  }
>

/** A key or shortcut, as a keycap. */
export function Kbd({ onFill, className, ...rest }: KbdProps) {
  return <kbd className={cx(s.kbd, onFill && s.onFill, className)} {...rest} />
}
