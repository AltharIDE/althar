import { useLayoutEffect, useMemo, useRef, useState } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import { isProse, useColoured } from '../../lib/syntax'
import type { CodeRead } from './code'
import s from './Code.module.css'

export interface CodeLinesText {
  /** Lines a peek leaves out, above or below those named. */
  hidden: (n: number, where: 'above' | 'below') => string
  /** What pressing the gap shows. */
  more: (n: number) => string
  all: (n: number) => string
  one: string
  /** Lines left out that weren't read here: the editor has them. */
  inEditor: string
}

export const codeLinesText: CodeLinesText = {
  hidden: (n, where) => `${n.toLocaleString()} ${n === 1 ? 'line' : 'lines'} ${where}`,
  more: (n) => `Show ${n} more`,
  all: (n) => `Show all ${n}`,
  one: 'Show it',
  inEditor: 'in your editor',
}

export interface CodeLinesProps {
  /** The file's path, for its colours and for its name. */
  path: string
  read: CodeRead
  /** The lines named, marked and scrolled to a third of the way down, as an editor puts a line it goes to. */
  mark?: { readonly line: number; readonly end: number } | null
  /** Only this many lines around those named, with a gap either side that shows more: a peek. Without it, the whole file. */
  around?: number
  text?: Partial<CodeLinesText>
  className?: string
}

/** How many more lines a gap shows each time it is pressed. */
const MORE = 20

/** A file's lines, read-only: numbered, in their colours, the lines named marked. Prose wraps; code scrolls sideways, its numbers staying put. */
export function CodeLines({ path, read, mark = null, around, text, className }: CodeLinesProps) {
  const t = { ...codeLinesText, ...text }
  const box = useRef<HTMLPreElement>(null)
  const rows = useMemo(() => read.text.replace(/\n$/, '').split('\n'), [read.text])
  const coloured = useColoured(read.text, path)
  const [more, setMore] = useState({ above: 0, below: 0 })
  const grew = useRef(false)

  // How wide the lines' window is, for the gaps that span it however far the lines scroll sideways.
  useLayoutEffect(() => {
    const el = box.current
    if (el === null || typeof ResizeObserver === 'undefined') return
    const fit = new ResizeObserver(() => el.style.setProperty('--box', `${el.clientWidth}px`))
    fit.observe(el)
    return () => fit.disconnect()
  }, [])

  // The lines named a third of the way down.
  useLayoutEffect(() => {
    const el = box.current
    if (el === null) return
    const first = el.querySelector<HTMLElement>('[data-named]')
    el.scrollTop = first === null ? 0 : Math.max(0, first.offsetTop - el.clientHeight / 3)
  }, [read, mark?.line])

  // Lines shown below come into view.
  useLayoutEffect(() => {
    const el = box.current
    if (el === null || !grew.current) return
    grew.current = false
    el.scrollTo?.({ top: el.scrollHeight, behavior: 'smooth' })
  }, [more.below])

  const first = read.from
  const last = first + rows.length - 1
  const lo = around === undefined || mark === null ? first : Math.max(first, mark.line - around - more.above)
  const hi = around === undefined ? last : Math.min(last, (mark === null ? first + around * 2 + 1 : mark.end + around) + more.below)
  return (
    // Focusable, to scroll from the keyboard as from a pointer, as a code block is; what holds it names it.
    <pre ref={box} className={cx(s.lines, isProse(path) && s.wrap, className)} tabIndex={0}>
      {around !== undefined && lo > 1 && (
        <Gap hidden={lo - 1} loaded={lo - first} where="above" t={t} onMore={() => setMore({ ...more, above: more.above + MORE })} />
      )}
      {rows.slice(lo - first, hi - first + 1).map((row, i) => {
        const n = lo + i
        const named = mark !== null && n >= mark.line && n <= mark.end
        return (
          <span key={n} className={cx(s.line, named && s.named)} data-named={named || undefined}>
            <span className={s.n} aria-hidden="true">
              {n}
            </span>
            <span className={s.text}>{coloured?.[n - first] ?? row}</span>
            {'\n'}
          </span>
        )
      })}
      {around !== undefined && hi < read.total && (
        <Gap
          hidden={read.total - hi}
          loaded={last - hi}
          where="below"
          t={t}
          onMore={() => {
            grew.current = true
            setMore({ ...more, below: more.below + MORE })
          }}
        />
      )}
    </pre>
  )
}

/** Lines a peek leaves out: how many, and pressed, twenty more of them. Those not read here are the editor's. */
function Gap({
  hidden,
  loaded,
  where,
  t,
  onMore,
}: {
  hidden: number
  loaded: number
  where: 'above' | 'below'
  t: CodeLinesText
  onMore: () => void
}) {
  const n = Math.min(MORE, loaded)
  const words = t.hidden(hidden, where)
  if (n === 0)
    return (
      <span className={s.gap}>
        <span className={s.gapIcon} />
        <span>
          {words}, {t.inEditor}
        </span>
      </span>
    )
  const more = n === hidden ? (n === 1 ? t.one : t.all(n)) : t.more(n)
  return (
    <button type="button" className={s.gap} onClick={onMore} aria-label={`${more}: ${words}`}>
      <span className={s.gapIcon}>
        <Icon name={where === 'above' ? 'chevronU' : 'chevronD'} size={12} />
      </span>
      <span>{words}</span>
      <span className={s.gapMore}>{more}</span>
    </button>
  )
}
