import { useEffect, useRef, type KeyboardEvent } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { DictationSetup, unreachable } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Button } from '../../primitives/Button/Button'
import { IconButton } from '../../primitives/IconButton/IconButton'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import s from './DictationTray.module.css'

/** Where dictation stands before it can listen, with what each state needs to say. Sizes and times arrive formatted. */
export type DictationState =
  | { kind: DictationSetup.Offer; size: string }
  | { kind: DictationSetup.Asking }
  | { kind: DictationSetup.Downloading; got: string; size: string; left?: string; progress: number }
  | { kind: DictationSetup.Preparing }
  | { kind: DictationSetup.Stopped; got: string; size: string; progress: number }
  /** `need`: what the model still needs; `free`: what the disk has. */
  | { kind: DictationSetup.NoRoom; need: string; free: string }
  | { kind: DictationSetup.Denied }
  | { kind: DictationSetup.NoMicrophone }
  /** `said`: how long the kept recording is, when there is one. */
  | { kind: DictationSetup.Failed; said?: string }

export interface DictationTrayText {
  /** What the tray is, for assistive technology. */
  label: string
  offer: string
  offerFacts: (size: string) => string
  offerNote: string
  download: string
  notNow: string
  asking: string
  askingNote: string
  downloading: string
  downloadingFacts: (got: string, size: string, left?: string) => string
  /** The bar's name. */
  progress: string
  preparing: string
  cancel: string
  /** Closes the tray while the download carries on; the microphone shows how far it has come. */
  hide: string
  stopped: string
  stoppedNote: (got: string, size: string) => string
  retry: string
  noRoom: string
  noRoomNote: (need: string, free: string) => string
  denied: string
  deniedNote: string
  openPrivacy: string
  noMicrophone: string
  noMicrophoneNote: string
  openSound: string
  failed: string
  failedNote: (said?: string) => string
  discard: string
  close: string
}

export const dictationTrayText: DictationTrayText = {
  label: 'Dictation',
  offer: 'Dictation needs a speech model on this Mac',
  offerFacts: (size) => `${size}, downloaded once`,
  offerNote: 'It turns what you say into text here; nothing you say leaves the Mac.',
  download: 'Download',
  notNow: 'Not now',
  asking: 'Waiting for macOS to allow the microphone',
  askingNote: 'Answer the question macOS shows to go on.',
  downloading: 'Downloading the speech model',
  downloadingFacts: (got, size, left) => `${got} of ${size}${left ? `, ${left}` : ''}`,
  progress: 'Speech model download',
  preparing: 'Getting the speech model ready',
  cancel: 'Cancel',
  hide: 'Hide; the download carries on',
  stopped: 'The download stopped',
  stoppedNote: (got, size) => `At ${got} of ${size}. It carries on from there.`,
  retry: 'Try again',
  noRoom: 'Not enough space for the speech model',
  noRoomNote: (need, free) => `It needs ${need}; ${free} is free. Make room, then try again.`,
  denied: 'Althar can’t use the microphone',
  deniedNote: 'Turn on Althar in System Settings › Privacy & Security › Microphone, then press the microphone again.',
  openPrivacy: 'Open System Settings',
  noMicrophone: 'No microphone found',
  noMicrophoneNote: 'Connect one, or choose an input in System Settings › Sound.',
  openSound: 'Open Sound settings',
  failed: 'Couldn’t write that down',
  failedNote: (said) => (said ? `What you said (${said}) is kept; try again.` : 'Nothing was written; try again.'),
  discard: 'Throw it away',
  close: 'Close',
}

export type DictationTrayProps = RootProps<
  'div',
  {
    state: DictationState
    /** Yes to the offer: the consumer asks for the microphone, then downloads. */
    onDownload?: () => void
    /** Stops the download and keeps nothing of it. */
    onCancel?: () => void
    /** Carries on a stopped download (or one there wasn't room for), or writes down a kept recording again. */
    onRetry?: () => void
    /** Opens the system's settings for the microphone (denied) or for sound (no microphone). */
    onOpenSettings?: () => void
    /** Throws away a recording that couldn't be written down. */
    onDiscard?: () => void
    /** Closes the tray: not now, or hide while the download carries on. Escape too. */
    onDismiss?: () => void
    text?: Partial<DictationTrayText>
  }
>

/* the states that ask you something: their first action takes focus when the tray turns to them */
const ASKS = new Set<DictationSetup>([
  DictationSetup.Offer,
  DictationSetup.Stopped,
  DictationSetup.Denied,
  DictationSetup.NoMicrophone,
  DictationSetup.Failed,
])

/**
 * What stands between the microphone and dictating, in a tray joined to the
 * composer's top: the offer to download a speech model the first time, the
 * download as it comes down (the tray's bottom edge is its bar), and what is
 * in the way when something is. The field under it stays yours to type in.
 *
 * When the tray turns to something that asks, its first action takes focus,
 * unless you are typing. Each state's headline is announced politely, once;
 * the sizes and times beside it are not, so a download doesn't chatter.
 */
export function DictationTray({
  state,
  onDownload,
  onCancel,
  onRetry,
  onOpenSettings,
  onDiscard,
  onDismiss,
  text,
  className,
  onKeyDown,
  ...rest
}: DictationTrayProps) {
  const t = { ...dictationTrayText, ...text }
  const root = useRef<HTMLDivElement>(null)
  const first = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!ASKS.has(state.kind)) return
    const at = document.activeElement
    // Near is what the tray sits on, such as the composer and its microphone (`data-tray-host`), or else its parent.
    const near = root.current?.closest('[data-tray-host]') ?? root.current?.parentElement
    const typing = at instanceof HTMLTextAreaElement || at instanceof HTMLInputElement
    if (!at || at === document.body || (!typing && near?.contains(at))) first.current?.focus()
  }, [state.kind])

  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(e)
    if (e.key !== 'Escape' || !onDismiss || e.defaultPrevented) return
    e.preventDefault()
    e.stopPropagation()
    onDismiss()
  }

  const close = (label: string) => onDismiss && <IconButton icon="close" size="small" label={label} onClick={onDismiss} />

  const view = (() => {
    switch (state.kind) {
      case DictationSetup.Offer:
        return {
          head: t.offer,
          facts: t.offerFacts(state.size),
          note: t.offerNote,
          actions: (
            <>
              {onDownload && (
                <Button ref={first} size="small" onClick={onDownload}>
                  {t.download}
                </Button>
              )}
              {close(t.notNow)}
            </>
          ),
        }
      case DictationSetup.Asking:
        return { head: t.asking, note: t.askingNote, actions: close(t.close) }
      case DictationSetup.Downloading:
        return {
          head: t.downloading,
          facts: t.downloadingFacts(state.got, state.size, state.left),
          bar: state.progress,
          actions: (
            <>
              {onCancel && <LinkButton onClick={onCancel}>{t.cancel}</LinkButton>}
              {close(t.hide)}
            </>
          ),
        }
      case DictationSetup.Preparing:
        return { head: t.preparing, bar: 1, actions: close(t.hide) }
      case DictationSetup.Stopped:
        return {
          head: t.stopped,
          note: t.stoppedNote(state.got, state.size),
          bar: state.progress,
          stopped: true,
          actions: (
            <>
              {onRetry && (
                <Button ref={first} size="small" onClick={onRetry}>
                  {t.retry}
                </Button>
              )}
              {onCancel && <LinkButton onClick={onCancel}>{t.cancel}</LinkButton>}
            </>
          ),
        }
      case DictationSetup.NoRoom:
        return {
          head: t.noRoom,
          note: t.noRoomNote(state.need, state.free),
          actions: (
            <>
              {onRetry && (
                <Button ref={first} size="small" onClick={onRetry}>
                  {t.retry}
                </Button>
              )}
              {onCancel && <LinkButton onClick={onCancel}>{t.cancel}</LinkButton>}
            </>
          ),
        }
      case DictationSetup.Denied:
        return {
          head: t.denied,
          note: t.deniedNote,
          actions: (
            <>
              {onOpenSettings && (
                <Button ref={first} size="small" onClick={onOpenSettings}>
                  {t.openPrivacy}
                </Button>
              )}
              {close(t.close)}
            </>
          ),
        }
      case DictationSetup.NoMicrophone:
        return {
          head: t.noMicrophone,
          note: t.noMicrophoneNote,
          actions: (
            <>
              {onOpenSettings && (
                <Button ref={first} size="small" onClick={onOpenSettings}>
                  {t.openSound}
                </Button>
              )}
              {close(t.close)}
            </>
          ),
        }
      case DictationSetup.Failed:
        return {
          head: t.failed,
          note: t.failedNote(state.said),
          actions: (
            <>
              {onRetry && (
                <Button ref={first} size="small" onClick={onRetry}>
                  {t.retry}
                </Button>
              )}
              {onDiscard && <LinkButton onClick={onDiscard}>{t.discard}</LinkButton>}
            </>
          ),
        }
      default:
        return unreachable(state)
    }
  })()

  return (
    <div ref={root} role="group" aria-label={t.label} className={cx(s.tray, className)} onKeyDown={keys} {...rest}>
      <div className={s.main}>
        <Icon name="mic" size={14} className={s.icon} />
        <div className={s.words}>
          <p className={s.head}>
            <output className={s.live}>{view.head}</output>
            {'facts' in view && view.facts && <span className={s.facts}> · {view.facts}</span>}
          </p>
          {'note' in view && view.note && <p className={s.note}>{view.note}</p>}
        </div>
      </div>
      <div className={s.actions}>{view.actions}</div>
      {'bar' in view && view.bar !== undefined && (
        <progress
          className={cx(s.bar, 'stopped' in view && view.stopped && s.barStopped)}
          aria-label={t.progress}
          max={100}
          value={Math.round(Math.max(0, Math.min(1, view.bar)) * 100)}
        />
      )}
    </div>
  )
}
