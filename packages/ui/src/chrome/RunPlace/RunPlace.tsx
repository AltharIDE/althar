import { type KeyboardEvent, useId, useRef, useState } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { useControlled } from '../../lib/controlled'
import { cx } from '../../lib/cx'
import { branchNameable } from '../../primitives/BranchSelect/BranchSelect'
import { Button } from '../../primitives/Button/Button'
import { Popover } from '../../primitives/Popover/Popover'
import { Problem } from '../../primitives/Problem/Problem'
import { Spinner } from '../../primitives/Spinner/Spinner'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import s from './RunPlace.module.css'

/*
 * Where the project's Run runs (ADR-090), beside it, as a branch switcher is:
 * the default branch, a task's worktree, or a pull request or branch the
 * remote has, which Althar fetches as it runs (ADR-066). Picked, it stays
 * until another is. It opens on a field: what the remote has is asked as it
 * opens, so it's fresh; a pull request's number typed that the list doesn't
 * have is still offered, and, where the consumer can make one, a branch's
 * name that no branch has; the arrows move, Enter picks, Escape closes. Each
 * place says, quietly, what runs there, and a failure there in red, so a run
 * left going is found where it runs.
 *
 * In a project of several repositories each one has its own branch (the one
 * its Run copies), so the list is grouped by repository: its default first,
 * its pull requests, its branches, and the group says where that repository
 * is now. The first row sums them up, and a repository moved off its default
 * stands out. A host Althar has no connection to is named in a band above the
 * places, with a way to connect it.
 */

/** Something to run on from the remote: an open pull request, or a branch. */
export type BranchChoice =
  | {
      readonly kind: 'pull'
      readonly number: number
      /** As its host writes it: PR #12, MR !12. */
      readonly name: string
      readonly title: string
      readonly branch?: string
      readonly author?: string
      readonly draft?: boolean
      /** Its branch is on a fork. */
      readonly fork?: boolean
      /** Its repository, where the project has several. */
      readonly repository?: string
    }
  | { readonly kind: 'branch'; readonly branch: string; readonly repository?: string }

/** One choice's key, among the rest: the key of the place it becomes. */
export const choiceKey = (choice: BranchChoice) =>
  `${choice.repository ?? ''}:${choice.kind === 'pull' ? `#${choice.number}` : choice.branch}`

/** Where Run runs. */
export interface RunPlace {
  /** `main`, `task:<id>`, or a choice's key. */
  readonly key: string
  readonly kind: 'main' | 'task' | 'pull' | 'branch'
  /** The default branch's name, a task's title, a pull request's number (PR #12), a branch. */
  readonly label: string
  /** Quieter, after it: a pull request's title. */
  readonly detail?: string
  /** What runs there now, by name. */
  readonly running?: readonly string[]
  /** What failed there, in a few words. */
  readonly failed?: string
  /** The choice it is, for a pull request or branch. */
  readonly choice?: BranchChoice
  /** Its label sums up several repositories' branches, not one branch's name. */
  readonly several?: boolean
}

/** One of a project's several repositories, and the branch its Run copies now. */
export interface RunRepository {
  readonly name: string
  readonly defaultBranch: string
  /** What Run copies of it: the branch new tasks work toward, else its default. */
  readonly branch: string
}

/** A choice as a place to run on. */
export const placeOf = (choice: BranchChoice): RunPlace =>
  choice.kind === 'pull'
    ? { key: choiceKey(choice), kind: 'pull', label: choice.name, detail: choice.title, choice }
    : { key: choiceKey(choice), kind: 'branch', label: choice.branch, choice }

export interface RunPlaceText {
  label: string
  find: string
  tasks: string
  pulls: string
  branches: string
  loading: string
  /** Searching the host's other open pull requests for what is typed. */
  searching: string
  none: (query: string) => string
  count: (n: number) => string
  /** A number typed that the list doesn't have. */
  typed: (number: number) => string
  draft: string
  fork: string
  /** A name typed that no branch has, to make: Create release/0.9.0; quieter, where it starts. */
  create: string
  from: (branch: string) => string
  /** A repository's default branch, in its heading. */
  defaultIs: string
  /** Quieter, on a repository's default branch. */
  isDefault: string
  /** Under a host Althar has no connection to. */
  needsConnection: string
  connect: string
  connectHost: (host: string) => string
}

export const runPlaceText: RunPlaceText = {
  label: 'Where Run runs',
  find: 'Find a task, pull request or branch',
  tasks: 'Tasks',
  pulls: 'Pull requests',
  branches: 'Branches',
  loading: 'Asking the remote…',
  searching: 'Searching its other pull requests…',
  none: (query) => `Nothing matches “${query}”`,
  count: (n) => (n === 1 ? '1 place' : `${n} places`),
  typed: (number) => `Pull request #${number}`,
  draft: 'Draft',
  fork: 'From a fork',
  create: 'Create',
  from: (branch) => `from ${branch}`,
  defaultIs: 'default',
  isDefault: 'Default',
  needsConnection: 'Pull requests need a connection',
  connect: 'Connect',
  connectHost: (host) => `Connect ${host}`,
}

export interface RunPlaceProps {
  /** Where Run runs now. */
  current: RunPlace
  /** The default branch, the tasks it can run in, and the pull requests and branches something runs or failed on: those are listed whatever the remote says. */
  places: readonly RunPlace[]
  /** What the remote has to run on, pull requests first; null while Althar asks it. */
  remote: readonly BranchChoice[] | null
  /** A line at its foot: what picking a branch does. */
  note?: string
  /** Why it lists less than it might, as the remote out of reach: at its foot, said as a problem, in place of the note. */
  problem?: string
  /**
   * Makes a branch the remote doesn't have, from `createFrom`: a row, last,
   * for a name typed that no branch has; one for each of `repositories`
   * where the project has several, with the repository's name.
   */
  onCreate?: (branch: string, repository?: string) => void
  createFrom?: string
  repositories?: readonly RunRepository[]
  /** Hosts of its repositories' remotes that Althar has no connection to, by name: their pull requests aren't listed. */
  hosts?: readonly string[]
  /** Connects a host: opens where it is done. Without it, the host is named only. */
  onConnect?: (host: string) => void
  /** What is typed is being searched on the host, past the pull requests listed. */
  searching?: boolean
  query?: string
  defaultQuery?: string
  onQueryChange?: (query: string) => void
  /** Picks where Run runs. */
  onPick: (place: RunPlace) => void
  open?: boolean
  defaultOpen?: boolean
  /** It opens: the consumer asks the remote then. */
  onOpenChange?: (open: boolean) => void
  text?: Partial<RunPlaceText>
}

/** What a choice is found by: its number, title, branch, author and repository. */
const wordsOf = (choice: BranchChoice) =>
  (choice.kind === 'pull'
    ? `${choice.name} ${choice.number} ${choice.title} ${choice.branch ?? ''} ${choice.author ?? ''}`
    : choice.branch
  ).toLowerCase() + ` ${choice.repository?.toLowerCase() ?? ''}`

/** The words typed, each found in it; a leading # or ! is the number's. */
const matches = (words: string, haystack: string) =>
  words
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word.replace(/^[#!](?=\d)/, '')))

/** The choices the words find, in their order; a pull request's number typed that none has comes first. */
export const found = (choices: readonly BranchChoice[], query: string, t: Pick<RunPlaceText, 'typed'> = runPlaceText) => {
  const matched = choices.filter((choice) => matches(query, wordsOf(choice)))
  const number = /^[#!]?(\d+)$/.exec(query.trim())?.[1]
  if (number === undefined || choices.some((choice) => choice.kind === 'pull' && choice.number === Number(number))) return matched
  return [{ kind: 'pull', number: Number(number), name: `#${number}`, title: t.typed(Number(number)) } as const, ...matched]
}

/** A pull request or branch, whatever its repository says: what a run on it was fetched as. */
const sameRef = (one: RunPlace, other: RunPlace) =>
  one.kind === other.kind &&
  one.choice !== undefined &&
  other.choice !== undefined &&
  (one.choice.kind === 'pull' && other.choice.kind === 'pull'
    ? one.choice.number === other.choice.number
    : one.choice.kind === 'branch' && other.choice.kind === 'branch' && one.choice.branch === other.choice.branch) &&
  (one.choice.repository === undefined || other.choice.repository === undefined || one.choice.repository === other.choice.repository)

/** Within a repository's group: its default branch, then pull requests, then its other branches. */
const rank = (place: RunPlace, repository: RunRepository) =>
  place.choice?.kind === 'branch' && place.choice.branch === repository.defaultBranch ? 0 : place.kind === 'pull' ? 1 : 2

const glyphOf = (kind: RunPlace['kind']) => (kind === 'pull' ? 'pr' : kind === 'task' ? 'agents' : 'branch')

export function RunPlacePicker({
  current,
  places,
  remote,
  note,
  problem,
  searching = false,
  query,
  defaultQuery = '',
  onQueryChange,
  onPick,
  onCreate,
  createFrom,
  repositories,
  hosts,
  onConnect,
  open,
  defaultOpen,
  onOpenChange,
  text,
}: RunPlaceProps) {
  const t = { ...runPlaceText, ...text }
  const [opened, setOpened] = useControlled(open, defaultOpen ?? false, onOpenChange)
  return (
    <Popover
      label={t.label}
      placement="below"
      align="end"
      width={520}
      padded={false}
      open={opened}
      onOpenChange={setOpened}
      trigger={
        <Button size="small" variant="quiet" icon={glyphOf(current.kind)} trailingIcon="chevronD" className={s.chip} title={t.label}>
          <span className={cx(s.chipLabel, (current.kind === 'main' || current.kind === 'branch') && current.several !== true && s.mono)}>
            {current.label}
          </span>
        </Button>
      }
    >
      <Places
        current={current}
        places={places}
        remote={remote}
        {...(note === undefined ? {} : { note })}
        {...(problem === undefined ? {} : { problem })}
        searching={searching}
        {...(query === undefined ? {} : { query })}
        defaultQuery={defaultQuery}
        {...(onQueryChange === undefined ? {} : { onQueryChange })}
        onPick={(place) => {
          // A row to make a branch makes it; any other picks where Run runs.
          const made = madeOf(place)
          if (made !== null) onCreate?.(made.branch, made.repository)
          else onPick(place)
          setOpened(false)
        }}
        creates={onCreate === undefined ? [] : (repositories?.map((one) => one.name) ?? [undefined])}
        {...(repositories === undefined || repositories.length < 2 ? {} : { repositories })}
        hosts={hosts ?? []}
        {...(onConnect === undefined ? {} : { onConnect })}
        {...(createFrom === undefined ? {} : { createFrom })}
        t={t}
      />
    </Popover>
  )
}

/** The rows that make a branch, among the places: keyed apart, so none is ever a place Run runs. */
const MADE = 'new:'
const madeOf = (place: RunPlace) =>
  place.key.startsWith(MADE) && place.choice?.kind === 'branch'
    ? { branch: place.choice.branch, ...(place.choice.repository === undefined ? {} : { repository: place.choice.repository }) }
    : null

/** The open picker: a field, then the places it finds, grouped. */
function Places({
  current,
  places,
  remote,
  note,
  problem,
  searching,
  query,
  defaultQuery,
  onQueryChange,
  onPick,
  creates,
  createFrom,
  repositories,
  hosts,
  onConnect,
  t,
}: Omit<
  RunPlaceProps,
  'open' | 'defaultOpen' | 'onOpenChange' | 'text' | 'defaultQuery' | 'searching' | 'onCreate' | 'repositories' | 'createFrom' | 'hosts'
> & {
  /** Set where the project has several: the list is grouped by them. */
  repositories?: readonly RunRepository[]
  hosts: readonly string[]
  defaultQuery: string
  searching: boolean
  /** Each repository a typed name is offered to be made in; undefined for the project's one. */
  creates: readonly (string | undefined)[]
  createFrom?: string
  t: RunPlaceText
}) {
  const [words, setWords] = useControlled(query, defaultQuery, onQueryChange)
  const [active, setActive] = useState(0)
  const field = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const ids = useId()
  const typed = words.trim() !== ''

  const fits = (place: RunPlace) =>
    place.choice === undefined
      ? matches(words, `${place.label} ${place.detail ?? ''}`.toLowerCase())
      : matches(words, wordsOf(place.choice))
  const known = places.filter(fits)
  // What the remote has, past what is listed already.
  const fresh = (remote === null ? [] : found(remote, words, t)).map(placeOf).filter((place) => !places.some((one) => sameRef(one, place)))
  // Several repositories: each has its own group, and its default branch is always there to go back to.
  const choiceOf = (place: RunPlace, repository: string) => place.choice?.repository === repository
  const defaults: RunPlace[] = (repositories ?? [])
    .map((one) => placeOf({ kind: 'branch', branch: one.defaultBranch, repository: one.name }))
    .filter((place) => fits(place) && ![...known, ...fresh].some((one) => sameRef(one, place)))
  // A name typed that no branch has, where git takes it: offered to be made, last.
  const name = words.trim()
  const named = (place: RunPlace) => place.choice?.kind === 'branch' && place.choice.branch === name
  const made: RunPlace[] =
    remote === null || !branchNameable(name) || [...places, ...fresh, ...defaults].some(named)
      ? []
      : creates.map((repository) => ({
          key: `${MADE}${repository ?? ''}:${name}`,
          kind: 'branch',
          label: name,
          choice: { kind: 'branch', branch: name, ...(repository === undefined ? {} : { repository }) },
        }))
  const refs = [...known, ...fresh, ...defaults].filter((place) => place.kind === 'pull' || place.kind === 'branch')
  const byRepository = (one: RunRepository): RunPlace[] =>
    refs.filter((place) => choiceOf(place, one.name)).toSorted((a, b) => rank(a, one) - rank(b, one))
  const groupedBy = new Set((repositories ?? []).map((one) => one.name))
  const loose = refs.filter((place) => repositories === undefined || !groupedBy.has(place.choice?.repository ?? ''))
  const several = repositories !== undefined
  const groups: { key: string; label: string | null; repository?: RunRepository; places: RunPlace[] }[] = (
    several
      ? [
          { key: 'main', label: null, places: known.filter((place) => place.kind === 'main') },
          { key: 'tasks', label: t.tasks, places: known.filter((place) => place.kind === 'task') },
          ...repositories.map((one) => ({ key: `in:${one.name}`, label: one.name, repository: one, places: byRepository(one) })),
          { key: 'pulls', label: t.pulls, places: loose.filter((place) => place.kind === 'pull') },
          { key: 'branches', label: t.branches, places: [...loose.filter((place) => place.kind === 'branch'), ...made] },
        ]
      : [
          { key: 'main', label: null, places: known.filter((place) => place.kind === 'main') },
          { key: 'tasks', label: t.tasks, places: known.filter((place) => place.kind === 'task') },
          { key: 'pulls', label: t.pulls, places: [...known, ...fresh].filter((place) => place.kind === 'pull') },
          { key: 'branches', label: t.branches, places: [...[...known, ...fresh].filter((place) => place.kind === 'branch'), ...made] },
        ]
  ).filter((group) => group.places.length > 0)
  const rows = groups.flatMap((group) => group.places)
  const at = Math.min(active, Math.max(rows.length - 1, 0))
  const optionId = (index: number) => `${ids}-${index}`

  const move = (to: number) => {
    setActive(to)
    list.current?.querySelector(`#${CSS.escape(optionId(to))}`)?.scrollIntoView({ block: 'nearest' })
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'ArrowDown') move(Math.min(at + 1, rows.length - 1))
    else if (event.key === 'ArrowUp') move(Math.max(at - 1, 0))
    else if (event.key === 'Enter') {
      const place = rows[at]
      if (place !== undefined) onPick(place)
    } else return
    event.preventDefault()
  }

  // Where Run runs: the place itself, or, of several repositories, the branch each one's Run copies now.
  const isCurrent = (place: RunPlace) =>
    place.key === current.key ||
    (current.kind === 'main' &&
      place.choice?.kind === 'branch' &&
      repositories?.some((one) => one.name === place.choice?.repository && one.branch === place.choice.branch) === true)

  const row = (place: RunPlace, index: number, grouped: boolean) => {
    const choice = place.choice
    const repository = repositories?.find((one) => one.name === choice?.repository)
    // Quieter, under a pull request's title: its branch, its author, a draft or a fork's; and the repository, of several.
    const meta =
      choice === undefined
        ? []
        : [
            ...(choice.kind === 'pull'
              ? [
                  { text: choice.branch, mono: true },
                  { text: choice.author },
                  { text: choice.draft === true ? t.draft : undefined },
                  { text: choice.fork === true ? t.fork : undefined },
                ]
              : []),
            { text: madeOf(place) === null || createFrom === undefined ? undefined : t.from(createFrom) },
            { text: grouped && madeOf(place) === null ? undefined : choice.repository },
          ].filter((part): part is { text: string; mono?: boolean } => part.text !== undefined && part.text !== '')
    // Of several repositories, what each runs: the first row says them all, the default branch says so.
    const parts =
      place.kind === 'main' && place.several === true && repositories !== undefined
        ? repositories.map((one) => ({ text: `${one.name} ${one.branch}` }))
        : repository !== undefined && choice?.kind === 'branch' && choice.branch === repository.defaultBranch
          ? [{ text: t.isDefault }, ...meta]
          : meta
    return (
      // A press picks it; focus stays in the field, which owns the keys.
      <div
        key={place.key}
        id={optionId(index)}
        role="option"
        aria-selected={index === at}
        className={s.row}
        onMouseDown={(event) => event.preventDefault()}
        onMouseMove={() => {
          if (index !== at) setActive(index)
        }}
        onClick={() => onPick(place)}
      >
        <span className={s.check}>{isCurrent(place) && <Icon name="check" size={12} />}</span>
        <Icon name={madeOf(place) === null ? glyphOf(place.kind) : 'plus'} size={13} className={s.glyph} />
        <span className={s.main}>
          <span className={s.head}>
            {place.kind === 'pull' ? (
              <>
                <span className={s.title}>{place.detail ?? place.label}</span>
                <span className={s.number}>{place.label}</span>
              </>
            ) : madeOf(place) !== null ? (
              <span className={s.title}>
                {t.create} <span className={s.mono}>{place.label}</span>
              </span>
            ) : (
              <span className={cx(s.title, (place.kind === 'main' || place.kind === 'branch') && place.several !== true && s.mono)}>
                {place.label}
              </span>
            )}
          </span>
          {parts.length > 0 && (
            <span className={s.meta}>
              {parts.map((part, n) => (
                <span key={part.text} className={cx('mono' in part && part.mono === true && s.mono)}>
                  {n > 0 && ' · '}
                  {part.text}
                </span>
              ))}
            </span>
          )}
        </span>
        {place.failed !== undefined ? (
          <span className={cx(s.there, s.bad)}>{place.failed}</span>
        ) : place.running !== undefined && place.running.length > 0 ? (
          <span className={s.there}>{place.running.join(', ')}</span>
        ) : null}
      </div>
    )
  }

  let index = 0
  return (
    <div className={s.picker}>
      <div className={s.field}>
        <Icon name="search" size={13} className={s.glyph} />
        <input
          ref={field}
          // It opens on its field, the first the popover focuses: you arrive typing.
          type="text"
          role="combobox"
          aria-label={t.find}
          placeholder={t.find}
          aria-expanded={rows.length > 0}
          aria-controls={rows.length === 0 ? undefined : `${ids}-list`}
          aria-autocomplete="list"
          aria-activedescendant={rows.length === 0 ? undefined : optionId(at)}
          autoComplete="off"
          spellCheck={false}
          value={words}
          onChange={(event) => {
            setWords(event.target.value)
            setActive(0)
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      <span aria-live="polite">
        {typed && <VisuallyHidden>{rows.length === 0 ? t.none(words.trim()) : t.count(rows.length)}</VisuallyHidden>}
      </span>
      {hosts.map((host) => (
        <div key={host} className={s.host}>
          <Icon name="plug" size={13} className={s.glyph} />
          <span className={s.hostWords}>
            <span className={s.hostName} title={host}>
              {host}
            </span>
            <span className={s.hostWhat}>{t.needsConnection}</span>
          </span>
          {onConnect !== undefined && (
            <Button size="small" aria-label={t.connectHost(host)} onClick={() => onConnect(host)}>
              {t.connect}
            </Button>
          )}
        </div>
      ))}
      <div className={s.results}>
        {rows.length > 0 && (
          <div ref={list} id={`${ids}-list`} role="listbox" aria-label={t.find}>
            {groups.map((group) => (
              <div
                key={group.key}
                role="group"
                className={cx(group.repository !== undefined && s.repository)}
                {...(group.label === null ? {} : { 'aria-label': group.label })}
              >
                {group.repository !== undefined ? (
                  <div className={s.repositoryHead} aria-hidden="true">
                    <span className={s.repositoryName}>{group.repository.name}</span>
                    <span className={s.repositoryDefault}>
                      {t.defaultIs} <span className={s.mono}>{group.repository.defaultBranch}</span>
                    </span>
                    {group.repository.branch !== group.repository.defaultBranch && (
                      <span className={cx(s.repositoryNow, s.mono)}>{group.repository.branch}</span>
                    )}
                  </div>
                ) : (
                  group.label !== null && (
                    <div className={s.label} aria-hidden="true">
                      {group.label}
                    </div>
                  )
                )}
                {group.places.map((place) => row(place, index++, group.repository !== undefined))}
              </div>
            ))}
          </div>
        )}
        {remote === null && (
          <p className={s.quiet}>
            <Spinner size="small" />
            {t.loading}
          </p>
        )}
        {typed && remote !== null && searching && (
          <p className={s.quiet}>
            <Spinner size="small" />
            {t.searching}
          </p>
        )}
        {typed && remote !== null && !searching && rows.length === 0 && <p className={s.quiet}>{t.none(words.trim())}</p>}
      </div>
      {problem !== undefined ? (
        <div className={s.note}>
          <Problem size="small">{problem}</Problem>
        </div>
      ) : (
        note !== undefined && <p className={s.note}>{note}</p>
      )}
    </div>
  )
}
