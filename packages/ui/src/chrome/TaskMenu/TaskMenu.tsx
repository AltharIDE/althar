import { type ReactElement, useRef } from 'react'

import { Menu, MenuItem, MenuSegments, MenuSeparator, MenuSwitchItem } from '../../primitives/Menu/Menu'
import { ChromeButton } from '../ChromeButton/ChromeButton'

/*
 * What you can do with a task as a whole, from its bar, by intent. First what
 * moves it on where it stands (start its plan now, mark its draft pull
 * request ready, skip the review under way, resume it, reopen it) and what
 * you do with it (rename it, open its folder in an editor, attach a pull
 * request it didn't open). Then its own two settings, changed in place:
 * whether its lead resolves a conflict with the default branch on its own,
 * as its project says or otherwise, and whether everything its agents ask is
 * allowed. Last, what stops or ends it: stop it, and abandon it, grey among
 * the rest until pointed at. Each item is there when its callback is, and the
 * consumer gives only those that apply where the task stands, so the menu
 * never offers what the task can't do. With nothing to offer, there is no
 * button.
 *
 * Every row is one line; what it does shows at the menu's foot while it is
 * highlighted, and is its description, since none of them is undone by
 * pressing it again. Stopping a task is not interrupting its lead: the
 * composer's square stops one turn and the task keeps going; this stops every
 * agent on it until you resume it.
 *
 * Where the task resolves conflicts otherwise than its project, a dot on the
 * button says so, and its tooltip how; otherwise nothing shows of it until the
 * menu opens. Where its project allows everything, the task's switch shows on,
 * held, and opens the project's rules, where that is changed.
 */

/** Whether a task's lead resolves conflicts on its own: as its project says, or, otherwise than it, unasked or when asked. */
export type TaskConflicts = 'project' | 'on' | 'off'

export interface TaskMenuText {
  trigger: string
  label: string
  /** Opening the folder, in the editor named. */
  open: (editor: string) => string
  rename: string
  startNow: string
  markReady: string
  attach: string
  skipReview: string
  stop: string
  resume: string
  abandon: string
  /** For a merged task, which abandons only what came after its pull request. */
  abandonMergedAbout: string
  reopen: string
  conflicts: string
  /** Going by the project, with what the project says now. */
  conflictsProject: (on: boolean) => string
  conflictsOn: string
  conflictsOff: string
  /** On the button, where the task says otherwise than its project. */
  conflictsHint: (on: boolean) => string
  /** Allowing everything its agents ask on the task: the switch, what it leaves out, and, while its project allows everything, where that is changed. */
  allowAll: string
  allowAllAbout: string
  allowAllHeld: string
}

export const taskMenuText: TaskMenuText = {
  trigger: 'More for this task',
  label: 'This task',
  open: (editor) => `Open in ${editor}`,
  rename: 'Rename',
  startNow: 'Start now',
  markReady: 'Mark ready for review',
  attach: 'Attach a pull request…',
  skipReview: 'Skip the review',
  stop: 'Stop the task',
  resume: 'Resume',
  abandon: 'Abandon',
  abandonMergedAbout: 'Its pull request stays merged.',
  reopen: 'Reopen',
  conflicts: 'Resolve conflicts automatically',
  conflictsProject: (on) => `Project (${on ? 'on' : 'off'})`,
  conflictsOn: 'On',
  conflictsOff: 'Off',
  conflictsHint: (on) => `Resolve conflicts automatically: ${on ? 'on' : 'off'}`,
  allowAll: 'Allow everything on this task',
  allowAllAbout: 'Except what can’t be undone.',
  allowAllHeld: 'On for the project, in its Rules',
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
  /** Attaches it to an open pull request it didn't open; the consumer asks which. */
  onAttach?: () => void
  /** Skips the review of the work under way, while it still has one to come or under way. */
  onSkipReview?: () => void
  onStop?: () => void
  onResume?: () => void
  /** Abandons it; the consumer asks first, since it settles the task. */
  onAbandon?: () => void
  /** Its change merged: abandoning it leaves out only the commits after it, and it stays merged. */
  merged?: boolean
  onReopen?: () => void
  /**
   * Whether its lead resolves a conflict on its own: the task's choice, what
   * its project says (`project`), and changing it. Given while it is open.
   */
  conflicts?: { readonly choice: TaskConflicts; readonly project: boolean; readonly onChange: (choice: TaskConflicts) => void }
  /**
   * Whether everything its agents ask is allowed, short of what its project
   * never allows: by its own switch (`on`), changed here, or by its
   * project's (`project`), which holds over it. Given while it is open.
   */
  allowEverything?: { readonly on: boolean; readonly project: boolean; readonly onChange: (on: boolean) => void }
  /** Opens its project's rules: where its project allows everything, the task's held switch opens them. */
  onRules?: () => void
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  text?: Partial<TaskMenuText>
}

const present = (item: ReactElement | false | undefined | null): item is ReactElement => Boolean(item)

export function TaskMenu({
  onRename,
  onOpen,
  editor,
  onStartNow,
  onMarkReady,
  onAttach,
  onSkipReview,
  onStop,
  onResume,
  onAbandon,
  merged = false,
  onReopen,
  conflicts,
  allowEverything,
  onRules,
  open,
  defaultOpen,
  onOpenChange,
  text,
}: TaskMenuProps) {
  const t = { ...taskMenuText, ...text }
  // Renaming puts the cursor in the title's field: the menu closing doesn't take focus back to its button.
  const renaming = useRef(false)
  // What moves it on where it stands, then what you do with it.
  const work = [
    onStartNow && (
      <MenuItem key="start" icon="play" onSelect={onStartNow}>
        {t.startNow}
      </MenuItem>
    ),
    onMarkReady && (
      <MenuItem key="ready" icon="pr" onSelect={onMarkReady}>
        {t.markReady}
      </MenuItem>
    ),
    onSkipReview && (
      <MenuItem key="skip-review" icon="after" onSelect={onSkipReview}>
        {t.skipReview}
      </MenuItem>
    ),
    onResume && (
      <MenuItem key="resume" icon="arrow" onSelect={onResume}>
        {t.resume}
      </MenuItem>
    ),
    onReopen && (
      <MenuItem key="reopen" icon="corner" onSelect={onReopen}>
        {t.reopen}
      </MenuItem>
    ),
    onRename && (
      <MenuItem
        key="rename"
        icon="pencil"
        onSelect={() => {
          renaming.current = true
          onRename()
        }}
      >
        {t.rename}
      </MenuItem>
    ),
    onOpen && editor !== undefined && (
      <MenuItem key="open" icon="external" onSelect={onOpen}>
        {t.open(editor)}
      </MenuItem>
    ),
    onAttach && (
      <MenuItem key="attach" icon="clip" onSelect={onAttach}>
        {t.attach}
      </MenuItem>
    ),
  ].filter(present)
  // Its own settings, changed in place.
  const settings = [
    conflicts && (
      <MenuSegments
        key="conflicts"
        label={t.conflicts}
        value={conflicts.choice}
        onChange={(choice) => conflicts.onChange(choice as TaskConflicts)}
        options={[
          { value: 'project', label: t.conflictsProject(conflicts.project) },
          { value: 'on', label: t.conflictsOn },
          { value: 'off', label: t.conflictsOff },
        ]}
      />
    ),
    allowEverything && (
      <MenuSwitchItem
        key="allow"
        checked={allowEverything.on}
        onCheckedChange={allowEverything.onChange}
        // Its project's switch holds over the task's: that one is turned off in the project's rules, which it opens.
        held={allowEverything.project}
        {...(onRules === undefined ? {} : { onHeld: onRules })}
        {...(allowEverything.project ? { note: t.allowAllHeld } : { description: t.allowAllAbout })}
      >
        {t.allowAll}
      </MenuSwitchItem>
    ),
  ].filter(present)
  // What stops or ends it, last; abandoning grey among the rest until pointed at.
  const end = [
    onStop && (
      <MenuItem key="stop" icon="hold" onSelect={onStop}>
        {t.stop}
      </MenuItem>
    ),
    onAbandon && (
      <MenuItem
        key="abandon"
        icon="close"
        tone="danger"
        quiet
        {...(merged ? { description: t.abandonMergedAbout } : {})}
        onSelect={onAbandon}
      >
        {t.abandon}
      </MenuItem>
    ),
  ].filter(present)
  const groups = [work, settings, end].filter((group) => group.length > 0)
  if (groups.length === 0) return null
  // Said on the button only where the task goes otherwise than its project.
  const differs = conflicts !== undefined && conflicts.choice !== 'project' && (conflicts.choice === 'on') !== conflicts.project
  return (
    <Menu
      label={t.label}
      align="end"
      width={280}
      descriptions="foot"
      returnFocus={() => {
        const back = !renaming.current
        renaming.current = false
        return back
      }}
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      trigger={
        <ChromeButton icon="more" label={t.trigger} compact {...(differs ? { mark: t.conflictsHint(conflicts.choice === 'on') } : {})} />
      }
    >
      {groups.flatMap((group, at) => (at === 0 ? group : [<MenuSeparator key={`rule-${at}`} />, ...group]))}
    </Menu>
  )
}
