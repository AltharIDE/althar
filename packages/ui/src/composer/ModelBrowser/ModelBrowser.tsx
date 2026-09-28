import { Dialog, RadioGroup, Toggle } from 'radix-ui'
import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'

import { unreachable } from '../../foundations/vocabulary'
import { Icon, type IconName } from '../../foundations/Icon/Icon'
import type { Brand } from '../../foundations/brands/brands'
import { BrandMark } from '../../foundations/Marks/Marks'
import { Model, type ModelInfo } from '../../foundations/Model/Model'
import { cx } from '../../lib/cx'
import { Tooltip } from '../../primitives/HoverCard/HoverCard'
import { Kbd } from '../../primitives/Kbd/Kbd'
import { Select } from '../../primitives/Select/Select'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import s from './ModelBrowser.module.css'

/** An agent runtime on this machine, and how it is signed in. Status, not pitch. */
export interface RuntimeInfo {
  id: string
  name: string
  /** How it is connected: signed in, API key, this Mac. */
  how: string
  /** Its mark. Without one, a generic plug. */
  brand?: Brand
}

export interface ModelBrowserText {
  title: string
  search: string
  filters: string
  all: string
  pinned: string
  connected: string
  connect: string
  columns: { model: string; runtime: string; context: string; effort: string }
  /** The list's name, and what a screen reader hears as the search narrows it. */
  count: (n: number) => string
  inUse: string
  use: (model: string, inUse: boolean) => string
  defaultEffort: (model: string) => string
  pin: (model: string) => string
  pinTitle: (pinned: boolean) => string
  /** A context window, in thousands of tokens. */
  context: (k: number) => string
  empty: (query: string) => string
  keys: { escape: string; up: string; down: string; enter: string; pin: string }
  move: string
  choose: string
  pinVerb: string
  foot: string
}

export const modelBrowserText: ModelBrowserText = {
  title: 'Models',
  search: 'Search models',
  filters: 'Filter models',
  all: 'All models',
  pinned: 'Pinned',
  connected: 'Connected',
  connect: 'Connect a runtime',
  columns: { model: 'Model', runtime: 'Runtime', context: 'Context', effort: 'Default effort' },
  count: (n) => `${n} models`,
  inUse: 'in use',
  use: (model, inUse) => `Use ${model}${inUse ? ', in use' : ''}`,
  defaultEffort: (model) => `Default effort for ${model}`,
  pin: (model) => `Pin ${model}`,
  pinTitle: (pinned) => (pinned ? 'Unpin' : 'Pin'),
  context: (k) => (k >= 1000 ? `${k / 1000}M` : `${k}k`),
  empty: (q) => `No model matches “${q}”.`,
  keys: { escape: 'esc', up: '↑', down: '↓', enter: '↵', pin: '⌘P' },
  move: 'move',
  choose: 'use',
  pinVerb: 'pin',
  foot: 'Pinned models are the short list in every picker',
}

export interface ModelBrowserProps {
  models: readonly ModelInfo[]
  runtimes: readonly RuntimeInfo[]
  /** The model in use, by id. */
  value: string
  /** Your pinned models, by id. */
  pins: readonly string[]
  /** A model's default effort, as you have set it or the runtime has it. */
  defaultEffort: (model: ModelInfo) => string | null
  onPick: (id: string) => void
  onClose: () => void
  onTogglePin: (id: string) => void
  onSetDefaultEffort: (id: string, level: string) => void
  /** Add a runtime. Without it, there is no such row. */
  onConnect?: () => void
  text?: Partial<ModelBrowserText>
}

/** All, pinned, or one runtime by id. */
type Filter = { kind: 'all' } | { kind: 'pinned' } | { kind: 'runtime'; id: string }

/* a filter as the rail's radio value */
function keyOf(f: Filter): string {
  switch (f.kind) {
    case 'all':
    case 'pinned':
      return f.kind
    case 'runtime':
      return `runtime:${f.id}`
    default:
      return unreachable(f)
  }
}

/**
 * Every model every connected runtime offers, searchable, with pins. Laid
 * out like a command palette with a filter rail: you arrive typing. It is a
 * modal dialog; the arrows move from the search into the list and along
 * it, Enter uses a model, ⌘P pins the one you are on.
 */
export function ModelBrowser({
  models,
  runtimes,
  value,
  pins,
  defaultEffort,
  onPick,
  onClose,
  onTogglePin,
  onSetDefaultEffort,
  onConnect,
  text,
}: ModelBrowserProps) {
  const t = { ...modelBrowserText, ...text }
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>({ kind: 'all' })
  const list = useRef<HTMLUListElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const ids = useId()

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const runtimeName = (id: string) => runtimes.find((r) => r.id === id)?.name ?? id
    const shown = (m: ModelInfo) => {
      switch (filter.kind) {
        case 'all':
          return true
        case 'pinned':
          return pins.includes(m.id)
        case 'runtime':
          return m.runtime === filter.id
        default:
          return unreachable(filter)
      }
    }
    return models
      .filter(shown)
      .filter((m) => !needle || `${m.name} ${m.id} ${runtimeName(m.runtime)}`.toLowerCase().includes(needle))
      .toSorted((a, b) => Number(pins.includes(b.id)) - Number(pins.includes(a.id)))
  }, [q, filter, pins, models, runtimes])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    /* a select in a row handles its own arrows, and they bubble here through its portal */
    if (e.defaultPrevented) return
    const uses = [...(list.current?.querySelectorAll<HTMLButtonElement>('[data-use]') ?? [])]
    const focused = document.activeElement
    const at = focused instanceof HTMLButtonElement ? uses.indexOf(focused) : -1
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        uses[Math.min(uses.length - 1, at + 1)]?.focus()
        break
      case 'ArrowUp':
        e.preventDefault()
        if (at <= 0) search.current?.focus()
        else uses[at - 1]?.focus()
        break
      case 'Enter': {
        const first = rows[0]
        if (focused === search.current && first) {
          e.preventDefault()
          onPick(first.id)
        }
        break
      }
      case 'p': {
        if (!(e.metaKey || e.ctrlKey) || !(focused instanceof HTMLElement)) break
        const id = focused.closest<HTMLElement>('[data-id]')?.dataset.id
        if (id) {
          e.preventDefault()
          onTogglePin(id)
        }
        break
      }
    }
  }

  const rail: { filter: Filter; name: string; n: number; icon: IconName }[] = [
    { filter: { kind: 'all' }, name: t.all, n: models.length, icon: 'work' },
    { filter: { kind: 'pinned' }, name: t.pinned, n: pins.length, icon: 'pin' },
  ]
  const filters = new Map<string, Filter>(
    [...rail.map((r) => r.filter), ...runtimes.map((c): Filter => ({ kind: 'runtime', id: c.id }))].map((f) => [keyOf(f), f]),
  )

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
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            search.current?.focus()
          }}
          onKeyDown={onKeyDown}
        >
          <VisuallyHidden>
            <Dialog.Title>{t.title}</Dialog.Title>
          </VisuallyHidden>
          <div className={s.search}>
            <Icon name="search" size={14} />
            <input
              ref={search}
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t.search}
              aria-label={t.search}
            />
            <Kbd>{t.keys.escape}</Kbd>
          </div>
          <div className={s.body}>
            <div className={s.rail}>
              {/* one filter at a time: a radio group, so arrows move along it and the one in force is announced */}
              <RadioGroup.Root
                className={s.railGroup}
                aria-label={t.filters}
                orientation="vertical"
                value={keyOf(filter)}
                onValueChange={(k) => {
                  const f = filters.get(k)
                  if (f) setFilter(f)
                }}
              >
                {rail.map((r) => (
                  <RadioGroup.Item key={r.filter.kind} value={keyOf(r.filter)} className={s.railButton}>
                    <Icon name={r.icon} size={12} />
                    <span>{r.name}</span>
                    <span className={s.railN}>{r.n}</span>
                  </RadioGroup.Item>
                ))}
                <span className={s.railKey}>{t.connected}</span>
                {runtimes.map((c) => (
                  <RadioGroup.Item key={c.id} value={keyOf({ kind: 'runtime', id: c.id })} className={s.railButton}>
                    {c.brand ? <BrandMark brand={c.brand} size={12} /> : <Icon name="plug" size={12} />}
                    <span>{c.name}</span>
                    <span className={s.railN}>{models.filter((m) => m.runtime === c.id).length}</span>
                  </RadioGroup.Item>
                ))}
              </RadioGroup.Root>
              {onConnect && (
                <button type="button" className={cx(s.railButton, s.add)} onClick={onConnect}>
                  <Icon name="plus" size={12} />
                  <span>{t.connect}</span>
                </button>
              )}
            </div>

            <div className={s.results}>
              <div className={s.cols} aria-hidden="true">
                <span>{t.columns.model}</span>
                <span>{t.columns.runtime}</span>
                <span>{t.columns.context}</span>
                <span>{t.columns.effort}</span>
                <span />
              </div>
              {/* the count, said as the search narrows the list */}
              <span aria-live="polite">{q.trim() && <VisuallyHidden>{t.count(rows.length)}</VisuallyHidden>}</span>
              <ul ref={list} className={s.list} aria-label={t.count(rows.length)}>
                {rows.map((m) => {
                  const c = runtimes.find((x) => x.id === m.runtime)
                  const pinned = pins.includes(m.id)
                  const inUse = m.id === value
                  const level = defaultEffort(m)
                  const via = `${ids}-${m.id}-via`
                  const ctx = `${ids}-${m.id}-ctx`
                  return (
                    <li key={m.id} data-id={m.id} className={s.row}>
                      <button
                        type="button"
                        data-use
                        className={s.use}
                        onClick={() => onPick(m.id)}
                        aria-label={t.use(m.name, inUse)}
                        aria-describedby={`${via} ${ctx}`}
                      >
                        <Model model={m} />
                        {inUse && <span className={s.inUse}>{t.inUse}</span>}
                      </button>
                      <span className={s.via} id={via}>
                        {c ? (
                          <>
                            {c.name} <span>· {c.how}</span>
                          </>
                        ) : (
                          m.runtime
                        )}
                      </span>
                      <span className={s.ctx} id={ctx}>
                        {t.context(m.context)}
                      </span>
                      {m.efforts.length > 0 ? (
                        <Select
                          label={t.defaultEffort(m.name)}
                          options={m.efforts.map((l) => ({ value: l, label: l }))}
                          value={level ?? m.efforts[0] ?? ''}
                          onChange={(l) => onSetDefaultEffort(m.id, l)}
                          width={104}
                        />
                      ) : (
                        <span className={s.none}>—</span>
                      )}
                      <Tooltip label={t.pinTitle(pinned)} kbd={t.keys.pin} align="end">
                        <Toggle.Root
                          className={s.pin}
                          pressed={pinned}
                          onPressedChange={() => onTogglePin(m.id)}
                          aria-label={t.pin(m.name)}
                        >
                          <Icon name="pin" size={13} />
                        </Toggle.Root>
                      </Tooltip>
                    </li>
                  )
                })}
              </ul>
              {!rows.length && <p className={s.empty}>{t.empty(q)}</p>}
            </div>
          </div>
          <div className={s.foot} aria-hidden="true">
            <span>
              <Kbd>{t.keys.up}</Kbd>
              <Kbd>{t.keys.down}</Kbd> {t.move}
            </span>
            <span>
              <Kbd>{t.keys.enter}</Kbd> {t.choose}
            </span>
            <span>
              <Kbd>{t.keys.pin}</Kbd> {t.pinVerb}
            </span>
            <span className={s.footRight}>{t.foot}</span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
