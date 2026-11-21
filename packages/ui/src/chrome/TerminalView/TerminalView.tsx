import '@xterm/xterm/css/xterm.css'

import { type KeyboardEvent, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { chord, keys, modKey } from '../../foundations/keys'
import { cx } from '../../lib/cx'
import { IconButton } from '../../primitives/IconButton/IconButton'
import type { FindOptions, FindResults, TerminalSession } from './session'
import s from './TerminalView.module.css'

/*
 * Where a terminal is drawn: its session put in place, fitted to the room it
 * has as that changes, and its find bar over its corner, opened by the find
 * key from inside it, as an editor's is. The session outlives the view: a
 * view that goes takes it out of the page, and the next one puts it back as
 * it was.
 */

export interface TerminalViewText {
  find: string
  findLabel: string
  previous: string
  next: string
  closeFind: string
  caseSensitive: string
  wholeWord: string
  regex: string
  none: string
  of: (index: number, count: number) => string
  /** How many it found, where none is chosen yet. */
  many: (count: number) => string
}

export const terminalViewText: TerminalViewText = {
  find: 'Find',
  findLabel: 'Find in the terminal',
  previous: 'Previous match',
  next: 'Next match',
  closeFind: 'Close find',
  caseSensitive: 'Match case',
  wholeWord: 'Match whole word',
  regex: 'Use regular expression',
  none: 'No results',
  of: (index, count) => `${index + 1} of ${count}`,
  many: (count) => `${count.toLocaleString('en')} found`,
}

export interface TerminalViewProps {
  session: TerminalSession
  /** Takes the keys as it shows. */
  autoFocus?: boolean
  className?: string
  text?: Partial<TerminalViewText>
}

export function TerminalView({ session, autoFocus = false, className, text }: TerminalViewProps) {
  const t = { ...terminalViewText, ...text }
  const host = useRef<HTMLDivElement>(null)
  const [finding, setFinding] = useState(false)

  useLayoutEffect(() => {
    const place = host.current
    if (place === null) return
    session.mount(place)
    if (autoFocus) session.focus()
    // Fitted as its room changes, once a frame at most.
    let frame = 0
    const seen = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => session.fit())
    })
    seen.observe(place)
    return () => {
      seen.disconnect()
      cancelAnimationFrame(frame)
      session.unmount()
    }
  }, [session, autoFocus])

  useEffect(() => {
    session.onFind = () => setFinding(true)
    return () => {
      session.onFind = undefined
    }
  }, [session])

  return (
    <div className={cx(s.view, className)}>
      <div ref={host} className={s.host} />
      {finding && (
        <FindBar
          session={session}
          text={t}
          onClose={() => {
            setFinding(false)
            session.endFind()
            session.focus()
          }}
        />
      )}
    </div>
  )
}

function FindBar({ session, text: t, onClose }: { session: TerminalSession; text: TerminalViewText; onClose: () => void }) {
  const field = useRef<HTMLInputElement>(null)
  const [words, setWords] = useState(session.term.getSelection().split('\n')[0] ?? '')
  const [options, setOptions] = useState<FindOptions>({ caseSensitive: false, wholeWord: false, regex: false })
  const [results, setResults] = useState<FindResults>({ index: -1, count: 0 })

  useEffect(() => {
    field.current?.focus()
    field.current?.select()
    session.onFindResults = setResults
    return () => {
      session.onFindResults = undefined
    }
  }, [session])

  // Found again as the words or how they match change.
  useEffect(() => {
    session.find(words, options)
  }, [session, words, options])

  // Asked again while open: back to the field.
  useEffect(() => {
    session.onFind = () => {
      field.current?.focus()
      field.current?.select()
    }
  }, [session])

  const toggle = (key: keyof FindOptions) => setOptions((now) => ({ ...now, [key]: !now[key] }))
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      session.findAgain(options, event.shiftKey)
    }
  }
  const count =
    words === '' ? '' : results.count === 0 ? t.none : results.index < 0 ? t.many(results.count) : t.of(results.index, results.count)
  return (
    <div className={s.find} role="search" aria-label={t.findLabel}>
      <input
        ref={field}
        className={s.field}
        value={words}
        placeholder={t.find}
        aria-label={t.findLabel}
        spellCheck={false}
        onChange={(event) => setWords(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <span className={s.options}>
        <Toggle label={t.caseSensitive} on={options.caseSensitive} onPress={() => toggle('caseSensitive')}>
          Aa
        </Toggle>
        <Toggle label={t.wholeWord} on={options.wholeWord} onPress={() => toggle('wholeWord')}>
          <span className={s.word}>ab</span>
        </Toggle>
        <Toggle label={t.regex} on={options.regex} onPress={() => toggle('regex')}>
          .*
        </Toggle>
      </span>
      <span className={cx(s.count, words !== '' && results.count === 0 && s.none)} aria-live="polite">
        {count}
      </span>
      <IconButton
        icon="up"
        size="small"
        label={t.previous}
        kbd={chord(keys.shift, keys.enter)}
        tooltip="above"
        disabled={results.count === 0}
        onClick={() => session.findAgain(options, true)}
      />
      <IconButton
        icon="down"
        size="small"
        label={t.next}
        kbd={keys.enter}
        tooltip="above"
        disabled={results.count === 0}
        onClick={() => session.findAgain(options, false)}
      />
      <IconButton icon="close" size="small" label={t.closeFind} kbd="Esc" tooltip="above" tooltipAlign="end" onClick={onClose} />
    </div>
  )
}

function Toggle({ label, on, onPress, children }: { label: string; on: boolean; onPress: () => void; children: ReactNode }) {
  return (
    <button type="button" className={cx(s.toggle, on && s.on)} aria-pressed={on} aria-label={label} title={label} onClick={onPress}>
      {children}
    </button>
  )
}

/** The key that opens find, as the system draws it. */
export const findKey = modKey('F')
