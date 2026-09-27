import { useRef, type ReactNode } from 'react'

import { cx } from '../../lib/cx'
import { useStickToBottom } from '../../lib/stick'
import { Measure } from '../Thread/Thread'
import s from './TaskFace.module.css'

export interface TaskFaceProps {
  /** The thread. */
  children: ReactNode
  /** The composer, under the thread and in its measure. */
  composer: ReactNode
  /** What opens beside the thread: a document, or a step's own thread. A SidePanel. */
  panel?: ReactNode
  className?: string
}

/**
 * A task's conversation face: the thread scrolls, the composer stays under
 * it, and a document or a step's thread opens beside it rather than over it.
 * The thread follows new content unless you have scrolled away. What opens
 * where, and what sending does, belong to the host (see Shell).
 */
export function TaskFace({ children, composer, panel, className }: TaskFaceProps) {
  const scroll = useRef<HTMLDivElement>(null)
  useStickToBottom(scroll)
  return (
    <div className={cx(s.face, panel != null && s.hasPanel, className)}>
      <div className={s.main}>
        <div ref={scroll} className={s.scroll}>
          <Measure>{children}</Measure>
        </div>
        <div className={s.composer}>
          <Measure>{composer}</Measure>
        </div>
      </div>
      {panel}
    </div>
  )
}
