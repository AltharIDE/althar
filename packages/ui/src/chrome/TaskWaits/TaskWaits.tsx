import { Icon } from '../../foundations/Icon/Icon'
import { BlockerStands, TaskStatus } from '../../foundations/vocabulary'
import { blockerStandsText } from '../../foundations/vocabularyText'
import { cx } from '../../lib/cx'
import { ActionButton } from '../../primitives/ActionButton/ActionButton'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { Popover } from '../../primitives/Popover/Popover'
import { TaskGlyph } from '../../primitives/TaskGlyph/TaskGlyph'
import s from './TaskWaits.module.css'

/*
 * The tasks around one that waits for others (tasks wait for their
 * blockers), as its header's chip opens them: what it waits for, each with
 * how it stands (a merged one quiet, as it holds nothing up), then what waits
 * for it. Each opens its task; one it still waits for can be let go on
 * hover, an abandoned one reopened; and, while it waits, it can start now.
 *
 * On a task something else waits for, a part of its chip says what does
 * (`TaskWaitedBy`), and opens the same list.
 */

/** A task it waits for, and how it stands. */
export interface WaitsForTask {
  id: string
  title: string
  stands: BlockerStands
  onOpen?: () => void
  onReopen?: () => void
  onStopWaiting?: () => void
}

/** A task that waits for this one: what else it waits for, if anything, is its line. */
export interface WaitedByTask {
  id: string
  title: string
  /** Its line: Also waits for Hosts screen; Starts once this merges. */
  meta: string
  onOpen?: () => void
}

export interface TaskWaitsText {
  /** The list's name, where it waits, and where only others wait for it. */
  title: string
  waitedTitle: string
  waitsFor: string
  then: string
  waitedBy: string
  stands: Record<BlockerStands, string>
  stopWaiting: string
  stopWaitingFor: (title: string) => string
  reopen: string
  reopenOf: (title: string) => string
  startNow: string
  /** The part on a task others wait for: by name with one, a count with more. */
  waitsForThis: (count: number, title: string) => string
}

export const taskWaitsText: TaskWaitsText = {
  title: 'What this waits for',
  waitedTitle: 'What waits for this',
  waitsFor: 'Waits for',
  then: 'Then',
  waitedBy: 'Waiting for this',
  stands: blockerStandsText,
  stopWaiting: 'Stop waiting',
  stopWaitingFor: (title) => `Stop waiting for ${title}`,
  reopen: 'Reopen',
  reopenOf: (title) => `Reopen ${title}`,
  startNow: 'Start now, without waiting',
  waitsForThis: (count, title) => (count === 1 ? `${title} waits for this` : `${count} wait for this`),
}

function BlockerGlyph({ stands }: { stands: BlockerStands }) {
  switch (stands) {
    case BlockerStands.Working:
    case BlockerStands.Review:
      return <TaskGlyph status={TaskStatus.Running} />
    case BlockerStands.Stuck:
      return <TaskGlyph status={TaskStatus.Stopped} />
    case BlockerStands.Merged:
      return <TaskGlyph status={TaskStatus.Done} />
    case BlockerStands.Abandoned:
      return <Icon name="close" size={11} className={s.bad} />
    case BlockerStands.Planned:
      return <TaskGlyph status={TaskStatus.Queued} />
  }
}

const troubled = (stands: BlockerStands) => stands === BlockerStands.Stuck || stands === BlockerStands.Abandoned

function Row({
  title,
  glyph,
  meta,
  bad = false,
  quiet = false,
  onOpen,
  acts = [],
}: {
  title: string
  glyph: React.ReactNode
  meta: string
  bad?: boolean
  quiet?: boolean
  onOpen?: () => void
  acts?: ReadonlyArray<{ label: string; aria: string; run: () => void }>
}) {
  return (
    <li className={s.row} data-quiet={quiet || undefined}>
      <button type="button" className={s.open} onClick={onOpen} disabled={onOpen === undefined}>
        <span className={s.glyph}>{glyph}</span>
        <span className={s.main}>
          <span className={s.title} title={title}>
            {title}
          </span>
          <span className={cx(s.meta, bad && s.bad)}>{meta}</span>
        </span>
      </button>
      {acts.map((act) => (
        <ActionButton key={act.label} size="small" className={s.act} aria-label={act.aria} onClick={act.run}>
          {act.label}
        </ActionButton>
      ))}
    </li>
  )
}

export interface TaskWaitsProps {
  /** What it waits for, in the order named, merged ones too; empty where it waits for nothing (or has started). */
  waitsFor: readonly WaitsForTask[]
  waitedBy: readonly WaitedByTask[]
  /** Starts it now, whatever it waits for; absent where it can't be started from here. */
  onStartNow?: () => void
  text?: Partial<TaskWaitsText>
}

/** The list: what it waits for, then what waits for it. */
export function TaskWaits({ waitsFor, waitedBy, onStartNow, text }: TaskWaitsProps) {
  const t = { ...taskWaitsText, ...text }
  const waiting = waitsFor.some((one) => one.stands !== BlockerStands.Merged)
  return (
    <div className={s.list}>
      {waiting && (
        <section className={s.section} aria-label={t.waitsFor}>
          <div className={s.head} aria-hidden="true">
            {t.waitsFor}
          </div>
          <ul className={s.rows}>
            {waitsFor.map((one) => (
              <Row
                key={one.id}
                title={one.title}
                glyph={<BlockerGlyph stands={one.stands} />}
                meta={t.stands[one.stands]}
                bad={troubled(one.stands)}
                quiet={one.stands === BlockerStands.Merged}
                {...(one.onOpen === undefined ? {} : { onOpen: one.onOpen })}
                acts={[
                  ...(one.stands === BlockerStands.Abandoned && one.onReopen !== undefined
                    ? [{ label: t.reopen, aria: t.reopenOf(one.title), run: one.onReopen }]
                    : []),
                  ...(one.stands !== BlockerStands.Merged && one.onStopWaiting !== undefined
                    ? [{ label: t.stopWaiting, aria: t.stopWaitingFor(one.title), run: one.onStopWaiting }]
                    : []),
                ]}
              />
            ))}
          </ul>
          {onStartNow !== undefined && (
            <div className={s.foot}>
              <LinkButton onClick={onStartNow}>{t.startNow}</LinkButton>
            </div>
          )}
        </section>
      )}
      {waitedBy.length > 0 && (
        <section className={s.section} aria-label={waiting ? t.then : t.waitedBy}>
          <div className={s.head} aria-hidden="true">
            {waiting ? t.then : t.waitedBy}
          </div>
          <ul className={s.rows}>
            {waitedBy.map((one) => (
              <Row
                key={one.id}
                title={one.title}
                glyph={<TaskGlyph status={TaskStatus.Queued} />}
                meta={one.meta}
                {...(one.onOpen === undefined ? {} : { onOpen: one.onOpen })}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

/** The popover the list opens in, from the trigger given: the header's words, or the part that says what waits. */
export function TaskWaitsPopover({ trigger, label, ...list }: TaskWaitsProps & { trigger: React.ReactElement; label: string }) {
  return (
    <Popover
      label={label}
      placement="below"
      align="end"
      width={400}
      padded={false}
      initialFocus="panel"
      className={s.pop}
      trigger={trigger}
    >
      <TaskWaits {...list} />
    </Popover>
  )
}

/** On a task others wait for: a part of its header's chip, after its words, saying what does, which opens the list. */
export function TaskWaitedBy({ waitedBy, text }: { waitedBy: readonly WaitedByTask[]; text?: Partial<TaskWaitsText> }) {
  const t = { ...taskWaitsText, ...text }
  if (waitedBy.length === 0) return null
  return (
    <TaskWaitsPopover
      label={t.waitedTitle}
      waitsFor={[]}
      waitedBy={waitedBy}
      text={t}
      trigger={
        <button type="button" className={s.beside}>
          {t.waitsForThis(waitedBy.length, waitedBy[0]?.title ?? '')}
          <Icon name="chevronD" size={9} className={s.chev} />
        </button>
      }
    />
  )
}
