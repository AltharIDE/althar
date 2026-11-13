import type { ReactNode, Ref } from 'react'

import { BrandMark } from '../../foundations/Marks/Marks'
import { type UsageLine, type UsageText, usageFigure, usageWhat } from '../../outputs/Usage/Usage'
import { ActionButton } from '../../primitives/ActionButton/ActionButton'
import type { ModelInfo } from '../../primitives/Model/Model'
import { Popover } from '../../primitives/Popover/Popover'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import s from './ContextRing.module.css'

export interface ContextRingText {
  /** The ring's name. */
  label: (percent: number) => string
  /** The panel's name, for assistive technology. */
  panel: string
  /** The panel's one large figure: the share of the context used. */
  share: (percent: number) => string
  /** Used of total, in thousands of tokens. */
  amount: (used: number, total: number) => string
  /** The action that compacts it. */
  compact: string
  /** While it compacts. */
  compacting: string
  /** The action that clears the chat; it asks first. */
  clear: string
  /** An account's line, as the pointer rests on it: its name, and what ran on it. */
  usageTitle: (account: string, what: string) => string
}

const k = (n: number) => (n >= 1000 ? `${n / 1000}M` : `${n}k`)

export const contextRingText: ContextRingText = {
  label: (p) => `Context ${p}% used`,
  panel: 'Context',
  share: (p) => `${p}%`,
  amount: (used, total) => `${k(used)} of ${k(total)} tokens`,
  compact: 'Compact',
  compacting: 'Compacting…',
  clear: 'Clear chat…',
  usageTitle: (account, what) => `${account}: ${what}`,
}

/** What the task, or the day, used of each account (ADR-084), for the ring to say under the context. */
export interface ContextUsage {
  /** Whose: Today, This task. */
  readonly heading: string
  readonly lines: ReadonlyArray<UsageLine>
  readonly text?: Partial<UsageText>
}

export interface ContextRingProps {
  /** Tokens used, in thousands. */
  used: number
  /** The window, in thousands of tokens. */
  total: number
  /**
   * The model whose window it is. The picker beside the ring names it, so the
   * detail doesn't: it only keeps it out of what the usage lines say ran.
   */
  model?: ModelInfo
  /** Why it is as full as it is, or what happens when it fills. */
  note?: ReactNode
  /** What the task, or the day, used of each account, under the context: a quiet line each. */
  usage?: ContextUsage
  /** Whether the detail shows, when the consumer holds it. */
  open?: boolean
  /** Show the detail from the start, as for a screenshot. */
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  /** Compacts the context: given, Compact is beside the figure, last. */
  onCompact?: () => void
  /** A compaction asked for and not yet done: Compact is off, and says so. */
  compacting?: boolean
  /** Clears the chat: given, Clear chat… is beside the figure, before Compact. The host asks what goes before it does. */
  onClear?: () => void
  /** The ring's own button, for a host that gives focus back to it. */
  triggerRef?: Ref<HTMLButtonElement>
  text?: Partial<ContextRingText>
}

const R = 6
const C = 2 * Math.PI * R

/**
 * How full the model's context is: a ring you can read at a glance and
 * ignore otherwise. Its detail, as you point at it or press it, is one large
 * figure with what can be done about it beside it (Clear chat…, which ends
 * the conversation, and Compact, which has the agent sum up what it holds),
 * the bar and the tokens under it, and, quieter still, a line for each
 * account the task or the day used.
 */
export function ContextRing({
  used,
  total,
  model,
  note,
  usage,
  open,
  defaultOpen,
  onOpenChange,
  onCompact,
  compacting,
  onClear,
  triggerRef,
  text,
}: ContextRingProps) {
  const t = { ...contextRingText, ...text }
  const pct = total > 0 ? Math.min(1, Math.max(0, used / total)) : 0
  const percent = Math.round(pct * 100)
  const known = model === undefined ? [] : [model.name]
  return (
    <Popover
      hover
      label={t.panel}
      placement="above"
      align="end"
      width={288}
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      trigger={
        <button ref={triggerRef} type="button" className={s.ring} aria-label={t.label(percent)}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r={R} className={s.track} />
            {pct > 0 && <circle cx="8" cy="8" r={R} className={s.fill} strokeDasharray={`${C * pct} ${C}`} transform="rotate(-90 8 8)" />}
          </svg>
        </button>
      }
    >
      <div className={s.card}>
        <div className={s.head}>
          <span className={s.share}>{t.share(percent)}</span>
          {(onClear || onCompact) && (
            <span className={s.acts}>
              {onClear && (
                <ActionButton size="small" onClick={onClear}>
                  {t.clear}
                </ActionButton>
              )}
              {onCompact && (
                <ActionButton size="small" icon="compress" onClick={onCompact} disabled={compacting === true}>
                  {compacting === true ? t.compacting : t.compact}
                </ActionButton>
              )}
            </span>
          )}
        </div>
        <span className={s.bar} aria-hidden="true">
          <i style={{ width: `${pct * 100}%` }} />
        </span>
        <span className={s.n}>{t.amount(used, total)}</span>
        {note && <span className={s.note}>{note}</span>}
        {usage !== undefined && usage.lines.length > 0 && (
          <div className={s.usage}>
            <span className={s.whose}>{usage.heading}</span>
            <ul className={s.lines}>
              {usage.lines.map((line) => {
                const more = line.why ?? usageWhat(line, known, usage.text)
                return (
                  <li key={line.id} title={line.why ?? t.usageTitle(line.name, more)}>
                    {line.mark !== undefined && <BrandMark brand={line.mark} size={12} />}
                    <span className={s.account}>{line.name}</span>
                    <b className={s.figure}>{usageFigure(line, usage.text)}</b>
                    <VisuallyHidden>{more}</VisuallyHidden>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>
    </Popover>
  )
}
