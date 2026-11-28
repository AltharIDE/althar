import {
  type AgentStatus,
  type BoardCall,
  type BoardTask,
  type ChangeSummary,
  type HeldForShip,
  issuesWordOf,
  type PlanStep,
  type ReviewBrief,
} from '@althar/contracts'
import {
  AbandonTask,
  Board,
  BoardCard as KitBoardCard,
  boardCardText,
  type BoardCardProps,
  BoardColumn,
  BoardDivider,
  BoardEmpty,
  type BoardFolds,
  BoardLane,
  BoardList,
  BranchChip,
  Button,
  CallCard,
  CommandChip,
  Fact,
  FactLine,
  FileChips,
  Findings,
  FoldedRow,
  heldBackWords,
  KeptRow as KitKeptRow,
  LinkButton,
  MenuItem,
  MergeButton,
  NextLine,
  NextRow as KitNextRow,
  NextStep,
  Outcome,
  PullChip,
  SettledRow as KitSettledRow,
  ScratchShelf,
  SettleWays,
  StartedBy,
  TaskKind,
  TaskStatus,
  Thumbs,
  trackOf as trackItems,
  type ChangeMarkTone,
  unreachable,
  Wait,
  Problem,
} from '@althar/ui'
import { type ComponentProps, Fragment, type ReactNode, useEffect, useState } from 'react'

import { pictureUrl } from '../../../main/pictureAddress'
import { abandonedBlocker, blockerText, blockerWords } from '../../shared/blockers'
import { MERGE_QUEUE_STEP, MERGING_STEP } from '../../data/merges'
import { taskStatusOf } from '../../shared/taskStatus'
import { atOnceWords, busyWords, externalWaitWords, heldWhyWords, inLineWords, reconnectsWords, waitsWords } from '../../shared/agents'
import { localText } from '../../shared/local'
import { askOf, callKindOf, isAnswered, isSettleable, kindWords, takesDone, takesKeep, whereOf } from '../../shared/calls'
import { moreOf as questionMore } from '../../shared/questions'
import { productBrand, productName } from '../../shared/products'
import {
  checkFailuresOf,
  doingWords,
  doneHere,
  factsOf,
  labelWords,
  nextWords,
  ranChecks,
  readyWordOf,
  afterMergeText,
  shipText,
  standingOf,
  standingText,
} from '../../shared/standing'
import { afterSteps, isAutomatedStep, isFolded, stepNow, stepText, stoppedWords } from '../../shared/steps'
import { useTaskTitle } from '../../shared/taskTitle'
import { ago, clock, runningCalmly } from '../../shared/time'
import { text as stuckText } from '../task/StuckCall'
import { canHold, teamChangeOf, TeamMenu } from '../team/Team'
import { arrivesQuietly, markArrived, watch } from './arrived'
import s from './Board.module.css'
import { type Lanes, movesInLine, type RunningOrder, type Waiting, yoursOf } from './lanes'
import { useRunningOrder } from './runningOrder'
import type { LineActions } from './useBoard'
import type { WorkActions } from './useWorkActions'

/*
 * The project's work, as the kit's board lays it out: up next, running,
 * needs you, settled, each lane collapsed to a rail where the person
 * collapsed it or the board has no room for it. Up next lists what goes on
 * by itself, in the order it will (ADR-065): what continues, saying with
 * what and why it waits, then the line the person orders, then what is
 * paused, then plans. A card has little to press: the whole of it opens
 * its task, where a call is answered, work is accepted and the lead is told
 * what's next. The exception is a ready change's Push and Accept and merge,
 * which do it right there. Its top line says where the task stands in a word, then its
 * kind's word (Change, Review; nothing for a plain task), then how long;
 * under its title, at most one card in the card (its branch, its pull
 * request, what it handed back) and one fact.
 */

export const text = {
  label: 'The project’s work',
  /** Chats on Scratch, off the lanes (a task is a conversation plus parts): the chip that lists them. */
  scratch: (count: number) => `Asides · ${count}`,
  scratchLabel: 'Asides',
  startsIn: (seconds: number) => (seconds <= 0 ? 'Starting' : `Starts in ${seconds}s`),
  held: 'Held. Starts when you say',
  /** Over Up next once the person put it in an order of their own, and at its end, the way back. */
  yourOrder: 'In your order',
  oldestFirst: 'Back to oldest first',
  /** In a row's menu, where Althar asked its agent a turn that waits for a place: let it go, read with the agent's next turn. */
  cancelTurn: 'Cancel this turn',
  /** In a row held back while the computer lets fewer agents work than the number, where its line was: it starts now. */
  startAnyway: 'Start anyway',
  /** The divider over the rows after those held back: they would wait with the person's number too. */
  waitsAnyway: 'Waiting for an agent to finish',
  /** The quiet divider over work under way held for a usage limit or the connection: it goes on by itself once it can. */
  paused: 'Paused',
  /** The one over tasks started Local that wait for the checkout: another task's there, or the person's changes (ADR-091). */
  forLocal: localText.word,
  planned: 'Planned',
  /** Up next while nothing is in it, on a new project or a busy one: how work gets here. */
  upNextEmpty: {
    title: 'Nothing queued',
    how: 'Tell the coordinator what you want done. The tasks it plans line up here.',
    talk: 'Talk to the coordinator',
  },
  step: { implement: 'Implement', review: 'Review' } satisfies Record<PlanStep['key'], string>,
  /** A round of work after its plan, in place of Implement, as the person asked its lead for more. */
  followUp: 'Follow-up',
  conversation: 'Conversation',
  status: {
    [TaskStatus.Running]: 'Running',
    [TaskStatus.Yours]: 'Waiting on you',
    [TaskStatus.Done]: 'Done',
    [TaskStatus.Paused]: 'Paused',
    [TaskStatus.Queued]: 'Waiting',
    [TaskStatus.Stopped]: 'Stopped',
  } satisfies Record<TaskStatus, string>,
  /** Why a stopped task's lead stopped, in a card's words, where something says; else the card says nothing more. */
  stoppedBy: stepText.stoppedBy,
  carryOn: 'Resume',
  carryingOn: 'Telling the lead',
  /** A draft whose plan never came: what it is, in place of Stopped, and what carries it on, the coordinator asked for its plan. */
  unplanned: 'No plan yet',
  planIt: 'Plan it',
  planning: 'Asking the coordinator',
  /** What the lead is told to carry on. */
  carryOnNote: 'Carry on.',
  /** What the lead is told to carry on where its branch conflicts: settle that first, as part of going on. */
  carryOnMergingNote: 'Carry on. Your branch conflicts with the default branch: merge it in and settle the conflict first.',
  /** A stopped task's conflict, one quiet line under what stopped it: Carry on settles it too. */
  conflicts: 'Conflicts with the default branch',
  /** Settles a finished task that isn't a change, from its kept row. */
  done: 'Done',
  /** At a card's foot while everything its task asks is allowed, by its own switch or its project's. */
  /** Its folder being set up before its lead starts: the install its lockfile names, or the setup kept for its repository. */
  settingUp: { install: 'Installing dependencies', kept: 'Setting up' } satisfies Record<NonNullable<BoardTask['settingUp']>, string>,
  /** A plain task at work: no steps worth showing, and nothing of its own yet. */
  working: 'Working',
  /** A plain task that finished, waiting to be seen. */
  finished: 'Finished',
  /** A review at work, reading someone else's pull request. */
  reading: 'Reading',
  reviewDrafted: 'Review drafted',
  /** A conflict Althar didn't ask its lead to resolve, though the rules say to: asks it anyway (ADR-030). */
  resolveNow: 'Resolve now',
  resolvingNow: 'Asking the lead',
  /** A running change's checks; a ready one's say what stands (shared/standing). */
  checks: {
    passed: (n: number) => (n === 1 ? '1 check passed' : `All ${n} checks passed`),
    soFar: (passed: number, total: number) => `${passed} of ${total} checks passed`,
    failed: (n: number) => (n === 1 ? '1 check failed' : `${n} checks failed`),
  },
  /** A picture it handed back with no name, as the thread says it. */
  picture: (n: number) => `Image ${n}`,
  findingsSoFar: (n: number) => (n === 1 ? '1 finding so far' : `${n} findings so far`),
  blocking: (n: number) => `${n} blocking`,
  verdict: { approve: 'approve', changes: 'request changes', comment: 'comment' } satisfies Record<
    NonNullable<ReviewBrief['verdict']>,
    string
  >,
  allow: 'Allow',
  deny: 'Don’t allow',
  /** What a question's card offers: to answer it, in its task. */
  answer: 'Answer',
  /** A stuck step whose agent is signed out, from its card: Settings, at its sign-in, started. */
  signIn: 'Sign in again',
  merged: (name: string) => `${name} merged`,
  closed: (name: string) => `${name} closed`,
  /** Settled with its pull request open on its host, as the host last said: an abandoned task's, left open. */
  stillOpen: (name: string) => `${name} still open`,
  closeChange: (name: string) => `Close ${name}`,
  abandoned: 'Abandoned',
  showOlder: 'Show older',
  /** What Done and Keep for later do, on hover. */
  doneHint: 'Settle it: it moves to Settled, and what it left running, such as a page, stops.',
  keepHint: 'Take it out of Needs you as it is, with its page still up. Writing to it brings it back.',
  /** The two the Settled lane's head names, while something is kept for later; the one showing in ink. */
  settledOrKept: 'Settled or kept for later',
  /** Running's orders, from the menu on its head: the oldest first, as it is until the person picks, or by where each stands. */
  runningOrder: { label: 'Order', oldest: 'Oldest first', status: 'Status' },
  settledShelf: 'Settled',
  keptShelf: 'Kept',
  /** When a kept task was kept, under its title. */
  keptAt: (ago: string) => `kept ${ago}`,
  /** Settled, while nothing has settled but something was kept for later. */
  nothingSettled: 'Nothing has settled yet.',
}

/** Closing settled tasks' pull requests from their rows: the one closing now, the last that failed and why, and how to close one. */
export interface ClosingPullRequests {
  readonly busy: string | null
  readonly failed: { readonly taskId: string; readonly message: string } | null
  readonly close: (taskId: string, url: string) => void
}

/** How many of what a task handed back show on its card: a row of pictures, or a few files. */
const HANDED_SHOWN = 3

/** Starting a plan up next, by its id, and opening a task's team, by the task's id, in the project whose usage the menu says. */
export interface TeamActions {
  readonly projectId: string
  readonly start: (planId: string) => Promise<void>
  /** Holds it, out of the line, until it is started. */
  readonly hold: (planId: string) => Promise<void>
  readonly change: (taskId: string) => void
  /** Abandons a task, asked first here: its row leaves Up next at once; whether it went through. */
  readonly abandon?: (taskId: string) => Promise<boolean>
}

/** What the home's dock holds: a task, by its id, or a call. */
export type DockTarget = { readonly kind: 'task'; readonly id: string } | { readonly kind: 'call'; readonly id: string }

/**
 * A task's steps as its card's track names them, the one it is on, and whether they are all done: a task whose checks run, whose
 * commits are pushing, or that is being merged, has finished its steps, so none of them is on.
 */
export const trackOf = (task: BoardTask) => {
  const planned = (task.plan?.steps ?? []).filter((step) => !step.skipped).map((step) => step.key)
  const done = isAutomatedStep(task.step)
  if (planned.length === 0) return { steps: [text.conversation], at: 0, done }
  // Settling a review's findings is part of the review.
  const on =
    task.step === 'implement' ? 'implement' : task.step === null || task.step === 'publish' || afterSteps(task.step) ? null : 'review'
  // Publishing, and a conflict round, come after the steps.
  const at = on === null ? (task.step === 'publish' || afterSteps(task.step) ? planned.length - 1 : 0) : Math.max(0, planned.indexOf(on))
  // A round of work after its plan is its lead's follow-up, then its review where the plan has one.
  return { steps: planned.map((key) => (key === 'implement' && task.followUp === true ? text.followUp : text.step[key])), at, done }
}

/** A card names its task by its title alone: its slug says the same again, in code. */
const unnamed = () => ''

/** The kit's kind for the task's own: their words are the same. */
const kindOf = (task: Pick<BoardTask, 'kind'>): TaskKind => {
  switch (task.kind) {
    case 'change':
      return TaskKind.Change
    case 'review':
      return TaskKind.Review
    case 'plain':
      return TaskKind.Plain
    default:
      return unreachable(task.kind)
  }
}

/** A kind's word on a row: Change, Review, or none for a plain task. */
export const kindWordOf = (task: Pick<BoardTask, 'kind' | 'local'>): string | undefined =>
  (task.local === true ? boardCardText.local(boardCardText.kind[kindOf(task)]) : boardCardText.kind[kindOf(task)]) || undefined

/** In the person's own checkout, as its kind's word says (ADR-091). */
const localOf = (task: Pick<BoardTask, 'local'>): Pick<Card, 'local'> => (task.local === true ? { local: true } : {})
type ChangeMark = NonNullable<BoardTask['changeMarks']>[number]
type Stands = ChangeMark['stands']

/** Where one of several changes stands, in the card's words. */
const standsWords: Record<Stands, string> = {
  unshipped: 'not shipped',
  draft: 'a draft',
  checking: 'waiting for checks',
  failing: 'checks failing',
  ready: 'ready to merge',
  merged: 'merged',
  closed: 'closed',
}
const markTones: Record<Stands, ChangeMarkTone> = {
  unshipped: 'still',
  draft: 'still',
  checking: 'live',
  failing: 'danger',
  ready: 'signal',
  merged: 'ok',
  closed: 'still',
}
const factTones: Record<Stands, 'quiet' | 'ok' | 'danger' | 'live'> = {
  unshipped: 'quiet',
  draft: 'quiet',
  checking: 'live',
  failing: 'danger',
  ready: 'quiet',
  merged: 'ok',
  closed: 'quiet',
}
/** The most pressing first: what the sentence names, where its changes stand apart. */
const PRESSING: ReadonlyArray<Stands> = ['failing', 'unshipped', 'checking', 'draft', 'ready', 'closed', 'merged']

/**
 * The card's one sentence across several changes (a task is a conversation plus parts, "The card keeps one fact"): what's
 * alike counted, "Both ready to merge", "Waiting for checks on all 3"; else the most pressing named, "Lane heights: checks
 * failing", or counted where several share it. Merged and closed ones are left out while any is still open.
 */
export const severalSaid = (marks: ReadonlyArray<ChangeMark>): { readonly words: string; readonly stands: Stands } | null => {
  const open = marks.filter((mark) => mark.stands !== 'merged' && mark.stands !== 'closed')
  const counted = open.length === 0 ? marks : open
  const [pressing] = PRESSING.flatMap((stands) => {
    const alike = counted.filter((mark) => mark.stands === stands)
    return alike.length === 0 ? [] : [{ stands, alike }]
  })
  if (pressing === undefined) return null
  const { stands, alike } = pressing
  const [one] = alike
  if (alike.length === 1 && one !== undefined) return { words: `${one.name}: ${standsWords[stands]}`, stands }
  const every = alike.length === counted.length
  const all = every ? (alike.length === 2 ? 'both' : `all ${alike.length}`) : `${alike.length} of ${counted.length}`
  const All = `${all.charAt(0).toUpperCase()}${all.slice(1)}`
  const words =
    stands === 'checking'
      ? `Waiting for checks on ${all}`
      : stands === 'failing'
        ? `Checks failing on ${all}`
        : stands === 'draft'
          ? `${All} drafts`
          : stands === 'unshipped'
            ? every
              ? alike.length === 2
                ? 'Neither shipped yet'
                : 'None shipped yet'
              : `${All} not shipped`
            : `${All} ${standsWords[stands]}`
  return { words, stands }
}

/** Toward a branch other than the default, quietly at its foot (ADR-093). */
const towardOf = (task: Pick<BoardTask, 'toward' | 'changeCount' | 'changeMarks'>): Pick<Card, 'toward' | 'changes' | 'marks'> => ({
  ...(task.toward === undefined ? {} : { toward: task.toward }),
  // How many changes it holds, where several (a task is a conversation plus parts), behind a mark for each.
  ...(task.changeCount === undefined || task.changeCount < 2 ? {} : { changes: task.changeCount }),
  ...(task.changeMarks === undefined || task.changeMarks.length < 2
    ? {}
    : {
        marks: task.changeMarks.map((mark) => ({
          name: mark.name,
          says: `${mark.name}: ${standsWords[mark.stands]}`,
          tone: markTones[mark.stands],
        })),
      }),
})

/** A pull request as its chip shows it: its host's mark, its repository's own name, its number in the host's words, and its size. */
const pullChip = (change: ChangeSummary) => {
  const brand = productBrand(change.product)
  return (
    <PullChip
      host={{ name: productName(change.product), brand }}
      repo={change.repository.slice(change.repository.lastIndexOf('/') + 1)}
      number={change.number}
      // A host that doesn't count lines shows no size, rather than +0 −0.
      {...(change.additions === null || change.deletions === null ? {} : { add: change.additions, del: change.deletions })}
      text={{ number: (n: number) => `${change.prefix}${n}` }}
    />
  )
}

/** Someone else's pull request a review reads, on GitHub, where reviews are read: its number whole, and whose it is. */
const theirs = (reviewing: ReviewBrief) => (
  <PullChip
    host={{ name: productName('github'), brand: productBrand('github') }}
    number={reviewing.number}
    by={reviewing.author}
    {...(reviewing.additions === null || reviewing.deletions === null ? {} : { add: reviewing.additions, del: reviewing.deletions })}
  />
)

/** How a running change's checks stand, in one fact: all passed, some failed, or how many so far. None where it has none to say. */
const checksFact = (change: ChangeSummary): ReactNode => {
  const checks = change.checks
  const ran = checks === null ? null : ranChecks(checks)
  if (checks === null || ran === null || ran.total === 0) return null
  // Only the checks its host requires show red; an optional one's failure holds nothing back (#1117).
  const { failed, optional } = checkFailuresOf(change)
  if (failed > 0)
    return (
      <Fact icon="close" tone="danger">
        {text.checks.failed(failed)}
      </Fact>
    )
  if (optional.length > 0) return <Fact tone="quiet">{standingText.optional(optional)}</Fact>
  if (ran.passed === ran.total)
    return (
      <Fact icon="check" tone="ok">
        {text.checks.passed(ran.passed)}
      </Fact>
    )
  return <Fact>{text.checks.soFar(ran.passed, ran.total)}</Fact>
}

/** A branch with nothing changed (+0 −0) says nothing, so no card shows its chip; one whose size isn't known still does. */
const empty = (size: { readonly add: number; readonly del: number } | null | undefined) => size != null && size.add === 0 && size.del === 0

/** The step a change is on, in its word: its step's name on its track, or what it does once its steps are done. */
const stepWordOf = (work: BoardTask): string => {
  if (work.step === 'publish' || afterSteps(work.step)) return stepNow(work.step, work.shipAt) ?? ''
  const { steps, at } = trackOf(work)
  return steps[at] ?? text.status[TaskStatus.Running]
}

/** What a review found, as its foot says it: how many, in ink, then how many block it and its verdict, quieter. */
const findingsOf = (reviewing: ReviewBrief) => {
  const detail = [
    ...(reviewing.blocking > 0 ? [text.blocking(reviewing.blocking)] : []),
    ...(reviewing.verdict === null ? [] : [text.verdict[reviewing.verdict]]),
  ].join(' · ')
  return <Findings count={reviewing.findings} {...(detail === '' ? {} : { detail })} />
}

/** The card's own props, without how it opens. */
/** The kit's card, its title typed in where an agent renames the task (the person's own rename shows at once). */
function BoardCard({ taskId, ...props }: BoardCardProps & { taskId: string }) {
  return <KitBoardCard {...props} title={useTaskTitle(taskId, props.title)} />
}

/** The kit's settled and kept rows, typed in the same way. */
function SettledRow({ taskId, ...props }: ComponentProps<typeof KitSettledRow> & { taskId: string }) {
  return <KitSettledRow {...props} title={useTaskTitle(taskId, props.title)} />
}

function KeptRow({ taskId, ...props }: ComponentProps<typeof KitKeptRow> & { taskId: string }) {
  return <KitKeptRow {...props} title={useTaskTitle(taskId, props.title)} />
}

/** The kit's queue row, typed in the same way. */
function NextRow({ taskId, ...props }: ComponentProps<typeof KitNextRow> & { taskId: string }) {
  return <KitNextRow {...props} title={useTaskTitle(taskId, props.title)} />
}

type Card = Omit<BoardCardProps, 'onOpen' | 'current' | 'text'>

/** What a task handed back, as its card shows it: a row of pictures, or else a few files; nothing where it handed back none. */
const handedOf = (work: Pick<BoardTask, 'handed'>) => {
  const pictures = (work.handed?.pictures ?? []).flatMap((picture, index) =>
    picture.digest === null
      ? []
      : [{ id: `${index}-${picture.digest}`, src: pictureUrl(picture.digest, true), name: picture.name ?? text.picture(index + 1) }],
  )
  const files = work.handed?.files ?? []
  return pictures.length > 0 ? (
    <Thumbs pictures={pictures.slice(0, HANDED_SHOWN)} />
  ) : files.length > 0 ? (
    <FileChips files={files.slice(0, HANDED_SHOWN)} />
  ) : null
}

/** A card with what its task handed back beside its branch or pull request chip, in every state and kind: never in place of it. */
const withHanded = (work: Pick<BoardTask, 'handed'>, card: Card): Card => {
  const handed = handedOf(work)
  if (handed === null) return card
  return {
    ...card,
    object:
      card.object === undefined || card.object === null ? (
        handed
      ) : (
        <div className={s.chips}>
          {handed}
          {card.object}
        </div>
      ),
  }
}

/** The automation whose run a task is, as its card says it, quietly. */
/** Where it came from, at its foot: the automation whose run it is, or the task whose lead started it (ADR-097). */
const fromOf = (work: BoardTask): Pick<Card, 'from' | 'startedBy'> => ({
  ...(work.automation == null ? {} : { from: work.automation.name }),
  ...(work.startedBy === undefined ? {} : { startedBy: work.startedBy.title }),
})

/** Opens the task whose lead started it, from its card's foot: its title there is a link, apart from the card's own press. */
const parentOf = (work: BoardTask, open: (threadId: string) => void): Pick<BoardCardProps, 'onOpenStartedBy'> => {
  const parent = work.startedBy
  return parent === undefined ? {} : { onOpenStartedBy: () => open(parent.threadId) }
}

/** A running task's card: its step and its track, or Working; its branch or pull request; and why it stands still, where it does. */
export const runningCardOf = (work: BoardTask, now: string, name: (id: string | null) => string, actions?: CardActions): Card => {
  const base = withHanded(work, runningCard(work, now, name))
  // Merge pressed on its strip in Needs you, it is here at once, merging: it answers that press as it comes (MergeFeel), and goes
  // on into its merge queue just after, the ring it came with still spreading.
  const pressed = actions?.merging.has(work.taskId) === true
  const card =
    pressed && work.step === MERGING_STEP
      ? { ...base, merge: 'merging' as const }
      : pressed && work.step === MERGE_QUEUE_STEP
        ? { ...base, merge: 'queued' as const }
        : base
  // Stopped, or its lead not yet started, with a conflict not asked of it: why, in place of its foot, and Resolve now.
  if (work.conflictUnsent != null) return { ...card, ...unsentOf(work, work.conflictUnsent, actions) }
  if (work.conflictUnchecked != null) return { ...card, foot: <Fact tone="warm">{work.conflictUnchecked}</Fact> }
  return card
}

/**
 * Where a card in Running stands and the word it says: all Status sorts by, so apart from the rest of its card, which is
 * costly to build. Held for a usage limit or the connection, waiting for a free agent, or stopped, it says so rather than
 * that it runs: where it stands is its card's, as its header and the home say it (`taskStatusOf`).
 */
const runningSaid = (work: BoardTask): { readonly status: TaskStatus; readonly word: string } => {
  const status = taskStatusOf(work)
  if (status === TaskStatus.Running && work.externalWait !== undefined) return { status, word: text.status[TaskStatus.Queued] }
  if (
    (status === TaskStatus.Paused && (work.waits !== null || work.reconnects != null)) ||
    status === TaskStatus.Queued ||
    status === TaskStatus.Stopped
  )
    return { status, word: text.status[status] }
  // Its folder set up before its lead starts: what holds it, in place of the step its lead hasn't begun.
  if (work.settingUp != null) return { status: TaskStatus.Running, word: text.settingUp[work.settingUp] }
  switch (work.kind) {
    case 'plain':
      return { status: TaskStatus.Running, word: text.working }
    case 'review':
      return { status: TaskStatus.Running, word: text.reading }
    case 'change':
      return { status: TaskStatus.Running, word: stepWordOf(work) }
    default:
      return unreachable(work.kind)
  }
}

/** Under its word, why it stands still, where it does. */
const runningWhy = (work: BoardTask, status: TaskStatus, name: (id: string | null) => string): Pick<Card, 'why'> => {
  if (status === TaskStatus.Running) return work.externalWait === undefined ? {} : { why: externalWaitWords(work.externalWait, clock) }
  if (status === TaskStatus.Paused) {
    if (work.waits !== null) return { why: waitsWords(name(work.waits.agentId), clock(work.waits.until), undefined, work.waits.left) }
    return work.reconnects == null ? {} : { why: reconnectsWords(work.reconnects, clock) }
  }
  if (status === TaskStatus.Queued) return work.queued === null ? {} : { why: busyWords(work.queued) }
  return status === TaskStatus.Stopped ? whyStopped(work) : {}
}

const runningCard = (work: BoardTask, now: string, name: (id: string | null) => string): Card => {
  const said = { ...runningSaid(work), ...runningWhy(work, taskStatusOf(work), name) }
  const beforeWork = work.queued !== null && work.inLine === true
  const base = {
    kind: kindOf(work),
    ...localOf(work),
    ...towardOf(work),
    title: work.title,
    ...fromOf(work),
    // Waiting before its first step has had an agent, nothing has run: no clock.
    ...(work.startedAt === null || beforeWork || work.externalWait !== undefined ? {} : { at: runningCalmly(work.startedAt, now) }),
  }
  switch (work.kind) {
    case 'plain':
      return { ...base, ...said }
    case 'review':
      return {
        ...base,
        ...said,
        ...(work.reviewing == null
          ? {}
          : { object: theirs(work.reviewing), foot: <Fact>{text.findingsSoFar(work.reviewing.findings)}</Fact> }),
      }
    case 'change': {
      const { steps, at, done } = trackOf(work)
      const change = work.change
      return {
        ...base,
        ...said,
        // A track of one step says nothing more than its word; before any work it has no progress to show.
        ...(steps.length > 1 && !beforeWork ? { track: trackItems(steps, at, at, done) } : {}),
        ...(beforeWork
          ? {}
          : change !== null && change.state === 'open'
            ? { object: pullChip(change), foot: checksFact(change) }
            : work.branch !== null && !empty(work.changed)
              ? {
                  object: (
                    <BranchChip name={work.branch} {...(work.changed === null ? {} : { add: work.changed.add, del: work.changed.del })} />
                  ),
                }
              : {}),
      }
    }
    default:
      return unreachable(work.kind)
  }
}

/**
 * The words a card in Running says, in the order Status puts them: what an agent or Althar is at work on, in the order the
 * work goes; then what waits on something. "Waiting" is what waits outside and what waits for a free agent alike.
 */
const SAID_IN_ORDER: ReadonlyArray<string | undefined> = [
  text.settingUp.install,
  text.settingUp.kept,
  text.conversation,
  text.step.implement,
  text.followUp,
  text.working,
  text.step.review,
  text.reading,
  stepNow('conflict'),
  stepNow('checks'),
  stepNow('publish'),
  stepNow('publish', 'ready'),
  stepNow('pushing'),
  stepNow('merging'),
  stepNow('checks_running'),
  stepNow('publish', 'merge'),
  stepNow('merge_queue'),
  text.status[TaskStatus.Queued],
  text.status[TaskStatus.Paused],
]

/** Where a card in Running goes by Status, from what it says: by its word; after those, one that needs the person; stopped last. */
const saidRank = (work: BoardTask): number => {
  const { status, word } = runningSaid(work)
  if (status === TaskStatus.Stopped) return SAID_IN_ORDER.length + 1
  // A conflict its lead wasn't asked to resolve: its card says why, with Resolve now for the person.
  if (work.conflictUnsent != null) return SAID_IN_ORDER.length
  return SAID_IN_ORDER.indexOf(word)
}

/** Running's cards in the order the person picked; by status, each keeps its place among those that say what it does. */
export const runningIn = (running: ReadonlyArray<BoardTask>, order: RunningOrder): ReadonlyArray<BoardTask> =>
  order === 'oldest'
    ? running
    : running
        .map((work) => ({ work, rank: saidRank(work) }))
        .toSorted((a, b) => a.rank - b.rank)
        .map(({ work }) => work)

/** Who stopped a task and the reason they gave, or the task its work went on in, under its title; nothing where nothing says. */
const whyStopped = (work: BoardTask): Pick<Card, 'why'> => {
  const why = stoppedWords(work.stopped)
  return why === undefined ? {} : { why }
}

/**
 * A task stopped because its work went on in another (`stopped.into`): one quiet row, its title, when, and that task, which
 * opens it; Resume at its end on hover, which tells its lead to go on, as a stopped card's does.
 */
function Folded({
  work,
  now,
  actions,
  onOpen,
}: {
  work: BoardTask
  now: string
  actions: CardActions | undefined
  onOpen: (threadId: string) => void
}) {
  const into = work.stopped?.into
  const sendBack = actions?.sendBack
  return (
    <FoldedRow
      data-move={work.taskId}
      title={useTaskTitle(work.taskId, work.title)}
      into={into?.title ?? ''}
      {...(into === undefined ? {} : { onOpenInto: () => onOpen(into.threadId) })}
      {...(work.stopped?.at == null ? {} : { at: ago(work.stopped.at, new Date(now)) })}
      onOpen={() => onOpen(work.threadId)}
      {...(sendBack === undefined
        ? {}
        : {
            onResume: () => void sendBack(work, work.conflictUnsent == null ? text.carryOnNote : text.carryOnMergingNote, true),
            resuming: actions?.sending?.has(work.taskId) ?? false,
          })}
    />
  )
}

/**
 * A task whose lead stopped with no agent on it: the person's to carry on or abandon. When it stopped, not a running time, and why
 * in plain words, with its branch and what changed in it, and Carry on, which tells the lead to go on. A conflict with the default
 * branch is one line under that, not why it waits: Carry on tells the lead to merge it in first.
 */
export const stoppedCardOf = (work: BoardTask, now: string, actions?: CardActions): Card => {
  const card = withHanded(
    work,
    runningCard(work, '', () => ''),
  )
  const sendBack = actions?.sendBack
  const merges = work.mergeable === true && work.change?.state === 'open' && actions !== undefined
  const { at: _, ...rest } = card
  return {
    ...rest,
    status: TaskStatus.Stopped,
    // A draft whose plan never came didn't stop: it has no plan, and nothing stopped it.
    word: work.unplanned === true ? text.unplanned : text.status[TaskStatus.Stopped],
    // Who stopped it and why, where something says; the word Stopped says the rest.
    ...(work.unplanned === true ? {} : whyStopped(work)),
    // When, where something says; else no time.
    ...(work.stopped?.at == null ? {} : { at: ago(work.stopped.at, new Date(now)) }),
    ...(sendBack === undefined && work.conflictUnsent == null
      ? {}
      : {
          // What stopped it leads; a conflict is one line under it, which Carry on settles on the way.
          ...(work.conflictUnsent == null
            ? merges && work.change != null
              ? // How its pull request stands, as a ready card says: every check passed, nothing in the way.
                { foot: readyOf(work, work.change, undefined).foot }
              : {}
            : {
                foot: (
                  <FactLine>
                    <Fact icon="branch" tone="warm">
                      {text.conflicts}
                    </Fact>
                  </FactLine>
                ),
              }),
          // Carry on on the strip at its foot, and, where its pull request is ready as it stands, Accept and merge before it: a
          // stopped task never hides the way to merge work that is ready.
          ...(sendBack === undefined && !merges
            ? {}
            : {
                // Its strip is Merge: pressed, the whole card answers.
                ...(merges ? { merge: actions?.merging?.has(work.taskId) === true ? ('merging' as const) : ('ready' as const) } : {}),
                next: (
                  <>
                    {merges && (
                      <MergeButton
                        strip
                        busy={actions?.merging?.has(work.taskId) ?? false}
                        aria-label={labelWords({ kind: 'merge' }, `${work.change?.prefix ?? ''}${work.change?.number ?? ''}`)}
                        onMerge={() => void actions?.merge(work.taskId, work.change?.head ?? '', work.change?.url)}
                        {...(work.change?.canBypassQueue === true && work.change.unpushed === 0 && work.held === undefined
                          ? { onBypassQueue: () => void actions?.merge(work.taskId, work.change?.head ?? '', work.change?.url, true) }
                          : {})}
                      >
                        {nextWords({ kind: 'merge' })}
                      </MergeButton>
                    )}
                    {sendBack !== undefined && (
                      <NextStep
                        signal={!merges}
                        busy={actions?.sending?.has(work.taskId) ?? false}
                        doing={work.unplanned === true ? text.planning : text.carryingOn}
                        onPress={() => void sendBack(work, work.conflictUnsent == null ? text.carryOnNote : text.carryOnMergingNote, true)}
                      >
                        {work.unplanned === true ? text.planIt : text.carryOn}
                      </NextStep>
                    )}
                  </>
                ),
              }),
        }),
  }
}

/** Why a step stuck, where it failed rather than waits: said on its card as a problem. */
const FAILED: ReadonlySet<string> = new Set([
  'signed_out',
  'sign_in_ended',
  'not_installed',
  'failed_to_start',
  'not_connected',
  'transient',
  'push_refused',
])

/** A stuck step that signing its agent in again puts right: whose agent, by id; null for any other. */
const signInFor = (stuck: BoardCall['stuck']): string | null =>
  stuck !== null && (stuck.why === 'signed_out' || stuck.why === 'sign_in_ended') ? stuck.agentId : null

/**
 * A task that waits on a call of the person's: the call's kind, and why, under its title; a permission's command under that.
 * A step stuck because something failed says so as a problem, and where signing its agent in again puts it right, its strip
 * does that, in place (`onSignIn`); once signed in, its task's Try again picks up where it stopped.
 */
export const waitingCardOf = ({ task, call }: Waiting, name: (id: string | null) => string, onSignIn?: (agentId: string) => void): Card => {
  const base = { status: TaskStatus.Yours, kind: kindOf(task), ...localOf(task), ...towardOf(task), title: task.title, ...fromOf(task) }
  // What it asks, or what it wants to do; for a step that needs the person, what stopped it.
  const why =
    call.stuck === null
      ? call.kind === 'permission' && call.command !== null
        ? // What it asks is often the command itself, which the chip below shows, once.
          call.command === call.title || call.title.includes('\n') || call.title.length > 120
          ? ''
          : call.title
        : call.title
      : call.stuck.step === 'publish' && call.stuck.why !== 'not_connected'
        ? stuckText.publishing(call.stuck)
        : stuckText.what(call.stuck, name(call.stuck.agentId) || 'The agent')
  const failed = call.stuck !== null && FAILED.has(call.stuck.why)
  const signIn = signInFor(call.stuck)
  return withHanded(task, {
    ...base,
    word: callKindOf(call),
    at: ago(call.createdAt),
    ...(failed ? { problem: why } : { why }),
    ...(signIn !== null && onSignIn !== undefined
      ? {
          next: (
            <NextStep signal onPress={() => onSignIn(signIn)}>
              {text.signIn}
            </NextStep>
          ),
        }
      : {}),
    ...(call.kind === 'permission' && call.command !== null
      ? { object: <CommandChip title={call.command}>{call.label ?? call.command}</CommandChip> }
      : {}),
    // A question's one step is to answer it, in its task.
    ...(call.kind === 'question' ? { next: <NextStep signal>{text.answer}</NextStep> } : {}),
  })
}

/** A task that waits on issues its lead drafted, or changes it proposed to its issue: what to do, in its task, where they are. */
export const issuesCardOf = (work: BoardTask): Card => ({
  status: TaskStatus.Yours,
  kind: kindOf(work),
  ...localOf(work),
  ...towardOf(work),
  title: work.title,
  ...fromOf(work),
  word: issuesWordOf(work.issues),
})

/**
 * A plan that waits for a task that was abandoned (tasks wait for their blockers): the person's, in Needs you, saying which;
 * its page and its plan card start it anyway, reopen that one, or stop waiting for it.
 */
export const abandonedCardOf = (work: BoardTask): Card => {
  const gone = abandonedBlocker(work)
  return {
    status: TaskStatus.Yours,
    kind: kindOf(work),
    ...localOf(work),
    ...towardOf(work),
    title: work.title,
    ...fromOf(work),
    word: kindWords.abandoned,
    ...(gone === undefined ? {} : { why: blockerText.abandoned(gone.title) }),
  }
}

/**
 * A ready task's card: a change to accept, with its pull request and checks; a review drafted; or a plain task that finished, with
 * what it handed back, or else its branch, where its lead wrote in the repository: on this Mac, as no pull request is coming.
 */
export const readyCardOf = (work: BoardTask, actions?: CardActions): Card => withHanded(work, readyCard(work, actions))

const readyCard = (work: BoardTask, actions?: CardActions): Card => {
  const base = { status: TaskStatus.Yours, kind: kindOf(work), ...localOf(work), ...towardOf(work), title: work.title, ...fromOf(work) }
  // What its review after a merge found comes first: the person's Fix it or Leave it, for the change that merged.
  if (work.afterMerge?.state === 'found')
    return { ...base, word: afterMergeText.word(work.afterMerge.findings), ...afterMergeOf(work, actions) }
  // Held for Ship, whatever kind it is: what waits, and Ship, which is all the person has to do for it; and Keep for later in
  // its corner where no pull request of it is open, its commits staying held.
  if (work.held !== undefined && work.kind !== 'review') {
    const change = work.change?.state === 'open' ? work.change : null
    const corner = settleWaysOf(work, actions)
    return {
      ...base,
      word: shipText.word,
      ...(change === null ? (work.branch === null ? {} : { object: <BranchChip name={work.branch} /> }) : { object: pullChip(change) }),
      ...shipOf(work, work.held, change, actions),
      ...(corner === null ? {} : { corner }),
    }
  }
  switch (work.kind) {
    case 'plain': {
      const ways = settleWaysOf(work, actions)
      return {
        ...base,
        word: text.finished,
        ...(ways === null ? {} : { corner: ways }),
        ...(work.branch !== null && !empty(work.changed)
          ? {
              object: (
                <BranchChip name={work.branch} {...(work.changed === null ? {} : { add: work.changed.add, del: work.changed.del })} />
              ),
            }
          : {}),
      }
    }
    case 'review': {
      // Its draft is posted or discarded in its task; here it is only kept for later. Posted and answered since, it is finished.
      const ways = settleWaysOf(work, actions)
      const findings = work.reviewing == null ? null : findingsOf(work.reviewing)
      return {
        ...base,
        word: isAnswered(work.reviewing) ? text.finished : text.reviewDrafted,
        ...(work.reviewing == null ? {} : { object: theirs(work.reviewing) }),
        ...(findings === null ? {} : { foot: findings }),
        ...(ways === null ? {} : { corner: ways }),
      }
    }
    case 'change': {
      // Commits after its last pull request merged or closed: its branch, as for work with none, until a new one opens; with
      // another of its repositories' pull requests open, that one, to accept, and the branch under it with what is in none.
      const change = work.unshipped == null || work.change?.state === 'open' ? work.change : null
      const after = work.unshipped == null || work.branch === null ? null : { name: work.branch, ...work.unshipped }
      const size = { add: work.unshipped?.add ?? work.changed?.add ?? 0, del: work.unshipped?.del ?? work.changed?.del ?? 0 }
      const branch = work.branch === null || empty(size) ? null : { name: work.branch, ...size }
      const ask = work.nothingBuilt === true ? askOf(work.summary) : null
      const corner = settleWaysOf(work, actions)
      const object =
        change === null ? (
          branch === null ? null : (
            <BranchChip {...branch} />
          )
        ) : after === null ? (
          pullChip(change)
        ) : (
          <div className={s.chips}>
            {pullChip(change)}
            {!empty(after) && <BranchChip name={after.name} add={after.add} del={after.del} />}
          </div>
        )
      return {
        ...base,
        // Handed back (a conflict its lead couldn't resolve) says so first; else commits in no pull request yet; as its header says.
        word: readyWordOf(work),
        ...(object === null ? {} : { object }),
        // Nothing built: no accept to press; what its lead leaves to the person, and Done, which settles it where it is, in its corner.
        // Any other with no pull request open, as a prototype ending on its branch: Keep for later there.
        ...(ask === null ? {} : { why: ask }),
        ...(corner === null ? {} : { corner }),
        // Its conflict the person's: not asked of its lead, why, and Resolve now, which asks it anyway; handed back by its lead,
        // why alone, as asking it again asks what it couldn't do, and the task, which the card opens, is where it is settled (DEV-173).
        ...(work.handedBack != null
          ? unsentOf(work, work.handedBack, undefined)
          : work.conflictUnsent != null
            ? unsentOf(work, work.conflictUnsent, actions)
            : // One merged or closed has nothing in its way, and nothing to do to it.
              change === null || change.state !== 'open'
              ? work.conflictUnchecked == null
                ? {}
                : { foot: <Fact tone="warm">{work.conflictUnchecked}</Fact> }
              : readyOf(work, change, actions)),
      }
    }
    default:
      return unreachable(work.kind)
  }
}

/**
 * A ready card of a task holding commits for Ship (a task is a conversation
 * plus parts, "A tweak waits for Ship"): how many wait, what else stands on
 * its open pull request that Ship's push answers (a failed check, a
 * conflict), and Ship, done right there, as Push is. One that failed says
 * why, and offers it again.
 */
const shipOf = (
  work: BoardTask,
  held: HeldForShip,
  change: ChangeSummary | null,
  actions: CardActions | undefined,
): Pick<Card, 'foot' | 'next'> => {
  const failure = actions?.failed[work.taskId]
  const failed = failure?.action === 'ship' ? failure.message : null
  const also = change === null ? [] : factsOf(change).filter((one) => one.tone === 'danger' || one.icon === 'branch')
  const ship = actions?.ship
  const step =
    ship === undefined ? (
      <NextStep>{shipText.ship}</NextStep>
    ) : (
      <NextStep
        signal
        busy={actions?.shipping?.has(work.taskId) === true}
        doing={shipText.shipping}
        label={failed === null ? shipText.label(held.commits) : shipText.again(held.commits)}
        onPress={() => void ship(work.taskId)}
      >
        {failed === null ? shipText.ship : standingText.nextFailed.again}
      </NextStep>
    )
  return {
    foot: (
      <FactLine>
        {failed !== null && (
          <Fact key="failed" icon="close" tone="danger" role="alert">
            {shipText.failed(failed)}
          </Fact>
        )}
        <Fact key="held" icon="up" tone="warm">
          {shipText.commits(held.commits)}
        </Fact>
        {also.map((one) => (
          <Fact key={one.words} tone={one.tone}>
            {one.words}
          </Fact>
        ))}
      </FactLine>
    ),
    next: step,
  }
}

/** What a ready card does without opening its task: push, and merge, ship, mark done or keep for later, and how they stand. */
export type CardActions = Pick<WorkActions, 'push' | 'merge' | 'pushing' | 'merging' | 'failed'> &
  Partial<
    Pick<
      WorkActions,
      | 'markDone'
      | 'keep'
      | 'settling'
      | 'resolveNow'
      | 'resolving'
      | 'sendBack'
      | 'sending'
      | 'ship'
      | 'shipping'
      | 'fixAfterMerge'
      | 'leaveAfterMerge'
      | 'answeringAfterMerge'
    >
  >

/**
 * What a task's review after a merge found (a task is a conversation plus parts): which merge, at its foot, and Fix it, which
 * hands the findings to the lead, with Leave it, quiet, before it.
 */
const afterMergeOf = (work: BoardTask, actions: CardActions | undefined): Pick<Card, 'foot' | 'next'> => {
  const found = work.afterMerge
  if (found === undefined) return {}
  const answering = actions?.answeringAfterMerge?.has(work.taskId) === true
  const fix = actions?.fixAfterMerge
  const leave = actions?.leaveAfterMerge
  return {
    foot: (
      <FactLine>
        <Fact key="after" icon="pr" tone="warm">
          {afterMergeText.after(found.words)}
        </Fact>
      </FactLine>
    ),
    next:
      fix === undefined ? (
        <NextStep>{afterMergeText.fix}</NextStep>
      ) : (
        <>
          {leave !== undefined && (
            <NextStep
              busy={answering}
              doing={afterMergeText.leaving}
              label={afterMergeText.leaveHint}
              onPress={() => void leave(work.taskId)}
            >
              {afterMergeText.leave}
            </NextStep>
          )}
          <NextStep
            signal
            busy={answering}
            doing={afterMergeText.fixing}
            label={afterMergeText.fixHint(found.words)}
            onPress={() => void fix(work.taskId)}
          >
            {afterMergeText.fix}
          </NextStep>
        </>
      ),
  }
}

/**
 * A conflict that is the person's, handed back or not asked of its lead: why, in one line, at its foot, and Resolve now, which
 * asks the lead anyway, in its strip; `second`, quiet, before it.
 */
const unsentOf = (work: BoardTask, why: string, actions: CardActions | undefined, second?: ReactNode): Pick<Card, 'foot' | 'next'> => {
  const resolveNow = actions?.resolveNow
  const next =
    resolveNow === undefined ? (
      second
    ) : (
      <>
        {second}
        <NextStep
          signal
          busy={actions?.resolving?.has(work.taskId) ?? false}
          doing={text.resolvingNow}
          onPress={() => void resolveNow(work.taskId)}
        >
          {text.resolveNow}
        </NextStep>
      </>
    )
  return {
    foot: (
      <FactLine>
        <Fact icon="branch" tone="warm">
          {why}
        </Fact>
      </FactLine>
    ),
    ...(next === undefined || next === null ? {} : { next }),
  }
}

/**
 * A finished task's Done and Keep for later, for its card's corner. Done where
 * it isn't a change, or built nothing: a review with a draft only keeps, as
 * it settles once posted. Keep for later for any kind, a prototype or a chat
 * ending on its branch included, but one whose pull request is open.
 */
const settleWaysOf = (work: BoardTask, actions: CardActions | undefined): ReactNode => {
  const { markDone, keep } = actions ?? {}
  if (markDone === undefined || keep === undefined) return null
  const done = isSettleable(work) && takesDone(work)
  const keeps = takesKeep({ phase: work.phase, state: work.state, pullOpen: work.change?.state === 'open' })
  if (!done && !keeps) return null
  return (
    <SettleWays
      {...(done ? { onDone: () => void markDone(work.taskId), doneHint: text.doneHint } : {})}
      {...(keeps ? { onKeep: () => void keep(work.taskId), keepHint: text.keepHint } : {})}
      {...(actions?.settling?.has(work.taskId) === true ? { busy: 'done' as const } : {})}
    />
  )
}

/**
 * A ready pull request's foot: what stands between it and merging, as one
 * line, the most pressing first in its colour (only it with its glyph), or
 * how its checks went where nothing does; and its strip, the one next thing
 * to do. Push
 * and Accept and merge are buttons that do it right there, as the task
 * does, and say so while they run; one that failed says why in the line and
 * offers to try again. Asking the lead to resolve or fix is words, a link:
 * the card opens its task, where it is told.
 */
const readyOf = (work: BoardTask, change: ChangeSummary, actions: CardActions | undefined): Pick<Card, 'foot' | 'next'> => {
  const standing = standingOf(change)
  const next = standing.next
  const here = actions !== undefined && next !== null && doneHere(next) ? next : null
  const failure = actions?.failed[work.taskId]
  const failed = failure !== undefined && failure.action === here?.kind ? failure.message : null
  // Not looked at for a conflict here, whatever its host says: why, first, as the host's word may be out of date.
  const unchecked = work.conflictUnchecked ?? null
  // Several changes: one sentence for them all, in place of the one pull request's facts.
  const several = work.changeMarks === undefined || work.changeMarks.length < 2 ? null : severalSaid(work.changeMarks)
  const facts =
    several === null
      ? factsOf(change, standing).map((one, i) => (
          <Fact key={one.words} {...(!(i === 0 && unchecked !== null) && one.icon !== undefined ? { icon: one.icon } : {})} tone={one.tone}>
            {one.words}
          </Fact>
        ))
      : [
          <Fact key="several" tone={factTones[several.stands]}>
            {several.words}
          </Fact>,
        ]
  // Failing checks its lead brought to the person (ADR-070): not asking it again. Why is in its task, not on the card.
  const step =
    next === null || (next.kind === 'fix' && work.checksBack != null) ? null : here === null || actions === undefined ? (
      <NextStep>{nextWords(next)}</NextStep>
    ) : here.kind === 'merge' ? (
      <MergeButton
        strip
        busy={actions.merging.has(work.taskId)}
        aria-label={labelWords(here, `${change.prefix}${change.number}`, failed !== null)}
        onMerge={() => void actions.merge(work.taskId, change.head ?? '', change.url)}
        {...(change.canBypassQueue === true
          ? { onBypassQueue: () => void actions.merge(work.taskId, change.head ?? '', change.url, true) }
          : {})}
      >
        {actions.merging.has(work.taskId) ? doingWords(here) : failed === null ? nextWords(here) : standingText.nextFailed.again}
      </MergeButton>
    ) : (
      <NextStep
        signal
        busy={(here.kind === 'push' ? actions.pushing : actions.merging).has(work.taskId)}
        doing={doingWords(here)}
        label={labelWords(here, `${change.prefix}${change.number}`, failed !== null)}
        onPress={() =>
          void (here.kind === 'push' ? actions.push : actions.merge)(
            work.taskId,
            here.kind === 'push' ? (change.localHead ?? '') : (change.head ?? ''),
            change.url,
          )
        }
      >
        {failed === null ? nextWords(here) : standingText.nextFailed.again}
      </NextStep>
    )
  return {
    foot: (
      <FactLine>
        {failed !== null && here !== null && (
          <Fact key="failed" icon="close" tone="danger" role="alert">
            {standingText.nextFailed[here.kind](failed)}
          </Fact>
        )}
        {unchecked !== null && (
          <Fact key="unchecked" icon="branch" tone="warm">
            {unchecked}
          </Fact>
        )}
        {facts}
      </FactLine>
    ),
    ...(step === null ? {} : { next: step }),
  }
}

export function BoardView({
  lanes,
  agents,
  now,
  onOpen,
  onShowOlder,
  closing,
  actions,
  line,
  folds,
  onFoldsChange,
  onTalk,
  team,
  onSignIn,
  onPlaces,
}: {
  lanes: Lanes
  agents: ReadonlyArray<AgentStatus>
  /** The time now, for countdowns and how long work has run. */
  now: string
  /** Opens a task, by its thread. */
  onOpen: (threadId: string) => void
  /** Loads the next page of settled work; absent where every settled task is already shown. */
  onShowOlder?: () => void
  /** Closing a settled task's pull request still open on its host, from its row; absent where it can't be. */
  closing?: ClosingPullRequests
  /** What a ready card does without opening its task, pushing and merging; without it, its next step is words and the card opens the task. */
  actions?: CardActions
  /** Putting the line of tasks waiting for a free agent in the person's order; without it, the line stays as it is. */
  line?: LineActions
  /** The lanes the person collapsed and opened, where they are kept; without them, the board keeps them while it is shown. */
  folds?: BoardFolds
  onFoldsChange?: (folds: BoardFolds) => void
  /** Puts the person in the coordinator's composer, from Up next while the board has nothing on it; without it, Up next says how work gets here and offers nothing to press. */
  onTalk?: () => void
  /**
   * Starting a plan up next and changing who does it, from its row: a plan held or on its countdown says Start where its line
   * was as the person points at it, and its row and a started one's whose first step waits have a menu to change the team.
   * Without it, a row only opens its task.
   */
  team?: TeamActions
  /** Opens Settings at an agent's sign-in, started: a step stuck on it offers that from its card. Without it, the card only opens its task. */
  onSignIn?: (agentId: string) => void
  /**
   * Opens this computer's load and agents, from Up next's line over what is held back (how many may work for now, of the
   * number); without it, that is words alone, as where the meter is off.
   */
  onPlaces?: () => void
}) {
  const name = (id: string | null) => agents.find((agent) => agent.id === id)?.name ?? id ?? ''
  // Clearing a chat off Scratch settles it, as Done does a task.
  const clear = actions?.markDone
  // Which of Settled's tabs shows, while something is kept for later.
  const [shelf, setShelf] = useState<'settled' | 'kept'>('settled')
  const [order, setOrder] = useRunningOrder()
  const running = runningIn(lanes.running, order)
  // What Settled draws has moved into it: once drawn, it arrives there no more, whatever the board does next. What is drawn
  // outside it is watched: only a task that settles while watched moves in.
  const settledShown = shelf === 'settled' || lanes.kept.length === 0
  useEffect(() => {
    if (settledShown) markArrived(lanes.settled.map((work) => work.taskId))
    watch(
      [
        ...lanes.scratch,
        ...lanes.next,
        ...lanes.running,
        ...lanes.waiting.map(({ task }) => task),
        ...lanes.stopped,
        ...lanes.ready,
        ...lanes.abandoned,
        ...lanes.kept,
      ].map((work) => work.taskId),
    )
  })
  // Each needs-you card in when its call came: tasks waiting on a call and calls no task waits on together.
  const asks = [
    ...lanes.waiting.map((waiting) => ({ at: waiting.call.createdAt, waiting, call: null })),
    ...lanes.calls.map((call) => ({ at: call.createdAt, waiting: null, call })),
  ].toSorted((a, b) => a.at.localeCompare(b.at))

  // The plans starting from their rows, by id, until the runtime has answered.
  const [starting, setStarting] = useState<ReadonlySet<string>>(new Set())
  // The row whose Abandon is being asked about, and the last one the runtime wouldn't abandon, which says why over the line.
  const [asking, setAsking] = useState<string | null>(null)
  const [unabandoned, setUnabandoned] = useState<string | null>(null)
  const abandonFailed = unabandoned === null ? undefined : actions?.failed[unabandoned]?.message
  const { continuing, free, paused } = lanes
  // What waits for an agent's place, what continues and the line in the one order places are given in; then the plans.
  const waitingRows = lanes.next.slice(0, continuing + free)
  // Of those, the ones held back for now: they would be at work with the person's number, but memory or the CPU lets fewer
  // work. They are the first in line; a heading over them says so, and how many may work, and one over the rest that they
  // would wait anyway.
  const heldRows = waitingRows.filter((work) => work.queued?.held !== undefined)
  const heldBy = heldRows[0]?.queued ?? null
  const planRows = lanes.next.slice(continuing + free, lanes.next.length - paused)
  // What is paused for a limit or the connection, and, under a divider of its own, what waits for its checkout (ADR-091).
  const pausedRows = lanes.next.slice(lanes.next.length - paused)
  const halted = pausedRows.filter((work) => work.waitsForCheckout == null)
  const forLocal = pausedRows.filter((work) => work.waitsForCheckout != null)
  const nextRow = (work: BoardTask, index: number) => {
    const startsAt = work.plan?.startsAt ?? null
    const kind = kindWordOf(work)
    const parent = work.startedBy
    const waits = waitingRows.includes(work)
    const pausedRow = pausedRows.includes(work)
    // Under way, it goes on with its step: a change's, as its card in Running would say it; a plain task or a review just goes on.
    // Not one that waits for its checkout: nothing of it has begun (ADR-091).
    const goesOn = (waits && work.inLine !== true) || (pausedRow && work.waitsForCheckout == null)
    const held = waits && work.queued?.held !== undefined
    // Held back, a row that goes on says its place, as one in line does: its busy agents' count, under the number, would
    // read as room to spare.
    const reason = waits
      ? work.queued === null
        ? text.startsIn(0)
        : work.inLine === true || held
          ? inLineWords(index + 1)
          : busyWords(work.queued)
      : pausedRow
        ? work.waitsForCheckout != null
          ? localText.after(work.waitsForCheckout)
          : work.waits !== null
            ? waitsWords(name(work.waits.agentId), clock(work.waits.until), undefined, work.waits.left)
            : work.reconnects != null
              ? reconnectsWords(work.reconnects, clock)
              : text.startsIn(0)
        : startsAt === null
          ? text.held
          : text.startsIn(Math.ceil((new Date(startsAt).getTime() - new Date(now).getTime()) / 1000))
    // A plan that waits for other tasks says what for, in place of its countdown: "Starts when Pairing merges"; and that it
    // waits on the person once one of them was abandoned, or it is held.
    const after = waits || pausedRow ? null : blockerWords(work)
    return (
      <NextRow
        key={work.taskId}
        taskId={work.taskId}
        data-move={work.taskId}
        place={index + 1}
        task={work.slug}
        {...(kind === undefined ? {} : { kind })}
        {...(goesOn ? { continues: work.kind === 'change' ? stepWordOf(work) : '' } : {})}
        {...(parent === undefined ? {} : { foot: <StartedBy task={parent.title} onOpen={() => onOpen(parent.threadId)} /> })}
        title={work.title}
        wait={
          after !== null
            ? abandonedBlocker(work) !== undefined || startsAt === null
              ? Wait.You
              : Wait.After
            : waits || pausedRow || startsAt !== null
              ? Wait.Workers
              : Wait.You
        }
        reason={after ?? reason}
        onOpen={() => onOpen(work.threadId)}
        {...teamOf(work)}
        // Held back, it starts now as the person's own start, whatever is free: in its line's place, as Start is for a plan.
        {...(held && line !== undefined ? { onStart: () => line.startAnyway(work.taskId) } : {})}
        text={{ task: unnamed, ...(held ? { start: text.startAnyway } : {}) }}
      />
    )
  }
  // A plan that hasn't begun starts, is held, or changes who does it, from its row; one starting or holding offers neither until it has.
  const teamOf = (work: BoardTask) => {
    const change = team === undefined ? null : teamChangeOf(work)
    if (team === undefined || work.plan === null || change === null) return {}
    const planId = work.plan.id
    const busy = (move: (planId: string) => Promise<void>) => () => {
      setStarting((was) => new Set(was).add(planId))
      void move(planId).finally(() =>
        setStarting((was) => {
          const next = new Set(was)
          next.delete(planId)
          return next
        }),
      )
    }
    const free = !starting.has(planId)
    const start = change === 'starts' && free ? busy(team.start) : undefined
    const hold = canHold(work) && free ? busy(team.hold) : undefined
    // A task that has begun changes its team from its own menu, not from its row; a Local task that waits for its checkout only holds.
    if (change === 'begun') return hold === undefined ? {} : { onHold: hold }
    return {
      ...(start === undefined ? {} : { onStart: start }),
      ...(hold === undefined ? {} : { onHold: hold }),
      menu: (
        <TeamMenu
          projectId={team.projectId}
          task={work}
          {...(start === undefined ? {} : { onStart: start })}
          {...(hold === undefined ? {} : { onHold: hold })}
          onChange={() => team.change(work.taskId)}
          {...(team.abandon === undefined ? {} : { onAbandon: () => setAsking(work.taskId) })}
        />
      ),
    }
  }

  return (
    <Board
      label={text.label}
      {...(folds === undefined ? {} : { folds })}
      {...(onFoldsChange === undefined ? {} : { onFoldsChange })}
      // What moves its cards: the lanes as shown, the shelf Settled shows, and what grows or shrinks a card (a press under
      // way, what failed); not the clock, nor anything drawn again around it.
      version={[
        lanes,
        shelf,
        order,
        starting,
        closing?.busy,
        closing?.failed,
        actions?.failed,
        actions?.merging,
        actions?.pushing,
        actions?.settling,
        actions?.resolving,
        actions?.sending,
        actions?.shipping,
        actions?.answeringAfterMerge,
      ]}
    >
      <BoardColumn
        lane={BoardLane.Next}
        count={lanes.upNext}
        filled={lanes.next.length > 0 || lanes.stopped.length > 0}
        // Chats on Scratch, off the lanes: one chip, opened in place, by their latest exchange; Clear settles one. It heads
        // Up next whether anything waits there or not.
        lead={
          <ScratchShelf
            chats={lanes.scratch.map((chat) => ({
              id: chat.taskId,
              title: chat.title,
              ...(chat.latest === undefined ? {} : { said: { by: chat.latest.by, text: chat.latest.said } }),
              at: ago(chat.latest?.at ?? chat.createdAt, new Date(now)),
              ...(chat.phase === 'running' ? { running: true } : {}),
            }))}
            onOpen={(taskId) => {
              const chat = lanes.scratch.find((one) => one.taskId === taskId)
              if (chat !== undefined) onOpen(chat.threadId)
            }}
            {...(clear === undefined ? {} : { onClear: (taskId: string) => void clear(taskId) })}
            text={{ chip: text.scratch, label: text.scratchLabel }}
          />
        }
        // Whenever nothing is in Up next, it says where work comes from.
        {...(lanes.next.length === 0 && lanes.stopped.length === 0
          ? {
              empty: (
                <BoardEmpty
                  title={text.upNextEmpty.title}
                  {...(onTalk === undefined ? {} : { action: <LinkButton onClick={onTalk}>{text.upNextEmpty.talk}</LinkButton> })}
                >
                  {text.upNextEmpty.how}
                </BoardEmpty>
              ),
            }
          : {})}
      >
        {line?.failed != null && <Problem className={s.failure}>{line.failed}</Problem>}
        {abandonFailed !== undefined && <Problem className={s.failure}>{abandonFailed}</Problem>}
        {line !== undefined && lanes.reordered && waitingRows.length > 1 && (
          <BoardDivider end={<LinkButton onClick={line.oldestFirst}>{text.oldestFirst}</LinkButton>}>{text.yourOrder}</BoardDivider>
        )}
        {heldBy?.held !== undefined && (
          <BoardDivider
            whole
            end={
              onPlaces === undefined ? (
                atOnceWords(heldBy)
              ) : (
                <LinkButton className={s.heldLink} onClick={onPlaces}>
                  {atOnceWords(heldBy)}
                </LinkButton>
              )
            }
          >
            <span className={s.held} title={heldWhyWords(heldBy)}>
              {heldBackWords(heldBy.held)}
            </span>
          </BoardDivider>
        )}
        {waitingRows.length + planRows.length > 0 && (
          // One order, the one places are given in: a row goes anywhere in it, a plan starting where it is put or where a row
          // is put below it. Planned heads the first plan after what waits; while some are held back, what waits past them
          // has a heading of its own, by place, so it stays put as rows move.
          <NextLine
            rows={[...waitingRows, ...planRows].map((work) => ({
              id: work.taskId,
              title: work.title,
              group: planRows.includes(work) ? 'planned' : 'waiting',
            }))}
            heads={{ planned: <BoardDivider>{text.planned}</BoardDivider>, after: <BoardDivider>{text.waitsAnyway}</BoardDivider> }}
            {...(heldRows.length > 0 && heldRows.length < waitingRows.length
              ? { split: { group: 'waiting', first: heldRows.length, rest: 'after' } }
              : {})}
            // While a row is dragged, each says the place it would take.
            render={(id, place) => {
              const work = lanes.next.find((one) => one.taskId === id)
              return work === undefined ? null : nextRow(work, place - 1)
            }}
            {...(line === undefined
              ? {}
              : {
                  // A row put below plans starts them, each at its place, so the order shown is the one places are given in.
                  onMove: async (id: string, to: number) => {
                    const ids = (rows: ReadonlyArray<BoardTask>) => rows.map((work) => work.taskId)
                    for (const [one, at] of movesInLine(ids(waitingRows), ids(planRows), id, to)) await line.move(one, at)
                  },
                  // A plan moves only where it starts: among what waits, or at the head of the plans.
                  place: (id: string, to: number, others: ReadonlyArray<string>) => {
                    const waits = others.filter((one) => waitingRows.some((work) => work.taskId === one)).length
                    return waitingRows.some((work) => work.taskId === id) || to <= waits ? to : null
                  },
                  more: (id: string) => {
                    const work = lanes.next.find((one) => one.taskId === id)
                    return work?.turnWaits === true && waitingRows.includes(work) ? (
                      <MenuItem icon="close" onSelect={() => line.cancelTurn(work.threadId)}>
                        {text.cancelTurn}
                      </MenuItem>
                    ) : null
                  },
                })}
          />
        )}
        {/* Cards apart, as the lane's others are; a list rules rows, not cards. */}
        {lanes.stopped
          .filter((work) => !isFolded(work.stopped))
          .map((work) => (
            <BoardCard
              taskId={work.taskId}
              key={work.taskId}
              data-move={work.taskId}
              {...stoppedCardOf(work, now, actions)}
              {...parentOf(work, onOpen)}
              errands={work.errands}
              onOpen={() => onOpen(work.threadId)}
            />
          ))}
        {/* Its work gone on in another task: settled in all but name, a quiet row, Resume there on hover. */}
        {lanes.stopped.some((work) => isFolded(work.stopped)) && (
          <BoardList>
            {lanes.stopped
              .filter((work) => isFolded(work.stopped))
              .map((work) => (
                <Folded key={work.taskId} work={work} now={now} actions={actions} onOpen={onOpen} />
              ))}
          </BoardList>
        )}
        {[halted, forLocal].map(
          (rows, at) =>
            rows.length > 0 && (
              <Fragment key={at === 0 ? 'paused' : 'local'}>
                <BoardDivider>{at === 0 ? text.paused : text.forLocal}</BoardDivider>
                <BoardList>{rows.map((work) => nextRow(work, lanes.next.indexOf(work)))}</BoardList>
              </Fragment>
            ),
        )}
      </BoardColumn>

      <BoardColumn
        lane={BoardLane.Running}
        count={lanes.atWork}
        filled={lanes.running.length > 0}
        order={{
          label: text.runningOrder.label,
          options: [
            { value: 'oldest', label: text.runningOrder.oldest },
            { value: 'status', label: text.runningOrder.status },
          ],
          value: order,
          onChange: (value: string) => setOrder(value === 'status' ? 'status' : 'oldest'),
        }}
      >
        {running.map((work) => (
          <BoardCard
            taskId={work.taskId}
            key={work.taskId}
            data-move={work.taskId}
            {...runningCardOf(work, now, name, actions)}
            {...parentOf(work, onOpen)}
            errands={work.errands}
            onOpen={() => onOpen(work.threadId)}
          />
        ))}
      </BoardColumn>

      <BoardColumn lane={BoardLane.Yours} count={yoursOf(lanes)}>
        {asks.map((ask) =>
          ask.waiting !== null ? (
            <BoardCard
              taskId={ask.waiting.task.taskId}
              key={ask.waiting.task.taskId}
              data-move={ask.waiting.task.taskId}
              {...waitingCardOf(ask.waiting, name, onSignIn)}
              {...parentOf(ask.waiting.task, onOpen)}
              errands={ask.waiting.task.errands}
              onOpen={() => onOpen(ask.waiting.task.threadId)}
            />
          ) : (
            <CallCard
              key={ask.call.id}
              data-move={ask.call.id}
              {...callCardOf(ask.call, name, onSignIn)}
              onOpen={() => onOpen(ask.call.threadId)}
            />
          ),
        )}
        {lanes.issues.map((work) => (
          <BoardCard
            taskId={work.taskId}
            key={work.taskId}
            data-move={work.taskId}
            {...issuesCardOf(work)}
            {...parentOf(work, onOpen)}
            errands={work.errands}
            onOpen={() => onOpen(work.threadId)}
          />
        ))}
        {lanes.abandoned.map((work) => (
          <BoardCard
            taskId={work.taskId}
            key={work.taskId}
            data-move={work.taskId}
            {...abandonedCardOf(work)}
            {...parentOf(work, onOpen)}
            errands={work.errands}
            onOpen={() => onOpen(work.threadId)}
          />
        ))}
        {lanes.ready.map((work) => (
          <BoardCard
            taskId={work.taskId}
            key={work.taskId}
            data-move={work.taskId}
            {...readyCardOf(work, actions)}
            {...parentOf(work, onOpen)}
            errands={work.errands}
            onOpen={() => onOpen(work.threadId)}
          />
        ))}
      </BoardColumn>

      <BoardColumn
        lane={BoardLane.Settled}
        count={lanes.settledTotal}
        filled={lanes.settledTotal > 0 || lanes.kept.length > 0}
        // What was kept for later, named beside Settled in its head while there is some; pressing it shows it in Settled's place.
        {...(lanes.kept.length === 0
          ? {}
          : {
              shelves: {
                label: text.settledOrKept,
                value: shelf,
                onChange: (value: string) => setShelf(value === 'kept' ? 'kept' : 'settled'),
                options: [
                  { value: 'settled', label: text.settledShelf, count: lanes.settledTotal },
                  { value: 'kept', label: text.keptShelf, count: lanes.kept.length, icon: 'pin' as const },
                ],
              },
            })}
      >
        {shelf === 'kept' && lanes.kept.length > 0 ? (
          <BoardList>
            {lanes.kept.map((work) => (
              <Kept key={work.taskId} work={work} now={now} onOpen={() => onOpen(work.threadId)} actions={actions} />
            ))}
          </BoardList>
        ) : (
          <>
            {lanes.settled.length === 0 && <p className={s.shelfNote}>{text.nothingSettled}</p>}
            <BoardList>
              {lanes.settled.map((work) => {
                const change = work.change
                const outcome = change?.state === 'merged' ? Outcome.Merged : work.state === 'abandoned' ? Outcome.Abandoned : Outcome.Done
                const named = change === null ? null : `${change.short} ${change.prefix}${change.number}`
                const kind = kindWordOf(work)
                return (
                  <SettledRow
                    key={work.taskId}
                    taskId={work.taskId}
                    data-move={work.taskId}
                    // Moved into Settled before, or settled before this window looked: drawn there without moving or coming in.
                    {...(arrivesQuietly(work.taskId) ? { 'data-move-seen': '' } : {})}
                    outcome={outcome}
                    task={work.slug}
                    {...(kind === undefined ? {} : { kind })}
                    title={work.title}
                    // Its pull request as its host last said: open is open, whatever became of the task (an abandoned one's is left open).
                    {...(named === null || change === null
                      ? work.branch === null
                        ? {}
                        : { meta: work.branch }
                      : {
                          meta:
                            change.state === 'merged'
                              ? text.merged(named)
                              : change.state === 'closed'
                                ? text.closed(named)
                                : text.stillOpen(named),
                        })}
                    {...(named !== null && change?.state === 'open' && closing !== undefined
                      ? {
                          action: {
                            label: text.closeChange(named),
                            onAction: () => closing.close(work.taskId, change.url),
                            busy: closing.busy === work.taskId,
                          },
                          ...(closing.failed?.taskId === work.taskId ? { error: closing.failed.message } : {}),
                        }
                      : {})}
                    at={work.settledAt === null ? '' : ago(work.settledAt, new Date(now))}
                    onOpen={() => onOpen(work.threadId)}
                    text={{ task: unnamed }}
                  />
                )
              })}
            </BoardList>
            {onShowOlder !== undefined && (
              <Button variant="quiet" size="small" onClick={onShowOlder}>
                {text.showOlder}
              </Button>
            )}
          </>
        )}
      </BoardColumn>
      {/* Abandoning a row up next, asked first: nothing of it has begun, so there is no branch, worktree or pull request to say. */}
      {asking !== null && team?.abandon !== undefined && (
        <AbandonTask
          worktree={null}
          branch={null}
          onAbandon={() => {
            const abandon = team.abandon!
            setAsking(null)
            setUnabandoned(null)
            void abandon(asking).then((through) => {
              if (!through) setUnabandoned(asking)
            })
          }}
          onClose={() => setAsking(null)}
        />
      )}
    </Board>
  )
}

/**
 * A task kept for later, as a row in Settled's place while Kept shows: what
 * it is and when it was kept, with Done at its end where it is the person's
 * to settle (a review with a draft settles once posted).
 */
function Kept({ work, now, onOpen, actions }: { work: BoardTask; now: string; onOpen: () => void; actions: CardActions | undefined }) {
  const markDone = actions?.markDone
  const failed = actions?.failed[work.taskId]
  return (
    <KeptRow
      taskId={work.taskId}
      data-move={work.taskId}
      title={work.title}
      at={work.keptAt == null ? '' : text.keptAt(ago(work.keptAt, new Date(now)))}
      onOpen={onOpen}
      {...(takesDone(work) && markDone !== undefined
        ? { onDone: () => void markDone(work.taskId), doneHint: text.doneHint, busy: actions?.settling?.has(work.taskId) === true }
        : {})}
      {...(failed === undefined ? {} : { error: failed.message })}
    />
  )
}

/** A call no task on the board waits on, as its card says it: the coordinator's question, with its options; or a held plan's call. */
export const callCardOf = (waiting: BoardCall, name: (id: string | null) => string, onSignIn?: (agentId: string) => void) => {
  // An agent's question, with its options where it asks one thing: answered where it was asked.
  if (waiting.kind === 'question') {
    const question = waiting.question ?? { fields: [] }
    const because = waiting.question?.why ?? questionMore(question)
    return {
      kind: kindWords.question,
      title: waiting.title,
      ...(because === undefined ? {} : { because }),
      options: (question.fields[0]?.options ?? []).map((option) => option.label),
      from: whereOf(waiting),
      at: ago(waiting.createdAt),
      text: { decide: text.answer },
    }
  }
  if (waiting.stuck !== null) {
    const stuck = waiting.stuck
    const what =
      stuck.step === 'publish' && stuck.why !== 'not_connected'
        ? stuckText.publishing(stuck)
        : stuckText.what(stuck, name(stuck.agentId) || 'The agent')
    const signIn = signInFor(stuck)
    // A step stuck because something failed: what went wrong as a problem under where it is, and what fixes it in its strip.
    return {
      kind: callKindOf(waiting),
      title: FAILED.has(stuck.why) ? (waiting.taskTitle ?? what) : what,
      ...(FAILED.has(stuck.why) && waiting.taskTitle !== null ? { problem: what } : {}),
      options: [],
      from: whereOf(waiting),
      at: ago(waiting.createdAt),
      ...(signIn !== null && onSignIn !== undefined
        ? {
            next: (
              <NextStep signal onPress={() => onSignIn(signIn)}>
                {text.signIn}
              </NextStep>
            ),
          }
        : {}),
    }
  }
  return {
    kind: kindWords.permission,
    title: waiting.title,
    because: waiting.reason,
    options: [text.allow, text.deny],
    from: whereOf(waiting),
    at: ago(waiting.createdAt),
  }
}
