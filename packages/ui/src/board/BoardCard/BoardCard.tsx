import type { ReactNode } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { TaskKind, TaskStatus, unreachable } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { LiveDot } from '../../primitives/LiveDot/LiveDot'
import { NextSteps } from '../../primitives/NextStep/NextStep'
import { StepTrack, type TrackItem } from '../../primitives/StepTrack/StepTrack'
import { TaskGlyph } from '../../primitives/TaskGlyph/TaskGlyph'
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
 * started says which, quietly, at its foot. Last, what it offers to do, in
 * the same place on every card: a strip its width.
 */

export interface BoardCardText {
  /** A kind's word on the card; a plain task has none. */
  kind: Record<TaskKind, string>
  /** The automation whose run it is. */
  from: (automation: string) => string
}

export const boardCardText: BoardCardText = {
  kind: {
    [TaskKind.Change]: 'Change',
    [TaskKind.Review]: 'Review',
    [TaskKind.Plain]: '',
  },
  from: (automation) => `From ${automation}`,
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
    /** How long, or since when: 9m. */
    at?: string
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
    /** Open beside the board. */
    current?: boolean
    onOpen?: () => void
    text?: Partial<BoardCardText>
  }
>

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

export function BoardCard({
  status = TaskStatus.Running,
  word,
  kind,
  at,
  title,
  why,
  track,
  object,
  foot,
  next,
  corner,
  from,
  current,
  onOpen,
  text,
  className,
  ...rest
}: BoardCardProps) {
  const t = { ...boardCardText, ...text }
  const named = kind === undefined ? '' : t.kind[kind]
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
      {why !== undefined && why !== '' && <p className={s.why}>{why}</p>}
      {track !== undefined && track.length > 0 && <StepTrack steps={track} labels status={status} className={s.track} />}
      {object !== undefined && object !== null && <div className={s.object}>{object}</div>}
      {foot !== undefined && foot !== null && <div className={b.foot}>{foot}</div>}
      {from !== undefined && from !== '' && (
        <p className={s.from}>
          <Icon name="automation" size={11} />
          {t.from(from)}
        </p>
      )}
      {next !== undefined && next !== null && next !== false && <NextSteps className={b.strip}>{next}</NextSteps>}
      {corner !== undefined && corner !== null && <div className={s.corner}>{corner}</div>}
    </article>
  )
}
