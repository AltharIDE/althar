import { useId } from 'react'

import { PermissionPolicy } from '../../../foundations/vocabulary'
import { Choices } from '../../../primitives/Choices/Choices'
import { LinkButton } from '../../../primitives/LinkButton/LinkButton'
import { Popover } from '../../../primitives/Popover/Popover'
import { Segmented } from '../../../primitives/Segmented/Segmented'
import { MarkButton } from '../parts/Mark'
import s from './PostureDial.module.css'

/*
 * Path B: the four modes as one dial, from the one that asks you most to
 * the one that asks nothing, at the top of the rules page. A task says in
 * its bar where it stands on that dial, whether it follows the project or
 * has its own; the same words open a short list to set its own, and to go
 * back to the project's.
 */

/** A mode in words: its title, a short form for the bar, and what it means. */
export interface ModeWords {
  title: string
  short: string
  note: string
}

export interface PostureDialText {
  title: string
  more: string
  less: string
}

export const postureDialText: PostureDialText = {
  title: 'How much agents ask',
  more: 'Asks you more',
  less: 'Asks you nothing',
}

export interface PostureDialProps {
  /** The modes, in the dial's order: the one that asks most first. */
  order: readonly PermissionPolicy[]
  words: Readonly<Record<PermissionPolicy, ModeWords>>
  value: PermissionPolicy
  onChange: (mode: PermissionPolicy) => void
  text?: Partial<PostureDialText>
}

/** The dial over the rules page: the modes side by side, the way they lean under them, and what the chosen one means. */
export function PostureDial({ order, words, value, onChange, text }: PostureDialProps) {
  const t = { ...postureDialText, ...text }
  const title = useId()
  const note = useId()
  return (
    <section className={s.dial} aria-labelledby={title}>
      <h2 id={title} className={s.title}>
        {t.title}
      </h2>
      <Segmented
        label={t.title}
        options={order.map((mode) => ({ value: mode, label: words[mode].title }))}
        value={value}
        onChange={onChange}
        className={s.segments}
      />
      <div className={s.lean} aria-hidden="true">
        <span>{t.more}</span>
        <i className={s.leanLine} />
        <span>{t.less}</span>
      </div>
      <p id={note} className={s.note} aria-live="polite">
        {words[value].note}
      </p>
    </section>
  )
}

export interface TaskPostureText {
  /** Before the mode while the task follows the project. */
  projectDefault: string
  /** Before the mode while the task has its own. */
  thisTask: string
  label: string
  heading: string
  /** After the project's own mode in the list. */
  projectsOwn: (project: string) => string
  back: string
  fixed: string
}

export const taskPostureText: TaskPostureText = {
  projectDefault: 'Project default',
  thisTask: 'This task',
  label: 'How much this task asks',
  heading: 'How much this task asks',
  projectsOwn: (project) => `${project}’s default`,
  back: 'Back to project default',
  fixed: 'Never still holds, and no agent reads your credentials or reaches the code host except through Althar.',
}

export interface TaskPostureProps {
  project: string
  order: readonly PermissionPolicy[]
  words: Readonly<Record<PermissionPolicy, ModeWords>>
  /** The project's mode, which the task follows unless it has its own. */
  projectMode: PermissionPolicy
  /** The task's own mode; null while it follows the project. */
  own: PermissionPolicy | null
  /** Sets the task's own mode; null to follow the project again. */
  onChange: (mode: PermissionPolicy | null) => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
  text?: Partial<TaskPostureText>
}

/** Where the task stands on the dial, in its bar; it opens to set its own. Everything allowed is said in ink, with its glyph. */
export function TaskPosture({ project, order, words, projectMode, own, onChange, open, onOpenChange, text }: TaskPostureProps) {
  const t = { ...taskPostureText, ...text }
  const mode = own ?? projectMode
  const everything = mode === PermissionPolicy.AllowAll
  return (
    <Popover
      label={t.label}
      align="end"
      width={360}
      open={open}
      onOpenChange={onOpenChange}
      trigger={
        <MarkButton
          lead={own === null ? t.projectDefault : t.thisTask}
          word={words[mode].short}
          icon={everything ? 'unlocked' : null}
          strong={everything}
        />
      }
    >
      <span className={s.popHead} aria-hidden="true">
        {t.heading}
      </span>
      <Choices
        label={t.heading}
        value={mode}
        onChange={(picked) => onChange(picked === projectMode ? null : picked)}
        options={order.map((value) => ({
          value,
          title: value === projectMode ? `${words[value].title} · ${t.projectsOwn(project)}` : words[value].title,
          note: words[value].note,
        }))}
      />
      <div className={s.popFoot}>
        {own !== null && <LinkButton onClick={() => onChange(null)}>{t.back}</LinkButton>}
        <p className={s.popNote}>{t.fixed}</p>
      </div>
    </Popover>
  )
}
