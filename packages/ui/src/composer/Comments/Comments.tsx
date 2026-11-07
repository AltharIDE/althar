import { HoverCard } from '../../primitives/HoverCard/HoverCard'
import { IconButton } from '../../primitives/IconButton/IconButton'
import { KeyValues } from '../../primitives/KeyValues/KeyValues'
import s from './Comments.module.css'

/*
 * Comments the person made on something beside the conversation, waiting
 * in the composer to go with what they write (ADR-100): today a spot on a
 * page, pointed at; a line of the diff can be one too (DEV-175). Each is a
 * chip among the person's own attachments, with a picture of the spot small,
 * its number and what they said; pointed at, its card says the rest, as the
 * lead will get it; pressed, it opens again where it was made; ✕ takes it
 * off.
 */

/** One fact of what a comment is on, as its card lists it: words, code, a colour drawn as a swatch, or quoted text. */
export interface CommentFact {
  label: string
  value: string
  kind?: 'words' | 'code' | 'colour' | 'quote'
}

export interface ComposerComment {
  id: string
  /** Its number, as its pin on the page has it. */
  n: number
  /** What the person said. */
  note: string
  /** Where it is, at a glance: `span.needs`. */
  place: string
  /** A picture of the spot, with its size in pixels. */
  crop?: { readonly src: string; readonly width: number; readonly height: number }
  /** What its card lists, in order. */
  facts: readonly CommentFact[]
}

export interface CommentChipText {
  /** The chip's own name, which opens the comment again. */
  open: (n: number, note: string) => string
  remove: (n: number) => string
}

export const commentChipText: CommentChipText = {
  open: (n, note) => `Comment ${n}: ${note}`,
  remove: (n) => `Remove comment ${n}`,
}

export interface CommentChipProps {
  comment: ComposerComment
  /** Opens it again where it was made, to change it. Without it, the chip is only read. */
  onOpen?: () => void
  /** Takes it off. Without it, no ✕. */
  onRemove?: () => void
  text?: Partial<CommentChipText>
}

/** A comment waiting in the composer: its crop small, its number and words, the place it is on; its card on hover. */
export function CommentChip({ comment, onOpen, onRemove, text }: CommentChipProps) {
  const t = { ...commentChipText, ...text }
  return (
    <span className={s.chip}>
      <HoverCard card={<CommentCard comment={comment} />} placement="above" width={316}>
        <button type="button" className={s.open} aria-label={t.open(comment.n, comment.note)} onClick={onOpen}>
          <span className={s.thumb} aria-hidden="true">
            {comment.crop === undefined ? <span className={s.n}>{comment.n}</span> : <img src={comment.crop.src} alt="" />}
          </span>
          <span className={s.words}>
            <span className={s.note}>
              {comment.n}. {comment.note}
            </span>
            <span className={s.place}>{comment.place}</span>
          </span>
        </button>
      </HoverCard>
      {onRemove !== undefined && (
        <IconButton className={s.remove} icon="close" size="small" label={t.remove(comment.n)} onClick={onRemove} />
      )}
    </span>
  )
}

/** What a comment is on, as the lead gets it: the spot as cropped, what was said, and every fact of it. */
export function CommentCard({ comment }: { comment: ComposerComment }) {
  return (
    <span className={s.card}>
      {comment.crop !== undefined && (
        <img className={s.crop} src={comment.crop.src} alt="" style={{ aspectRatio: `${comment.crop.width} / ${comment.crop.height}` }} />
      )}
      <span className={s.said}>
        <span className={s.n}>{comment.n}</span>
        <span>{comment.note}</span>
      </span>
      <KeyValues
        className={s.facts}
        keyWidth={78}
        items={comment.facts.map((fact) => [fact.label, <Fact key={fact.label} fact={fact} />] as const)}
      />
    </span>
  )
}

function Fact({ fact }: { fact: CommentFact }) {
  switch (fact.kind ?? 'words') {
    case 'code':
      return <code className={s.code}>{fact.value}</code>
    case 'colour':
      return (
        <span className={s.colour}>
          <span className={s.swatch} style={{ background: fact.value }} />
          <code className={s.code}>{fact.value}</code>
        </span>
      )
    case 'quote':
      return <span className={s.quote}>“{fact.value}”</span>
    case 'words':
      return <span>{fact.value}</span>
  }
}
