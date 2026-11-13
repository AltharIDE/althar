import { type KeyboardEvent, type ReactNode, useMemo, useRef, useState } from 'react'

import { Icon, Kbd } from '@althar/ui'

import { run } from './go'
import {
  type Act,
  actionsHere,
  asksSomething,
  type Context,
  type Entry,
  entriesFor,
  type Found,
  type Kind,
  KINDS_NAMED,
  needsYou,
  projectName,
  recent,
  search,
} from './index'
import { fold, wordsOf } from './match'
import { Box, EntryRow, ENTER, Field, Foot, type Item, Label, Row, s, useList } from './parts'
import { useStore, words } from './state'

/*
 * A · One box (Raycast, Linear's ⌘K, Spotlight). One field finds every
 * kind and does every action: the best match on top, then the rest grouped
 * by kind, a few of each, the groups in the order of their best match.
 * Every row acts: Enter does the obvious thing, → lists everything else it
 * can do, in place. Tab narrows to the chosen row's kind; Backspace on an
 * empty field widens again. With nothing typed: this task's actions, what
 * needs you, what you opened lately. Words that find nothing, or ask
 * something, go to the coordinator.
 */

const ORDER: ReadonlyArray<Kind> = ['task', 'pull', 'issue', 'said', 'note', 'place', 'action', 'conversation', 'file']
/** How many of each kind show before Tab shows them all. */
const FEW: Readonly<Partial<Record<Kind, number>>> = { task: 4, said: 3, file: 3 }

interface Section {
  readonly label: ReactNode
  readonly rows: ReadonlyArray<{ readonly item: Item; readonly node: (item: Item) => ReactNode }>
}

export function OneBox({ context, onClose }: { context: Context; onClose: () => void }) {
  const typed = useStore(words)
  const [narrowed, setNarrowed] = useState<Kind | null>(null)
  const [acting, setActing] = useState<{ entry: Entry; found?: Found } | null>(null)
  const [filter, setFilter] = useState('')
  const field = useRef<HTMLInputElement>(null)
  const entries = useMemo(() => entriesFor(context), [context])
  const crossing = context.project ?? true
  const query = typed.trim()

  const choose = (entry: Entry) => () => {
    onClose()
    run(entry.go, entry)
  }
  const ask = (text: string, start = false): Item => ({
    key: start ? 'start' : 'ask',
    run: () => {
      onClose()
      run({ to: 'ask', project: context.project ?? 'p_althar', text: start ? `Start a task: ${text}` : text })
    },
  })

  const sections = useMemo((): ReadonlyArray<Section> => {
    const rowOf = (entry: Entry, found?: Found, className?: string) => {
      const item = { key: entry.id, run: choose(entry) }
      return {
        item,
        node: (one: Item) => (
          <EntryRow
            key={entry.id}
            list={listRef.current}
            item={one}
            entry={entry}
            crossing={crossing}
            {...(found === undefined ? {} : { found })}
            {...(className === undefined ? {} : { className })}
          />
        ),
      }
    }
    if (acting !== null) return []
    if (query === '' && narrowed === null) {
      const here = actionsHere(entries, context)
      const needs = needsYou(context).filter((one) => one.place !== context.task)
      // What shows above isn't repeated: a task waiting on you, its pull request, an action listed here.
      const shown = new Set([...needs.map((one) => one.place), ...(context.task === null ? [] : [context.task])])
      const lately = recent(entries, context, 8)
        .filter((one) => !shown.has(one.place) && !(context.task === null && here.slice(0, 4).some((action) => action.id === one.id)))
        .slice(0, 5)
      return [
        ...(context.task === null ? [] : [{ label: 'This task', rows: here.slice(0, 5).map((one) => rowOf(one)) }]),
        ...(needs.length === 0 ? [] : [{ label: 'Needs you', rows: needs.slice(0, 4).map((one) => rowOf(one)) }]),
        ...(lately.length === 0 ? [] : [{ label: 'Recent', rows: lately.map((one) => rowOf(one)) }]),
        ...(context.task === null ? [{ label: 'Actions', rows: here.slice(0, 4).map((one) => rowOf(one)) }] : []),
      ]
    }
    const all = search(entries, query, context, narrowed === null ? {} : { kinds: [narrowed] })
    // One thing, one row: a task stands for its pull request and its issue, whose keys it shows.
    const tasks = new Set(all.filter((one) => one.entry.kind === 'task').map((one) => one.entry.place))
    const found =
      narrowed !== null
        ? all
        : all.filter((one) => !((one.entry.kind === 'pull' || one.entry.kind === 'issue') && tasks.has(one.entry.place)))
    if (narrowed !== null) return [{ label: KINDS_NAMED[narrowed], rows: found.slice(0, 60).map((one) => rowOf(one.entry, one)) }]
    const [top, ...rest] = found
    const byKind = new Map<Kind, Array<Found>>()
    for (const one of rest) byKind.set(one.entry.kind, [...(byKind.get(one.entry.kind) ?? []), one])
    // Each group where its best match is; a tie keeps the usual order of kinds.
    const groups = [...byKind.entries()].sort(
      ([a, one], [b, other]) => (other[0]?.score ?? 0) - (one[0]?.score ?? 0) || ORDER.indexOf(a) - ORDER.indexOf(b),
    )
    const fallbacks: Section = {
      label: 'Use the words',
      rows: [
        {
          item: ask(query),
          node: (item: Item) => (
            <Row
              key="ask"
              list={listRef.current}
              item={item}
              className={s.askRow}
              icon={<Icon name="comment" size={14} />}
              title={`Ask the coordinator “${query}”`}
              facts={<span>{projectName(context.project ?? 'p_althar')}</span>}
            />
          ),
        },
        {
          item: ask(query, true),
          node: (item: Item) => (
            <Row
              key="start"
              list={listRef.current}
              item={item}
              icon={<Icon name="plus" size={14} />}
              title={`Start a task “${query}”`}
              facts={<span>{projectName(context.project ?? 'p_althar')}</span>}
            />
          ),
        },
      ],
    }
    if (top === undefined) return [fallbacks]
    const question = asksSomething(query)
    return [
      ...(question ? [fallbacks] : []),
      { label: 'Top hit', rows: [rowOf(top.entry, top, s.top)] },
      ...groups.map(([kind, list]) => ({
        label: KINDS_NAMED[kind],
        count: list.length,
        rows: list.slice(0, FEW[kind] ?? 3).map((one) => rowOf(one.entry, one)),
        kind,
      })),
      ...(question ? [] : [fallbacks]),
    ]
    // listRef is read at draw time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, query, narrowed, acting, context, crossing])

  // What the chosen row can do, for →.
  const acts = useMemo((): ReadonlyArray<Act> => {
    if (acting === null) return []
    const all = acting.entry.acts ?? [{ id: 'open', title: 'Open', icon: 'arrow' as const, go: acting.entry.go }]
    const by = wordsOf(filter)
    return all.filter((one) => by.every((word) => fold(one.title).includes(word)))
  }, [acting, filter])

  const items: ReadonlyArray<Item> =
    acting === null
      ? sections.flatMap((section) => section.rows.map((row) => row.item))
      : acts.map((act) => ({
          key: act.id,
          run: () => {
            onClose()
            run(act.go, acting.entry)
          },
        }))
  const list = useList(items, `${query}|${narrowed}|${acting?.entry.id}|${filter}`)
  const listRef = useRef(list)
  listRef.current = list

  const selectedEntry = acting === null ? entries.find((one) => one.id === list.selected?.key) : undefined
  const foundOf = (key: string) => (query === '' ? undefined : search(entries, query, context).find((one) => one.entry.id === key))

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const atEnd = input.selectionStart === input.value.length
    if (acting !== null) {
      if (
        event.key === 'Escape' ||
        (event.key === 'ArrowLeft' && input.value === '') ||
        (event.key === 'Backspace' && input.value === '')
      ) {
        event.preventDefault()
        setActing(null)
        setFilter('')
        return
      }
      list.onKey(event)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      if (narrowed !== null) setNarrowed(null)
      else onClose()
      return
    }
    if (event.key === 'Backspace' && input.value === '' && narrowed !== null) {
      event.preventDefault()
      setNarrowed(null)
      return
    }
    // → at the end of the words, or ⌘K again: what the chosen row can do.
    if (
      ((event.key === 'ArrowRight' && atEnd) || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k')) &&
      selectedEntry !== undefined
    ) {
      event.preventDefault()
      const found = foundOf(selectedEntry.id)
      setActing({ entry: selectedEntry, ...(found === undefined ? {} : { found }) })
      return
    }
    // Tab: only the chosen row's kind.
    if (event.key === 'Tab' && !event.shiftKey && selectedEntry !== undefined && narrowed === null && query !== '') {
      event.preventDefault()
      setNarrowed(selectedEntry.kind)
      return
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      return
    }
    list.onKey(event)
  }

  const where = context.project === null ? 'every project' : projectName(context.project)
  return (
    <Box label="Search" onClose={onClose}>
      <Field
        inputRef={field}
        value={acting === null ? typed : filter}
        onChange={(value) => (acting === null ? words.set(value) : setFilter(value))}
        onKeyDown={onKey}
        list={list}
        placeholder={
          acting === null
            ? narrowed === null
              ? 'Search or do anything'
              : `Search ${KINDS_NAMED[narrowed].toLowerCase()}`
            : 'Search actions'
        }
        before={
          acting !== null ? (
            <span className={s.chip}>Actions</span>
          ) : narrowed !== null ? (
            <span className={s.chip}>{KINDS_NAMED[narrowed]}</span>
          ) : undefined
        }
      />
      <div ref={list.list} className={s.results} id={list.listId} role="listbox" aria-label="Results">
        {acting === null && query !== '' && sections.length === 1 && narrowed === null && (
          <p className={s.empty}>
            Nothing in {where} matches “{query}”.
          </p>
        )}
        {acting !== null ? (
          <>
            <div className={s.acting}>
              <Icon name={acting.entry.icon} size={13} />
              <span>{acting.entry.kind === 'said' ? acting.entry.title.slice(0, 80) : acting.entry.title}</span>
            </div>
            {acts.map((act, n) => {
              const item = items[n] as Item
              return (
                <Row
                  key={act.id}
                  list={list}
                  item={item}
                  danger={act.danger === true}
                  icon={<Icon name={act.icon} size={14} />}
                  title={act.title}
                  {...(act.shortcut === undefined ? {} : { end: <span className={s.hint}>{act.shortcut}</span> })}
                />
              )
            })}
          </>
        ) : (
          sections.map((section, n) => (
            <div key={n} role="group">
              <Label
                count={
                  'count' in section && typeof section.count === 'number' && section.count > section.rows.length ? section.count : undefined
                }
                more={
                  // Said once, on the group the chosen row is in.
                  'kind' in section &&
                  'count' in section &&
                  typeof section.count === 'number' &&
                  section.count > section.rows.length &&
                  section.rows.some((row) => list.isSelected(row.item.key)) ? (
                    <>
                      <Kbd>Tab</Kbd> all {section.count}
                    </>
                  ) : undefined
                }
              >
                {section.label}
              </Label>
              {section.rows.map((row) => row.node(row.item))}
            </div>
          ))
        )}
      </div>
      <Foot
        keys={
          acting !== null
            ? [
                [[ENTER], 'do it'],
                [['←'], 'back'],
              ]
            : [
                [['↑', '↓'], 'move'],
                [[ENTER], selectedEntry?.kind === 'action' ? 'do it' : 'open'],
                [['→'], 'actions'],
                ...(query === '' || narrowed !== null
                  ? []
                  : [[['Tab'], `only ${KINDS_NAMED[selectedEntry?.kind ?? 'task'].toLowerCase()}`] as const]),
              ]
        }
        {...(acting === null && narrowed !== null ? { end: <span className={s.hint}>esc all kinds</span> } : {})}
      />
    </Box>
  )
}
