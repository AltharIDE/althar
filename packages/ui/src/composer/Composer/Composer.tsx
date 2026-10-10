import { useId, useLayoutEffect, useRef, type FormEvent, type ReactNode, type RefObject } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import { ActionButton } from '../../primitives/ActionButton/ActionButton'
import { Tooltip } from '../../primitives/HoverCard/HoverCard'
import { IconButton } from '../../primitives/IconButton/IconButton'
import { Kbd } from '../../primitives/Kbd/Kbd'
import { cssVars } from '../../lib/cssVars'
import { useRefocus } from '../../lib/refocus'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import s from './Composer.module.css'

/* Bars at rest, for a transcriber that does not report levels. */
const QUIET: readonly number[] = Array.from({ length: 12 }, () => 0)

export interface Dictation {
  /** Time so far while dictating, formatted (0:04); null when not dictating. */
  elapsed: string | null
  /** How loud you are, recent first-to-last, each from 0 to 1: drawn as bars while dictating. */
  levels?: readonly number[]
  /** Words heard and not yet settled, shown faint where they will land (`at`), while listening and until they are written. For a transcriber that streams. */
  interim?: string
  /** Where in what is written the words will land; the end when not given. */
  at?: number
  /** The shortcut that starts and stops dictating, shown in the microphone's tooltip; the consumer binds it. */
  kbd?: string
  /** Writing down what was said, or getting the speech model ready: the microphone turns. */
  busy?: boolean
  /** The speech model coming down, from 0 to 1: a ring fills round the microphone. */
  progress?: number
  /** The microphone's tray (`tray`) is open. */
  expanded?: boolean
  onStart: () => void
  onStop: () => void
}

/** Something you sent while the agent worked, waiting for it to finish what it is doing. */
export interface QueuedMessage {
  id: string
  text: string
}

export interface ComposerText {
  send: string
  /** The key that sends or queues, shown in the button's tooltip. */
  sendKey: string
  /** Sending while the agent works: it waits until the agent is done with what it is doing. */
  queue: string
  /** Stops the agent's turn; the task keeps going, and the agent waits for you. */
  stop: string
  /** The host's shortcut for stopping, shown in the button's tooltip. */
  stopKey: string
  queueNote: string
  /** Sends while the agent works, instead of queueing: it stops at a safe point and carries on with both. */
  sendNow: string
  /** What Send now does, in its tooltip. */
  sendNowNote: string
  sendNowKey: string
  newlineNote: string
  dictate: string
  /** The microphone while what was said is written down, or the speech model is made ready. */
  dictateBusy: string
  /** The microphone while the speech model downloads. */
  dictateProgress: (percent: number) => string
  stopDictating: (elapsed: string) => string
  /** The field's placeholder while dictating. */
  listening: string
  queued: (n: number) => string
  /** Takes a queued message back into the field. */
  editQueued: string
  unqueue: (text: string) => string
}

export const composerText: ComposerText = {
  send: 'Send',
  sendKey: '↵',
  queue: 'Queue',
  stop: 'Interrupt the lead',
  stopKey: '⌘.',
  queueNote: 'Enter queues it; the lead reads it next',
  sendNow: 'Send now',
  sendNowNote: 'Interrupt the lead with this; it carries on with both',
  sendNowKey: '⌘↵',
  newlineNote: 'Shift+Enter for a new line',
  dictate: 'Dictate',
  dictateBusy: 'Writing down what you said',
  dictateProgress: (percent) => `Dictate. The speech model is downloading, ${percent}%`,
  stopDictating: (elapsed) => `Stop dictating, ${elapsed}`,
  listening: 'Listening…',
  queued: (n) => (n === 1 ? 'Queued; the lead reads it next' : `${n} queued; the lead reads them in order`),
  editQueued: 'Edit',
  unqueue: (text) => `Take “${text}” out of the queue`,
}

export interface ComposerProps {
  value: string
  onChange: (value: string) => void
  onSubmit: (text: string) => void
  /** While the agent works: send now instead of queueing, with ⌘Enter or the Send now beside the note. Without it, text only queues. */
  onSendNow?: (text: string) => void
  /** Also the field's accessible name. */
  placeholder: string
  /** The start of the lower row: which model, how hard. A ModelPick. */
  picker?: ReactNode
  /** Before the send button: how full the context is. A ContextRing. */
  meter?: ReactNode
  /** The agent is working: text you send is queued, and an empty composer offers to interrupt it when it can. */
  busy?: boolean
  /** Interrupt the agent's turn. Without it, a busy composer with nothing written offers nothing. */
  onStopAgent?: () => void
  dictation?: Dictation
  /** What you sent while it worked, in order; the agent reads them once it is done with what it is doing. */
  queued?: readonly QueuedMessage[]
  /** Take a queued message back into the field. Without it, a queued message has no Edit. */
  onEditQueued?: (id: string) => void
  /** Take a queued message out of the queue. */
  onUnqueue?: (id: string) => void
  /** The shortcut that focuses the composer, shown when there is nothing to send. */
  hint?: string
  /** What floats on the composer's top edge: what the agent listens to, what it left running. */
  above?: ReactNode
  /** What is joined to the composer's top edge, in the flow: a DictationTray. The field stays usable under it. */
  tray?: ReactNode
  inputRef?: RefObject<HTMLTextAreaElement | null>
  className?: string
  text?: Partial<ComposerText>
}

/**
 * The one composer, for the project conversation and for a task. Two rows:
 * what you are writing, then where it goes. Enter sends, Shift+Enter breaks
 * the line. The lower row holds what the consumer puts there, the model
 * picker and the context meter, quiet until you look.
 */
export function Composer({
  value,
  onChange,
  onSubmit,
  onSendNow,
  placeholder,
  picker,
  meter,
  busy = false,
  onStopAgent,
  dictation,
  queued = [],
  onEditQueued,
  onUnqueue,
  hint,
  above,
  tray,
  inputRef,
  className,
  text,
}: ComposerProps) {
  const t = { ...composerText, ...text }
  const own = useRef<HTMLTextAreaElement>(null)
  const ref = inputRef ?? own
  const hintId = useId()
  const elapsed = dictation?.elapsed ?? null
  const interim = dictation?.interim ?? ''
  /* While words arrive or are written down, the field is the dictation's: typing would land where they are about to. */
  const dictating = elapsed !== null || dictation?.busy === true
  const overlay = useRef<HTMLDivElement>(null)
  const at = Math.max(0, Math.min(value.length, dictation?.at ?? value.length))
  const before = value.slice(0, at)
  const after = value.slice(at)
  const drafted = value.trim() !== ''
  /* the microphone takes focus back when its tray closes with focus inside it */
  const mic = useRefocus<HTMLButtonElement>(tray != null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [value, ref])

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    const out = value.trim()
    if (out) onSubmit(out)
  }
  const canSendNow = busy && drafted && onSendNow !== undefined
  const sendNow = () => {
    const out = value.trim()
    if (out) onSendNow?.(out)
  }

  const shownPlaceholder = (() => {
    if (interim) return ''
    if (elapsed !== null) return t.listening
    return placeholder
  })()

  const note = (() => {
    if (busy && drafted) return t.queueNote
    if (value.includes('\n')) return t.newlineNote
    return null
  })()

  /* What the last button is. While the agent works, an empty composer offers
     to stop it; text you send waits until it is done with what it is doing, rather than cutting in. */
  const action = (() => {
    if (drafted) return <IconButton icon="up" label={busy ? t.queue : t.send} tone="fill" type="submit" kbd={t.sendKey} />
    if (busy && onStopAgent) return <IconButton icon="square" label={t.stop} tone="fill" onClick={onStopAgent} kbd={t.stopKey} />
    if (hint) return <Kbd className={s.kbd}>{hint}</Kbd>
    return null
  })()

  /* One shape whether or not a tray shows, so the field is never rebuilt under the cursor as one comes and goes. What floats sits above the tray, not over it. */
  return (
    <div className={s.stack} data-tray-host="">
      {above && <div className={s.above}>{above}</div>}
      {tray != null && <div className={s.tray}>{tray}</div>}
      <form className={cx(s.composer, elapsed !== null && s.recording, className)} onSubmit={submit}>
        {queued.length > 0 && (
          <section className={s.queue} aria-label={t.queued(queued.length)}>
            <span className={s.queueHead}>
              <Icon name="clock" size={11} />
              {t.queued(queued.length)}
            </span>
            <ol className={s.queueList}>
              {queued.map((q) => (
                <li key={q.id} className={s.queued}>
                  <span className={s.queuedText}>{q.text}</span>
                  {onEditQueued && (
                    <LinkButton className={s.queuedEdit} onClick={() => onEditQueued(q.id)}>
                      {t.editQueued}
                    </LinkButton>
                  )}
                  {onUnqueue && <IconButton icon="close" size="small" label={t.unqueue(q.text)} onClick={() => onUnqueue(q.id)} />}
                </li>
              ))}
            </ol>
          </section>
        )}
        <div className={s.field}>
          {/* the words still arriving, faint where they will land; while they show, this draws what is written too, and the field's own text goes clear */}
          {interim && (
            <div ref={overlay} className={s.interim} aria-hidden="true">
              <span className={s.written}>{before}</span>
              {before && !/\s$/.test(before) ? ' ' : ''}
              {interim}
              {after && !/^\s/.test(after) ? ' ' : ''}
              <span className={s.written}>{after}</span>
            </div>
          )}
          <textarea
            ref={ref}
            rows={1}
            value={value}
            className={cx(interim && s.under)}
            readOnly={dictating}
            onScroll={(e) => {
              if (overlay.current) overlay.current.scrollTop = e.currentTarget.scrollTop
            }}
            placeholder={shownPlaceholder}
            aria-label={placeholder}
            aria-describedby={note ? hintId : undefined}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
              if ((e.metaKey || e.ctrlKey) && canSendNow) {
                e.preventDefault()
                sendNow()
                return
              }
              submit(e)
            }}
          />
        </div>
        <div className={s.bar}>
          {picker}
          <span className={s.space} />
          {note && (
            <span id={hintId} className={s.note}>
              {note}
            </span>
          )}
          {canSendNow && (
            <Tooltip label={t.sendNowNote}>
              <ActionButton className={s.sendNow} onClick={sendNow} kbd={t.sendNowKey}>
                {t.sendNow}
              </ActionButton>
            </Tooltip>
          )}
          {meter}
          {dictation &&
            (elapsed !== null ? (
              <button type="button" className={s.recButton} onClick={dictation.onStop} aria-label={t.stopDictating(elapsed)}>
                <span className={s.wave} aria-hidden="true">
                  {(dictation.levels ?? QUIET).map((l, i) => (
                    <i key={i} style={cssVars({ '--l': Math.max(0, Math.min(1, l)) })} />
                  ))}
                </span>
                {elapsed}
                <Icon name="square" size={11} />
              </button>
            ) : (
              <IconButton
                ref={mic}
                icon="mic"
                label={micLabel(dictation, t)}
                {...(dictation.kbd === undefined ? {} : { kbd: dictation.kbd })}
                busy={dictation.busy}
                progress={dictation.busy ? undefined : dictation.progress}
                aria-expanded={dictation.expanded}
                onClick={dictation.onStart}
              />
            ))}
          {action}
        </div>
      </form>
    </div>
  )
}

function micLabel(d: Dictation, t: ComposerText): string {
  if (d.busy) return t.dictateBusy
  if (d.progress !== undefined) return t.dictateProgress(Math.round(Math.max(0, Math.min(1, d.progress)) * 100))
  return t.dictate
}
