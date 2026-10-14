import { useId, useState } from 'react'

import type { AddWay, RunFrom } from '../../chrome/RunButton/RunButton'
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
 * What a project runs, kept by the person (ADR-036): adding something more to
 * run, three ways (typing its command, picking from the repository's
 * package.json scripts, or asking the coordinator to work it out); changing
 * one; and the whole list, in the person's order, the first its default, to
 * reorder, edit and remove. Each is a dialog the consumer mounts to open.
 */

/* ---- adding one ---- */

/** A script in the project's package.json files, not kept yet. */
export interface PickableScript {
  id: string
  /** The command that runs it from its repository's root: `bun --filter @althar/ui storybook`. */
  command: string
  /** What the script itself says. */
  body: string
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
  const found = (scripts ?? []).filter((one) => `${one.command} ${one.body}`.toLowerCase().includes(find.trim().toLowerCase()))
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
                  items={found.map((one) => ({ id: one.id, label: `${one.command}  ·  ${one.body}` }))}
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
  up: (label: string) => string
  down: (label: string) => string
  edit: (label: string) => string
  remove: (label: string) => string
  add: string
  empty: string
  done: string
}

export const runnablesText: RunnablesText = {
  title: (project) => `What ${project} runs`,
  description: 'In the order they show. The first is the default: a single press of Run runs it.',
  default: 'Default',
  makeDefault: 'Make default',
  up: (label) => `Move ${label} up`,
  down: (label) => `Move ${label} down`,
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
  /** Moves one up or down the list. */
  onMove: (id: string, by: -1 | 1) => void
  /** Makes one the default: first in the list. */
  onDefault: (id: string) => void
  onEdit: (id: string) => void
  onRemove: (id: string) => void
  onAdd: () => void
  onClose: () => void
  text?: Partial<RunnablesText>
}

export function Runnables({ project, runnables, onMove, onDefault, onEdit, onRemove, onAdd, onClose, text }: RunnablesProps) {
  const t = { ...runnablesText, ...text }
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
          <Button variant="ink" onClick={onClose}>
            {t.done}
          </Button>
        </>
      }
    >
      {runnables.length === 0 ? (
        <p className={s.quiet}>{t.empty}</p>
      ) : (
        <ol className={s.list}>
          {runnables.map((one, at) => {
            const label = one.name ?? one.command
            return (
              <li key={one.id} className={s.item}>
                <span className={s.words}>
                  <span className={s.name}>{label}</span>
                  {one.name !== undefined && <code className={s.command}>{one.command}</code>}
                  <span className={s.about}>{one.about}</span>
                </span>
                {at === 0 ? (
                  <span className={s.default}>{t.default}</span>
                ) : (
                  <LinkButton reveal onClick={() => onDefault(one.id)}>
                    {t.makeDefault}
                  </LinkButton>
                )}
                <IconButton icon="up" size="small" label={t.up(label)} disabled={at === 0} onClick={() => onMove(one.id, -1)} />
                <IconButton
                  icon="down"
                  size="small"
                  label={t.down(label)}
                  disabled={at === runnables.length - 1}
                  onClick={() => onMove(one.id, 1)}
                />
                <IconButton icon="pencil" size="small" label={t.edit(label)} onClick={() => onEdit(one.id)} />
                <IconButton icon="close" size="small" tone="danger" label={t.remove(label)} onClick={() => onRemove(one.id)} />
              </li>
            )
          })}
        </ol>
      )}
    </Dialog>
  )
}
