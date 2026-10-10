import { Fragment, useId, type ReactNode } from 'react'

import { Model, type ModelInfo } from '../../foundations/Model/Model'
import { TaskStatus } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import { Heading, type HeadingLevel } from '../../primitives/Heading/Heading'
import { Tooltip } from '../../primitives/HoverCard/HoverCard'
import { Segmented, type SegmentedOption } from '../../primitives/Segmented/Segmented'
import { StepTrack, type TrackItem } from '../../primitives/StepTrack/StepTrack'
import { TaskGlyph } from '../../primitives/TaskGlyph/TaskGlyph'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import s from './TaskHeader.module.css'

/*
 * The head of a task that has the window: its number and title, where it
 * stands, a line of facts (its kind, lead, branch, how long, what it cost
 * at API prices), its steps as a track, and the switch between its faces,
 * the conversation and what it made. What else it can open, like its graph
 * or its code, sits at the right, the consumer's buttons.
 */

export interface TaskHeaderText {
  faces: string
  noBranch: string
  /** What the cost is, beside it for a screen reader and on hover. */
  costNote: string
}

export const taskHeaderText: TaskHeaderText = {
  faces: 'Face',
  noBranch: 'no branch',
  costNote: 'estimated at API prices',
}

export interface TaskHeaderProps<F extends string> {
  /** Its number, when it has one. */
  task?: string
  title: string
  status: TaskStatus
  /** Where it stands, in words: Security review, Ready for you. */
  state: string
  /** What kind of work, in a word. */
  kind?: string
  lead: ModelInfo
  branch?: string
  /** How long ago the step it is on started, or when it settled: security review · 6m. */
  since?: string
  /** How long it has run in all. */
  elapsed?: string
  /** What it cost at API prices, subscription or not: $4.10. */
  cost?: string
  steps?: readonly TrackItem[]
  /** Its faces, with their keys. With one or none, no switch. */
  faces?: readonly SegmentedOption<F>[]
  face?: F
  onFace?: (face: F) => void
  /** Said where the switch would be, when there is only one face. */
  facesNote?: string
  /** What else it opens, at the right: ChromeButtons. */
  actions?: ReactNode
  /** The title's rank in the page's outline. The task has the window, so by default it is the page's title. */
  headingLevel?: HeadingLevel
  className?: string
  text?: Partial<TaskHeaderText>
}

export function TaskHeader<F extends string>({
  task,
  title,
  status,
  state,
  kind,
  lead,
  branch,
  since,
  elapsed,
  cost,
  steps,
  faces,
  face,
  onFace,
  facesNote,
  actions,
  headingLevel = 1,
  className,
  text,
}: TaskHeaderProps<F>) {
  const t = { ...taskHeaderText, ...text }
  const titleId = useId()
  const facts: ReactNode[] = [
    kind,
    <Model key="lead" model={lead} short />,
    branch ?? t.noBranch,
    since,
    elapsed,
    cost && (
      <Tooltip key="cost" label={t.costNote}>
        <span className={s.cost}>
          {cost}
          <VisuallyHidden>, {t.costNote}</VisuallyHidden>
        </span>
      </Tooltip>
    ),
  ].filter(Boolean)
  const switchable = faces && faces.length > 1 && face !== undefined && onFace
  return (
    <header className={cx(s.header, s[status], className)} aria-labelledby={titleId}>
      <div className={s.titleLine}>
        {task && <span className={s.task}>{task}</span>}
        <Heading level={headingLevel} id={titleId} className={s.title}>
          {title}
        </Heading>
        <span className={s.state}>
          <TaskGlyph status={status} />
          {state}
        </span>
      </div>
      <p className={s.facts}>
        {facts.map((f, i) => (
          <Fragment key={i}>
            {i > 0 && <i className={s.dot} aria-hidden="true" />}
            {f}
          </Fragment>
        ))}
      </p>
      {steps && steps.length > 0 && <StepTrack steps={steps} status={status} className={s.track} />}
      <div className={s.row}>
        {switchable ? (
          <Segmented label={t.faces} options={[...faces]} value={face} onChange={onFace} className={s.faces} />
        ) : (
          facesNote && <p className={s.note}>{facesNote}</p>
        )}
        {actions && <div className={s.actions}>{actions}</div>}
      </div>
    </header>
  )
}
