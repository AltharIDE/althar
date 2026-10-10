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
}

export const diffText: DiffText = { changes: 'Changes', added: 'added', removed: 'removed' }

export type DiffProps = RootProps<
  'div',
  {
    lines: readonly DiffLine[]
    /** What changed: usually the file. */
    label?: string
    /** Show the old line numbers beside the new ones. Off in narrow places, where the new numbers are enough. */
    oldNumbers?: boolean
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

/** The file's own lines, with the changed words inside a line marked more strongly, so the eye lands on what moved. */
export function Diff({ lines, label, oldNumbers = false, text, className, ...rest }: DiffProps) {
  const t = { ...diffText, ...text }
  return (
    <div className={cx(s.diff, oldNumbers && s.both, className)} data-diff="" role="group" aria-label={label ?? t.changes} {...rest}>
      {lines.map((line, i) => {
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
