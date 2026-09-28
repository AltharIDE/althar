import { useRef, type ReactNode } from 'react'

import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { useStickToBottom } from '../../lib/stick'
import { JumpToLatest, type JumpToLatestText } from '../Furniture/Furniture'
import { ThreadMeasure } from '../Thread/Thread'
import s from './TaskFace.module.css'

export type TaskFaceProps = RootProps<
  'div',
  {
    /** The thread. */
    children: ReactNode
    /** The composer, under the thread and in its measure. */
    composer: ReactNode
    /** What opens beside the thread: a document, or a step's own thread. A SidePanel. */
    panel?: ReactNode
    /** How many things arrived since the reader scrolled away, for the pill that takes them down. The host counts them. */
    unseen?: number
    text?: { jump?: Partial<JumpToLatestText> }
  }
>

/**
 * A task's conversation face: the thread scrolls, the composer stays under
 * it, and a document or a step's thread opens beside it rather than over it.
 * The thread follows new content unless you have scrolled away; then a pill
 * offers the way back down. What opens where, and what sending does, belong
 * to the host (see ThreadShellProvider).
 */
export function TaskFace({ children, composer, panel, unseen, text, className, ...rest }: TaskFaceProps) {
  const scroll = useRef<HTMLDivElement>(null)
  const { atBottom, toBottom } = useStickToBottom(scroll)
  return (
    <div className={cx(s.face, panel != null && s.hasPanel, className)} {...rest}>
      <div className={s.main}>
        <div className={s.scrollArea}>
          <div ref={scroll} className={s.scroll}>
            <ThreadMeasure>{children}</ThreadMeasure>
          </div>
          {!atBottom && <JumpToLatest count={unseen} onJump={toBottom} className={s.jump} text={text?.jump} />}
        </div>
        <div className={s.composer}>
          <ThreadMeasure>{composer}</ThreadMeasure>
        </div>
      </div>
      {panel}
    </div>
  )
}
