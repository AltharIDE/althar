import { useId, useLayoutEffect, useRef, type FormEvent, type ReactNode, type RefObject } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import { ActionButton } from '../../primitives/ActionButton/ActionButton'
import { Tooltip } from '../../primitives/HoverCard/HoverCard'
import { IconButton } from '../../primitives/IconButton/IconButton'
import { Kbd } from '../../primitives/Kbd/Kbd'
import { cssVars } from '../../lib/cssVars'
import { useDragOver } from '../../lib/dragOver'
import { useRefocus } from '../../lib/refocus'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { Spinner } from '../../primitives/Spinner/Spinner'
import { Menu, MenuRadioGroup, MenuRadioItem } from '../../primitives/Menu/Menu'
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
  /** The microphones to choose from, after the system's default, which always comes first. Empty until the system names them. */
  inputs?: readonly DictationInput[]
  /** The chosen microphone's id; null for the system's default. */
  input?: string | null
  /** Chooses the microphone dictation hears (null: the system's default). With it, a menu beside the microphone offers them, while dictating too. */
  onChooseInput?: (id: string | null) => void
  onStart: () => void
  onStop: () => void
}

/** A microphone dictation can hear. */
export interface DictationInput {
  id: string
  label: string
}

/* The menu's value for the system's default, which has no id of its own. */
const SYSTEM_DEFAULT = ''

/** Something you sent while the agent worked, waiting for it to finish what it is doing. */
export interface QueuedMessage {
  id: string
  text: string
  /** What you sent with it, in words, formatted: "2 images". */
  attached?: string
}

/** An image waiting to go with what you write: drawn small, with a way to take it off. */
export interface ComposerImage {
  id: string
  /** What it is called, as its file was: its accessible name. */
  name: string
  /** A copy to draw it small from; without it, a placeholder. */
  src?: string
  /** Still being read, or made smaller: it turns until it is ready. */
  reading?: boolean
}

/** The kinds of image the picker offers by default: the ones every agent that takes images reads. */
export const COMPOSER_IMAGE_TYPES = 'image/png,image/jpeg,image/gif,image/webp'

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
  /** Under the field while dictating: Enter stops and writes it down, without sending. */
  stopNote: string
  /** The button beside the microphone that opens the list of microphones. */
  chooseInput: string
  /** The list's name and heading. */
  inputs: string
  /** The first choice: whichever microphone the system uses. */
  systemDefault: string
  /** Under the list, while the system names no microphones. */
  inputsNote: string
  /** The field's placeholder while dictating. */
  listening: string
  queued: (n: number) => string
  /** Takes a queued message back into the field. */
  editQueued: string
  unqueue: (text: string) => string
  /** The button that picks images from the computer. */
  addImages: string
  /** Over the composer while images are held over it. */
  dropImages: string
  /** The images waiting to go, as a list. */
  images: (n: number) => string
  removeImage: (name: string) => string
  readingImage: (name: string) => string
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
  stopNote: 'Enter to stop; it is not sent',
  chooseInput: 'Choose the microphone',
  inputs: 'Microphone',
  systemDefault: 'System default',
  inputsNote: 'Other microphones show here once Althar may use the microphone.',
  listening: 'Listening…',
  queued: (n) => (n === 1 ? 'Queued; the lead reads it next' : `${n} queued; the lead reads them in order`),
  editQueued: 'Edit',
  unqueue: (text) => `Take “${text}” out of the queue`,
  addImages: 'Add images',
  dropImages: 'Drop to add them to your message',
  images: (n) => (n === 1 ? '1 image to send' : `${n} images to send`),
  removeImage: (name) => `Remove ${name}`,
  readingImage: (name) => `Reading ${name}`,
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
  /** Images to send with what is written, in order: they go when it is sent, even with nothing written. */
  images?: readonly ComposerImage[]
  /**
   * Files dropped on the composer, pasted into it, or picked with its Add
   * images button, for the consumer to read and check, and add to `images`
   * or refuse in `imageNote`. Without it, the composer takes none, and offers
   * no button.
   */
  onAddImages?: (files: readonly File[]) => void
  /** Takes an image off. Without it, images have no remove button. */
  onRemoveImage?: (id: string) => void
  /** What the consumer says of images, in a line over the field: one it refused, and why; or that the agent doesn't take them. */
  imageNote?: string
  /** The kinds the picker offers, as a file input's `accept`. */
  imageTypes?: string
  inputRef?: RefObject<HTMLTextAreaElement | null>
  className?: string
  text?: Partial<ComposerText>
}

/**
 * The one composer, for the project conversation and for a task. Two rows:
 * what you are writing, then where it goes. Enter sends, Shift+Enter breaks
 * the line. The lower row holds what the consumer puts there, the model
 * picker and the context meter, quiet until you look. Images dropped on it,
 * pasted into it or picked with its button go to the consumer, which reads
 * and checks them; those it adds wait above the field, and go with what is
 * sent.
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
  images = [],
  onAddImages,
  onRemoveImage,
  imageNote,
  imageTypes = COMPOSER_IMAGE_TYPES,
  inputRef,
  className,
  text,
}: ComposerProps) {
  const t = { ...composerText, ...text }
  const own = useRef<HTMLTextAreaElement>(null)
  const files = useRef<HTMLInputElement>(null)
  /* images held over any part of it, the tray and what floats over it included */
  const drop = useDragOver(onAddImages)
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
  /* images alone are something to send */
  const drafted = value.trim() !== '' || images.length > 0
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
    if (out || images.length > 0) onSubmit(out)
  }
  const canSendNow = busy && drafted && onSendNow !== undefined
  const sendNow = () => {
    const out = value.trim()
    if (out || images.length > 0) onSendNow?.(out)
  }

  const shownPlaceholder = (() => {
    if (interim) return ''
    if (elapsed !== null) return t.listening
    return placeholder
  })()

  const note = (() => {
    if (elapsed !== null && dictation?.busy !== true) return t.stopNote
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
    <div className={s.stack} data-tray-host="" {...drop.handlers}>
      {above && <div className={s.above}>{above}</div>}
      {tray != null && <div className={s.tray}>{tray}</div>}
      <form className={cx(s.composer, elapsed !== null && s.recording, drop.over && s.over, className)} onSubmit={submit}>
        {drop.over && (
          <div className={s.dropping} aria-hidden="true">
            <Icon name="image" size={14} />
            {t.dropImages}
          </div>
        )}
        {queued.length > 0 && (
          <section className={s.queue} aria-label={t.queued(queued.length)}>
            <span className={s.queueHead}>
              <Icon name="clock" size={11} />
              {t.queued(queued.length)}
            </span>
            <ol className={s.queueList}>
              {queued.map((q) => (
                <li key={q.id} className={s.queued}>
                  <span className={s.queuedText}>
                    {q.text}
                    {q.attached && <span className={s.queuedAttached}>{q.attached}</span>}
                  </span>
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
        {onAddImages && (
          /* what the consumer says of images, announced as it changes; empty, it takes no room */
          <output className={s.imageNote}>{imageNote}</output>
        )}
        {images.length > 0 && (
          <ul className={s.images} aria-label={t.images(images.length)}>
            {images.map((image) => (
              <li key={image.id} className={s.image}>
                {image.reading ? (
                  <Spinner size="small" label={t.readingImage(image.name)} />
                ) : image.src ? (
                  <img src={image.src} alt={image.name} className={s.imageThumb} />
                ) : (
                  <span role="img" aria-label={image.name} className={s.imagePlaceholder}>
                    <Icon name="image" size={14} />
                  </span>
                )}
                {onRemoveImage && (
                  <IconButton
                    className={s.imageRemove}
                    icon="close"
                    size="small"
                    label={t.removeImage(image.name)}
                    onClick={() => onRemoveImage(image.id)}
                  />
                )}
              </li>
            ))}
          </ul>
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
            onPaste={(e) => {
              // A picture on the clipboard is added, not pasted as its name.
              const pasted = [...e.clipboardData.files]
              if (!onAddImages || pasted.length === 0) return
              e.preventDefault()
              onAddImages(pasted)
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
              /* Enter while dictating wraps up what was said and leaves it in the field, unsent; while it is written down, it waits. */
              if (dictating) {
                e.preventDefault()
                if (dictation?.busy !== true) dictation?.onStop()
                return
              }
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
          {onAddImages && (
            <>
              <IconButton icon="image" label={t.addImages} onClick={() => files.current?.click()} />
              <input
                ref={files}
                type="file"
                accept={imageTypes}
                multiple
                hidden
                tabIndex={-1}
                onChange={(e) => {
                  const picked = [...(e.target.files ?? [])]
                  // Picking the same file again is a change too.
                  e.target.value = ''
                  if (picked.length > 0) onAddImages(picked)
                }}
              />
            </>
          )}
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
          {dictation?.onChooseInput && <InputMenu dictation={dictation} onChoose={dictation.onChooseInput} t={t} />}
          {action}
        </div>
      </form>
    </div>
  )
}

/* Beside the microphone, idle or dictating: which microphone it hears. Choosing while dictating goes on from the new one. */
function InputMenu({ dictation, onChoose, t }: { dictation: Dictation; onChoose: (id: string | null) => void; t: ComposerText }) {
  const inputs = dictation.inputs ?? []
  const chosen = dictation.input ?? SYSTEM_DEFAULT
  return (
    <Menu
      label={t.inputs}
      placement="above"
      align="end"
      width={260}
      {...(inputs.length === 0 ? { note: t.inputsNote } : {})}
      trigger={
        <button type="button" className={s.inputs} aria-label={t.chooseInput}>
          <Icon name="chevronD" size={10} />
        </button>
      }
    >
      <MenuRadioGroup label={t.inputs} value={chosen} onChange={(id) => onChoose(id === SYSTEM_DEFAULT ? null : id)}>
        <MenuRadioItem value={SYSTEM_DEFAULT}>{t.systemDefault}</MenuRadioItem>
        {inputs.map((input) => (
          <MenuRadioItem key={input.id} value={input.id}>
            {input.label}
          </MenuRadioItem>
        ))}
      </MenuRadioGroup>
    </Menu>
  )
}

function micLabel(d: Dictation, t: ComposerText): string {
  if (d.busy) return t.dictateBusy
  if (d.progress !== undefined) return t.dictateProgress(Math.round(Math.max(0, Math.min(1, d.progress)) * 100))
  return t.dictate
}
