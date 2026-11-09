import type { ReactNode } from 'react'

import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import s from './TaskPreviews.module.css'

export type SettingPreviewsProps = RootProps<'div', { children: ReactNode }>

/** What settings make, drawn as it will be seen: side by side where there is room, one under another where not. */
export function SettingPreviews({ children, className, ...rest }: SettingPreviewsProps) {
  return (
    <div className={cx(s.previews, className)} {...rest}>
      {children}
    </div>
  )
}
