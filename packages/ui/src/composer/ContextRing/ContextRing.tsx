import type { ReactNode } from 'react'

import type { ModelInfo } from '../../primitives/Model/Model'
import { HoverCard } from '../../primitives/HoverCard/HoverCard'
import s from './ContextRing.module.css'

export interface ContextRingText {
  /** The ring's name. */
  label: (percent: number) => string
  /** The card's first line. */
  share: (percent: number) => ReactNode
  /** Used of total, in thousands of tokens. */
  amount: (used: number, total: number) => string
}

const k = (n: number) => (n >= 1000 ? `${n / 1000}M` : `${n}k`)

export const contextRingText: ContextRingText = {
  label: (p) => `Context ${p}% used`,
  share: (p) => (
    <>
      <b>{p}%</b> of context
    </>
  ),
  amount: (used, total) => `${k(used)} of ${k(total)}`,
}

export interface ContextRingProps {
  /** Tokens used, in thousands. */
  used: number
  /** The window, in thousands of tokens. */
  total: number
  /** The model whose window it is; its short name follows the numbers. */
  model?: ModelInfo
  /** Why it is as full as it is, or what happens when it fills. */
  note?: ReactNode
  /** Whether the detail shows, when the consumer holds it. */
  open?: boolean
  /** Show the detail from the start, as for a screenshot. */
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  text?: Partial<ContextRingText>
}

const R = 6
const C = 2 * Math.PI * R

/**
 * How full the model's context is: a ring you can read at a glance and
 * ignore otherwise. The numbers are behind it, on hover or focus.
 */
export function ContextRing({ used, total, model, note, open, defaultOpen, onOpenChange, text }: ContextRingProps) {
  const t = { ...contextRingText, ...text }
  const pct = total > 0 ? Math.min(1, Math.max(0, used / total)) : 0
  const percent = Math.round(pct * 100)
  return (
    <HoverCard
      placement="above"
      align="end"
      width={232}
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      card={
        <>
          <span className={s.top}>{t.share(percent)}</span>
          <span className={s.bar} aria-hidden="true">
            <i style={{ width: `${pct * 100}%` }} />
          </span>
          <span className={s.n}>
            {t.amount(used, total)}
            {model && ` · ${model.short}`}
          </span>
          {note && <span className={s.note}>{note}</span>}
        </>
      }
    >
      <button type="button" className={s.ring} aria-label={t.label(percent)}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r={R} className={s.track} />
          <circle cx="8" cy="8" r={R} className={s.fill} strokeDasharray={`${C * pct} ${C}`} transform="rotate(-90 8 8)" />
        </svg>
      </button>
    </HoverCard>
  )
}
