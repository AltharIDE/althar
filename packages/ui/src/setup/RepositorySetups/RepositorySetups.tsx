import { type KeyboardEvent, type ReactNode, useId, useRef, useState } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { Button } from '../../primitives/Button/Button'
import s from './RepositorySetups.module.css'

/*
 * How each new task's folder of a project's repositories gets ready
 * (ADR-080): a tab for each repository, its checkout at the tabs' end; in
 * it, the commands Althar runs, one a line, then the ignored files it copies
 * from the checkout, each as code to change in place: numbered lines,
 * coloured shell, and what is typed laid letter for letter over the colours.
 * A change is kept as the person leaves the lines, and only where it changed;
 * Escape puts them back. Until a lead records a repository's setup, its lines
 * are empty and say so. Under them: who has it as it is, an agent or the
 * person (an agent asks before replacing the person's), that new tasks use
 * it while worktrees made already keep theirs, and a button that clears it
 * so an agent sets it again.
 */

export const repositorySetupsText = {
  commands: 'Commands',
  copy: 'Copied from your checkout',
  unrecorded: 'None yet: the first task’s agent sets it.',
  byAgent: 'Set by an agent.',
  byPerson: 'Edited by you. An agent asks before replacing it.',
  newTasks: 'New tasks use this; worktrees already made keep what they have.',
  clear: 'Clear, so an agent sets it again',
  nothing: 'Needs nothing.',
  noFiles: 'No files.',
  noCheckout: 'No checkout on this computer',
  commandsOf: (repository: string) => `${repository}: commands`,
  copyOf: (repository: string) => `${repository}: files copied from your checkout`,
}

export interface FolderSetup {
  readonly copy: ReadonlyArray<string>
  readonly commands: ReadonlyArray<string>
  /** Who has it as it is; absent for one the person is typing. */
  readonly by?: 'agent' | 'person'
}

export interface SetupRepository {
  readonly id: string
  readonly name: string
  /** The person's checkout, shortened, where its files are copied from; null where this computer has none. */
  readonly checkout: string | null
  /** Null until a lead records it. */
  readonly setup: FolderSetup | null
}

export interface RepositorySetupsProps {
  repositories: ReadonlyArray<SetupRepository>
  /** A repository's setup as the person changed it: the whole of it, its lines tidied. */
  onChange: (repositoryId: string, setup: FolderSetup) => void
  /** The person clears a repository's setup, for an agent to set it again. */
  onClear: (repositoryId: string) => void
  /** Why the last change didn't hold. */
  error?: string | undefined
}

/** What a word is, for its colour. */
type Kind = 'fn' | 'flag' | 'string' | 'comment' | 'punct' | 'var' | 'path'

/** Colours a line of shell: the program, its flags, strings, variables, comments, and what joins commands. */
export const shellColours = (line: string): ReactNode[] => {
  const out: ReactNode[] = []
  const push = (kind: Kind | null, words: string) =>
    out.push(
      kind === null ? (
        words
      ) : (
        <span key={out.length} className={s[kind]}>
          {words}
        </span>
      ),
    )
  const re = /(#[\s\S]*)|("(?:[^"\\]|\\.)*"?|'[^']*'?)|(\$\{?[A-Za-z_][A-Za-z0-9_]*\}?)|(&&|\|\||[|;])|(\s+)|([^\s"'|;&$#]+|[&$#])/g
  let first = true
  for (const m of line.matchAll(re)) {
    const [all, comment, string, variable, joint, space, word] = m
    if (comment !== undefined) push('comment', comment)
    else if (string !== undefined) push('string', string)
    else if (variable !== undefined) push('var', variable)
    else if (joint !== undefined) {
      push('punct', joint)
      first = true
    } else if (space !== undefined) push(null, space)
    else if (word !== undefined) {
      // A variable set before the command, such as `CI=1 bun install`, isn't the command.
      if (first && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) {
        push('fn', word)
        first = false
      } else push(word.startsWith('-') ? 'flag' : null, word)
    } else push(null, all)
  }
  return out
}

/** A file from the checkout: its folders quiet, its name plain. */
const pathLine = (line: string): ReactNode[] => {
  const at = line.lastIndexOf('/')
  return at < 0
    ? [line]
    : [
        <span key="folders" className={s.path}>
          {line.slice(0, at + 1)}
        </span>,
        line.slice(at + 1),
      ]
}

const linesOf = (words: string) =>
  words
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')

const same = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) => a.length === b.length && a.every((one, at) => one === b[at])

interface LinesProps {
  lines: ReadonlyArray<string>
  label: string
  placeholder: string
  colour: (line: string) => ReactNode[]
  onSave: (lines: ReadonlyArray<string>) => void
}

/** Lines of code to change in place: numbered, coloured, typed over the colours; kept as the person leaves them. */
export function SetupLines({ lines, label, placeholder, colour, onSave }: LinesProps) {
  // What the person is typing, while they are; otherwise the lines as kept, so a change from elsewhere shows.
  const [draft, setDraft] = useState<string | null>(null)
  const code = useRef<HTMLPreElement>(null)
  // Escape leaves the lines as they were: the blur that follows keeps nothing.
  const putBack = useRef(false)
  const value = draft ?? lines.join('\n')
  const rows = value.split('\n')
  return (
    <div className={s.lines}>
      <div className={s.gutter} aria-hidden="true">
        {rows.map((_, at) => (
          <span key={at}>{at + 1}</span>
        ))}
      </div>
      <div className={s.body}>
        <pre ref={code} className={s.layer} aria-hidden="true">
          {rows.map((row, at) => (
            <span key={at} className={s.line}>
              {row === '' ? ' ' : colour(row)}
              {'\n'}
            </span>
          ))}
        </pre>
        <textarea
          className={s.input}
          aria-label={label}
          wrap="off"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          rows={rows.length}
          value={value}
          placeholder={placeholder}
          onFocus={() => setDraft(lines.join('\n'))}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            putBack.current = true
            event.currentTarget.blur()
          }}
          onScroll={(event) => {
            if (code.current !== null) code.current.scrollLeft = event.currentTarget.scrollLeft
          }}
          onBlur={(event) => {
            const next = linesOf(event.currentTarget.value)
            setDraft(null)
            if (putBack.current) putBack.current = false
            else if (!same(next, lines)) onSave(next)
          }}
        />
      </div>
    </div>
  )
}

export function RepositorySetups({ repositories, onChange, onClear, error }: RepositorySetupsProps) {
  const [chosen, setChosen] = useState<string | null>(null)
  const tabs = useRef<HTMLDivElement>(null)
  const base = useId()
  const repository = repositories.find((one) => one.id === chosen) ?? repositories[0]
  if (repository === undefined) return null
  const at = repositories.indexOf(repository)
  const choose = (next: number) => {
    const one = repositories[(next + repositories.length) % repositories.length]
    if (one === undefined) return
    setChosen(one.id)
    tabs.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(one.id)}"]`)?.focus()
  }
  const onKeyDown = (event: KeyboardEvent) => {
    const next =
      event.key === 'ArrowRight' ? at + 1 : event.key === 'ArrowLeft' ? at - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? -1 : null
    if (next === null) return
    event.preventDefault()
    choose(next)
  }
  const setup = repository.setup
  const save = (change: Partial<FolderSetup>) =>
    onChange(repository.id, { copy: setup?.copy ?? [], commands: setup?.commands ?? [], ...change })
  const who =
    setup === null
      ? null
      : setup.by === 'person'
        ? repositorySetupsText.byPerson
        : setup.by === 'agent'
          ? repositorySetupsText.byAgent
          : null
  return (
    <div className={s.root}>
      <section className={s.card}>
        {/* biome-ignore lint/a11y/useSemanticElements: a tablist, not a fieldset. */}
        <div ref={tabs} className={s.tabs} role="tablist" tabIndex={-1} onKeyDown={onKeyDown}>
          {repositories.map((one) => (
            <button
              key={one.id}
              data-id={one.id}
              type="button"
              role="tab"
              id={`${base}-${one.id}`}
              aria-selected={one.id === repository.id}
              aria-controls={`${base}-panel`}
              tabIndex={one.id === repository.id ? 0 : -1}
              className={one.id === repository.id ? s.tabOn : s.tab}
              onClick={() => setChosen(one.id)}
            >
              <Icon name="folder" size={13} className={s.glyph} />
              {one.name}
            </button>
          ))}
          <span className={s.checkout}>{repository.checkout ?? repositorySetupsText.noCheckout}</span>
        </div>
        <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-${repository.id}`} key={repository.id}>
          <div className={s.part}>{repositorySetupsText.commands}</div>
          <SetupLines
            lines={setup?.commands ?? []}
            label={repositorySetupsText.commandsOf(repository.name)}
            placeholder={setup === null ? repositorySetupsText.unrecorded : repositorySetupsText.nothing}
            colour={shellColours}
            onSave={(commands) => save({ commands })}
          />
          <div className={s.part}>{repositorySetupsText.copy}</div>
          <SetupLines
            lines={setup?.copy ?? []}
            label={repositorySetupsText.copyOf(repository.name)}
            placeholder={repositorySetupsText.noFiles}
            colour={pathLine}
            onSave={(copy) => save({ copy })}
          />
        </div>
        <div className={s.foot}>
          <span className={s.note}>
            {who === null ? '' : `${who} `}
            {repositorySetupsText.newTasks}
          </span>
          {setup !== null && (
            <Button size="small" onClick={() => onClear(repository.id)}>
              {repositorySetupsText.clear}
            </Button>
          )}
        </div>
      </section>
      {error !== undefined && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
