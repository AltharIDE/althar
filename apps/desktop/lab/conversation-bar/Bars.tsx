import { type ReactElement, type ReactNode, type Ref, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'

import {
  type Aside,
  AsideTabs as TodayTabs,
  type AsideTabsProps,
  asideTabsText,
  type AsideTabsText,
  Icon,
  IconButton,
  LiveDot,
  Menu,
  MenuGroup,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  ProjectHeader as TodayHeader,
  type ProjectHeaderProps,
  Tooltip,
} from '@althar/ui'

import { asideAgo } from './data'
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

// ?open=<aside's slug> opens that aside once, ?new=1 starts one, ?menu=1 opens C's menu: for screenshots of each state.
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
  }
}

/* ---------- What the directions share ---------- */

/**
 * As many asides' tabs as fit, the open one always among them, the rest in "N more": the tabs are drawn, and while they
 * overflow their place one fewer is, before the frame is painted; the place grown, all are tried again. Only with no other
 * tab left does the open one give way, down to its least.
 */
function useFit(bar: Bar) {
  const ref = useRef<HTMLDivElement>(null)
  const others = bar.shown.filter((one) => one.id !== bar.current)
  const key = `${bar.shown.map((one) => `${one.id}:${one.title}`).join('|')}#${bar.current ?? ''}`
  const [fit, setFit] = useState({ key, count: others.length, width: 0 })
  if (fit.key !== key) setFit({ key, count: others.length, width: fit.width })
  const count = Math.min(fit.key === key ? fit.count : others.length, others.length)
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
