import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Button } from '../../primitives/Button/Button'
import { Tooltip } from '../../primitives/HoverCard/HoverCard'
import s from './SettleWays.module.css'

/*
 * The two ways a finished task that isn't a change moves on, where the
 * person can press them: Done settles it, Keep for later takes it out of
 * Needs you as it is. On its card, at the foot's end, above the card's own
 * button; in its task's header, right beside where it stands, with Done in
 * ink. Anything else (another round, making it a change, discarding it) is
 * said to its lead. A review has only Keep for later: it settles as its
 * draft is posted. A task kept already has only Done.
 */

export interface SettleWaysText {
  done: string
  keep: string
}

export const settleWaysText: SettleWaysText = {
  done: 'Done',
  keep: 'Keep for later',
}

export type SettleWaysProps = RootProps<
  'span',
  {
    /** Settles it; absent where it isn't the person's to settle here (a review). */
    onDone?: () => void
    /** What Done does, on hover: that it stops its page, where it left one running. */
    doneHint?: string
    /** Takes it out of Needs you, as it is; absent once it is kept. */
    onKeep?: () => void
    keepHint?: string
    /** Which of them is under way: it says so, and the other waits. */
    busy?: 'done' | 'keep'
    /** In the task's header: Done in ink. On a card, it is quieter. */
    ink?: boolean
    text?: Partial<SettleWaysText>
  }
>

export function SettleWays({ onDone, doneHint, onKeep, keepHint, busy, ink = false, text, className, ...rest }: SettleWaysProps) {
  const t = { ...settleWaysText, ...text }
  if (onDone === undefined && onKeep === undefined) return null
  const done = onDone && (
    <Button
      size="small"
      icon="check"
      variant={ink ? 'ink' : 'default'}
      busy={busy === 'done'}
      disabled={busy === 'keep'}
      onClick={(event) => {
        // On a card, the card is the button to the task, and this isn't.
        event.stopPropagation()
        onDone()
      }}
    >
      {t.done}
    </Button>
  )
  const keep = onKeep && (
    <Button
      size="small"
      variant="quiet"
      busy={busy === 'keep'}
      disabled={busy === 'done'}
      onClick={(event) => {
        event.stopPropagation()
        onKeep()
      }}
    >
      {t.keep}
    </Button>
  )
  return (
    <span className={cx(s.ways, className)} {...rest}>
      {done && (doneHint === undefined ? done : <Tooltip label={doneHint}>{done}</Tooltip>)}
      {keep && (keepHint === undefined ? keep : <Tooltip label={keepHint}>{keep}</Tooltip>)}
    </span>
  )
}
