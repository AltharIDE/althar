import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Skeleton } from '../../primitives/Skeleton/Skeleton'
import s from './ThreadSkeleton.module.css'

/*
 * A thread still being read: the shape of its last few turns, yours on the
 * right and the agent's below them, in the column a thread reads in, with
 * no words. Its `label` says what is being read, for those who can't see it.
 */

export type ThreadSkeletonProps = RootProps<'output', { label: string }>

export function ThreadSkeleton({ label, className, ...rest }: ThreadSkeletonProps) {
  return (
    <output className={cx(s.thread, className)} aria-label={label} {...rest}>
      <div className={s.you}>
        <Skeleton shape="block" width="46%" height={38} className={s.bubble} />
      </div>
      <div className={s.turn}>
        <Skeleton width="22%" height={8} />
        <Skeleton width="94%" />
        <Skeleton width="88%" />
        <Skeleton width="58%" />
      </div>
      <div className={s.you}>
        <Skeleton shape="block" width="30%" height={38} className={s.bubble} />
      </div>
      <div className={s.turn}>
        <Skeleton width="26%" height={8} />
        <Skeleton width="91%" />
        <Skeleton width="72%" />
      </div>
    </output>
  )
}
