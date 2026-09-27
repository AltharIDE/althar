import { useEffect, useRef, type ElementType, type ReactNode } from 'react'

import { useFakeStream, useWordPacer } from '../../lib/stream'
import s from './Stream.module.css'

/*
 * A message arriving, a word at a time (see lib/stream for the pacing).
 * A message that has streamed once, named by `id`, shows whole when it is
 * seen again, so going back to a thread does not replay it.
 *
 * While it streams, the paragraph is aria-busy, so a screen reader reads it
 * once it is complete rather than a word at a time.
 */

const seen = new Set<string>()

export interface StreamProps {
  /** Everything received so far. */
  content: string
  /** The model has finished. Until then a trailing half-word is held back. */
  done?: boolean
  id?: string
  onDone?: () => void
  as?: ElementType
  className?: string
}

export function Stream({ content, done = true, id, onDone, as: Tag = 'p', className }: StreamProps) {
  const instant = id !== undefined && seen.has(id)
  const { words, shown, finished } = useWordPacer(content, done, instant)
  const told = useRef(false)

  useEffect(() => {
    if (!finished || told.current) return
    told.current = true
    if (id !== undefined) seen.add(id)
    onDone?.()
  }, [finished, id, onDone])

  /* paragraphs break where the source had a blank line */
  const paras: ReactNode[][] = [[]]
  words.slice(0, shown).forEach((w, i) => {
    paras[paras.length - 1]?.push(
      <span key={i} className={instant ? undefined : s.word}>
        {w}
      </span>,
    )
    if (/\n\s*\n/.test(w) && i < words.length - 1) paras.push([])
  })

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

export interface StreamedProps extends Omit<StreamProps, 'done'> {
  /** Hold the reply until this is true. */
  start?: boolean
  /** Before the first burst, in ms. */
  delay?: number
}

/** A canned reply, streamed as a model would send it. For demos and stories. */
export function Streamed({ content: full, id, start = true, delay, ...rest }: StreamedProps) {
  const instant = id !== undefined && seen.has(id)
  const { text: sofar, done } = useFakeStream(full, { start: start && !instant, delay })
  return <Stream content={instant ? full : sofar} done={instant || done} id={id} {...rest} />
}

/** For tests: forget which messages have streamed. */
export const forgetStreamed = () => seen.clear()
