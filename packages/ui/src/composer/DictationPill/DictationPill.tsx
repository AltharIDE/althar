import { useEffect, useRef, useState } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { cssVars } from '../../lib/cssVars'
import { cx } from '../../lib/cx'
import { Button } from '../../primitives/Button/Button'
import { IconButton } from '../../primitives/IconButton/IconButton'
import { Spinner } from '../../primitives/Spinner/Spinner'
import s from './DictationPill.module.css'

/*
 * Dictation the person carries with them. They started talking in one
 * thread's composer and went to look at something else; what they say goes
 * on being heard, and shows here, over whatever composer the screen has (or
 * at the bottom of the window where it has none), always saying whose it is.
 *
 * Small while it listens: how long, who it is for, the last of what was said,
 * and Stop. It opens into a card with all of it. Once written down it opens by
 * itself, to read, change and send, there or where the person now is; one
 * that couldn't be written down waits, to try again.
 *
 * It keeps one width whatever it says, so it never jumps as words come in:
 * the newest words stay in sight and the oldest slide out at its start.
 */

export type DictationPillPhase = 'listening' | 'writing' | 'written' | 'failed'

export interface DictationPillText {
  open: string
  close: string
  stop: string
  discard: string
  back: string
  keep: string
  retry: string
  writing: string
  /** Before anything is heard. */
  nothing: string
  failed: (said: string) => string
  edit: string
}

export const dictationPillText: DictationPillText = {
  open: 'Show all of what you said',
  close: 'Make it small',
  stop: 'Stop and write it down',
  discard: 'Throw it away',
  back: 'Back to it',
  keep: 'Keep it for later',
  retry: 'Try again',
  writing: 'Writing it down…',
  nothing: 'Listening…',
  failed: (said) => `${said} of what you said couldn't be written down.`,
  edit: 'What you said',
}

export interface DictationPillProps {
  phase: DictationPillPhase
  /** Whose it is: "To the coordinator · althar". */
  to: string
  /** How long it has listened, while it listens. */
  elapsed?: string | null
  /** How loud, latest last, while it listens. */
  levels?: readonly number[]
  /** What was heard so far; once written, the text to send. */
  words: string
  /** Changes the written text. */
  onChange?: (text: string) => void
  /** How much couldn't be written down: "0:12". */
  said?: string
  /** Stops listening, and writes it down. */
  onStop?: () => void
  /** Throws away what is being heard. */
  onDiscard?: () => void
  /** Goes back to the composer it was started in. */
  onBack: () => void
  /** Closes it, leaving what was written in its composer. */
  onKeep?: () => void
  onRetry?: () => void
  /** Sends it where it was started; absent where it can't go from here. */
  send?: { readonly label: string; readonly onSend: () => void; readonly busy?: boolean }
  /** Moves it into the composer on screen instead. */
  move?: { readonly label: string; readonly onMove: () => void }
  /** Why it didn't send. */
  error?: string | null
  /** The shortcut that stops it. */
  kbd?: string
  text?: Partial<DictationPillText>
  className?: string
}

const QUIET = Array.from({ length: 12 }, () => 0)

function Wave({ levels }: { levels: readonly number[] }) {
  return (
    <span className={s.wave} aria-hidden="true">
      {levels.map((level, i) => (
        <i key={i} style={cssVars({ '--l': Math.max(0, Math.min(1, level)) })} />
      ))}
    </span>
  )
}

export function DictationPill({
  phase,
  to,
  elapsed = null,
  levels = QUIET,
  words,
  onChange,
  said = '',
  onStop,
  onDiscard,
  onBack,
  onKeep,
  onRetry,
  send,
  move,
  error = null,
  kbd,
  text,
  className,
}: DictationPillProps) {
  const t = { ...dictationPillText, ...text }
  // Written, or not written, there is something to do: it opens by itself.
  const settled = phase === 'written' || phase === 'failed'
  const [opened, setOpened] = useState(false)
  const open = opened || settled
  const end = useRef<HTMLDivElement>(null)
  // The newest words stay in sight as they come.
  useEffect(() => {
    const box = end.current
    if (box !== null) box.scrollTop = box.scrollHeight
  }, [words, open])

  const status =
    phase === 'writing' ? (
      <span className={s.state}>
        <Spinner size="small" />
        {t.writing}
      </span>
    ) : phase === 'listening' ? (
      <span className={s.state}>
        <Wave levels={levels} />
        <span className={s.time}>{elapsed}</span>
      </span>
    ) : null

  if (!open)
    return (
      <div className={cx(s.root, s.pill, className)} role="group" aria-label={to}>
        {status}
        <span className={s.to}>{to}</span>
        {/* The words open it too; the button after them says so to a screen reader. */}
        <button type="button" className={s.tail} onClick={() => setOpened(true)} tabIndex={-1} aria-hidden="true">
          <span className={s.tailText}>{words === '' ? (phase === 'listening' ? t.nothing : '') : words}</span>
        </button>
        {phase === 'listening' && onStop && (
          <IconButton icon="square" size="small" label={t.stop} {...(kbd === undefined ? {} : { kbd })} onClick={onStop} />
        )}
        <IconButton icon="up" size="small" label={t.open} onClick={() => setOpened(true)} />
      </div>
    )

  return (
    <section className={cx(s.root, s.card, className)} aria-label={to}>
      <header className={s.head}>
        {status}
        <span className={s.to}>{to}</span>
        <Button size="small" variant="quiet" onClick={onBack}>
          {t.back}
        </Button>
        {!settled && <IconButton icon="chevronD" size="small" label={t.close} onClick={() => setOpened(false)} />}
      </header>
      {phase === 'written' ? (
        <textarea
          className={s.edit}
          aria-label={t.edit}
          value={words}
          rows={4}
          // What is being sent stays as it went, until it is there or didn't go.
          readOnly={send?.busy === true}
          onChange={(event) => onChange?.(event.target.value)}
        />
      ) : phase === 'failed' ? (
        <p className={s.failed}>
          <Icon name="stop" size={12} />
          {t.failed(said)}
        </p>
      ) : (
        <div className={s.words} ref={end} aria-live="off">
          {words === '' ? <span className={s.faint}>{t.nothing}</span> : words}
        </div>
      )}
      {error !== null && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      <footer className={s.foot}>
        {phase === 'failed' ? (
          <>
            {onDiscard && (
              <Button size="small" variant="quiet" onClick={onDiscard}>
                {t.discard}
              </Button>
            )}
            <span className={s.grow} />
            {onRetry && (
              <Button size="small" variant="ink" onClick={onRetry}>
                {t.retry}
              </Button>
            )}
          </>
        ) : phase === 'written' ? (
          <>
            {onKeep && (
              <Button size="small" variant="quiet" onClick={onKeep}>
                {t.keep}
              </Button>
            )}
            <span className={s.grow} />
            {move && (
              <Button size="small" onClick={move.onMove}>
                {move.label}
              </Button>
            )}
            {send && (
              <Button size="small" variant="ink" busy={send.busy === true} disabled={words.trim() === ''} onClick={send.onSend}>
                {send.label}
              </Button>
            )}
          </>
        ) : (
          <>
            {phase === 'listening' && onDiscard && (
              <Button size="small" variant="quiet" onClick={onDiscard}>
                {t.discard}
              </Button>
            )}
            <span className={s.grow} />
            {phase === 'listening' && onStop && (
              <Button size="small" variant="ink" icon="square" {...(kbd === undefined ? {} : { kbd })} onClick={onStop}>
                {t.stop}
              </Button>
            )}
          </>
        )}
      </footer>
    </section>
  )
}
