import { useEffect, useState } from 'react'

/*
 * Streaming, a word at a time.
 *
 * Tokens arrive in uneven bursts, and showing them as they land reads as
 * typing. Only whole words are shown: they are released at an even pace from
 * what has arrived, and each fades in. A long backlog is released faster, so
 * the text never trails far behind the model. Until the model is done, a
 * trailing half-word is held back.
 */

/** Words with their trailing whitespace, so the text wraps exactly as it would unstreamed. */
export function words(text: string, done: boolean): string[] {
  const all = text.match(/\S+\s*/g) ?? []
  const last = all[all.length - 1]
  if (!done && last !== undefined && !/\s$/.test(last)) all.pop()
  return all
}

/** How long to wait before the next word, and how many to release, given how far behind the text is. */
export function pace(behind: number): { gap: number; step: number } {
  return { gap: behind > 30 ? 10 : behind > 12 ? 22 : 38, step: behind > 60 ? 3 : 1 }
}

export function useWordPacer(text: string, done: boolean, instant = false) {
  const all = words(text, done)
  const [shown, setShown] = useState(instant ? Number.POSITIVE_INFINITY : 0)
  const count = Math.min(shown, all.length)
  const behind = all.length - count

  useEffect(() => {
    if (behind <= 0) return
    const { gap, step } = pace(behind)
    const t = window.setTimeout(() => setShown((s) => Math.min(s, all.length) + step), gap)
    return () => window.clearTimeout(t)
  }, [behind, all.length])

  return { words: all, shown: count, finished: done && behind <= 0 }
}

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
