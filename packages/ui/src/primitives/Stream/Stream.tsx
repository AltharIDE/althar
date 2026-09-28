import { useEffect, useRef, useState, type ElementType, type ReactNode } from 'react'

import { useWordPacer } from '../../lib/stream'
import s from './Stream.module.css'

/*
 * A message arriving, a word at a time (see lib/stream for the pacing).
 * Give each message its own `key`, so a new message starts fresh. A message
 * the reader has already watched arrive, like one in a thread they come
 * back to, is passed with `animate={false}` and shows whole: which ones
 * those are is the consumer's to know.
 *
 * While it streams, the paragraph is aria-busy, so a screen reader reads it
 * once it is complete rather than a word at a time. Once finished it is
 * plain text again, not a span per word.
 */

export interface StreamProps {
  /** Everything received so far. */
  content: string
  /** The model has finished. Until then a trailing half-word is held back. */
  done?: boolean
  /** Pace the words in. Off: show whatever has arrived, at once. */
  animate?: boolean
  /** Everything has arrived and is shown. Called once per message. */
  onDone?: () => void
  as?: ElementType
  className?: string
}

export function Stream({ content, done = true, animate = true, onDone, as: Tag = 'p', className }: StreamProps) {
  const { words, shown, finished } = useWordPacer(content, done, !animate)
  /* a message that does not continue the last one is a new message: it may finish again */
  const [source, setSource] = useState(content)
  if (!content.startsWith(source)) setSource(content)
  /* the message it last said was done, by where it started */
  const told = useRef<string | null>(null)
  useEffect(() => {
    if (!finished || told.current === source) return
    told.current = source
    onDone?.()
  }, [finished, onDone, source])

  /* paragraphs break where the source had a blank line */
  const paras: ReactNode[][] = [[]]
  const settled = finished || !animate
  let run = ''
  words.slice(0, shown).forEach((w, i) => {
    const last = paras[paras.length - 1]
    const breaks = /\n\s*\n/.test(w) && i < words.length - 1
    if (settled) run += w
    else
      last?.push(
        <span key={i} className={s.word}>
          {w}
        </span>,
      )
    if (breaks) {
      if (settled) last?.push(run)
      run = ''
      paras.push([])
    }
  })
  if (settled && run) paras[paras.length - 1]?.push(run)

  return (
    <>
      {paras.map((p, i) => (
        <Tag key={i} className={className} aria-busy={!finished || undefined}>
          {p}
        </Tag>
      ))}
    </>
  )
}
