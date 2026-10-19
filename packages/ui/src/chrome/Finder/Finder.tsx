import { Dialog } from 'radix-ui'
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import type { ProjectInk } from '../../foundations/ProjectMark/drawing'
import { ProjectMark } from '../../foundations/ProjectMark/ProjectMark'
import { FoundState, unreachable } from '../../foundations/vocabulary'
import { useControlled } from '../../lib/controlled'
import { cx } from '../../lib/cx'
import { Kbd } from '../../primitives/Kbd/Kbd'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import s from './Finder.module.css'

/*
 * Finding a task by what it was about: a field, and the tasks it finds as it
 * is typed in, best first; with nothing typed, the ones changed last. Each
 * says its title, where it stands in a word, the project it is in where the
 * search crosses projects, its pull request, and what matched besides its
 * title, quietly, the matched words darker. A modal dialog the consumer
 * mounts to open; you arrive typing. The field keeps focus throughout (a
 * combobox over a listbox): the arrows move along the tasks, Enter opens the
 * one you are on, Escape closes it and gives focus back to what had it.
 *
 * The consumer searches as the words change and passes what it found. While
 * the next answer comes (`searching`), the last one stays, so the list
 * never empties and fills again between keys.
 */

/** A stretch of what matched: the words that matched what was typed are `hit`. */
export interface FoundPart {
  text: string
  hit: boolean
}

/** A task as the finder lists it. */
export interface FoundRow {
  id: string
  title: string
  state: FoundState
  /** The project it is in: given where the search crosses projects, as on the home. */
  project?: { seed: string; ink: ProjectInk; name: string }
  /** Its pull request, as its host writes it: #143, !12. */
  pullRequest?: string
  /** What matched besides its title, a few words either side. */
  matched?: readonly FoundPart[]
}

export interface FinderText {
  /** The dialog's name, for screen readers. */
  title: string
  /** The field's placeholder and name: where it searches. */
  search: string
  /** The list's name, once something is typed. */
  results: string
  /** What the list is with nothing typed. */
  recent: string
  none: (query: string) => string
  /** Said as an answer arrives. */
  count: (n: number) => string
  state: Record<FoundState, string>
  keys: { up: string; down: string; enter: string }
  move: string
  open: string
}

export const finderText: FinderText = {
  title: 'Find a task',
  search: 'Find a task',
  results: 'Tasks found',
  recent: 'Recent',
  none: (query) => `No tasks match “${query}”`,
  count: (n) => (n === 1 ? '1 task' : `${n} tasks`),
  state: {
    [FoundState.Planned]: 'Planned',
    [FoundState.Running]: 'Running',
    [FoundState.Yours]: 'Needs you',
    [FoundState.Ready]: 'Ready',
    [FoundState.Kept]: 'Kept for later',
    [FoundState.Stopped]: 'Stopped',
    [FoundState.Merged]: 'Merged',
    [FoundState.Done]: 'Done',
    [FoundState.Abandoned]: 'Abandoned',
  },
  keys: { up: '↑', down: '↓', enter: '↵' },
  move: 'move',
  open: 'open',
}

export interface FinderProps {
  /** What was found for the words, or with none typed the tasks changed last; null before the first answer. */
  results: readonly FoundRow[] | null
  /** An answer for newer words is on its way: what is shown is the last one's. */
  searching?: boolean
  /** The words typed, where the consumer keeps them. */
  query?: string
  defaultQuery?: string
  /** Every change to the words: search for them. */
  onQueryChange?: (query: string) => void
  /** Open a task, by its id. */
  onOpen: (id: string) => void
  /** Escape, or a press outside. */
  onClose: () => void
  text?: Partial<FinderText>
}

/** The colour of a state's word: cobalt for work under way, violet for what waits on you, quiet for the rest. */
const toneOf = (state: FoundState) => {
  switch (state) {
    case FoundState.Running:
      return s.live
    case FoundState.Yours:
    case FoundState.Ready:
      return s.signal
    case FoundState.Planned:
    case FoundState.Kept:
    case FoundState.Stopped:
    case FoundState.Merged:
    case FoundState.Done:
    case FoundState.Abandoned:
      return undefined
    default:
      return unreachable(state)
  }
}

export function Finder({ results, searching = false, query, defaultQuery = '', onQueryChange, onOpen, onClose, text }: FinderProps) {
  const t = { ...finderText, ...text }
  const [words, setWords] = useControlled(query, defaultQuery, onQueryChange)
  const [active, setActive] = useState(0)
  const field = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const ids = useId()
  // What had focus as it opened: there is no trigger of Radix's to give it back to.
  const [opener] = useState(() => (typeof document === 'undefined' ? null : document.activeElement))
  const typed = words.trim() !== ''
  const rows = results ?? []
  const at = Math.min(active, Math.max(rows.length - 1, 0))
  const optionId = (index: number) => `${ids}-${index}`
  const answered = results !== null && !searching
  // Enter on words not searched yet opens the first of what they find, once it comes, not the first of what was there before.
  const [opening, setOpening] = useState(false)
  useEffect(() => {
    if (!opening || searching) return
    setOpening(false)
    const first = results?.[0]
    if (first !== undefined) onOpen(first.id)
  }, [opening, searching, results, onOpen])

  const move = (to: number) => {
    setActive(to)
    list.current?.querySelector(`#${CSS.escape(optionId(to))}`)?.scrollIntoView({ block: 'nearest' })
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Enter that ends composing a character is the input method's.
    if (event.nativeEvent.isComposing) return
    if (event.key === 'ArrowDown') move(Math.min(at + 1, rows.length - 1))
    else if (event.key === 'ArrowUp') move(Math.max(at - 1, 0))
    else if (event.key === 'Enter') {
      const chosen = rows[at]
      if (searching) setOpening(true)
      else if (chosen !== undefined) onOpen(chosen.id)
    } else return
    event.preventDefault()
  }

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={s.overlay} />
        {/* the ch-root class carries type into the portal */}
        <Dialog.Content
          className={cx('ch-root', s.dialog)}
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            field.current?.focus()
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
          }}
        >
          <VisuallyHidden>
            <Dialog.Title>{t.title}</Dialog.Title>
          </VisuallyHidden>
          <div className={s.search}>
            <Icon name="search" size={15} />
            <input
              ref={field}
              type="text"
              role="combobox"
              aria-label={t.search}
              placeholder={t.search}
              aria-expanded={rows.length > 0}
              aria-controls={rows.length === 0 ? undefined : `${ids}-list`}
              aria-autocomplete="list"
              aria-activedescendant={rows.length === 0 ? undefined : optionId(at)}
              autoComplete="off"
              spellCheck={false}
              value={words}
              onChange={(event) => {
                setWords(event.target.value)
                setActive(0)
              }}
              onKeyDown={onKeyDown}
            />
          </div>
          {/* said once an answer comes, never for the one on its way */}
          <span aria-live="polite" className={s.said}>
            {typed && answered && <VisuallyHidden>{rows.length === 0 ? t.none(words.trim()) : t.count(rows.length)}</VisuallyHidden>}
          </span>
          <div className={s.results} aria-busy={searching}>
            {!typed && rows.length > 0 && (
              <div className={s.label} aria-hidden="true">
                {t.recent}
              </div>
            )}
            {rows.length > 0 && (
              <div ref={list} id={`${ids}-list`} role="listbox" aria-label={typed ? t.results : t.recent}>
                {rows.map((row, index) => {
                  const tone = toneOf(row.state)
                  const meta = row.project !== undefined || row.pullRequest !== undefined || (row.matched?.length ?? 0) > 0
                  return (
                    // A press opens it; focus stays in the field, which owns the keys.
                    <div
                      key={row.id}
                      id={optionId(index)}
                      role="option"
                      aria-selected={index === at}
                      className={s.row}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseMove={() => {
                        if (index !== at) setActive(index)
                      }}
                      onClick={() => onOpen(row.id)}
                    >
                      <span className={s.head}>
                        <span className={s.title}>{row.title}</span>
                        <span className={cx(s.state, tone)}>{t.state[row.state]}</span>
                      </span>
                      {meta && (
                        <span className={s.meta}>
                          {row.project !== undefined && (
                            <span className={s.project}>
                              <ProjectMark seed={row.project.seed} ink={row.project.ink} size={13} />
                              {row.project.name}
                            </span>
                          )}
                          {row.pullRequest !== undefined && <span className={s.pull}>{row.pullRequest}</span>}
                          {row.matched !== undefined && row.matched.length > 0 && (
                            <span className={s.matched}>
                              {row.matched.map((part, n) =>
                                part.hit ? (
                                  <mark key={n} className={s.hit}>
                                    {part.text}
                                  </mark>
                                ) : (
                                  <span key={n}>{part.text}</span>
                                ),
                              )}
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
            {typed && answered && rows.length === 0 && <p className={s.empty}>{t.none(words.trim())}</p>}
          </div>
          <div className={s.foot} aria-hidden="true">
            <span>
              <Kbd>{t.keys.up}</Kbd>
              <Kbd>{t.keys.down}</Kbd> {t.move}
            </span>
            <span>
              <Kbd>{t.keys.enter}</Kbd> {t.open}
            </span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
