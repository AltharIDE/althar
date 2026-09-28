import type { ReactNode } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { AttachmentKind, Delivery, unreachable } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Rhythm } from '../../lib/rhythm'
import { Spinner } from '../../primitives/Spinner/Spinner'
import { useThreadShell, type ImageRef } from '../Shell/Shell'
import s from './You.module.css'

/** Something you attached to a message. */
export type MessageAttachment =
  | ({ id: string; kind: AttachmentKind.Image } & ImageRef)
  | { id: string; kind: AttachmentKind.File | AttachmentKind.Paste; name: string; meta?: string }

export interface YouText {
  you: string
  youQueued: string
  queued: string
  /** Sent now, while the agent works: until it has stopped at a safe point to read it. */
  interrupting: string
  view: (name: string) => string
  open: (name: string) => string
  showPaste: (name: string) => string
}

export const youText: YouText = {
  you: 'You',
  youQueued: 'You, queued',
  queued: 'Queued · the lead reads it next',
  interrupting: 'Sent now · the lead is stopping to read it',
  view: (name) => `View ${name}`,
  open: (name) => `Open ${name}`,
  showPaste: (name) => `Show pasted text, ${name}`,
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
    /** A link you pasted, unfurled under the message. */
    unfurl?: ReactNode
    text?: Partial<YouText>
  }
>

function Status({ delivery, at, t }: { delivery: Delivery; at?: string; t: YouText }) {
  switch (delivery) {
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

/** What you said: a short bubble on the right. */
export function You({ children, at, attach, onOpenAttachment, delivery = Delivery.Delivered, unfurl, text, className, ...rest }: YouProps) {
  const t = { ...youText, ...text }
  const queued = delivery === Delivery.Queued
  return (
    <article
      data-rhythm={Rhythm.You}
      className={cx(s.you, queued && s.queued, className)}
      aria-label={queued ? t.youQueued : t.you}
      {...rest}
    >
      {attach && attach.length > 0 && (
        <div className={s.attach}>
          {attach.map((a) => (
            <AttachmentChip key={a.id} a={a} onOpen={onOpenAttachment} t={t} />
          ))}
        </div>
      )}
      <p className={s.body}>{children}</p>
      {unfurl && <div className={s.unfurl}>{unfurl}</div>}
      <span className={s.at}>
        <Status delivery={delivery} at={at} t={t} />
      </span>
    </article>
  )
}

/* An image opens with the shell's openImage; a file opens wherever the consumer sends it. Without either, the chip is still. */
function AttachmentChip({ a, onOpen, t }: { a: MessageAttachment; onOpen?: (a: MessageAttachment) => void; t: YouText }) {
  const { openImage } = useThreadShell()
  switch (a.kind) {
    case AttachmentKind.Image: {
      const body = (
        <>
          <span className={s.imageArea}>{a.src ? <img src={a.src} alt="" className={s.thumb} /> : <Icon name="image" size={16} />}</span>
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
        <button type="button" className={cx(s.chip, s.image)} aria-label={t.view(a.name)} onClick={() => openImage(a)}>
          {body}
        </button>
      )
    }
    case AttachmentKind.File:
    case AttachmentKind.Paste: {
      const paste = a.kind === AttachmentKind.Paste
      const body = (
        <>
          <span className={s.icon}>
            <Icon name={paste ? 'list' : 'file'} size={13} />
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
