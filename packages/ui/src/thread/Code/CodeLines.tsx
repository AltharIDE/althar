import { memo, type ReactNode, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { CHUNK, chunkOf, useNear, widthOf } from '../../lib/chunks'
import { cssVars } from '../../lib/cssVars'
import { cx } from '../../lib/cx'
import { inked, isProse, type TokenLines, useTokens } from '../../lib/syntax'
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

type Mark = { readonly line: number; readonly end: number } | null

interface LinesProps {
  /** Every line read, the first numbered `first`, and their tokens where coloured. */
  rows: readonly string[]
  first: number
  tokens: TokenLines | null
  /** The numbers of the first and last lines to draw. */
  from: number
  to: number
  mark: Mark
}

/** Which of the lines from `from` to `to` are named, as a word that changes only when that does. */
const namedIn = (mark: Mark, from: number, to: number) =>
  mark === null || mark.end < from || mark.line > to ? '' : `${Math.max(mark.line, from)}-${Math.min(mark.end, to)}`

/** The same lines, named alike, in the same colours: as a file's colours come, only the lines that took them are drawn again. */
const sameLines = (a: LinesProps, b: LinesProps) => {
  if (a.rows !== b.rows || a.first !== b.first || a.from !== b.from || a.to !== b.to) return false
  if (namedIn(a.mark, a.from, a.to) !== namedIn(b.mark, b.from, b.to)) return false
  if (a.tokens === b.tokens) return true
  for (let n = a.from; n <= a.to; n += 1) if (a.tokens?.[n - a.first] !== b.tokens?.[n - b.first]) return false
  return true
}

/** Lines from `from` to `to`: numbered, in their colours where they have them, those named marked. */
const Lines = memo(function Lines({ rows, first, tokens, from, to, mark }: LinesProps) {
  const lines: ReactNode[] = []
  for (let n = from; n <= to; n += 1) {
    const named = mark !== null && n >= mark.line && n <= mark.end
    const line = tokens?.[n - first]
    lines.push(
      <span key={n} className={cx(s.line, named && s.named)} data-named={named || undefined}>
        <span className={s.n} aria-hidden="true">
          {n}
        </span>
        <span className={s.text}>{line === undefined ? (rows[n - first] ?? '') : inked(line)}</span>
        {'\n'}
      </span>,
    )
  }
  return lines
}, sameLines)

/**
 * A chunk of a long file's lines: laid out and painted only near the screen, held until then as tall as its lines and as wide
 * as its longest (Code.module.css), and in its colours once near (lib/chunks.ts).
 */
function Chunk({ initially, ...lines }: LinesProps & { initially: boolean }) {
  const box = useRef<HTMLSpanElement>(null)
  const near = useNear(box, initially)
  const { rows, first, from, to } = lines
  const widest = useMemo(() => {
    let most = 0
    for (let n = from; n <= to; n += 1) most = Math.max(most, widthOf(rows[n - first] ?? ''))
    return most
  }, [rows, first, from, to])
  return (
    <span ref={box} className={s.chunk} style={cssVars({ '--rows': to - from + 1, '--cols': widest })}>
      <Lines {...lines} tokens={near ? lines.tokens : null} />
    </span>
  )
}

/** A file's lines, read-only: numbered, in their colours, the lines named marked. Prose wraps; code scrolls sideways, its numbers staying put. */
export function CodeLines({ path, read, mark = null, around, text, className }: CodeLinesProps) {
  const t = { ...codeLinesText, ...text }
  const box = useRef<HTMLPreElement>(null)
  const rows = useMemo(() => read.text.replace(/\n$/, '').split('\n'), [read.text])
  const tokens = useTokens(read.text, path)
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

  // The lines named a third of the way down: where they are in the lines, measured, as a chunk they are in is drawn for it.
  useLayoutEffect(() => {
    const el = box.current
    if (el === null) return
    const first = el.querySelector<HTMLElement>('[data-named]')
    const top = first === null ? 0 : first.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop
    el.scrollTop = first === null ? 0 : Math.max(0, top - el.clientHeight / 3)
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
  const lines = { rows, first, tokens, mark }
  return (
    // Focusable, to scroll from the keyboard as from a pointer, as a code block is; what holds it names it.
    <pre ref={box} className={cx(s.lines, isProse(path) && s.wrap, className)} tabIndex={0}>
      {around !== undefined && lo > 1 && (
        <Gap hidden={lo - 1} loaded={lo - first} where="above" t={t} onMore={() => setMore({ ...more, above: more.above + MORE })} />
      )}
      {hi - lo < CHUNK ? (
        <Lines {...lines} from={lo} to={hi} />
      ) : (
        // A long file in chunks, by where each line is in the file, so lines shown later join the chunk they are in; those
        // about where it opens, at the lines named or its top, are near from the start.
        Array.from({ length: chunkOf(hi - first) - chunkOf(lo - first) + 1 }, (_, i) => {
          const k = chunkOf(lo - first) + i
          return (
            <Chunk
              key={k}
              {...lines}
              from={Math.max(lo, first + k * CHUNK)}
              to={Math.min(hi, first + (k + 1) * CHUNK - 1)}
              initially={Math.abs(k - chunkOf((mark?.line ?? lo) - first)) <= 1}
            />
          )
        })
      )}
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
