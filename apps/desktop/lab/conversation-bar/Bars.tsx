import {
  Fragment,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { createPortal } from 'react-dom'

import {
  type Aside,
  AsideTabs as TodayTabs,
  type AsideTabsProps,
  asideTabsText,
  type AsideTabsText,
  Icon,
  IconButton,
  Kbd,
  LiveDot,
  Menu,
  MenuGroup,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  Popover,
  ProjectHeader as TodayHeader,
  type ProjectHeaderProps,
  Tooltip,
} from '@althar/ui'

import { asideAgo, wordsOf } from './data'
import { useLab } from './state'
import s from './bars.module.css'

/*
 * Each direction's bar over the coordinator's conversation, in AsideTabs'
 * place and with its props, so it runs on the app's own asides: + starts one
 * for real, the × clears it, and the older ones fold into "N older". D draws
 * the conversations in the project's row instead (ProjectHeader below), and
 * nothing over the conversation.
 */

const cx = (...names: ReadonlyArray<string | false | null | undefined>) => names.filter(Boolean).join(' ')

/** What every direction draws from. */
interface Bar {
  readonly mark: ReactNode
  /** The asides with a tab: the recent ones, and an older one while it is open. */
  readonly shown: readonly Aside[]
  readonly asides: readonly Aside[]
  readonly older: readonly Aside[]
  readonly current: string | null
  readonly onPick: (id: string | null) => void
  readonly onNew: () => void
  readonly onClear?: ((id: string) => void) | undefined
  readonly onClearOlder?: ((ids: readonly string[]) => void) | undefined
  readonly t: AsideTabsText
}

/** A direction's props: what it draws from, and the app's ref on its root (for an aside's flight to the board). */
interface Direction {
  readonly bar: Bar
  readonly root: Ref<HTMLDivElement> | undefined
}

const nameOf = (aside: Aside, t: AsideTabsText) => aside.title || t.newAside

// ?open=<aside's slug> opens that aside once, ?new=1 starts one, ?menu=1 opens C's menu (or C again's search), ?q= types in
// that search: for screenshots of each state.
const scene = new URLSearchParams(window.location.search)
let staged = false

export function AsideTabs(props: AsideTabsProps) {
  const { d } = useLab()
  const { mark, asides, older = [], current, onPick, onNew, onClear, onClearOlder, text, ref } = props
  useEffect(() => {
    if (staged) return
    staged = true
    const open = scene.get('open')
    if (open !== null) onPick(`t_${open}`)
    if (scene.get('new') === '1') onNew()
  })
  if (d === 'today') return <TodayTabs {...props} />
  const t = { ...asideTabsText, ...text }
  const bar: Bar = {
    mark,
    shown: [...asides, ...older.filter((one) => one.id === current)],
    asides,
    older,
    current,
    onPick,
    onNew,
    onClear,
    onClearOlder,
    t,
  }
  switch (d) {
    case 'a':
      return <Segmented bar={bar} root={ref} />
    case 'b':
      return <Underline bar={bar} root={ref} />
    case 'c':
      return <HeadingMenu bar={bar} root={ref} />
    case 'd':
      return <InProjectRow bar={bar} root={ref} />
    case 'e':
      return <FolderTabs bar={bar} root={ref} />
    case 'c1':
      return <SearchHeading bar={bar} root={ref} />
    case 'c2':
      return <Recents bar={bar} root={ref} />
    case 'c3':
      return <LaneHeading bar={bar} root={ref} />
    case 'c4':
      return <PanelHeading bar={bar} root={ref} />
  }
}

/* ---------- What the directions share ---------- */

/**
 * How many of `total` things fit their place: they are drawn, and while they overflow it one fewer is, before the frame
 * is painted; the place grown, all are tried again. `key` names what they are, so new ones are all tried.
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
  useLayoutEffect(() => {
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
  return { ref, count }
}

/**
 * As many asides' tabs as fit, the open one always among them, the rest in "N more". Only with no other tab left does the
 * open one give way, down to its least.
 */
function useFit(bar: Bar) {
  const others = bar.shown.filter((one) => one.id !== bar.current)
  const key = `${bar.shown.map((one) => `${one.id}:${one.title}`).join('|')}#${bar.current ?? ''}`
  const { ref, count } = useFitCount(key, others.length)
  const kept = new Set(others.slice(0, count).map((one) => one.id))
  return {
    ref,
    visible: bar.shown.filter((one) => one.id === bar.current || kept.has(one.id)),
    hidden: others.filter((one) => !kept.has(one.id)),
    squeezed: count === 0 || undefined,
  }
}

/** "N more", for the asides that don't fit, with the older ones under them; "N older" alone where every recent one fits. */
function More({ bar, hidden, className }: { bar: Bar; hidden: readonly Aside[]; className: string | undefined }) {
  const { older, onPick, onClearOlder, t } = bar
  if (hidden.length === 0) return <Older bar={bar} className={className} chevron />
  const running = hidden.some((one) => one.running === true)
  return (
    <Menu
      label={`${hidden.length} more`}
      align="end"
      width={320}
      trigger={
        <button type="button" className={className}>
          {running && <LiveDot pulse />}
          {hidden.length} more
          <Icon name="chevronD" size={10} />
        </button>
      }
    >
      {hidden.map((aside) => (
        <MenuItem
          key={aside.id}
          lead={aside.running === true ? <LiveDot pulse /> : <span className={s.cNoDot} />}
          hint={asideAgo(aside.id)}
          onSelect={() => onPick(aside.id)}
        >
          <span className={s.cItem}>{nameOf(aside, t)}</span>
        </MenuItem>
      ))}
      {older.length > 0 && (
        <MenuGroup label={t.older(older.length)}>
          {older.map((aside) => (
            <MenuItem key={aside.id} lead={<span className={s.cNoDot} />} hint={asideAgo(aside.id)} onSelect={() => onPick(aside.id)}>
              {aside.title}
            </MenuItem>
          ))}
          {onClearOlder !== undefined && (
            <MenuItem lead={<span className={s.cNoDot} />} onSelect={() => onClearOlder(older.map((aside) => aside.id))}>
              {t.clearOlder(older.length)}
            </MenuItem>
          )}
        </MenuGroup>
      )}
    </Menu>
  )
}

function Clear({ aside, bar, className }: { aside: Aside; bar: Bar; className: string | undefined }) {
  const { onClear, t } = bar
  if (onClear === undefined) return null
  return (
    <Tooltip label={t.clear}>
      <button type="button" className={className} aria-label={t.clearOne(nameOf(aside, t))} onClick={() => onClear(aside.id)}>
        <Icon name="close" size={9} />
      </button>
    </Tooltip>
  )
}

/** "N older": the asides left a week, to open one, or clear them together. */
function Older({ bar, className, chevron = false }: { bar: Bar; className: string | undefined; chevron?: boolean }) {
  const { older, onPick, onClearOlder, t } = bar
  if (older.length === 0) return null
  return (
    <Menu
      label={t.older(older.length)}
      note={t.olderNote}
      align="end"
      trigger={
        <button type="button" className={className}>
          {t.older(older.length)}
          {chevron && <Icon name="chevronD" size={10} />}
        </button>
      }
    >
      {older.map((aside) => (
        <MenuItem key={aside.id} onSelect={() => onPick(aside.id)}>
          {aside.title}
        </MenuItem>
      ))}
      {onClearOlder !== undefined && (
        <>
          <MenuSeparator />
          <MenuItem onSelect={() => onClearOlder(older.map((aside) => aside.id))}>{t.clearOlder(older.length)}</MenuItem>
        </>
      )}
    </Menu>
  )
}

/** The coordinator's tab: its mark and its name, first, always in sight. */
function Coordinator({ bar, className }: { bar: Bar; className: string }) {
  return (
    <button type="button" role="tab" aria-selected={bar.current === null} className={className} onClick={() => bar.onPick(null)}>
      {bar.mark}
      <span className={s.title} data-text={bar.t.coordinator}>
        {bar.t.coordinator}
      </span>
    </button>
  )
}

/** An aside's tab and its ×, side by side (a button never holds another), each direction's classes on them. */
function AsideTab({
  aside,
  bar,
  cls,
}: {
  aside: Aside
  bar: Bar
  cls: { tab: string; inner: string | undefined; clear: string | undefined }
}) {
  const open = bar.current === aside.id
  const name = nameOf(aside, bar.t)
  return (
    <span className={cx(s.box, cls.tab)} data-aside={aside.id} data-current={open || undefined} data-new={aside.title === '' || undefined}>
      <button
        type="button"
        role="tab"
        aria-selected={open}
        className={cx(s.inner, cls.inner)}
        title={name}
        onClick={() => bar.onPick(aside.id)}
        onKeyDown={(event) => {
          if (bar.onClear === undefined || (event.key !== 'Delete' && event.key !== 'Backspace')) return
          event.preventDefault()
          bar.onClear(aside.id)
        }}
      >
        {aside.running === true && <LiveDot pulse />}
        <span className={s.title} data-text={name}>
          {name}
        </span>
      </button>
      <Clear aside={aside} bar={bar} className={cx(s.clear, cls.clear)} />
    </span>
  )
}

/** Every conversation, in a menu: the coordinator, the asides with a dot on those at work and when each was last spoken in, the older ones, and a new one. */
function ConversationsMenu({ bar, trigger }: { bar: Bar; trigger: ReactElement }) {
  const { t } = bar
  return (
    <Menu label={t.label} width={340} trigger={trigger} defaultOpen={scene.get('menu') === '1'}>
      <MenuRadioGroup
        label={t.label}
        value={bar.current ?? 'coordinator'}
        onChange={(value) => bar.onPick(value === 'coordinator' ? null : value)}
      >
        <MenuRadioItem value="coordinator" lead={bar.mark}>
          {t.coordinator}
        </MenuRadioItem>
        {bar.asides.map((aside) => (
          <MenuRadioItem
            key={aside.id}
            value={aside.id}
            lead={aside.running === true ? <LiveDot pulse /> : <span className={s.cNoDot} />}
            {...(asideAgo(aside.id) === null ? {} : { hint: asideAgo(aside.id) })}
          >
            <span className={s.cItem}>{nameOf(aside, t)}</span>
          </MenuRadioItem>
        ))}
      </MenuRadioGroup>
      {bar.older.length > 0 && (
        <MenuGroup label={t.older(bar.older.length)}>
          {bar.older.map((aside) => (
            <MenuItem key={aside.id} lead={<span className={s.cNoDot} />} onSelect={() => bar.onPick(aside.id)} hint={asideAgo(aside.id)}>
              {aside.title}
            </MenuItem>
          ))}
          {bar.onClearOlder !== undefined && (
            <MenuItem lead={<span className={s.cNoDot} />} onSelect={() => bar.onClearOlder?.(bar.older.map((aside) => aside.id))}>
              {t.clearOlder(bar.older.length)}
            </MenuItem>
          )}
        </MenuGroup>
      )}
      <MenuSeparator />
      <MenuItem icon="plus" onSelect={bar.onNew}>
        {t.add}
      </MenuItem>
    </Menu>
  )
}

/* ---------- A · Segmented: the room switch's track, the open one a white sheet on it ---------- */

function Segmented({ bar, root }: Direction) {
  const { ref, visible, hidden, squeezed } = useFit(bar)
  return (
    <div ref={root} className={cx(s.strip, s.a)}>
      <div ref={ref} className={s.fill} data-squeezed={squeezed}>
        <div className={s.aTrack} role="tablist" aria-label={bar.t.label}>
          <Coordinator bar={bar} className={cx(s.aSeg, s.aCoordinator)} />
          {visible.map((aside) => (
            <AsideTab key={aside.id} aside={aside} bar={bar} cls={{ tab: cx(s.aSeg, s.aAside), inner: s.aTab, clear: undefined }} />
          ))}
        </div>
        <More bar={bar} hidden={hidden} className={s.older} />
      </div>
      <IconButton icon="plus" size="small" label={bar.t.add} tooltipAlign="end" onClick={bar.onNew} />
    </div>
  )
}

/* ---------- B · Underline: words on the hairline, the open one in ink with a rule under it ---------- */

function Underline({ bar, root }: Direction) {
  const { ref, visible, hidden, squeezed } = useFit(bar)
  return (
    <div ref={root} className={cx(s.strip, s.b)}>
      <div ref={ref} className={cx(s.fill, s.bFill)} data-squeezed={squeezed}>
        <div className={s.bTabs} role="tablist" aria-label={bar.t.label}>
          <Coordinator bar={bar} className={cx(s.bTab, s.bCoordinator)} />
          {bar.shown.length > 0 && <span className={s.bRule} aria-hidden />}
          {visible.map((aside) => (
            <AsideTab key={aside.id} aside={aside} bar={bar} cls={{ tab: cx(s.bTab, s.bAside), inner: undefined, clear: s.bClear }} />
          ))}
        </div>
        <More bar={bar} hidden={hidden} className={s.older} />
      </div>
      <IconButton icon="plus" size="small" label={bar.t.add} tooltipAlign="end" onClick={bar.onNew} />
    </div>
  )
}

/* ---------- C · Heading and menu: one name, as a lane names itself, the rest in a menu ---------- */

function HeadingMenu({ bar, root }: Direction) {
  const { t } = bar
  const open = bar.shown.find((one) => one.id === bar.current) ?? null
  // Another aside at work: a dot by the chevron, so it isn't missed with the menu shut.
  const elsewhere = [...bar.asides, ...bar.older].some((one) => one.running === true && one.id !== bar.current)
  return (
    <div ref={root} className={cx(s.strip, s.c)}>
      {open !== null && (
        <>
          <button type="button" className={s.cCrumb} onClick={() => bar.onPick(null)}>
            {bar.mark}
            {t.coordinator}
          </button>
          <span className={s.cSlash} aria-hidden>
            /
          </span>
        </>
      )}
      <ConversationsMenu
        bar={bar}
        trigger={
          <button type="button" className={s.cTrigger} data-new={open?.title === '' || undefined}>
            {open === null ? bar.mark : open.running === true ? <LiveDot pulse /> : null}
            <span className={s.cTitle}>{open === null ? t.coordinator : nameOf(open, t)}</span>
            <Icon name="chevronD" size={12} />
            {elsewhere && <LiveDot pulse />}
          </button>
        }
      />
      <span className={s.gap} />
      {open !== null && bar.onClear !== undefined && (
        <IconButton icon="close" size="small" label={t.clearOne(nameOf(open, t))} onClick={() => bar.onClear?.(open.id)} />
      )}
      <IconButton icon="plus" size="small" label={t.add} tooltipAlign="end" onClick={bar.onNew} />
    </div>
  )
}

/* ---------- D · In the project's row: the conversations after the project's name, no bar over them ---------- */

/** The place in the project's row the conversations go, once the row is drawn. */
const slot = (() => {
  let node: HTMLElement | null = null
  const listeners = new Set<() => void>()
  return {
    get: () => node,
    set: (next: HTMLElement | null) => {
      node = next
      for (const listener of listeners) listener()
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
})()

export function ProjectHeader(props: ProjectHeaderProps) {
  const { d } = useLab()
  const wrap = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (d !== 'd') return
    // TitleBar's start: the project's mark and name, then the conversations.
    const start = wrap.current?.querySelector('header > div')
    if (start == null) return
    const place = document.createElement('div')
    place.className = s.dSlot ?? ''
    start.append(place)
    slot.set(place)
    return () => {
      slot.set(null)
      place.remove()
    }
  }, [d])
  return (
    <div ref={wrap} className={s.contents}>
      <TodayHeader {...props} />
    </div>
  )
}

function InProjectRow({ bar, root }: Direction) {
  const place = useSyncExternalStore(slot.subscribe, slot.get)
  const { ref, visible, hidden, squeezed } = useFit(bar)
  // The room the project's row leaves: short of it, as in the narrowest window, the conversations fold into one menu (C's).
  const [room, setRoom] = useState(Number.POSITIVE_INFINITY)
  useLayoutEffect(() => {
    if (place === null) return
    const sizes = new ResizeObserver(() => setRoom(place.clientWidth))
    sizes.observe(place)
    return () => sizes.disconnect()
  }, [place])
  if (place === null) return null
  if (room < 300) {
    const open = bar.shown.find((one) => one.id === bar.current) ?? null
    const elsewhere = [...bar.asides, ...bar.older].some((one) => one.running === true && one.id !== bar.current)
    return createPortal(
      <div ref={root} className={s.d}>
        <span className={s.dSlash} aria-hidden>
          /
        </span>
        <ConversationsMenu
          bar={bar}
          trigger={
            <button type="button" className={cx(s.dTab, s.dFolded)} data-new={open?.title === '' || undefined}>
              {open === null ? bar.mark : open.running === true ? <LiveDot pulse /> : null}
              <span className={s.title}>{open === null ? bar.t.coordinator : nameOf(open, bar.t)}</span>
              <Icon name="chevronD" size={12} />
              {elsewhere && <LiveDot pulse />}
            </button>
          }
        />
        <IconButton icon="plus" size="small" label={bar.t.add} tooltip="below" onClick={bar.onNew} />
      </div>,
      place,
    )
  }
  return createPortal(
    <div ref={root} className={s.d}>
      <span className={s.dSlash} aria-hidden>
        /
      </span>
      <div ref={ref} className={s.fill} data-squeezed={squeezed}>
        <div className={s.dTabs} role="tablist" aria-label={bar.t.label}>
          <Coordinator bar={bar} className={cx(s.dTab, s.dCoordinator)} />
          {visible.map((aside) => (
            <AsideTab key={aside.id} aside={aside} bar={bar} cls={{ tab: cx(s.dTab, s.dAside), inner: s.dInner, clear: undefined }} />
          ))}
        </div>
        <More bar={bar} hidden={hidden} className={s.older} />
      </div>
      <IconButton icon="plus" size="small" label={bar.t.add} tooltip="below" onClick={bar.onNew} />
    </div>,
    place,
  )
}

/* ---------- E · Folder tabs: the open conversation's tab is the top of its sheet ---------- */

function FolderTabs({ bar, root }: Direction) {
  const { ref, visible, hidden, squeezed } = useFit(bar)
  return (
    <div ref={root} className={s.e}>
      <div ref={ref} className={cx(s.fill, s.eFill)} data-squeezed={squeezed}>
        <div className={s.eTabs} role="tablist" aria-label={bar.t.label}>
          <Coordinator bar={bar} className={cx(s.eTab, s.eCoordinator)} />
          {visible.map((aside) => (
            <AsideTab key={aside.id} aside={aside} bar={bar} cls={{ tab: cx(s.eTab, s.eAside), inner: s.eInner, clear: undefined }} />
          ))}
        </div>
        <span className={s.eEnd}>
          <More bar={bar} hidden={hidden} className={s.older} />
        </span>
      </div>
      <span className={s.eEnd}>
        <IconButton icon="plus" size="small" label={bar.t.add} tooltipAlign="end" onClick={bar.onNew} />
      </span>
    </div>
  )
}

/* ---------- C again: what 1–4 share, a search over every conversation ---------- */

/** A stretch of a name or of what was said: the words that begin with what was typed are `hit`. */
interface Part {
  readonly text: string
  readonly hit: boolean
}

/** A conversation as the search lists it, or the new aside at its foot. */
interface Row {
  readonly key: string
  /** null for the coordinator's. */
  readonly id: string | null
  readonly kind: 'coordinator' | 'aside' | 'new'
  readonly name: string
  readonly untitled: boolean
  readonly running: boolean
  readonly older: boolean
  readonly ago: string | null
  /** What was said last in it, its first line. */
  readonly said: string | undefined
  readonly nameParts: readonly Part[]
  /** What was said that matched, where its name doesn't hold every word typed. */
  readonly matched: readonly Part[] | null
  readonly byName: boolean
}

const WORD = /[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu
const tokensOf = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean)
const holds = (text: string, token: string) => [...text.matchAll(WORD)].some((word) => word[0].toLowerCase().startsWith(token))

/** A text in parts, the words that begin with one of the tokens marked. */
const partsOf = (text: string, tokens: readonly string[]): Part[] => {
  const parts: Part[] = []
  let at = 0
  for (const match of text.matchAll(WORD)) {
    const word = match[0]
    if (!tokens.some((token) => word.toLowerCase().startsWith(token))) continue
    if (match.index > at) parts.push({ text: text.slice(at, match.index), hit: false })
    parts.push({ text: word, hit: true })
    at = match.index + word.length
  }
  if (at < text.length) parts.push({ text: text.slice(at), hit: false })
  return parts
}

/** A line from a few words before its first match, so the match is in sight. */
const around = (line: string, tokens: readonly string[]): Part[] => {
  const words = [...line.matchAll(WORD)]
  const first = words.findIndex((word) => tokens.some((token) => word[0].toLowerCase().startsWith(token)))
  const from = first > 4 ? (words[first - 3]?.index ?? 0) : 0
  return partsOf(from > 0 ? `…${line.slice(from)}` : line, tokens)
}

/**
 * Every conversation, as the search lists it: with nothing typed the coordinator's, the asides latest first and the older
 * ones; with words typed those whose name or whose words hold them all, those by name first. The new aside at the foot.
 */
function rowsOf(bar: Bar, query: string): Row[] {
  const tokens = tokensOf(query)
  const everyone = [
    {
      id: null,
      kind: 'coordinator' as const,
      name: bar.t.coordinator,
      untitled: false,
      running: false,
      older: false,
      said: wordsOf(null).at(-1),
    },
    ...[...bar.asides.map((one) => ({ one, older: false })), ...bar.older.map((one) => ({ one, older: true }))].map(({ one, older }) => ({
      id: one.id,
      kind: 'aside' as const,
      name: nameOf(one, bar.t),
      untitled: one.title === '',
      running: one.running === true,
      older,
      said: one.said,
    })),
  ]
  const rows: Row[] = []
  for (const one of everyone) {
    const base = { ...one, key: one.id ?? 'coordinator', ago: one.id === null ? null : asideAgo(one.id) }
    if (tokens.length === 0) {
      rows.push({ ...base, nameParts: [{ text: one.name, hit: false }], matched: null, byName: true })
      continue
    }
    const words = wordsOf(one.id)
    const missing = tokens.filter((token) => !holds(one.name, token))
    if (missing.some((token) => !words.some((line) => holds(line, token)))) continue
    const line = missing.length === 0 ? undefined : words.find((said) => missing.some((token) => holds(said, token)))
    rows.push({
      ...base,
      nameParts: partsOf(one.name, tokens),
      matched: line === undefined ? null : around(line, tokens),
      byName: missing.length === 0,
    })
  }
  if (tokens.length > 0) rows.sort((a, b) => Number(b.byName) - Number(a.byName))
  const add = bar.t.add
  rows.push({
    key: 'new',
    id: null,
    kind: 'new',
    name: add,
    untitled: false,
    running: false,
    older: false,
    ago: null,
    said: undefined,
    nameParts: [{ text: add, hit: false }],
    matched: null,
    byName: true,
  })
  return rows
}

/** The search's words, the row the keys are on, and what a row does when chosen: the field keeps focus throughout. */
function useSearch(bar: Bar, close: () => void) {
  const [query, setQuery] = useState(scene.get('q') ?? '')
  const [active, setActive] = useState<number | null>(null)
  const rows = rowsOf(bar, query)
  // With nothing typed, the keys start on the conversation open; with words, on what they found first.
  const here = rows.findIndex((row) => row.kind !== 'new' && row.id === bar.current)
  const at = Math.min(active ?? (query.trim() === '' && here >= 0 ? here : 0), rows.length - 1)
  const list = useRef<HTMLDivElement>(null)
  const ids = useId()
  const choose = (row: Row) => {
    close()
    if (row.kind === 'new') bar.onNew()
    else bar.onPick(row.id)
  }
  const move = (to: number) => {
    setActive(to)
    list.current?.querySelector(`#${CSS.escape(`${ids}-${to}`)}`)?.scrollIntoView({ block: 'nearest' })
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'ArrowDown') move(Math.min(at + 1, rows.length - 1))
    else if (event.key === 'ArrowUp') move(Math.max(at - 1, 0))
    else if (event.key === 'Enter') {
      const row = rows[at]
      if (row !== undefined) choose(row)
    } else return
    event.preventDefault()
  }
  const type = (words: string) => {
    setQuery(words)
    setActive(null)
  }
  return { query, type, rows, at, setActive, choose, onKeyDown, list, ids }
}
type Search = ReturnType<typeof useSearch>

/** ⌘J, from anywhere in the window: opens the conversations' search, or shuts it. */
function useJump(toggle: () => void) {
  const latest = useRef(toggle)
  useEffect(() => {
    latest.current = toggle
  })
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== 'j') return
      event.preventDefault()
      latest.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/** A press outside the bar shuts what it opened (C again's 3 and 4, which draw it themselves). */
function useOutside(open: boolean, close: () => void) {
  const latest = useRef(close)
  useEffect(() => {
    latest.current = close
  })
  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('[data-conversation-bar]') === null) latest.current()
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])
}

function Parts({ parts }: { parts: readonly Part[] }) {
  return parts.map((part, n) =>
    part.hit ? (
      <mark key={n} className={s.sHit}>
        {part.text}
      </mark>
    ) : (
      <Fragment key={n}>{part.text}</Fragment>
    ),
  )
}

function SearchField({
  search,
  onKeyDown,
  className,
}: {
  search: Search
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void
  className?: string
}) {
  const { query, type, rows, at, ids } = search
  return (
    <div className={cx(s.sField, className)}>
      <Icon name="search" size={14} />
      <input
        type="text"
        role="combobox"
        aria-label="Search conversations"
        placeholder="Search conversations"
        aria-expanded
        aria-controls={`${ids}-list`}
        aria-autocomplete="list"
        aria-activedescendant={`${ids}-${at}`}
        autoComplete="off"
        spellCheck={false}
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- opened to type in, as the finder is
        autoFocus
        value={query}
        onChange={(event) => type(event.target.value)}
        onKeyDown={onKeyDown ?? search.onKeyDown}
      />
      {rows.length > 0 && <Kbd>⌘J</Kbd>}
    </div>
  )
}

/* oxlint-disable jsx-a11y/prefer-tag-over-role, jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus -- a
 * listbox the field owns, as the finder's: focus stays in the field, which takes the keys; a press on a row opens it. */
/** The conversations found: each with a dot while at work, when it was last spoken in, and what matched under its name. */
function SearchList({ bar, search, rich = false }: { bar: Bar; search: Search; rich?: boolean }) {
  const { rows, at, setActive, choose, list, ids, query } = search
  const typed = query.trim() !== ''
  return (
    <div ref={list} id={`${ids}-list`} role="listbox" aria-label={bar.t.label} className={cx(s.sList, rich && s.sRich)}>
      {rows.map((row, index) => {
        const current = row.kind !== 'new' && row.id === bar.current
        const under = row.matched ?? (rich && row.said !== undefined ? [{ text: row.said, hit: false }] : null)
        return (
          <Fragment key={row.key}>
            {!typed && row.older && rows[index - 1]?.older !== true && (
              <div className={s.sGroup}>
                <span>{bar.t.older(bar.older.length)}</span>
                {bar.onClearOlder !== undefined && (
                  <button type="button" onClick={() => bar.onClearOlder?.(bar.older.map((one) => one.id))}>
                    {bar.t.clearOlder(bar.older.length)}
                  </button>
                )}
              </div>
            )}
            {row.kind === 'new' && typed && index === 0 && <p className={s.sNone}>No conversation says “{query.trim()}”</p>}
            {row.kind === 'new' && <div className={s.sRule} aria-hidden />}
            {/* A press opens it; focus stays in the field, which owns the keys. */}
            <div
              id={`${ids}-${index}`}
              role="option"
              aria-selected={index === at}
              data-current={current || undefined}
              className={s.sRow}
              onMouseDown={(event) => event.preventDefault()}
              onMouseMove={() => {
                if (index !== at) setActive(index)
              }}
              onClick={() => choose(row)}
            >
              <span className={s.sLead}>
                {row.kind === 'coordinator' ? (
                  bar.mark
                ) : row.kind === 'new' ? (
                  <Icon name="plus" size={13} />
                ) : row.running ? (
                  <LiveDot pulse />
                ) : null}
              </span>
              <span className={s.sText}>
                <span className={s.sName} data-new={row.untitled || undefined}>
                  <Parts parts={row.nameParts} />
                </span>
                {under !== null && (
                  <span className={s.sSaid}>
                    <Parts parts={under} />
                  </span>
                )}
              </span>
              {row.ago !== null && <span className={s.sAgo}>{row.ago}</span>}
              <span className={s.sCheck}>{current && <Icon name="check" size={12} />}</span>
            </div>
          </Fragment>
        )
      })}
    </div>
  )
}

/* oxlint-enable jsx-a11y/prefer-tag-over-role, jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus */

/** The field over the list: what a popover, the lane heading's drop and the panel hold. */
function SearchBody({ bar, close, rich = false, onEscape }: { bar: Bar; close: () => void; rich?: boolean; onEscape?: () => void }) {
  const search = useSearch(bar, close)
  return (
    <>
      <SearchField
        search={search}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || onEscape === undefined) return search.onKeyDown(event)
          event.preventDefault()
          onEscape()
        }}
      />
      <SearchList bar={bar} search={search} rich={rich} />
    </>
  )
}

/** The heading: the open conversation's name, which opens the search; a dot by the chevron while another is at work. */
const headingTrigger = (
  bar: Bar,
  open: Aside | null,
  extra: { onClick?: () => void; expanded?: boolean; inSight?: ReadonlySet<string | null> } = {},
) => {
  const elsewhere = [...bar.asides, ...bar.older].some(
    (one) => one.running === true && one.id !== bar.current && extra.inSight?.has(one.id) !== true,
  )
  return (
    <button
      type="button"
      className={s.cTrigger}
      data-new={open?.title === '' || undefined}
      onClick={extra.onClick}
      {...(extra.expanded === undefined ? {} : { 'aria-expanded': extra.expanded })}
    >
      {open === null ? bar.mark : open.running === true ? <LiveDot pulse /> : null}
      <span className={s.cTitle}>{open === null ? bar.t.coordinator : nameOf(open, bar.t)}</span>
      <Icon name="chevronD" size={12} className={s.chev} />
      {elsewhere && <LiveDot pulse />}
    </button>
  )
}

/** "Coordinator /", before an open aside's name: back in one press. */
function Crumb({ bar }: { bar: Bar }) {
  return (
    <>
      <button type="button" className={s.cCrumb} onClick={() => bar.onPick(null)}>
        {bar.mark}
        {bar.t.coordinator}
      </button>
      <span className={s.cSlash} aria-hidden>
        /
      </span>
    </>
  )
}

/** The × for an open aside, and +. */
function Ends({ bar, open }: { bar: Bar; open: Aside | null }) {
  return (
    <>
      {open !== null && bar.onClear !== undefined && (
        <IconButton icon="close" size="small" label={bar.t.clearOne(nameOf(open, bar.t))} onClick={() => bar.onClear?.(open.id)} />
      )}
      <IconButton icon="plus" size="small" label={bar.t.add} tooltipAlign="end" onClick={bar.onNew} />
    </>
  )
}

/** The popover the heading opens: the search over every conversation, in the menu's place. */
function SearchPopover({
  bar,
  trigger,
  open,
  setOpen,
}: {
  bar: Bar
  trigger: ReactElement
  open: boolean
  setOpen: (open: boolean) => void
}) {
  return (
    <Popover label={bar.t.label} trigger={trigger} width={360} padded={false} open={open} onOpenChange={setOpen} className={s.sPop}>
      <SearchBody bar={bar} close={() => setOpen(false)} />
    </Popover>
  )
}

/* ---------- C1 · Search: C, its menu a search over every conversation ---------- */

function SearchHeading({ bar, root }: Direction) {
  const open = bar.shown.find((one) => one.id === bar.current) ?? null
  const [searching, setSearching] = useState(scene.get('menu') === '1')
  useJump(() => setSearching((was) => !was))
  return (
    <div ref={root} className={cx(s.strip, s.c)} data-conversation-bar>
      {open !== null && <Crumb bar={bar} />}
      <SearchPopover bar={bar} open={searching} setOpen={setSearching} trigger={headingTrigger(bar, open)} />
      <span className={s.gap} />
      <Ends bar={bar} open={open} />
    </div>
  )
}

/* ---------- C2 · Recents: the heading, then the latest few conversations as quiet words, one press each ---------- */

function Recents({ bar, root }: Direction) {
  const open = bar.shown.find((one) => one.id === bar.current) ?? null
  const [searching, setSearching] = useState(scene.get('menu') === '1')
  useJump(() => setSearching((was) => !was))
  // Where else to go: the coordinator's first while an aside is open, then the latest asides, three at most.
  const others = [
    ...(open === null ? [] : [{ id: null, title: bar.t.coordinator, running: false } as const]),
    ...bar.asides.filter((one) => one.id !== bar.current && one.title !== ''),
  ].slice(0, 3)
  const { ref, count } = useFitCount(`${others.map((one) => `${one.id}:${one.title}`).join('|')}`, others.length)
  const inSight = new Set(others.slice(0, count).map((one) => one.id))
  return (
    <div ref={root} className={cx(s.strip, s.c, s.c2)} data-conversation-bar>
      <SearchPopover bar={bar} open={searching} setOpen={setSearching} trigger={headingTrigger(bar, open, { inSight })} />
      <div ref={ref} className={s.c2Fill}>
        {others.slice(0, count).map((one) => (
          <button key={one.id ?? 'coordinator'} type="button" className={s.c2Word} title={one.title} onClick={() => bar.onPick(one.id)}>
            {one.id === null ? bar.mark : one.running === true ? <LiveDot pulse /> : null}
            <span className={s.title}>{one.title}</span>
          </button>
        ))}
      </div>
      <Ends bar={bar} open={open} />
    </div>
  )
}

/* ---------- C3 · Lane heading: set as a lane's, a count at its end; its name turns into the search ---------- */

function LaneHeading({ bar, root }: Direction) {
  const { t } = bar
  const open = bar.shown.find((one) => one.id === bar.current) ?? null
  const [searching, setSearching] = useState(scene.get('menu') === '1')
  const name = useRef<HTMLButtonElement>(null)
  const close = (focus = false) => {
    setSearching(false)
    if (focus) requestAnimationFrame(() => name.current?.focus())
  }
  useJump(() => (searching ? close(true) : setSearching(true)))
  useOutside(searching, close)
  const count = bar.asides.filter((one) => one.title !== '').length + bar.older.length
  const working = [...bar.asides, ...bar.older].some((one) => one.running === true && one.id !== bar.current)
  return (
    <div ref={root} className={cx(s.strip, s.c, s.c3)} data-conversation-bar data-searching={searching || undefined}>
      {searching ? (
        <span className={s.c3Glyph}>
          <Icon name="search" size={14} />
        </span>
      ) : open === null ? (
        <span className={s.c3Glyph}>{bar.mark}</span>
      ) : (
        <IconButton icon="chevronL" size="small" label={`Back to ${t.coordinator}`} onClick={() => bar.onPick(null)} />
      )}
      {searching ? (
        <LaneSearch bar={bar} close={close} />
      ) : (
        <Tooltip label="Search conversations" kbd="⌘J">
          <button
            ref={name}
            type="button"
            className={s.c3Name}
            data-new={open?.title === '' || undefined}
            onClick={() => setSearching(true)}
          >
            <span className={s.cTitle}>{open === null ? t.coordinator : nameOf(open, t)}</span>
          </button>
        </Tooltip>
      )}
      <span className={s.gap} />
      {!searching && (
        <Tooltip label={count === 1 ? '1 aside' : `${count} asides`}>
          <button type="button" className={s.c3Count} onClick={() => setSearching(true)}>
            {working && <LiveDot pulse />}
            {count}
          </button>
        </Tooltip>
      )}
      <Ends bar={bar} open={open} />
    </div>
  )
}

/** The lane heading's name, as a field: what it finds drops under it. Escape gives the name back. */
function LaneSearch({ bar, close }: { bar: Bar; close: (focus?: boolean) => void }) {
  const search = useSearch(bar, () => close())
  return (
    <>
      <SearchField
        search={search}
        className={s.c3Field}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return search.onKeyDown(event)
          event.preventDefault()
          close(true)
        }}
      />
      <div className={s.c3Drop}>
        <SearchList bar={bar} search={search} />
      </div>
    </>
  )
}

/* ---------- C4 · Panel: the heading opens every conversation over this one, each with what was said last ---------- */

function PanelHeading({ bar, root }: Direction) {
  const open = bar.shown.find((one) => one.id === bar.current) ?? null
  const [shown, setShown] = useState(scene.get('menu') === '1')
  useJump(() => setShown((was) => !was))
  useOutside(shown, () => setShown(false))
  const panel = useRef<HTMLDivElement>(null)
  // As tall as the conversation under the heading: it takes the conversation's place while it is open.
  const [height, setHeight] = useState(0)
  useLayoutEffect(() => {
    const node = panel.current
    const column = node?.parentElement?.parentElement
    if (!shown || node == null || column == null) return
    const measure = () => setHeight(Math.max(0, column.getBoundingClientRect().bottom - node.getBoundingClientRect().top))
    measure()
    const sizes = new ResizeObserver(measure)
    sizes.observe(column)
    return () => sizes.disconnect()
  }, [shown])
  return (
    <div ref={root} className={cx(s.strip, s.c, s.c4)} data-conversation-bar>
      {open !== null && <Crumb bar={bar} />}
      {headingTrigger(bar, open, { onClick: () => setShown((was) => !was), expanded: shown })}
      <span className={s.gap} />
      <Ends bar={bar} open={open} />
      {shown && (
        <div ref={panel} className={s.c4Panel} style={height > 0 ? { height } : undefined}>
          <SearchBody bar={bar} close={() => setShown(false)} onEscape={() => setShown(false)} rich />
        </div>
      )}
    </div>
  )
}
