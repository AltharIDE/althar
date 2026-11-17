import { type ReactNode, useState } from 'react'

import { Icon, LinkButton, Menu, MenuCheckboxItem, MenuRadioGroup, MenuRadioItem, MenuSeparator, Segmented } from '@althar/ui'

import { AllNone, ByKind, type Criteria, Mark, type Picks, type Preset, SectionHead, type Sets, WorktreeFacts } from './Found'
import { capital, chipSources, countOf, said, SourceChip, text as shortcut } from './Shortcuts'
import { type Agent, isAgent, nameOf, type Source, SOURCES, when } from './world'
import s from './variants.module.css'

/*
 * More of the shortcut idea, arriving (G–J). G: a few ranked actions, each
 * bringing in and opening the project in one press. H: a tile a tool, pressed
 * to take all of it. I: one sentence whose words are menus. J: filters over
 * the list, where what's shown is what comes in.
 */

export const text = {
  pickOneByOne: 'Pick one by one',
  hideList: 'Hide the list',
  lookInside: 'Look inside',
  found: 'Found',
  asChats: ', as chats on Scratch',
  latest: (at: string) => `Latest ${at.toLowerCase()}`,
  what: {
    everything: 'everything',
    unfinished: 'what isn’t finished',
    conversations: 'only conversations',
    worktrees: 'only worktrees',
  } satisfies Record<Criteria['what'], string>,
  since: { any: 'however old', month: 'from the last month', week: 'from the last week' } satisfies Record<Criteria['since'], string>,
  everyTool: 'every tool',
  some: (n: number) => `${n} tools`,
  byHand: 'Changed by hand.',
  or: 'Or',
  bringIn: 'Bring in',
  from: 'from',
  tools: 'Tools',
  age: 'Age',
  ages: { any: 'Any age', month: 'Last month', week: 'Last week' } satisfies Record<Criteria['since'], string>,
  all: 'All',
}

/** Where a direction starts: H, K and L with nothing picked, J with all of it but finished work, the rest with what's under way. */
export const startOf = (d: string, picks: Picks): Sets =>
  d === 'h' || d === 'k' || d === 'l'
    ? picks.setsOf('none')
    : d === 'j'
      ? picks.select({ what: 'unfinished', from: 'all', since: 'any' })
      : picks.setsOf('underway')

/**
 * A tile's state: an agent's by its conversations, a tool's by its worktrees. The conversations that ran in a tool's
 * worktrees come with them, but count on their agent's tile, so taking Claude Code doesn't half-take Conductor.
 */
export const tileState = (
  picks: Picks,
  who: Source,
): { readonly state: 'on' | 'mixed' | 'off'; readonly picked: number; readonly of: number } => {
  if (isAgent(who)) return picks.stateOf(who)
  const worktrees = picks.things(who).worktrees
  const picked = worktrees.filter((one) => picks.worktrees.has(one.id)).length
  return { state: picked === 0 ? 'off' : picked === worktrees.length ? 'on' : 'mixed', picked, of: worktrees.length }
}

/** The sources with the most here, first. */
const ranked = (picks: Picks) => [...chipSources(picks)].sort((a, b) => picks.stateOf(b).of - picks.stateOf(a).of)

/** G: a few ranked actions, each bringing in and opening the project in one press; the list a press away. */
export function OnePress({
  picks,
  list,
  onList,
  onGo,
}: {
  picks: Picks
  list: boolean
  onList: (on: boolean) => void
  onGo: (sets: Sets) => void
}) {
  const top = ranked(picks).slice(0, 3)
  const actions: ReadonlyArray<{
    readonly key: string
    readonly title: string
    readonly note: string
    readonly marks: readonly Source[]
    readonly which: Preset | readonly Source[]
  }> = [
    {
      key: 'underway',
      title: shortcut.underway,
      note: shortcut.underwayNote(said(picks.countOf('underway'))),
      marks: [],
      which: 'underway',
    },
    { key: 'all', title: shortcut.all, note: `${capital(said(picks.countOf('all')))}.`, marks: top.slice(0, 2), which: 'all' },
    ...top.map((who) => ({
      key: who,
      title: `${shortcut.everythingFrom} ${nameOf(who)}`,
      note: `${capital(said(picks.countOf([who])))}${isAgent(who) ? text.asChats : ''}.`,
      marks: [who],
      which: [who],
    })),
  ]
  return (
    <div className={s.onePress}>
      <ul className={s.actions}>
        {actions.map((one) => (
          <li key={one.key}>
            <button type="button" className={s.action} onClick={() => onGo(picks.setsOf(one.which))}>
              <span className={s.actionMarks} data-many={one.marks.length > 1 || undefined}>
                {one.marks.length === 0 ? (
                  <Icon name="branch" size={16} />
                ) : (
                  one.marks.map((who) => <Mark key={who} of={who} size={one.marks.length > 1 ? 13 : 18} />)
                )}
              </span>
              <span className={s.actionMain}>
                <span className={s.actionTitle}>{one.title}</span>
                <span className={s.actionNote}>{one.note}</span>
              </span>
              <Icon name="arrow" size={14} className={s.actionGo} />
            </button>
          </li>
        ))}
      </ul>
      <div className={s.foot}>
        <LinkButton onClick={() => onList(!list)}>{list ? text.hideList : text.pickOneByOne}</LinkButton>
      </div>
      {list && (
        <div className={s.listUnder}>
          <ByKind picks={picks} />
        </div>
      )}
    </div>
  )
}

/** H: a tile a tool, pressed to take all of it; the list a press away. */
export function Tiles({ picks }: { picks: Picks }) {
  const [list, setList] = useState(false)
  const sources = SOURCES.filter((who) => picks.stateOf(who).of > 0)
  const all = (on: boolean) => {
    for (const who of sources) picks.source(who, on)
  }
  return (
    <div className={s.tilesWrap}>
      <SectionHead title={text.found} count={sources.length}>
        <AllNone onAll={() => all(true)} onNone={() => all(false)} />
      </SectionHead>
      <div className={s.tiles}>
        {sources.map((who) => {
          const { state, picked, of } = tileState(picks, who)
          const t = picks.things(who)
          const latest = [...t.worktrees.map((one) => one.touched), ...t.conversations.map((one) => one.at)].sort().at(-1)
          const newest = [...t.worktrees].sort((a, b) => b.touched.localeCompare(a.touched))[0]
          return (
            <button
              key={who}
              type="button"
              className={s.tile}
              aria-pressed={state === 'on'}
              data-mixed={state === 'mixed' || undefined}
              onClick={() => picks.source(who, state !== 'on')}
            >
              <span className={s.tileTop}>
                <Mark of={who} size={22} />
                <span className={s.tileBox}>
                  {state === 'on' ? <Icon name="check" size={11} /> : state === 'mixed' ? <span className={s.tileDash} /> : null}
                </span>
              </span>
              <span className={s.tileName}>{nameOf(who)}</span>
              <span className={s.tileCount}>
                {isAgent(who) ? shortcut.conversations(of) : shortcut.worktrees(of)}
                {state === 'mixed' && <span className={s.tileSome}> · {shortcut.someOf(picked, of)}</span>}
              </span>
              <span className={s.tileFact}>
                {isAgent(who) || newest === undefined ? (
                  latest === undefined ? null : (
                    text.latest(when(latest))
                  )
                ) : (
                  <WorktreeFacts one={newest} first />
                )}
              </span>
            </button>
          )
        })}
      </div>
      <div className={s.foot}>
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

/** A word of the sentence that's a menu. */
function Word({ label, said: shown, children }: { label: string; said: string; children: ReactNode }) {
  return (
    <Menu
      label={label}
      trigger={
        <button type="button" className={s.word}>
          {shown}
          <Icon name="chevronD" size={12} className={s.wordCaret} />
        </button>
      }
      width={240}
    >
      {children}
    </Menu>
  )
}

/** I: one sentence whose words are menus; what it brings, counted, under it; the list a press away. */
export function Sentence({ picks }: { picks: Picks }) {
  const [c, setC] = useState<Criteria>({ what: 'unfinished', from: 'all', since: 'month' })
  const [list, setList] = useState(false)
  const set = (change: Partial<Criteria>) => {
    const next = { ...c, ...change }
    setC(next)
    picks.pickSets(picks.select(next))
  }
  const sources = chipSources(picks)
  const fromSaid =
    c.from === 'all'
      ? text.everyTool
      : c.from.length === 1
        ? nameOf(c.from[0] as Source)
        : c.from.length === 2
          ? `${nameOf(c.from[0] as Source)} and ${nameOf(c.from[1] as Source)}`
          : text.some(c.from.length)
  const toggle = (who: Source, on: boolean) => {
    const now = c.from === 'all' ? [] : c.from
    const next = on ? SOURCES.filter((one) => one === who || now.includes(one)) : now.filter((one) => one !== who)
    set({ from: next.length === 0 ? 'all' : next })
  }
  const byHand = !picks.isSets(picks.select(c))
  const top = ranked(picks)[0]
  const tries: ReadonlyArray<{ readonly label: string; readonly to: Criteria }> = [
    ...(top === undefined
      ? []
      : [{ label: `everything from ${nameOf(top)}`, to: { what: 'everything', from: [top], since: 'any' } as const }]),
    { label: 'everything', to: { what: 'everything', from: 'all', since: 'any' } },
    { label: 'what isn’t finished', to: { what: 'unfinished', from: 'all', since: 'month' } },
  ]
  const same = (a: Criteria, b: Criteria) => JSON.stringify(a) === JSON.stringify(b)
  return (
    <div className={s.sentenceWrap}>
      <p className={s.sentence}>
        {text.bringIn}{' '}
        <Word label="What" said={text.what[c.what]}>
          <MenuRadioGroup label="What" value={c.what} onChange={(what) => set({ what: what as Criteria['what'] })}>
            {(Object.keys(text.what) as Criteria['what'][]).map((one) => (
              <MenuRadioItem key={one} value={one}>
                {capital(text.what[one])}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </Word>{' '}
        {text.from}{' '}
        <Word label="From" said={fromSaid}>
          <MenuCheckboxItem checked={c.from === 'all'} onCheckedChange={() => set({ from: 'all' })}>
            {capital(text.everyTool)}
          </MenuCheckboxItem>
          <MenuSeparator />
          {sources.map((who) => (
            <MenuCheckboxItem
              key={who}
              keepOpen
              checked={c.from !== 'all' && c.from.includes(who)}
              onCheckedChange={(on) => toggle(who, on)}
              hint={countOf(picks, who)}
            >
              {nameOf(who)}
            </MenuCheckboxItem>
          ))}
        </Word>
        ,{' '}
        <Word label="How old" said={text.since[c.since]}>
          <MenuRadioGroup label="How old" value={c.since} onChange={(since) => set({ since: since as Criteria['since'] })}>
            {(Object.keys(text.since) as Criteria['since'][]).map((one) => (
              <MenuRadioItem key={one} value={one}>
                {capital(text.since[one])}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </Word>
        .
      </p>
      <p className={s.result}>
        {capital(said({ ...picks.count(), setup: picks.setup })) || shortcut.none}.{byHand && ` ${text.byHand}`}
      </p>
      <div className={s.tries}>
        <span className={s.triesLabel}>{text.or}</span>
        {tries
          .filter((one) => !same(one.to, c))
          .map((one) => (
            <LinkButton key={one.label} onClick={() => set(one.to)}>
              {one.label}
            </LinkButton>
          ))}
        <span className={s.grow} />
        <LinkButton onClick={() => setList((now) => !now)}>{list ? text.hideList : text.pickOneByOne}</LinkButton>
      </div>
      {list && (
        <div className={s.listUnder}>
          <ByKind picks={picks} />
        </div>
      )}
    </div>
  )
}

/** The picks as A's list shows them, narrowed to what's shown; All and None act on what's shown only. */
export const narrowed = (picks: Picks, shown: Sets): Picks => {
  const worktrees = picks.offeredWorktrees.filter((one) => shown.worktrees.has(one.id))
  const conversations = picks.offeredConversations.filter((one) => shown.conversations.has(one.id))
  const agents = [...shown.older]
  const olderPicked = agents.filter((who) => picks.olderOf(who))
  const setOlder = (on: boolean) => {
    for (const who of agents) picks.setOlderOf(who, on)
  }
  const olderBy = {
    'claude-code': shown.older.has('claude-code') ? picks.olderBy['claude-code'] : 0,
    codex: shown.older.has('codex') ? picks.olderBy.codex : 0,
  } as Record<Agent, number>
  return {
    ...picks,
    offeredWorktrees: worktrees,
    offeredConversations: conversations,
    olderBy,
    olderCount: olderBy['claude-code'] + olderBy.codex,
    older: agents.length > 0 && olderPicked.length === agents.length,
    olderMixed: olderPicked.length > 0 && olderPicked.length < agents.length,
    setOlder,
    allWorktrees: (on) =>
      picks.worktreesOn(
        worktrees.map((one) => one.id),
        on,
      ),
    allConversations: (on) => {
      picks.conversationsOn(
        conversations.map((one) => one.id),
        on,
      )
      setOlder(on)
    },
  }
}

/** J: filters over the list; what's shown is what comes in, finished work shown but not ticked. */
export function Filtered({ picks }: { picks: Picks }) {
  const [from, setFrom] = useState<readonly Source[]>([])
  const [since, setSince] = useState<Criteria['since']>('any')
  const filter = (next: { from?: readonly Source[]; since?: Criteria['since'] }) => {
    const f = next.from ?? from
    const a = next.since ?? since
    setFrom(f)
    setSince(a)
    picks.pickSets(picks.select({ what: 'unfinished', from: f.length === 0 ? 'all' : f, since: a }))
  }
  const shown = picks.select({ what: 'everything', from: from.length === 0 ? 'all' : from, since })
  const view = narrowed(picks, shown)
  return (
    <div className={s.filteredWrap}>
      <div className={s.filters}>
        <div className={s.filterLine}>
          <span className={s.filterLabel}>{text.tools}</span>
          <div className={s.chips}>
            <button type="button" className={s.chip} aria-pressed={from.length === 0} onClick={() => filter({ from: [] })}>
              {text.all}
            </button>
            {chipSources(picks).map((who) => (
              <SourceChip
                key={who}
                who={who}
                on={from.includes(who)}
                count={countOf(picks, who)}
                onPress={() =>
                  filter({
                    from: from.includes(who)
                      ? from.filter((one) => one !== who)
                      : SOURCES.filter((one) => one === who || from.includes(one)),
                  })
                }
              />
            ))}
          </div>
        </div>
        <div className={s.filterLine}>
          <span className={s.filterLabel}>{text.age}</span>
          <Segmented
            label={text.age}
            value={since}
            onChange={(next) => filter({ since: next })}
            options={(Object.keys(text.ages) as Criteria['since'][]).map((one) => ({ value: one, label: text.ages[one] }))}
          />
        </div>
      </div>
      <ByKind picks={view} setup={view.offeredWorktrees.length > 0} />
    </div>
  )
}
