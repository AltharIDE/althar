import { type KeyboardEvent, type MouseEvent, useId, useRef, useState } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { useControlled } from '../../lib/controlled'
import { cx } from '../../lib/cx'
import { Field } from '../Field/Field'
import { Popover } from '../Popover/Popover'
import s from './BranchSelect.module.css'

/*
 * A branch, picked from a repository's branches (ADR-093): what a project's
 * tasks work toward, or one task. It opens on a field: typing finds a branch
 * by any part of its name, the arrows move, Enter picks, Escape closes. A
 * name the list doesn't have is offered last, to make from `from`, where the
 * consumer can (`onCreate`); one git wouldn't take says why in its place.
 * Branches are set in mono, as code; the default one says so, quietly.
 */

/** What git takes as a branch's name, near enough for a list: no spaces or odd marks, nothing that ends in / or . or starts with - . / */
export const branchNameable = (name: string) =>
  /^[A-Za-z0-9._/-]+$/.test(name) && !/(^[-/.]|[/.]$|\.\.|\/\/|@\{|\.lock$)/.test(name) && name !== 'HEAD'

export interface BranchSelectText {
  find: string
  /** Beside the default branch in the list. */
  defaultBranch: string
  /** The last row, for a name the list doesn't have: Create release/0.9.0 from main. */
  create: string
  from: (branch: string) => string
  /** In that row's place, for a name git wouldn't take. */
  unnameable: string
  none: (typed: string) => string
}

export const branchSelectText: BranchSelectText = {
  find: 'Find or name a branch',
  defaultBranch: 'default',
  create: 'Create',
  from: (branch) => `from ${branch}`,
  unnameable: 'A branch’s name can’t have spaces, or end in / or .',
  none: (typed) => `No branch called “${typed}”`,
}

export interface BranchSelectProps {
  /** What the branch is for; the button's and the list's accessible name: Work toward. */
  label: string
  value: string
  /** The repository's branches, its default first. */
  branches: readonly string[]
  /** Said of it in the list. */
  defaultBranch?: string
  onChange: (branch: string) => void
  /** Makes a branch the list doesn't have, from `from`; the list closes on it. Without it, only a branch listed can be picked. */
  onCreate?: (branch: string) => void
  /** Where a new branch starts: the default branch, unless said. */
  from?: string
  /**
   * How the button looks: quiet text until pointed at, for a value in a row;
   * filled, a field in a settings row; bare, none of its own, for one that
   * takes the look of the choices beside it from `className`.
   */
  variant?: 'quiet' | 'filled' | 'bare'
  /** A line under the list: what picking one changes, and what it leaves. */
  note?: string
  disabled?: boolean
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  className?: string
  text?: Partial<BranchSelectText>
}

type Row = { readonly kind: 'branch' | 'create'; readonly name: string }

export function BranchSelect({
  label,
  value,
  branches,
  defaultBranch,
  onChange,
  onCreate,
  from,
  variant = 'quiet',
  note,
  disabled,
  open: given,
  defaultOpen = false,
  onOpenChange,
  className,
  text,
}: BranchSelectProps) {
  const t = { ...branchSelectText, ...text }
  const [open, setOpen] = useControlled(given, defaultOpen, onOpenChange)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listId = useId()
  const list = useRef<HTMLDivElement>(null)
  const typed = query.trim()
  const known = branches.includes(value) ? branches : [...branches, value]
  const rows: Row[] = [
    ...known.filter((one) => one.toLowerCase().includes(typed.toLowerCase())).map((name) => ({ kind: 'branch' as const, name })),
    ...(onCreate !== undefined && typed !== '' && !known.includes(typed) ? [{ kind: 'create' as const, name: typed }] : []),
  ]
  const at = Math.min(active, Math.max(rows.length - 1, 0))
  const rowId = (index: number) => `${listId}-${index}`
  const start = from ?? defaultBranch ?? branches[0]

  const choose = (row: Row | undefined) => {
    if (row === undefined) return
    if (row.kind === 'create') {
      if (!branchNameable(row.name)) return
      onCreate?.(row.name)
    } else if (row.name !== value) onChange(row.name)
    setOpen(false)
  }
  const move = (to: number) => {
    setActive(to)
    list.current?.querySelector(`#${CSS.escape(rowId(to))}`)?.scrollIntoView({ block: 'nearest' })
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'ArrowDown') move(Math.min(at + 1, rows.length - 1))
    else if (event.key === 'ArrowUp') move(Math.max(at - 1, 0))
    else if (event.key === 'Enter') choose(rows[at])
    else return
    event.preventDefault()
  }

  return (
    <Popover
      label={label}
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) return
        // Opens on the branch chosen, with nothing typed.
        setQuery('')
        setActive(Math.max(0, known.indexOf(value)))
      }}
      padded={false}
      className={s.list}
      trigger={
        <button
          type="button"
          // Named with its value, as a list's button is read: Work toward: release/0.8.0.
          aria-label={`${label}: ${value}`}
          disabled={disabled}
          data-state={open ? 'open' : 'closed'}
          className={cx(variant !== 'bare' && s.trigger, variant !== 'bare' && s[variant], s.button, className)}
          title={value}
        >
          <span className={s.value}>{value}</span>
          <span className={s.chev}>
            {/* bare, as the chevron of the choices beside it */}
            <Icon name="chevronD" size={variant === 'bare' ? 10 : 9} />
          </span>
        </button>
      }
    >
      <div className={s.find}>
        <Field
          role="combobox"
          aria-label={t.find}
          placeholder={t.find}
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={rows.length === 0 ? undefined : rowId(at)}
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      <div ref={list} id={listId} role="listbox" aria-label={label} className={s.options}>
        {rows.map((row, index) => {
          const shared = {
            id: rowId(index),
            role: 'option',
            'data-active': index === at || undefined,
            // A press picks it; focus stays in the field, which owns the keys.
            onMouseDown: (event: MouseEvent) => event.preventDefault(),
            onMouseMove: () => {
              if (index !== at) setActive(index)
            },
            onClick: () => choose(row),
          }
          if (row.kind === 'branch')
            return (
              <div key={row.name} {...shared} aria-selected={row.name === value} className={s.item}>
                <code className={s.name}>{row.name}</code>
                {row.name === defaultBranch && (
                  <>
                    {' '}
                    <span className={s.hint}>{t.defaultBranch}</span>
                  </>
                )}
                {row.name === value && (
                  <span className={s.check}>
                    <Icon name="check" size={11} />
                  </span>
                )}
              </div>
            )
          const takes = branchNameable(row.name)
          return (
            <div key="create" {...shared} aria-selected={false} aria-disabled={!takes || undefined} className={cx(s.item, s.create)}>
              <Icon name="plus" size={11} />
              {takes ? (
                <>
                  {/* spaced, so it reads as words: Create release/0.9.0 from main */}
                  <span className={s.verb}>{t.create}</span> <code className={s.name}>{row.name}</code>
                  {start !== undefined && (
                    <>
                      {' '}
                      <span className={s.hint}>{t.from(start)}</span>
                    </>
                  )}
                </>
              ) : (
                <span className={s.verb}>{t.unnameable}</span>
              )}
            </div>
          )
        })}
        {rows.length === 0 && <p className={s.none}>{t.none(typed)}</p>}
      </div>
      {note !== undefined && <p className={s.note}>{note}</p>}
    </Popover>
  )
}
