// Scrappy: three ways a task holds several changes, all on A's base from the first round (one sentence and one button, the same on
// the card, in the bar and in Needs you; the lead's own part changes folded into its work). Each puts the changes in one place: in
// the task's chip as one piece of work, after its title one at a time, or over its composer as tabs. A task with one change reads
// the same in all three, as today.
import type { ReactNode } from 'react'

import { Icon } from '../../src/foundations/Icon/Icon'
import { TaskStatus, Verdict } from '../../src/foundations/vocabulary'
import { NextStep } from '../../src/primitives/NextStep/NextStep'
import { LinkButton } from '../../src/primitives/LinkButton/LinkButton'
import { TaskParts, type TaskPartModel } from '../../src/chrome/TaskParts/TaskParts'
import { Fact, FactLine } from '../../src/board/BoardCard/Chips'
import { AltharLine } from '../../src/thread/AltharLine/AltharLine'
import { ReviewLine } from '../../src/thread/ReviewLine/ReviewLine'
import { AskView } from './asks'
import { SOL } from './team'
import { type Beat, type Case, type Change, changeIn, type Timing } from './cases'
import { type Need, about, commits, list, nameOf, open } from './need'
import { act as doAct, lineAct } from './moves'
import {
  ChangeDock,
  ChangeSwitch,
  ChangeTrack,
  changePart,
  standingOf,
  chipOf,
  css,
  focusOf,
  kindsOf,
  Linked,
  SetMarks,
  taskWide,
  TimeParts,
} from './parts'
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
  /** Over the composer, in place of today's chip of the pull requests it listens to, where it returns something. */
  readonly above: (c: Case, opening: string | null) => ReactNode
  /** After the task's title, in the bar. */
  readonly crumb: (c: Case) => ReactNode
  /** The composer's words while empty, where they say more than today's. */
  readonly placeholder: (c: Case) => string | undefined
  /** The one fact, as this direction says it. */
  readonly need: (c: Case, need: Need) => Need
  /** A lead's part change mid-turn: folded into its work (an aside), or a line of its own. */
  readonly folds: (beat: Extract<Beat, { kind: 'part' }>) => boolean
  readonly beat: (c: Case, beat: Exclude<Beat, { kind: 'you' | 'lead' }>) => ReactNode
  /** A turn's line: its words after “Worked for”, and the first thing it opens to. */
  readonly took: (c: Case, took: string, t: Timing, beat: Extract<Beat, { kind: 'lead' }>) => string
  /** Where Scratch opens from on the board. */
  readonly scratch: 'shelf' | 'corner' | 'talk'
}

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
    <NextStep signal={need.tone === 'you' || need.tone === 'bad'} onPress={doAct(need.act, need.change?.id)}>
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
const line = (c: Case, beat: Extract<Beat, { kind: 'part' | 'line' }>, { links = false }: { links?: boolean } = {}) => (
  <AltharLine tone={beat.kind === 'line' && beat.tone === 'warning' ? 'warning' : 'info'}>
    {links ? <Linked c={c} text={beat.text} /> : beat.text}
    {beat.act !== undefined && (
      <span className={css.lineAct}>
        <LinkButton onClick={() => lineAct(beat.act!, beat.change)}>{beat.act}</LinkButton>
      </span>
    )}
  </AltharLine>
)

const review = (c: Case, beat: Extract<Beat, { kind: 'review' }>) => {
  const change = changeIn(c, beat.change)
  return (
    <>
      <ReviewLine
        model={SOL}
        verdict={beat.findings === 0 ? Verdict.Pass : Verdict.Changes}
        findings={beat.findings}
        {...(beat.fixed === undefined ? {} : { settled: beat.fixed })}
        text={{
          review: `${change !== undefined && c.changes.length > 1 ? `${nameOf(change)} · ` : ''}${beat.after === true ? `Review after ${change === undefined ? 'the merge' : `${nameOf(change)} merged`}` : 'Review'}`,
        }}
      >
        {beat.checked !== undefined && <p className={css.note}>{beat.checked}</p>}
      </ReviewLine>
    </>
  )
}

/* ——— What all three share: A's sentence, its thread, its turn lines ——— */

const chip = (c: Case, need: Need, words: ReactNode) => ({
  status: statusOf(c, need),
  state: need.says === c.word ? c.word : words,
  ...(need.act === undefined
    ? {}
    : {
        beside: (
          <button type="button" className={css.chipAct} data-tone={need.tone} onClick={doAct(need.act, need.change?.id)}>
            {need.act}
          </button>
        ),
      }),
})
const sentence = (need: Need) => <span className={css.chipWords} title={`${need.says}${more(need)}`}>{`${need.says}${more(need)}`}</span>

/** A's card: the sentence, the pull request it names, its button. */
const card = (c: Case, need: Need): CardOver => ({
  status: statusOf(c, need),
  ...(need.tone === 'quiet' && need.says === c.word ? {} : { why: `${need.says}${more(need)}` }),
  object: chipOf(named(c, need)),
  foot: null,
  next: nextOf(need),
})

const beatOf =
  ({ links }: { links: boolean }) =>
  (c: Case, beat: Exclude<Beat, { kind: 'you' | 'lead' }>): ReactNode => {
    switch (beat.kind) {
      case 'part':
      case 'line':
        return line(c, beat, { links })
      case 'live':
        return line(c, { kind: 'line', text: beat.text, ...(beat.act === undefined ? {} : { act: beat.act }) }, { links })
      case 'review':
        return review(c, beat)
      case 'ask':
        return <AskView c={c} ask={beat.ask} />
    }
  }

const shared = {
  // A part the lead changed on its way is its housekeeping, inside its work; one with a way on stands as a line.
  folds: (beat: Extract<Beat, { kind: 'part' }>) => beat.who === 'lead' && beat.act === undefined,
  // Once a task has two changes, each turn's line says where its commits went.
  took: (c: Case, took: string, _t: Timing, beat: Extract<Beat, { kind: 'lead' }>) => {
    const change = changeIn(c, beat.commits?.change)
    return c.changes.length < 2 || beat.commits === undefined || change === undefined
      ? took
      : `${took} · ${commits(beat.commits.n)} to ${nameOf(change)}`
  },
  scratch: 'corner' as const,
}

const several = (c: Case) => c.changes.length > 1

/* ——— A · As one: the changes are one piece of work ——— */

/**
 * The work as a whole: a change named only where it is the exception (it failed, or asks), what's ready or waiting counted, and the
 * button does it for every change it can: Merge all, Ship (each waiting one, from the bottom up, each with its review).
 */
const asOne = (c: Case, need: Need): Need => {
  const live = c.changes.filter(open)
  if (live.length < 2) return need
  const whole = { ...need, more: 0 }
  // An ask, a failure, something under way: the one change it is about, by name.
  if (need.tone === 'bad' || need.tone === 'live' || need.act === undefined) {
    if (need.says.startsWith('Waiting for checks on') && live.every((one) => one.checks === 'running'))
      return { ...whole, says: live.length === 2 ? 'Waiting for checks on both' : `Waiting for checks on all ${live.length}` }
    return whole
  }
  const ready = live.filter((one) => one.ready === true && (one.waiting ?? 0) === 0)
  if (need.act.startsWith('Merge') && need.act !== 'Review and merge' && ready.length > 1)
    return {
      ...whole,
      says:
        ready.length === live.length
          ? ready.length === 2
            ? 'Both ready to merge'
            : `All ${ready.length} ready to merge`
          : `${list(ready.map(nameOf))}: ready to merge`,
      act: ready.length === 2 ? 'Merge both' : `Merge all ${ready.length}`,
      change: undefined,
    }
  const waiting = live.filter((one) => (one.waiting ?? 0) > 0)
  if ((need.act === 'Ship' || need.act === 'Ship them all') && waiting.length > 0 && need.says.includes('not shipped')) {
    const n = waiting.reduce((sum, one) => sum + (one.waiting ?? 0), 0)
    return {
      ...whole,
      says:
        waiting.length === 1 ? about(waiting[0]!, `${commits(n)} not shipped`) : `${commits(n)} not shipped, in ${waiting.length} changes`,
      act: 'Ship',
      change: waiting.length === 1 ? waiting[0] : undefined,
    }
  }
  return whole
}

const ONE: View = {
  name: 'As one',
  what: 'The changes are one piece of work: a mark each, inside the task’s chip, before one sentence about the whole. Its button does it for every change it can. The marks open to the list.',
  need: asOne,
  card: (c, need) =>
    several(c)
      ? {
          status: statusOf(c, need),
          ...(need.tone === 'quiet' && need.says === c.word ? {} : { why: need.says }),
          object: null,
          foot: <ChangeTrack c={c} />,
          next: nextOf(need),
        }
      : card(c, need),
  header: (c, need) => ({
    ...chip(c, need, several(c) ? <SetMarks c={c} says={need.says} /> : sentence(need)),
    ...(several(c) && need.says === c.word ? { state: <SetMarks c={c} says={need.says} /> } : {}),
    // The changes are in the chip: the parts row keeps what the task has as a whole.
    parts: (
      <TaskParts
        parts={several(c) ? [...taskWide(c)] : [...c.changes.map((one) => changePart(c, one)), ...taskWide(c)]}
        kinds={kindsOf(c)}
      />
    ),
  }),
  above: () => null,
  crumb: () => null,
  placeholder: () => undefined,
  beat: beatOf({ links: false }),
  ...shared,
}

/* ——— B · One at a time: the window is about one change ——— */

const FOCUS: View = {
  name: 'One at a time',
  what: 'The window is about one change, named after the task’s title, with the others a switch away. Its chip, parts, Outputs and what you say are that change’s. Needs you opens the one that needs you.',
  need: (_c, need) => need,
  card,
  header: (c, need) => {
    if (!several(c))
      return {
        ...chip(c, need, sentence(need)),
        parts: <TaskParts parts={[...c.changes.map((one) => changePart(c, one)), ...taskWide(c)]} kinds={kindsOf(c)} />,
      }
    // The change in view: its own one fact and button; the title's switch says where another waits.
    const now = focusOf(c)
    const stands = now === undefined ? undefined : standingOfNeed(c, now, need)
    const shown = stands ?? need
    return {
      ...chip(c, shown, <span className={css.chipWords}>{shown.says}</span>),
      parts: <TaskParts parts={[...(now === undefined ? [] : [changePart(c, now)]), ...taskWide(c)]} kinds={kindsOf(c)} />,
    }
  },
  above: () => null,
  crumb: (c) => <ChangeSwitch c={c} />,
  placeholder: (c) => {
    const now = focusOf(c)
    return several(c) && now !== undefined ? `Tell Claude Code something about ${nameOf(now)}` : undefined
  },
  beat: beatOf({ links: true }),
  ...shared,
}

/** The change in view's own fact: the task's ask where it is about it, else where the change stands. */
const standingOfNeed = (c: Case, now: Change, need: Need): Need | undefined => {
  // The title names it: its fact goes without its name.
  if (need.change === now) {
    const says = now.short !== undefined && need.says.startsWith(`${now.short}: `) ? need.says.slice(now.short.length + 2) : need.says
    return { ...need, says: `${says.charAt(0).toUpperCase()}${says.slice(1)}`, more: 0 }
  }
  if (need.change === undefined && need.tone !== 'quiet' && !need.says.startsWith('Waiting for checks')) return { ...need, more: 0 }
  const stands = standingOf(c, now)
  return {
    tone: stands.tone === 'you' ? 'you' : stands.tone === 'bad' ? 'bad' : stands.tone === 'live' ? 'live' : 'quiet',
    says: stands.detail,
    ...(stands.act === undefined ? {} : { act: stands.act }),
    change: now,
    more: 0,
  }
}

/* ——— C · Where you talk: the changes as tabs over the composer ——— */

const DOCK: View = {
  name: 'Where you talk',
  what: 'The changes are tabs over the composer, where today’s chip of pull requests sits. The tab picked is what you say next goes to, and says where it stands; pressed again, its card. The bar keeps one sentence.',
  need: (_c, need) => need,
  card,
  header: (c, need) => ({
    ...chip(c, need, sentence(need)),
    // The changes are over the composer: the parts row keeps what the task has as a whole.
    parts: (
      <TaskParts
        parts={several(c) ? [...taskWide(c)] : [...c.changes.map((one) => changePart(c, one)), ...taskWide(c)]}
        kinds={kindsOf(c)}
      />
    ),
  }),
  above: (c, opening) => (several(c) ? <ChangeDock c={c} opened={opening === 'dock'} /> : null),
  crumb: () => null,
  placeholder: () => undefined,
  beat: beatOf({ links: true }),
  ...shared,
}

export const VIEWS: Record<Direction, View> = { A: ONE, B: FOCUS, C: DOCK }

/** What a turn's line opens to first, in every direction: where its time went. */
export const timeOf = (t: Timing) => <TimeParts t={t} />
