import { type KeyboardEvent, useId, useRef, useState } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { useControlled } from '../../lib/controlled'
import { cx } from '../../lib/cx'
import { Button } from '../../primitives/Button/Button'
import { Popover } from '../../primitives/Popover/Popover'
import { Spinner } from '../../primitives/Spinner/Spinner'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import s from './RunPlace.module.css'

/*
 * Where the project's Run runs (ADR-090), beside it, as a branch switcher is:
 * the default branch, a task's worktree, or a pull request or branch the
 * remote has, which Althar fetches as it runs (ADR-066). Picked, it stays
 * until another is. It opens on a field: what the remote has is asked as it
 * opens, so it's fresh; a pull request's number typed that the list doesn't
 * have is still offered; the arrows move, Enter picks, Escape closes. Each
 * place says, quietly, what runs there, and a failure there in red, so a run
 * left going is found where it runs.
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
}

export interface RunPlaceProps {
  /** Where Run runs now. */
  current: RunPlace
  /** The default branch, the tasks it can run in, and the pull requests and branches something runs or failed on: those are listed whatever the remote says. */
  places: readonly RunPlace[]
  /** What the remote has to run on, pull requests first; null while Althar asks it. */
  remote: readonly BranchChoice[] | null
  /** Why it lists less than it might: the remote out of reach, or no connection to list pull requests. */
  note?: string
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

const glyphOf = (kind: RunPlace['kind']) => (kind === 'pull' ? 'pr' : kind === 'task' ? 'agents' : 'branch')

export function RunPlacePicker({
  current,
  places,
  remote,
  note,
  searching = false,
  query,
  defaultQuery = '',
  onQueryChange,
  onPick,
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
          <span className={cx(s.chipLabel, (current.kind === 'main' || current.kind === 'branch') && s.mono)}>{current.label}</span>
        </Button>
      }
    >
      <Places
        current={current}
        places={places}
        remote={remote}
        {...(note === undefined ? {} : { note })}
        searching={searching}
        {...(query === undefined ? {} : { query })}
        defaultQuery={defaultQuery}
        {...(onQueryChange === undefined ? {} : { onQueryChange })}
        onPick={(place) => {
          onPick(place)
          setOpened(false)
        }}
        t={t}
      />
    </Popover>
  )
}

/** The open picker: a field, then the places it finds, grouped. */
function Places({
  current,
  places,
  remote,
  note,
  searching,
  query,
  defaultQuery,
  onQueryChange,
  onPick,
  t,
}: Omit<RunPlaceProps, 'open' | 'defaultOpen' | 'onOpenChange' | 'text' | 'defaultQuery' | 'searching'> & {
  defaultQuery: string
  searching: boolean
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
  const groups: { label: string | null; places: RunPlace[] }[] = [
    { label: null, places: known.filter((place) => place.kind === 'main') },
    { label: t.tasks, places: known.filter((place) => place.kind === 'task') },
    { label: t.pulls, places: [...known, ...fresh].filter((place) => place.kind === 'pull') },
    { label: t.branches, places: [...known, ...fresh].filter((place) => place.kind === 'branch') },
  ].filter((group) => group.places.length > 0)
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

  const row = (place: RunPlace, index: number) => {
    const choice = place.choice
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
            { text: choice.repository },
          ].filter((part): part is { text: string; mono?: boolean } => part.text !== undefined && part.text !== '')
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
        <span className={s.check}>{place.key === current.key && <Icon name="check" size={12} />}</span>
        <Icon name={glyphOf(place.kind)} size={13} className={s.glyph} />
        <span className={s.main}>
          <span className={s.head}>
            {place.kind === 'pull' ? (
              <>
                <span className={s.title}>{place.detail ?? place.label}</span>
                <span className={s.number}>{place.label}</span>
              </>
            ) : (
              <span className={cx(s.title, (place.kind === 'main' || place.kind === 'branch') && s.mono)}>{place.label}</span>
            )}
          </span>
          {meta.length > 0 && (
            <span className={s.meta}>
              {meta.map((part, n) => (
                <span key={part.text} className={cx(part.mono === true && s.mono)}>
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
      <div className={s.results}>
        {rows.length > 0 && (
          <div ref={list} id={`${ids}-list`} role="listbox" aria-label={t.find}>
            {groups.map((group) => (
              <div key={group.label ?? 'main'} role="group" {...(group.label === null ? {} : { 'aria-label': group.label })}>
                {group.label !== null && (
                  <div className={s.label} aria-hidden="true">
                    {group.label}
                  </div>
                )}
                {group.places.map((place) => row(place, index++))}
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
      {note !== undefined && <p className={s.note}>{note}</p>}
    </div>
  )
}
