import { Menu, MenuItem, MenuSeparator } from '../../primitives/Menu/Menu'
import { ChromeButton } from '../ChromeButton/ChromeButton'

/*
 * What you can do with a task as a whole, from its bar: open its folder in
 * an editor, start its plan now, mark its draft pull request ready, stop it,
 * resume it, abandon it, reopen it. Each item is there when its callback is,
 * and the consumer gives only those that apply where the task stands, so
 * the menu never offers what the task can't do. With nothing to offer, there
 * is no button. Stopping a task is not interrupting its lead: the composer's
 * square stops one turn and the task keeps going; this stops every agent on
 * it until you resume it. Each item says what happens, since none of them is
 * undone by pressing it again.
 */

export interface TaskMenuText {
  trigger: string
  label: string
  /** Opening the folder, in the editor named. */
  open: (editor: string) => string
  openAbout: string
  startNow: string
  startNowAbout: string
  markReady: string
  markReadyAbout: string
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
  open: (editor) => `Open in ${editor}`,
  openAbout: 'The task’s folder, on its branch.',
  startNow: 'Start now',
  startNowAbout: 'Its plan starts now, without waiting.',
  markReady: 'Mark ready for review',
  markReadyAbout: 'Its draft pull request is no longer a draft.',
  stop: 'Stop the task',
  stopAbout: 'Every agent on it stops. The branch and what it found stay, and you can resume it.',
  resume: 'Resume',
  resumeAbout: 'The lead carries on from the step it was on, in a fresh session.',
  abandon: 'Abandon',
  abandonAbout: 'It settles without its change. Its worktree and branch stay.',
  reopen: 'Reopen',
  reopenAbout: 'It opens again, on the same worktree and branch.',
}

export interface TaskMenuProps {
  /** Opens the task's folder in `editor`, the one its files open in. */
  onOpen?: () => void
  /** The editor it opens in, by name. */
  editor?: string
  /** Starts its plan now, while it waits to start. */
  onStartNow?: () => void
  /** Marks its draft pull request ready for review. */
  onMarkReady?: () => void
  onStop?: () => void
  onResume?: () => void
  /** Abandons it; the consumer asks first, since it settles the task. */
  onAbandon?: () => void
  onReopen?: () => void
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  text?: Partial<TaskMenuText>
}

export function TaskMenu({
  onOpen,
  editor,
  onStartNow,
  onMarkReady,
  onStop,
  onResume,
  onAbandon,
  onReopen,
  open,
  defaultOpen,
  onOpenChange,
  text,
}: TaskMenuProps) {
  const t = { ...taskMenuText, ...text }
  const opener = onOpen !== undefined && editor !== undefined ? { onOpen, editor } : null
  const opens = opener !== null
  // Forward first, then what holds or brings it back, then what settles it, set apart.
  const course = [
    onStartNow && (
      <MenuItem key="start" icon="play" description={t.startNowAbout} onSelect={onStartNow}>
        {t.startNow}
      </MenuItem>
    ),
    onMarkReady && (
      <MenuItem key="ready" icon="pr" description={t.markReadyAbout} onSelect={onMarkReady}>
        {t.markReady}
      </MenuItem>
    ),
    onStop && (
      <MenuItem key="stop" icon="hold" description={t.stopAbout} onSelect={onStop}>
        {t.stop}
      </MenuItem>
    ),
    onResume && (
      <MenuItem key="resume" icon="arrow" description={t.resumeAbout} onSelect={onResume}>
        {t.resume}
      </MenuItem>
    ),
    onReopen && (
      <MenuItem key="reopen" icon="corner" description={t.reopenAbout} onSelect={onReopen}>
        {t.reopen}
      </MenuItem>
    ),
  ].filter(Boolean)
  if (!opens && course.length === 0 && !onAbandon) return null
  return (
    <Menu
      label={t.label}
      align="end"
      width={300}
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      trigger={<ChromeButton icon="more" label={t.trigger} compact />}
    >
      {opener && (
        <MenuItem icon="external" description={t.openAbout} onSelect={opener.onOpen}>
          {t.open(opener.editor)}
        </MenuItem>
      )}
      {opens && course.length > 0 && <MenuSeparator />}
      {course}
      {onAbandon && (
        <>
          {(opens || course.length > 0) && <MenuSeparator />}
          <MenuItem icon="close" tone="danger" description={t.abandonAbout} onSelect={onAbandon}>
            {t.abandon}
          </MenuItem>
        </>
      )}
    </Menu>
  )
}
