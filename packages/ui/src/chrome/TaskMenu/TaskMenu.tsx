import { TaskStatus } from '../../foundations/vocabulary'
import { Menu, MenuItem } from '../../primitives/Menu/Menu'
import { ChromeButton } from '../ChromeButton/ChromeButton'

/*
 * What you can do with a task as a whole, from its header: stop it, resume
 * it, abandon it, reopen it. Which of these it offers follows where the task
 * stands. Stopping a task is not interrupting its lead: the composer's
 * square stops one turn and the task keeps going; this stops every agent on
 * it until you resume it. Each item says what happens, since none of them
 * is undone by pressing it again.
 */

export interface TaskMenuText {
  trigger: string
  label: string
  stop: string
  stopAbout: string
  resume: string
  resumeAbout: string
  abandon: string
  abandonAbout: string
  reopen: string
  reopenAbout: string
}

export const taskMenuText: TaskMenuText = {
  trigger: 'More for this task',
  label: 'This task',
  stop: 'Stop the task',
  stopAbout: 'Every agent on it stops. The branch and what it found stay, and you can resume it.',
  resume: 'Resume',
  resumeAbout: 'The lead picks it up from the task’s record, in a fresh session.',
  abandon: 'Abandon',
  abandonAbout: 'Settle it without finishing. The branch and what it found are kept.',
  reopen: 'Reopen',
  reopenAbout: 'Start it again from where it settled.',
}

export interface TaskMenuProps {
  status: TaskStatus
  onStop?: () => void
  onResume?: () => void
  onAbandon?: () => void
  onReopen?: () => void
  defaultOpen?: boolean
  text?: Partial<TaskMenuText>
}

export function TaskMenu({ status, onStop, onResume, onAbandon, onReopen, defaultOpen, text }: TaskMenuProps) {
  const t = { ...taskMenuText, ...text }
  const working = status === TaskStatus.Running || status === TaskStatus.Yours || status === TaskStatus.Paused
  const stopped = status === TaskStatus.Stopped
  const done = status === TaskStatus.Done
  const items = [
    working && onStop && (
      <MenuItem key="stop" icon="hold" description={t.stopAbout} onSelect={onStop}>
        {t.stop}
      </MenuItem>
    ),
    stopped && onResume && (
      <MenuItem key="resume" icon="arrow" description={t.resumeAbout} onSelect={onResume}>
        {t.resume}
      </MenuItem>
    ),
    (working || stopped) && onAbandon && (
      <MenuItem key="abandon" icon="close" description={t.abandonAbout} onSelect={onAbandon}>
        {t.abandon}
      </MenuItem>
    ),
    done && onReopen && (
      <MenuItem key="reopen" icon="corner" description={t.reopenAbout} onSelect={onReopen}>
        {t.reopen}
      </MenuItem>
    ),
  ].filter(Boolean)
  if (items.length === 0) return null
  return (
    <Menu
      label={t.label}
      align="end"
      width={300}
      defaultOpen={defaultOpen}
      trigger={<ChromeButton icon="more" label={t.trigger} compact />}
    >
      {items}
    </Menu>
  )
}
