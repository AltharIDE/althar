import type { ReactNode } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { Caret, Disclosure, DisclosureTrigger, Fold, type Disclosable } from '../../primitives/Fold/Fold'
import { Rhythm } from '../../lib/rhythm'
import s from './Reasoning.module.css'

export interface ReasoningText {
  thinking: string
  thought: (duration: string) => string
}

export const reasoningText: ReasoningText = { thinking: 'Thinking', thought: (d) => `Thought for ${d}` }

export interface ThinkingProps {
  /** What it says it is doing, when it says. Otherwise, text.thinking. */
  children?: ReactNode
  text?: Partial<ReasoningText>
}

/** The model is thinking and has nothing to show yet. The label shimmers. */
export function Thinking({ children, text }: ThinkingProps) {
  const t = { ...reasoningText, ...text }
  return (
    <div className={s.thinking} role="status">
      <span className={s.shimmer}>{children ?? t.thinking}</span>
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
