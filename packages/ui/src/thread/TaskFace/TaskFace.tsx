import { type CSSProperties, useRef, type ReactNode } from 'react'

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
    /** What opens beside the thread: a document, or a step's own thread. A SidePanel, or a Workbench holding one. */
    panel?: ReactNode
    /** How wide what opens beside is, in px, where the person drags it (a Workbench); otherwise a share of the window. */
    panelWidth?: number
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
export function TaskFace({ children, composer, panel, panelWidth, unseen, text, className, style, ...rest }: TaskFaceProps) {
  const scroll = useRef<HTMLDivElement>(null)
  const { atBottom, toBottom } = useStickToBottom(scroll)
  const sized = panel != null && panelWidth !== undefined ? ({ ...style, '--panel-width': `${panelWidth}px` } as CSSProperties) : style
  return (
    <div className={cx(s.face, panel != null && s.hasPanel, className)} style={sized} {...rest}>
      <div className={s.main} data-floats-host="">
        <div className={s.scrollArea}>
          <div ref={scroll} className={s.scroll}>
            <ThreadMeasure>{children}</ThreadMeasure>
            {/* room for what floats on the composer's edge; a child of the scroller, so growing it is followed like the thread growing */}
            <div className={s.clear} aria-hidden="true" />
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
