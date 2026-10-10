import { Skeleton, ThreadMeasure, ThreadSkeleton } from '@althar/ui'

import s from './Pending.module.css'

/*
 * What a place shows while what it shows is read, when that takes longer
 * than a glance (the router's `PENDING`): under the window's bar, the shape
 * of what is coming, never a spinner and never an empty screen that might read
 * as nothing there. Its words are for those who can't see it.
 */

export const pendingText = {
  thread: 'Reading the conversation',
  home: 'Reading what waits and what runs',
  page: 'Reading',
}

/** A place with a thread: a task's, or a project's coordinator. */
export function ThreadPending() {
  return (
    <div className={s.window}>
      <div className={s.thread}>
        <ThreadMeasure>
          <ThreadSkeleton label={pendingText.thread} />
        </ThreadMeasure>
      </div>
    </div>
  )
}

/** The home: what waits on the person, as cards, and the projects beside it. */
export function HomePending() {
  return (
    <div className={s.window}>
      <output className={s.home} aria-label={pendingText.home}>
        <div className={s.stream}>
          <Skeleton width="18%" />
          <Skeleton shape="sheet" />
          <Skeleton shape="sheet" />
          <Skeleton width="14%" />
          <Skeleton shape="block" />
        </div>
        <div className={s.side}>
          <Skeleton width="40%" />
          <Skeleton shape="block" />
          <Skeleton shape="block" />
        </div>
      </output>
    </div>
  )
}

/** A page of settings or rules: its heading and a few lines. */
export function PagePending() {
  return (
    <div className={s.window}>
      <output className={s.page} aria-label={pendingText.page}>
        <Skeleton width="32%" height={14} />
        <Skeleton width="90%" />
        <Skeleton width="76%" />
        <Skeleton shape="block" />
        <Skeleton shape="block" />
      </output>
    </div>
  )
}

/** Lines in place of a part of a screen still being read, such as the board or the connections. */
export function PartPending({ label }: { label: string }) {
  return (
    <output className={s.part} aria-label={label}>
      <Skeleton width="36%" />
      <Skeleton shape="block" />
      <Skeleton shape="block" width="82%" />
    </output>
  )
}
