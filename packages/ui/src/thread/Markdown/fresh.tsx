import type { Token } from 'marked'
import { createContext, type ReactNode, useContext, useRef, useState } from 'react'

import { reducedMotion } from '../../lib/motion'
import s from './Markdown.module.css'

/*
 * The newest words of a text still being written come in dim and brighten,
 * so the text flows on rather than popping in a word at a time, as Codex's
 * app draws its answers.
 *
 * Each stretch of text that shows for the first time is kept with when it
 * did, by where it stands in the source, for as long as it takes to
 * brighten; its words are drawn in a span of their own that fades in from
 * when they showed. A span keeps its fade if it is drawn again, and once
 * the fade is over its words are drawn as plain text again. Where a token
 * stands is read from the raw text marked read it from. The record is one
 * object per text, the same each time it draws, so blocks that didn't change
 * aren't drawn again for it (Markdown/lexed.ts). With reduced motion, words
 * show as they arrive.
 */

/** How long a word takes to brighten, in ms: as long as `--stream-in`. */
export const FADE = 700
/** A text first drawn as it streams, no longer than this, is its first words: they fade in too. */
const FIRST_WORDS = 80
/**
 * What shows within this many ms of a stretch joins it, as one span: a span a frame would be forty fading at once for each
 * text. A word that joins late starts its fade a few hundredths in, which doesn't show.
 */
const TOGETHER = 50

interface Reveal {
  readonly id: number
  readonly from: number
  readonly to: number
  readonly at: number
}

/** What of a text came in lately, and where its tokens stand. Mutable; one per text. */
export class Freshness {
  /** What showed lately, oldest first, each from where the last ended. */
  reveals: ReadonlyArray<Reveal> = []
  /** Where each token of the blocks still fading stands in the source. */
  offsets = new WeakMap<object, number>()
  private shown = -1
  private made = 0
  private streamed = false

  /** It shows `length` characters of its source at `now`, still being written or not. */
  see(length: number, now: number, streaming: boolean) {
    this.reveals = this.reveals.filter((one) => now - one.at < FADE)
    // What grows while it streams fades in, and what shows at once as it stops; what was there when it first drew shows as
    // it is, but for the first words of a text drawn as they start.
    const from = this.shown >= 0 ? this.shown : streaming && length <= FIRST_WORDS ? 0 : length
    const last = this.reveals.at(-1)
    if ((streaming || this.streamed) && length > from)
      this.reveals =
        last !== undefined && last.to === from && now - last.at < TOGETHER
          ? [...this.reveals.slice(0, -1), { ...last, to: length }]
          : [...this.reveals, { id: (this.made += 1), from, to: length, at: now }]
    else if (length < this.shown) this.reveals = this.reveals.filter((one) => one.to <= length)
    this.shown = length
    this.streamed = streaming
  }

  /** Where in the source the oldest words still fading begin; past the end, where none are. */
  get since(): number {
    return this.reveals[0]?.from ?? Number.POSITIVE_INFINITY
  }

  /** Places the tokens of blocks that hold fading words: each by where its raw text stands in its parent's. */
  place(tokens: ReadonlyArray<Token>) {
    const since = this.since
    if (since === Number.POSITIVE_INFINITY) return
    let at = 0
    for (const token of tokens) {
      const end = at + token.raw.length
      if (end > since) this.placeIn(token, at)
      at = end
    }
  }

  private placeIn(token: Token, at: number) {
    this.offsets.set(token, at)
    const raw = token.raw
    let cursor = 0
    for (const child of childrenOf(token)) {
      const found = raw.indexOf(child.raw, cursor)
      const start = found === -1 ? cursor : found
      this.placeIn(child, at + start)
      if (found !== -1) cursor = start + child.raw.length
    }
  }
}

/** A token's tokens, as marked nests them: a list's items, and what any other holds. Tables' cells aren't placed. */
const childrenOf = (token: Token): ReadonlyArray<Token> => {
  if (token.type === 'list' && 'items' in token) return token.items as ReadonlyArray<Token>
  if ('tokens' in token && Array.isArray(token.tokens)) return token.tokens as ReadonlyArray<Token>
  return []
}

/** How much of `shown` is the source as it is: what streaming closed for now, after it, is markup. */
const sameUntil = (shown: string, source: string): number => {
  const most = Math.min(shown.length, source.length)
  let at = 0
  while (at < most && shown.charCodeAt(at) === source.charCodeAt(at)) at += 1
  return at
}

/**
 * A text's record of what came in lately, as it draws `shown` of `source`
 * (streaming.ts closes what is open after the source's own words). Null with
 * reduced motion.
 */
export function useFreshness(shown: string, source: string, streaming: boolean): Freshness | null {
  const record = useRef<Freshness | null>(null)
  record.current ??= new Freshness()
  if (reducedMotion()) return null
  record.current.see(sameUntil(shown, source), performance.now(), streaming)
  return record.current
}

export const Fresh = createContext<Freshness | null>(null)

/** Words that came in lately: they fade in from when they showed, kept as they draw again. */
function FreshWords({ at, children }: { at: number; children: ReactNode }) {
  // Drawn again later, as when its block is read anew, it goes on from where its fade is, not from dim.
  const [delay] = useState(() => Math.round(Math.min(0, at - performance.now())))
  return (
    <span className={s.fresh} style={delay > -16 ? undefined : { animationDelay: `${delay}ms` }}>
      {children}
    </span>
  )
}

/** A token's words, from where it stands in the source: what came in lately fading in, the rest as it is. */
export function useFreshly(token: object): (text: string, from?: number) => ReactNode {
  const fresh = useContext(Fresh)
  const start = fresh?.offsets.get(token)
  return (text, from = 0) => {
    if (fresh === null || start === undefined || fresh.reveals.length === 0) return text
    const at = start + from
    const end = at + text.length
    if (end <= fresh.since) return text
    const parts: Array<ReactNode> = []
    let cut = 0
    for (const reveal of fresh.reveals) {
      const a = Math.max(at, reveal.from) - at
      const b = Math.min(end, reveal.to) - at
      if (b <= a) continue
      if (a > cut) parts.push(text.slice(cut, a))
      parts.push(
        <FreshWords key={reveal.id} at={reveal.at}>
          {text.slice(a, b)}
        </FreshWords>,
      )
      cut = b
    }
    if (cut < text.length) parts.push(text.slice(cut))
    return parts.length === 1 ? parts[0] : parts
  }
}

/** Something drawn whole for a token, as code in backticks: it fades in as one where it came in lately. */
export function FreshWhole({ token, children }: { token: object; children: ReactNode }) {
  const fresh = useContext(Fresh)
  const start = fresh?.offsets.get(token)
  const reveal = start === undefined ? undefined : fresh?.reveals.find((one) => start >= one.from && start < one.to)
  return reveal === undefined ? children : <FreshWords at={reveal.at}>{children}</FreshWords>
}
