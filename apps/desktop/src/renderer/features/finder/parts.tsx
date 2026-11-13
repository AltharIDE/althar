import { type CSSProperties, type KeyboardEvent, type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'

import { Icon, Kbd, SearchDialog } from '@althar/ui'

import type { Entry, Found } from './model'
import { titleParts } from './model'
import type { Part } from './match'
import { clearFlights, close, open, useGlide } from './morph'
import s from './search.module.css'

/*
 * The palette's parts: the box over the window (a modal dialog, the field
 * holding focus throughout, a combobox over a listbox), a row as search draws
 * one, and the list's keys.
 */

const cx = (...names: ReadonlyArray<string | false | undefined | null>) => names.filter(Boolean).join(' ')

const isMac = /Mac/.test(navigator.platform)
export const ENTER = isMac ? '↵' : 'Enter'

/** The words, the matched ones darker. */
function Marked({ parts }: { parts: ReadonlyArray<Part> }) {
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

const WHO = { you: 'You', lead: 'Lead', coordinator: 'Coordinator' } as const
const whoOf = (entry: Entry) => (entry.who === undefined ? undefined : WHO[entry.who])

/** One selectable row of a list, as the list's keys know it. */
export interface Item {
  readonly key: string
  readonly run: () => void
}

/**
 * The box: over the window, focus in its field, closed by Escape (once there
 * is nothing to step back from) or a press outside. One that `fit`s is as
 * tall as what it lists, up to most of the window. It grows open, glides to
 * each new height and fades as it closes.
 */
export function Box({
  label,
  width,
  height,
  onClose,
  children,
  fit = false,
  className,
}: {
  label: string
  width?: number
  height?: number
  onClose: () => void
  children: ReactNode
  fit?: boolean
  className?: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const scrim = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const drawn = box.current
    const behind = scrim.current
    open(drawn, behind)
    return () => {
      clearFlights()
      close(drawn, behind)
    }
  }, [])
  useGlide(box, inner)
  return (
    <SearchDialog
      title={label}
      onClose={onClose}
      box={box}
      scrim={scrim}
      className={cx('ch-root', s.dialog, fit && s.fit, className)}
      overlayClassName={cx('ch-root', s.overlay)}
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
    </SearchDialog>
  )
}

/** The list's keys, for a field that keeps focus: where the selection is among `items`, and moving it. */
export const useList = (items: ReadonlyArray<Item>, reset: unknown, prefer?: string | null) => {
  const [selection, select] = useState<{ reset: unknown; key: string | null }>({ reset, key: null })
  const ids = useId()
  const list = useRef<HTMLDivElement>(null)
  const wanted = selection.reset === reset ? selection.key : prefer
  const found = wanted == null ? -1 : items.findIndex((one) => one.key === wanted)
  const at = Math.max(found, 0)
  const idOf = (key: string) => `${ids}-${encodeURIComponent(key)}`
  const move = (to: number) => {
    const next = Math.max(0, Math.min(items.length - 1, to))
    const item = items[next]
    select({ reset, key: item?.key ?? null })
    if (item !== undefined) list.current?.querySelector(`#${CSS.escape(idOf(item.key))}`)?.scrollIntoView({ block: 'nearest' })
  }
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return false
    if (event.key === 'ArrowDown') move(at + 1)
    else if (event.key === 'ArrowUp') move(at - 1)
    else if (event.key === 'PageDown') move(at + 8)
    else if (event.key === 'PageUp') move(at - 8)
    else if (event.key === 'Home') move(0)
    else if (event.key === 'End') move(items.length - 1)
    else if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) items[at]?.run()
    else return false
    event.preventDefault()
    return true
  }
  const selected = items[at]
  // The first row is chosen by name, not by place: a row that comes in above
  // it later (a task's Allow or Merge, read after the list shows) doesn't take the choice.
  const pinned = selected !== undefined && (selection.reset !== reset || selection.key === null) ? selected.key : null
  useLayoutEffect(() => {
    if (pinned !== null) select({ reset, key: pinned })
  }, [reset, pinned])
  return {
    at,
    selected,
    list,
    listId: `${ids}-list`,
    idOf,
    onKey,
    isSelected: (key: string) => selected?.key === key,
    hover: (key: string) => {
      if (items.some((one) => one.key === key)) select({ reset, key })
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
  label,
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
  label?: string
}) {
  const selected = list.isSelected(item.key)
  return (
    <div
      data-row={item.key}
      id={list.idOf(item.key)}
      role="option"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Enter') item.run()
      }}
      aria-label={label ?? (typeof title === 'string' ? title : undefined)}
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
}) {
  const title = found === undefined ? entry.title : <Marked parts={titleParts(found)} />
  const said = entry.kind === 'said' || entry.kind === 'note'
  return (
    <Row
      list={list}
      item={item}
      className={className}
      label={[entry.title, ...(entry.facts ?? []), shows(crossing, entry.project) ? entry.projectName : '', entry.stand?.word]
        .filter(Boolean)
        .join(' · ')}
      danger={entry.danger === true}
      icon={<Icon name={entry.icon} size={14} />}
      title={said ? found?.passage == null ? entry.title : <Marked parts={found.passage} /> : title}
      facts={
        <>
          {said && whoOf(entry) !== undefined && <span className={s.who}>{whoOf(entry)}</span>}
          {shows(crossing, entry.project) && <span className={s.project}>{entry.projectName}</span>}
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

export function Label({ children, count, more }: { children: ReactNode; count?: number; more?: ReactNode }) {
  return (
    <div className={s.label} aria-hidden="true" data-label="">
      {children}
      {count !== undefined && <span className={s.labelCount}>{count}</span>}
      {more !== undefined && <span className={s.labelMore}>{more}</span>}
    </div>
  )
}

export { cx, s }
