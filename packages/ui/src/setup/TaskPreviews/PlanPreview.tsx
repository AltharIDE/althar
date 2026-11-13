import { cssVars } from '../../lib/cssVars'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Button } from '../../primitives/Button/Button'
import { CountdownRing } from '../../primitives/CountdownRing/CountdownRing'
import { Model, type ModelInfo } from '../../primitives/Model/Model'
import type { Countdown } from '../PlansAndReviews/PlansAndReviews'
import s from './TaskPreviews.module.css'

/*
 * What "Start a plan after" makes: a proposed plan as the thread shows it,
 * its steps and, in its foot, the time before it starts on its own, as the
 * ring the thread runs down. A picture, not the plan: nothing in it can be
 * pressed or focused, and a screen reader reads it as the example it is.
 * The ring's share is the wait against the longest there is, so a longer
 * wait shows as more of it; with no wait the plan has started, and what
 * would count down keeps its place, so nothing moves as the setting does.
 */

/** The longest wait the setting offers, which a full ring stands for. */
const LONGEST = 60

export interface PlanPreviewStep {
  id: string
  label: string
  /** Who runs it, as the thread names them. */
  who?: ModelInfo
}

/** The plan it shows: a task's name and title, and its steps. */
export interface PlanPreviewSample {
  task: string
  title: string
  steps: readonly PlanPreviewStep[]
}

export interface PlanPreviewText {
  /** What it is, for a screen reader. */
  label: string
  task: (task: string) => string
  startsIn: (seconds: number) => string
  started: string
  hold: string
  startNow: string
}

export const planPreviewText: PlanPreviewText = {
  label: 'A plan as the thread shows it',
  task: (task) => `Task ${task}`,
  startsIn: (n) => `Starts in ${n}s`,
  started: 'Started',
  hold: 'Hold',
  startNow: 'Start now',
}

export type PlanPreviewProps = RootProps<
  'figure',
  {
    /** Seconds a proposed plan waits before it starts on its own; 0 starts it at once. */
    countdown: Countdown
    sample: PlanPreviewSample
    text?: Partial<PlanPreviewText>
  }
>

/** A proposed plan as the thread shows it, its countdown as a ring: what the time before a plan starts makes. */
export function PlanPreview({ countdown, sample, text, className, ...rest }: PlanPreviewProps) {
  const t = { ...planPreviewText, ...text }
  const started = countdown === 0
  const left = Math.min(1, countdown / LONGEST)
  return (
    <figure className={cx(s.card, className)} aria-label={t.label} {...rest}>
      <div className={s.head}>
        <span className={s.kicker}>{t.task(sample.task)}</span>
        <span className={s.title}>{sample.title}</span>
      </div>
      <ol className={s.steps}>
        {sample.steps.map((step, at) => (
          <li key={step.id} className={s.step}>
            <span className={s.n}>{at + 1}</span>
            <span className={s.label}>{step.label}</span>
            <span className={s.who}>{step.who !== undefined && <Model model={step.who} />}</span>
          </li>
        ))}
      </ol>
      <div className={s.foot}>
        <span className={s.room} />
        <CountdownRing left={left} className={cx(started && s.gone)} />
        <span className={s.when}>{started ? t.started : t.startsIn(countdown)}</span>
        {/* a picture of the buttons: never pressed or focused, and there still once it has started, unseen, to hold the foot's shape */}
        <span className={cx(s.actions, started && s.gone)} inert aria-hidden="true">
          <Button variant="quiet" tabIndex={-1}>
            {t.hold}
          </Button>
          <Button tabIndex={-1}>{t.startNow}</Button>
        </span>
        <i className={cx(s.bar, started && s.gone)} style={cssVars({ '--left': left })} aria-hidden="true" />
      </div>
    </figure>
  )
}
