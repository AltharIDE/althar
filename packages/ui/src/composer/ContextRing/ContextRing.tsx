import type { ReactNode } from 'react'

import { ActionButton } from '../../primitives/ActionButton/ActionButton'
import type { ModelInfo } from '../../primitives/Model/Model'
import { Popover } from '../../primitives/Popover/Popover'
import s from './ContextRing.module.css'

export interface ContextRingText {
  /** The ring's name. */
  label: (percent: number) => string
  /** The panel's name, for assistive technology. */
  panel: string
  /** The panel's first line. */
  share: (percent: number) => ReactNode
  /** Used of total, in thousands of tokens. */
  amount: (used: number, total: number) => string
  /** The action that compacts it. */
  compact: string
  /** While it compacts. */
  compacting: string
}

const k = (n: number) => (n >= 1000 ? `${n / 1000}M` : `${n}k`)

export const contextRingText: ContextRingText = {
  label: (p) => `Context ${p}% used`,
  panel: 'Context',
  share: (p) => (
    <>
      <b>{p}%</b> of context
    </>
  ),
  amount: (used, total) => `${k(used)} of ${k(total)}`,
  compact: 'Compact',
  compacting: 'Compacting…',
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
  /** Compacts the context: given, Compact is in the detail, under the numbers. */
  onCompact?: () => void
  /** A compaction asked for and not yet done: Compact is off, and says so. */
  compacting?: boolean
  text?: Partial<ContextRingText>
}

const R = 6
const C = 2 * Math.PI * R

/**
 * How full the model's context is: a ring you can read at a glance and
 * ignore otherwise. The numbers are behind it, as you point at it or press
 * it, and with them Compact, which has the agent sum up what it holds so
 * each turn after reads less.
 */
export function ContextRing({ used, total, model, note, open, defaultOpen, onOpenChange, onCompact, compacting, text }: ContextRingProps) {
  const t = { ...contextRingText, ...text }
  const pct = total > 0 ? Math.min(1, Math.max(0, used / total)) : 0
  const percent = Math.round(pct * 100)
  return (
    <Popover
      hover
      label={t.panel}
      placement="above"
      align="end"
      width={232}
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      trigger={
        <button type="button" className={s.ring} aria-label={t.label(percent)}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r={R} className={s.track} />
            {pct > 0 && <circle cx="8" cy="8" r={R} className={s.fill} strokeDasharray={`${C * pct} ${C}`} transform="rotate(-90 8 8)" />}
          </svg>
        </button>
      }
    >
      <div className={s.card}>
        <span className={s.top}>{t.share(percent)}</span>
        <span className={s.bar} aria-hidden="true">
          <i style={{ width: `${pct * 100}%` }} />
        </span>
        <span className={s.n}>
          {t.amount(used, total)}
          {model && ` · ${model.short}`}
        </span>
        {note && <span className={s.note}>{note}</span>}
        {onCompact && (
          <span className={s.foot}>
            <ActionButton size="small" flush="end" onClick={onCompact} disabled={compacting === true}>
              {compacting === true ? t.compacting : t.compact}
            </ActionButton>
          </span>
        )}
      </div>
    </Popover>
  )
}
