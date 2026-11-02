import { Checkbox } from 'radix-ui'

import { device } from '../../foundations/device'
import { Icon } from '../../foundations/Icon/Icon'
import { modKey } from '../../foundations/keys'
import { cx } from '../../lib/cx'
import { Kbd } from '../../primitives/Kbd/Kbd'
import s from './RepositoryPick.module.css'

/*
 * The repositories found where people keep code, each ticked into a project
 * or left out: a row each, the whole row its checkbox, with its name, where
 * it is, and what else tells it apart. Under them, Add a folder, for one
 * found nowhere. While they are still being looked for, it says so; where
 * none were found, it says that too, and Add a folder stays.
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
  add: { title: string; note: string; kbd: string }
}

export const repositoryPickText: RepositoryPickText = {
  label: 'Repositories for the project',
  searching: 'Looking…',
  none: 'None found in the usual places.',
  add: { title: 'Add a folder…', note: `anywhere on ${device.this}`, kbd: modKey('N') },
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

/** The repositories a project could be made of, to tick, and a way to add one from anywhere. */
export function RepositoryPick({ repositories, picked, onPick, onAdd, className, text }: RepositoryPickProps) {
  const t = { ...repositoryPickText, ...text }
  if (repositories === null)
    return (
      <p className={cx(s.quiet, className)} aria-busy="true">
        {t.searching}
      </p>
    )
  return (
    <ul className={cx(s.pick, className)} aria-label={t.label}>
      {repositories.map((r) => (
        <li key={r.id}>
          {/* The whole row ticks it: a Radix checkbox, named by the row. */}
          <label className={s.repo}>
            <Checkbox.Root checked={picked.includes(r.id)} onCheckedChange={() => onPick(r.id)} className={s.tick}>
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
      {repositories.length === 0 && <li className={s.quiet}>{t.none}</li>}
      <li>
        <button type="button" className={cx(s.repo, s.add)} onClick={onAdd}>
          <span className={cx(s.tick, s.tickAdd)} aria-hidden="true">
            <Icon name="plus" size={11} />
          </span>
          <span className={s.repoName}>{t.add.title}</span>
          <span className={s.repoWhere}>{t.add.note}</span>
          <Kbd className={s.repoFacts}>{t.add.kbd}</Kbd>
        </button>
      </li>
    </ul>
  )
}
