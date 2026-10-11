import { useId, type ReactNode } from 'react'

import { ChromeButton } from '../../../chrome/ChromeButton/ChromeButton'
import l from '../../../composer/Listening/Listening.module.css'
import { taskMenuText } from '../../../chrome/TaskMenu/TaskMenu'
import { unreachable } from '../../../foundations/vocabulary'
import { cx } from '../../../lib/cx'
import { ActionButton } from '../../../primitives/ActionButton/ActionButton'
import { Button } from '../../../primitives/Button/Button'
import { Icon } from '../../../foundations/Icon/Icon'
import { Menu, MenuGroup, MenuItem, MenuSeparator } from '../../../primitives/Menu/Menu'
import { Popover, PopoverClose } from '../../../primitives/Popover/Popover'
import { VisuallyHidden } from '../../../primitives/VisuallyHidden/VisuallyHidden'
import { ExploreIcon } from '../ExploreIcon'
import s from './ForAWhile.module.css'

/*
 * Path D: allowing everything for a while, never for good by accident. You
 * choose how long as you turn it on: an hour, until the task finishes, or
 * until you turn it off; for a task from its menu, for the project from its
 * rules page. While it lasts, a pill over the composer says so and how long
 * is left, beside what the agent listens to and left running, and opens to
 * end it now or give it longer. When it ends it says so once, and the
 * thread keeps one line of what went ahead meanwhile.
 */

/** How long it lasts. */
export type While =
  | { kind: 'hour'; /** What is left, formatted: 52m. */ left: string; /** When it ends: 12:52. */ until: string }
  | { kind: 'task' }
  | { kind: 'off' }

export type WhileKind = While['kind']

export interface ForAWhileText {
  /** Choosing, in a menu or on the rules page. */
  choose: Record<WhileKind, string>
  /** For the project, the task's end is every running task's. */
  chooseProject: Record<WhileKind, string>
  /** Said after the word, while it lasts. */
  left: (left: string) => string
  untilTask: string
  untilOff: string
  /** The menu's group of how long, for a task. */
  menuGroup: string
  /** The pill's word, and the popover's name. */
  word: string
  /** The pill's word when the project's lasts, not the task's. */
  projectWord: (project: string) => string
  /** What the popover says it is. */
  said: (bypass: While, project: string | null) => string
  fixed: string
  stop: string
  longer: string
  /** Once it has ended. */
  ended: (at: string) => string
}

export const forAWhileText: ForAWhileText = {
  choose: { hour: 'For an hour', task: 'Until this task finishes', off: 'Until I turn it off' },
  chooseProject: { hour: 'For an hour', task: 'Until the tasks running now finish', off: 'Until I turn it off' },
  left: (left) => `${left} left`,
  untilTask: 'until this task finishes',
  untilOff: 'until you turn it off',
  menuGroup: 'Allow everything on this task',
  word: 'Allowing everything',
  projectWord: (project) => `${project} allows everything`,
  said: (bypass, project) => {
    const where = project === null ? 'Nothing on this task waits for you' : `Nothing in any ${project} task waits for you`
    switch (bypass.kind) {
      case 'hour':
        return `${where} until ${bypass.until}. Then it asks again, as before.`
      case 'task':
        return project === null
          ? `${where} until it finishes. Reopened, it asks again.`
          : `${where} until the tasks running now finish. Tasks started after ask as before.`
      case 'off':
        return `${where} until you turn it off here.`
      default:
        return unreachable(bypass)
    }
  },
  fixed: 'Never still holds, and no agent reads your credentials or reaches the code host except through Althar.',
  stop: 'Ask again now',
  longer: 'An hour more',
  ended: (at) => `Asking again · allowing everything ended at ${at}`,
}

/** How long is left, or what it lasts until, as the pill and the bar say it. */
export const detailOf = (bypass: While, text?: Partial<ForAWhileText>): string => {
  const t = { ...forAWhileText, ...text }
  switch (bypass.kind) {
    case 'hour':
      return t.left(bypass.left)
    case 'task':
      return t.untilTask
    case 'off':
      return t.untilOff
    default:
      return unreachable(bypass)
  }
}

const KINDS: readonly WhileKind[] = ['hour', 'task', 'off']

export interface WhileMenuProps {
  /** What lasts now, if anything. */
  bypass: While | null
  onStart: (kind: WhileKind) => void
  onStop: () => void
  onStopTask: () => void
  onAbandon: () => void
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  text?: Partial<ForAWhileText>
}

/** The task's menu, as TaskMenu draws it, with allowing everything for a while first: how long, or, while it lasts, asking again. */
export function WhileMenu({ bypass, onStart, onStop, onStopTask, onAbandon, open, defaultOpen, onOpenChange, text }: WhileMenuProps) {
  const t = { ...forAWhileText, ...text }
  const m = taskMenuText
  return (
    <Menu
      label={m.label}
      align="end"
      width={300}
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      note={bypass === null ? t.fixed : undefined}
      trigger={<ChromeButton icon="more" label={m.trigger} compact />}
    >
      {bypass === null ? (
        <MenuGroup label={t.menuGroup}>
          {KINDS.map((kind) => (
            <MenuItem key={kind} lead={<ExploreIcon name="hourglass" size={13} />} onSelect={() => onStart(kind)}>
              {t.choose[kind]}
            </MenuItem>
          ))}
        </MenuGroup>
      ) : (
        <MenuItem lead={<ExploreIcon name="hourglass" size={13} />} description={`${t.word}, ${detailOf(bypass, text)}.`} onSelect={onStop}>
          {t.stop}
        </MenuItem>
      )}
      <MenuSeparator />
      <MenuItem icon="hold" description={m.stopAbout} onSelect={onStopTask}>
        {m.stop}
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon="close" tone="danger" description={m.abandonAbout} onSelect={onAbandon}>
        {m.abandon}
      </MenuItem>
    </Menu>
  )
}

export interface WhilePillProps {
  bypass: While
  /** The project's, which every task in it shows; null for the task's own. */
  project?: string | null
  onStop: () => void
  /** Gives an hour more; only for one that lasts an hour. */
  onLonger?: () => void
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  /** Said once, as it starts. Something that counts down is not announced at every tick. */
  announce?: string
  text?: Partial<ForAWhileText>
}

/** Over the composer while it lasts, as the pills for what the agent listens to and left running are: what, and how long. */
export function WhilePill({ bypass, project = null, onStop, onLonger, open, defaultOpen, onOpenChange, announce, text }: WhilePillProps) {
  const t = { ...forAWhileText, ...text }
  const word = project === null ? t.word : t.projectWord(project)
  return (
    <>
      <Popover
        label={word}
        placement="above"
        width={340}
        open={open}
        defaultOpen={defaultOpen}
        onOpenChange={onOpenChange}
        trigger={
          <button type="button" className={s.pill}>
            <ExploreIcon name="hourglass" size={11} />
            <span className={l.text}>
              <span className={s.word}>{word}</span>
              <span className={cx(l.what, s.left)}>· {detailOf(bypass, text)}</span>
            </span>
            <Icon name="chevronD" size={9} className={l.chev} />
          </button>
        }
      >
        <div className={s.popHead} aria-hidden="true">
          {word}
        </div>
        <p className={s.said}>{t.said(bypass, project)}</p>
        <p className={s.fixed}>{t.fixed}</p>
        <div className={s.popFoot}>
          <PopoverClose>
            <Button size="small" onClick={onStop}>
              {t.stop}
            </Button>
          </PopoverClose>
          {bypass.kind === 'hour' && onLonger && (
            <Button size="small" variant="quiet" onClick={onLonger}>
              {t.longer}
            </Button>
          )}
        </div>
      </Popover>
      <span aria-live="polite">{announce !== undefined && <VisuallyHidden>{announce}</VisuallyHidden>}</span>
    </>
  )
}

/** Where the pill was, once it has ended: said once, quietly, then gone. */
export function WhileEnded({ at, text }: { at: string; text?: Partial<ForAWhileText> }) {
  const t = { ...forAWhileText, ...text }
  return (
    <output className={s.ended}>
      <span className={l.text}>{t.ended(at)}</span>
    </output>
  )
}

export interface ProjectWhileText {
  title: (project: string) => string
  note: string
  on: (project: string) => string
}

export const projectWhileText: ProjectWhileText = {
  title: (project) => `Allow everything in ${project}, for a while`,
  note: 'Every task in the project, while it lasts. Never still holds.',
  on: (project) => `Everything is allowed in ${project}`,
}

export interface ProjectWhileProps {
  project: string
  bypass: While | null
  onStart: (kind: WhileKind) => void
  onStop: () => void
  onLonger?: () => void
  text?: Partial<ProjectWhileText>
  whileText?: Partial<ForAWhileText>
}

/** Over the rules page: how long to allow everything in the project; while it lasts, how long is left, with the way to end it. */
export function ProjectWhile({ project, bypass, onStart, onStop, onLonger, text, whileText }: ProjectWhileProps) {
  const t = { ...projectWhileText, ...text }
  const w = { ...forAWhileText, ...whileText }
  const title = useId()
  let actions: ReactNode
  if (bypass === null)
    actions = KINDS.map((kind) => (
      <ActionButton key={kind} onClick={() => onStart(kind)}>
        {w.chooseProject[kind]}
      </ActionButton>
    ))
  else
    actions = (
      <>
        <Button size="small" onClick={onStop}>
          {w.stop}
        </Button>
        {bypass.kind === 'hour' && onLonger && (
          <Button size="small" variant="quiet" onClick={onLonger}>
            {w.longer}
          </Button>
        )}
      </>
    )
  return (
    <section className={cx(s.sheet, bypass !== null && s.on)} aria-labelledby={title}>
      <h2 id={title} className={s.title}>
        <ExploreIcon name="hourglass" size={14} />
        {bypass === null ? (
          t.title(project)
        ) : (
          <>
            {t.on(project)}
            <span className={s.titleLeft}>· {detailOf(bypass, whileText)}</span>
          </>
        )}
      </h2>
      <p className={s.note}>{bypass === null ? t.note : w.said(bypass, project)}</p>
      <div className={s.actions}>{actions}</div>
    </section>
  )
}
