import { useEffect, useRef, useState } from 'react'

import {
  Artifacts,
  Button,
  Icon,
  Markdown,
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSwitchItem,
  Segmented,
  You,
} from '@althar/ui'

import {
  agoWords,
  ARTIFACTS,
  type Artifact,
  artifactOf,
  type ArtifactKind,
  boardCount,
  CANVAS_KIND,
  GIFT,
  KIND_WORDS,
  REACH,
  type Reach,
} from '../artifacts'
import { ReachTag } from '../parts/ChatBar'
import { GIFT_SO_FAR } from '../data'
import { chat, useChat } from '../chat'
import { ask, live, type Spot, useLive } from '../live'
import { momentOf, type Moment } from '../moments'
import { ArtifactCanvas } from '../parts/ArtifactCanvas'
import { Glyph } from '../parts/Glyph'
import { Where } from '../parts/Keep'
import { Sheet } from '../parts/Sheet'
import { Thumb } from '../parts/Thumb'
import { roundOf, useLab } from '../state'
import r from './room.module.css'

/*
 * The lab's Artifacts room (in place of features/canvases/ArtifactsView, in
 * the project's view). B: every artifact, as cards that are a little of
 * their canvas or as a list, found by words, filtered and sorted; one opened
 * takes the room, its conversation docked beside it. C opens Gift a class
 * there, every page at once. A and D keep today's table, and an artifact
 * opened from it is the canvas they put beside a conversation, as wide as
 * the room.
 */

export function ArtifactsView(_: { projectId: string; threadId: string | null; draft: string | null }) {
  const { d, m } = useLab()
  const { room } = useChat()
  const moment = momentOf(d, m)
  const key = String(roundOf())
  // An artifact opened here is its chat: the top row is its (seams/ui.tsx), the room its canvas and conversation.
  if (room !== null) return <ArtifactRoom key={`${key}|${room}`} id={room} moment={moment} />
  if (d === 'b' || d === 'c') return <Gallery key={key} />
  return <Table />
}

/* ——— A, D: today's table ——— */

function Table() {
  const [now] = useState(() => Date.now())
  return (
    <Artifacts
      canvases={ARTIFACTS.map((one) => ({
        id: one.id,
        name: one.name,
        title: one.title,
        kind: CANVAS_KIND[one.kind],
        version: live.version(one),
        by: one.by,
        when: agoWords(one.ago),
        at: new Date(now - one.ago * 60_000).toISOString(),
        openComments: one.comments,
      }))}
      onOpen={(row) => chat.room(row.id)}
      open={null}
    />
  )
}

/* ——— B: every artifact, and an artifact's own room ——— */

const TASK_ORDER = ['Gift a class', 'Bigger photos on Classes', 'A calmer checkout', null] as const
const KINDS: ReadonlyArray<ArtifactKind> = ['design', 'diagram', 'document', 'chart']
const PLURAL: Readonly<Record<ArtifactKind, string>> = { design: 'Designs', diagram: 'Diagrams', document: 'Documents', chart: 'Charts' }

type Sort = 'newest' | 'oldest' | 'name' | 'boards' | 'comments'
const SORTS: ReadonlyArray<{ readonly value: Sort; readonly label: string }> = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'name', label: 'Name' },
  { value: 'boards', label: 'Most boards' },
  { value: 'comments', label: 'Most comments' },
]
const sortBy = (sort: Sort) => (a: Artifact, b: Artifact) =>
  sort === 'newest'
    ? a.ago - b.ago
    : sort === 'oldest'
      ? b.ago - a.ago
      : sort === 'name'
        ? a.title.localeCompare(b.title)
        : sort === 'boards'
          ? boardCount(b) - boardCount(a)
          : b.comments - a.comments

type From = 'lead' | 'coordinator' | 'person'
const FROM_WORDS: Readonly<Record<From, string>> = { lead: 'A task’s lead', coordinator: 'The coordinator', person: 'Someone, by hand' }
const fromOf = (one: Artifact): From => (one.found === true ? 'person' : one.task === null ? 'coordinator' : 'lead')

interface Filters {
  readonly kinds: ReadonlySet<ArtifactKind>
  readonly where: 'git' | 'althar' | null
  readonly from: ReadonlySet<From>
  readonly talked: boolean
  readonly reach: ReadonlySet<Reach>
}
const NONE: Filters = { kinds: new Set(), where: null, from: new Set(), talked: false, reach: new Set() }
const toggled = <T,>(set: ReadonlySet<T>, one: T) => {
  const next = new Set(set)
  if (next.has(one)) next.delete(one)
  else next.add(one)
  return next
}

/** Where it came from, in a few words: the task, or who. */
const fromWords = (one: Artifact) => (one.found === true ? `${one.by}, by hand` : (one.task ?? 'The coordinator'))

function Gallery() {
  const [look, setLook] = useState<'cards' | 'list'>('cards')
  const [sort, setSort] = useState<Sort>('newest')
  const [byTask, setByTask] = useState(false)
  const [filters, setFilters] = useState<Filters>(NONE)
  const [words, setWords] = useState('')
  useLive()
  const setOpen = chat.room
  const said = words.trim().toLowerCase()
  const shown = ARTIFACTS.filter(
    (one) =>
      (filters.kinds.size === 0 || filters.kinds.has(one.kind)) &&
      (filters.where === null || (live.keptOf(one) !== null) === (filters.where === 'git')) &&
      (filters.from.size === 0 || filters.from.has(fromOf(one))) &&
      (!filters.talked || one.comments > 0) &&
      (filters.reach.size === 0 || filters.reach.has(live.reachOf(one))) &&
      (said === '' || `${one.title} ${one.name} ${one.by} ${one.task ?? ''} ${live.keptOf(one)?.path ?? ''}`.toLowerCase().includes(said)),
  ).sort(sortBy(sort))
  const groups = byTask
    ? [
        ...TASK_ORDER.map((task) => ({
          name: task === null ? 'The coordinator' : task,
          artifacts: shown.filter((one) => one.task === task && one.found !== true),
        })),
        { name: 'Found in git', artifacts: shown.filter((one) => one.found === true) },
      ].filter((one) => one.artifacts.length > 0)
    : [{ name: null as string | null, artifacts: shown }]
  const chips = [
    ...[...filters.kinds].map((kind) => ({
      key: kind,
      label: PLURAL[kind],
      off: () => setFilters({ ...filters, kinds: toggled(filters.kinds, kind) }),
    })),
    ...(filters.where === null
      ? []
      : [
          {
            key: 'where',
            label: filters.where === 'git' ? 'In git' : 'Only in Althar',
            off: () => setFilters({ ...filters, where: null }),
          },
        ]),
    ...[...filters.from].map((from) => ({
      key: from,
      label: FROM_WORDS[from],
      off: () => setFilters({ ...filters, from: toggled(filters.from, from) }),
    })),
    ...[...filters.reach].map((reach) => ({
      key: reach,
      label: REACH[reach].label,
      off: () => setFilters({ ...filters, reach: toggled(filters.reach, reach) }),
    })),
    ...(filters.talked ? [{ key: 'talked', label: 'With open comments', off: () => setFilters({ ...filters, talked: false }) }] : []),
  ]
  return (
    <div className={r.gallery}>
      <header className={r.galleryHead}>
        <h1 className={r.heading}>Artifacts</h1>
        <span className={r.count}>{shown.length === ARTIFACTS.length ? shown.length : `${shown.length} of ${ARTIFACTS.length}`}</span>
        <span className={r.gap} />
        <label className={r.search}>
          <Icon name="search" size={13} />
          <input
            value={words}
            placeholder="Find an artifact"
            aria-label="Find an artifact"
            onChange={(event) => setWords(event.target.value)}
          />
        </label>
        <Menu
          label="Filter"
          align="end"
          width={240}
          trigger={
            <button type="button" className={r.tool} data-on={chips.length > 0 || undefined}>
              <Glyph name="filter" size={13} />
              Filter
              {chips.length > 0 && <span className={r.toolCount}>{chips.length}</span>}
            </button>
          }
        >
          <MenuGroup label="Kind">
            {KINDS.map((kind) => (
              <MenuCheckboxItem
                key={kind}
                keepOpen
                checked={filters.kinds.has(kind)}
                onCheckedChange={() => setFilters({ ...filters, kinds: toggled(filters.kinds, kind) })}
                hint={String(ARTIFACTS.filter((one) => one.kind === kind).length)}
              >
                {PLURAL[kind]}
              </MenuCheckboxItem>
            ))}
          </MenuGroup>
          <MenuSeparator />
          <MenuRadioGroup
            label="Where it lives"
            value={filters.where ?? 'anywhere'}
            onChange={(value) => setFilters({ ...filters, where: value === 'anywhere' ? null : (value as 'git' | 'althar') })}
          >
            <MenuRadioItem value="anywhere" keepOpen>
              Anywhere
            </MenuRadioItem>
            <MenuRadioItem value="git" keepOpen hint={String(ARTIFACTS.filter((one) => live.keptOf(one) !== null).length)}>
              In git
            </MenuRadioItem>
            <MenuRadioItem value="althar" keepOpen hint={String(ARTIFACTS.filter((one) => live.keptOf(one) === null).length)}>
              Only in Althar
            </MenuRadioItem>
          </MenuRadioGroup>
          <MenuSeparator />
          <MenuGroup label="Made by">
            {(['lead', 'coordinator', 'person'] as const).map((from) => (
              <MenuCheckboxItem
                key={from}
                keepOpen
                checked={filters.from.has(from)}
                onCheckedChange={() => setFilters({ ...filters, from: toggled(filters.from, from) })}
              >
                {FROM_WORDS[from]}
              </MenuCheckboxItem>
            ))}
          </MenuGroup>
          <MenuSeparator />
          <MenuGroup label="Who sees it">
            {(['draft', 'shared', 'published'] as const).map((reach) => (
              <MenuCheckboxItem
                key={reach}
                keepOpen
                checked={filters.reach.has(reach)}
                onCheckedChange={() => setFilters({ ...filters, reach: toggled(filters.reach, reach) })}
                hint={String(ARTIFACTS.filter((one) => live.reachOf(one) === reach).length)}
              >
                {REACH[reach].label}
              </MenuCheckboxItem>
            ))}
          </MenuGroup>
          <MenuSeparator />
          <MenuCheckboxItem keepOpen checked={filters.talked} onCheckedChange={(on) => setFilters({ ...filters, talked: on })}>
            With open comments
          </MenuCheckboxItem>
        </Menu>
        <Menu
          label="Sort"
          align="end"
          width={220}
          trigger={
            <button type="button" className={r.tool}>
              <Glyph name="sort" size={13} />
              {SORTS.find((one) => one.value === sort)?.label}
            </button>
          }
        >
          <MenuRadioGroup label="Sort by" value={sort} onChange={(value) => setSort(value as Sort)}>
            {SORTS.map((one) => (
              <MenuRadioItem key={one.value} value={one.value}>
                {one.label}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
          <MenuSeparator />
          <MenuSwitchItem checked={byTask} onCheckedChange={setByTask}>
            Group by task
          </MenuSwitchItem>
        </Menu>
        <Segmented
          label="Show as"
          value={look}
          onChange={setLook}
          options={[
            {
              value: 'cards',
              label: (
                <>
                  <Glyph name="everyBoard" size={14} />
                  <span className={r.hidden}>Cards</span>
                </>
              ) as unknown as string,
              tooltip: { label: 'Cards' },
            },
            {
              value: 'list',
              label: (
                <>
                  <Glyph name="list" size={14} />
                  <span className={r.hidden}>List</span>
                </>
              ) as unknown as string,
              tooltip: { label: 'List' },
            },
          ]}
        />
      </header>
      {chips.length > 0 && (
        <div className={r.chips}>
          {chips.map((chip) => (
            <button key={chip.key} type="button" className={r.chip} onClick={chip.off} aria-label={`Stop filtering by ${chip.label}`}>
              {chip.label}
              <Icon name="close" size={10} />
            </button>
          ))}
          <button type="button" className={r.clearAll} onClick={() => setFilters(NONE)}>
            Clear
          </button>
        </div>
      )}
      <div className={r.galleryBody}>
        {shown.length === 0 && <p className={r.empty}>No artifact fits. Clear a filter, or find other words.</p>}
        {groups.map((group) => (
          <section key={group.name ?? 'all'} className={r.group}>
            {group.name !== null && (
              <h2 className={r.groupName}>
                {group.name}
                <span className={r.groupCount}>{group.artifacts.length}</span>
              </h2>
            )}
            {look === 'cards' ? (
              <div className={r.grid}>
                {group.artifacts.map((one) => (
                  <Card key={one.id} artifact={one} onOpen={() => setOpen(one.id)} />
                ))}
              </div>
            ) : (
              <List artifacts={group.artifacts} sort={sort} onSort={setSort} onOpen={setOpen} />
            )}
          </section>
        ))}
      </div>
    </div>
  )
}

/** An artifact as a card: a little of its canvas, then what it is and where it came from. */
function Card({ artifact, onOpen }: { artifact: Artifact; onOpen: () => void }) {
  const kept = live.keptOf(artifact)
  const pages = artifact.pages.length
  return (
    <button type="button" className={r.card} onClick={onOpen}>
      <span className={r.cardSheet}>
        <Sheet artifact={artifact} className={r.sheet} />
        <span className={r.cardKind}>
          {KIND_WORDS[artifact.kind]}
          {artifact.kind === 'design' && (
            <span className={r.cardKindFacts}>
              {pages > 1 ? `${pages} pages · ` : ''}
              {boardCount(artifact)} boards
            </span>
          )}
        </span>
        {kept !== null && (
          <span className={r.cardGit} title={`In ${kept.repo}/${kept.path}`}>
            <Glyph name="repo" size={12} />
          </span>
        )}
      </span>
      <span className={r.cardWords}>
        <span className={r.cardTop}>
          <span className={r.cardTitle}>{artifact.title}</span>
          {/* A draft is unmarked; shared or published says so. */}
          {live.reachOf(artifact) !== 'draft' && <ReachTag reach={live.reachOf(artifact)} />}
          <span className={r.cardVersion}>v{live.version(artifact)}</span>
        </span>
        <span className={r.cardFacts}>
          <span className={r.cardFrom} data-from={fromOf(artifact)}>
            {fromWords(artifact)}
          </span>
          <span>·</span>
          <span>{agoWords(artifact.ago)}</span>
          {artifact.comments > 0 && (
            <span className={r.cardComments}>
              <Icon name="comment" size={11} /> {artifact.comments}
            </span>
          )}
        </span>
      </span>
    </button>
  )
}

/** Artifacts as a list: a row each, its columns sorting it. */
function List({
  artifacts,
  sort,
  onSort,
  onOpen,
}: {
  artifacts: ReadonlyArray<Artifact>
  sort: Sort
  onSort: (sort: Sort) => void
  onOpen: (id: string) => void
}) {
  const column = (label: string, by: Sort | null, className?: string) => (
    <th className={className} aria-sort={by !== null && sort === by ? (by === 'name' ? 'ascending' : 'descending') : undefined}>
      {by === null ? (
        label
      ) : (
        <button type="button" className={r.th} data-on={sort === by || undefined} onClick={() => onSort(by)}>
          {label}
          {sort === by && <Glyph name="down" size={10} />}
        </button>
      )}
    </th>
  )
  return (
    <table className={r.list}>
      <thead>
        <tr>
          {column('Name', 'name', r.colName)}
          {column('Kind', null)}
          {column('Boards', 'boards', r.colNum)}
          {column('From', null)}
          {column('Who sees it', null)}
          {column('In git', null)}
          {column('Comments', 'comments', r.colNum)}
          {column('Changed', 'newest', r.colWhen)}
        </tr>
      </thead>
      <tbody>
        {artifacts.map((one) => (
          <tr key={one.id} className={r.row} onClick={() => onOpen(one.id)}>
            <td className={r.colName}>
              <button type="button" className={r.rowOpen} onClick={() => onOpen(one.id)}>
                <Thumb artifact={one} className={r.rowThumb} />
                <span className={r.rowWords}>
                  <span className={r.rowTitle}>{one.title}</span>
                  <span className={r.rowName}>{one.name}</span>
                </span>
              </button>
            </td>
            <td>{KIND_WORDS[one.kind]}</td>
            <td className={r.colNum}>{boardCount(one)}</td>
            <td>
              <span className={r.cardFrom} data-from={fromOf(one)}>
                {fromWords(one)}
              </span>
            </td>
            <td>
              <ReachTag reach={live.reachOf(one)} />
            </td>
            <td className={r.colWhere}>{live.keptOf(one) === null ? <span className={r.none}>—</span> : <Where artifact={one} />}</td>
            <td className={r.colNum}>{one.comments > 0 ? one.comments : <span className={r.none}>—</span>}</td>
            <td className={r.colWhen}>
              v{live.version(one)} · {agoWords(one.ago)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** An artifact opened in the project's Artifacts: its chat, the conversation with the lead that drew it docked beside its canvas. Its top row is the chat's (seams/ui.tsx). */
function ArtifactRoom({ id, moment }: { id: string; moment: Moment }) {
  const artifact = artifactOf(id)
  const { wide } = useChat()
  useLive()
  return (
    <div
      className={r.room}
      onKeyDown={(event) => {
        // The canvas takes Escape first, for what is open on it; then it's back to every artifact.
        if (event.key === 'Escape' && !event.defaultPrevented) chat.room(null)
      }}
    >
      <div className={r.roomBody}>
        {!wide && <Talk artifact={artifact} />}
        <ArtifactCanvas key={id} artifact={artifact} talk="conversation" opening={id === moment.open ? moment.opening : {}} />
      </div>
    </div>
  )
}

/** The conversation docked beside an artifact: its task's, from the first ask; what is said here is said there. */
function Talk({ artifact }: { artifact: Artifact }) {
  const world = useLive()
  const [words, setWords] = useState('')
  const end = useRef<HTMLDivElement>(null)
  const gift = artifact.id === GIFT
  const before: ReadonlyArray<{ readonly who: 'you' | 'lead' | 'canvas'; readonly text: string }> = artifact.found
    ? [{ who: 'canvas' as const, text: `${artifact.by} committed it ${agoWords(artifact.ago)}` }]
    : gift
      ? GIFT_SO_FAR.map((one) =>
          one.who === 'canvas' ? { who: 'canvas' as const, text: `v${one.version} · ${one.note}` } : { who: one.who, text: one.text },
        )
      : [
          { who: 'you' as const, text: `${artifact.task ?? 'This'}.` },
          { who: 'lead' as const, text: `${artifact.title} is on the canvas, ${boardCount(artifact)} boards.` },
        ]
  const lines = [...before, ...world.lines.map((one) => ({ who: one.who, text: one.text }))]
  useEffect(() => {
    const box = end.current?.parentElement
    if (box != null) box.scrollTop = box.scrollHeight
  }, [lines.length, world.working])
  const said = words.trim()
  const send = () => {
    if (said === '') return
    const page = artifact.pages[0]
    const board = page?.boards[0]
    if (page === undefined || board === undefined) return
    const spot: Spot = {
      artifactId: artifact.id,
      boardId: board.id,
      selector: null,
      label: 'The whole board',
      box: { x: 0, y: 0, width: 0, height: 0 },
      part: null,
    }
    ask(artifact, board, page.id, spot, said)
    setWords('')
  }
  return (
    <section className={r.talk} aria-label={`Talking about ${artifact.title}`}>
      <div className={r.lines}>
        {lines.map((line, i) =>
          line.who === 'you' ? (
            <You key={i} className={r.you}>
              {line.text}
            </You>
          ) : line.who === 'canvas' ? (
            <div key={i} className={r.canvasLine}>
              <Icon name="canvas" size={12} />
              {line.text}
            </div>
          ) : (
            <div key={i} className={r.lead}>
              <Markdown source={line.text} size="panel" />
            </div>
          ),
        )}
        {world.working && <div className={r.working}>Changing it on the canvas</div>}
        <div ref={end} />
      </div>
      <div className={r.compose}>
        <textarea
          className={r.composeField}
          rows={2}
          value={words}
          placeholder={`Say something about ${artifact.title}`}
          aria-label="Message"
          onChange={(event) => setWords(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              send()
            }
          }}
        />
        <div className={r.composeFoot}>
          <span className={r.composeHint}>
            {artifact.found ? 'Saying something starts a task on it' : 'Or point at a part on the canvas'}
          </span>
          <Button size="small" variant="signal" disabled={said === ''} onClick={send}>
            Send
          </Button>
        </div>
      </div>
    </section>
  )
}
