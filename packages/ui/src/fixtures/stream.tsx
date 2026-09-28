import { useCallback, useEffect, useRef, useState } from 'react'

import { Stream, type StreamProps } from '../primitives/Stream/Stream'

/** A stand-in for a model: the full reply, arriving in uneven bursts of a few tokens. */
export function useFakeStream(full: string, { start = true, delay = 0, random = Math.random } = {}) {
  const [n, setN] = useState(0)
  const [source, setSource] = useState(full)
  if (source !== full) {
    setSource(full)
    setN(0)
  }
  useEffect(() => {
    if (!start || n >= full.length) return
    const burst = 4 + Math.floor(random() * 22)
    const wait = n === 0 ? delay : 30 + random() * 150
    const t = window.setTimeout(() => setN((x) => Math.min(full.length, x + burst)), wait)
    return () => window.clearTimeout(t)
  }, [n, full, start, delay, random])
  return { text: full.slice(0, n), done: n >= full.length }
}

export interface StreamedProps extends Omit<StreamProps, 'done'> {
  /** Hold the reply until this is true. */
  start?: boolean
  /** Before the first burst, in ms. */
  delay?: number
}

/** A canned reply, streamed as a model would send it. For stories and the workbench. */
export function Streamed({ content: full, start = true, delay, animate = true, ...rest }: StreamedProps) {
  const { text: sofar, done } = useFakeStream(full, { start: start && animate, delay })
  return <Stream content={animate ? sofar : full} done={!animate || done} animate={animate} {...rest} />
}

/** A canned reply that starts over a moment after it finishes, so the motion can be watched. */
export function Looping({ content, className, pause = 2600 }: { content: string; className?: string; pause?: number }) {
  const [round, setRound] = useState(0)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const again = useCallback(() => {
    timer.current = window.setTimeout(() => setRound((r) => r + 1), pause)
  }, [pause])
  return <Streamed key={round} content={content} className={className} onDone={again} />
}
