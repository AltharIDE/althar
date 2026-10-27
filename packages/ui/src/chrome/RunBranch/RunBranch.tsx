import { Dialog } from 'radix-ui'
import { type KeyboardEvent, useId, useRef, useState } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { useControlled } from '../../lib/controlled'
import { cx } from '../../lib/cx'
import { Kbd } from '../../primitives/Kbd/Kbd'
import { Spinner } from '../../primitives/Spinner/Spinner'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import s from './RunBranch.module.css'

/*
 * Running a branch or a pull request, from the Run button's list (ADR-062):
 * a field, and what the remote has to run as it is typed in, its open pull
 * requests first, each by its title and number, then its branches. Althar
 * asks the remote as it opens, so the list is fresh, even of what nobody has
 * pulled. Picking one runs it in a copy of its own, with no task: Althar
 * fetches it, and the row says so until it runs, then the dialog closes; what
 * went wrong stays in it. A number typed that the list doesn't have runs that
 * pull request still. A modal the consumer mounts to open, keyed as the
 * finder is: you arrive typing, the arrows move, Enter runs, Escape closes.
 */

/** Something to run: an open pull request, or a branch. */
export type BranchChoice =
  | {
      readonly kind: 'pull'
      readonly number: number
      /** As its host writes it: #12, !12. */
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

/** One choice's key, among the rest. */
export const choiceKey = (choice: BranchChoice) =>
  `${choice.repository ?? ''}:${choice.kind === 'pull' ? `#${choice.number}` : choice.branch}`

export interface RunBranchText {
  title: string
  search: string
  pulls: string
  branches: string
  loading: string
  none: (query: string) => string
  count: (n: number) => string
  /** A number typed that the list doesn't have. */
  typed: (number: number) => string
  draft: string
  fork: string
  starting: string
  keys: { up: string; down: string; enter: string }
  move: string
  run: string
}

export const runBranchText: RunBranchText = {
  title: 'Run a branch',
  search: 'Run a branch or pull request',
  pulls: 'Pull requests',
  branches: 'Branches',
  loading: 'Asking the remote…',
  none: (query) => `Nothing on the remote matches “${query}”`,
  count: (n) => (n === 1 ? '1 to run' : `${n} to run`),
  typed: (number) => `Pull request #${number}`,
  draft: 'Draft',
  fork: 'From a fork',
  starting: 'Fetching…',
  keys: { up: '↑', down: '↓', enter: '↵' },
  move: 'move',
  run: 'run it, with no task',
}

export interface RunBranchProps {
  /** What the remote has to run, pull requests first; null while Althar asks it. */
  choices: readonly BranchChoice[] | null
  /** Why it lists less than it might: the remote out of reach, or no connection to list pull requests. */
  note?: string
  /** The one Althar is fetching to run, by its key (`choiceKey`). */
  starting?: string | null
  /** What went wrong running the last one picked. */
  error?: string
  query?: string
  defaultQuery?: string
  onQueryChange?: (query: string) => void
  /** Runs one. */
  onRun: (choice: BranchChoice) => void
  /** Escape, or a press outside. */
  onClose: () => void
  text?: Partial<RunBranchText>
}

/** What a choice is found by: its number, title, branch, author and repository. */
const wordsOf = (choice: BranchChoice) =>
  (choice.kind === 'pull'
    ? `${choice.name} ${choice.number} ${choice.title} ${choice.branch ?? ''} ${choice.author ?? ''}`
    : choice.branch
  ).toLowerCase() + ` ${choice.repository?.toLowerCase() ?? ''}`

/** The choices the words find, in their order; a pull request's number typed that none has comes first. */
export const found = (choices: readonly BranchChoice[], query: string, t: Pick<RunBranchText, 'typed'> = runBranchText) => {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const matched = choices.filter((choice) => words.every((word) => wordsOf(choice).includes(word.replace(/^[#!](?=\d)/, ''))))
  const number = /^[#!]?(\d+)$/.exec(query.trim())?.[1]
  if (number === undefined || choices.some((choice) => choice.kind === 'pull' && choice.number === Number(number))) return matched
  return [{ kind: 'pull', number: Number(number), name: `#${number}`, title: t.typed(Number(number)) } as const, ...matched]
}

export function RunBranch({
  choices,
  note,
  starting = null,
  error,
  query,
  defaultQuery = '',
  onQueryChange,
  onRun,
  onClose,
  text,
}: RunBranchProps) {
  const t = { ...runBranchText, ...text }
  const [words, setWords] = useControlled(query, defaultQuery, onQueryChange)
  const [active, setActive] = useState(0)
  const field = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const ids = useId()
  const [opener] = useState(() => (typeof document === 'undefined' ? null : document.activeElement))
  const typed = words.trim() !== ''
  const rows = choices === null ? [] : found(choices, words, t)
  const at = Math.min(active, Math.max(rows.length - 1, 0))
  const optionId = (index: number) => `${ids}-${index}`
  const busy = starting !== null
  const run = (choice: BranchChoice | undefined) => {
    if (choice !== undefined && !busy) onRun(choice)
  }

  const move = (to: number) => {
    setActive(to)
    list.current?.querySelector(`#${CSS.escape(optionId(to))}`)?.scrollIntoView({ block: 'nearest' })
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'ArrowDown') move(Math.min(at + 1, rows.length - 1))
    else if (event.key === 'ArrowUp') move(Math.max(at - 1, 0))
    else if (event.key === 'Enter') run(rows[at])
    else return
    event.preventDefault()
  }

  const row = (choice: BranchChoice, index: number) => {
    const key = choiceKey(choice)
    // Quieter, under it: a pull request's branch, its author, whether it is a draft or from a fork; and the repository, of several.
    const meta = [
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
      // A press runs it; focus stays in the field, which owns the keys.
      <div
        key={key}
        id={optionId(index)}
        role="option"
        aria-selected={index === at}
        aria-disabled={busy && starting !== key ? true : undefined}
        className={s.row}
        onMouseDown={(event) => event.preventDefault()}
        onMouseMove={() => {
          if (index !== at) setActive(index)
        }}
        onClick={() => run(choice)}
      >
        <Icon name={choice.kind === 'pull' ? 'pr' : 'branch'} size={13} className={s.glyph} />
        <span className={s.main}>
          <span className={s.head}>
            <span className={cx(s.title, choice.kind === 'branch' && s.mono)}>{choice.kind === 'pull' ? choice.title : choice.branch}</span>
            {starting === key ? (
              <span className={s.starting}>
                <Spinner size="small" />
                {t.starting}
              </span>
            ) : (
              choice.kind === 'pull' && <span className={s.number}>{choice.name}</span>
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
      </div>
    )
  }

  const pulls = rows.filter((choice) => choice.kind === 'pull')
  const branches = rows.filter((choice) => choice.kind === 'branch')

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
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            field.current?.focus()
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
          }}
        >
          <VisuallyHidden>
            <Dialog.Title>{t.title}</Dialog.Title>
          </VisuallyHidden>
          <div className={s.search}>
            <Icon name="branch" size={15} />
            <input
              ref={field}
              type="text"
              role="combobox"
              aria-label={t.search}
              placeholder={t.search}
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
          <span aria-live="polite" className={s.said}>
            {typed && choices !== null && (
              <VisuallyHidden>{rows.length === 0 ? t.none(words.trim()) : t.count(rows.length)}</VisuallyHidden>
            )}
          </span>
          <div className={s.results} aria-busy={choices === null}>
            {choices === null && (
              <p className={s.quiet}>
                <Spinner size="small" />
                {t.loading}
              </p>
            )}
            {rows.length > 0 && (
              <div ref={list} id={`${ids}-list`} role="listbox" aria-label={t.search}>
                {pulls.length > 0 && (
                  <div role="group" aria-label={t.pulls}>
                    <div className={s.label} aria-hidden="true">
                      {t.pulls}
                    </div>
                    {pulls.map((choice, index) => row(choice, index))}
                  </div>
                )}
                {branches.length > 0 && (
                  <div role="group" aria-label={t.branches}>
                    <div className={s.label} aria-hidden="true">
                      {t.branches}
                    </div>
                    {branches.map((choice, index) => row(choice, pulls.length + index))}
                  </div>
                )}
              </div>
            )}
            {typed && choices !== null && rows.length === 0 && <p className={s.quiet}>{t.none(words.trim())}</p>}
          </div>
          {error !== undefined && (
            <p className={s.error} role="alert">
              {error}
            </p>
          )}
          {note !== undefined && error === undefined && <p className={s.note}>{note}</p>}
          {rows.length > 0 && (
            <div className={s.foot} aria-hidden="true">
              <span>
                <Kbd>{t.keys.up}</Kbd>
                <Kbd>{t.keys.down}</Kbd> {t.move}
              </span>
              <span>
                <Kbd>{t.keys.enter}</Kbd> {t.run}
              </span>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
