import type { ReactNode } from 'react'

import { cssVars } from '../../lib/cssVars'
import { cx } from '../../lib/cx'
import s from './KeyValues.module.css'

export interface KeyValuesProps {
  /** Each pair: what it is, then its value. */
  items: readonly (readonly [string, ReactNode])[]
  /** The width of the keys' column. */
  keyWidth?: number
  className?: string
}

/** A few named values, keys on the left: a description list. */
export function KeyValues({ items, keyWidth = 90, className }: KeyValuesProps) {
  return (
    <dl className={cx(s.kv, className)} style={cssVars({ '--key': `${keyWidth}px` })}>
      {items.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  )
}
