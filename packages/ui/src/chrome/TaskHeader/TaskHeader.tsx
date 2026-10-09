import type { ReactNode } from 'react'

import type { TaskStatus } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import type { ModelInfo } from '../../primitives/Model/Model'
import { Tooltip } from '../../primitives/HoverCard/HoverCard'
import { Segmented, type SegmentedOption } from '../../primitives/Segmented/Segmented'
import { StepTrack, type TrackItem } from '../../primitives/StepTrack/StepTrack'
import { TaskGlyph } from '../../primitives/TaskGlyph/TaskGlyph'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import s from './TaskHeader.module.css'

/*
 * The head of a task that has the window, as it sits in the window's bar,
 * after the way back and the task's title (BackCrumb): where it stands, its
 * steps as a small track, the switch between its faces, the conversation and
 * what it made, and what else it opens, the consumer's buttons. Who leads
 * it, its branch, how long it has run and what it cost are on hover over
 * where it stands, and said to a screen reader with it.
 */

export interface TaskHeaderText {
  faces: string
  noBranch: string
}

export const taskHeaderText: TaskHeaderText = {
  faces: 'Face',
  noBranch: 'no branch',
}

export interface TaskHeaderProps<F extends string> {
  /** Which task, for a screen reader: the bar shows it beside the way back. */
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
  /** Its faces, with their keys: always both, so the switch is always where it is. */
  faces?: readonly SegmentedOption<F>[]
  face?: F
  onFace?: (face: F) => void
  /** What else it opens, at the end: ChromeButtons. */
  actions?: ReactNode
  className?: string
  text?: Partial<TaskHeaderText>
}

export function TaskHeader<F extends string>({
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
  actions,
  className,
  text,
}: TaskHeaderProps<F>) {
  const t = { ...taskHeaderText, ...text }
  const said = [kind, lead.name, branch ?? t.noBranch, since, elapsed, cost].filter(Boolean).join(' · ')
  return (
    <header className={cx(s.header, s[status], className)} aria-label={title}>
      <Tooltip label={said}>
        <span className={s.state}>
          <TaskGlyph status={status} />
          {state}
          <VisuallyHidden>, {said}</VisuallyHidden>
        </span>
      </Tooltip>
      {steps && steps.length > 0 && <StepTrack steps={steps} status={status} className={s.track} />}
      {faces && faces.length > 1 && face !== undefined && onFace && (
        <Segmented label={t.faces} options={[...faces]} value={face} onChange={onFace} className={s.faces} />
      )}
      {actions && <div className={s.actions}>{actions}</div>}
    </header>
  )
}
