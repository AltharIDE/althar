import { type PointerEvent as Press, useId, useLayoutEffect, useRef, useState } from 'react'

import type { AddWay, RunFrom } from '../../chrome/RunButton/RunButton'
import { cx } from '../../lib/cx'
import { Button } from '../../primitives/Button/Button'
import { CheckList } from '../../primitives/CheckList/CheckList'
import { Dialog } from '../../primitives/Dialog/Dialog'
import { Field } from '../../primitives/Field/Field'
import { FormRow } from '../../primitives/FormRow/FormRow'
import { IconButton } from '../../primitives/IconButton/IconButton'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { Segmented } from '../../primitives/Segmented/Segmented'
import { Select } from '../../primitives/Select/Select'
import { Spinner } from '../../primitives/Spinner/Spinner'
import s from './Runnables.module.css'

/*
 * What a project runs, kept by the person (ADR-043): adding something more to
 * run, three ways (typing its command, picking from the repository's
 * package.json scripts, or asking the coordinator to work it out); changing
 * one; and the whole list, in the person's order, the first its default, to
 * reorder by dragging, edit and remove. Each is a dialog the consumer mounts
 * to open.
 */

/* ---- adding one ---- */

/** A script in the project's package.json files, not kept yet. */
export interface PickableScript {
  id: string
  /** The command that runs it from its repository's root: `bun --filter @althar/ui storybook`. */
  command: string
  /** What the script itself says. */
  body: string
  /** Its repository, said where the project has more than one, as the same script can be in each. */
  repository?: string
}

export interface AddRunnableText {
  title: string
  description: string
  way: string
  ways: Record<AddWay, string>
  command: string
  commandNote: string
  commandPlaceholder: string
  name: string
  nameNote: string
  namePlaceholder: string
  repository: string
  find: (n: number) => string
  scripts: string
  reading: string
  noScripts: string
  ask: string
  askAbout: string
  cancel: string
  add: (n: number) => string
}

export const addRunnableText: AddRunnableText = {
  title: 'Add something to run',
  description: 'Althar runs it with no agent: on the project, in a copy of the default branch; on a task, in its worktree.',
  way: 'How to add it',
  ways: { type: 'Type a command', scripts: 'From package.json', ask: 'Ask the coordinator' },
  command: 'Command',
  commandNote: 'Run from the repository’s root, once what it needs is installed.',
  commandPlaceholder: 'bun --filter @althar/ui storybook',
  name: 'Name',
  nameNote: 'Optional. Without one, the command names it.',
  namePlaceholder: 'Storybook',
  repository: 'Repository',
  find: (n) => (n === 1 ? 'Find the script' : `Find among ${n} scripts`),
  scripts: 'Scripts in package.json',
  reading: 'Reading the repository’s scripts…',
  noScripts: 'The repository has no package.json scripts that aren’t kept already.',
  ask: 'Ask the coordinator',
  askAbout:
    'The coordinator reads the repository, keeps what is worth running by hand, and says what it kept in the project’s conversation.',
  cancel: 'Cancel',
  add: (n) => (n > 1 ? `Add ${n}` : 'Add'),
}

export interface AddRunnableProps {
  /** The way it opens on. */
  way: AddWay
  /** The project's repositories, by name: a choice of where it runs, where there are several. */
  repositories: readonly string[]
  /** The scripts not kept yet; null while they are read. */
  scripts: readonly PickableScript[] | null
  /** Adds one typed in. */
  onAdd: (runnable: { name: string | null; command: string; repository: string | null }) => void
  /** Adds the scripts picked, by id. */
  onAddScripts: (ids: readonly string[]) => void
  /** Asks the coordinator to work out what the project runs. */
  onAsk: () => void
  onClose: () => void
  busy?: boolean
  error?: string
  text?: Partial<AddRunnableText>
}

export function AddRunnable({
  way: first,
  repositories,
  scripts,
  onAdd,
  onAddScripts,
  onAsk,
  onClose,
  busy = false,
  error,
  text,
}: AddRunnableProps) {
  const t = { ...addRunnableText, ...text }
  const ids = useId()
  const [way, setWay] = useState<AddWay>(first)
  const [command, setCommand] = useState('')
  const [name, setName] = useState('')
  const [repository, setRepository] = useState<string | null>(repositories[0] ?? null)
  const [find, setFind] = useState('')
  const [picked, setPicked] = useState<readonly string[]>([])
  const found = (scripts ?? []).filter((one) =>
    `${one.command} ${one.body} ${one.repository ?? ''}`.toLowerCase().includes(find.trim().toLowerCase()),
  )
  const count = way === 'scripts' ? picked.length : 1
  const ready = way === 'type' ? command.trim() !== '' : way === 'scripts' ? picked.length > 0 : true
  const submit = () => {
    if (!ready || busy) return
    if (way === 'type') onAdd({ name: name.trim() === '' ? null : name.trim(), command: command.trim(), repository })
    else if (way === 'scripts') onAddScripts(picked)
    else onAsk()
  }
  return (
    <Dialog
      title={t.title}
      description={t.description}
      onClose={onClose}
      onSubmit={submit}
      width={600}
      actions={
        <>
          <Button type="button" variant="quiet" onClick={onClose}>
            {t.cancel}
          </Button>
          <Button type="submit" variant="ink" disabled={!ready} busy={busy}>
            {way === 'ask' ? t.ask : t.add(count)}
          </Button>
        </>
      }
    >
      <div className={s.stack}>
        <Segmented<AddWay>
          label={t.way}
          value={way}
          onChange={setWay}
          options={(['type', 'scripts', 'ask'] as const).map((value) => ({ value, label: t.ways[value] }))}
        />
        {way === 'type' && (
          <div className={s.rows}>
            <FormRow label={t.command} htmlFor={`${ids}-command`} note={t.commandNote}>
              <Field
                id={`${ids}-command`}
                className={s.wide}
                value={command}
                placeholder={t.commandPlaceholder}
                spellCheck={false}
                onChange={(event) => setCommand(event.target.value)}
              />
            </FormRow>
            <FormRow label={t.name} htmlFor={`${ids}-name`} note={t.nameNote}>
              <Field
                id={`${ids}-name`}
                className={s.wide}
                value={name}
                placeholder={t.namePlaceholder}
                onChange={(event) => setName(event.target.value)}
              />
            </FormRow>
            {repositories.length > 1 && (
              <FormRow label={t.repository}>
                <Select<string>
                  value={repository}
                  onChange={setRepository}
                  options={repositories.map((one) => ({ value: one, label: one }))}
                />
              </FormRow>
            )}
          </div>
        )}
        {way === 'scripts' &&
          (scripts === null ? (
            <p className={s.quiet}>
              <Spinner size="small" /> {t.reading}
            </p>
          ) : scripts.length === 0 ? (
            <p className={s.quiet}>{t.noScripts}</p>
          ) : (
            <>
              <Field
                aria-label={t.find(scripts.length)}
                placeholder={t.find(scripts.length)}
                value={find}
                onChange={(event) => setFind(event.target.value)}
              />
              <div className={s.scroll}>
                <CheckList
                  label={t.scripts}
                  items={found.map((one) => ({
                    id: one.id,
                    label: `${one.command}  ·  ${one.body}${one.repository === undefined ? '' : `  ·  ${one.repository}`}`,
                  }))}
                  value={picked}
                  onChange={setPicked}
                />
              </div>
            </>
          ))}
        {way === 'ask' && <p className={s.quiet}>{t.askAbout}</p>}
        {error !== undefined && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}

/* ---- changing one ---- */

export interface EditRunnableText {
  title: (label: string) => string
  name: string
  namePlaceholder: string
  command: string
  /** Under its command, who said how it runs. */
  from: Record<RunFrom, string>
  own: string
  repository: string
  remove: string
  cancel: string
  save: string
}

export const editRunnableText: EditRunnableText = {
  title: (label) => `Edit ${label}`,
  name: 'Name',
  namePlaceholder: 'What it is, in a word or two',
  command: 'Command',
  from: {
    repository: 'Worked out from the repository. Changing it keeps yours instead.',
    person: 'Added by you.',
    coordinator: 'Added by the coordinator.',
    agent: 'Kept by an agent.',
  },
  own: 'Its repository’s own way to run, which follows the repository as it changes until you change it here.',
  repository: 'Repository',
  remove: 'Remove',
  cancel: 'Cancel',
  save: 'Save',
}

export interface EditRunnableProps {
  name: string | null
  command: string
  /** It is its repository's own way to run, with no command of its own. */
  own: boolean
  from: RunFrom
  /** The repository it runs in, and the project's, where there are several to move it to. */
  repository: string
  repositories: readonly string[]
  /** Saves it; a null command keeps it its repository's own way. */
  onSave: (runnable: { name: string | null; command: string | null; repository: string }) => void
  onRemove: () => void
  onClose: () => void
  busy?: boolean
  error?: string
  text?: Partial<EditRunnableText>
}

export function EditRunnable({
  name: was,
  command: running,
  own,
  from,
  repository: where,
  repositories,
  onSave,
  onRemove,
  onClose,
  busy = false,
  error,
  text,
}: EditRunnableProps) {
  const t = { ...editRunnableText, ...text }
  const ids = useId()
  const [name, setName] = useState(was ?? '')
  const [command, setCommand] = useState(running)
  const [repository, setRepository] = useState(where)
  // Its own way stays its own unless its command is changed.
  const kept = own && command.trim() === running ? null : command.trim()
  return (
    <Dialog
      title={t.title(was ?? running)}
      onClose={onClose}
      onSubmit={() => {
        if (command.trim() !== '' && !busy) onSave({ name: name.trim() === '' ? null : name.trim(), command: kept, repository })
      }}
      width={600}
      actions={
        <>
          <Button type="button" variant="danger" icon="close" onClick={onRemove} className={s.remove}>
            {t.remove}
          </Button>
          <Button type="button" variant="quiet" onClick={onClose}>
            {t.cancel}
          </Button>
          <Button type="submit" variant="ink" disabled={command.trim() === ''} busy={busy}>
            {t.save}
          </Button>
        </>
      }
    >
      <div className={s.rows}>
        <FormRow label={t.name} htmlFor={`${ids}-name`}>
          <Field
            id={`${ids}-name`}
            className={s.wide}
            value={name}
            placeholder={t.namePlaceholder}
            onChange={(event) => setName(event.target.value)}
          />
        </FormRow>
        <FormRow label={t.command} htmlFor={`${ids}-command`} note={own ? t.own : t.from[from]}>
          <Field
            id={`${ids}-command`}
            className={s.wide}
            value={command}
            spellCheck={false}
            onChange={(event) => setCommand(event.target.value)}
          />
        </FormRow>
        {repositories.length > 1 && (
          <FormRow label={t.repository}>
            <Select<string> value={repository} onChange={setRepository} options={repositories.map((one) => ({ value: one, label: one }))} />
          </FormRow>
        )}
      </div>
      {error !== undefined && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
    </Dialog>
  )
}

/* ---- the whole list ---- */

/** One of what the project runs, as the list shows it. */
export interface ListedRunnable {
  id: string
  name?: string
  command: string
  /** Where it runs and who said how, in a line: althar · Added by you. */
  about: string
}

export interface RunnablesText {
  title: (project: string) => string
  description: string
  default: string
  makeDefault: string
  /** Its grip, to drag it by or move it with the arrow keys. */
  move: (label: string) => string
  moveKeys: string
  edit: (label: string) => string
  remove: (label: string) => string
  add: string
  empty: string
  done: string
}

export const runnablesText: RunnablesText = {
  title: (project) => `What ${project} runs`,
  description: 'Drag them into the order you want. The first is the default: a single press of Run runs it.',
  default: 'Default',
  makeDefault: 'Make default',
  move: (label) => `Drag to move ${label}`,
  moveKeys: '↑ ↓',
  edit: (label) => `Edit ${label}`,
  remove: (label) => `Remove ${label}`,
  add: 'Add something to run',
  empty: 'Nothing to run yet.',
  done: 'Done',
}

export interface RunnablesProps {
  project: string
  /** What the project runs, in its order: the first is its default. */
  runnables: readonly ListedRunnable[]
  /** Puts them in a new order, every one by id: the first is the default. */
  onOrder: (ids: readonly string[]) => void
  /** Makes one the default: first in the list. */
  onDefault: (id: string) => void
  onEdit: (id: string) => void
  onRemove: (id: string) => void
  onAdd: () => void
  onClose: () => void
  /** What went wrong ordering or removing one. */
  error?: string
  text?: Partial<RunnablesText>
}

/** A row being dragged: the rows as they stood when it was picked up, how far it has come, and where it would land. */
interface Dragged {
  pointer: number
  from: number
  /** Where the pointer went down. */
  y: number
  /** Where each row stood. */
  rows: readonly { top: number; height: number }[]
  dy: number
  to: number
  /** It has gone far enough to be a drag, not a press. */
  lifted: boolean
}

/**
 * How far a row dragged has come, the pointer at `y`, its edges within the
 * list; and where it would land: past each row whose middle its edge has
 * reached.
 */
const follow = ({ rows, from, y: start }: Dragged, y: number) => {
  const first = rows[0]
  const last = rows.at(-1)
  const it = rows[from]
  if (first === undefined || last === undefined || it === undefined) return { dy: 0, to: from }
  const dy = Math.min(Math.max(y - start, first.top - it.top), last.top + last.height - (it.top + it.height))
  const top = it.top + dy
  const passed = (row: { top: number; height: number }, at: number) =>
    at < from ? row.top + row.height / 2 <= top : at > from && row.top + row.height / 2 <= top + it.height
  return { dy, to: rows.filter(passed).length }
}

/** The ids, the one at `from` moved to `to`. */
const moved = (ids: readonly string[], from: number, to: number) => {
  const rest = ids.filter((_, at) => at !== from)
  return [...rest.slice(0, to), ...ids.slice(from, from + 1), ...rest.slice(to)]
}

/** Where a row shows while another is dragged: that one where it would land, each it passed a place along. */
const placeOf = (at: number, { from, to }: Dragged) =>
  at === from ? to : from < at && at <= to ? at - 1 : to <= at && at < from ? at + 1 : at

export function Runnables({ project, runnables, onOrder, onDefault, onEdit, onRemove, onAdd, onClose, error, text }: RunnablesProps) {
  const t = { ...runnablesText, ...text }
  const list = useRef<HTMLOListElement>(null)
  const [dragged, setDragged] = useState<Dragged | null>(null)
  // The order it was put in shows until the list it is given changes, or says what went wrong, so a row dropped doesn't jump back while it is kept.
  const given = [...runnables.map((one) => one.id), error ?? ''].join('\n')
  const [put, setPut] = useState<{ given: string; ids: readonly string[] } | null>(null)
  const shown = put?.given === given ? put.ids.flatMap((id) => runnables.filter((one) => one.id === id)) : runnables
  const ids = shown.map((one) => one.id)
  // Moved with the arrow keys, its grip keeps the focus wherever its row goes.
  const refocus = useRef<string | null>(null)

  const order = (from: number, to: number) => {
    if (to === from || to < 0 || to >= ids.length) return
    const next = moved(ids, from, to)
    setPut({ given, ids: next })
    onOrder(next)
  }

  // A row is picked up by its grip or its words, not by its buttons.
  const pickUp = (event: Press<HTMLLIElement>, from: number) => {
    if (!event.isPrimary || event.button !== 0 || (event.target as Element).closest('button:not([data-grip]), a') !== null) return
    event.preventDefault()
    setDragged({
      pointer: event.pointerId,
      from,
      y: event.clientY,
      rows: [...(list.current?.children ?? [])].map((row) => {
        const box = row.getBoundingClientRect()
        return { top: box.top, height: box.height }
      }),
      dy: 0,
      to: from,
      lifted: false,
    })
  }

  useLayoutEffect(() => {
    const id = refocus.current
    refocus.current = null
    if (id !== null)
      [...(list.current?.querySelectorAll<HTMLElement>('[data-grip]') ?? [])].find((grip) => grip.dataset.grip === id)?.focus()
    if (dragged === null) return
    const move = (event: PointerEvent) => {
      if (event.pointerId !== dragged.pointer) return
      const { dy, to } = follow(dragged, event.clientY)
      setDragged({ ...dragged, dy, to, lifted: dragged.lifted || Math.abs(dy) > 3 })
    }
    const drop = (event: PointerEvent) => {
      if (event.pointerId !== dragged.pointer) return
      setDragged(null)
      order(dragged.from, follow(dragged, event.clientY).to)
    }
    const cancel = () => setDragged(null)
    // Escape puts it back where it was, and leaves the dialog open.
    const back = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setDragged(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', drop)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', back, true)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', drop)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', back, true)
    }
  })

  const moving = dragged?.lifted === true ? dragged : null
  return (
    <Dialog
      title={t.title(project)}
      description={t.description}
      onClose={onClose}
      width={640}
      actions={
        <>
          <Button variant="quiet" icon="plus" onClick={onAdd} className={s.remove}>
            {t.add}
          </Button>
          {/* oxlint-disable-next-line jsx-a11y/no-autofocus -- a dialog takes focus anyway: here, not on a grip, whose tooltip would open over the list */}
          <Button variant="ink" onClick={onClose} autoFocus>
            {t.done}
          </Button>
        </>
      }
    >
      {shown.length === 0 ? (
        <p className={s.quiet}>{t.empty}</p>
      ) : (
        <ol ref={list} className={cx(s.list, moving !== null && s.sorting)}>
          {shown.map((one, at) => {
            const label = one.name ?? one.command
            const place = moving === null ? at : placeOf(at, moving)
            const lifted = moving?.from === at
            // The one dragged follows the pointer; those it passed make way for it.
            const by = moving === null ? 0 : lifted ? moving.dy : (place - at) * (moving.rows[moving.from]?.height ?? 0)
            return (
              <li
                key={one.id}
                className={cx(s.item, lifted && s.lifted)}
                style={by === 0 ? undefined : { transform: `translateY(${by}px)` }}
                onPointerDown={(event) => pickUp(event, at)}
              >
                <IconButton
                  icon="grip"
                  size="small"
                  label={t.move(label)}
                  kbd={t.moveKeys}
                  tooltipShut={dragged !== null}
                  className={s.grip}
                  data-grip={one.id}
                  onKeyDown={(event) => {
                    const step = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0
                    if (step === 0) return
                    event.preventDefault()
                    refocus.current = one.id
                    order(at, at + step)
                  }}
                />
                <span className={s.words}>
                  <span className={s.name}>{label}</span>
                  {one.name !== undefined && <code className={s.command}>{one.command}</code>}
                  <span className={s.about}>{one.about}</span>
                </span>
                {place === 0 ? (
                  <span className={s.default}>{t.default}</span>
                ) : (
                  <LinkButton reveal onClick={() => onDefault(one.id)}>
                    {t.makeDefault}
                  </LinkButton>
                )}
                <IconButton icon="pencil" size="small" label={t.edit(label)} onClick={() => onEdit(one.id)} />
                <IconButton icon="close" size="small" tone="danger" label={t.remove(label)} onClick={() => onRemove(one.id)} />
              </li>
            )
          })}
        </ol>
      )}
      {error !== undefined && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
    </Dialog>
  )
}
