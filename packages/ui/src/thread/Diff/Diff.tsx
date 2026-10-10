import { useState } from 'react'

import { DiffLineKind, unreachable } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import s from './Diff.module.css'

/**
 * A line of a diff. Context lines carry both numbers; an added line only its
 * new one, a removed line only its old one. `changed` names the stretches of
 * the line that differ from its counterpart, marked where they occur.
 */
export type DiffLine =
  | { kind: DiffLineKind.Hunk; text: string }
  | { kind: DiffLineKind.Context; old: number; new: number; text: string }
  | { kind: DiffLineKind.Added; new: number; text: string; changed?: readonly string[] }
  | { kind: DiffLineKind.Removed; old: number; text: string; changed?: readonly string[] }

export interface DiffText {
  /** The group's name, when no label is given. */
  changes: string
  added: string
  removed: string
  /** A folded stretch of unchanged lines, which opens in place. */
  unchanged: (count: number) => string
}

export const diffText: DiffText = {
  changes: 'Changes',
  added: 'added',
  removed: 'removed',
  unchanged: (count) => (count === 1 ? 'Show 1 unchanged line' : `Show ${count} unchanged lines`),
}

export type DiffProps = RootProps<
  'div',
  {
    lines: readonly DiffLine[]
    /** What changed: usually the file. */
    label?: string
    /** Show the old line numbers beside the new ones. Off in narrow places, where the new numbers are enough. */
    oldNumbers?: boolean
    /**
     * Fold unchanged stretches longer than this many lines on each side of a
     * change into a row that opens them in place: for a diff of a whole file.
     * Without it, every line shows, hunk headers and all.
     */
    fold?: number
    text?: Partial<DiffText>
  }
>

interface Look {
  sign: string
  said?: string
  className?: string
  old?: number
  new?: number
  changed?: readonly string[]
}

function look(line: DiffLine, t: DiffText): Look {
  switch (line.kind) {
    case DiffLineKind.Added:
      return { sign: '+', said: t.added, className: s.add, new: line.new, changed: line.changed }
    case DiffLineKind.Removed:
      return { sign: '-', said: t.removed, className: s.del, old: line.old, changed: line.changed }
    case DiffLineKind.Hunk:
      return { sign: '', className: s.hunk }
    case DiffLineKind.Context:
      return { sign: '', old: line.old, new: line.new }
    default:
      return unreachable(line)
  }
}

/**
 * A line to show; a folded stretch of unchanged ones, from where it starts in
 * the lines and how many; or where a diff read in hunks skips lines, with the
 * function git names there.
 */
type Row =
  | { readonly line: DiffLine; readonly at: number }
  | { readonly fold: number; readonly count: number }
  | { readonly gap: number; readonly where: string }

/** A hunk's header, `@@ -10,6 +10,8 @@ checkout`: where its old lines start, and the function it is in. */
const hunkOf = (text: string) => {
  const found = /^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@ ?(.*)$/.exec(text)
  return { from: Number(found?.[1] ?? 1), where: found?.[2]?.trim() ?? '' }
}

/**
 * The lines with each long unchanged stretch folded, but for `keep` lines
 * beside a change; a stretch that opens or ends the file keeps only the side
 * that faces a change. A hunk header that opens the whole file goes; one
 * after lines skipped, in a diff too long to read whole, marks the gap.
 */
const folded = (lines: readonly DiffLine[], keep: number, opened: ReadonlySet<number>): readonly Row[] => {
  const rows: Row[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line === undefined) break
    if (line.kind === DiffLineKind.Hunk) {
      const hunk = hunkOf(line.text)
      if (i > 0 || hunk.from > 1) rows.push({ gap: i, where: hunk.where })
      i += 1
      continue
    }
    if (line.kind !== DiffLineKind.Context) {
      rows.push({ line, at: i })
      i += 1
      continue
    }
    let end = i
    while (lines[end]?.kind === DiffLineKind.Context) end += 1
    const before = i === 0 || lines.slice(0, i).every((one) => one.kind === DiffLineKind.Hunk) ? 0 : keep
    const after = end >= lines.length ? 0 : keep
    const hidden = end - i - before - after
    for (let at = i; at < end; at += 1) {
      const shown = at < i + before || at >= end - after || opened.has(i + before) || hidden <= 1
      if (shown) rows.push({ line: lines[at] as DiffLine, at })
      else if (at === i + before) rows.push({ fold: at, count: hidden })
    }
    i = end
  }
  return rows
}

/** The file's own lines, with the changed words inside a line marked more strongly, so the eye lands on what moved. */
export function Diff({ lines, label, oldNumbers = false, fold, text, className, ...rest }: DiffProps) {
  const t = { ...diffText, ...text }
  const [opened, setOpened] = useState<ReadonlySet<number>>(() => new Set())
  const rows: readonly Row[] = fold === undefined ? lines.map((line, at) => ({ line, at })) : folded(lines, fold, opened)
  return (
    <div className={cx(s.diff, oldNumbers && s.both, className)} data-diff="" role="group" aria-label={label ?? t.changes} {...rest}>
      {rows.map((row) => {
        if ('gap' in row)
          return (
            <div key={`gap-${row.gap}`} className={cx(s.line, s.hunk)}>
              <span className={s.n} />
              {oldNumbers && <span className={s.n} />}
              <span className={s.sign}>⋯</span>
              <span>{row.where}</span>
            </div>
          )
        if ('fold' in row)
          return (
            <button
              key={`fold-${row.fold}`}
              type="button"
              className={s.fold}
              onClick={() => setOpened((now) => new Set(now).add(row.fold))}
            >
              {t.unchanged(row.count)}
            </button>
          )
        const { line, at: i } = row
        const l = look(line, t)
        return (
          <div key={i} className={cx(s.line, l.className)}>
            {oldNumbers && <span className={s.n}>{l.old}</span>}
            {/* a removed line has no new number; in the one-column form it shows its old one */}
            <span className={s.n}>{oldNumbers ? l.new : (l.new ?? l.old)}</span>
            <span className={s.sign}>
              {l.sign}
              {l.said && <VisuallyHidden> {l.said}</VisuallyHidden>}
            </span>
            <span>{l.changed?.length ? mark(line.text, l.changed) : line.text}</span>
          </div>
        )
      })}
    </div>
  )
}

/** Every occurrence of every changed stretch, marked; overlapping stretches merge. */
function mark(text: string, changed: readonly string[]) {
  const on = Array.from({ length: text.length }, () => false)
  for (const word of changed) {
    if (!word) continue
    for (let i = text.indexOf(word); i >= 0; i = text.indexOf(word, i + word.length)) on.fill(true, i, i + word.length)
  }
  const parts: { text: string; marked: boolean }[] = []
  for (let i = 0; i < text.length; i++) {
    const last = parts.at(-1)
    if (last && last.marked === on[i]) last.text += text[i]
    else parts.push({ text: text[i] ?? '', marked: on[i] ?? false })
  }
  return parts.map((p, i) => (p.marked ? <mark key={i}>{p.text}</mark> : p.text))
}
