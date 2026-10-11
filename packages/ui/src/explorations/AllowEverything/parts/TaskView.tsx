import { useState, type ReactNode } from 'react'

import { Composer } from '../../../composer/Composer/Composer'
import { Thread } from '../../../thread/Thread/Thread'
import { Prose, Turn } from '../../../thread/Turn/Turn'
import { TaskFace } from '../../../thread/TaskFace/TaskFace'
import { TASK } from '../fixtures'
import s from './TaskView.module.css'

/*
 * Task 418 with the window: its bar, its thread, and its composer, at a
 * height of its own so it sits in a story or a cell of the light-and-dark
 * grid. What a path changes comes in as the bar, what is in the thread
 * after the lead's last turn, and what floats over the composer.
 */

export function TaskView({
  bar,
  children,
  above,
  height = 640,
}: {
  bar: ReactNode
  children?: ReactNode
  /** What floats on the composer's top edge. */
  above?: ReactNode
  height?: number | string
}) {
  const [draft, setDraft] = useState('')
  return (
    <div className={s.view} style={{ height }}>
      {bar}
      <div className={s.face}>
        <TaskFace
          composer={
            <Composer value={draft} onChange={setDraft} onSubmit={() => setDraft('')} busy placeholder="Tell the lead" above={above} />
          }
        >
          <Thread label={`Task ${TASK.key}`} busy>
            <Turn model={TASK.lead} at="11:40">
              <Prose>The token now refreshes when a role changes. Verifying it against last week’s refunds on staging.</Prose>
            </Turn>
            {children}
          </Thread>
        </TaskFace>
      </div>
    </div>
  )
}
