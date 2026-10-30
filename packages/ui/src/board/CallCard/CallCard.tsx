import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { NextStep, NextSteps } from '../../primitives/NextStep/NextStep'
import b from '../Board/Board.module.css'
import { CardTitle } from '../Board/CardTitle'
import s from './CallCard.module.css'

/*
 * A call only you can make, on the board: a decision, an approval, a
 * contradiction the project can't settle alone. Its choices are on the card,
 * so you can see what you are being asked before you open it, and so can
 * anyone glancing at the lane. It says which tasks it holds, and ends, as
 * every card does, in a strip that says what to do: Decide, in violet.
 */

export interface CallCardText {
  /** The option's key: A, B. */
  key: (i: number) => string
  holds: string
  decide: string
}

export const callCardText: CallCardText = {
  key: (i) => String.fromCharCode(65 + i),
  holds: 'Holds',
  decide: 'Decide',
}

export type CallCardProps = RootProps<
  'article',
  {
    /** What kind of call, in a word: Decision, Approval. */
    kind: string
    title: string
    /** Why it came to you. */
    because?: string
    /** The choices, as they will be offered. A stuck task has none here: what you can do is in the task. */
    options: readonly string[]
    /** The tasks it holds until you answer, by number. */
    holds?: readonly string[]
    /** Where it came from, when it holds nothing: Repair · task 418. */
    from?: string
    /** When it was raised: 18m ago. */
    at?: string
    /** Open beside the board. */
    current?: boolean
    onOpen?: () => void
    text?: Partial<CallCardText>
  }
>

export function CallCard({ kind, title, because, options, holds, from, at, current, onOpen, text, className, ...rest }: CallCardProps) {
  const t = { ...callCardText, ...text }
  return (
    <article className={cx(b.card, s.call, className)} aria-current={current || undefined} {...rest}>
      <div className={b.top}>
        <span className={s.kind}>{kind}</span>
        {at && <span className={b.at}>{at}</span>}
      </div>
      <CardTitle className={s.title} onOpen={onOpen}>
        {title}
      </CardTitle>
      {because && <p className={s.because}>{because}</p>}
      {options.length > 0 && (
        <ol className={s.options}>
          {options.map((o, i) => (
            <li key={o} className={s.option}>
              <span className={s.key} aria-hidden="true">
                {t.key(i)}
              </span>
              {o}
            </li>
          ))}
        </ol>
      )}
      {holds?.length ? (
        <div className={b.foot}>
          <span className={s.holds}>
            {t.holds}
            {holds.map((h) => (
              <span key={h} className={b.ref}>
                {h}
              </span>
            ))}
          </span>
        </div>
      ) : (
        from && (
          <div className={b.foot}>
            <span>{from}</span>
          </div>
        )
      )}
      <NextSteps className={b.strip} aria-hidden="true">
        <NextStep signal>{t.decide}</NextStep>
      </NextSteps>
    </article>
  )
}
