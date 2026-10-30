import type { ReactNode } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { TaskStatus, TrackStep } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import { HoverCard, Tooltip } from '../../primitives/HoverCard/HoverCard'
import { Segmented, type SegmentedOption } from '../../primitives/Segmented/Segmented'
import { StepTrack, type TrackItem } from '../../primitives/StepTrack/StepTrack'
import { TaskGlyph } from '../../primitives/TaskGlyph/TaskGlyph'
import s from './TaskHeader.module.css'

/*
 * The head of a task that has the window, as it sits in the window's bar,
 * after the way back and the task's title (BackCrumb): where it stands, the
 * switch between its faces, the conversation and what it made, and what else
 * it opens, the consumer's buttons.
 *
 * Where it stands is one soft chip, the only thing in the bar in colour:
 * violet when it waits on you, blue while it runs, grey otherwise. What you
 * do about it sits inside it, a finished task's Done and Keep for later
 * (SettleWays in the header); while its plan runs, so do its steps' bars.
 *
 * While a plan of two steps or more is under way, pointing at or focusing
 * where it stands opens a card: who does each step, the one it is on and for
 * how long, and how long it has run in all. That is the one thing the bar
 * doesn't otherwise say: during a review, the reviewer is not the lead the
 * composer names. Where its word has a why the chip has no room for, as what
 * stopped it, pointing or focusing says that. Anywhere else the chip's words
 * say it all.
 */

export interface TaskHeaderText {
  faces: string
  /** How long it has run in all, under its steps. */
  inAll: (took: string) => string
}

export const taskHeaderText: TaskHeaderText = {
  faces: 'Face',
  inAll: (took) => `${took} in all`,
}

/** A step of its plan: its name, where it is, and who does it. */
export interface TaskHeaderStep extends TrackItem {
  /** The agent and model that does it, by name: Claude Opus. */
  who: string
}

export interface TaskHeaderProps<F extends string> {
  /** Which task, for a screen reader: the bar shows it beside the way back. */
  title: string
  status: TaskStatus
  /** Where it stands, in words: Reviewing, Ready to accept; or a way into it that says them (a bare WorkStatus). Without it, no chip, as while it is still read. */
  state?: ReactNode
  /** Why it stands so, where its word doesn't say, on pointing at or focusing it: what stopped it. */
  why?: string
  /** Its plan's steps, each with who does it: bars inside where it stands while it runs, and the card of who does each. */
  steps?: readonly TaskHeaderStep[]
  /** How long the step it is on has run: 4m. */
  took?: string
  /** How long it has run in all. */
  elapsed?: string
  /** Its faces, with their keys: always both, so the switch is always where it is. */
  faces?: readonly SegmentedOption<F>[]
  face?: F
  onFace?: (face: F) => void
  /** What the person does to it next, inside where it stands: a finished task's Done and Keep for later (SettleWays, place="header"). */
  beside?: ReactNode
  /** What else it opens, at the end: ChromeButtons. */
  actions?: ReactNode
  className?: string
  text?: Partial<TaskHeaderText>
}

export function TaskHeader<F extends string>({
  title,
  status,
  state,
  why,
  steps,
  took,
  elapsed,
  faces,
  face,
  onFace,
  beside,
  actions,
  className,
  text,
}: TaskHeaderProps<F>) {
  const t = { ...taskHeaderText, ...text }
  // Its plan under way: the only time there is more to say than the chip's words.
  const plan = status === TaskStatus.Running && steps !== undefined && steps.length > 1 ? steps : null
  const said = (
    <span className={s.state} {...(plan === null && why === undefined ? {} : { tabIndex: 0 })}>
      <TaskGlyph status={status} />
      <span>{state}</span>
    </span>
  )
  return (
    <header className={cx(s.header, className)} aria-label={title}>
      {state != null && (
        <span className={cx(s.chip, (plan !== null || beside != null) && s.parted)} data-status={status}>
          {plan === null ? (
            why === undefined ? (
              said
            ) : (
              <Tooltip label={why} placement="below">
                {said}
              </Tooltip>
            )
          ) : (
            <HoverCard placement="below" width={280} card={<Plan steps={plan} status={status} took={took} elapsed={elapsed} text={t} />}>
              {said}
            </HoverCard>
          )}
          {plan !== null && <StepTrack steps={plan} status={status} className={s.track} />}
          {beside}
        </span>
      )}
      {faces && faces.length > 1 && face !== undefined && onFace && (
        <Segmented label={t.faces} options={[...faces]} value={face} onChange={onFace} className={s.faces} />
      )}
      {actions && <div className={s.actions}>{actions}</div>}
    </header>
  )
}

/** Who does each step, the one it is on timed, then how long in all where that says more. */
function Plan({
  steps,
  status,
  took,
  elapsed,
  text,
}: {
  steps: readonly TaskHeaderStep[]
  status: TaskStatus
  took: string | undefined
  elapsed: string | undefined
  text: TaskHeaderText
}) {
  return (
    <span className={s.plan}>
      <span className={s.steps}>
        {steps.map((step, at) => (
          <span key={`${step.label}${at}`} className={s.step} data-state={step.state}>
            <span className={s.mark} aria-hidden="true">
              {step.state === TrackStep.Done ? (
                <Icon name="check" size={11} />
              ) : step.state === TrackStep.Now ? (
                <TaskGlyph status={status} />
              ) : (
                <i />
              )}
            </span>
            <span className={s.stepName}>{step.label}</span>
            <span className={s.who}>{step.who}</span>
            <span className={s.took}>{step.state === TrackStep.Now ? took : null}</span>
          </span>
        ))}
      </span>
      {elapsed !== undefined && elapsed !== took && <span className={s.inAll}>{text.inAll(elapsed)}</span>}
    </span>
  )
}
