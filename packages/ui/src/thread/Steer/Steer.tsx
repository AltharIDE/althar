import { Icon } from '../../foundations/Icon/Icon'
import { useShell, type StepRef } from '../Shell/Shell'
import s from './Steer.module.css'
import { Rhythm } from '../../lib/rhythm'

/*
 * Talking to a step. What you say to a step goes to that step's agent, not
 * the lead; the task thread keeps one line of it, so you and the lead can see
 * it happened.
 */

export interface SteerText {
  youTo: string
  /** What you said, quoted. */
  quote: (said: string) => string
  openStep: (label: string) => string
  justNow: string
}

export const steerText: SteerText = {
  youTo: 'You to',
  quote: (said) => `“${said}”`,
  openStep: (label) => `Open the thread of ${label}`,
  justNow: 'just now',
}

export interface SteerLineProps {
  step: StepRef
  /** What you said to it. */
  said: string
  at?: string
  text?: Partial<SteerText>
}

/** One line in the task thread for something you said to a step. The step's name opens its thread. */
export function SteerLine({ step, said, at, text }: SteerLineProps) {
  const t = { ...steerText, ...text }
  const { openStep } = useShell()
  return (
    <div className={s.steer} data-rhythm={Rhythm.Steer}>
      <Icon name="corner" size={11} className={s.corner} />
      <span className={s.to}>
        {t.youTo}{' '}
        <button type="button" className={s.step} onClick={() => openStep(step)} aria-label={t.openStep(step.label)}>
          {step.label}
        </button>
      </span>
      <span className={s.said}>{t.quote(said)}</span>
      {at && <span className={s.at}>{at}</span>}
    </div>
  )
}

/** The lines you steered to a step from its own thread, kept by the host, for the step they belong to. */
export function Steers({ step, text }: { /** The step's id. */ step: string; text?: Partial<SteerText> }) {
  const t = { ...steerText, ...text }
  const { steers } = useShell()
  return (
    <>
      {steers
        .filter((x) => x.step.id === step)
        .map((x) => (
          <SteerLine key={x.id} step={x.step} said={x.text} at={t.justNow} text={t} />
        ))}
    </>
  )
}
