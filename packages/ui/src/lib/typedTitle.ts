import { useEffect, useRef, useState } from 'react'

import { reducedMotion } from './motion'

/*
 * A task an agent renames: its title backspaces, then types the new one, as
 * someone at the keyboard would, on every surface that shows it live (its
 * header, its cards). The surfaces take a plain string, so this hands them
 * the string as far as it has got, with a caret while it goes.
 *
 * Only an agent's rename plays: the caller says which title an agent gave
 * the task last (`byAgent`, from the rename's own record), and a title that
 * is not that one, as the person's own in this window or another, shows at
 * once. So does anything under reduced motion, a title first drawn (read
 * from blank), or a card that only arrives in a lane.
 */

const LEAD = 120
const ERASE = 16
const BEAT = 160
const TYPE = 34
const CARET = '▏'
/** `title` as it is to be drawn: it changes by itself while an agent's rename plays (`byAgent` is that title), and is `title` itself at rest. */
export function useTypedTitle(title: string, byAgent: string | null = null): string {
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
    if (from === '' || byAgent !== title || reducedMotion()) {
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
    // The agent's mark is read as the title arrives, and is not a reason to play again when it changes after.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title])

  return typing ? text + CARET : text
}
