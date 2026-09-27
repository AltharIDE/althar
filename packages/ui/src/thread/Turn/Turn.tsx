import type { ReactNode } from 'react'

import { Model, type ModelInfo } from '../../foundations/Model/Model'
import { cx } from '../../lib/cx'
import { ActionButton } from '../../primitives/ActionButton/ActionButton'
import { CopyButton, type CopyButtonText } from '../../primitives/CopyButton/CopyButton'
import s from './Turn.module.css'

export interface TurnText {
  quote: string
  copy?: Partial<CopyButtonText>
}

export const turnText: TurnText = { quote: 'Quote' }

/** A speaker that is not a model: the coordinator. */
export interface Voice {
  name: string
}

export interface TurnProps {
  /** Who is speaking: a model, or a voice that is not one. */
  who: ModelInfo | Voice
  at?: string
  children: ReactNode
  /** The quiet note at the end of the actions row: tokens, time. With it, the row shows. */
  actions?: ReactNode
  /** The text Copy puts on the clipboard. Without it, there is no Copy. */
  copy?: string
  /** Quote the turn into the composer. Without it, there is no Quote. */
  onQuote?: () => void
  /** Show the actions without hover; for stories. */
  forceActions?: boolean
  /** No name line: a continuation of the turn above. */
  bare?: boolean
  className?: string
  text?: Partial<TurnText>
}

/** The agent's turn: one name for the whole turn, then whatever it holds. */
export function Turn({ who, at, children, actions, copy, onQuote, forceActions, bare, className, text }: TurnProps) {
  const t = { ...turnText, ...text }
  return (
    <article className={cx(s.turn, forceActions && s.forced, className)} aria-label={who.name}>
      {!bare && (
        <header className={s.head}>
          {'runtime' in who ? <Model model={who} strong className={s.agent} /> : <span className={s.who}>{who.name}</span>}
          {at && <span className={s.at}>{at}</span>}
        </header>
      )}
      {children}
      {actions && (
        <div className={s.actions}>
          {copy !== undefined && <CopyButton value={copy} text={t.copy} />}
          {onQuote && (
            <ActionButton icon="quote" onClick={onQuote}>
              {t.quote}
            </ActionButton>
          )}
          <span className={s.meta}>{actions}</span>
        </div>
      )}
    </article>
  )
}

/** A paragraph of what the agent said. */
export function Prose({ children, dim, className }: { children: ReactNode; dim?: boolean; className?: string }) {
  return <p className={cx(s.prose, dim && s.dim, className)}>{children}</p>
}

/** Class for prose rendered by something else, like a stream. */
export const proseClass = s.prose
