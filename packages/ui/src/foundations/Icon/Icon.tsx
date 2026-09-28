import type { CSSProperties } from 'react'

import { ICONS, type IconName } from './icons'

export type { IconName } from './icons'
export { ICON_NAMES } from './icons'

export interface IconProps {
  name: IconName
  size?: number
  style?: CSSProperties
  className?: string
}

/* Iconoir draws on a 24px grid at 1.5. Scaled down to 11–14px that is a
   hairline, so the stroke is set to land near 1.25px at any size. */
const stroke = (size: number) => Math.min(2.4, Math.max(1.5, (1.25 * 24) / size))

/** An icon by what it means in Charrette; foundations/Icon/icons.ts decides the drawing. Decoration only. */
export function Icon({ name, size = 14, style, className }: IconProps) {
  const Drawing = ICONS[name]
  return (
    <Drawing
      width={size}
      height={size}
      strokeWidth={stroke(size)}
      style={{ flex: 'none', ...style }}
      className={className}
      aria-hidden="true"
      focusable="false"
    />
  )
}
