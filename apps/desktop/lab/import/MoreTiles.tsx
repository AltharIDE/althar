import { Fragment, type ReactNode, type RefObject, useLayoutEffect, useRef, useState } from 'react'

import { Icon, LinkButton } from '@althar/ui'

import { AllNone, ByKind, Mark, type Picks, SectionHead, Tick, WorktreeFacts } from './Found'
import { text as shortcut } from './Shortcuts'
import { narrowed, tileState, text as variants } from './Variants'
import { isAgent, nameOf, type Source, SOURCES, when } from './world'
import s from './tiles.module.css'

/*
 * More of H, the tiles (K–M): a tile a tool, a press takes all of it. K opens
 * a tile's list in a panel under its row. L shows the latest few things on
 * the tile itself, each tickable. M starts with what's under way, a meter on
 * each tile for how much of it comes.
 */

export const text = {
  found: 'Found',
  lookInside: 'Look inside',
  hideList: 'Hide the list',
  inside: (who: string) => `What’s in ${who}`,
  more: (n: number) => `${n} more`,
  fewer: 'Fewer',
  older: (n: number) => `${n} older conversations`,
  backToUnderway: 'Back to what’s under way',
  allOf: (n: string) => `All ${n}`,
}

type State = 'on' | 'mixed' | 'off'

/** The sources with anything here, in the order of the lab's world. */
const offered = (picks: Picks) => SOURCES.filter((who) => tileState(picks, who).of > 0)

const takeAll = (picks: Picks, sources: readonly Source[], on: boolean) => {
  for (const who of sources) picks.source(who, on)
}

/** How much a source has, said: an agent's conversations, a tool's worktrees. */
const sizeOf = (picks: Picks, who: Source) =>
  isAgent(who) ? shortcut.conversations(tileState(picks, who).of) : shortcut.worktrees(tileState(picks, who).of)

/** A source's most telling fact: a tool's newest worktree's, else when it was last used. */
function Fact({ picks, who }: { picks: Picks; who: Source }) {
  const t = picks.things(who)
  const newest = [...t.worktrees].sort((a, b) => b.touched.localeCompare(a.touched))[0]
  if (!isAgent(who) && newest !== undefined) return <WorktreeFacts one={newest} first />
  const latest = [...t.worktrees.map((one) => one.touched), ...t.conversations.map((one) => one.at)].sort().at(-1)
  return latest === undefined ? null : <>{variants.latest(when(latest))}</>
}

/** The tile's own tick: all of it, some, none. */
function Box({ state }: { state: State }) {
  return (
    <span className={s.box} data-state={state}>
      {state === 'on' ? <Icon name="check" size={11} /> : state === 'mixed' ? <span className={s.dash} /> : null}
    </span>
  )
}

/** H's face: mark and tick, name, how much, a fact. */
function Face({ picks, who, line }: { picks: Picks; who: Source; line?: ReactNode }) {
  const { state, picked, of } = tileState(picks, who)
  return (
    <>
      <span className={s.top}>
        <Mark of={who} size={22} />
        <Box state={state} />
      </span>
      <span className={s.name}>{nameOf(who)}</span>
      <span className={s.count}>
        {line ?? (
          <>
            {sizeOf(picks, who)}
            {state === 'mixed' && <span className={s.some}> · {shortcut.someOf(picked, of)}</span>}
          </>
        )}
      </span>
      <span className={s.fact}>
        <Fact picks={picks} who={who} />
      </span>
    </>
  )
}

/** How many columns a grid has now. */
const useColumns = (ref: RefObject<HTMLElement | null>) => {
  const [columns, setColumns] = useState(4)
  useLayoutEffect(() => {
    const el = ref.current
    if (el === null) return
    const read = () => setColumns(Math.max(1, getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length))
    read()
    const watch = new ResizeObserver(read)
    watch.observe(el)
    return () => watch.disconnect()
  }, [ref])
  return columns
}

/** K: H's tiles; a tile's chevron opens what's in it in a panel under its row, to pick inside. */
export function OpeningTiles({ picks }: { picks: Picks }) {
  const [open, setOpen] = useState<Source | null>(null)
  const grid = useRef<HTMLDivElement>(null)
  const columns = useColumns(grid)
  const sources = offered(picks)
  const at = open === null ? -1 : sources.indexOf(open)
  // The panel goes after the last tile of the opened one's row.
  const rowEnd = at < 0 ? -1 : Math.min(sources.length, Math.ceil((at + 1) / columns) * columns) - 1
  return (
    <div className={s.wrap}>
      <SectionHead title={text.found} count={sources.length}>
        <AllNone onAll={() => takeAll(picks, sources, true)} onNone={() => takeAll(picks, sources, false)} />
      </SectionHead>
      <div className={s.grid} ref={grid}>
        {sources.map((who, i) => {
          const { state } = tileState(picks, who)
          const isOpen = open === who
          return (
            <Fragment key={who}>
              <div className={s.tile} data-state={state} data-open={isOpen || undefined}>
                <button type="button" className={s.take} aria-pressed={state === 'on'} onClick={() => picks.source(who, state !== 'on')}>
                  <Face picks={picks} who={who} />
                </button>
                <button
                  type="button"
                  className={s.open}
                  aria-expanded={isOpen}
                  aria-label={text.inside(nameOf(who))}
                  title={text.lookInside}
                  onClick={() => setOpen(isOpen ? null : who)}
                >
                  <Icon name="chevronD" size={13} />
                </button>
              </div>
              {i === rowEnd && open !== null && (
                <div className={s.inside}>
                  <ByKind picks={narrowed(picks, picks.setsOf([open]))} setup={false} />
                </div>
              )}
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}

interface Thing {
  readonly key: string
  readonly title: string
  readonly at: string
  readonly fact?: ReactNode
  readonly on: boolean
  readonly set: (on: boolean) => void
  /** How many it stands for: the older conversations are one line. */
  readonly weight: number
}

/** What a tile has inside, newest first: an agent's conversations, then its older ones as a line; a tool's worktrees. */
const thingsIn = (picks: Picks, who: Source): readonly Thing[] => {
  const t = picks.things(who)
  if (!isAgent(who))
    return [...t.worktrees]
      .sort((a, b) => b.touched.localeCompare(a.touched))
      .map((one) => ({
        key: one.id,
        title: one.title,
        at: when(one.touched),
        fact: <WorktreeFacts one={one} first />,
        on: picks.worktrees.has(one.id),
        set: (on: boolean) => picks.worktree(one.id, on),
        weight: 1,
      }))
  const listed = [...t.conversations]
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((one) => ({
      key: one.id,
      title: one.title,
      at: when(one.at),
      on: picks.conversations.has(one.id),
      set: (on: boolean) => picks.conversation(one.id, on),
      weight: 1,
    }))
  return t.older > 0
    ? [
        ...listed,
        {
          key: 'older',
          title: text.older(t.older),
          at: '',
          on: picks.olderOf(who),
          set: (on: boolean) => picks.setOlderOf(who, on),
          weight: t.older,
        },
      ]
    : listed
}

const PEEK = 3

function PeekTile({ picks, who }: { picks: Picks; who: Source }) {
  const [full, setFull] = useState(false)
  const { state, picked, of } = tileState(picks, who)
  const things = thingsIn(picks, who)
  const shown = full ? things : things.slice(0, PEEK)
  const hidden = things.slice(shown.length).reduce((n, one) => n + one.weight, 0)
  return (
    <div className={s.peek} data-state={state}>
      <button type="button" className={s.peekHead} aria-pressed={state === 'on'} onClick={() => picks.source(who, state !== 'on')}>
        <Mark of={who} size={20} />
        <span className={s.peekTitle}>
          <span className={s.name}>{nameOf(who)}</span>
          <span className={s.count}>
            {sizeOf(picks, who)}
            {state === 'mixed' && <span className={s.some}> · {shortcut.someOf(picked, of)}</span>}
          </span>
        </span>
        <Box state={state} />
      </button>
      <ul className={s.peekList}>
        {shown.map((one) => (
          <li key={one.key}>
            <label className={s.peekItem} data-off={!one.on || undefined}>
              <Tick on={one.on} onChange={one.set} label={one.title} />
              <span className={s.peekMain}>
                <span className={s.peekLine}>
                  <span className={s.peekName} title={one.title}>
                    {one.title}
                  </span>
                  <span className={s.peekAt}>{one.at}</span>
                </span>
                {one.fact !== undefined && <span className={s.peekFact}>{one.fact}</span>}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {(hidden > 0 || full) && things.length > PEEK && (
        <div className={s.peekFoot}>
          <LinkButton onClick={() => setFull((now) => !now)}>{full ? text.fewer : text.more(hidden)}</LinkButton>
        </div>
      )}
    </div>
  )
}

/** L: bigger tiles, each showing its latest few things, tickable on the tile; a tile's head takes all of it. */
export function PeekTiles({ picks }: { picks: Picks }) {
  const sources = offered(picks)
  return (
    <div className={s.wrap}>
      <SectionHead title={text.found} count={sources.length}>
        <AllNone onAll={() => takeAll(picks, sources, true)} onNone={() => takeAll(picks, sources, false)} />
      </SectionHead>
      <div className={s.peekGrid}>
        {sources.map((who) => (
          <PeekTile key={who} picks={picks} who={who} />
        ))}
      </div>
    </div>
  )
}

/** M's line on a tile: how much of it comes, in its own unit. */
function MeterLine({ picks, who }: { picks: Picks; who: Source }) {
  const { state, picked, of } = tileState(picks, who)
  const unit = isAgent(who) ? shortcut.conversations : shortcut.worktrees
  if (state === 'on' && of > 1) return <>{text.allOf(unit(of))}</>
  if (state === 'mixed') return <>{`${picked} of ${unit(of)}`}</>
  return <>{unit(of)}</>
}

/** M: what's under way at first, grouped by kind; a meter on each tile says how much of it comes. */
export function MeterTiles({ picks }: { picks: Picks }) {
  const [list, setList] = useState(false)
  const sources = offered(picks)
  const groups = [
    { title: shortcut.agents, sources: sources.filter(isAgent) },
    { title: shortcut.tools, sources: sources.filter((who) => !isAgent(who)) },
  ]
  return (
    <div className={s.wrap}>
      {groups.map((group) => (
        <section key={group.title} className={s.group}>
          <SectionHead title={group.title} count={group.sources.length}>
            <AllNone onAll={() => takeAll(picks, group.sources, true)} onNone={() => takeAll(picks, group.sources, false)} />
          </SectionHead>
          <div className={s.grid}>
            {group.sources.map((who) => {
              const { state, picked, of } = tileState(picks, who)
              return (
                <div key={who} className={s.tile} data-state={state}>
                  <button type="button" className={s.take} aria-pressed={state === 'on'} onClick={() => picks.source(who, state !== 'on')}>
                    <Face picks={picks} who={who} line={<MeterLine picks={picks} who={who} />} />
                    <span className={s.meter}>
                      <span className={s.meterFill} style={{ width: `${of === 0 ? 0 : (picked / of) * 100}%` }} />
                    </span>
                  </button>
                </div>
              )
            })}
          </div>
        </section>
      ))}
      <div className={s.foot}>
        {!picks.is('underway') && <LinkButton onClick={() => picks.pick('underway')}>{text.backToUnderway}</LinkButton>}
        <span className={s.grow} />
        <LinkButton onClick={() => setList((now) => !now)}>{list ? text.hideList : text.lookInside}</LinkButton>
      </div>
      {list && (
        <div className={s.listUnder}>
          <ByKind picks={picks} />
        </div>
      )}
    </div>
  )
}
