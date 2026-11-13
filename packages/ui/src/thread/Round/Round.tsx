import type { ReactNode } from 'react'

import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { CopyButton, type CopyButtonText } from '../../primitives/CopyButton/CopyButton'
import { Model, type ModelInfo } from '../../primitives/Model/Model'
import s from './Round.module.css'

export interface RoundText {
  copy?: Partial<CopyButtonText>
}

export type RoundProps = RootProps<
  'article',
  {
    /** Who answers: the task's lead, or a reviewer. */
    model: ModelInfo
    /** Who signs it in place of the model, with its mark: the coordinator, in an aside. */
    signed?: { voice: string; mark: ReactNode }
    /** When it started, as the thread says it: 4m ago. */
    at?: string
    /** The part it plays, where that isn't leading: Review. */
    part?: string
    /** Its acknowledgement, its work in one line, and its result, as they apply. */
    children: ReactNode
    /** What Copy puts on the clipboard: what it said. Without it, there is no Copy. */
    copy?: string
    text?: RoundText
  }
>

/**
 * A round of a task's thread, as its lead (or a reviewer) answers what was
 * asked: one name, then what it said first, the line of its work, and what it
 * said last, each a breath apart, so the work sits back between the words. A
 * picture set it shows stands wider than the words. Copy, where there is
 * something to copy, waits for the round to be hovered or reached by keyboard.
 */
export function Round({ model, signed, at, part, children, copy, text, className, ...rest }: RoundProps) {
  return (
    <article className={cx(s.round, className)} aria-label={signed?.voice ?? model.name} data-arrivals="" {...rest}>
      <header className={s.head}>
        {signed === undefined ? (
          <Model model={model} strong />
        ) : (
          <span className={s.signed}>
            {signed.mark}
            {signed.voice}
          </span>
        )}
        {part !== undefined && <span className={s.part}>{part}</span>}
        {at !== undefined && at !== '' && <span className={s.at}>{at}</span>}
      </header>
      {children}
      {/* Copy waits for the round to be hovered or reached by keyboard */}
      {copy !== undefined && copy !== '' && (
        <div className={s.actions}>
          <CopyButton value={copy} {...(text?.copy === undefined ? {} : { text: text.copy })} />
        </div>
      )}
    </article>
  )
}
