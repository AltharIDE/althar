import { Fragment, type KeyboardEvent, memo, type MouseEvent, type ReactNode, useMemo, useState } from 'react'

import { DiffLineKind, unreachable } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { inked, type Token, type TokenLines, useTokens } from '../../lib/syntax'
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

/** Something said about a line, shown under it: a review's finding, or a comment of the person's, there. */
export interface DiffNote {
  readonly key: string
  /** The line it is about, from 1: of the new file, or with `old`, of the file as it was, for a line taken out. */
  readonly line: number
  readonly old?: boolean
  /** Where it goes among the lines given, by its place in them, in place of its line: a comment being written, under the lines picked. */
  readonly at?: number
  readonly node: ReactNode
}

/** A stretch of the lines picked, by where they are in the lines given, `from` to `to` inclusive. */
export interface DiffPick {
  readonly from: number
  readonly to: number
}

export interface DiffText {
  /** The group's name, when no label is given. */
  changes: string
  added: string
  removed: string
  /** A folded stretch of unchanged lines, which opens in place. */
  unchanged: (count: number) => string
  /** A line's number, where lines can be picked: picks it, to comment on. */
  pick: (line: number, removed: boolean) => string
}

export const diffText: DiffText = {
  changes: 'Changes',
  added: 'added',
  removed: 'removed',
  unchanged: (count) => (count === 1 ? 'Show 1 unchanged line' : `Show ${count} unchanged lines`),
  pick: (line, removed) => (removed ? `Comment on removed line ${line}` : `Comment on line ${line}`),
}

export type DiffProps = RootProps<
  'div',
  {
    lines: readonly DiffLine[]
    /** What changed: usually the file. */
    label?: string
    /** The file, whose name says the language its lines are coloured in. Without it, or in a language not coloured, they show plain. */
    path?: string
    /** Show the old line numbers beside the new ones. Off in narrow places, where the new numbers are enough. */
    oldNumbers?: boolean
    /**
     * Fold unchanged stretches longer than this many lines on each side of a
     * change into a row that opens them in place: for a diff of a whole file.
     * Without it, every line shows, hunk headers and all.
     */
    fold?: number
    /** Notes under the lines they are about, those lines kept out of the folds. */
    notes?: readonly DiffNote[]
    /**
     * Makes each line's number a button that picks it, to comment on: with
     * `extend` (Shift held), from the line picked already to this one. The
     * arrows go from line to line among them, Shift with them widening.
     */
    onPick?: (at: number, extend: boolean) => void
    /** The lines picked, marked; those beside them kept out of the folds. */
    picked?: DiffPick | null
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
const folded = (lines: readonly DiffLine[], keep: number, opened: ReadonlySet<number>, kept: ReadonlySet<number>): readonly Row[] => {
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
    // A changed line, or one a note is about, shows with the lines beside it.
    if (line.kind !== DiffLineKind.Context || kept.has(i)) {
      rows.push({ line, at: i })
      i += 1
      continue
    }
    let end = i
    while (lines[end]?.kind === DiffLineKind.Context && !kept.has(end)) end += 1
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

/**
 * Which of the lines a note about the new file's `line` goes under: that
 * line, or where it isn't among them (taken out, or in a stretch a diff read
 * in hunks skips), the last line before it; the first line, with none.
 */
export const noteAt = (lines: readonly DiffLine[], line: number, old = false): number => {
  if (old) {
    // A line taken out goes under itself where it shows; else as the new file's line it was taken out after would.
    const found = lines.findIndex((one) => (one.kind === DiffLineKind.Removed || one.kind === DiffLineKind.Context) && one.old === line)
    if (found >= 0) return found
  }
  let before = -1
  for (const [at, one] of lines.entries()) {
    if (one.kind !== DiffLineKind.Context && one.kind !== DiffLineKind.Added) continue
    if (one.new === line) return at
    if (one.new < line) before = at
  }
  if (before >= 0) return before
  const first = lines.findIndex((one) => one.kind !== DiffLineKind.Hunk)
  return Math.max(0, first)
}

/**
 * A diff's two sides, each as a file of its own, so what spans lines (a
 * block comment, a template string, JSX) colours as it would in the file:
 * the old side its context and removed lines, the new side its context and
 * added ones, in order, and where each line of the diff is in them (-1 where
 * it isn't). A diff of the whole file gives both files whole; one in hunks
 * gives their lines run together, so a hunk that opens inside a comment may
 * colour wrong.
 */
export interface Sides {
  readonly old: string
  readonly new: string
  readonly oldAt: readonly number[]
  readonly newAt: readonly number[]
}

export const sidesOf = (lines: readonly DiffLine[]): Sides => {
  const old: string[] = []
  const next: string[] = []
  const oldAt: number[] = []
  const newAt: number[] = []
  for (const line of lines) {
    const inOld = line.kind === DiffLineKind.Context || line.kind === DiffLineKind.Removed
    const inNew = line.kind === DiffLineKind.Context || line.kind === DiffLineKind.Added
    oldAt.push(inOld ? old.push(line.text) - 1 : -1)
    newAt.push(inNew ? next.push(line.text) - 1 : -1)
  }
  return { old: old.join('\n'), new: next.join('\n'), oldAt, newAt }
}

/** A line's tokens from its side: a removed line's from the old, the rest from the new. */
const tokensOf = (line: DiffLine, at: number, sides: Sides, old: TokenLines | null, next: TokenLines | null) =>
  line.kind === DiffLineKind.Removed ? old?.[sides.oldAt[at] ?? -1] : next?.[sides.newAt[at] ?? -1]

/**
 * One line, drawn again only when it or its colours change: as each side's
 * colours land only its own lines are, and opening a fold draws only the
 * lines it shows.
 */
const Line = memo(function Line({
  line,
  at,
  tokens,
  oldNumbers,
  pickable,
  picked,
  focusable,
  t,
}: {
  line: DiffLine
  at: number
  tokens: ReadonlyArray<Token> | undefined
  oldNumbers: boolean
  /** Its number is a button that picks it (the Diff's own handlers hear it, by `data-at`). */
  pickable: boolean
  picked: boolean
  /** The one line number in the tab order: the arrows go to the others. */
  focusable: boolean
  t: DiffText
}) {
  const l = look(line, t)
  // tokens that don't spell the line, as a side cut short would give, leave it plain
  const spelt = tokens !== undefined && tokens.map((token) => token.content).join('') === line.text ? tokens : undefined
  const numbers = (
    <>
      {oldNumbers && <span className={s.n}>{l.old}</span>}
      {/* a removed line has no new number; in the one-column form it shows its old one */}
      <span className={s.n}>{oldNumbers ? l.new : (l.new ?? l.old)}</span>
    </>
  )
  const number = l.new ?? l.old
  return (
    <div className={cx(s.line, l.className, picked && s.picked)} data-picked={picked || undefined}>
      {pickable && number !== undefined ? (
        <button
          type="button"
          className={s.pick}
          data-at={at}
          tabIndex={focusable ? 0 : -1}
          aria-label={t.pick(number, l.new === undefined)}
          aria-pressed={picked}
        >
          {numbers}
        </button>
      ) : (
        numbers
      )}
      <span className={s.sign}>
        {l.sign}
        {l.said && <VisuallyHidden> {l.said}</VisuallyHidden>}
      </span>
      <span>{paint(line.text, spelt, l.changed)}</span>
    </div>
  )
})

/** The file's own lines in their colours, with the changed words inside a line marked more strongly, so the eye lands on what moved. */
export function Diff({ lines, label, path, oldNumbers = false, fold, notes, onPick, picked, text, className, ...rest }: DiffProps) {
  // the same words while the text given is, so the lines needn't be drawn again for them
  const t = useMemo(() => ({ ...diffText, ...text }), [text])
  const [opened, setOpened] = useState<ReadonlySet<number>>(() => new Set())
  // The line number in the tab order, where lines can be picked: the last one picked, else the first line.
  const [focusAt, setFocusAt] = useState<number | null>(null)
  // The notes by the line they go under, in the order given.
  const under = useMemo(() => {
    const placed = new Map<number, DiffNote[]>()
    for (const note of notes ?? []) {
      const at = note.at ?? noteAt(lines, note.line, note.old === true)
      placed.set(at, [...(placed.get(at) ?? []), note])
    }
    return placed
  }, [lines, notes])
  const kept = useMemo(() => {
    const keep = new Set(under.keys())
    if (picked != null) for (let at = picked.from; at <= picked.to; at += 1) keep.add(at)
    return keep
  }, [under, picked])
  const pickable = onPick !== undefined
  // The line numbers are buttons the Diff hears as one: a press picks, the arrows move among them.
  const pickFrom = (event: { readonly target: EventTarget }) => {
    const at = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-at]')?.dataset.at : undefined
    return at === undefined ? null : Number(at)
  }
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const at = pickFrom(event)
    if (at === null || onPick === undefined) return
    setFocusAt(at)
    onPick(at, event.shiftKey)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const at = pickFrom(event)
    if (at === null || !(event.target instanceof HTMLElement)) return
    const buttons = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-at]')]
    const next =
      buttons[buttons.indexOf(event.target.closest<HTMLElement>('[data-at]') ?? event.target) + (event.key === 'ArrowDown' ? 1 : -1)]
    // The view's own arrows, which go through the files, aren't heard while a line number has focus.
    event.preventDefault()
    if (next === undefined) return
    const to = Number(next.dataset.at)
    setFocusAt(to)
    next.focus()
    // Shift with nothing picked yet starts from the line it moves from.
    if (event.shiftKey) {
      if (picked == null) onPick?.(at, false)
      onPick?.(to, true)
    }
  }
  const rows: readonly Row[] = useMemo(
    () => (fold === undefined ? lines.map((line, at) => ({ line, at })) : folded(lines, fold, opened, kept)),
    [lines, fold, opened, kept],
  )
  // Of the lines shown, the one whose number is in the tab order: the last gone to, else the last picked, else the first.
  const shownAt = rows.flatMap((row) => ('line' in row && row.line.kind !== DiffLineKind.Hunk ? [row.at] : []))
  const tabAt = [focusAt, picked?.to].find((at) => at != null && shownAt.includes(at)) ?? shownAt[0]
  const sides = useMemo(() => (path === undefined ? null : sidesOf(lines)), [lines, path])
  const old = useTokens(sides === null || sides.old === '' ? null : sides.old, path ?? '')
  const next = useTokens(sides === null || sides.new === '' ? null : sides.new, path ?? '')
  return (
    <div
      className={cx(s.diff, oldNumbers && s.both, className)}
      data-diff=""
      role="group"
      aria-label={label ?? t.changes}
      {...(pickable ? { onClick, onKeyDown } : {})}
      {...rest}
    >
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
        const { line, at } = row
        const tokens = sides === null || line.kind === DiffLineKind.Hunk ? undefined : tokensOf(line, at, sides, old, next)
        const said = under.get(at)
        const drawn = (
          <Line
            key={at}
            line={line}
            at={at}
            tokens={tokens}
            oldNumbers={oldNumbers}
            pickable={pickable}
            picked={picked != null && at >= picked.from && at <= picked.to}
            focusable={at === tabAt}
            t={t}
          />
        )
        return said === undefined ? (
          drawn
        ) : (
          <Fragment key={at}>
            {drawn}
            {said.map((note) => (
              <div key={note.key} className={s.under}>
                {note.node}
              </div>
            ))}
          </Fragment>
        )
      })}
    </div>
  )
}

/** Where a line's changed stretches are, a flag for each of its characters: every occurrence of each; overlapping ones merge. */
function marksOf(text: string, changed: readonly string[]) {
  const on = Array.from({ length: text.length }, () => false)
  for (const word of changed) {
    if (!word) continue
    for (let i = text.indexOf(word); i >= 0; i = text.indexOf(word, i + word.length)) on.fill(true, i, i + word.length)
  }
  return on
}

/** A line's text in its inks, where it has them, with its changed stretches marked over them. */
function paint(text: string, tokens: ReadonlyArray<Token> | undefined, changed: readonly string[] | undefined): ReactNode {
  if (!changed?.length) return tokens === undefined ? text : inked(tokens)
  const on = marksOf(text, changed)
  // Each token cut where a mark starts or ends, so a mark holds whole pieces of tokens.
  const pieces: { token: Token; marked: boolean }[] = []
  let at = 0
  for (const token of tokens ?? [{ content: text }]) {
    for (let from = 0, to = 1; from < token.content.length; from = to, to = from + 1) {
      const marked = on[at + from] ?? false
      while (to < token.content.length && (on[at + to] ?? false) === marked) to += 1
      pieces.push({ token: { ...token, content: token.content.slice(from, to) }, marked })
    }
    at += token.content.length
  }
  const runs: { marked: boolean; tokens: Token[] }[] = []
  for (const piece of pieces) {
    const last = runs.at(-1)
    if (last !== undefined && last.marked === piece.marked) last.tokens.push(piece.token)
    else runs.push({ marked: piece.marked, tokens: [piece.token] })
  }
  return runs.map((run, i) => (run.marked ? <mark key={i}>{inked(run.tokens, `${i}-`)}</mark> : inked(run.tokens, `${i}-`)))
}
