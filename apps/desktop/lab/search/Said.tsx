import { type KeyboardEvent, type ReactNode, useMemo } from 'react'

import { Icon } from '@althar/ui'

import { run } from './go'
import { asksSomething, type Context, FILLER, type Entry, entriesFor, type Found, projectName, recent, search, titleParts } from './index'
import { fold, passageOf, wordsOf } from './match'
import {
  agoOf,
  Box,
  cx,
  ENTER,
  Field,
  Foot,
  type Item,
  Label,
  type List,
  Marked,
  MOD,
  ProjectTag,
  Row,
  s,
  shows,
  useList,
  whoOf,
} from './parts'
import { useStore, words } from './state'
import { PROJECTS, taskOf } from './world'

/*
 * C · What was said (Superhuman's search, Slack's, a mail client's). What
 * Althar knows is mostly in its conversations: what you asked, what a lead
 * reported, what the coordinator decided, the notes kept from it. So the
 * box searches the words inside everything and shows the passage, grouped
 * by where it was said: each task or conversation once, its best passages
 * under it. The chosen passage opens in place to the whole message; Enter
 * opens the thread there, scrolled to it. Words that ask something, or
 * that nothing answers, go to the coordinator first. in: from: is: narrow
 * it, typed among the words.
 */

interface Narrow {
  readonly project: string | null
  readonly from: 'you' | 'lead' | 'coordinator' | null
  readonly is: string | null
  readonly words: string
}

/** The operators among the words, and the words left. */
const narrowOf = (typed: string): Narrow => {
  let project: string | null = null
  let from: Narrow['from'] = null
  let is: string | null = null
  const left = typed.replace(/\b(in|from|is):(\S*)/gi, (whole, op: string, value: string) => {
    const v = value.toLowerCase()
    if (op.toLowerCase() === 'in') project = PROJECTS.find((one) => v !== '' && one.name.startsWith(v))?.id ?? null
    if (op.toLowerCase() === 'from')
      from = v.startsWith('me') || v.startsWith('you') ? 'you' : v.startsWith('l') ? 'lead' : v.startsWith('c') ? 'coordinator' : null
    if (op.toLowerCase() === 'is') is = v === '' ? null : v
    return ''
  })
  return { project, from, is, words: left.replace(/\s+/g, ' ').trim() }
}

const PHASES: Readonly<Record<string, ReadonlyArray<string>>> = {
  open: ['planned', 'held', 'running', 'waiting', 'ready', 'kept', 'stopped'],
  running: ['running'],
  ready: ['ready'],
  waiting: ['waiting'],
  merged: ['settled'],
  done: ['settled'],
}

/** Where something was said or written, as C groups by it. */
const placeKey = (entry: Entry) => {
  if (entry.kind === 'note') return `notes:${entry.project}`
  if (entry.kind === 'conversation') return `conversation:${entry.project}`
  if (entry.place !== undefined) return entry.place.startsWith('conversation:') ? entry.place : `task:${entry.place}`
  return entry.id
}

interface Group {
  readonly key: string
  readonly head: Entry
  /** The head's own match, where its title matched. */
  readonly headFound: Found | null
  readonly passages: ReadonlyArray<Found>
  readonly more: number
  readonly score: number
}

const OPERATORS = ['in:', 'from:me', 'from:lead', 'is:open'] as const

export function Said({ context, onClose }: { context: Context; onClose: () => void }) {
  const typed = useStore(words)
  const narrow = narrowOf(typed)
  const query = narrow.words
  const entries = useMemo(() => entriesFor(context), [context])
  const all = useMemo(() => entriesFor({ project: null, task: context.task }), [context.task])
  const crossing = narrow.project ?? context.project ?? true
  const headOf = useMemo(() => {
    const by = new Map<string, Entry>()
    for (const entry of all) {
      if (entry.kind === 'task') by.set(`task:${entry.place}`, entry)
      if (entry.kind === 'conversation') by.set(`conversation:${entry.project}`, entry)
    }
    return by
  }, [all])
  const noteHead = (project: string): Entry => ({
    id: `notes:${project}`,
    kind: 'note',
    title: `${projectName(project)}’s notes`,
    icon: 'quote',
    project,
    go: { to: 'project', project, room: 'settings', section: 'notes' },
  })

  const groups = useMemo((): ReadonlyArray<Group> => {
    if (query === '' && narrow.from === null && narrow.is === null) return []
    const found = search(all, query, context, {
      kinds: ['task', 'said', 'note', 'pull', 'issue', 'conversation'],
      project: narrow.project,
      inside: 1,
      fuzzy: false,
      any: true,
    })
    const by = new Map<string, { head: Entry; headFound: Found | null; passages: Array<Found>; score: number }>()
    for (const one of found) {
      const entry = one.entry
      if (narrow.from !== null && (entry.kind !== 'said' || entry.who !== narrow.from)) continue
      const key = placeKey(entry)
      const slug = key.startsWith('task:') ? key.slice(5) : null
      if (narrow.is !== null) {
        const phase = slug === null ? null : (taskOf(slug)?.phase ?? null)
        if (phase === null || !(PHASES[narrow.is] ?? [narrow.is]).includes(phase)) continue
      }
      const head = headOf.get(key) ?? (entry.kind === 'note' ? noteHead(entry.project ?? 'p_althar') : entry)
      const group = by.get(key) ?? { head, headFound: null, passages: [], score: 0 }
      const isHead = entry.id === head.id
      // The head's title matched: it shows marked. Its body matched: what was said says where, so it adds nothing.
      if (isHead) group.headFound = one.ranges.length > 0 ? one : group.headFound
      else if (entry.kind === 'said' || entry.kind === 'note' || one.passage !== null) group.passages.push(one)
      group.score = Math.max(group.score, one.score + (isHead && one.ranges.length > 0 ? 4 : 0))
      by.set(key, group)
    }
    return [...by.entries()]
      .map(([key, group]) => ({
        key,
        head: group.head,
        headFound: group.headFound,
        passages: group.passages.slice(0, 2),
        more: Math.max(0, group.passages.length - 2),
        score: group.score + Math.min(group.passages.length, 4) * 0.5,
      }))
      .filter((group) => group.passages.length > 0 || group.headFound !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 24)
  }, [all, query, narrow.project, narrow.from, narrow.is, context, headOf])

  const project = narrow.project ?? context.project ?? 'p_althar'
  const asking = query !== '' && (asksSomething(query) || groups.length === 0)
  const askItem: Item = {
    key: 'ask',
    run: () => {
      onClose()
      run({ to: 'ask', project, text: query })
    },
  }

  const lately = useMemo(
    () => (typed.trim() === '' ? recent(entries, context, 8).filter((one) => one.kind === 'task' || one.kind === 'conversation') : []),
    [entries, context, typed],
  )

  // Rows are gathered first, then drawn once the list knows which is chosen.
  const items: Array<Item> = []
  const drawn: Array<(list: List) => ReactNode> = []
  const add = (item: Item, node: (item: Item, list: List) => ReactNode) => {
    items.push(item)
    drawn.push((list) => node(item, list))
  }
  const nodes = { push: (node: ReactNode) => void drawn.push(() => node) }
  const choose = (entry: Entry) => () => {
    onClose()
    run(entry.go, entry)
  }
  const askRow = () =>
    add(askItem, (item, list) => (
      <Row
        key="ask"
        list={list}
        item={item}
        className={s.askRow}
        icon={<Icon name="comment" size={14} />}
        title={`Ask ${projectName(project)}’s coordinator`}
        facts={<span>“{query}”</span>}
      />
    ))

  if (typed.trim() === '') {
    nodes.push(<Label key="l-recent">Recent</Label>)
    for (const entry of lately)
      add({ key: entry.id, run: choose(entry) }, (item, list) => (
        <Row
          key={entry.id}
          list={list}
          item={item}
          className={s.place}
          icon={<Icon name={entry.icon} size={14} />}
          title={entry.title}
          facts={shows(crossing, entry.project) && entry.project !== undefined ? <ProjectTag id={entry.project} /> : undefined}
          {...(entry.stand === undefined ? {} : { stand: entry.stand })}
        />
      ))
  } else {
    if (asking) askRow()
    const words_ = wordsOf(query).filter((word) => !FILLER.has(word))
    for (const group of groups) {
      const head = group.head
      add({ key: `head:${group.key}`, run: choose(head) }, (item, list) => (
        <Row
          key={`head:${group.key}`}
          list={list}
          item={item}
          className={s.place}
          icon={<Icon name={head.icon} size={14} />}
          title={group.headFound === null ? head.title : <Marked parts={titleParts(group.headFound)} />}
          facts={
            <>
              {shows(crossing, head.project) && head.project !== undefined && <ProjectTag id={head.project} />}
              {(head.facts ?? []).map((fact) => (
                <span key={fact} className={s.num}>
                  {fact}
                </span>
              ))}
            </>
          }
          {...(head.stand === undefined ? {} : { stand: head.stand })}
        />
      ))
      for (const passage of group.passages) {
        const entry = passage.entry
        add({ key: entry.id, run: choose(entry) }, (item, list) => {
          const open = list.isSelected(item.key)
          const text = entry.body ?? entry.title
          const parts = open
            ? (passageOf(text, words_, 10_000) ?? [{ text, hit: false }])
            : (passageOf(text, words_, 50) ?? passage.passage ?? [{ text, hit: false }])
          return (
            <Row
              key={entry.id}
              list={list}
              item={item}
              className={s.said}
              icon={<span className={s.thread} />}
              title={
                <span className={s.saidHead}>
                  <span className={s.who}>
                    {entry.kind === 'note'
                      ? 'Note'
                      : entry.kind === 'issue' || entry.kind === 'pull'
                        ? (entry.facts?.[0] ?? entry.title)
                        : (whoOf(entry) ?? entry.title)}
                  </span>
                  <span>{agoOf(entry.ago)}</span>
                </span>
              }
              passage={
                <>
                  <span className={s.passage}>
                    <Marked parts={parts} />
                  </span>
                  <span className={s.peekFoot}>
                    <kbd>{ENTER}</kbd> {entry.kind === 'note' ? 'show in Notes' : 'open the thread here'}
                  </span>
                </>
              }
            />
          )
        })
      }
      if (group.more > 0)
        nodes.push(
          <div key={`more:${group.key}`} className={cx(s.hint)} style={{ padding: '0 10px 6px 38px' }}>
            {group.more} more said here
          </div>,
        )
    }
    if (!asking && groups.length > 0) {
      nodes.push(<Label key="l-ask">Or ask</Label>)
      askRow()
    }
  }

  const list = useList(items, typed)
  const selected = items[list.at]
  const selectedHead = groups.find((group) => group.passages.some((one) => one.entry.id === selected?.key))?.head

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      return
    }
    // ⌘↵ opens the place itself, from its top, rather than at what was said.
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && selectedHead !== undefined) {
      event.preventDefault()
      onClose()
      run(selectedHead.go, selectedHead)
      return
    }
    list.onKey(event)
  }

  const insert = (operator: string) => words.set(`${typed.trim()} ${operator}`.trimStart())
  return (
    <Box label="Search what was said" width={720} height={620} onClose={onClose}>
      <Field
        value={typed}
        onChange={(value) => words.set(value)}
        onKeyDown={onKey}
        list={list}
        placeholder="Search everything said and written"
        before={
          <>
            {narrow.project !== null && (
              <span className={s.chip}>
                <span className={s.prefix}>in</span>
                {projectName(narrow.project)}
              </span>
            )}
            {narrow.from !== null && (
              <span className={s.chip}>
                <span className={s.prefix}>from</span>
                {narrow.from === 'you' ? 'you' : narrow.from}
              </span>
            )}
            {narrow.is !== null && (
              <span className={s.chip}>
                <span className={s.prefix}>is</span>
                {narrow.is}
              </span>
            )}
          </>
        }
      />
      {typed.trim() === '' && (
        <div className={s.operators}>
          {OPERATORS.map((one) => (
            <button
              key={one}
              type="button"
              tabIndex={-1}
              className={s.operator}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => insert(one)}
            >
              {one}
            </button>
          ))}
        </div>
      )}
      <div ref={list.list} className={s.results} id={list.listId} role="listbox" aria-label="What was said">
        {drawn.map((draw) => draw(list))}
        {typed.trim() !== '' && groups.length === 0 && query === '' && <p className={s.empty}>Nothing said matches.</p>}
      </div>
      <Foot
        keys={[
          [['↑', '↓'], 'move'],
          [[ENTER], selected?.key === 'ask' ? 'ask' : 'open there'],
          ...(selectedHead === undefined ? [] : [[[`${MOD}${ENTER}`], 'open from the top'] as const]),
        ]}
        end={fold(typed).includes(':') ? undefined : <span className={s.hint}>in: from: is: narrow it</span>}
      />
    </Box>
  )
}
