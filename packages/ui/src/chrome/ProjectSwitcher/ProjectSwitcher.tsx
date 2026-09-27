import { useEffect, useRef, useState } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { useControlled } from '../../lib/controlled'
import { cx } from '../../lib/cx'
import { Button } from '../../primitives/Button/Button'
import { IconButton } from '../../primitives/IconButton/IconButton'
import { LiveDot } from '../../primitives/LiveDot/LiveDot'
import { Popover } from '../../primitives/Popover/Popover'
import s from './ProjectSwitcher.module.css'

/*
 * The project you are in, named at the start of the bar. Open it to rename
 * this project, to see the other projects that wait on you first, and to
 * find any other by name. Each says what it is, whether anything runs in
 * it, and when it was last touched.
 */

export interface ProjectSummary {
  id: string
  name: string
  /** What it is, in a line: Billing and payments surface. */
  about?: string
  /** Where it lives: its repositories. */
  where?: string
  /** Calls waiting on you there. */
  yours: number
  /** Tasks running there. */
  running: number
  /** When it was last touched: now, 2h ago. */
  touched?: string
}

export interface ProjectSwitcherText {
  label: string
  rename: string
  renameLabel: string
  save: string
  yoursHead: string
  yours: (n: number) => string
  running: string
  find: string
  none: string
  add: string
}

export const projectSwitcherText: ProjectSwitcherText = {
  label: 'Projects',
  rename: 'Rename',
  renameLabel: 'The project’s name',
  save: 'Save',
  yoursHead: 'Needs you',
  yours: (n) => (n === 1 ? '1 call waits on you' : `${n} calls wait on you`),
  running: 'running',
  find: 'Find a project',
  none: 'No project by that name',
  add: 'New project',
}

export interface ProjectSwitcherProps {
  current: ProjectSummary
  /** Every project, this one included. */
  projects: readonly ProjectSummary[]
  onPick: (id: string) => void
  /** Rename this project. Without it, there is no Rename. */
  onRename?: (name: string) => void
  /** Start a new project. Without it, there is no New project. */
  onNew?: () => void
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  /** Open straight into renaming, as a project menu's Rename does. */
  renaming?: boolean
  onRenamingChange?: (renaming: boolean) => void
  text?: Partial<ProjectSwitcherText>
}

export function ProjectSwitcher({
  current,
  projects,
  onPick,
  onRename,
  onNew,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  renaming: renamingProp,
  onRenamingChange,
  text,
}: ProjectSwitcherProps) {
  const t = { ...projectSwitcherText, ...text }
  const [open, setOpen] = useControlled(openProp, defaultOpen, onOpenChange)
  const [renaming, setRenaming] = useControlled(renamingProp, false, onRenamingChange)
  const [name, setName] = useState(current.name)
  const [query, setQuery] = useState('')
  const field = useRef<HTMLInputElement>(null)
  const pencil = useRef<HTMLButtonElement>(null)
  const wasRenaming = useRef(renaming)
  useEffect(() => {
    /* into the name when renaming starts; back to Rename when it ends, so focus stays in the panel */
    if (renaming && open) field.current?.select()
    else if (wasRenaming.current && open) pencil.current?.focus()
    wasRenaming.current = renaming
  }, [renaming, open])

  const waiting = projects.filter((p) => p.id !== current.id && p.yours > 0)
  const q = query.trim().toLowerCase()
  const rest = projects.filter((p) => !waiting.includes(p) && (!q || p.name.toLowerCase().includes(q)))

  const openChange = (next: boolean) => {
    setOpen(next)
    if (!next) setRenaming(false)
    setName(current.name)
    setQuery('')
  }
  const pick = (id: string) => {
    onPick(id)
    openChange(false)
  }
  const save = () => {
    const said = name.trim()
    if (said && said !== current.name) onRename?.(said)
    setRenaming(false)
  }

  const row = (p: ProjectSummary) => (
    <li key={p.id}>
      <button type="button" className={s.row} aria-current={p.id === current.id || undefined} onClick={() => pick(p.id)}>
        <span className={s.main}>
          <span className={s.name}>{p.name}</span>
          {p.about && <span className={s.about}>{p.about}</span>}
        </span>
        <span className={s.meta}>
          {p.yours > 0 && p.id !== current.id && (
            <span className={s.yours} title={t.yours(p.yours)}>
              {p.yours}
            </span>
          )}
          {p.running > 0 && <LiveDot />}
          {p.touched && <span className={s.touched}>{p.touched}</span>}
        </span>
      </button>
    </li>
  )

  return (
    <Popover
      label={t.label}
      open={open}
      onOpenChange={openChange}
      width={330}
      padded={false}
      initialFocus="panel"
      onEscapeKeyDown={(e) => {
        /* out of renaming first; the next Escape closes */
        if (!renaming) return
        e.preventDefault()
        setRenaming(false)
        setName(current.name)
      }}
      className={s.pop}
      trigger={
        <button type="button" className={s.trigger}>
          <span className={s.triggerName}>{current.name}</span>
          <Icon name="chevronD" size={11} className={s.caret} />
        </button>
      }
    >
      <div className={s.current}>
        {renaming && onRename ? (
          <form
            className={s.rename}
            onSubmit={(e) => {
              e.preventDefault()
              save()
            }}
          >
            <input ref={field} className={s.field} value={name} aria-label={t.renameLabel} onChange={(e) => setName(e.target.value)} />
            <Button type="submit" disabled={!name.trim()}>
              {t.save}
            </Button>
          </form>
        ) : (
          <>
            <span className={s.currentText}>
              <span className={s.currentName}>{current.name}</span>
              {current.where && <span className={s.about}>{current.where}</span>}
            </span>
            {onRename && <IconButton ref={pencil} icon="pencil" label={t.rename} size="small" onClick={() => setRenaming(true)} />}
          </>
        )}
      </div>
      {waiting.length > 0 && (
        <section aria-label={t.yoursHead}>
          <div className={s.head} aria-hidden="true">
            {t.yoursHead}
          </div>
          <ul className={s.list}>{waiting.map(row)}</ul>
        </section>
      )}
      <label className={s.find}>
        <Icon name="search" size={12} />
        <input className={s.findField} value={query} placeholder={t.find} aria-label={t.find} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <ul className={s.list}>{rest.map(row)}</ul>
      {rest.length === 0 && <p className={s.none}>{t.none}</p>}
      {onNew && (
        <button
          type="button"
          className={cx(s.row, s.add)}
          onClick={() => {
            onNew()
            openChange(false)
          }}
        >
          <Icon name="plus" size={12} />
          {t.add}
        </button>
      )}
    </Popover>
  )
}
