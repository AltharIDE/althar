import { Icon } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import b from '../Board/Board.module.css'
import s from './CallCard.module.css'

/*
 * A call only you can make, on the board: a decision, an approval, a
 * contradiction the project can't settle alone. Its choices are on the card,
 * so you can see what you are being asked before you open it, and so can
 * anyone glancing at the lane. It says which tasks it holds.
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

export interface CallCardProps {
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

export function CallCard({ kind, title, because, options, holds, from, at, current, onOpen, text }: CallCardProps) {
  const t = { ...callCardText, ...text }
  return (
    <article className={cx(b.card, s.call)} aria-current={current || undefined}>
      <div className={b.top}>
        <span className={s.kind}>{kind}</span>
        {at && <span className={b.at}>{at}</span>}
      </div>
      <button type="button" className={cx(b.open, s.title)} onClick={onOpen}>
        {title}
      </button>
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
      <div className={b.foot}>
        {holds?.length ? (
          <span className={s.holds}>
            {t.holds}
            {holds.map((h) => (
              <span key={h} className={b.ref}>
                {h}
              </span>
            ))}
          </span>
        ) : (
          from && <span>{from}</span>
        )}
        <span className={cx(b.go, s.go)} aria-hidden="true">
          {t.decide}
          <Icon name="arrow" size={11} />
        </span>
      </div>
    </article>
  )
}
