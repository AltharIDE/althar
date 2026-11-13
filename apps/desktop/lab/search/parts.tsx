import { type CSSProperties, type KeyboardEvent, type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { Icon, Kbd, ProjectMark } from '@althar/ui'

import type { Entry, Found } from './index'
import { projectInk, projectName, titleParts } from './index'
import type { Part } from './match'
import { close, open, useGlide } from './morph'
import s from './search.module.css'

/*
 * What the three directions share: the box over the window (a modal dialog,
 * the field holding focus throughout, a combobox over a listbox), a row as
 * search draws one, and the list's keys. Each direction lays its rows out
 * its own way.
 */

const cx = (...names: ReadonlyArray<string | false | undefined | null>) => names.filter(Boolean).join(' ')

export const isMac = /Mac/.test(navigator.platform)
export const MOD = isMac ? '⌘' : 'Ctrl'
export const ENTER = isMac ? '↵' : 'Enter'

/** The words, the matched ones darker. */
export function Marked({ parts }: { parts: ReadonlyArray<Part> }) {
  return (
    <>
      {parts.map((part, n) =>
        part.hit ? (
          <mark key={n} className={s.hit}>
            {part.text}
          </mark>
        ) : (
          <span key={n}>{part.text}</span>
        ),
      )}
    </>
  )
}

/** Whether a row names its project: where search crosses projects, or it is from another than the one search is in. */
export const shows = (crossing: boolean | string, project: string | undefined) =>
  project !== undefined && (crossing === true || (typeof crossing === 'string' && crossing !== project))

export function ProjectTag({ id }: { id: string }) {
  return (
    <span className={s.project}>
      <ProjectMark seed={id} ink={projectInk(id)} size={12} />
      {projectName(id)}
    </span>
  )
}

const WHO = { you: 'You', lead: 'Lead', coordinator: 'Coordinator' } as const
export const whoOf = (entry: Entry) => (entry.who === undefined ? undefined : WHO[entry.who])

export const agoOf = (minutes: number | undefined) => {
  if (minutes === undefined) return ''
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))}m ago`
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)}h ago`
  return `${Math.round(minutes / (24 * 60))}d ago`
}

/** One selectable row of a list, as the list's keys know it. */
export interface Item {
  readonly key: string
  readonly run: () => void
}

/**
 * The box: over the window, focus in its field, closed by Escape (once the
 * direction has nothing to step back from) or a press outside. One that
 * `fit`s is as tall as what it lists, up to most of the window; one that
 * `moves` grows open, glides to each new height and fades as it closes.
 */
export function Box({
  label,
  width,
  height,
  onClose,
  children,
  fit = false,
  moves = false,
  className,
}: {
  label: string
  width?: number
  height?: number
  onClose: () => void
  children: ReactNode
  fit?: boolean
  moves?: boolean
  className?: string
}) {
  const [opener] = useState(() => document.activeElement)
  const box = useRef<HTMLDivElement>(null)
  const scrim = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  useEffect(
    () => () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    },
    [opener],
  )
  useLayoutEffect(() => {
    if (!moves) return
    const drawn = box.current
    const behind = scrim.current
    open(drawn, behind)
    return () => close(drawn, behind)
  }, [moves])
  useGlide(box, inner)
  return createPortal(
    <>
      <div
        ref={scrim}
        className={s.overlay}
        onPointerDown={(event) => {
          event.preventDefault()
          onClose()
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        ref={box}
        className={cx('ch-root', s.dialog, fit && s.fit, className)}
        style={
          {
            ...(width === undefined ? {} : { '--width': `${width}px` }),
            ...(height === undefined ? {} : { '--height': `${height}px` }),
          } as CSSProperties
        }
      >
        {fit ? (
          <div ref={inner} className={s.inner}>
            {children}
          </div>
        ) : (
          children
        )}
      </div>
    </>,
    document.body,
  )
}

/** The list's keys, for a field that keeps focus: where the selection is among `items`, and moving it. */
export const useList = (items: ReadonlyArray<Item>, reset: unknown, prefer?: string | null) => {
  const [active, setActive] = useState(0)
  const ids = useId()
  const list = useRef<HTMLDivElement>(null)
  const latest = useRef({ items, prefer })
  latest.current = { items, prefer }
  // New words start at the top, or on the row asked for (where a step back returns); before it is drawn.
  useLayoutEffect(() => {
    const { items: now, prefer: wanted } = latest.current
    const at = wanted == null ? -1 : now.findIndex((one) => one.key === wanted)
    setActive(Math.max(at, 0))
  }, [reset])
  const at = Math.min(active, Math.max(items.length - 1, 0))
  const idOf = (key: string) => `${ids}-${key.replace(/[^a-zA-Z0-9_-]/g, '_')}`
  const move = (to: number) => {
    const next = Math.max(0, Math.min(items.length - 1, to))
    setActive(next)
    const item = items[next]
    if (item !== undefined) list.current?.querySelector(`#${CSS.escape(idOf(item.key))}`)?.scrollIntoView({ block: 'nearest' })
  }
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return false
    if (event.key === 'ArrowDown') move(at + 1)
    else if (event.key === 'ArrowUp') move(at - 1)
    else if (event.key === 'PageDown') move(at + 8)
    else if (event.key === 'PageUp') move(at - 8)
    else if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) items[at]?.run()
    else return false
    event.preventDefault()
    return true
  }
  const selected = items[at]
  return {
    at,
    selected,
    list,
    listId: `${ids}-list`,
    idOf,
    onKey,
    setActive,
    isSelected: (key: string) => selected?.key === key,
    hover: (key: string) => {
      const index = items.findIndex((one) => one.key === key)
      if (index >= 0 && index !== at) setActive(index)
    },
  }
}

export type List = ReturnType<typeof useList>

/** The field: an icon, what narrows it, the words. */
export function Field({
  value,
  onChange,
  onKeyDown,
  placeholder,
  list,
  before,
  after,
  inputRef,
  bare = false,
  className,
}: {
  value: string
  onChange: (value: string) => void
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
  placeholder: string
  list: List
  before?: ReactNode
  after?: ReactNode
  inputRef?: React.RefObject<HTMLInputElement | null>
  /** Without the search icon, the words first, as Linear's. */
  bare?: boolean
  className?: string
}) {
  const own = useRef<HTMLInputElement>(null)
  const ref = inputRef ?? own
  useEffect(() => ref.current?.focus(), [ref])
  return (
    <div className={cx(s.field, className)}>
      {!bare && <Icon name="search" size={15} />}
      {before}
      <input
        ref={ref}
        type="text"
        role="combobox"
        aria-label={placeholder}
        placeholder={placeholder}
        aria-expanded={list.selected !== undefined}
        aria-controls={list.listId}
        aria-autocomplete="list"
        aria-activedescendant={list.selected === undefined ? undefined : list.idOf(list.selected.key)}
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
      {after}
    </div>
  )
}

/** A row: its icon, its name with what matched darker, quieter facts, where it stands and its key. */
export function Row({
  list,
  item,
  icon,
  title,
  facts,
  stand,
  end,
  passage,
  className,
  danger,
  move = false,
}: {
  list: List
  item: Item
  icon: ReactNode
  title: ReactNode
  facts?: ReactNode
  stand?: Entry['stand']
  end?: ReactNode
  passage?: ReactNode
  className?: string
  danger?: boolean
  /** Moves as part of its list (the kit's ListMotion), known by its key. */
  move?: boolean
}) {
  const selected = list.isSelected(item.key)
  return (
    <div
      {...(move ? { 'data-move': item.key } : {})}
      id={list.idOf(item.key)}
      role="option"
      aria-selected={selected}
      className={cx(s.row, danger === true && s.danger, className)}
      // A press opens it; focus stays in the field, which owns the keys.
      onMouseDown={(event) => event.preventDefault()}
      onMouseMove={() => list.hover(item.key)}
      onClick={item.run}
    >
      <span className={s.icon}>{icon}</span>
      <span className={s.main}>
        <span className={s.title} data-title="">
          {title}
        </span>
        {facts !== undefined && <span className={s.facts}>{facts}</span>}
      </span>
      <span className={s.end}>
        {stand !== undefined && <span className={cx(s.state, stand.tone !== 'quiet' && s[stand.tone])}>{stand.word}</span>}
        {end}
      </span>
      {passage}
    </div>
  )
}

/** An entry's usual row: icon, title, project where it crosses projects, facts, where it stands, its shortcut. */
export function EntryRow({
  list,
  found,
  entry,
  item,
  crossing,
  className,
  passage = true,
  end,
  move = false,
}: {
  list: List
  found?: Found
  entry: Entry
  item: Item
  /** The project search opened in, or null where it crosses them all: a row from any other names its project. */
  crossing: boolean | string
  className?: string
  passage?: boolean
  end?: ReactNode
  move?: boolean
}) {
  const title = found === undefined ? entry.title : <Marked parts={titleParts(found)} />
  const said = entry.kind === 'said' || entry.kind === 'note'
  return (
    <Row
      list={list}
      item={item}
      className={className}
      move={move}
      danger={entry.danger === true}
      icon={<Icon name={entry.icon} size={14} />}
      title={said ? found?.passage == null ? entry.title : <Marked parts={found.passage} /> : title}
      facts={
        <>
          {said && whoOf(entry) !== undefined && <span className={s.who}>{whoOf(entry)}</span>}
          {shows(crossing, entry.project) && entry.project !== undefined && <ProjectTag id={entry.project} />}
          {/* under This task, the task's name on each of its actions says nothing */}
          {(entry.scope === 'task' && found === undefined ? [] : (entry.facts ?? [])).map((fact) => (
            <span key={fact} className={entry.kind === 'file' && fact.includes('/') ? s.mono : /^#|^DEV-/.test(fact) ? s.num : undefined}>
              {fact}
            </span>
          ))}
        </>
      }
      {...(entry.stand === undefined ? {} : { stand: entry.stand })}
      end={
        <>
          {entry.shortcut !== undefined && <Kbd>{entry.shortcut}</Kbd>}
          {end}
        </>
      }
      passage={
        passage && !said && found?.passage != null ? (
          <span className={s.passage}>
            <Marked parts={found.passage} />
          </span>
        ) : undefined
      }
    />
  )
}

export function Label({ children, count, more, move }: { children: ReactNode; count?: number; more?: ReactNode; move?: string }) {
  return (
    <div className={s.label} aria-hidden="true" data-label="" {...(move === undefined ? {} : { 'data-move': move })}>
      {children}
      {count !== undefined && <span className={s.labelCount}>{count}</span>}
      {more !== undefined && <span className={s.labelMore}>{more}</span>}
    </div>
  )
}

/** The keys at the foot, each a key and a word. */
export function Foot({ keys, end }: { keys: ReadonlyArray<readonly [ReadonlyArray<string>, string]>; end?: ReactNode }) {
  return (
    <div className={s.foot} aria-hidden="true">
      {keys.map(([pressed, word]) => (
        <span key={word}>
          {pressed.map((one) => (
            <Kbd key={one}>{one}</Kbd>
          ))}{' '}
          {word}
        </span>
      ))}
      {end !== undefined && <span className={s.footEnd}>{end}</span>}
    </div>
  )
}

export { cx, s }
