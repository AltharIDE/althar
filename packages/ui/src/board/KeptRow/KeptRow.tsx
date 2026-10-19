import { cx } from '../../lib/cx'
import { Tooltip } from '../../primitives/HoverCard/HoverCard'
import { IconButton } from '../../primitives/IconButton/IconButton'
import b from '../Board/Board.module.css'
import { CardTitle } from '../Board/CardTitle'
import s from './KeptRow.module.css'

/*
 * A task kept for later, in one line beside the settled ledger: what it is,
 * and when it was kept. Done sits at its end, a check shown as the row is
 * hovered or has the focus, where it is the person's to settle (a review
 * settles as its draft is posted). Anything else, such as another round, is
 * said to its lead, from its task. What went wrong settling it is said under.
 */

export interface KeptRowText {
  done: string
}

export const keptRowText: KeptRowText = {
  done: 'Done',
}

export interface KeptRowProps {
  title: string
  /** When it was kept, in words: kept 5h ago. */
  at: string
  current?: boolean
  onOpen?: () => void
  /** Settles it; absent where it isn't the person's to settle here. */
  onDone?: () => void
  /** What Done does, on hover: that it stops its page, where it left one running. */
  doneHint?: string
  /** Done under way. */
  busy?: boolean
  /** What went wrong settling it, in words. */
  error?: string
  text?: Partial<KeptRowText>
}

/** One row of what was kept for later. Put it in a BoardList. */
export function KeptRow({ title, at, current, onOpen, onDone, doneHint, busy = false, error, text }: KeptRowProps) {
  const t = { ...keptRowText, ...text }
  return (
    <article className={cx(b.row, s.row)} aria-current={current || undefined}>
      <CardTitle className={s.title} onOpen={onOpen}>
        {title}
      </CardTitle>
      <span className={s.at}>{at}</span>
      {onDone && (
        <span className={s.done}>
          <Tooltip label={doneHint === undefined ? t.done : `${t.done}: ${doneHint}`}>
            <IconButton icon="check" label={t.done} size="small" tooltipShut busy={busy} onClick={onDone} />
          </Tooltip>
        </span>
      )}
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
    </article>
  )
}
