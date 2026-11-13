import './morph.css'

import { type KeyboardEvent, type ReactNode, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { Button, Icon, type IconName, Kbd } from '@althar/ui'

import type { Go } from './model'
import {
  type Act,
  actionsHere,
  asksSomething,
  type Context,
  type Entry,
  type Found,
  type Kind,
  KINDS_NAMED,
  needsYou,
  recent,
} from './model'
import { fold, wordsOf } from './match'
import { arrive, chipOf, drop, into, intoField, leave, lift, measure, MOTION, slideFrom } from './morph'
import o from './one.module.css'
import { Box, cx, EntryRow, ENTER, Field, type Item, Label, type List, Row, useList } from './parts'
import { useRanked } from './useRanked'

/*
 * The search palette. One field finds every kind and does
 * every action: the best match on top, then the rest grouped by kind, every
 * row acting (Enter does the obvious thing, → lists the rest). A first
 * character narrows it to one kind (> # / " !), as typed scopes, and Tab
 * asks the coordinator, as Linear's "Ask Linear". With nothing typed: this
 * task's actions, what needs you, what you opened lately, the actions with
 * their keys, and the kinds to narrow to.
 *
 * It morphs as it goes (morph.ts): what is chosen keeps its identity as it
 * moves, the chosen row's name lifting into the field as a chip and
 * dropping back, the Tab hint becoming the chip, the box gliding to each
 * height, the highlight sliding between rows, and Enter carrying the row's
 * name into the page it opens. The rows themselves are still: a key changes
 * the list, and the new list is there at once (DESIGN.md).
 */

const ORDER: ReadonlyArray<Kind> = ['task', 'pull', 'issue', 'said', 'note', 'place', 'action', 'conversation', 'file']
/** How many of each kind show. */
const FEW: Readonly<Partial<Record<Kind, number>>> = { task: 4, said: 3, file: 3 }

interface Scope {
  readonly id: string
  readonly prefix: string
  readonly name: string
  readonly icon: IconName
  readonly kinds: ReadonlyArray<Kind>
  readonly inside: number
}

/** What a first character narrows to, as typed scopes. */
const SCOPES: ReadonlyArray<Scope> = [
  { id: 'numbers', prefix: '#', name: 'Pull requests and issues', icon: 'pr', kinds: ['pull', 'issue'], inside: 0.3 },
  { id: 'files', prefix: '/', name: 'Files', icon: 'file', kinds: ['file'], inside: 0 },
  { id: 'said', prefix: '"', name: 'What was said', icon: 'comment', kinds: ['said'], inside: 1 },
  { id: 'notes', prefix: '!', name: 'Notes', icon: 'quote', kinds: ['note'], inside: 1 },
  { id: 'actions', prefix: '>', name: 'Actions', icon: 'play', kinds: ['action', 'place'], inside: 0 },
]
const BY_PREFIX = new Map(SCOPES.map((one) => [one.prefix, one]))

interface Section {
  readonly key: string
  readonly label: ReactNode
  readonly rows: ReadonlyArray<{ readonly item: Item; readonly node: (list: List) => ReactNode }>
}

const ASK = 'Ask the coordinator'

export function OneBox({
  context,
  entries,
  onClose,
  run,
  status,
  onDrill,
}: {
  context: Context
  entries: ReadonlyArray<Entry>
  onClose: () => void
  run: (go: Go, entry?: Entry) => void
  status?: ReactNode
  onDrill?: (entry: Entry) => void
}) {
  const [typed, setTyped] = useState('')
  const words = { set: setTyped }
  const [scope, setScope] = useState<{ scope: Scope; from: string | null } | null>(null)
  const [asking, setAsking] = useState(false)
  const [acting, setActing] = useState<{ entry: Entry; found?: Found } | null>(null)
  const [filter, setFilter] = useState('')
  const field = useRef<HTMLInputElement>(null)
  const results = useRef<HTMLDivElement>(null)
  const crossing = context.project ?? true
  const query = typed.trim()

  /* ——— What happens after the next draw: a morph needs where things stood before it and where they stand after ——— */
  const after = useRef<(() => void) | null>(null)
  const fieldWas = useRef<number | null>(null)
  const backTo = useRef<string | null>(null)
  const rowWords = (key: string) => results.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(key)}"] [data-title]`) ?? null
  const chipEl = () => field.current?.parentElement?.querySelector<HTMLElement>('[data-chip]') ?? null
  const hintWords = () => field.current?.parentElement?.querySelector<HTMLElement>('[data-hint] [data-chip-text]') ?? null
  const slide = () => slideFrom(field.current, fieldWas.current)

  // A page's title for what an entry opens: the task's, where it opens one.
  const titles = useMemo(
    () => new Map(entries.flatMap((one) => (one.kind === 'task' && one.go.to === 'task' ? [[one.go.slug, one.title] as const] : []))),
    [entries],
  )
  const titleFor = (entry: Entry, go = entry.go): string | null => {
    if (entry.kind === 'said' || entry.kind === 'note') return null
    if (go.to === 'task') return titles.get(go.slug) ?? null
    if (go.to === 'project' || go.to === 'settings') return entry.title
    return null
  }
  const opens = (go: Entry['go']) => go.to === 'task' || go.to === 'project' || go.to === 'settings' || go.to === 'home'

  const choose = (entry: Entry) => () => {
    if (!opens(entry.go)) {
      onClose()
      run(entry.go, entry)
      return
    }
    into(rowWords(entry.id), titleFor(entry), onClose, () => run(entry.go, entry))
  }
  // Which coordinator takes the words: the open project's, else the project the best hit is in; with neither, each project's, to choose.
  const askable = (hits: ReadonlyArray<Found>) => {
    const named = context.project ?? hits.find((one) => one.entry.project !== undefined)?.entry.project
    const one = context.projects.find((project) => project.id === named)
    return one !== undefined ? [one] : context.projects.slice(0, 4)
  }
  const ask = (text: string, project: string, start = false): Item => ({
    key: `${start ? 'start' : 'ask'}:${project}`,
    run: () =>
      intoField(field.current?.parentElement ?? null, onClose, () =>
        run({ to: 'ask', project, text: start ? `Start a task: ${text}` : text }),
      ),
  })

  /* ——— Steps in and out, each a morph ——— */
  const narrowTo = (next: Scope, from: string | null) => {
    const was = from === null ? null : measure(rowWords(from))
    after.current = () => {
      if (was === null) arrive(chipEl(), field.current)
      else {
        lift(was, chipEl())
        slide()
      }
    }
    setScope({ scope: next, from })
    setAsking(false)
    words.set('')
  }
  const widen = () => {
    if (scope === null) return
    const chip = chipOf(chipEl())
    const from = scope.from
    after.current = () => {
      if (from === null) {
        // Quickly, under the chip as it fades.
        leave(chip)
        slideFrom(field.current, fieldWas.current, MOTION.exit)
      } else {
        drop(chip, rowWords(from))
        slide()
      }
    }
    backTo.current = from
    setScope(null)
  }
  const toAsk = () => {
    const was = measure(hintWords())
    after.current = () => {
      lift(was, chipEl())
      slide()
    }
    setAsking(true)
    setScope(null)
  }
  const fromAsk = () => {
    const chip = chipOf(chipEl())
    after.current = () => {
      drop(chip, hintWords())
      slide()
    }
    setAsking(false)
  }
  const drill = (entry: Entry) => {
    onDrill?.(entry)
    const was = measure(rowWords(entry.id))
    const found = query === '' ? undefined : ranked.find((one) => one.entry.id === entry.id)
    after.current = () => {
      lift(was, chipEl())
      slide()
    }
    setActing({ entry, ...(found === undefined ? {} : { found }) })
    setFilter('')
  }
  const back = () => {
    if (acting === null) return
    const chip = chipOf(chipEl())
    const key = acting.entry.id
    after.current = () => {
      drop(chip, rowWords(key))
      slide()
    }
    backTo.current = key
    setActing(null)
    setFilter('')
  }

  // A first character that narrows, typed or put there by outside: the chip, and the words after it.
  const take = (value: string): boolean => {
    const prefixed = scope === null && !asking && acting === null ? BY_PREFIX.get(value.slice(0, 1)) : undefined
    if (prefixed === undefined) return false
    narrowTo(prefixed, null)
    words.set(value.slice(1).trimStart())
    return true
  }
  useLayoutEffect(() => {
    take(typed)
    // Only as the words change from outside.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed])

  const ranking = useRanked(
    entries,
    query,
    context,
    asking
      ? { kinds: ['said', 'note', 'issue', 'pull', 'task'], inside: 1, fuzzy: false, any: true }
      : scope === null
        ? {}
        : { kinds: scope.scope.kinds, inside: scope.scope.inside, fuzzy: scope.scope.id !== 'said' && scope.scope.id !== 'notes' },
  )
  // The last results stay while the next are ranked, but not the empty box's: the first key shows its own rows at once.
  const ranked = ranking.pending && ranking.query === '' ? [] : ranking.results
  const enterWhenReady = useRef(false)
  /* ——— What it lists ——— */
  const sections = useMemo((): ReadonlyArray<Section> => {
    const more = (entry: Entry) =>
      (entry.acts?.length ?? 0) > 1 ? (
        <span className={o.more} aria-hidden="true">
          <Kbd>→</Kbd>
        </span>
      ) : undefined
    const rowOf = (entry: Entry, found?: Found, className?: string) => {
      const item = { key: entry.id, run: choose(entry) }
      return {
        item,
        node: (list: List) => (
          <EntryRow
            key={entry.id}
            list={list}
            item={item}
            entry={entry}
            crossing={crossing}
            end={more(entry)}
            {...(found === undefined ? {} : { found })}
            {...(className === undefined ? {} : { className })}
          />
        ),
      }
    }
    const askRows = (text: string, end: ReactNode) => askable(ranked).map((one) => askRow(text, one, end))
    const askRow = (text: string, project: { id: string; name: string }, end: ReactNode) => {
      const item = ask(text, project.id)
      return {
        item,
        node: (list: List) => (
          <Row
            key={item.key}
            list={list}
            item={item}
            icon={<Icon name="comment" size={14} />}
            title={
              <>
                {ASK} <span className={o.quoted}>“{text}”</span>
              </>
            }
            {...(context.projects.length > 1 ? { facts: <span>{project.name}</span> } : {})}
            end={end}
          />
        ),
      }
    }
    if (acting !== null) return []

    if (asking) {
      if (query === '') return []
      const read = ranked.slice(0, 5)
      return [
        { key: 'ask', label: null, rows: askRows(query, <Kbd>{ENTER}</Kbd>) },
        ...(read.length === 0 ? [] : [{ key: 'reads', label: 'Related passages', rows: read.map((one) => rowOf(one.entry, one)) }]),
      ]
    }

    if (scope !== null) {
      const found = ranked
      return [{ key: `scope:${scope.scope.id}`, label: scope.scope.name, rows: found.slice(0, 40).map((one) => rowOf(one.entry, one)) }]
    }

    if (query === '') {
      const here = actionsHere(entries, context)
      const needs = needsYou(entries, context).filter((one) => one.place !== context.task)
      // What shows above isn't repeated: a task waiting on you, its pull request, an action listed here.
      const shown = new Set([...needs.map((one) => one.place), ...(context.task === null ? [] : [context.task])])
      const lately = recent(entries, context, 8)
        .filter((one) => !shown.has(one.place) && !(context.task === null && here.slice(0, 4).some((action) => action.id === one.id)))
        .slice(0, 4)
      const only = SCOPES.map((one) => {
        const item = { key: `only:${one.id}`, run: () => narrowTo(one, `only:${one.id}`) }
        return {
          item,
          node: (list: List) => (
            <Row
              key={item.key}
              list={list}
              item={item}
              icon={<Icon name={one.icon} size={14} />}
              title={one.name}
              end={<Kbd>{one.prefix}</Kbd>}
            />
          ),
        }
      })
      return [
        ...(context.task === null ? [] : [{ key: 'task', label: 'This task', rows: here.slice(0, 5).map((one) => rowOf(one)) }]),
        ...(needs.length === 0 ? [] : [{ key: 'needs', label: 'Needs you', rows: needs.slice(0, 3).map((one) => rowOf(one)) }]),
        ...(lately.length === 0 ? [] : [{ key: 'recent', label: 'Recent', rows: lately.map((one) => rowOf(one)) }]),
        ...(context.task === null ? [{ key: 'actions', label: 'Actions', rows: here.slice(0, 4).map((one) => rowOf(one)) }] : []),
        { key: 'only', label: 'Search only', rows: only },
      ]
    }

    const all = ranked
    // One thing, one row: a task stands for its pull request and its issue, whose keys it shows.
    const tasks = new Set(all.filter((one) => one.entry.kind === 'task').map((one) => one.entry.place))
    const found = all.filter((one) => !((one.entry.kind === 'pull' || one.entry.kind === 'issue') && tasks.has(one.entry.place)))
    const [top, ...rest] = found
    const byKind = new Map<Kind, Array<Found>>()
    for (const one of rest) byKind.set(one.entry.kind, [...(byKind.get(one.entry.kind) ?? []), one])
    // Each group where its best match is; a tie keeps the usual order of kinds.
    const groups = [...byKind.entries()].sort(
      ([a, one], [b, other]) => (other[0]?.score ?? 0) - (one[0]?.score ?? 0) || ORDER.indexOf(a) - ORDER.indexOf(b),
    )
    const starts = askable(ranked).map((project) => {
      const item = ask(query, project.id, true)
      return {
        item,
        node: (list: List) => (
          <Row
            key={item.key}
            list={list}
            item={item}
            icon={<Icon name="plus" size={14} />}
            title={
              <>
                Start a task <span className={o.quoted}>“{query}”</span>
              </>
            }
            facts={<span>{project.name}</span>}
          />
        ),
      }
    })
    const words_: Section = {
      key: 'words',
      label: 'Use the words',
      rows: [...askRows(query, <Kbd>Tab</Kbd>), ...starts],
    }
    if (top === undefined) return [words_]
    const question = asksSomething(query)
    return [
      ...(question ? [words_] : []),
      { key: 'top', label: 'Top hit', rows: [rowOf(top.entry, top, o.top)] },
      ...groups.map(([kind, list]) => ({
        key: `kind:${kind}`,
        label: KINDS_NAMED[kind],
        rows: list.slice(0, FEW[kind] ?? 3).map((one) => rowOf(one.entry, one)),
      })),
      ...(question ? [] : [words_]),
    ]
    // choose and ask read the latest at the moment they run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, query, scope, asking, acting, context, crossing, ranked])

  // What the chosen row can do, for →.
  const acts = useMemo((): ReadonlyArray<Act> => {
    if (acting === null) return []
    const current = entries.find((one) => one.id === acting.entry.id) ?? acting.entry
    const all = current.acts ?? [{ id: 'open', title: 'Open', icon: 'arrow' as const, go: acting.entry.go }]
    const by = wordsOf(filter)
    return all.filter((one) => by.every((word) => fold(one.title).includes(word)))
  }, [acting, filter, entries])

  const items: ReadonlyArray<Item> =
    acting === null
      ? sections.flatMap((section) => section.rows.map((row) => row.item))
      : acts.map((act) => ({
          key: `act:${act.id}`,
          run: () => {
            const entry = acting.entry
            // An act that opens carries the chip's words into the page.
            if (opens(act.go))
              into(chipEl()?.querySelector<HTMLElement>('[data-chip-text]') ?? null, titleFor(entry, act.go), onClose, () =>
                run(act.go, entry),
              )
            else {
              onClose()
              run(act.go, entry)
            }
          },
        }))
  // The selection starts over at the top as each new list of results shows, or when the top hit changes as the index fills in, not as words are typed over the list still shown.
  const list = useList(
    items,
    `${query === '' ? '' : `${ranking.shown}|${ranking.results[0]?.entry.id}`}|${scope?.scope.id}|${asking}|${acting?.entry.id}|${filter}`,
    backTo.current,
  )

  useLayoutEffect(() => {
    const job = after.current
    after.current = null
    // The row to go back to waits for the results it is in.
    if (!ranking.pending) backTo.current = null
    job?.()
    fieldWas.current = field.current?.offsetLeft ?? null
  })

  useLayoutEffect(() => {
    if (!ranking.pending && enterWhenReady.current) {
      enterWhenReady.current = false
      list.selected?.run()
    }
  })

  const selectedEntry = acting === null ? entries.find((one) => one.id === list.selected?.key) : undefined

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Enter' && acting === null && ranking.pending && (query !== '' || scope !== null)) {
      event.preventDefault()
      enterWhenReady.current = true
      return
    }
    const input = event.currentTarget
    const empty = input.value === ''
    const atEnd = input.selectionStart === input.value.length
    if (acting !== null) {
      if (event.key === 'Escape' || ((event.key === 'ArrowLeft' || event.key === 'Backspace') && empty)) {
        event.preventDefault()
        back()
        return
      }
      list.onKey(event)
      return
    }
    if (event.key === 'Escape' || (event.key === 'Backspace' && empty && (asking || scope !== null))) {
      event.preventDefault()
      if (asking) fromAsk()
      else if (scope !== null) widen()
      else onClose()
      return
    }
    // Tab asks the coordinator with the words, and Tab again goes back to searching.
    if (event.key === 'Tab' && !event.shiftKey) {
      event.preventDefault()
      if (asking) fromAsk()
      else toAsk()
      return
    }
    // → at the end of the words, or ⌘K again: what the chosen row can do.
    if (
      ((event.key === 'ArrowRight' && atEnd) || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k')) &&
      selectedEntry !== undefined
    ) {
      event.preventDefault()
      event.stopPropagation()
      drill(selectedEntry)
      return
    }
    list.onKey(event)
  }

  const chip: ReactNode =
    acting !== null ? (
      <span className={o.chip} data-chip="">
        <Icon name={acting.entry.icon} size={12} />
        <span data-chip-text="">{acting.entry.kind === 'said' ? acting.entry.title.slice(0, 40) : acting.entry.title}</span>
      </span>
    ) : asking ? (
      <span className={cx(o.chip, o.asking)} data-chip="">
        <Icon name="comment" size={12} />
        <span data-chip-text="">{ASK}</span>
      </span>
    ) : scope !== null ? (
      <span className={o.chip} data-chip="">
        <Icon name={scope.scope.icon} size={12} />
        <span data-chip-text="">{scope.scope.name}</span>
      </span>
    ) : undefined

  return (
    <Box label="Search" onClose={onClose} fit width={660} height={540} className={o.box}>
      <Field
        bare
        className={o.field}
        inputRef={field}
        value={acting === null ? typed : filter}
        onChange={(value) => {
          enterWhenReady.current = false
          if (acting !== null) setFilter(value)
          else if (!take(value)) words.set(value)
        }}
        onKeyDown={onKey}
        list={list}
        placeholder={
          acting !== null
            ? 'Search actions…'
            : asking
              ? 'Ask about any task, decision or change…'
              : scope !== null
                ? `Search ${scope.scope.name.toLowerCase()}…`
                : 'Search or do anything…'
        }
        before={chip}
        after={
          acting === null &&
          !asking && (
            <span className={o.hint} data-hint="">
              <span data-chip-text="">{ASK}</span>
              <Kbd>Tab</Kbd>
            </span>
          )
        }
      />
      <div ref={list.list} className={o.results} id={list.listId} role="listbox" aria-label="Results">
        <div ref={results} className={o.within}>
          {status}
          {ranking.failed && (
            <output>
              Search could not start.{' '}
              <Button size="small" variant="quiet" onClick={ranking.again}>
                Try again
              </Button>
            </output>
          )}
          <Glide />
          {asking && query === '' && (
            <p className={o.quiet}>Write a question for the coordinator. Enter opens its composer for you to send.</p>
          )}
          {acting !== null
            ? acts.map((act, n) => (
                <Row
                  key={act.id}
                  list={list}
                  item={items[n] as Item}
                  danger={act.danger === true}
                  icon={<Icon name={act.icon} size={14} />}
                  title={act.title}
                  {...(act.shortcut === undefined ? {} : { end: <Kbd>{act.shortcut}</Kbd> })}
                />
              ))
            : sections.map((section) => (
                <div key={section.key} role="group">
                  {section.label !== null && <Label>{section.label}</Label>}
                  {section.rows.map((row) => row.node(list))}
                </div>
              ))}
        </div>
      </div>
    </Box>
  )
}

/** One highlight under the chosen row, sliding to each next one on the kit's spring, rather than a row lighting up. */
function Glide() {
  const mark = useRef<HTMLDivElement>(null)
  const placed = useRef(false)
  useLayoutEffect(() => {
    // Its list is where it is drawn: the parent's ref isn't set yet when this first runs.
    const el = mark.current
    const box = el?.parentElement ?? null
    if (box === null || el === null) return
    const row = box.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')
    if (row === null) {
      el.style.opacity = '0'
      placed.current = false
      return
    }
    const smooth = placed.current
    if (!smooth) el.style.transition = 'none'
    el.style.transform = `translateY(${row.offsetTop}px)`
    el.style.height = `${row.offsetHeight}px`
    el.style.opacity = '1'
    if (!smooth) {
      // Placed where it starts, then free to slide from there.
      void el.offsetHeight
      el.style.removeProperty('transition')
    }
    placed.current = true
  })
  return <div ref={mark} className={o.glide} aria-hidden="true" />
}
