import { useEffect, useRef, useState } from 'react'

import { reducedMotion } from './motion'

/*
 * A task an agent renames: its title backspaces, then types the new one, as
 * someone at the keyboard would, on every surface that shows it live (its
 * header, its card on the board, its card in the thread). The surfaces take
 * a plain string, so this hands them the string as far as it has got, with
 * a caret while it goes.
 *
 * Only an agent's rename plays. What this window itself renamed (the
 * person's, or an aside's first title) is marked with ownTitle and shows at
 * once, as does anything under reduced motion, a title first drawn, or a
 * card that only arrives in a lane.
 */

const LEAD = 120
const ERASE = 16
const BEAT = 160
const TYPE = 34
const CARET = '▏'
/** How long a title this window wrote is known as its own. */
const OWN_FOR = 15_000

const own = new Map<string, number>()

/** This window is renaming a task to `title`: the person's, not an agent's. Surfaces show it at once. */
export function markOwnTitle(title: string, now = Date.now()) {
  for (const [known, until] of own) if (until <= now) own.delete(known)
  own.set(title, now + OWN_FOR)
}

const isOwn = (title: string, now = Date.now()) => (own.get(title) ?? 0) > now

/** `title` as it is to be drawn: it changes by itself while an agent's rename plays, and is `title` itself at rest. */
export function useTypedTitle(title: string): string {
  const [text, setText] = useState(title)
  const [typing, setTyping] = useState(false)
  // What is drawn now, without the caret: where a rename starts from, even if another comes before it ends.
  const drawn = useRef(title)

  useEffect(() => {
    const from = drawn.current
    const put = (to: string) => {
      drawn.current = to
      setText(to)
    }
    if (from === title) {
      setTyping(false)
      return
    }
    if (reducedMotion() || isOwn(title)) {
      put(title)
      setTyping(false)
      return
    }
    let timer = 0
    const after = (ms: number, then: () => void) => {
      timer = window.setTimeout(then, ms)
    }
    const type = (n: number) => {
      put(title.slice(0, n))
      if (n >= title.length) setTyping(false)
      else after(TYPE, () => type(n + 1))
    }
    const erase = (n: number) => {
      if (n === 0) after(BEAT, () => type(1))
      else {
        put(from.slice(0, n - 1))
        after(ERASE, () => erase(n - 1))
      }
    }
    setTyping(true)
    after(LEAD, () => erase(from.length))
    return () => window.clearTimeout(timer)
  }, [title])

  return typing ? text + CARET : text
}
