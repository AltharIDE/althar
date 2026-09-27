import { unreachable } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import s from './Diff.module.css'

/** A line: its sign (+, −, a space for context, @ for a hunk header), its number, its text, and the words that changed in it. */
export type DiffLine = [sign: '+' | '-' | ' ' | '@', n: number | '', text: string, changed?: string]

export interface DiffText {
  /** The group's name, when no label is given. */
  changes: string
  added: string
  removed: string
}

export const diffText: DiffText = { changes: 'Changes', added: 'added', removed: 'removed' }

export interface DiffProps {
  lines: DiffLine[]
  /** What changed: usually the file. */
  label?: string
  text?: Partial<DiffText>
}

type Sign = DiffLine[0]

/** How a line's sign looks, and what it says to a screen reader. */
function sign(x: Sign, t: DiffText): { shown: string; said?: string; className?: string } {
  switch (x) {
    case '+':
      return { shown: '+', said: t.added, className: s.add }
    case '-':
      return { shown: '-', said: t.removed, className: s.del }
    case '@':
      return { shown: '', className: s.hunk }
    case ' ':
      return { shown: '' }
    default:
      return unreachable(x)
  }
}

/** The file's own lines, with the changed words inside a line marked more strongly, so the eye lands on what moved. */
export function Diff({ lines, label, text }: DiffProps) {
  const t = { ...diffText, ...text }
  return (
    <div className={s.diff} data-diff="" role="group" aria-label={label ?? t.changes}>
      {lines.map(([x, n, line, changed], i) => {
        const look = sign(x, t)
        return (
          <div key={i} className={cx(s.line, look.className)}>
            <span className={s.n}>{n}</span>
            <span className={s.sign}>
              {look.shown}
              {look.said && <VisuallyHidden> {look.said}</VisuallyHidden>}
            </span>
            <span>{changed ? mark(line, changed) : line}</span>
          </div>
        )
      })}
    </div>
  )
}

function mark(text: string, word: string) {
  const i = text.indexOf(word)
  if (i < 0) return text
  return (
    <>
      {text.slice(0, i)}
      <mark>{word}</mark>
      {text.slice(i + word.length)}
    </>
  )
}
