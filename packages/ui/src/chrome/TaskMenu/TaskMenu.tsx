import { useRef } from 'react'

import { Menu, MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator } from '../../primitives/Menu/Menu'
import { ChromeButton } from '../ChromeButton/ChromeButton'
import s from './TaskMenu.module.css'

/*
 * What you can do with a task as a whole, from its bar: rename it, open its folder in
 * an editor, start its plan now, mark its draft pull request ready, skip
 * the review of the work under way, stop it, resume it, abandon it, reopen
 * it. Each item is there when its callback is,
 * and the consumer gives only those that apply where the task stands, so
 * the menu never offers what the task can't do. With nothing to offer, there
 * is no button. Stopping a task is not interrupting its lead: the composer's
 * square stops one turn and the task keeps going; this stops every agent on
 * it until you resume it. Each item says what happens, since none of them is
 * undone by pressing it again.
 *
 * Whether its lead resolves a conflict with the default branch on its own
 * is a choice in it too, while it is open: as its project says, or otherwise.
 * Where the task says otherwise than its project, a quiet word beside the
 * button says so; otherwise nothing shows of it until the menu opens.
 */

/** Whether a task's lead resolves conflicts on its own: as its project says, or, otherwise than it, unasked or when asked. */
export type TaskConflicts = 'project' | 'on' | 'off'

export interface TaskMenuText {
  trigger: string
  label: string
  /** Opening the folder, in the editor named. */
  open: (editor: string) => string
  openAbout: string
  rename: string
  renameAbout: string
  startNow: string
  startNowAbout: string
  markReady: string
  markReadyAbout: string
  skipReview: string
  skipReviewAbout: string
  stop: string
  stopAbout: string
  resume: string
  resumeAbout: string
  abandon: string
  abandonAbout: string
  reopen: string
  reopenAbout: string
  conflicts: string
  /** Going by the project, with what the project says now. */
  conflictsProject: string
  conflictsProjectAbout: (on: boolean) => string
  conflictsOn: string
  conflictsOnAbout: string
  conflictsOff: string
  conflictsOffAbout: string
  /** Beside the button, where the task says otherwise than its project. */
  conflictsHint: (on: boolean) => string
}

export const taskMenuText: TaskMenuText = {
  trigger: 'More for this task',
  label: 'This task',
  open: (editor) => `Open in ${editor}`,
  openAbout: 'The task’s folder, on its branch.',
  rename: 'Rename',
  renameAbout: 'Give it another title. Its branch and folder keep their names.',
  startNow: 'Start now',
  startNowAbout: 'Its plan starts now, without waiting.',
  markReady: 'Mark ready for review',
  markReadyAbout: 'Its draft pull request is no longer a draft.',
  skipReview: 'Skip the review',
  skipReviewAbout: 'Its work is ready once its lead is done, unreviewed this time. A review under way stops.',
  stop: 'Stop the task',
  stopAbout: 'Every agent on it stops. The branch and what it found stay, and you can resume it.',
  resume: 'Resume',
  resumeAbout: 'The lead carries on from the step it was on, in a fresh session.',
  abandon: 'Abandon',
  abandonAbout: 'It ends here, and its change isn’t merged. Its worktree and branch stay.',
  reopen: 'Reopen',
  reopenAbout: 'It opens again, on the same worktree and branch.',
  conflicts: 'Resolve conflicts automatically',
  conflictsProject: 'Use the project setting',
  conflictsProjectAbout: (on) => `It’s ${on ? 'on' : 'off'} for this project.`,
  conflictsOn: 'On for this task',
  conflictsOnAbout: 'The lead fixes merge conflicts itself, and Althar pushes the fix to an open pull request.',
  conflictsOff: 'Off for this task',
  conflictsOffAbout: 'You ask the lead to fix a conflict when one comes up.',
  conflictsHint: (on) => `Auto-resolve conflicts: ${on ? 'on' : 'off'}`,
}

export interface TaskMenuProps {
  /** Renames it, in any state: the consumer turns its title into a field. */
  onRename?: () => void
  /** Opens the task's folder in `editor`, the one its files open in. */
  onOpen?: () => void
  /** The editor it opens in, by name. */
  editor?: string
  /** Starts its plan now, while it waits to start. */
  onStartNow?: () => void
  /** Marks its draft pull request ready for review. */
  onMarkReady?: () => void
  /** Skips the review of the work under way, while it still has one to come or under way. */
  onSkipReview?: () => void
  onStop?: () => void
  onResume?: () => void
  /** Abandons it; the consumer asks first, since it settles the task. */
  onAbandon?: () => void
  onReopen?: () => void
  /**
   * Whether its lead resolves a conflict on its own: the task's choice, what
   * its project says (`project`), and changing it. Given while it is open.
   */
  conflicts?: { readonly choice: TaskConflicts; readonly project: boolean; readonly onChange: (choice: TaskConflicts) => void }
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  text?: Partial<TaskMenuText>
}

export function TaskMenu({
  onRename,
  onOpen,
  editor,
  onStartNow,
  onMarkReady,
  onSkipReview,
  onStop,
  onResume,
  onAbandon,
  onReopen,
  conflicts,
  open,
  defaultOpen,
  onOpenChange,
  text,
}: TaskMenuProps) {
  const t = { ...taskMenuText, ...text }
  // Renaming puts the cursor in the title's field: the menu closing doesn't take focus back to its button.
  const renaming = useRef(false)
  const opener = onOpen !== undefined && editor !== undefined ? { onOpen, editor } : null
  // Ways to look at what it made, in the editor, and to name it.
  const opens = opener !== null || onRename !== undefined
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
    onSkipReview && (
      <MenuItem key="skip-review" icon="after" description={t.skipReviewAbout} onSelect={onSkipReview}>
        {t.skipReview}
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
  if (!opens && course.length === 0 && !onAbandon && !conflicts) return null
  // Said beside the button only where the task goes otherwise than its project.
  const differs = conflicts !== undefined && conflicts.choice !== 'project' && (conflicts.choice === 'on') !== conflicts.project
  const menu = (
    <Menu
      label={t.label}
      align="end"
      width={300}
      returnFocus={() => {
        const back = !renaming.current
        renaming.current = false
        return back
      }}
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      trigger={<ChromeButton icon="more" label={t.trigger} compact />}
    >
      {onRename && (
        <MenuItem
          icon="pencil"
          description={t.renameAbout}
          onSelect={() => {
            renaming.current = true
            onRename()
          }}
        >
          {t.rename}
        </MenuItem>
      )}
      {opener && (
        <MenuItem icon="external" description={t.openAbout} onSelect={opener.onOpen}>
          {t.open(opener.editor)}
        </MenuItem>
      )}
      {opens && course.length > 0 && <MenuSeparator />}
      {course}
      {conflicts && (
        <>
          {(opens || course.length > 0) && <MenuSeparator />}
          <MenuRadioGroup label={t.conflicts} value={conflicts.choice} onChange={(choice) => conflicts.onChange(choice as TaskConflicts)}>
            <MenuRadioItem value="project" description={t.conflictsProjectAbout(conflicts.project)}>
              {t.conflictsProject}
            </MenuRadioItem>
            <MenuRadioItem value="on" description={t.conflictsOnAbout}>
              {t.conflictsOn}
            </MenuRadioItem>
            <MenuRadioItem value="off" description={t.conflictsOffAbout}>
              {t.conflictsOff}
            </MenuRadioItem>
          </MenuRadioGroup>
        </>
      )}
      {onAbandon && (
        <>
          {(opens || course.length > 0 || conflicts) && <MenuSeparator />}
          <MenuItem icon="close" tone="danger" description={t.abandonAbout} onSelect={onAbandon}>
            {t.abandon}
          </MenuItem>
        </>
      )}
    </Menu>
  )
  if (!differs) return menu
  return (
    <>
      <span className={s.hint}>{t.conflictsHint(conflicts.choice === 'on')}</span>
      {menu}
    </>
  )
}
