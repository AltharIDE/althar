import { useLayoutEffect, useRef, useState } from 'react'

import { reducedMotion } from './motion'

/*
 * Text an agent is still writing, shown at an even pace.
 *
 * It arrives in bursts: whole copies at most every 50 ms from the runtime,
 * with the stalls a model's stream has, after which what came meanwhile
 * lands at once. Shown as it lands, it reads as a stutter. So what has
 * arrived is held, and shown a frame at a time, at about the pace it has
 * been arriving (what came in the last second and a half), whole words at a
 * time, so a word never starts on one line and jumps to the next as it
 * grows. Fallen behind, by more than half a second's worth, it speeds up to
 * match; far behind (two seconds' worth, as when a thread opens mid-stream
 * or after the window was hidden), it catches up in a few frames. Once the
 * text is complete it shows whole at once. With reduced motion, it shows
 * as it arrives.
 *
 * From Codex's terminal (codex-rs/tui/src/streaming/chunking.rs): pace by
 * what is queued and how old it is, catch up when either grows, and flush
 * at once when the stream ends. Codex's unit is a whole rendered row; ours
 * is a whole word, since a page wraps as it goes.
 */

/** How far back what arrived counts toward the pace, in ms. */
const WINDOW = 1500
/** The pace before anything has arrived to judge by, and its bounds, in characters a second. */
const START = 240
const SLOWEST = 60
const FASTEST = 6000
/** Behind by more than this many seconds' worth, it speeds up; by more than the second, it catches up. */
const BEHIND = 0.5
const FAR_BEHIND = 2
/** How long catching up takes, in seconds. */
const CATCH_UP = 0.12
/** How far ahead it looks for the end of a word before showing part of one, in characters. */
const WORD = 24

/** Where a cut can fall without splitting a word, or a character made of two code units. */
export const wordEnd = (text: string, at: number): number => {
  if (at >= text.length) return text.length
  if (at <= 0) return 0
  // Inside a word: on to its end, when that is near.
  if (!/\s/.test(text[at - 1] ?? '') && !/\s/.test(text[at] ?? '')) {
    const rest = text.slice(at, at + WORD).search(/\s/)
    if (rest >= 0) return at + rest
  }
  const code = text.charCodeAt(at)
  return code >= 0xdc00 && code <= 0xdfff ? at + 1 : at
}

/** How text is paced: what has been shown, and what arrived when. Mutable; one per text being shown. */
export class Pacer {
  /** How far it has shown, in characters, as a fraction: whole words are shown once it passes them. */
  private at: number
  /** What is shown, in characters. */
  shown: number
  private arrived: Array<{ readonly at: number; readonly chars: number }> = []
  private length: number

  constructor(shown: number) {
    this.at = shown
    this.shown = shown
    this.length = shown
  }

  /** More of the text has arrived, `length` in all, at `now` ms. A text that got shorter starts again from where it now ends. */
  arrive(length: number, now: number) {
    if (length > this.length) this.arrived.push({ at: now, chars: length - this.length })
    else if (length < this.length) {
      this.at = Math.min(this.at, length)
      this.shown = Math.min(this.shown, length)
    }
    this.length = length
  }

  /** The pace it has been arriving at, in characters a second. */
  pace(now: number): number {
    this.arrived = this.arrived.filter((one) => now - one.at <= WINDOW)
    const first = this.arrived[0]
    if (first === undefined) return START
    const chars = this.arrived.reduce((sum, one) => sum + one.chars, 0)
    // Over at least a third of the window, so one burst alone doesn't read as a torrent.
    const span = Math.max(now - first.at, WINDOW / 3) / 1000
    return Math.min(FASTEST, Math.max(SLOWEST, chars / span))
  }

  /** Moves on by `elapsed` ms at `now`, through `text`: what it shows now, in characters. */
  advance(text: string, now: number, elapsed: number): number {
    const behind = text.length - this.at
    if (behind <= 0) {
      this.at = this.shown = text.length
      return this.shown
    }
    const pace = this.pace(now)
    const seconds = behind / pace
    const speed = seconds > FAR_BEHIND ? behind / CATCH_UP : seconds > BEHIND ? pace * (seconds / BEHIND) : pace
    this.at = Math.min(text.length, this.at + (speed * Math.min(elapsed, 250)) / 1000)
    this.shown = Math.max(this.shown, wordEnd(text, Math.floor(this.at)))
    return this.shown
  }
}

/**
 * `text` as far as it should show now: paced while `streaming`, on the
 * frames the screen draws; whole once it is not, or with reduced motion.
 * What was there when it first drew shows at once.
 */
export function usePacedText(text: string, streaming: boolean): string {
  const pacer = useRef<Pacer | null>(null)
  pacer.current ??= new Pacer(text.length)
  const [shown, setShown] = useState(text.length)
  const paced = streaming && !reducedMotion()
  // The frames it draws on, only while there is more to show, so a text that waits costs nothing; and when it last drew one,
  // so a frame counts the time since the last, across what arrived between.
  const last = useRef<number | null>(null)
  useLayoutEffect(() => {
    const it = pacer.current
    if (it === null) return
    const now = performance.now()
    it.arrive(text.length, now)
    if (!paced || it.shown >= text.length) {
      last.current = null
      return
    }
    let frame = 0
    const draw = (time: number) => {
      const next = it.advance(text, time, time - (last.current ?? time - 1000 / 60))
      last.current = time
      setShown(next)
      if (next < text.length) frame = requestAnimationFrame(draw)
      else last.current = null
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [text, paced])
  if (!paced) return text
  // Shorter than shown (the text started again), or nothing held back: as it is.
  return shown >= text.length ? text : text.slice(0, shown)
}
