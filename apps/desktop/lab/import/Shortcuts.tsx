import { useState } from 'react'

import { Caret, Choices, Disclosure, DisclosureTrigger, Fold, Icon, LinkButton } from '@althar/ui'

import { AllNone, ByKind, ConversationRow, Mark, type Picks, type Preset, SectionHead, Tick, WorktreeRow, text as found } from './Found'
import { type Agent, isAgent, nameOf, OLDER, recent, SETUPS, type Source, SOURCES, TOOLS, when } from './world'
import f from './found.module.css'
import s from './shortcuts.module.css'

/*
 * Arriving, with shortcuts: for someone who only wants all of Claude Code's
 * conversations, say, or all of it, in one press. D asks one question, with a
 * few answers and the whole list a press away; E lists the tools, each ticked
 * whole, opened to pick inside; F keeps A's list under a row of shortcuts.
 */

export const text = {
  question: 'What to bring in',
  underway: 'What’s under way',
  underwayNote: (n: string) => `Work not finished and the last month’s conversations: ${n}.`,
  all: 'Everything',
  none: 'Nothing for now',
  from: 'Everything from…',
  fromNote: 'Only the tools you pick, all of what they left.',
  pickTools: 'Pick a tool.',
  oneByOne: 'Pick one by one',
  hideList: 'Hide the list',
  always: 'The same for projects I add later',
  bringIn: 'Bring in',
  everythingFrom: 'Everything from',
  onlyFrom: 'Only from',
  agents: 'Agents’ conversations',
  tools: 'Other tools’ worktrees',
  someOf: (picked: number, of: number) => `${picked} of ${of}`,
  conversations: (n: number) => (n === 1 ? '1 conversation' : `${n} conversations`),
  worktrees: (n: number) => (n === 1 ? '1 worktree' : `${n} worktrees`),
  setupOf: (who: string) => `${who}’s setup`,
  lately: (recentOnes: number, older: number) => `${recentOnes} from the last month, ${older} older`,
  withThem: (worktrees: number, n: number) =>
    worktrees === 1 ? (n === 1 ? 'with its conversation' : `with its ${n} conversations`) : `with their ${n} conversations`,
  setupIn: (file: string) => `setup in ${file}`,
  older: (n: number) =>
    `${n} older, from before ${new Date(Date.now() - 30 * 86_400_000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`,
  asChats: 'As chats on Scratch, unless the worktree they ran in comes too.',
}

/** What a shortcut brings in, as a line: "5 worktrees, 11 conversations and Conductor’s setup". */
const said = (count: { worktrees: number; conversations: number; setup: string | null }) => {
  const setup = SETUPS.find((one) => one.id === count.setup)
  const parts = [
    count.worktrees > 0 ? text.worktrees(count.worktrees) : null,
    count.conversations > 0 ? text.conversations(count.conversations) : null,
    setup === undefined ? null : text.setupOf(TOOLS[setup.tool].name),
  ].filter((one) => one !== null)
  if (parts.length === 0) return ''
  const last = parts.pop()
  return parts.length === 0 ? `${last}` : `${parts.join(', ')} and ${last}`
}
const capital = (line: string) => `${line[0]?.toUpperCase() ?? ''}${line.slice(1)}`

/** The sources a shortcut names: the agents and the tools, not worktrees made by hand. */
const chipSources = (picks: Picks) => SOURCES.filter((who) => who !== 'git' && picks.stateOf(who).of > 0)

/** What a source's chip counts: an agent's conversations, a tool's worktrees. */
const countOf = (picks: Picks, who: Source) => (isAgent(who) ? picks.stateOf(who).of : picks.things(who).worktrees.length)

/** A source as a chip, pressed where it's all in. */
function SourceChip({ who, on, count, onPress }: { who: Source; on: boolean; count: number; onPress: () => void }) {
  return (
    <button type="button" className={s.chip} aria-pressed={on} onClick={onPress}>
      <Mark of={who} size={14} />
      {nameOf(who)}
      <span className={s.chipCount}>{count}</span>
      {on && <Icon name="check" size={12} className={s.chipTick} />}
    </button>
  )
}

/** D: one question, a few answers; the whole list a press away. */
export function Choose({ picks }: { picks: Picks }) {
  const [choice, setChoice] = useState<Exclude<Preset, 'none'> | 'from' | 'none'>('underway')
  const [from, setFrom] = useState<readonly Source[]>(['claude-code'])
  const [list, setList] = useState(false)
  const [always, setAlways] = useState(false)
  const value =
    choice === 'from' ? (from.length > 0 && picks.is(from) ? 'from' : null) : choice !== 'none' && picks.is(choice) ? choice : null
  const choose = (next: Preset | 'from') => {
    setChoice(next)
    picks.pick(next === 'from' ? from : next)
  }
  const fromOne = (who: Source) => {
    const next = from.includes(who) ? from.filter((one) => one !== who) : SOURCES.filter((one) => one === who || from.includes(one))
    setFrom(next)
    setChoice('from')
    picks.pick(next)
  }
  const fromCount = picks.countOf(from)
  const onlyAgents = from.length > 0 && from.every(isAgent)
  return (
    <div className={s.choose}>
      <Choices
        label={text.question}
        value={value}
        onChange={choose}
        options={[
          { value: 'underway', title: text.underway, note: text.underwayNote(said(picks.countOf('underway'))) },
          { value: 'all', title: text.all, note: `${capital(said(picks.countOf('all')))}.` },
          {
            value: 'from',
            title: text.from,
            note: choice !== 'from' ? text.fromNote : from.length === 0 ? text.pickTools : `${capital(said(fromCount))}.`,
          },
        ]}
      />
      {choice === 'from' && (
        <div className={s.fromChips}>
          <div className={s.chips}>
            {chipSources(picks).map((who) => (
              <SourceChip key={who} who={who} on={from.includes(who)} count={countOf(picks, who)} onPress={() => fromOne(who)} />
            ))}
          </div>
          {onlyAgents && <p className={s.fromNote}>{text.asChats}</p>}
        </div>
      )}
      <div className={s.chooseFoot}>
        {(value !== null || (choice === 'none' && picks.is('none'))) && (
          <label className={s.always}>
            <Tick on={always} onChange={setAlways} label={text.always} />
            {text.always}
          </label>
        )}
        <span className={s.grow} />
        <LinkButton onClick={() => choose('none')}>{text.none}</LinkButton>
        <LinkButton onClick={() => setList((now) => !now)}>{list ? text.hideList : text.oneByOne}</LinkButton>
      </div>
      {list && (
        <div className={s.listUnder}>
          <ByKind picks={picks} />
        </div>
      )}
    </div>
  )
}

/** E: by tool. Each tool a row, ticked whole; opened, what it has, to pick inside. */
export function ByTool({ picks }: { picks: Picks }) {
  const [open, setOpen] = useState<ReadonlySet<Source>>(() => new Set())
  const sources = SOURCES.filter((who) => picks.stateOf(who).of > 0)
  const row = (who: Source) => (
    <SourceRow
      key={who}
      who={who}
      picks={picks}
      open={open.has(who)}
      onOpen={(on) =>
        setOpen((now) => {
          const next = new Set(now)
          if (on) next.add(who)
          else next.delete(who)
          return next
        })
      }
    />
  )
  const all = (list: readonly Source[], on: boolean) => {
    for (const who of list) picks.source(who, on)
  }
  const agents = sources.filter(isAgent)
  const tools = sources.filter((who) => !isAgent(who))
  return (
    <div className={f.picker}>
      <section>
        <SectionHead title={text.agents} count={agents.length}>
          <AllNone onAll={() => all(agents, true)} onNone={() => all(agents, false)} />
        </SectionHead>
        <ul className={f.list}>{agents.map(row)}</ul>
      </section>
      <section>
        <SectionHead title={text.tools} count={tools.length}>
          <AllNone onAll={() => all(tools, true)} onNone={() => all(tools, false)} />
        </SectionHead>
        <ul className={f.list}>{tools.map(row)}</ul>
      </section>
    </div>
  )
}

function SourceRow({ who, picks, open, onOpen }: { who: Source; picks: Picks; open: boolean; onOpen: (on: boolean) => void }) {
  const { state, picked, of } = picks.stateOf(who)
  const t = picks.things(who)
  const latest = [...t.worktrees.map((one) => one.touched), ...t.conversations.map((one) => one.at)].sort().at(-1)
  const sub = isAgent(who)
    ? text.lately(t.conversations.filter(recent).length, t.conversations.filter((one) => !recent(one)).length + t.older)
    : capital(
        [
          t.conversations.length > 0 ? text.withThem(t.worktrees.length, t.conversations.length) : null,
          t.setup === undefined ? null : text.setupIn(t.setup.file),
        ]
          .filter((one) => one !== null)
          .join(' · '),
      )
  return (
    <li className={f.row} data-off={state === 'off' || undefined}>
      <Disclosure open={open} onOpenChange={onOpen}>
        <div className={s.sourceHead}>
          <span className={s.sourceTick}>
            <Tick
              on={state === 'on'}
              mixed={state === 'mixed'}
              onChange={(on) => picks.source(who, on)}
              label={`${text.everythingFrom} ${nameOf(who)}`}
            />
          </span>
          <DisclosureTrigger>
            <button type="button" className={s.sourceHit}>
              <Mark of={who} />
              <span className={f.main}>
                <span className={f.titleLine}>
                  <span className={f.name}>
                    {nameOf(who)}
                    <span className={s.sourceCount}>{isAgent(who) ? text.conversations(of) : text.worktrees(t.worktrees.length)}</span>
                  </span>
                  <span className={f.at}>{state === 'mixed' ? text.someOf(picked, of) : latest === undefined ? '' : when(latest)}</span>
                </span>
                {sub !== '' && <span className={f.sub}>{sub}</span>}
              </span>
              <Caret open={open} />
            </button>
          </DisclosureTrigger>
        </div>
        <Fold>
          <ul className={s.inside}>
            {t.worktrees.map((one) => (
              <WorktreeRow key={one.id} one={one} on={picks.worktrees.has(one.id)} onChange={(on) => picks.worktree(one.id, on)} />
            ))}
            {isAgent(who) &&
              t.conversations.map((one) => (
                <ConversationRow
                  key={one.id}
                  one={one}
                  on={picks.conversations.has(one.id)}
                  onChange={(on) => picks.conversation(one.id, on)}
                />
              ))}
            {isAgent(who) && t.older > 0 && <OlderRow who={who} picks={picks} />}
          </ul>
        </Fold>
      </Disclosure>
    </li>
  )
}

function OlderRow({ who, picks }: { who: Agent; picks: Picks }) {
  const on = picks.olderOf(who)
  return (
    <li className={f.row} data-off={!on || undefined}>
      <label className={f.rowHit}>
        <Tick on={on} onChange={(next) => picks.setOlderOf(who, next)} label={text.older(OLDER[who])} />
        <Mark of={who} />
        <span className={f.main}>
          <span className={f.name}>{text.older(OLDER[who])}</span>
        </span>
      </label>
    </li>
  )
}

/** F: A's list, under a row of shortcuts that set it at once. */
export function WithShortcuts({ picks }: { picks: Picks }) {
  const [from, setFrom] = useState<readonly Source[]>([])
  // A tool's chip picks only it; pressed again while only tools are picked, it adds or takes it away.
  const fromNow = from.length > 0 && picks.is(from) ? from : []
  const press = (who: Source) => {
    const next =
      fromNow.length === 0
        ? [who]
        : fromNow.includes(who)
          ? fromNow.filter((one) => one !== who)
          : SOURCES.filter((one) => one === who || fromNow.includes(one))
    setFrom(next)
    picks.pick(next.length === 0 ? 'none' : next)
  }
  const presets: ReadonlyArray<{ readonly key: Preset; readonly label: string }> = [
    { key: 'all', label: text.all },
    { key: 'underway', label: text.underway },
    { key: 'none', label: found.none },
  ]
  return (
    <div className={f.picker}>
      <div className={s.shortcuts}>
        <div className={s.line}>
          <span className={s.lineLabel}>{text.bringIn}</span>
          <div className={s.chips}>
            {presets.map((one) => (
              <button key={one.key} type="button" className={s.chip} aria-pressed={picks.is(one.key)} onClick={() => picks.pick(one.key)}>
                {one.label}
                {picks.is(one.key) && <Icon name="check" size={12} className={s.chipTick} />}
              </button>
            ))}
          </div>
        </div>
        <div className={s.line}>
          <span className={s.lineLabel}>{text.onlyFrom}</span>
          <div className={s.chips}>
            {chipSources(picks).map((who) => (
              <SourceChip key={who} who={who} on={fromNow.includes(who)} count={countOf(picks, who)} onPress={() => press(who)} />
            ))}
          </div>
        </div>
      </div>
      <ByKind picks={picks} />
    </div>
  )
}
