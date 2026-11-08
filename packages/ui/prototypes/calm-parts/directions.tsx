// Scrappy: the three directions, each a different way of keeping phase 5's model out of sight. Each says how a case reads on the
// board's card, in the task's bar, over its composer, and in its thread.
import type { ReactNode } from 'react'

import { Icon } from '../../src/foundations/Icon/Icon'
import { TaskStatus, Verdict } from '../../src/foundations/vocabulary'
import { Menu, MenuItem } from '../../src/primitives/Menu/Menu'
import { NextStep } from '../../src/primitives/NextStep/NextStep'
import { LinkButton } from '../../src/primitives/LinkButton/LinkButton'
import { TaskParts, type TaskPartModel } from '../../src/chrome/TaskParts/TaskParts'
import { Fact, FactLine } from '../../src/board/BoardCard/Chips'
import { AltharLine } from '../../src/thread/AltharLine/AltharLine'
import { ReviewLine } from '../../src/thread/ReviewLine/ReviewLine'
import { AskView } from './asks'
import { type Beat, type Case, changeIn, type Preset, type Timing } from './cases'
import { type Need, commits, nameOf, open, partsOfTime, said } from './need'
import { ChangesStrip, ChangeTrack, changePart, chipOf, css, kindsOf, LiveLine, Named, Outbox, press, taskWide, TimeParts } from './parts'
import type { Direction } from './state'

export interface CardOver {
  readonly status?: TaskStatus
  readonly word?: string
  readonly why?: string
  readonly object?: ReactNode
  readonly foot?: ReactNode
  readonly next?: ReactNode
}

export interface HeaderOver {
  readonly status: TaskStatus
  readonly state: ReactNode
  readonly beside?: ReactNode
  readonly parts: ReactNode
  /** Under the bar, its width. */
  readonly under?: ReactNode
}

export interface View {
  readonly name: string
  readonly what: string
  readonly card: (c: Case, need: Need) => CardOver
  readonly header: (c: Case, need: Need, opening: string | null) => HeaderOver
  readonly above: (c: Case, opening: string | null) => ReactNode
  /** A lead's part change mid-turn: folded into its work (an aside), or a line of its own. */
  readonly folds: (beat: Extract<Beat, { kind: 'part' }>) => boolean
  readonly beat: (c: Case, beat: Exclude<Beat, { kind: 'you' | 'lead' }>) => ReactNode
  /** A turn's line: its words after “Worked for”, and the first thing it opens to. */
  readonly took: (c: Case, took: string, t: Timing, beat: Extract<Beat, { kind: 'lead' }>) => string
  /** Where Scratch opens from on the board. */
  readonly scratch: 'shelf' | 'corner' | 'talk'
}

const SOL = { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', short: 'Sol', runtime: 'codex', efforts: [] }

const statusOf = (c: Case, need: Need): TaskStatus =>
  need.tone === 'you' || need.tone === 'bad'
    ? TaskStatus.Yours
    : c.status === 'queued'
      ? TaskStatus.Queued
      : c.status === 'paused'
        ? TaskStatus.Paused
        : c.status === 'done'
          ? TaskStatus.Done
          : c.status === 'running' || need.tone === 'live'
            ? TaskStatus.Running
            : TaskStatus.Done

const more = (need: Need) => (need.more > 0 ? ` · ${need.more} more` : '')
const named = (c: Case, need: Need) => need.change ?? c.changes.find(open) ?? c.changes[0]

const nextOf = (need: Need) =>
  need.act === undefined ? undefined : (
    <NextStep signal={need.tone === 'you'} onPress={press(need.act)}>
      {need.act}
    </NextStep>
  )

/** Today's one fact for a change, at a card's foot: its checks. */
const checksFact = (c: Case, need: Need) => {
  const change = named(c, need)
  if (change === undefined || change.pr === undefined || change.state === 'merged') return null
  return change.checks === 'failed' ? (
    <Fact icon="close" tone="danger">
      {change.failing?.[0] ?? 'A check'} failed
    </Fact>
  ) : change.checks === 'running' ? (
    <Fact tone="live">Checks running</Fact>
  ) : change.checks === 'passed' ? (
    <Fact icon="check" tone="ok">
      Checks passed
    </Fact>
  ) : null
}

/** The line a part change, or Althar, writes: who and what, its way on after it. */
const line = (c: Case, beat: Extract<Beat, { kind: 'part' | 'line' }>, { name = false }: { name?: boolean } = {}) => (
  <AltharLine tone={beat.kind === 'line' && beat.tone === 'warning' ? 'warning' : 'info'}>
    {name && c.changes.length > 1 && <Named change={changeIn(c, beat.change)} />}
    {beat.text}
    {beat.act !== undefined && (
      <span className={css.lineAct}>
        <LinkButton onClick={press(beat.act, { who: 'you', text: actLine(beat.act, c, beat.change) })}>{beat.act}</LinkButton>
      </span>
    )}
  </AltharLine>
)

/** What pressing a line's way on writes in the thread. */
const actLine = (act: string, c: Case, id: string | undefined) => {
  const change = changeIn(c, id)
  switch (act) {
    case 'Keep them together':
      return 'You kept the rename with the fix. The lead carries its commits onto althar/board-still.'
    case 'Drop it':
      return `You dropped ${change?.branch ?? 'it'}. The branch stays.`
    case 'Trust fully':
      return 'You trusted #702 fully: its install scripts and the network.'
    case 'Call it off':
      return 'You called off the move. It stays in your checkout.'
    default:
      return `You chose ${act}.`
  }
}

const review = (c: Case, beat: Extract<Beat, { kind: 'review' }>, { name = false }: { name?: boolean } = {}) => {
  const change = changeIn(c, beat.change)
  return (
    <>
      <ReviewLine
        model={SOL}
        verdict={beat.findings === 0 ? Verdict.Pass : Verdict.Changes}
        findings={beat.findings}
        {...(beat.fixed === undefined ? {} : { settled: beat.fixed })}
        text={{
          review: `${name && change !== undefined && c.changes.length > 1 ? `${nameOf(change)} · ` : ''}${beat.after === true ? `Review after ${change === undefined ? 'the merge' : `${nameOf(change)} merged`}` : 'Review'}`,
        }}
      >
        {beat.checked !== undefined && <p className={css.note}>{beat.checked}</p>}
      </ReviewLine>
    </>
  )
}

/* ——— A · One sentence: the task's one next step, the same words on the card, in the bar and in Needs you ——— */

const presetMenu = (c: Case) => (
  <Menu
    label="Preset"
    align="end"
    trigger={
      <button type="button" className={css.scratchChip} aria-label={`Preset: ${c.preset}`}>
        {c.preset}
        <Icon name="chevronD" size={10} />
      </button>
    }
    note="Switching changes its parts to match. Nothing is lost."
  >
    {(['Chat', 'Change', 'Small change', 'Review a PR', 'Prototype'] as ReadonlyArray<Preset>).map((one) => (
      <MenuItem key={one} {...(one === c.preset ? { icon: 'check' as const } : {})} onSelect={press(one, { who: 'you', text: `You switched it to ${one}.` })}>
        {one}
      </MenuItem>
    ))}
    <MenuItem onSelect={press('save', { who: 'you', text: 'You saved its parts as a preset, “Board fix”.' })}>Save as preset…</MenuItem>
  </Menu>
)

const A: View = {
  name: 'One sentence',
  what: 'The task is its one next step: one sentence and one button, the same on the card, in the bar and in Needs you. The parts stay behind their marks.',
  card: (c, need) => ({
    status: statusOf(c, need),
    ...(need.tone === 'quiet' && need.says === c.word ? {} : { why: `${need.says}${more(need)}` }),
    object: chipOf(named(c, need)),
    foot: null,
    next: nextOf(need),
  }),
  header: (c, need) => {
    const parts: TaskPartModel[] = [...c.changes.map((one) => changePart(c, one)), ...taskWide(c)]
    return {
      status: statusOf(c, need),
      state: need.says === c.word ? c.word : <span className={css.chipWords} title={`${need.says}${more(need)}`}>{`${need.says}${more(need)}`}</span>,
      ...(need.act === undefined
        ? {}
        : {
            beside: (
              <button type="button" className={css.chipAct} data-tone={need.tone} onClick={press(need.act)}>
                {need.act}
              </button>
            ),
          }),
      parts: (
        <>
          {c.preset !== 'Change' && presetMenu(c)}
          <TaskParts parts={parts} kinds={kindsOf(c)} />
        </>
      ),
    }
  },
  above: () => null,
  folds: () => false,
  beat: (c, beat) => {
    switch (beat.kind) {
      case 'part':
      case 'line':
        return line(c, beat)
      case 'live':
        return line(c, { kind: 'line', text: beat.text, ...(beat.act === undefined ? {} : { act: beat.act }) })
      case 'review':
        return review(c, beat)
      case 'ask':
        return <AskView c={c} ask={beat.ask} />
    }
  },
  took: (_c, took) => took,
  scratch: 'corner',
}

/* ——— B · Change rows: the change is the one shape; a strip of them under the bar, a mark each on the card ——— */

/** A change has something of its own to say: more than today's one pull request does. */
const saysMore = (c: Case) =>
  c.changes.length > 1 ||
  c.changes.some(
    (one) => (one.waiting ?? 0) > 0 || one.heldBy !== undefined || one.helper !== undefined || one.toward !== undefined || one.place === 'local' || one.shipping !== undefined,
  ) ||
  c.moving !== undefined

const B: View = {
  name: 'Change rows',
  what: 'Everything hangs on the change, so the change is the one shape you learn: a strip of them under the bar, each opening to the same card; a mark each on the board card.',
  card: (c, need) => ({
    status: statusOf(c, need),
    ...(need.tone === 'you' || need.tone === 'bad' ? { why: need.says } : {}),
    object: chipOf(named(c, need)),
    foot: c.changes.length > 1 ? <ChangeTrack c={c} /> : checksFact(c, need),
    next: nextOf(need),
  }),
  header: (c, need, opening) => {
    const strip = saysMore(c) && c.changes.length > 0
    const parts: TaskPartModel[] = [
      ...(strip ? [] : c.changes.map((one) => changePart(c, one))),
      ...taskWide(c),
      ...(c.preset === 'Change'
        ? []
        : [
            {
              id: 'preset',
              icon: 'automation' as const,
              name: c.preset,
              detail: 'The preset it started from',
              actions: [
                { label: 'Use Change', onClick: press('Change', { who: 'you', text: 'You switched it to Change: Checked by moves to before it ships.' }) },
                { label: 'Save as preset…', variant: 'quiet' as const, onClick: press('save', { who: 'you', text: 'You saved its parts as a preset, “Board fix”.' }) },
              ],
            },
          ]),
    ]
    return {
      status: statusOf(c, need),
      state: c.word,
      parts: <TaskParts parts={parts} kinds={kindsOf(c)} />,
      ...(strip ? { under: <ChangesStrip c={c} opened={opening} /> } : {}),
    }
  },
  above: () => null,
  folds: () => false,
  beat: (c, beat) => {
    switch (beat.kind) {
      case 'part':
      case 'line':
        return line(c, beat, { name: true })
      case 'live':
        return line(c, { kind: 'line', text: beat.text, ...(beat.change === undefined ? {} : { change: beat.change }), ...(beat.act === undefined ? {} : { act: beat.act }) }, { name: true })
      case 'review':
        return review(c, beat, { name: true })
      case 'ask':
        return <AskView c={c} ask={beat.ask} />
    }
  },
  took: (c, took, _t, beat) => {
    const change = changeIn(c, beat.commits?.change)
    return beat.commits === undefined || change === undefined ? took : `${took} · ${commits(beat.commits.n)} to ${nameOf(change)}`
  },
  scratch: 'shelf',
}

/* ——— C · The outbox: the bar and the card stay as today; what waits to go up gathers over the composer; what happens, happens in the thread ——— */

const C: View = {
  name: 'Outbox',
  what: 'The bar and the card stay as they are today. What waits for your word to go up gathers in one place over the composer; moves and reviews under way are a live line at the thread’s end.',
  card: (c, need) => {
    const waiting = c.changes.filter((one) => open(one) && (one.waiting ?? 0) > 0)
    const n = waiting.reduce((sum, one) => sum + (one.waiting ?? 0), 0)
    const asks = need.tone === 'you' && n === 0 ? need.says : need.tone === 'bad' ? need.says : undefined
    return {
      status: statusOf(c, need),
      ...(asks === undefined ? {} : { why: asks }),
      object: chipOf(named(c, need)),
      foot: (
        <FactLine>
          {n > 0 ? <Fact icon="after">{`${commits(n)} not shipped`}</Fact> : checksFact(c, need)}
          {need.more > 0 && <Fact>{`${need.more} more`}</Fact>}
        </FactLine>
      ),
      next: n > 0 && need.act !== undefined && /^Ship/.test(need.act) ? (
        <NextStep signal onPress={press('Ship')}>
          Ship
        </NextStep>
      ) : (
        nextOf(need)
      ),
    }
  },
  header: (c, need) => ({
    status: statusOf(c, need),
    state: c.word,
    parts: <TaskParts parts={[...c.changes.map((one) => changePart(c, one)), ...taskWide(c)]} kinds={kindsOf(c)} />,
  }),
  above: (c, opening) => (c.changes.some((one) => open(one) && (one.waiting ?? 0) > 0) ? <Outbox c={c} opened={opening === 'outbox'} /> : null),
  // A part the lead changed on its way is its housekeeping, inside its work; one with a way on stands as a line.
  folds: (beat) => beat.who === 'lead' && beat.act === undefined,
  beat: (c, beat) => {
    switch (beat.kind) {
      case 'part':
      case 'line':
        return line(c, beat)
      case 'live':
        return <LiveLine text={beat.text} {...(beat.act === undefined ? {} : { act: beat.act })} />
      case 'review':
        return review(c, beat)
      case 'ask':
        return <AskView c={c} ask={beat.ask} />
    }
  },
  took: (_c, took, t) => {
    const [first] = partsOfTime(t)
    const total = partsOfTime(t).reduce((sum, [s]) => sum + s, 0)
    return first !== undefined && first[1] !== 'the agent’s own work' && first[0] * 3 >= total ? `${took} · ${said(first)}` : took
  },
  scratch: 'talk',
}

export const VIEWS: Record<Direction, View> = { A, B, C }

/** What a turn's line opens to first, in every direction: where its time went. */
export const timeOf = (t: Timing) => <TimeParts t={t} />
