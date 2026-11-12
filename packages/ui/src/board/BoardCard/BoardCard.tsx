import type { ReactNode } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { TaskKind, TaskStatus, unreachable } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { LiveDot } from '../../primitives/LiveDot/LiveDot'
import { NextSteps } from '../../primitives/NextStep/NextStep'
import { StepTrack, type TrackItem } from '../../primitives/StepTrack/StepTrack'
import { TaskGlyph } from '../../primitives/TaskGlyph/TaskGlyph'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import b from '../Board/Board.module.css'
import { CardTitle } from '../Board/CardTitle'
import s from './BoardCard.module.css'

/*
 * A task on the board, of any kind, with next to nothing to press: the whole
 * card opens the task, where a permission is answered and the lead is told
 * what's next (only its next steps, in the strip at its foot, may be buttons
 * of their own, as NextStep says). Its top says where it stands in a word, in the lane's colour
 * (cobalt while it runs, violet when it needs you), then its kind's word,
 * then how long. Then its title, and, where the word isn't enough, why.
 * Under them, at most, its steps, one card in the card (the pull request,
 * the branch, what it handed back) and one fact. A task an automation's run
 * started says which, quietly, at its foot, as one another task's lead
 * started says that task. Last, what it offers to do, in
 * the same place on every card: a strip its width.
 */

/**
 * A change's mark at the card's foot, in the colour of what it means: violet, ready and waiting on the person; cobalt,
 * its checks running; red, failing; green, merged; grey, not shipped, a draft or closed.
 */
export type ChangeMarkTone = 'signal' | 'live' | 'danger' | 'ok' | 'still'

export interface BoardChangeMark {
  /** The change's name, said to a screen reader and on hover. */
  name: string
  /** Where it stands, in words: Lane heights: checks failing. */
  says: string
  tone: ChangeMarkTone
}

export interface BoardCardText {
  /** A kind's word on the card; a plain task has none. */
  kind: Record<TaskKind, string>
  /** A kind's word for a task in the person's own checkout (ADR-091): with Local after it, or Local alone. */
  local: (kind: string) => string
  /** The automation whose run it is. */
  from: (automation: string) => string
  /** The task whose lead started it (ADR-097). */
  startedBy: (task: string) => string
  /** What comes before the parent's title, where the title opens the parent. */
  startedByLead: string
  /** What its work goes into, where it isn't the default branch (ADR-093), for a screen reader: the card shows an arrow. */
  toward: (branch: string) => string
  /** How many changes it holds, where it holds several (a task is a conversation plus parts). */
  changes: (count: number) => string
}

export const boardCardText: BoardCardText = {
  kind: {
    [TaskKind.Change]: 'Change',
    [TaskKind.Review]: 'Review',
    [TaskKind.Plain]: '',
  },
  local: (kind) => (kind === '' ? 'Local' : `${kind} · Local`),
  from: (automation) => `From ${automation}`,
  startedBy: (task) => `Started by ${task}`,
  startedByLead: 'Started by',
  toward: (branch) => `Toward ${branch}`,
  changes: (count) => `${count} changes`,
}

export type BoardCardProps = RootProps<
  'article',
  {
    /** Where it stands: running, in cobalt; needing you, in violet; or still (waiting for an agent, paused, stopped). */
    status?: TaskStatus
    /** Where it stands, in a word or two, as the caller says it: Implement, Ready to accept, Permission. */
    word: string
    /** What it makes: a change or a review says so; a plain task says nothing. */
    kind?: TaskKind
    /** It works in the person's own checkout, Local, said with its kind's word (ADR-091). */
    local?: boolean
    /** How long, or since when: 9m. */
    at?: string
    /** What its open errands wait on, in a few plain words each, one line apiece: In the merge queue, Merges once checks pass. */
    errands?: readonly string[] | undefined
    title: string
    /** Under the title, where the word isn't enough to say why it needs you. */
    why?: string
    /** Its steps, where it has some worth seeing. */
    track?: readonly TrackItem[]
    /** The card in the card: what this kind makes, at a glance. */
    object?: ReactNode
    /** One fact, at its foot. */
    foot?: ReactNode
    /**
     * What it offers to do without opening it, or where its task leads: one
     * NextStep, or two, the violet one last. Its last row, a strip its width.
     */
    next?: ReactNode
    /**
     * What can be done to it without opening it, in its top corner, over
     * where it stands, shown as the card is hovered or has the focus: a
     * finished task's Done and Keep for later.
     */
    corner?: ReactNode
    /** The automation whose run it is, by its name: said in a small line, with the automation's mark. */
    from?: string
    /** The task whose lead started it, by its title: said in a small line, as `from` is. */
    startedBy?: string
    /** Opens the task whose lead started it: its title in that line is then a link, apart from the card's own press. */
    onOpenStartedBy?: () => void
    /** The branch its work goes into, where it isn't the default (ADR-093): release/0.8.0, quietly, at its foot. */
    toward?: string
    /**
     * How many changes it holds, where it holds several (a task is a conversation plus parts): "3 changes", quietly, at its
     * foot, apart from where it stands, so a count is never read as so many pull requests in that state.
     */
    changes?: number
    /** A mark for each of its several changes, beside the count, in the task's order. */
    marks?: ReadonlyArray<BoardChangeMark>
    /** Open beside the board. */
    current?: boolean
    onOpen?: () => void
    text?: Partial<BoardCardText>
  }
>

/** A change's mark's colour, by its tone; grey, the mark's own, for one still. */
const markClass: Record<ChangeMarkTone, string | undefined> = {
  signal: s.markSignal,
  live: s.markLive,
  danger: s.markDanger,
  ok: s.markOk,
  still: undefined,
}

/** The word's glyph: a live dot while it runs, none when it needs you (the violet says it), else the still state's own. */
function Glyph({ status }: { status: TaskStatus }) {
  switch (status) {
    case TaskStatus.Running:
      return <LiveDot pulse />
    case TaskStatus.Yours:
      return null
    case TaskStatus.Queued:
    case TaskStatus.Paused:
    case TaskStatus.Stopped:
    case TaskStatus.Done:
      return <TaskGlyph status={status} />
    default:
      return unreachable(status)
  }
}

/**
 * Where a task came from, when another task's lead started it (ADR-097): a quiet line, with that task's title as a link where
 * it opens it. On a card's foot, and under a plan up next, where there is no card yet.
 */
export function StartedBy({
  task,
  onOpen,
  text,
}: {
  task: string
  onOpen?: (() => void) | undefined
  text?: Partial<BoardCardText> | undefined
}) {
  const t = { ...boardCardText, ...text }
  return (
    <p className={s.from}>
      <Icon name="corner" size={11} />
      {onOpen === undefined ? (
        t.startedBy(task)
      ) : (
        <>
          {t.startedByLead} <LinkButton onClick={onOpen}>{task}</LinkButton>
        </>
      )}
    </p>
  )
}

export function BoardCard({
  status = TaskStatus.Running,
  word,
  kind,
  local = false,
  at,
  title,
  errands,
  why,
  track,
  object,
  foot,
  next,
  corner,
  from,
  startedBy,
  onOpenStartedBy,
  toward,
  changes,
  marks,
  current,
  onOpen,
  text,
  className,
  ...rest
}: BoardCardProps) {
  const t = { ...boardCardText, ...text }
  const own = kind === undefined ? '' : t.kind[kind]
  const named = local ? t.local(own) : own
  return (
    <article className={cx(b.card, s.card, s[status], className)} aria-current={current || undefined} {...rest}>
      <div className={b.top}>
        <span className={s.word}>
          <Glyph status={status} />
          {word}
        </span>
        {named !== '' && <span className={s.kind}>{named}</span>}
        {at !== undefined && at !== '' && <span className={b.at}>{at}</span>}
      </div>
      <CardTitle className={s.title} onOpen={onOpen}>
        {title}
      </CardTitle>
      {why !== undefined && why !== '' && (
        <p className={s.why} title={why}>
          {why}
        </p>
      )}
      {errands?.map((line) => (
        <p className={s.errand} key={line} title={line}>
          {line}
        </p>
      ))}
      {track !== undefined && track.length > 0 && <StepTrack steps={track} labels status={status} className={s.track} />}
      {object !== undefined && object !== null && <div className={s.object}>{object}</div>}
      {foot !== undefined && foot !== null && <div className={b.foot}>{foot}</div>}
      {changes !== undefined && changes > 1 && (
        <p className={s.changes}>
          {marks !== undefined && marks.length > 0 && (
            <span className={s.marks} role="list">
              {marks.map((mark, at) => (
                // oxlint-disable-next-line no-array-index-key -- two changes can share a name across repositories
                <span key={`${mark.name}:${at}`} role="listitem" className={cx(s.mark, markClass[mark.tone])} title={mark.says}>
                  <VisuallyHidden>{mark.says}</VisuallyHidden>
                </span>
              ))}
            </span>
          )}
          {t.changes(changes)}
        </p>
      )}
      {toward !== undefined && toward !== '' && (
        <p className={s.toward} title={t.toward(toward)}>
          <span aria-hidden="true">→</span>
          <VisuallyHidden>{t.toward(toward)}</VisuallyHidden>
          <code aria-hidden="true">{toward}</code>
        </p>
      )}
      {from !== undefined && from !== '' && (
        <p className={s.from}>
          <Icon name="automation" size={11} />
          {t.from(from)}
        </p>
      )}
      {startedBy !== undefined && startedBy !== '' && <StartedBy task={startedBy} onOpen={onOpenStartedBy} text={text} />}
      {next !== undefined && next !== null && next !== false && <NextSteps className={b.strip}>{next}</NextSteps>}
      {corner !== undefined && corner !== null && <div className={s.corner}>{corner}</div>}
    </article>
  )
}
