import type { MouseEvent, ReactElement } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Tooltip } from '../../primitives/HoverCard/HoverCard'
import { IconButton } from '../../primitives/IconButton/IconButton'
import { Spinner } from '../../primitives/Spinner/Spinner'
import s from './SettleWays.module.css'

/*
 * The two ways a finished task that isn't a change moves on, where the
 * person can press them: Done settles it, Keep for later takes it out of
 * Needs you as it is. On its card, two glyphs for its corner, which shows
 * them as the card is hovered or has the focus (BoardCard's corner): a pin,
 * Keep for later, and a check, Done. In its task's header, inside the chip
 * that says where it stands (TaskHeader's beside), in the chip's colour:
 * Done in words, then the pin, each a segment of the chip. Each says what
 * it does on hover. Anything else (another round, making it a change,
 * discarding it) is said to its lead. A review with a draft has only Keep
 * for later: it settles as its draft is posted. A task kept already has only
 * Done.
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
    /** Settles it; absent where it isn't the person's to settle here (a review with a draft). */
    onDone?: () => void
    /** What Done does, on hover: that it stops its page, where it left one running. */
    doneHint?: string
    /** Takes it out of Needs you, as it is; absent once it is kept. */
    onKeep?: () => void
    keepHint?: string
    /** Which of them is under way: it says so, and the other waits. */
    busy?: 'done' | 'keep'
    /** On a card, two glyphs for its corner; in the task's header, segments of the chip that says where it stands. */
    place?: 'card' | 'header'
    text?: Partial<SettleWaysText>
  }
>

/** What a control does, on hover, where there is more to say than its words. */
const hinted = (hint: string | undefined, control: ReactElement) =>
  hint === undefined ? control : <Tooltip label={hint}>{control}</Tooltip>

/** What a glyph does, on hover: its name first, as it is all the glyph says. */
const named = (name: string, hint: string | undefined, control: ReactElement) => (
  <Tooltip label={hint === undefined ? name : `${name}: ${hint}`}>{control}</Tooltip>
)

export function SettleWays({ onDone, doneHint, onKeep, keepHint, busy, place = 'card', text, className, ...rest }: SettleWaysProps) {
  const t = { ...settleWaysText, ...text }
  if (onDone === undefined && onKeep === undefined) return null
  if (place === 'header') {
    // A segment of the chip: under way, it says so and stays where focus is; the other waits.
    const part = (which: 'done' | 'keep', run: () => void) => ({
      type: 'button' as const,
      className: s.part,
      disabled: busy !== undefined && busy !== which,
      'aria-busy': busy === which || undefined,
      'aria-disabled': busy === which || undefined,
      onClick: () => {
        if (busy === undefined) run()
      },
    })
    return (
      <span className={cx(s.parts, className)} {...rest}>
        {onDone &&
          hinted(
            doneHint,
            <button {...part('done', onDone)}>
              {busy === 'done' ? <Spinner size="small" /> : <Icon name="check" size={12} />}
              {t.done}
            </button>,
          )}
        {onKeep &&
          named(
            t.keep,
            keepHint,
            <button {...part('keep', onKeep)} aria-label={t.keep}>
              {busy === 'keep' ? <Spinner size="small" /> : <Icon name="pin" size={12} />}
            </button>,
          )}
      </span>
    )
  }
  // On a card, the card is the button to the task, and these aren't.
  const only = (run: () => void) => (event: MouseEvent) => {
    event.stopPropagation()
    run()
  }
  return (
    <span className={cx(s.ways, className)} {...rest}>
      {onKeep &&
        named(
          t.keep,
          keepHint,
          <IconButton
            icon="pin"
            label={t.keep}
            size="small"
            tooltipShut
            busy={busy === 'keep'}
            disabled={busy === 'done'}
            onClick={only(onKeep)}
          />,
        )}
      {onDone &&
        named(
          t.done,
          doneHint,
          <IconButton
            icon="check"
            label={t.done}
            size="small"
            tooltipShut
            busy={busy === 'done'}
            disabled={busy === 'keep'}
            onClick={only(onDone)}
          />,
        )}
    </span>
  )
}
