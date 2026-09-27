import { Icon } from '../../foundations/Icon/Icon'
import { TaskStatus, unreachable } from '../../foundations/vocabulary'
import s from './TaskGlyph.module.css'

/*
 * Where a task stands, as a glyph beside its words: cobalt and pulsing while
 * it runs, violet while it waits on you, a clock while it waits out a usage
 * limit, pause bars once you stopped it, a check once it is done. A stopped
 * task is never a square: that is the composer's, and only interrupts a
 * turn. Decoration: the words beside it say the same.
 */
export function TaskGlyph({ status }: { status: TaskStatus }) {
  switch (status) {
    case TaskStatus.Running:
      return <span className={s.live} aria-hidden="true" />
    case TaskStatus.Yours:
      return <span className={s.you} aria-hidden="true" />
    case TaskStatus.Paused:
      return <Icon name="clock" size={11} className={s.icon} />
    case TaskStatus.Stopped:
      return <Icon name="hold" size={11} className={s.icon} />
    case TaskStatus.Done:
      return <Icon name="check" size={11} className={s.icon} />
    default:
      return unreachable(status)
  }
}
