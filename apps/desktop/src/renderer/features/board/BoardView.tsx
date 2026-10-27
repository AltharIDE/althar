import type { AgentStatus, BoardCall, BoardTask, ChangeSummary, PlanStep, ReviewBrief } from '@althar/contracts'
import {
  Board,
  BoardCard,
  boardCardText,
  type BoardCardProps,
  BoardColumn,
  BoardDivider,
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
  KeptRow,
  LinkButton,
  NextLine,
  NextRow,
  NextStep,
  Outcome,
  PullChip,
  SettledRow,
  SettleWays,
  TaskKind,
  TaskStatus,
  Thumbs,
  trackOf as trackItems,
  unreachable,
  Wait,
} from '@althar/ui'
import { type ReactNode, useState } from 'react'

import { pictureUrl } from '../../../main/pictureAddress'
import { busyWords, inLineWords, reconnectsWords, waitsWords } from '../../shared/agents'
import { callKindOf, isAnswered, isSettleable, kindWords, takesDone, whereOf } from '../../shared/calls'
import { moreOf as questionMore } from '../../shared/questions'
import { productBrand, productName } from '../../shared/products'
import { doingWords, doneHere, factsOf, labelWords, nextWords, standingOf, standingText } from '../../shared/standing'
import { afterSteps, stepText } from '../../shared/steps'
import { ago, clock, running } from '../../shared/time'
import { text as stuckText } from '../task/StuckCall'
import s from './Board.module.css'
import { type Held, heldOf, holding, type Lanes, type Waiting } from './lanes'
import type { LineActions } from './useBoard'
import type { WorkActions } from './useWorkActions'

/*
 * The project's work, as the kit's board lays it out: up next, running,
 * needs you, settled, each lane collapsed to a rail where the person
 * collapsed it or the board has no room for it. Up next lists what goes on
 * by itself, in the order it will (ADR-063): what continues, saying with
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
  startsIn: (seconds: number) => (seconds <= 0 ? 'Starting' : `Starts in ${seconds}s`),
  held: 'Held. Starts when you say',
  /** The quiet divider over the tasks that wait for a free agent before any has worked on them, and, under them, the plans. */
  startsWhenFree: 'Starts when an agent is free',
  /** At the divider's end, while the line is the oldest first; once the person changed it, the way back. */
  reorder: 'Drag to change the order',
  oldestFirst: 'Back to oldest first',
  /** The quiet divider over work under way held for a usage limit or the connection: it goes on by itself once it can. */
  paused: 'Paused',
  planned: 'Planned',
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
  stopped: 'No agent is working on it',
  /** Settles a finished task that isn't a change, from its kept row. */
  done: 'Done',
  /** At a card's foot while everything its task asks is allowed, by its own switch or its project's. */
  /** A plain task at work: no steps worth showing, and nothing of its own yet. */
  working: 'Working',
  /** A plain task that finished, waiting to be seen. */
  finished: 'Finished',
  /** A review at work, reading someone else's pull request. */
  reading: 'Reading',
  reviewDrafted: 'Review drafted',
  /** A conflict its lead couldn't resolve, or the checks on the merge it couldn't fix: the person's now. */
  mergeConflict: 'Merge conflict',
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

/** What the home's dock holds: a task, by its id, or a call. */
export type DockTarget = { readonly kind: 'task'; readonly id: string } | { readonly kind: 'call'; readonly id: string }

/** A task's steps as its card's track names them, and the one it is on. */
export const trackOf = (task: BoardTask) => {
  const planned = (task.plan?.steps ?? []).filter((step) => !step.skipped).map((step) => step.key)
  if (planned.length === 0) return { steps: [text.conversation], at: 0 }
  // Settling a review's findings is part of the review.
  const on =
    task.step === 'implement' ? 'implement' : task.step === null || task.step === 'publish' || afterSteps(task.step) ? null : 'review'
  // Publishing, and a conflict round, come after the steps.
  const at = on === null ? (task.step === 'publish' || afterSteps(task.step) ? planned.length - 1 : 0) : Math.max(0, planned.indexOf(on))
  // A round of work after its plan is its lead's follow-up, then its review where the plan has one.
  return { steps: planned.map((key) => (key === 'implement' && task.followUp === true ? text.followUp : text.step[key])), at }
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
export const kindWordOf = (task: Pick<BoardTask, 'kind'>): string | undefined => boardCardText.kind[kindOf(task)] || undefined

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
const checksFact = (checks: ChangeSummary['checks']): ReactNode => {
  if (checks === null || checks.total === 0) return null
  if (checks.failed > 0)
    return (
      <Fact icon="close" tone="danger">
        {text.checks.failed(checks.failed)}
      </Fact>
    )
  if (checks.passed === checks.total)
    return (
      <Fact icon="check" tone="ok">
        {text.checks.passed(checks.passed)}
      </Fact>
    )
  return <Fact>{text.checks.soFar(checks.passed, checks.total)}</Fact>
}

/** A branch with nothing changed (+0 −0) says nothing, so no card shows its chip; one whose size isn't known still does. */
const empty = (size: { readonly add: number; readonly del: number } | null | undefined) => size != null && size.add === 0 && size.del === 0

/** The step a change is on, in its word: its step's name on its track, or what it does once its steps are done. */
const stepWordOf = (work: BoardTask): string => {
  if (work.step === 'publish' || afterSteps(work.step)) return stepText.now[work.step ?? ''] ?? ''
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
type Card = Omit<BoardCardProps, 'onOpen' | 'current' | 'text'>

/** The automation whose run a task is, as its card says it, quietly. */
const fromOf = (work: BoardTask): Pick<Card, 'from'> => (work.automation == null ? {} : { from: work.automation.name })

/** A running task's card: its step and its track, or Working; its branch or pull request; and why it stands still, where it does. */
export const runningCardOf = (work: BoardTask, now: string, name: (id: string | null) => string): Card => {
  // Waiting for a free agent, held for a usage limit, or stopped, it says so rather than that it runs.
  const still: Pick<Card, 'status' | 'word' | 'why'> | null =
    work.queued !== null
      ? { status: TaskStatus.Queued, word: text.status[TaskStatus.Queued], why: busyWords(work.queued) }
      : work.waits !== null
        ? {
            status: TaskStatus.Paused,
            word: text.status[TaskStatus.Paused],
            why: waitsWords(name(work.waits.agentId), clock(work.waits.until), undefined, work.waits.left),
          }
        : work.reconnects != null
          ? { status: TaskStatus.Paused, word: text.status[TaskStatus.Paused], why: reconnectsWords(work.reconnects, clock) }
          : work.phase === 'stopped'
            ? { status: TaskStatus.Stopped, word: text.status[TaskStatus.Stopped], why: text.stopped }
            : null
  const beforeWork = work.queued !== null && work.inLine === true
  const base = {
    kind: kindOf(work),
    title: work.title,
    ...fromOf(work),
    // Waiting before its first step has had an agent, nothing has run: no clock.
    ...(work.startedAt === null || beforeWork ? {} : { at: running(work.startedAt, now) }),
  }
  switch (work.kind) {
    case 'plain':
      return { ...base, status: TaskStatus.Running, word: text.working, ...still }
    case 'review':
      return {
        ...base,
        status: TaskStatus.Running,
        word: text.reading,
        ...still,
        ...(work.reviewing == null
          ? {}
          : { object: theirs(work.reviewing), foot: <Fact>{text.findingsSoFar(work.reviewing.findings)}</Fact> }),
      }
    case 'change': {
      const { steps, at } = trackOf(work)
      const change = work.change
      const status = still?.status ?? TaskStatus.Running
      return {
        ...base,
        status,
        word: stepWordOf(work),
        ...still,
        // A track of one step says nothing more than its word; before any work it has no progress to show.
        ...(steps.length > 1 && !beforeWork ? { track: trackItems(steps, at) } : {}),
        ...(beforeWork
          ? {}
          : change !== null && change.state === 'open'
            ? { object: pullChip(change), foot: checksFact(change.checks) }
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

/** A task that waits on a call of the person's: the call's kind, and why, under its title; a permission's command under that. */
export const waitingCardOf = ({ task, call }: Waiting, name: (id: string | null) => string): Card => {
  const base = { status: TaskStatus.Yours, kind: kindOf(task), title: task.title, ...fromOf(task) }
  if (call === null) return { ...base, word: text.status[TaskStatus.Yours] }
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
  return {
    ...base,
    word: callKindOf(call),
    at: ago(call.createdAt),
    why,
    ...(call.kind === 'permission' && call.command !== null
      ? { object: <CommandChip title={call.command}>{call.label ?? call.command}</CommandChip> }
      : {}),
  }
}

/**
 * A ready task's card: a change to accept, with its pull request and checks; a review drafted; or a plain task that finished, with
 * what it handed back, or else its branch, where its lead wrote in the repository: on this Mac, as no pull request is coming.
 */
export const readyCardOf = (work: BoardTask, actions?: CardActions): Card => {
  const base = { status: TaskStatus.Yours, kind: kindOf(work), title: work.title, ...fromOf(work) }
  switch (work.kind) {
    case 'plain': {
      const pictures = (work.handed?.pictures ?? []).flatMap((picture, index) =>
        picture.digest === null
          ? []
          : [{ id: `${index}-${picture.digest}`, src: pictureUrl(picture.digest, true), name: picture.name ?? text.picture(index + 1) }],
      )
      const files = work.handed?.files ?? []
      const ways = settleWaysOf(work, actions)
      return {
        ...base,
        word: text.finished,
        ...(ways === null ? {} : { corner: ways }),
        ...(pictures.length > 0
          ? { object: <Thumbs pictures={pictures.slice(0, HANDED_SHOWN)} /> }
          : files.length > 0
            ? { object: <FileChips files={files.slice(0, HANDED_SHOWN)} /> }
            : work.branch !== null && !empty(work.changed)
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
        // Handed back (a conflict its lead couldn't resolve) says so first; else commits in no pull request yet.
        word:
          work.handedBack != null ? text.mergeConflict : change === null && work.unshipped != null ? kindWords.unshipped : kindWords.ready,
        ...(object === null ? {} : { object }),
        ...(work.handedBack != null
          ? {
              foot: (
                <Fact icon="branch" tone="warm">
                  {work.handedBack}
                </Fact>
              ),
            }
          : // One merged or closed has nothing in its way, and nothing to do to it.
            change === null || change.state !== 'open'
            ? {}
            : { foot: readyFoot(work, change, actions) }),
      }
    }
    default:
      return unreachable(work.kind)
  }
}

/** What a ready card does without opening its task: push, and merge, mark done or keep for later, and how they stand. */
export type CardActions = Pick<WorkActions, 'push' | 'merge' | 'pushing' | 'merging' | 'failed'> &
  Partial<Pick<WorkActions, 'markDone' | 'keep' | 'settling'>>

/**
 * A finished task's Done and Keep for later, for its card's corner, where it
 * isn't a change: a review with a draft only keeps, as it settles once
 * posted, and one kept has only Done.
 */
const settleWaysOf = (work: BoardTask, actions: CardActions | undefined): ReactNode => {
  const { markDone, keep } = actions ?? {}
  if (!isSettleable(work) || markDone === undefined || keep === undefined) return null
  return (
    <SettleWays
      {...(takesDone(work) ? { onDone: () => void markDone(work.taskId), doneHint: text.doneHint } : {})}
      {...(work.phase === 'ready' ? { onKeep: () => void keep(work.taskId), keepHint: text.keepHint } : {})}
      {...(actions?.settling?.has(work.taskId) === true ? { busy: 'done' as const } : {})}
    />
  )
}

/**
 * A ready pull request's foot: what stands between it and merging, as one
 * line, the most pressing first in its colour (only it with its glyph), or
 * how its checks went where nothing does; then the one next thing to do. Push
 * and Accept and merge are buttons that do it right there, as the task
 * does, and say so while they run; one that failed says why in the line and
 * offers to try again. Asking the lead to resolve or fix is words, a link:
 * the card opens its task, where it is told.
 */
const readyFoot = (work: BoardTask, change: ChangeSummary, actions: CardActions | undefined): ReactNode => {
  const standing = standingOf(change)
  const next = standing.next
  const here = actions !== undefined && next !== null && doneHere(next) ? next : null
  const failure = actions?.failed[work.taskId]
  const failed = failure !== undefined && failure.action === here?.kind ? failure.message : null
  const facts = factsOf(change, standing).map((one, i) => (
    <Fact key={one.words} {...(i === 0 && one.icon !== undefined ? { icon: one.icon } : {})} tone={one.tone}>
      {one.words}
    </Fact>
  ))
  return (
    <>
      <FactLine>
        {failed !== null && here !== null && (
          <Fact key="failed" icon="close" tone="danger" role="alert">
            {standingText.nextFailed[here.kind](failed)}
          </Fact>
        )}
        {facts}
      </FactLine>
      {next !== null &&
        (here === null || actions === undefined ? (
          <NextStep>{nextWords(next)}</NextStep>
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
        ))}
    </>
  )
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
}) {
  const name = (id: string | null) => agents.find((agent) => agent.id === id)?.name ?? id ?? ''
  // Which of Settled's tabs shows, while something is kept for later.
  const [shelf, setShelf] = useState<'settled' | 'kept'>('settled')
  // Each needs-you card in when its call came: tasks waiting on a call and calls no task waits on together.
  const asks = [
    ...lanes.waiting.map((waiting) => ({ at: waiting.call?.createdAt ?? waiting.task.createdAt, waiting, call: null })),
    ...lanes.calls.map((call) => ({ at: call.createdAt, waiting: null, call })),
  ].toSorted((a, b) => a.at.localeCompare(b.at))

  // While the person points at Up next or Running, or drags in the line, what would move between them stays where it was.
  const [held, setHeld] = useState<Held | null>(null)
  const shown = held === null ? lanes : holding(lanes, held)
  const { continuing, free, paused } = shown
  const pointed = (lane: BoardLane | null) =>
    setHeld((was) => (lane === BoardLane.Next || lane === BoardLane.Running ? (was ?? heldOf(lanes)) : null))

  const nextRow = (work: BoardTask, index: number) => {
    const startsAt = work.plan?.startsAt ?? null
    const kind = kindWordOf(work)
    // Under way, it goes on with its step: a change's, as its card in Running would say it; a plain task or a review just goes on.
    const goesOn = index < continuing || (index >= continuing + free && index < continuing + free + paused)
    const reason =
      index < continuing
        ? work.queued === null
          ? text.startsIn(0)
          : busyWords(work.queued)
        : index < continuing + free
          ? work.queued === null
            ? text.startsIn(0)
            : inLineWords(index + 1)
          : index < continuing + free + paused
            ? work.waits !== null
              ? waitsWords(name(work.waits.agentId), clock(work.waits.until), undefined, work.waits.left)
              : work.reconnects != null
                ? reconnectsWords(work.reconnects, clock)
                : text.startsIn(0)
            : startsAt === null
              ? text.held
              : text.startsIn(Math.ceil((new Date(startsAt).getTime() - new Date(now).getTime()) / 1000))
    return (
      <NextRow
        key={work.taskId}
        place={index + 1}
        task={work.slug}
        {...(kind === undefined ? {} : { kind })}
        {...(goesOn ? { continues: work.kind === 'change' ? stepWordOf(work) : '' } : {})}
        title={work.title}
        wait={index < continuing + free + paused || startsAt !== null ? Wait.Workers : Wait.You}
        reason={reason}
        onOpen={() => onOpen(work.threadId)}
        text={{ task: unnamed }}
      />
    )
  }

  return (
    <Board
      label={text.label}
      {...(folds === undefined ? {} : { folds })}
      {...(onFoldsChange === undefined ? {} : { onFoldsChange })}
      onPointerLane={pointed}
    >
      <BoardColumn lane={BoardLane.Next} count={shown.upNext} filled={shown.next.length > 0}>
        {continuing > 0 && <BoardList>{shown.next.slice(0, continuing).map(nextRow)}</BoardList>}
        {free > 0 && (
          <BoardDivider
            end={
              line === undefined || free < 2 ? undefined : shown.reordered ? (
                <LinkButton onClick={line.oldestFirst}>{text.oldestFirst}</LinkButton>
              ) : (
                text.reorder
              )
            }
          >
            {text.startsWhenFree}
          </BoardDivider>
        )}
        {line?.failed != null && (
          <p className={s.failure} role="alert">
            {line.failed}
          </p>
        )}
        {free > 0 && (
          <NextLine
            rows={shown.next.slice(continuing, continuing + free).map((work) => ({ id: work.taskId, title: work.title }))}
            // While a row is dragged, each says the place it would take, after what continues.
            render={(id, place) => {
              const work = shown.next.find((one) => one.taskId === id)
              return work === undefined ? null : nextRow(work, continuing + place - 1)
            }}
            {...(line === undefined ? {} : { onMove: line.move })}
          />
        )}
        {paused > 0 && <BoardDivider>{text.paused}</BoardDivider>}
        {paused > 0 && (
          <BoardList>
            {shown.next.slice(continuing + free, continuing + free + paused).map((work, index) => nextRow(work, continuing + free + index))}
          </BoardList>
        )}
        {continuing + free + paused > 0 && continuing + free + paused < shown.next.length && <BoardDivider>{text.planned}</BoardDivider>}
        {continuing + free + paused < shown.next.length && (
          <BoardList>
            {shown.next.slice(continuing + free + paused).map((work, index) => nextRow(work, continuing + free + paused + index))}
          </BoardList>
        )}
      </BoardColumn>

      <BoardColumn lane={BoardLane.Running} count={shown.atWork} filled={shown.running.length > 0}>
        {shown.running.map((work) => (
          <BoardCard key={work.taskId} {...runningCardOf(work, now, name)} onOpen={() => onOpen(work.threadId)} />
        ))}
      </BoardColumn>

      <BoardColumn lane={BoardLane.Yours} count={asks.length + lanes.ready.length}>
        {asks.map((ask) =>
          ask.waiting !== null ? (
            <BoardCard
              key={ask.waiting.task.taskId}
              {...waitingCardOf(ask.waiting, name)}
              onOpen={() => onOpen(ask.waiting.task.threadId)}
            />
          ) : (
            <CallCard key={ask.call.id} {...callCardOf(ask.call, name)} onOpen={() => onOpen(ask.call.threadId)} />
          ),
        )}
        {lanes.ready.map((work) => (
          <BoardCard key={work.taskId} {...readyCardOf(work, actions)} onOpen={() => onOpen(work.threadId)} />
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
export const callCardOf = (waiting: BoardCall, name: (id: string | null) => string) => {
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
    return {
      kind: callKindOf(waiting),
      title:
        stuck.step === 'publish' && stuck.why !== 'not_connected'
          ? stuckText.publishing(stuck)
          : stuckText.what(stuck, name(stuck.agentId) || 'The agent'),
      options: [],
      from: whereOf(waiting),
      at: ago(waiting.createdAt),
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
