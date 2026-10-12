import { Icon } from '../../foundations/Icon/Icon'
import { Model, type ModelInfo } from '../../primitives/Model/Model'
import { TaskStatus, TrackStep, unreachable } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import { TaskGlyph } from '../../primitives/TaskGlyph/TaskGlyph'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import { PeekDetail, PeekFoot, PeekHead, PeekSection } from '../Dock/Dock'
import s from './WorkPeek.module.css'

/*
 * A task opened in the dock from the board, without taking the window:
 * what it is, its steps one to a line with what each did or is doing, and
 * who leads it. A task not started yet has no steps to show, since they are
 * chosen when it starts; it says what it waits for instead. Settled work
 * says what it came to, and that no agent holds it any more.
 */

export interface PeekStep {
  label: string
  state: TrackStep
  /** What it did, or is doing: 3 findings · Sonnet 5. */
  meta?: string
  /** A project rule added it. */
  added?: boolean
}

export interface WorkPeekText {
  steps: string
  waiting: string
  chosenLater: string
  lead: string
  unstarted: string
  added: string
  state: Record<TrackStep, string>
}

export const workPeekText: WorkPeekText = {
  steps: 'Steps',
  waiting: 'Waiting for',
  chosenLater: 'Its steps are chosen when it starts, not before.',
  lead: 'Lead',
  unstarted: 'Not started · no agent holds it yet',
  added: 'added by rule',
  state: { [TrackStep.Done]: 'done', [TrackStep.Now]: 'now', [TrackStep.Seen]: 'reached, then sent back', [TrackStep.Next]: 'to come' },
}

function Mark({ step, status }: { step: TrackStep; status: TaskStatus }) {
  switch (step) {
    case TrackStep.Done:
      return <Icon name="check" size={10} />
    case TrackStep.Now:
      return <TaskGlyph status={status} />
    case TrackStep.Seen:
    case TrackStep.Next:
      return null
    default:
      return unreachable(step)
  }
}

export interface WorkPeekProps {
  title: string
  /** A line on it: why a step was added, what it produces. */
  note?: string
  status?: TaskStatus
  /** Its steps. Without them it hasn't started, and `waiting` says for what. */
  steps?: readonly PeekStep[]
  /** What a task not started waits for: Starts when 419 merges. */
  waiting?: string
  lead?: ModelInfo
  text?: Partial<WorkPeekText>
}

export function WorkPeek({ title, note, status = TaskStatus.Running, steps, waiting, lead, text }: WorkPeekProps) {
  const t = { ...workPeekText, ...text }
  return (
    <>
      <PeekHead title={title} lead={note} />
      {steps?.length ? (
        <PeekSection label={t.steps}>
          <ol className={cx(s.steps, s[status])}>
            {steps.map((step, i) => (
              <li key={`${step.label}${i}`} className={cx(s.step, s[step.state])}>
                <span className={s.mark}>
                  <Mark step={step.state} status={status} />
                </span>
                <span className={s.text}>
                  <span className={s.label}>
                    {step.label}
                    <VisuallyHidden>, {t.state[step.state]}</VisuallyHidden>
                    {step.added && <span className={s.added}>{t.added}</span>}
                  </span>
                  {step.meta && <span className={s.meta}>{step.meta}</span>}
                </span>
              </li>
            ))}
          </ol>
        </PeekSection>
      ) : (
        waiting && (
          <PeekSection label={t.waiting}>
            <PeekDetail>
              {waiting}. {t.chosenLater}
            </PeekDetail>
          </PeekSection>
        )
      )}
      <PeekFoot>
        {lead ? (
          <span className={s.lead}>
            {t.lead} <Model model={lead} className={s.model} />
          </span>
        ) : (
          t.unstarted
        )}
      </PeekFoot>
    </>
  )
}

export interface SettledPeekText {
  kept: string
}

export const settledPeekText: SettledPeekText = { kept: 'Kept by the project. No agent holds it.' }

/** Settled work in the dock: what it came to. */
export function SettledPeek({ title, meta, text }: { title: string; meta?: string; text?: Partial<SettledPeekText> }) {
  const t = { ...settledPeekText, ...text }
  return (
    <>
      <PeekHead title={title} lead={meta} />
      <PeekFoot>{t.kept}</PeekFoot>
    </>
  )
}
