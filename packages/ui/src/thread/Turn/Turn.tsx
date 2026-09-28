import type { ReactNode } from 'react'

import { Model, type ModelInfo } from '../../foundations/Model/Model'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { ActionButton } from '../../primitives/ActionButton/ActionButton'
import { CopyButton, type CopyButtonText } from '../../primitives/CopyButton/CopyButton'
import s from './Turn.module.css'

export interface TurnText {
  quote: string
  copy?: Partial<CopyButtonText>
}

export const turnText: TurnText = { quote: 'Quote' }

/** Who speaks: a model, or a voice that is not one, like the coordinator. */
type Speaker = { model: ModelInfo; voice?: undefined } | { voice: string; model?: undefined }

export type TurnProps = RootProps<
  'article',
  Speaker & {
    at?: string
    children: ReactNode
    /** The quiet note at the end of the actions row: tokens, time. */
    meta?: ReactNode
    /** The text Copy puts on the clipboard. Without it, there is no Copy. */
    copy?: string
    /** Quote the turn into the composer. Without it, there is no Quote. */
    onQuote?: () => void
    /** No name line: a continuation of the turn above. */
    bare?: boolean
    text?: Partial<TurnText>
  }
>

/**
 * The agent's turn: one name for the whole turn, then whatever it holds. Its
 * actions row, when it has Copy, Quote or a note, waits for the turn to be
 * hovered or reached by keyboard.
 */
export function Turn({ model, voice, at, children, meta, copy, onQuote, bare, className, text, ...rest }: TurnProps) {
  const t = { ...turnText, ...text }
  const name = model ? model.name : voice
  return (
    <article className={cx(s.turn, className)} aria-label={name} {...rest}>
      {!bare && (
        <header className={s.head}>
          {model ? <Model model={model} strong className={s.agent} /> : <span className={s.who}>{voice}</span>}
          {at && <span className={s.at}>{at}</span>}
        </header>
      )}
      {children}
      {(copy !== undefined || onQuote || meta) && (
        <div className={s.actions}>
          {copy !== undefined && <CopyButton value={copy} text={t.copy} />}
          {onQuote && (
            <ActionButton icon="quote" onClick={onQuote}>
              {t.quote}
            </ActionButton>
          )}
          {meta && <span className={s.meta}>{meta}</span>}
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
