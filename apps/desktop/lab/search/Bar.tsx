import { useEffect } from 'react'

import { Kbd } from '@althar/ui'

import { DIRECTIONS, direction, LINES, NAMES, narrow, openSearch, opened, said, useStore, words } from './state'
import s from './lab.module.css'

/*
 * The lab's own bar, under the app: which direction ⌘K opens, in a word and
 * a line, a few searches to try in it, and the window's width. 1–4 pick a
 * direction and w the width, wherever nothing is typed; with the box open,
 * Alt with 1–4 swaps it in place, the words kept, so one search reads in
 * each. A line over the bar says what an action would have done.
 */

const TRIES: ReadonlyArray<readonly [string, string]> = [
  ['lig', 'A few letters'],
  ['#845', 'A number'],
  ['dev-236', 'An issue'],
  ['rebase', 'A decision'],
  ['what did we decide about rebasing?', 'A question'],
  ['> push', 'An action'],
  ['/finder', 'A file'],
  ['refunds', 'Across projects'],
]

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || target.closest('input, textarea, select, [role="textbox"], [role="dialog"], [role="menu"]') !== null)

export function Bar() {
  const picked = useStore(direction)
  const isNarrow = useStore(narrow)
  const line = useStore(said)
  useEffect(() => {
    document.documentElement.dataset.narrow = isNarrow ? '1' : '0'
  }, [isNarrow])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey) return
      const digit = /^Digit([1-9])$/.exec(event.code)?.[1]
      // Alt-1 to 4 swap the direction with the box open, the words kept.
      if (event.altKey && digit !== undefined && opened.get()) {
        const next = DIRECTIONS[Number(digit) - 1]
        if (next === undefined) return
        event.preventDefault()
        direction.set(next)
        return
      }
      if (event.altKey || typing(event.target) || opened.get()) return
      const next = digit === undefined ? undefined : DIRECTIONS[Number(digit) - 1]
      if (next !== undefined) {
        event.preventDefault()
        direction.set(next)
      } else if (event.key === 'w') {
        event.preventDefault()
        narrow.set((was) => !was)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
  const tryOut = (query: string) => {
    // B reads its prefixes; the others take the words as they are.
    words.set(picked === 'b' || !/^[>/#"!]/.test(query) ? query : query.replace(/^[>/"!]\s*/, ''))
    if (!opened.get()) openSearch()
  }
  return (
    <>
      {line !== null && (
        <div className={s.said} role="status">
          {line}
        </div>
      )}
      <nav className={s.bar} aria-label="Directions" data-lab-bar="" onPointerDown={(event) => event.stopPropagation()}>
        <div className={s.directions}>
          {DIRECTIONS.map((one, n) => (
            <button
              key={one}
              type="button"
              tabIndex={-1}
              aria-pressed={picked === one}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => direction.set(one)}
              title={LINES[one]}
            >
              <kbd>{n + 1}</kbd> {NAMES[one]}
            </button>
          ))}
        </div>
        <div className={s.tries}>
          <span className={s.hint}>Try</span>
          {TRIES.map(([query, label]) => (
            <button
              key={query}
              type="button"
              tabIndex={-1}
              title={label}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => tryOut(query)}
            >
              {query}
            </button>
          ))}
        </div>
        <button
          type="button"
          tabIndex={-1}
          aria-pressed={isNarrow}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => narrow.set((was) => !was)}
        >
          <kbd>w</kbd> {isNarrow ? 'Narrow' : 'Wide'}
        </button>
        <span className={s.hint}>
          <Kbd>{/Mac/.test(navigator.platform) ? '⌘K' : 'Ctrl+K'}</Kbd> opens ·{' '}
          <Kbd>{/Mac/.test(navigator.platform) ? '⌥' : 'Alt+'}1–4</Kbd> swaps it open
        </span>
      </nav>
    </>
  )
}
