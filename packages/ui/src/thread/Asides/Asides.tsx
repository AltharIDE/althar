import { Fragment, type KeyboardEvent, type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'

import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Icon } from '../../foundations/Icon/Icon'
import { Button } from '../../primitives/Button/Button'
import { IconButton } from '../../primitives/IconButton/IconButton'
import { Kbd } from '../../primitives/Kbd/Kbd'
import { LiveDot } from '../../primitives/LiveDot/LiveDot'
import { Popover } from '../../primitives/Popover/Popover'
import s from './Asides.module.css'

/*
 * Asides (a task is a conversation plus parts, "Asides"): quick chats beside
 * the coordinator's conversation, with its tools, kept off the board. Over the
 * conversation, a heading as a lane names itself: the conversation open, which
 * opens a search over every conversation (by name or by what was said last;
 * those left a week among them, cleared together there); then the latest few
 * others as quiet words, one press each, the coordinator's first while an aside
 * is open; an open aside's ×, and + to start one. In an open aside, its move to
 * the board sits over its composer (AsideMoves).
 */

export interface Aside {
  id: string
  /** Its title; empty for one just started, whose heading says it is new until its first words name it. */
  title: string
  /** What was said last, its first line: found by the search, and shown under its name there. */
  said?: string
  /**
   * What was said in it, a passage each, the latest first: the search finds a conversation by any of them, and shows the one
   * that matched. Where the window has them, they are every public passage it holds of the conversation, not only the last.
   */
  words?: readonly string[]
  /** How long ago it was last spoken in, as the search says it ("4m"). */
  ago?: string
  /** Its agent is at it now. */
  running?: boolean
}

export interface AsideTabsText {
  label: string
  coordinator: string
  newAside: string
  add: string
  search: string
  noneFound: (words: string) => string
  older: (count: number) => string
  clearOlder: (count: number) => string
  /** The ×'s name, for the aside it clears. */
  clearOne: (title: string) => string
}

export const asideTabsText: AsideTabsText = {
  label: 'Conversations',
  coordinator: 'Coordinator',
  newAside: 'New aside',
  add: 'New aside',
  search: 'Search conversations',
  noneFound: (words) => `No conversation says “${words}”`,
  older: (count) => `${count} older`,
  clearOlder: (count) => (count === 1 ? 'Clear it' : `Clear these ${count}`),
  clearOne: (title) => `Clear ${title}`,
}

/** The latest others beside the heading, at most. */
const RECENT = 3

export type AsideTabsProps = RootProps<
  'div',
  {
    /** The coordinator's mark, before its name. */
    mark: ReactNode
    /** The latest first. */
    asides: readonly Aside[]
    /** Those left untouched for a week: in the search, under their own heading. */
    older?: readonly Aside[]
    /**
     * The one open, by its id; null for the coordinator's conversation. A new one is among `asides` from the moment it is
     * started, by the id it keeps, so the heading is the one element it has as its title fills in.
     */
    current: string | null
    onPick: (id: string | null) => void
    onNew: () => void
    /** Clears one, by its ×, or Delete on its name: it leaves at once. Without it, there is no ×. */
    onClear?: (id: string) => void
    /** Settles the older ones together, from the search. Without it, they can only be opened. */
    onClearOlder?: (ids: readonly string[]) => void
    /** What was said in the coordinator's conversation, a passage each, the latest first, as an aside's `words`. */
    coordinatorWords?: readonly string[]
    /** The keys that start one, as +'s tooltip says them. */
    newKbd?: string
    /** The keys that open the search, as it says them; the window owns them, and opens it with `searching`. */
    searchKbd?: string
    /** The search over every conversation is open; without it, the heading opens and shuts it on its own. */
    searching?: boolean
    onSearchingChange?: (open: boolean) => void
    text?: Partial<AsideTabsText>
  }
>

export function AsideTabs({
  mark,
  asides,
  older = [],
  current,
  onPick,
  onNew,
  onClear,
  onClearOlder,
  coordinatorWords,
  newKbd,
  searchKbd,
  searching,
  onSearchingChange,
  text,
  className,
  ...rest
}: AsideTabsProps) {
  const t = { ...asideTabsText, ...text }
  const [own, setOwn] = useState(false)
  const shown = searching ?? own
  const setShown = (next: boolean) => {
    if (searching === undefined) setOwn(next)
    onSearchingChange?.(next)
  }
  const open = [...asides, ...older].find((one) => one.id === current) ?? null
  const name = open === null ? t.coordinator : open.title || t.newAside
  // Where else to go: the coordinator's first while an aside is open, then the latest named asides; as many as fit.
  const others = [
    ...(open === null ? [] : [{ id: null, title: t.coordinator, running: false }]),
    ...asides.filter((one) => one.id !== current && one.title !== ''),
  ].slice(0, RECENT)
  const [place, fitting] = useFitCount(others.map((one) => `${one.id}:${one.title}`).join('|'), others.length)
  const inSight = others.slice(0, fitting)
  // At work out of sight: a dot by the heading's chevron.
  const elsewhere = [...asides, ...older].some(
    (one) => one.running === true && one.id !== current && !inSight.some((seen) => seen.id === one.id),
  )
  const clearKey = (id: string) => (event: KeyboardEvent) => {
    if (onClear === undefined || (event.key !== 'Delete' && event.key !== 'Backspace')) return
    event.preventDefault()
    onClear(id)
  }
  return (
    <div className={cx(s.strip, className)} data-conversation-bar {...rest}>
      <div className={s.tabs} role="tablist" aria-label={t.label}>
        <Popover
          label={t.search}
          width={360}
          padded={false}
          open={shown}
          onOpenChange={setShown}
          className={s.pop}
          trigger={
            <button
              type="button"
              role="tab"
              aria-selected
              aria-haspopup="listbox"
              className={s.heading}
              data-aside={open?.id}
              data-new={open?.title === '' || undefined}
              {...(open === null ? {} : { onKeyDown: clearKey(open.id) })}
            >
              {open === null ? mark : open.running === true ? <LiveDot pulse /> : null}
              <span className={s.name}>{name}</span>
              <Icon name="chevronD" size={12} className={s.chev} />
              {elsewhere && <LiveDot pulse />}
            </button>
          }
        >
          <Search
            mark={mark}
            asides={asides}
            older={older}
            current={current}
            t={t}
            {...(coordinatorWords === undefined ? {} : { coordinatorWords })}
            {...(searchKbd === undefined ? {} : { kbd: searchKbd })}
            {...(onClearOlder === undefined ? {} : { onClearOlder })}
            onChoose={(id) => {
              setShown(false)
              if (id === 'new') onNew()
              else onPick(id)
            }}
          />
        </Popover>
        <div ref={place} className={s.recents}>
          {inSight.map((one) => (
            <button
              key={one.id ?? 'coordinator'}
              type="button"
              role="tab"
              aria-selected={false}
              className={s.recent}
              data-aside={one.id ?? undefined}
              title={one.title}
              onClick={() => onPick(one.id)}
              {...(one.id === null ? {} : { onKeyDown: clearKey(one.id) })}
            >
              {one.id === null ? mark : one.running === true ? <LiveDot pulse /> : null}
              <span className={s.title}>{one.title}</span>
            </button>
          ))}
        </div>
      </div>
      {open !== null && onClear !== undefined && (
        <IconButton icon="close" size="small" label={t.clearOne(name)} onClick={() => onClear(open.id)} />
      )}
      <IconButton
        icon="plus"
        size="small"
        label={t.add}
        tooltipAlign="end"
        {...(newKbd === undefined ? {} : { kbd: newKbd })}
        onClick={onNew}
      />
    </div>
  )
}

/**
 * How many of `total` things fit their place: drawn, and while they overflow it one fewer, before the frame is painted;
 * the place grown, all are tried again. `key` names what they are, so new ones are all tried.
 */
function useFitCount(key: string, total: number) {
  const ref = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState({ key, count: total, width: 0 })
  if (fit.key !== key) setFit({ key, count: total, width: fit.width })
  const count = Math.min(fit.key === key ? fit.count : total, total)
  useLayoutEffect(() => {
    const place = ref.current
    if (place !== null && count > 0 && place.scrollWidth > place.clientWidth + 1) setFit((was) => ({ ...was, count: count - 1 }))
  }, [count, key, fit.width])
  useEffect(() => {
    const place = ref.current
    if (place === null) return
    const sizes = new ResizeObserver(() =>
      setFit((was) => {
        const width = place.clientWidth
        if (Math.abs(width - was.width) < 1) return was
        return { ...was, width, count: width > was.width ? Number.MAX_SAFE_INTEGER : was.count }
      }),
    )
    sizes.observe(place)
    return () => sizes.disconnect()
  }, [])
  return [ref, count] as const
}

/* ---------- The search over every conversation ---------- */

/** A stretch of a name or of what was said: the words that begin with what was typed are `hit`. */
interface Part {
  readonly text: string
  readonly hit: boolean
}

interface Row {
  /** null for the coordinator's; 'new' for the new aside at the foot. */
  readonly id: string | null
  readonly name: Part[]
  readonly untitled: boolean
  readonly running: boolean
  readonly older: boolean
  readonly ago: string | undefined
  /** What was said that matched, where the name doesn't hold every word typed. */
  readonly said: Part[] | null
}

/** A row's key: the conversation it is of. */
const keyOf = (row: Row) => row.id ?? 'coordinator'

const WORD = /[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu
const begins = (word: string, tokens: readonly string[]) => tokens.some((token) => word.toLowerCase().startsWith(token))
const holds = (text: string, token: string) => [...text.matchAll(WORD)].some((word) => begins(word[0], [token]))

/** A text in parts, the words that begin with one of the tokens marked. */
const partsOf = (text: string, tokens: readonly string[]): Part[] => {
  const parts: Part[] = []
  let at = 0
  for (const match of text.matchAll(WORD)) {
    if (!begins(match[0], tokens)) continue
    if (match.index > at) parts.push({ text: text.slice(at, match.index), hit: false })
    parts.push({ text: match[0], hit: true })
    at = match.index + match[0].length
  }
  if (at < text.length) parts.push({ text: text.slice(at), hit: false })
  return parts
}

/** A line from a few words before its first match, so the match is in sight. */
const around = (line: string, tokens: readonly string[]): Part[] => {
  const words = [...line.matchAll(WORD)]
  const first = words.findIndex((word) => begins(word[0], tokens))
  const from = first > 4 ? (words[first - 3]?.index ?? 0) : 0
  return partsOf(from > 0 ? `…${line.slice(from)}` : line, tokens)
}

/**
 * Every conversation, as the search lists it: with nothing typed the coordinator's, the asides latest first, then the older
 * ones; with words typed, those whose name or last words hold every one, those by name first. The new aside at the foot.
 */
const rowsOf = (
  asides: readonly Aside[],
  older: readonly Aside[],
  coordinatorWords: readonly string[],
  t: AsideTabsText,
  query: string,
): Row[] => {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  const everyone = [
    { id: null, title: t.coordinator, said: coordinatorWords[0], words: coordinatorWords, ago: undefined, running: false, older: false },
    ...asides.map((one) => ({ ...one, older: false })),
    ...older.map((one) => ({ ...one, older: true })),
  ]
  const found: { row: Row; byName: boolean }[] = []
  for (const one of everyone) {
    const name = one.title || t.newAside
    const base = { id: one.id, untitled: one.title === '', running: one.running === true, older: one.older, ago: one.ago }
    const missing = tokens.filter((token) => !holds(name, token))
    // What was said in it, the last line first, then the passages the window holds: each word typed in the name or in any.
    const passages = [...(one.said === undefined ? [] : [one.said]), ...(one.words ?? [])]
    if (missing.some((token) => !passages.some((passage) => holds(passage, token)))) continue
    const line = missing.length === 0 ? undefined : passages.find((passage) => missing.some((token) => holds(passage, token)))
    const said = line === undefined ? null : around(line, tokens)
    found.push({ row: { ...base, name: partsOf(name, tokens), said }, byName: missing.length === 0 })
  }
  if (tokens.length > 0) found.sort((a, b) => Number(b.byName) - Number(a.byName))
  const add: Row = {
    id: 'new',
    name: [{ text: t.add, hit: false }],
    untitled: false,
    running: false,
    older: false,
    ago: undefined,
    said: null,
  }
  return [...found.map((one) => one.row), add]
}

function Parts({ parts }: { parts: readonly Part[] }) {
  return parts.map((part, n) =>
    part.hit ? (
      <mark key={n} className={s.hit}>
        {part.text}
      </mark>
    ) : (
      <Fragment key={n}>{part.text}</Fragment>
    ),
  )
}

/* oxlint-disable jsx-a11y/prefer-tag-over-role, jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus -- a
 * listbox the field owns, as the finder's: focus stays in the field, which takes the keys; a press on a row opens it. */

/** The finder's field and rows at a menu's size: ↑ ↓ move, Enter opens, Escape shuts (the popover's own). */
function Search({
  mark,
  asides,
  older,
  current,
  coordinatorWords = [],
  t,
  kbd,
  onClearOlder,
  onChoose,
}: {
  mark: ReactNode
  asides: readonly Aside[]
  older: readonly Aside[]
  current: string | null
  coordinatorWords?: readonly string[]
  t: AsideTabsText
  kbd?: string
  onClearOlder?: (ids: readonly string[]) => void
  onChoose: (id: string | null) => void
}) {
  const [query, setQuery] = useState('')
  // The row the keys are on, by the conversation it is of: a list that changes under it (a conversation at work moves up, one is
  // cleared) keeps the keys on the same one while it is there.
  const [active, setActive] = useState<string | null>(null)
  const rows = rowsOf(asides, older, coordinatorWords, t, query)
  const typed = query.trim() !== ''
  // With nothing typed, the keys start on the conversation open; with words, on what they found first.
  const here = rows.findIndex((row) => row.id === current)
  const held = active === null ? -1 : rows.findIndex((row) => keyOf(row) === active)
  const at = held >= 0 ? held : !typed && here >= 0 ? here : 0
  const list = useRef<HTMLDivElement>(null)
  const ids = useId()
  // The row the keys are on is always in sight: as the search opens on a conversation far down the list, as words filter it,
  // and as the arrows move. Not for a row the pointer chose, which is under it already.
  const pointed = useRef<string | null>(null)
  const atKey = rows[at] === undefined ? null : keyOf(rows[at])
  useLayoutEffect(() => {
    if (atKey === null || pointed.current === atKey) return
    list.current?.querySelector(`#${CSS.escape(`${ids}-${atKey}`)}`)?.scrollIntoView({ block: 'nearest' })
  }, [atKey, ids])
  const move = (to: number) => {
    const row = rows[to]
    if (row === undefined) return
    pointed.current = null
    setActive(keyOf(row))
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'ArrowDown') move(Math.min(at + 1, rows.length - 1))
    else if (event.key === 'ArrowUp') move(Math.max(at - 1, 0))
    else if (event.key === 'Enter') {
      const row = rows[at]
      if (row !== undefined) onChoose(row.id)
    } else return
    event.preventDefault()
  }
  return (
    <>
      <div className={s.field}>
        <Icon name="search" size={14} />
        <input
          type="text"
          role="combobox"
          aria-label={t.search}
          placeholder={t.search}
          aria-expanded
          aria-controls={`${ids}-list`}
          aria-autocomplete="list"
          aria-activedescendant={atKey === null ? undefined : `${ids}-${atKey}`}
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            pointed.current = null
            setActive(null)
          }}
          onKeyDown={onKeyDown}
        />
        {kbd !== undefined && <Kbd>{kbd}</Kbd>}
      </div>
      <div ref={list} id={`${ids}-list`} role="listbox" aria-label={t.label} className={s.list}>
        {rows.map((row, index) => (
          <Fragment key={keyOf(row)}>
            {!typed && row.older && rows[index - 1]?.older !== true && (
              <div className={s.group}>
                <span>{t.older(older.length)}</span>
                {onClearOlder !== undefined && (
                  <button type="button" onClick={() => onClearOlder(older.map((one) => one.id))}>
                    {t.clearOlder(older.length)}
                  </button>
                )}
              </div>
            )}
            {row.id === 'new' && typed && index === 0 && <p className={s.none}>{t.noneFound(query.trim())}</p>}
            {row.id === 'new' && <div className={s.rule} aria-hidden />}
            <div
              id={`${ids}-${keyOf(row)}`}
              role="option"
              aria-selected={index === at}
              data-current={row.id === current || undefined}
              className={s.row}
              onMouseDown={(event) => event.preventDefault()}
              onMouseMove={() => {
                if (index !== at) {
                  pointed.current = keyOf(row)
                  setActive(keyOf(row))
                }
              }}
              onClick={() => onChoose(row.id)}
            >
              <span className={s.lead}>
                {row.id === null ? mark : row.id === 'new' ? <Icon name="plus" size={13} /> : row.running ? <LiveDot pulse /> : null}
              </span>
              <span className={s.text}>
                <span className={s.rowName} data-new={row.untitled || undefined}>
                  <Parts parts={row.name} />
                </span>
                {row.said !== null && (
                  <span className={s.said}>
                    <Parts parts={row.said} />
                  </span>
                )}
              </span>
              {row.ago !== undefined && <span className={s.ago}>{row.ago}</span>}
              <span className={s.check}>{row.id === current && <Icon name="check" size={12} />}</span>
            </div>
          </Fragment>
        ))}
      </div>
    </>
  )
}

/* oxlint-enable jsx-a11y/prefer-tag-over-role, jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus */

export interface AsideMovesText {
  makeTask: string
}

export const asideMovesText: AsideMovesText = {
  makeTask: 'Make it a task',
}

export type AsideMovesProps = RootProps<
  'div',
  {
    /** Moves it to the board, as work: it leaves the asides at once. */
    onMakeTask: () => void
    /** A quiet word at the end: when it was asked, or what it quotes. */
    note?: ReactNode
    text?: Partial<AsideMovesText>
  }
>

/** An open aside's move to the board, over its composer, where the person is when they have read the answer; its pill clears it. */
export function AsideMoves({ onMakeTask, note, text, className, ...rest }: AsideMovesProps) {
  const t = { ...asideMovesText, ...text }
  return (
    <div className={cx(s.moves, className)} {...rest}>
      <Button size="small" variant="quiet" icon="work" onClick={onMakeTask}>
        {t.makeTask}
      </Button>
      {note !== undefined && <span className={s.note}>{note}</span>}
    </div>
  )
}
