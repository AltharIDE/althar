import { useEffect, useRef, useState } from 'react'

/*
 * A title the agent renames types itself in: it backspaces what was there,
 * then types the new one, as someone at the keyboard would. The kit's
 * surfaces all take the title as a plain string, so this hands them the
 * string as far as it has got, caret included, and they stay the real ones.
 *
 * Only an agent's rename plays. The person's own, reduced motion and a first
 * draw show the title at once.
 */

export interface Take {
  key: string
  letter: string
  name: string
  idea: string
  /** ms per character backspaced, and typed (with its jitter, a person's uneven hands). */
  erase: number
  type: number
  jitter: number
  /** The beat between erasing and typing, and before the first erase. */
  beat: number
  lead: number
  /** Erase only back to where the old and new titles part, or all of it. */
  keepStart: boolean
  caret: 'solid' | 'blink'
  /** Say who is typing, beside the title. */
  signed: boolean
  /** A place too small to animate: it shows the new title at once and says so by a pulse. */
  small: 'pulse' | 'type-only'
}

export const TAKES: readonly Take[] = [
  {
    key: 'plain',
    letter: 'A',
    name: 'Backspace, retype',
    idea: 'All of it goes, quickly, then the new one is typed in. A steady caret. Tabs, too small, show the new title and pulse once.',
    erase: 16,
    type: 34,
    jitter: 0,
    beat: 160,
    lead: 120,
    keepStart: false,
    caret: 'solid',
    signed: false,
    small: 'pulse',
  },
  {
    key: 'human',
    letter: 'B',
    name: 'Keeps the start',
    idea: 'Only what changed is erased, back to where the two titles part; typed with uneven hands, a blinking caret, a pause to think. Tabs type without erasing.',
    erase: 55,
    type: 48,
    jitter: 38,
    beat: 380,
    lead: 260,
    keepStart: true,
    caret: 'blink',
    signed: false,
    small: 'type-only',
  },
  {
    key: 'signed',
    letter: 'C',
    name: 'Signed',
    idea: 'Take A’s pace, and a small line says who is at the keys while it runs (the lead, its model); tabs take a dot. Gone when it is done.',
    erase: 16,
    type: 34,
    jitter: 12,
    beat: 160,
    lead: 120,
    keepStart: false,
    caret: 'solid',
    signed: true,
    small: 'pulse',
  },
]

export const force = { reduced: false }
export const reduced = () => force.reduced || matchMedia('(prefers-reduced-motion: reduce)').matches

const common = (a: string, b: string) => {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i
}

export interface Typed {
  /** What to draw as the title now. */
  text: string
  typing: boolean
}

/**
 * `title` as it is now; `by` says who last changed it ('agent' plays, 'person' doesn't), `at` counts changes so the same
 * title renamed again still plays; `small` marks a place too small for the whole show.
 */
export function useTyped(title: string, by: 'agent' | 'person', at: number, take: Take, small = false): Typed {
  const [text, setText] = useState(title)
  const [typing, setTyping] = useState(false)
  const shown = useRef(title)
  const seen = useRef(at)

  useEffect(() => {
    if (seen.current === at) return
    seen.current = at
    const from = shown.current
    const done = (to: string) => {
      shown.current = to
      setText(to)
      setTyping(false)
    }
    if (by === 'person' || reduced() || from === title || (small && take.small === 'pulse')) return done(title)

    let stopped = false
    let timer = 0
    const wait = (ms: number, then: () => void) => {
      timer = window.setTimeout(() => !stopped && then(), ms)
    }
    const keep = take.keepStart || (small && take.small === 'type-only') ? common(from, title) : 0
    const put = (to: string) => {
      shown.current = to
      setText(to)
    }
    const typeFrom = (n: number) => {
      if (n > title.length) return done(title)
      put(title.slice(0, n))
      wait(Math.max(8, take.type * (small ? 0.5 : 1) + (Math.random() - 0.5) * 2 * take.jitter), () => typeFrom(n + 1))
    }
    const eraseFrom = (n: number) => {
      if (n <= keep) return wait(take.beat, () => typeFrom(keep + 1))
      put(from.slice(0, n - 1))
      wait(take.erase, () => eraseFrom(n - 1))
    }
    setTyping(true)
    if (small && take.small === 'type-only') {
      put(title.slice(0, keep))
      wait(take.beat / 2, () => typeFrom(keep + 1))
    } else wait(take.lead, () => eraseFrom(from.length))
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [at, title, by, take, small])

  return { text, typing }
}

/** The title with its caret while it is being typed; the blink is the caret's own, in the string. */
export function withCaret(typed: Typed, take: Take, tick: boolean): string {
  if (!typed.typing) return typed.text
  return typed.text + (take.caret === 'blink' && !tick ? ' ' : '▏')
}
