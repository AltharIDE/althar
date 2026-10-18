import type { ReactNode } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { Caret, Disclosure, DisclosureTrigger, Fold, type Disclosable } from '../../primitives/Fold/Fold'
import { Rhythm } from '../../lib/rhythm'
import s from './Reasoning.module.css'

export interface ReasoningText {
  thinking: string
  thought: (duration: string) => string
  /** Said once it has taken longer than an answer usually does. */
  slow: string
}

export const reasoningText: ReasoningText = { thinking: 'Thinking', thought: (d) => `Thought for ${d}`, slow: 'longer than usual' }

export interface ThinkingProps {
  /** What it says it is doing, when it says. Otherwise, text.thinking. */
  children?: ReactNode
  /** How long it has been at it, once that is worth saying: 12s. Shown, not read out each second. */
  took?: string
  /** It has taken longer than an answer usually does, and says so. */
  slow?: boolean
  text?: Partial<ReasoningText>
}

/**
 * The model is thinking and has nothing to show yet. The label shimmers;
 * then how long it has been, and that it is longer than usual where it is.
 * It shows after a beat, so an answer that comes at once never flashes it,
 * and it stands as tall as a line of what the model says, which takes its
 * place.
 */
export function Thinking({ children, took, slow = false, text }: ThinkingProps) {
  const t = { ...reasoningText, ...text }
  return (
    <div className={s.thinking} role="status">
      <span className={s.shimmer}>{children ?? t.thinking}</span>
      {took !== undefined && (
        <span className={s.took} aria-hidden="true">
          {took}
        </span>
      )}
      {slow && <span className={s.slow}>{t.slow}</span>}
    </div>
  )
}

export interface ReasoningProps extends Disclosable {
  took: string
  children: ReactNode
  text?: Partial<ReasoningText>
}

/** What the model thought, folded to how long it thought for. */
export function Reasoning({ took, children, text, ...disclosure }: ReasoningProps) {
  const t = { ...reasoningText, ...text }
  return (
    <Disclosure {...disclosure} rhythm={Rhythm.Fold}>
      <DisclosureTrigger>
        <button type="button" className={s.row}>
          <Icon name="think" size={12} />
          {t.thought(took)}
          <Caret />
        </button>
      </DisclosureTrigger>
      <Fold>
        <div className={s.body}>{children}</div>
      </Fold>
    </Disclosure>
  )
}
