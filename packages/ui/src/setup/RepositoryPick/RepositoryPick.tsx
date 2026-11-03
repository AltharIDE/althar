import { Checkbox } from 'radix-ui'
import { useId, useRef, useState, type KeyboardEvent } from 'react'

import { device } from '../../foundations/device'
import { Icon } from '../../foundations/Icon/Icon'
import { modKey } from '../../foundations/keys'
import { cx } from '../../lib/cx'
import { Button } from '../../primitives/Button/Button'
import s from './RepositoryPick.module.css'

/*
 * A project's repositories, picked: first a folder chosen from anywhere,
 * as a new project picks one, then the repositories found where people
 * keep code, each ticked in or left out. A field over them finds one by its
 * name or where it is, as it is typed. The keyboard goes with it: typing
 * finds, ↓ and ↑ walk from the field down the rows and back, Return ticks
 * the row it is on, or from the field the first one found. A row's whole
 * width is its checkbox, with its name, where it is, and what else tells it
 * apart. While they are still being looked for, it says so; where none were
 * found, or none match, it says that too.
 */

/** A repository that could be in the project, as the list shows it. */
export interface RepositoryChoice {
  readonly id: string
  readonly name: string
  /** Where it is, as the person knows the place: ~/Projects/meridian. */
  readonly where: string
  /** What else says which one it is: its branch and when it was last worked on, or that it was just added. */
  readonly facts?: string
}

export interface RepositoryPickText {
  /** What the list is, for a screen reader. */
  label: string
  searching: string
  none: string
  /** The field that finds one, its name and what it shows while empty. */
  find: string
  /** None found by what was typed. */
  noMatch: (typed: string) => string
  add: { title: string; note: string; kbd: string }
}

export const repositoryPickText: RepositoryPickText = {
  label: 'Repositories for the project',
  searching: 'Looking…',
  none: 'None found in the usual places.',
  find: `Find a repository on ${device.this}`,
  noMatch: (typed) => `None match “${typed}”.`,
  add: { title: 'Choose a folder…', note: 'or drop one here', kbd: modKey('N') },
}

export interface RepositoryPickProps {
  /** The repositories found, and any added; null while they are still being looked for. */
  repositories: readonly RepositoryChoice[] | null
  /** The repositories ticked, by id. */
  picked: readonly string[]
  /** Ticks a repository, or unticks it. */
  onPick: (id: string) => void
  /** Asks for a folder to add. */
  onAdd: () => void
  className?: string
  text?: Partial<RepositoryPickText>
}

/** Whether a repository is found by what was typed: every word in its name or where it is, in any case. */
export const matches = (r: RepositoryChoice, typed: string) => {
  const words = typed.toLowerCase().split(/\s+/).filter(Boolean)
  const said = `${r.name} ${r.where}`.toLowerCase()
  return words.every((word) => said.includes(word))
}

/** The repositories a project could be made of: a folder chosen from anywhere, then those found, to find and tick. */
export function RepositoryPick({ repositories, picked, onPick, onAdd, className, text }: RepositoryPickProps) {
  const t = { ...repositoryPickText, ...text }
  const [typed, setTyped] = useState('')
  const field = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const listId = useId()
  const shown = repositories?.filter((r) => matches(r, typed)) ?? []
  const rows = () => Array.from(list.current?.querySelectorAll<HTMLElement>('[role="checkbox"]') ?? [])

  const onField = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      rows()[0]?.focus()
    } else if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey && typed.trim() !== '' && shown[0] !== undefined) {
      event.preventDefault()
      onPick(shown[0].id)
    } else if (event.key === 'Escape' && typed !== '') {
      event.preventDefault()
      setTyped('')
    }
  }
  // On a row: the arrows walk the rows and up out of them to the field, Return ticks as Space does, and typing goes on in the field.
  const onRow = (event: KeyboardEvent<HTMLElement>, id: string) => {
    const all = rows()
    const at = all.indexOf(event.currentTarget)
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const to = event.key === 'ArrowDown' ? all[at + 1] : at === 0 ? field.current : all[at - 1]
      to?.focus()
    } else if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
      event.preventDefault()
      onPick(id)
    } else if (event.key.length === 1 && event.key !== ' ' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      field.current?.focus()
    }
  }

  return (
    <div className={cx(s.pick, className)}>
      <div className={s.choose}>
        <Button size="small" icon="folder" kbd={t.add.kbd} onClick={onAdd}>
          {t.add.title}
        </Button>
        <span className={s.note}>{t.add.note}</span>
      </div>
      <label className={s.find}>
        <Icon name="search" size={14} />
        <input
          ref={field}
          type="search"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={onField}
          aria-label={t.find}
          aria-controls={listId}
          placeholder={t.find}
          disabled={repositories === null || repositories.length === 0}
          spellCheck={false}
          autoComplete="off"
        />
      </label>
      {repositories === null ? (
        <p className={s.quiet} aria-busy="true">
          {t.searching}
        </p>
      ) : (
        <ul ref={list} id={listId} className={s.list} aria-label={t.label}>
          {shown.map((r) => (
            <li key={r.id}>
              {/* The whole row ticks it: a Radix checkbox, named by the row. */}
              <label className={s.repo}>
                <Checkbox.Root
                  checked={picked.includes(r.id)}
                  onCheckedChange={() => onPick(r.id)}
                  onKeyDown={(event) => onRow(event, r.id)}
                  className={s.tick}
                >
                  <Checkbox.Indicator className={s.tickMark}>
                    <Icon name="check" size={11} />
                  </Checkbox.Indicator>
                </Checkbox.Root>
                <span className={s.repoName}>{r.name}</span>
                <span className={s.repoWhere} title={r.where}>
                  {r.where}
                </span>
                {r.facts !== undefined && <span className={s.repoFacts}>{r.facts}</span>}
              </label>
            </li>
          ))}
          {repositories.length === 0 ? (
            <li className={s.quiet}>{t.none}</li>
          ) : (
            shown.length === 0 && <li className={s.quiet}>{t.noMatch(typed.trim())}</li>
          )}
        </ul>
      )}
    </div>
  )
}
