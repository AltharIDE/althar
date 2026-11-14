import { useEffect, useRef, useState } from 'react'

import { DiffLineKind } from '../../foundations/vocabulary'
import { Icon } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import { Button } from '../../primitives/Button/Button'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import type { DiffLine, DiffPick } from '../../thread/Diff/Diff'
import s from './LineComments.module.css'

/*
 * Comments the person makes on lines of a task's diff (DEV-175): a line, or
 * a range picked by its numbers, and what they say of it. Written in a box
 * under the lines; gathered, each a note there, numbered as its chip in the
 * composer is, until Send takes them to the lead in one message; sent, it
 * stays under its lines, and once a commit of the lead's changes them, it
 * steps back as addressed. In the thread, the person's message shows each
 * with its code, and its place opens the diff on it.
 */

/** Whose numbers a comment's lines are in: the file as the change has it, or, for lines it only took out, as it was. */
export type CommentSide = 'new' | 'old'

/** A line of the diff as a comment quotes it. */
export interface QuotedDiffLine {
  readonly kind: 'context' | 'added' | 'removed'
  readonly text: string
}

/** The lines a comment is on: from `start` to `end`, in `side`'s numbers; for lines taken out, `under` is the new file's line before them (0 at its top). */
export interface CommentedLines {
  readonly side: CommentSide
  readonly start: number
  readonly end: number
  readonly under?: number
  /** The lines as they showed, in order. */
  readonly code: readonly QuotedDiffLine[]
}

/** Where a comment stands: written and waiting to go, sent to the lead, or addressed by a commit of its since. */
export type CommentState = 'draft' | 'sent' | 'addressed'

/** A comment on lines of a file, as the Changes view shows it. */
export interface ViewedComment extends CommentedLines {
  readonly id: string
  /** The file, as the Changes view names it. */
  readonly path: string
  readonly note: string
  readonly state: CommentState
  /** For one waiting to go, its number among them: its chip's in the composer. */
  readonly n?: number
  /** The line it goes under now, the last of its lines, in `side`'s numbers; null where its lines are gone from the change. */
  readonly line: number | null
  /** When it was sent: `2m`. */
  readonly sentAt?: string
}

/** A comment as the thread shows it on the person's message. */
export interface ShownComment extends CommentedLines {
  readonly id: string
  readonly path: string
  readonly note: string
}

/** The most lines a comment quotes; a longer stretch quotes its first. */
export const QUOTED_LINES = 80
/** The most characters of a line a comment quotes: a minified line is cut. */
export const QUOTED_LINE_TEXT = 2000
/** The most characters a comment says. */
export const COMMENT_NOTE = 8000

const KIND_OF: Partial<Record<DiffLineKind, QuotedDiffLine['kind']>> = {
  [DiffLineKind.Context]: 'context',
  [DiffLineKind.Added]: 'added',
  [DiffLineKind.Removed]: 'removed',
}

/**
 * What a picked stretch of a diff's lines is, to comment on: the new file's
 * lines among them where it has any; else, all taken out, the old file's,
 * with the new file's line they were taken out after. Null where the stretch
 * is only hunk headers.
 */
export const pickedLines = (lines: readonly DiffLine[], pick: DiffPick): CommentedLines | null => {
  const from = Math.min(pick.from, pick.to)
  const to = Math.max(pick.from, pick.to)
  const picked = lines.slice(from, to + 1).filter((line) => line.kind !== DiffLineKind.Hunk)
  if (picked.length === 0) return null
  const code = picked
    .slice(0, QUOTED_LINES)
    .map((line) => ({ kind: KIND_OF[line.kind] ?? 'context', text: line.text.slice(0, QUOTED_LINE_TEXT) }))
  const news = picked.flatMap((line) => (line.kind === DiffLineKind.Context || line.kind === DiffLineKind.Added ? [line.new] : []))
  if (news.length > 0) return { side: 'new', start: Math.min(...news), end: Math.max(...news), code }
  const olds = picked.flatMap((line) => (line.kind === DiffLineKind.Removed ? [line.old] : []))
  const before = lines.slice(0, from).findLast((line) => line.kind === DiffLineKind.Context || line.kind === DiffLineKind.Added)
  const under = before !== undefined && (before.kind === DiffLineKind.Context || before.kind === DiffLineKind.Added) ? before.new : 0
  return { side: 'old', start: Math.min(...olds), end: Math.max(...olds), under, code }
}

export interface LineCommentsText {
  /** Where a comment is: `Lines 12–14`, `Removed line 3`. */
  lines: (side: CommentSide, start: number, end: number) => string
  /** The box's name, for assistive technology: `Comment on lines 12–14`. */
  label: (lines: string) => string
  placeholder: string
  add: string
  save: string
  cancel: string
  edit: string
  remove: string
  /** Each state, as a comment's note says it. */
  draft: string
  sent: string
  addressed: string
  /** Its lines aren't in the change any more. */
  gone: string
  /** The place a sent comment is on, which opens the diff there. */
  open: (path: string, lines: string) => string
  /** What a long quote leaves out. */
  more: (count: number) => string
}

export const lineCommentsText: LineCommentsText = {
  lines: (side, start, end) =>
    side === 'old'
      ? start === end
        ? `Removed line ${start}`
        : `Removed lines ${start}–${end}`
      : start === end
        ? `Line ${start}`
        : `Lines ${start}–${end}`,
  label: (lines) => `Comment on ${lines.charAt(0).toLowerCase()}${lines.slice(1)}`,
  placeholder: 'What should change here?',
  add: 'Comment',
  save: 'Save',
  cancel: 'Cancel',
  edit: 'Edit',
  remove: 'Remove',
  draft: 'Not sent',
  sent: 'Sent',
  addressed: 'Addressed',
  gone: 'Its lines aren’t in the change any more.',
  open: (path, lines) => `Open ${path}, ${lines.charAt(0).toLowerCase()}${lines.slice(1)}, in the diff`,
  more: (count) => (count === 1 ? '1 more line' : `${count} more lines`),
}

const textOf = (text?: Partial<LineCommentsText>): LineCommentsText => ({ ...lineCommentsText, ...text })

export interface LineCommentBoxProps {
  /** Where it is: `Lines 12–14`. */
  lines: string
  /** The number it will have, or has, among those waiting to go. */
  n: number
  defaultValue?: string
  /** One written before, opened again: Save and Remove rather than Comment. */
  existing?: boolean
  onSubmit: (note: string) => void
  onCancel: () => void
  onRemove?: () => void
  text?: Partial<LineCommentsText>
}

/**
 * The box a comment is written in, under the lines it is on: it takes focus
 * as it opens; Enter adds it, Shift-Enter starts a new line, Escape leaves it.
 */
export function LineCommentBox({ lines, n, defaultValue = '', existing = false, onSubmit, onCancel, onRemove, text }: LineCommentBoxProps) {
  const t = textOf(text)
  const [note, setNote] = useState(defaultValue)
  const field = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const input = field.current
    if (input === null) return
    input.focus({ preventScroll: true })
    input.setSelectionRange(input.value.length, input.value.length)
    input.scrollIntoView({ block: 'nearest' })
  }, [])
  const submit = () => {
    const said = note.trim()
    if (said !== '') onSubmit(said)
  }
  return (
    <form
      className={s.box}
      aria-label={t.label(lines)}
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <span className={s.n} aria-hidden="true">
        {n}
      </span>
      <span className={s.where}>{lines}</span>
      <textarea
        ref={field}
        className={s.field}
        value={note}
        rows={2}
        maxLength={COMMENT_NOTE}
        placeholder={t.placeholder}
        aria-label={t.label(lines)}
        data-own-escape=""
        onChange={(event) => setNote(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onCancel()
          }
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            submit()
          }
        }}
      />
      <span className={s.actions}>
        {existing && onRemove !== undefined && (
          <Button variant="quiet" size="small" className={s.remove} onClick={onRemove}>
            {t.remove}
          </Button>
        )}
        <Button variant="quiet" size="small" onClick={onCancel}>
          {t.cancel}
        </Button>
        <Button variant="signal" size="small" type="submit" disabled={note.trim() === ''}>
          {existing ? t.save : t.add}
        </Button>
      </span>
    </form>
  )
}

export interface LineCommentNoteProps {
  comment: ViewedComment
  /** The one opened from the thread: brought into view, marked. */
  current?: boolean
  /** Opens one waiting to go again in its box, to change. */
  onEdit?: () => void
  /** Takes one waiting to go off. */
  onRemove?: () => void
  text?: Partial<LineCommentsText>
}

/** A comment of the person's under its lines: what they said, and where it stands; one waiting to go can be changed or taken off. */
export function LineCommentNote({ comment, current = false, onEdit, onRemove, text }: LineCommentNoteProps) {
  const t = textOf(text)
  const ref = useRef<HTMLElement>(null)
  // The one opened from the thread comes into view once drawn: only the code's own scroll moves.
  useEffect(() => {
    if (!current) return
    const frame = requestAnimationFrame(() => ref.current?.scrollIntoView({ block: 'center' }))
    return () => cancelAnimationFrame(frame)
  }, [current])
  const draft = comment.state === 'draft'
  return (
    <article
      ref={ref}
      className={s.note}
      data-state={comment.state}
      data-current={current}
      aria-current={current ? 'true' : undefined}
      aria-label={t.label(t.lines(comment.side, comment.start, comment.end))}
    >
      <header className={s.head}>
        {draft && comment.n !== undefined && (
          <span className={s.n} aria-hidden="true">
            {comment.n}
          </span>
        )}
        <span className={s.where}>{t.lines(comment.side, comment.start, comment.end)}</span>
        {draft && (onEdit !== undefined || onRemove !== undefined) && (
          <span className={s.ways}>
            {onEdit !== undefined && <LinkButton onClick={onEdit}>{t.edit}</LinkButton>}
            {onRemove !== undefined && <LinkButton onClick={onRemove}>{t.remove}</LinkButton>}
          </span>
        )}
        <span className={s.state}>
          {comment.state === 'addressed' && <Icon name="check" size={12} />}
          {t[comment.state]}
          {comment.state === 'sent' && comment.sentAt !== undefined && <span className={s.when}>{comment.sentAt}</span>}
        </span>
      </header>
      <p className={s.said}>{comment.note}</p>
    </article>
  )
}

/** The lines a comment quotes, numbered in its side's numbers where they have one, each signed and tinted as the diff has it. */
function Quote({ comment, most, t }: { comment: CommentedLines; most: number; t: LineCommentsText }) {
  // Each line its side's number, counting only the lines that side has.
  const counts = (line: QuotedDiffLine) => (comment.side === 'old' ? line.kind !== 'added' : line.kind !== 'removed')
  const numbered = comment.code.map((line, index) => ({
    ...line,
    n: counts(line) ? comment.start + comment.code.slice(0, index).filter(counts).length : null,
  }))
  const shown = numbered.slice(0, most)
  return (
    <div className={s.quote}>
      {shown.map((line, index) => (
        <span key={index} className={cx(s.line, line.kind === 'added' && s.add, line.kind === 'removed' && s.del)}>
          <span className={s.ln}>{line.n}</span>
          <span className={s.sign}>{line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ''}</span>
          <span className={s.text}>{line.text}</span>
        </span>
      ))}
      {numbered.length > shown.length && <span className={s.more}>{t.more(numbered.length - shown.length)}</span>}
    </div>
  )
}

export interface CommentExcerptProps {
  comment: ShownComment
  /** Opens the diff on it. Without it, its place is only read. */
  onOpen?: () => void
  /** Lines of its code shown before the rest is left out. */
  most?: number
  text?: Partial<LineCommentsText>
}

const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1)

/** A comment on the person's message in the thread: its place, which opens the diff there, its code, and what they said. */
export function CommentExcerpt({ comment, onOpen, most = 4, text }: CommentExcerptProps) {
  const t = textOf(text)
  const lines = t.lines(comment.side, comment.start, comment.end)
  const place = (
    <>
      <span className={s.file}>{nameOf(comment.path)}</span>
      <span className={s.where}>{lines}</span>
    </>
  )
  return (
    <section className={s.excerpt}>
      {onOpen === undefined ? (
        <span className={s.place} title={comment.path}>
          {place}
        </span>
      ) : (
        <button
          type="button"
          className={cx(s.place, s.opens)}
          title={comment.path}
          aria-label={t.open(comment.path, lines)}
          onClick={onOpen}
        >
          {place}
          <Icon name="external" size={11} className={s.go} />
        </button>
      )}
      <Quote comment={comment} most={most} t={t} />
      {comment.note !== '' && <p className={s.said}>{comment.note}</p>}
    </section>
  )
}
