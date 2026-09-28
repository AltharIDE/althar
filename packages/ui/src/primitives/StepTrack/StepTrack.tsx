import { TaskStatus, TrackStep } from '../../foundations/vocabulary'
import { cssVars } from '../../lib/cssVars'
import { cx } from '../../lib/cx'
import { VisuallyHidden } from '../VisuallyHidden/VisuallyHidden'
import s from './StepTrack.module.css'

/*
 * A task's steps as a row of bars: done in ink, the one it is on in the
 * task's colour, the rest to come. A step that finishes fills with ink from
 * its start. Where the task stands colours the step it
 * is on: cobalt while it runs, violet when it waits on you, still when it is
 * paused or stopped. With labels the step names sit under the bars; without,
 * they are read out but not shown.
 */

export interface TrackItem {
  label: string
  state: TrackStep
}

export interface StepTrackText {
  label: string
  state: Record<TrackStep, string>
}

export const stepTrackText: StepTrackText = {
  label: 'Steps',
  state: {
    [TrackStep.Done]: 'done',
    [TrackStep.Now]: 'now',
    [TrackStep.Seen]: 'reached, then sent back',
    [TrackStep.Next]: 'to come',
  },
}

export interface StepTrackProps {
  steps: readonly TrackItem[]
  /** Where the task stands; it colours the step it is on. */
  status?: TaskStatus
  /** Show the step names under the bars. */
  labels?: boolean
  /** Just started: the bars come in one by one. */
  fresh?: boolean
  className?: string
  text?: Partial<StepTrackText>
}

/** Where step i stands, given the step the task is on and the furthest it had reached. */
function stepAt(i: number, at: number, seen: number, done: boolean): TrackStep {
  if (done || i < at) return TrackStep.Done
  if (i === at) return TrackStep.Now
  if (i <= seen) return TrackStep.Seen
  return TrackStep.Next
}

/** Builds a track from step names and where the task is: the step it is on, and the furthest it had reached. */
export function trackOf(names: readonly string[], at: number, seen = at, done = false): TrackItem[] {
  return names.map((label, i) => ({ label, state: stepAt(i, at, seen, done) }))
}

export function StepTrack({ steps, status = TaskStatus.Running, labels = false, fresh, className, text }: StepTrackProps) {
  const t = { ...stepTrackText, ...text }
  return (
    <ol
      className={cx(s.track, fresh && s.fresh, className)}
      data-status={status}
      style={cssVars({ '--n': steps.length })}
      aria-label={t.label}
    >
      {steps.map((step, i) => (
        <li key={`${step.label}${i}`} className={s[step.state]} style={cssVars({ '--i': i })}>
          <i />
          {labels ? (
            <span className={s.name}>
              {step.label}
              <VisuallyHidden>, {t.state[step.state]}</VisuallyHidden>
            </span>
          ) : (
            <VisuallyHidden>
              {step.label}, {t.state[step.state]}
            </VisuallyHidden>
          )}
        </li>
      ))}
    </ol>
  )
}
