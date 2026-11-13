import { type KeyboardEvent, useMemo, useState } from 'react'

import { Icon, Kbd } from '@althar/ui'

import { run } from './go'
import { actionsHere, type Context, type Entry, entriesFor, type Found, type Kind, recent, search, titleParts } from './index'
import {
  agoOf,
  Box,
  ENTER,
  EntryRow,
  Field,
  Foot,
  type Item,
  Label,
  type List,
  Marked,
  MOD,
  ProjectTag,
  Row,
  shows,
  s,
  useList,
  whoOf,
} from './parts'
import { useStore, words } from './state'
import { PROJECTS } from './world'

/*
 * B · Scopes (VS Code's quick open, GitHub's command palette). The box
 * goes to things by name: tasks, projects and their views, conversations,
 * settings, ranked by habit, one flat list. A character typed first, or
 * Tab, scopes it to one kind, each list drawn for its kind: > actions with
 * their keys, # pull requests and issues by number, / files by path,
 * " what was said, ! notes. @ picks a project, kept beside the scope.
 * The strip under the field shows every scope and its character, so the
 * box teaches itself.
 */

interface Scope {
  readonly id: string
  readonly prefix: string
  readonly name: string
  readonly placeholder: string
  readonly kinds: ReadonlyArray<Kind>
  readonly inside?: number
  /** What it says when nothing of its kind matches. */
  readonly none: string
}

const SCOPES: ReadonlyArray<Scope> = [
  {
    id: 'go',
    prefix: '',
    name: 'Go to',
    placeholder: 'Go to a task, project or setting',
    kinds: ['task', 'place', 'conversation'],
    inside: 0,
    none: 'Nothing is called',
  },
  {
    id: 'actions',
    prefix: '>',
    name: 'Actions',
    placeholder: 'Do something',
    kinds: ['action', 'place'],
    inside: 0,
    none: 'No action is called',
  },
  {
    id: 'numbers',
    prefix: '#',
    name: 'Pull requests and issues',
    placeholder: 'A number, a key or a title',
    kinds: ['pull', 'issue'],
    inside: 0.3,
    none: 'No pull request or issue matches',
  },
  {
    id: 'files',
    prefix: '/',
    name: 'Files',
    placeholder: 'A file, by its name or path',
    kinds: ['file'],
    inside: 0,
    none: 'No file matches',
  },
  {
    id: 'said',
    prefix: '"',
    name: 'What was said',
    placeholder: 'Words said in a conversation',
    kinds: ['said'],
    inside: 1,
    none: 'Nothing said matches',
  },
  {
    id: 'notes',
    prefix: '!',
    name: 'Notes',
    placeholder: 'A decision kept as a note',
    kinds: ['note'],
    inside: 1,
    none: 'No note matches',
  },
]
const SAID = SCOPES.find((one) => one.id === 'said') as Scope
const BY_PREFIX = new Map(SCOPES.filter((one) => one.prefix !== '').map((one) => [one.prefix, one]))

export function Scopes({ context, onClose }: { context: Context; onClose: () => void }) {
  const typed = useStore(words)
  // A prefix typed first is the scope's: the words are what follows it.
  const prefixed = BY_PREFIX.get(typed.slice(0, 1))
  const [picked, setPicked] = useState<Scope>(SCOPES[0] as Scope)
  const scope = prefixed ?? picked
  const rest = prefixed === undefined ? typed : typed.slice(1)
  const picking = rest.startsWith('@') && !rest.includes(' ')
  const [project, setProject] = useState<string | null>(null)
  const query = (picking ? '' : rest).trim()
  const entries = useMemo(() => entriesFor(context), [context])
  const crossing = project ?? context.project ?? true

  const choose = (entry: Entry) => () => {
    onClose()
    run(entry.go, entry)
  }

  // Each scope's list, best first.
  const found = useMemo((): ReadonlyArray<Found> => {
    if (picking) return []
    const within = project
    if (query === '') {
      if (scope.id === 'go') return recent(entries, { ...context, project: project ?? null }, 9).map(asFound)
      if (scope.id === 'actions')
        return [...actionsHere(entries, context), ...entries.filter((one) => one.kind === 'action' && one.scope === 'app')].map(asFound)
    }
    return search(entries, query, context, { kinds: scope.kinds, project: within, inside: scope.inside ?? 0, fuzzy: scope.id !== 'said' })
      .filter((one) => scope.id !== 'actions' || one.entry.kind === 'action' || one.entry.scope === 'app')
      .slice(0, 60)
  }, [entries, query, scope, context, project, picking])

  const projects = PROJECTS.filter((one) => one.name.startsWith(rest.slice(1).toLowerCase()))
  const items: ReadonlyArray<Item> = picking
    ? projects.map((one) => ({
        key: one.id,
        run: () => {
          setProject(one.id)
          words.set(prefixed === undefined ? '' : scope.prefix)
        },
      }))
    : found.length === 0 && query !== '' && scope.id !== 'said'
      ? // Nothing of this kind: the way out is to look in what was said, the words kept.
        [
          {
            key: 'elsewhere',
            run: () => {
              setPicked(SAID)
              words.set(rest)
            },
          },
        ]
      : found.map((one) => ({ key: one.entry.id, run: choose(one.entry) }))
  const keys = useList(items, `${scope.id}|${query}|${project}|${picking}`)

  const selected = found.find((one) => one.entry.id === keys.selected?.key)?.entry
  const second = selected?.acts?.[1]

  const step = (by: number) => {
    const at = SCOPES.indexOf(scope)
    const next = SCOPES[(at + by + SCOPES.length) % SCOPES.length] as Scope
    setPicked(next)
    words.set(rest)
  }

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Tab') {
      event.preventDefault()
      step(event.shiftKey ? -1 : 1)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      if (picking) words.set(prefixed === undefined ? '' : scope.prefix)
      else onClose()
      return
    }
    if (event.key === 'Backspace' && event.currentTarget.value === '') {
      event.preventDefault()
      if (project !== null) setProject(null)
      else setPicked(SCOPES[0] as Scope)
      return
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && second !== undefined && selected !== undefined) {
      event.preventDefault()
      onClose()
      run(second.go, selected)
      return
    }
    keys.onKey(event)
  }

  return (
    <Box label="Search" onClose={onClose}>
      <Field
        value={typed}
        onChange={(value) => words.set(value)}
        onKeyDown={onKey}
        list={keys}
        placeholder={scope.placeholder}
        before={
          <>
            {scope.id !== 'go' && prefixed === undefined && (
              <span className={s.chip}>
                <span className={s.prefix}>{scope.prefix}</span>
                {scope.name}
              </span>
            )}
            {project !== null && (
              <span className={s.chip}>
                <span className={s.prefix}>@</span>
                {PROJECTS.find((one) => one.id === project)?.name}
              </span>
            )}
          </>
        }
      />
      <div className={s.scopes} role="toolbar" aria-label="Scopes">
        {SCOPES.map((one) => (
          <button
            key={one.id}
            type="button"
            tabIndex={-1}
            className={s.scope}
            aria-pressed={one.id === scope.id}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setPicked(one)
              words.set(rest)
            }}
          >
            {one.prefix !== '' && <span className={s.prefix}>{one.prefix}</span>}
            {one.name}
          </button>
        ))}
        <button
          type="button"
          tabIndex={-1}
          className={s.scope}
          aria-pressed={project !== null}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => words.set(`${prefixed === undefined ? '' : scope.prefix}@`)}
        >
          <span className={s.prefix}>@</span>
          {project === null ? 'Project' : PROJECTS.find((one) => one.id === project)?.name}
        </button>
      </div>
      <div ref={keys.list} className={s.results} id={keys.listId} role="listbox" aria-label={scope.name}>
        {picking ? (
          <>
            <Label>In a project</Label>
            {projects.map((one, n) => (
              <Row
                key={one.id}
                list={keys}
                item={items[n] as Item}
                icon={<Icon name="folder" size={14} />}
                title={<ProjectTag id={one.id} />}
              />
            ))}
          </>
        ) : (
          <>
            {query === '' && scope.id === 'go' && found.length > 0 && <Label>Recently opened</Label>}
            {query === '' && scope.id === 'actions' && <Label>{context.task === null ? 'Here' : 'This task, then Althar'}</Label>}
            {found.map((one, n) => (
              <ScopedRow
                key={one.entry.id}
                scope={scope.id}
                found={one}
                item={items[n] as Item}
                list={keys}
                crossing={crossing}
                typed={query !== ''}
              />
            ))}
            {query !== '' && found.length === 0 && (
              <>
                <p className={s.empty}>
                  {scope.none} “{query}”.
                </p>
                {scope.id !== 'said' && (
                  <Row
                    list={keys}
                    item={items[0] as Item}
                    icon={<Icon name="comment" size={14} />}
                    title={`Look for “${query}” in what was said`}
                  />
                )}
              </>
            )}
          </>
        )}
      </div>
      <Foot
        keys={[
          [['↑', '↓'], 'move'],
          [[ENTER], scope.id === 'actions' ? 'do it' : 'open'],
          ...(second === undefined
            ? []
            : [[[`${MOD}${ENTER}`], second.id.startsWith('task-') ? 'the task that changed it' : second.title.replace(/…$/, '')] as const]),
          [['Tab'], 'next scope'],
        ]}
      />
    </Box>
  )
}

const asFound = (entry: Entry): Found => ({ entry, score: 0, ranges: [], passage: null, exact: false })

/** Each scope's row, drawn for its kind. */
function ScopedRow({
  scope,
  found,
  item,
  list,
  crossing,
  typed,
}: {
  scope: string
  found: Found
  item: Item
  list: List
  crossing: boolean | string
  typed: boolean
}) {
  const entry = found.entry
  if (scope === 'numbers')
    return (
      <Row
        list={list}
        item={item}
        icon={<Icon name={entry.icon} size={14} />}
        title={
          <>
            <span className={s.key}>{entry.facts?.[0]}</span> <Marked parts={titleParts(found)} />
          </>
        }
        facts={
          <>
            {shows(crossing, entry.project) && entry.project !== undefined && <ProjectTag id={entry.project} />}
            {(entry.facts ?? []).slice(1).map((fact) => (
              <span key={fact}>{fact}</span>
            ))}
          </>
        }
        {...(entry.stand === undefined ? {} : { stand: entry.stand })}
      />
    )
  if (scope === 'files') {
    const [folder, changed] = entry.facts ?? []
    return (
      <Row
        list={list}
        item={item}
        icon={<Icon name="file" size={14} />}
        title={<Marked parts={titleParts(found)} />}
        facts={
          <>
            <span className={s.mono}>{folder}</span>
          </>
        }
        {...(changed === undefined ? {} : { end: <span className={s.state}>{changed}</span> })}
      />
    )
  }
  if (scope === 'said')
    return (
      <Row
        list={list}
        item={item}
        icon={<Icon name="comment" size={14} />}
        title={<span className={s.who}>{whoOf(entry)}</span>}
        facts={
          <>
            {shows(crossing, entry.project) && entry.project !== undefined && <ProjectTag id={entry.project} />}
            <span>{entry.facts?.[0]}</span>
          </>
        }
        end={<span className={s.state}>{agoOf(entry.ago)}</span>}
        passage={
          <span className={s.passage}>
            <Marked parts={found.passage ?? [{ text: entry.title, hit: false }]} />
          </span>
        }
      />
    )
  if (scope === 'notes')
    return (
      <Row
        list={list}
        item={item}
        icon={<Icon name="quote" size={14} />}
        title={
          <span className={s.facts}>
            {shows(crossing, entry.project) && entry.project !== undefined ? <ProjectTag id={entry.project} /> : 'Note'}
          </span>
        }
        end={<span className={s.state}>{agoOf(entry.ago)}</span>}
        passage={
          <span className={s.passage}>
            <Marked parts={found.passage ?? [{ text: entry.title, hit: false }]} />
          </span>
        }
      />
    )
  return <EntryRow list={list} item={item} entry={entry} {...(typed ? { found } : {})} crossing={crossing} passage={false} />
}
