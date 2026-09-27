import type { ReactNode } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { AttachmentKind, unreachable } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import { Spinner } from '../../primitives/Spinner/Spinner'
import { useShell, type ImageRef } from '../Shell/Shell'
import { Rhythm } from '../../lib/rhythm'
import s from './You.module.css'

export type Attachment =
  | ({ kind: AttachmentKind.Image } & ImageRef)
  | { kind: AttachmentKind.File | AttachmentKind.Paste; name: string; meta?: string }

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

export interface YouProps {
  children: ReactNode
  /** When you sent it. */
  at?: string
  attach?: Attachment[]
  /** Open a file or pasted text. Images open in the shell's lightbox. Without it, file chips do not open. */
  onOpenAttachment?: (a: Attachment) => void
  /** Sent while the agent works: it waits until the agent is done with what it is doing. */
  queued?: boolean
  /** Sent now, while the agent works: it is stopping at a safe point to read it. Once it has, this goes. */
  interrupting?: boolean
  /** A link you pasted, unfurled under the message. */
  unfurl?: ReactNode
  text?: Partial<YouText>
}

/** What you said: a short bubble on the right. */
export function You({ children, at, attach, onOpenAttachment, queued, interrupting, unfurl, text }: YouProps) {
  const t = { ...youText, ...text }
  return (
    <article data-rhythm={Rhythm.You} className={cx(s.you, queued && s.queued)} aria-label={queued ? t.youQueued : t.you}>
      {attach && attach.length > 0 && (
        <div className={s.attach}>
          {attach.map((a) => (
            <AttachmentChip key={a.name} a={a} onOpen={onOpenAttachment} t={t} />
          ))}
        </div>
      )}
      <p className={s.body}>{children}</p>
      {unfurl && <div className={s.unfurl}>{unfurl}</div>}
      <span className={s.at}>
        {queued ? (
          <>
            <Icon name="clock" size={11} />
            {t.queued}
          </>
        ) : interrupting ? (
          <>
            <Spinner size="small" />
            {t.interrupting}
          </>
        ) : (
          at
        )}
      </span>
    </article>
  )
}

/* An image opens in the lightbox here; a file opens wherever the consumer sends it. */
function AttachmentChip({ a, onOpen, t }: { a: Attachment; onOpen?: (a: Attachment) => void; t: YouText }) {
  const { openImage } = useShell()
  switch (a.kind) {
    case AttachmentKind.Image:
      return (
        <button type="button" className={cx(s.chip, s.image)} aria-label={t.view(a.name)} onClick={() => openImage(a)}>
          <span className={s.imageArea}>
            <Icon name="image" size={16} />
          </span>
          <span className={s.name}>{a.name}</span>
        </button>
      )
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
