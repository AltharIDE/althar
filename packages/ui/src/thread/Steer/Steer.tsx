import { Icon } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Rhythm } from '../../lib/rhythm'
import { useThreadShell, type StepRef } from '../Shell/Shell'
import s from './Steer.module.css'

/*
 * Talking to a step. What you say to a step goes to that step's agent, not
 * the lead; the task thread keeps one line of it, so you and the lead can see
 * it happened.
 */

/** Something you said to a step. */
export interface SteerNote {
  id: string
  step: StepRef
  text: string
  /** When, formatted. */
  at?: string
}

export interface SteerText {
  youTo: string
  /** What you said, quoted. */
  quote: (said: string) => string
  openStep: (label: string) => string
}

export const steerText: SteerText = {
  youTo: 'You to',
  quote: (said) => `“${said}”`,
  openStep: (label) => `Open the thread of ${label}`,
}

export type SteerLineProps = RootProps<
  'div',
  {
    step: StepRef
    /** What you said to it. */
    said: string
    at?: string
    text?: Partial<SteerText>
  }
>

/** One line in the task thread for something you said to a step. The step's name opens its thread, when the host can open one. */
export function SteerLine({ step, said, at, text, className, ...rest }: SteerLineProps) {
  const t = { ...steerText, ...text }
  const { openStep } = useThreadShell()
  return (
    <div className={cx(s.steer, className)} data-rhythm={Rhythm.Steer} {...rest}>
      <Icon name="corner" size={11} className={s.corner} />
      <span className={s.to}>
        {t.youTo}{' '}
        {openStep ? (
          <button type="button" className={s.step} onClick={() => openStep(step)} aria-label={t.openStep(step.label)}>
            {step.label}
          </button>
        ) : (
          <span className={s.stepName}>{step.label}</span>
        )}
      </span>
      <span className={s.said}>{t.quote(said)}</span>
      {at && <span className={s.at}>{at}</span>}
    </div>
  )
}

export interface SteersProps {
  /** The step, by id. */
  step: string
  /** Everything you have said to steps, as the host keeps it. */
  steers: readonly SteerNote[]
  text?: Partial<SteerText>
}

/** The lines you steered to a step from its own thread, for the step they belong to. */
export function Steers({ step, steers, text }: SteersProps) {
  return (
    <>
      {steers
        .filter((x) => x.step.id === step)
        .map((x) => (
          <SteerLine key={x.id} step={x.step} said={x.text} at={x.at} text={text} />
        ))}
    </>
  )
}
