import { type ReactNode, useState } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { AttachmentKind, Delivery, unreachable } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Rhythm } from '../../lib/rhythm'
import { Spinner } from '../../primitives/Spinner/Spinner'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { useThreadShell, type ImageRef } from '../Shell/Shell'
import s from './You.module.css'

/** Something you attached to a message. */
export type MessageAttachment =
  | ({ id: string; kind: AttachmentKind.Image } & ImageRef)
  | { id: string; kind: AttachmentKind.File | AttachmentKind.Folder | AttachmentKind.Paste; name: string; meta?: string }

export interface YouText {
  you: string
  youQueued: string
  queued: string
  /** Sent now, while the agent works: until it has stopped at a safe point to read it. */
  interrupting: string
  /** No agent is on its way to read it. */
  notSent: string
  sendAgain: string
  view: (name: string) => string
  open: (name: string) => string
  showPaste: (name: string) => string
  undo: string
}

export const youText: YouText = {
  you: 'You',
  youQueued: 'You, queued',
  queued: 'Queued',
  interrupting: 'Sent now',
  notSent: 'Not sent',
  sendAgain: 'Send again',
  view: (name) => `View ${name}`,
  open: (name) => `Open ${name}`,
  showPaste: (name) => `Show pasted text, ${name}`,
  undo: 'Undo from here',
}

export type YouProps = RootProps<
  'article',
  {
    children: ReactNode
    /** When you sent it. Shown once it is delivered. */
    at?: string
    attach?: readonly MessageAttachment[]
    /** Open a file or pasted text. Images open with the shell's openImage. Without it, file chips do not open. */
    onOpenAttachment?: (a: MessageAttachment) => void
    /** Where it stands with the agent. Delivered by default. */
    delivery?: Delivery
    /** The links you pasted, unfurled in the bubble under what you said, so they read as part of the message. */
    unfurl?: ReactNode
    /** What you said of lines of the diff, each with its code (`CommentExcerpt`), in the bubble after your words. */
    comments?: ReactNode
    /** Restores this turn's files and conversation. Offered only for a delivered, checkpointed message. */
    onUndo?: () => void
    /** Starts its agent again to read it. Offered only for one not sent. */
    onSendAgain?: () => void
    text?: Partial<YouText>
  }
>

function Status({ delivery, at, t, onSendAgain }: { delivery: Delivery; at?: string; t: YouText; onSendAgain?: () => void }) {
  switch (delivery) {
    case Delivery.NotSent:
      return (
        <>
          <span className={s.notSent}>
            <Icon name="problem" size={11} />
            {t.notSent}
          </span>
          {onSendAgain !== undefined && <LinkButton onClick={onSendAgain}>{t.sendAgain}</LinkButton>}
        </>
      )
    case Delivery.Queued:
      return (
        <>
          <Icon name="clock" size={11} />
          {t.queued}
        </>
      )
    case Delivery.Interrupting:
      return (
        <>
          <Spinner size="small" />
          {t.interrupting}
        </>
      )
    case Delivery.Delivered:
      return at ?? null
    default:
      return unreachable(delivery)
  }
}

/** The images among a message's attachments, as the lightbox moves through them. */
const imagesIn = (set: readonly MessageAttachment[]): ImageRef[] => set.flatMap((one) => (one.kind === AttachmentKind.Image ? [one] : []))

/** What you said: a short bubble on the right, with the links you pasted unfurled in it, and above it what you sent with it. */
export function You({
  children,
  at,
  attach,
  onOpenAttachment,
  delivery = Delivery.Delivered,
  unfurl,
  comments,
  onUndo,
  onSendAgain,
  text,
  className,
  ...rest
}: YouProps) {
  const t = { ...youText, ...text }
  const queued = delivery === Delivery.Queued
  const said = children !== '' && children != null
  return (
    <article
      data-rhythm={Rhythm.You}
      data-thread-prompt={queued ? undefined : ''}
      className={cx(s.you, queued && s.queued, className)}
      aria-label={queued ? t.youQueued : t.you}
      {...rest}
    >
      {attach && attach.length > 0 && (
        <div className={s.attach}>
          {attach.map((a) => (
            <AttachmentChip key={a.id} a={a} set={attach} onOpen={onOpenAttachment} t={t} />
          ))}
        </div>
      )}
      {/* images sent with nothing written have no bubble of words */}
      {(said || unfurl || comments) && (
        <div className={s.body}>
          {said && (
            <p className={s.said} data-thread-preview="">
              {children}
            </p>
          )}
          {unfurl && <div className={s.unfurl}>{unfurl}</div>}
          {comments && <div className={s.comments}>{comments}</div>}
        </div>
      )}
      <span className={s.at}>
        {onUndo !== undefined && delivery === Delivery.Delivered && (
          <LinkButton className={s.undo} onClick={onUndo}>
            {t.undo}
          </LinkButton>
        )}
        <Status delivery={delivery} at={at} t={t} {...(onSendAgain === undefined ? {} : { onSendAgain })} />
      </span>
    </article>
  )
}

/** How far from the chip's own shape a picture may be and still fill it: a strip or a tall shot fits whole instead. */
const FILLS = { wide: 2.4, tall: 1 }

/*
 * An image's picture in its chip: filling it where it is about the chip's shape, whole where cropping it would leave only
 * its middle (a strip of a screen is mostly margin there), and the picture icon where it doesn't load.
 */
function Thumb({ a }: { a: Extract<MessageAttachment, { kind: AttachmentKind.Image }> }) {
  const shown = a.thumb ?? a.src
  const [failed, setFailed] = useState<string | null>(null)
  const ratio = a.width !== undefined && a.height !== undefined && a.height > 0 ? a.width / a.height : null
  const whole = ratio !== null && (ratio > FILLS.wide || ratio < FILLS.tall)
  const drawn = shown !== undefined && shown !== '' && failed !== shown
  return (
    <span className={s.imageArea} data-drawn={drawn || undefined}>
      {drawn ? (
        <img src={shown} alt="" className={s.thumb} data-whole={whole || undefined} onError={() => setFailed(shown)} />
      ) : (
        <Icon name="image" size={16} />
      )}
    </span>
  )
}

/* An image opens with the shell's openImage, with the message's other images a key away; a file opens wherever the consumer sends it. Without either, the chip is still. */
function AttachmentChip({
  a,
  set,
  onOpen,
  t,
}: {
  a: MessageAttachment
  set: readonly MessageAttachment[]
  onOpen?: (a: MessageAttachment) => void
  t: YouText
}) {
  const { openImage } = useThreadShell()
  switch (a.kind) {
    case AttachmentKind.Image: {
      const body = (
        <>
          <Thumb a={a} />
          <span className={s.name}>{a.name}</span>
        </>
      )
      if (!openImage)
        return (
          <span className={cx(s.chip, s.image, s.still)} role="img" aria-label={a.alt ?? a.name}>
            {body}
          </span>
        )
      return (
        <button type="button" className={cx(s.chip, s.image)} aria-label={t.view(a.name)} onClick={() => openImage(a, imagesIn(set))}>
          {body}
        </button>
      )
    }
    case AttachmentKind.File:
    case AttachmentKind.Folder:
    case AttachmentKind.Paste: {
      const paste = a.kind === AttachmentKind.Paste
      const body = (
        <>
          <span className={s.icon}>
            <Icon name={paste ? 'list' : a.kind === AttachmentKind.Folder ? 'folder' : 'file'} size={13} />
          </span>
          <span className={s.main}>
            <span className={s.name}>{a.name}</span>
            {a.meta && <span className={s.meta}>{a.meta}</span>}
          </span>
        </>
      )
      if (!onOpen) return <span className={cx(s.chip, s.still)}>{body}</span>
      return (
        <button type="button" className={s.chip} aria-label={paste ? t.showPaste(a.name) : t.open(a.name)} onClick={() => onOpen(a)}>
          {body}
          <Icon name="external" size={11} className={s.go} />
        </button>
      )
    }
    default:
      return unreachable(a)
  }
}
