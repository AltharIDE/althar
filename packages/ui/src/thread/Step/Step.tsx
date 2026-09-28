import type { ReactNode } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { Model, type ModelInfo } from '../../foundations/Model/Model'
import { StepState, unreachable } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import { ActionButton } from '../../primitives/ActionButton/ActionButton'
import { Caret, Disclosure, DisclosureTrigger, Fold, type Disclosable } from '../../primitives/Fold/Fold'
import { HoverCard } from '../../primitives/HoverCard/HoverCard'
import { Spinner } from '../../primitives/Spinner/Spinner'
import { useThreadShell, type StepRef } from '../Shell/Shell'
import s from './Step.module.css'
import { Rhythm } from '../../lib/rhythm'

export interface StepText {
  /** Where the step sits in the graph. */
  track: (n: number, of: number) => string
  /** Opens why the step was added. */
  why: string
  /** The button that opens a finished step's summary; aria-expanded says whether it is open. */
  detail: (label: string) => string
  thread: string
  openThread: (label: string) => string
}

export const stepText: StepText = {
  track: (n, of) => `Step ${n} of ${of}`,
  why: 'by your rule',
  detail: (label) => `What ${label} found`,
  thread: 'Thread',
  openThread: (label) => `Open the thread of ${label}`,
}

export interface StepProps extends Disclosable {
  /** Where in the task's graph: step n of `of`. */
  n: number
  of: number
  label: string
  model?: ModelInfo
  state?: StepState
  /** Why the step was added, when a rule or you added it. */
  why?: string
  /** How it ended, in a few words. */
  outcome?: string
  took?: string
  /** A summary, for a finished step. */
  detail?: ReactNode
  /** Its own thread, which opens beside this one when the host can open one. */
  thread?: StepRef
  className?: string
  text?: Partial<StepText>
}

function Glyph({ state }: { state: StepState }) {
  switch (state) {
    case StepState.Started:
      return null
    case StepState.Running:
      return <Spinner size="small" />
    case StepState.Done:
      return <Icon name="check" size={11} />
    case StepState.Stopped:
      return <Icon name="square" size={9} />
    default:
      return unreachable(state)
  }
}

export interface StepRowProps {
  n: number
  of: number
  /** The step's name, for the Thread button's accessible name. */
  label: string
  state: StepState
  /** What sits after the track. Without it, the state's own glyph. */
  glyph?: ReactNode
  /** The middle of the line: the label, who, how it went. */
  children: ReactNode
  /** A control before the rule, like the caret that opens the step. */
  more?: ReactNode
  /** Its own thread, which opens beside this one. */
  thread?: StepRef
  text?: Partial<Pick<StepText, 'track' | 'thread' | 'openThread'>>
}

/** The line every step is drawn as: track, glyph, what, a rule across, and its thread. Step and Review are built on it. */
export function StepRow({ n, of, label, state, glyph, children, more, thread, text }: StepRowProps) {
  const t = { ...stepText, ...text }
  const { openStep } = useThreadShell()
  return (
    <div className={cx(s.step, s[state])} aria-busy={state === StepState.Running || undefined}>
      <StepPosition n={n} of={of} state={state} text={t} />
      {glyph ?? <Glyph state={state} />}
      <span className={s.mid}>{children}</span>
      {more}
      <span className={s.line} aria-hidden="true" />
      {thread && openStep && (
        <ActionButton size="small" flush="end" className={s.go} aria-label={t.openThread(label)} onClick={() => openStep(thread)}>
          {t.thread}
        </ActionButton>
      )}
    </div>
  )
}

/** The caret that opens a step, as StepRow's `more`. Inside a Disclosure. */
export function StepMore({ label }: { label: string }) {
  return (
    <DisclosureTrigger>
      <button type="button" className={s.more} aria-label={label}>
        <Caret />
      </button>
    </DisclosureTrigger>
  )
}

/**
 * A step reads like the lead changing: a line across the thread. The track
 * says where in the graph this is, the label what, the model who. Why a
 * step was added is behind "by your rule". A finished step can open to its
 * summary; its own thread opens beside this one.
 */
export function Step({
  n,
  of,
  label,
  model,
  why,
  state = StepState.Started,
  outcome,
  took,
  detail,
  thread,
  className,
  text,
  ...disclosure
}: StepProps) {
  const t = { ...stepText, ...text }
  return (
    <Disclosure {...disclosure} rhythm={Rhythm.Step} className={cx(s.wrap, className)}>
      <StepRow n={n} of={of} label={label} state={state} thread={thread} text={t} more={detail && <StepMore label={t.detail(label)} />}>
        <b className={s.label}>{label}</b>
        {model && <Model model={model} short />}
        {outcome && <span className={s.outcome}>· {outcome}</span>}
        {took && <span className={s.note}>· {took}</span>}
        {why && (
          <HoverCard card={why} width={260} placement="above">
            <button type="button" className={s.why}>
              · {t.why}
            </button>
          </HoverCard>
        )}
      </StepRow>
      {detail && (
        <Fold>
          <div className={s.detail}>{detail}</div>
        </Fold>
      )}
    </Disclosure>
  )
}

/** How one pip of the track looks: before this step, this step, or still to come. */
function pip(k: number, n: number, state: StepState): string | undefined {
  if (k < n) return s.done
  if (k > n) return undefined
  switch (state) {
    case StepState.Done:
      return s.done
    case StepState.Stopped:
      return s.halted
    case StepState.Started:
    case StepState.Running:
      return s.now
    default:
      return unreachable(state)
  }
}

export interface StepPositionProps {
  n: number
  of: number
  state: StepState
  text?: Partial<Pick<StepText, 'track'>>
}

/** Where a step is in the task, as pips: done, now, stopped, still to come. */
export function StepPosition({ n, of, state, text }: StepPositionProps) {
  const t = { ...stepText, ...text }
  return (
    <span className={s.track} role="img" aria-label={t.track(n, of)}>
      {Array.from({ length: of }, (_, i) => (
        <i key={i} className={pip(i + 1, n, state)} />
      ))}
    </span>
  )
}
