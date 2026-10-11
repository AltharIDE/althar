import type { ReactNode } from 'react'

import { cx } from '../../../lib/cx'
import s from './Scheme.module.css'

/** A sheet of the exploration, in the kit's light paper or the exploration's provisional dark. */
export function Scheme({ dark = false, children }: { dark?: boolean; children: ReactNode }) {
  return (
    <div className={cx(s.scheme, dark && s.dark)} data-scheme={dark ? 'dark' : 'light'}>
      {children}
    </div>
  )
}
