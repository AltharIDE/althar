import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import s from './Skeleton.module.css'

/*
 * The place of something still being read: its shape in the page's own
 * shade, with no words, breathing slowly. A screen shows it only when a read
 * takes longer than a glance, and arranges it as what it stands for will
 * be: a line of text, a block, or a sheet like a card. Decoration: whatever
 * holds it says what is being read.
 */

export type SkeletonProps = RootProps<
  'span',
  {
    /** How wide, as CSS: a length or a share of the line. */
    width?: string
    /** How tall, in px: a line of text by default. */
    height?: number
    /** `line` and `block` are shade; `sheet` is raised paper, as a card is. */
    shape?: 'line' | 'block' | 'sheet'
  }
>

export function Skeleton({ width = '100%', height, shape = 'line', className, style, ...rest }: SkeletonProps) {
  return (
    <span
      className={cx(s.skeleton, s[shape], className)}
      style={{ width, ...(height === undefined ? {} : { height }), ...style }}
      aria-hidden="true"
      {...rest}
    />
  )
}
