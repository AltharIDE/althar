import { Hourglass, LockSlash } from 'iconoir-react'

/*
 * Two drawings the kit's icon table doesn't have yet, drawn as Icon draws
 * its own: everything allowed (a lock, struck through) and a while
 * (an hourglass). Kept here so the exploration leaves the kit as it is; if
 * a path is chosen, they move to foundations/Icon/icons.ts by these names.
 */
const DRAWINGS = { unlocked: LockSlash, hourglass: Hourglass } as const

export type ExploreIconName = keyof typeof DRAWINGS

const stroke = (size: number) => Math.min(2.4, Math.max(1.5, (1.25 * 24) / size))

export function ExploreIcon({ name, size = 14, className }: { name: ExploreIconName; size?: number; className?: string }) {
  const Drawing = DRAWINGS[name]
  return (
    <Drawing
      width={size}
      height={size}
      strokeWidth={stroke(size)}
      style={{ flex: 'none' }}
      className={className}
      aria-hidden="true"
      focusable="false"
    />
  )
}
