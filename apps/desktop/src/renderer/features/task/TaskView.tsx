import { MessageMotion } from '../../shared/MessageMotion'
import { blockerText, blockerWords, openBlockers, standsOf } from '../../shared/blockers'
import { EarlierTurns } from '../../shared/EarlierTurns'
import { ThreadWaysContext } from '../../shared/ThreadBlocks'
import { useTurnUndo } from './useTurnUndo'
import { useNavigate } from '@tanstack/react-router'
import { type CSSProperties, memo, type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import type { AttentionRequest, Service, TaskAction, ThreadItem, ThreadSnapshot } from '@althar/contracts'
import { useQuery } from '@tanstack/react-query'
import {
  CheckoutAsk,
  AbandonTask,
  AttachPullRequest,
  ChangeView,
  BackCrumb,
  Button,
  Delivery,
  DiffLineKind,
  type FileView,
  commandDown,
  Behind,
  keys,
  modKey,
  DictationTray,
  Issue,
  IssuePart,
  LinkButton,
  type ModelInfo,
  TaskFace,
  TaskHeader,
  type TaskHeaderStep,
  ReachLine,
  type TaskConflicts,
  TaskMenu,
  TaskStatus,
  Thread,
  ThreadShellProvider,
  ThreadMeasure,
  ThreadSkeleton,
  TitleBar,
  SettleWays,
  TaskParts,
  Problem,
  TaskWaitedBy,
} from '@althar/ui'

import { isAnswered, isSettleable, kindWords, takesDone, takesKeep } from '../../shared/calls'
import { text as boardText } from '../board/BoardView'
import { doing } from './actions'
import { externalWaitWords, queuedWords, reconnectsWords, upNextWords, waitsWords } from '../../shared/agents'
import { useModels } from '../../data/models'
import { contextMeter } from '../../shared/ContextMeter'
import { CarriedOver } from '../../shared/dictation/Carried'
import { useDictation } from '../../shared/dictation/useDictation'
import { draftKey, draftOf as draftNow, setDraftDictated, useSetDraft } from '../../shared/drafts'
import { DraftComposer } from '../../shared/DraftComposer'
import { isGenerated } from '../../shared/generated'
import { OpenIn, text as openInText, useEditors } from '../../shared/OpenIn'
import { queuedOf, queueShown, readingLocallyOf, readingNow, withQueued } from '../../shared/items'
import { ModelChoice } from '../../shared/ModelChoice'
import { pendingText } from '../../shared/Pending'
import { useModelNames } from '../../shared/modelNames'
import { type Choice, runningOn, upcomingOn } from '../../shared/models'
import { issuePriority, issueStatus, productBrand, productName } from '../../shared/products'
import { afterMergeText, readyWordOf, shipText } from '../../shared/standing'
import { taskStatusOf } from '../../shared/taskStatus'
import { stepNow, stepText, trackFor } from '../../shared/steps'
import { MERGE_QUEUE_STEP, queuedToMerge, shownChangeOf } from '../../data/merges'
import { ago, clock, MINUTE, running, SECOND, useNow } from '../../shared/time'
import { shortFolder } from '../../shared/folders'
import { documentVersions, editorPath, type OutputSoFar, wholePath } from '../../shared/handed'
import type { Heard } from '../../shared/heard'
import { Now } from '../../shared/Now'
import type { Streamed } from '../../shared/thread'
import { usePrinted } from '../../shared/useOutputs'
import { useStreaming } from '../../shared/useStreamed'
import { type RoundBlock, roundsOf } from '../../shared/rounds'
import { kindsOf, type PartsActions, partsOf } from './parts'
import { DocumentPanel, useThreadHost } from '../../shared/ThreadHost'
import { type Outgoing, outgoingOf, takesImages, useAttachments } from '../../shared/useAttachments'
import { pillOf, runIdOf } from '../../shared/running'
import { RunOf } from '../../shared/RunOf'
import { useHelpMeFix } from '../../shared/helpMeFix'
import { Runs } from '../runs/Runs'
import { PushRequestOf } from '../../shared/PushRequestOf'
import { localText } from '../../shared/local'
import { LocalPlace } from '../../shared/LocalPlace'
import { StandInPlace } from '../../shared/StandInPlace'
import { wayOutText } from '../../shared/WayOut'
import { listeningText, listeningOf, useHeard, waitOf } from './behind'
import { ChangesCard } from '../../shared/ChangesCard'
import { DraftCard } from '../../shared/DraftCard'
import { PermissionCalls } from './PermissionCall'
import { reachOf, reachText, ReviewCard, reviewedUnfurl } from './ReviewCard'
import { usePostTeamReviews } from '../settings/usePostTeamReviews'
import { useSendMidTurn } from '../settings/useSendMidTurn'
import { HeldLimit } from './LimitCall'
import { StuckCall } from './StuckCall'
import { coordinatorSigned } from '../../shared/signed'
import { countsDown, StartedOf, type StartedReading, startedBy, startedIn, useStartedBoard } from './Started'
import { outcomeOf } from '../../shared/outcome'
import { TaskThread, workStepText } from './TaskThread'
import { SmallChangeOf } from './SmallChangeOf'
import { ModelMoveOf } from './ModelMoveOf'
import { latestReport, reviewsIn, useReviewOutcomes } from './reviewOutcomes'
import { ConnectPanel } from '../connections/ConnectPanel'
import { serviceOfProduct } from '../connections/ways'
import { reads } from '../../data/reads'
import { hostChoices, PutOnHost, thingOn } from '../../shared/PutOnHost'
import { useServices } from '../../data/services'
import { text as reportText } from '../report/reportWords'
import { BackgroundOutput } from './BackgroundOutput'
import { NoOutputsView } from './NoOutputsView'
import { conflictsOf, hasOutputs, hasOutputsToShow, Outputs } from './Outputs'
import s from './Task.module.css'
import { OpenFinding } from './Reports'
import { useChanges } from './useChanges'
import { useLineComments } from './useLineComments'
import { canHold, ChangeTeam, useTeamed } from '../team/Team'
import { presses, type TaskModel } from './useTask'
import { chooseFace, chosenFaces } from './chosenFaces'
import { PageOpenerProvider, useOpener } from '../browser/opener'
import { Foot } from '../foot/Foot'
import { pages } from '../browser/pages'
import { useCanvasArrivals } from '../canvases/arrivals'
import {
  composerComment,
  cropsOf,
  drop,
  giveBack as giveCommentsBack,
  takeAll,
  useComments,
  withComments,
  canvasCommentsOf,
} from '../../shared/comments'
import { REQUEST, taskGraphOf } from './graph'
import { GraphFace } from './GraphFace'
import { reveal } from './reveal'
import { useSearchReveal } from '../finder/revealSearch'
import { useTaskTitle } from '../../shared/taskTitle'
import { turnsById } from '../../shared/turnTime'
import { ReadFailed } from '../../shared/ReadFailed'
import { pictureOf } from '../../shared/code/FilePicture'

/*
 * A task, with its faces under its header, as in the prototype: the
 * conversation, its thread and the composer that talks to its lead, where
 * the person is while the work happens; its outputs, what it changed, where
 * they decide whether to accept it; and its graph, the steps it went
 * through, once it has any (ADR-054). A ready task opens on its outputs,
 * anything else on the conversation, and the person switches with the
 * header's switch, or c, o and g. The project's bar is over it, so the way
 * around the project is the one its own screen has. What the rules keep for
 * the person arrives as a call at the end of the thread. What it changed
 * opens over the whole window, file by file, from the header, its outputs,
 * or ⌘D. Escape goes back to the project. Everything drawn here is the
 * kit's; this view only arranges it.
 */

/** The task's faces: its conversation, what it made, and the steps it went through. */
export type Face = 'talk' | 'out' | 'graph'

export const text = {
  thread: 'Thread',
  /** Dictation carried once the person leaves the task: whose it is, and putting another thread's here. */
  carriedTo: (task: string) => `To the lead · ${task}`,
  carriedSend: 'Send to the lead',
  carriedTake: 'Move it to this task',
  /** The sentence under a review's header: what its lead can reach. */
  reach: 'What this review’s lead can reach',
  noLead: 'No lead yet',
  lead: 'Lead',
  placeholderBusy: 'Add to the queue, or interrupt the lead',
  placeholderBusySteer: 'Steer the lead, or add to the queue',
  /** Whose usage the composer's ring says, under the context. */
  usageHeading: 'This task',
  placeholder: (lead: string) => (lead === '' ? 'Tell the lead something' : `Tell ${lead} something`),
  needsAgent: 'No agent is signed in. Sign one in from Settings.',
  /** Another agent's model, picked: nothing happens until the person says something. */
  handingOver: (to: string, from: string) => `${to} takes over from ${from} when you send.`,
  /** A conflict with its default branch Althar didn't ask its lead to resolve, and why; the button asks it anyway (ADR-030). */
  conflictUnsent: (why: string) => `Conflicts with its default branch. ${why}`,
  resolveNow: 'Resolve now',
  /** Althar couldn't look for a conflict here, whatever its host says, and why; the button looks again, fetching anew. */
  conflictUnchecked: (why: string) => `Couldn’t check for a conflict with its default branch. ${why}`,
  lookAgain: 'Look again',
  keep: (from: string) => `Keep ${from}`,
  /** What the lead is asked when merging its branch here conflicts: in each repository, the branch it merges into and where. */
  resolve: (conflicts: ReadonlyArray<{ readonly name: string | null; readonly branch: string; readonly files: string }>) => {
    const [only] = conflicts
    if (conflicts.length === 1 && only !== undefined && only.name === null)
      return `${only.branch} has moved on, and merging this task's branch into it conflicts in ${only.files}. Bring the branch up to date: merge ${only.branch} into it, settle each conflict so both sides' changes hold, run the checks, and commit the merge. Merge, don't rebase: a branch that was pushed can't be rewritten. Then say it's ready to merge again.`
    const where = conflicts.map((one) => `in ${one.name ?? 'the repository'}, ${one.branch} conflicts in ${one.files}`).join('; ')
    return `The default branches have moved on, and merging this task's branches into them conflicts: ${where}. Bring each branch up to date: merge its default branch into it, settle each conflict so both sides' changes hold, run the checks, and commit the merge. Merge, don't rebase: a branch that was pushed can't be rewritten. Then say it's ready to merge again.`
  },
  working: 'Working',
  needsYou: 'Needs you',
  waiting: 'Waiting',
  /** A review of someone else's pull request, drafted: the person's to post. */
  drafted: 'Review drafted',
  /** Drafted by the coordinator, its plan not proposed yet: it is off the board until it is. */
  planning: 'Being planned',
  /** A task that isn't a change, its lead done: the person settles it, or keeps it for later. */
  finished: 'Finished',
  kept: 'Kept for later',
  /** Its folder coming back from its branch, and set up again, before its lead goes on (ADR-056). */
  returning: 'Bringing its folder back',
  /** What the composer suggests to a task that finished and isn't a change, in grey: Tab takes it, Enter sends it to its lead. */
  suggest: 'Mark this as done',
  reply: 'Reply',
  /** Issues its lead drafted wait for the person to file. */
  issues: kindWords.issues,
  /** Changes its lead proposed to its issue wait for the person to apply. */
  issueChanges: kindWords.issueChanges,
  fileAll: (count: number) => `File all ${count}`,
  done: 'Done',
  abandoned: 'Abandoned',
  idle: 'Idle',
  faces: { talk: 'Conversation', out: 'Outputs', graph: 'Graph' } satisfies Record<Face, string>,
  facesKbd: { talk: 'c', out: 'o', graph: 'g' } satisfies Record<Face, string>,
  /** Puts the task's page beside its conversation, and takes it away. */
  pageKbd: 'p',
  dismiss: 'Dismiss',
  files: (count: number) => (count === 1 ? '1 file' : `${count} files`),
  reviewDiff: 'Review the changes',
  diffKey: modKey('D'),
}

/**
 * Where a task stands, for its header: the step it is on, by what it does
 * there; a step held for a usage limit says whom it waits for, and until when;
 * one waiting for a free agent, that every agent this computer runs at once is busy;
 * ready, it waits on the person to accept it.
 */
export const statusOf = (
  snapshot: ThreadSnapshot,
  agentName: (id: string) => string = (id) => id,
): { readonly status: TaskStatus; readonly state: string; readonly why?: string } => {
  const { waits, queued, phase, step } = snapshot.task
  // Its plan waits for other tasks: when it starts, as its row in Up next says it (tasks wait for their blockers).
  const after = blockerWords(snapshot.task)
  // In its merge queue as its card on the board is: by the pull request the card shows, not every one of the task's.
  const shown = shownChangeOf(snapshot.task.changes)
  const inQueue = queuedToMerge({ phase, change: shown })
  // Where it stands is its card's, as the board and the home say it (`taskStatusOf`); only the words are the header's own.
  const status = taskStatusOf({ ...snapshot.task, inMergeQueue: inQueue, calls: snapshot.attention.length })
  if (after !== null && snapshot.attention.length === 0) return { status, state: after }
  if (status === TaskStatus.Running && snapshot.task.externalWait !== undefined)
    return { status, state: text.waiting, why: externalWaitWords(snapshot.task.externalWait, clock) }
  // A round of work after its plan is its lead following up, as the person asked (ADR-034).
  const shipAt = snapshot.task.shipping?.at
  const doing =
    step === 'implement' && snapshot.task.followUp === true
      ? stepText.followingUp
      : stepNow(step, shipAt === 'ready' || shipAt === 'merge' ? shipAt : null)
  switch (status) {
    case TaskStatus.Yours: {
      if (snapshot.attention.length > 0) return { status, state: text.needsYou }
      // No call waits, yet the task does: issues its lead drafted wait to be filed, or changes it proposed to its issue to be applied.
      if (phase === 'waiting')
        return {
          status,
          state: snapshot.items.some(
            (item) => item.kind === 'issue_draft' && item.content.state !== 'filed' && item.content.state !== 'discarded',
          )
            ? text.issues
            : text.issueChanges,
        }
      // A review drafted is the person's to post (DEV-96).
      if (snapshot.task.review != null && !isAnswered(snapshot.task.review)) return { status, state: text.drafted }
      // What its review after a merge found: the person's Fix it or Leave it, beside it.
      if (snapshot.task.afterMerge?.state === 'found')
        return { status, state: afterMergeText.sentence(snapshot.task.afterMerge.findings, snapshot.task.afterMerge.words) }
      // Held for Ship: what waits on its branch, and Ship beside it, whatever kind of task it is.
      if (snapshot.task.held !== undefined) return { status, state: shipText.commits(snapshot.task.held.commits) }
      // A task that isn't a change, finished: settling it, or keeping it for later, is the person's.
      if (snapshot.task.kind === 'plain' || snapshot.task.kind === 'review') return { status, state: text.finished }
      // Said as its card on the board says it: a conflict its lead couldn't resolve, commits for a new pull request, a pull request
      // with something in its way. A run that passed review is ready, whatever its lead is doing now: accepting it is the person's.
      return { status, state: readyWordOf({ ...snapshot.task, change: shown }) }
    }
    case TaskStatus.Paused:
      if (waits !== null) return { status, state: waitsWords(agentName(waits.agentId), clock(waits.until), step, waits.left) }
      // Held for the connection, it carries on by itself once it is back (ADR-060).
      if (snapshot.task.reconnects != null) return { status, state: reconnectsWords(snapshot.task.reconnects, clock) }
      // Kept for later: out of Needs you as it is, until the person writes to it or settles it.
      return { status, state: text.kept }
    case TaskStatus.Queued:
      if (queued !== null) return { status, state: queuedWords(queued) }
      // Started Local, it waits for its checkout: another task's there, or the person's changes aren't committed (ADR-096).
      return {
        status,
        state: localText.word,
        ...(snapshot.task.waitsForCheckout == null ? {} : { why: localText.waits(snapshot.task.waitsForCheckout) }),
      }
    case TaskStatus.Done:
      // Abandoned, it says so in place of where it stood, as stopped does.
      return { status, state: snapshot.task.state === 'abandoned' ? text.abandoned : text.done }
    case TaskStatus.Stopped: {
      const by = snapshot.task.stopped?.by
      // Its pull request ready to merge as it is: said beside the word, as what stopped it is not all there is to say.
      const state = snapshot.task.mergeable === true ? stepText.stoppedMergeable : stepText.stopped
      return { status, state, ...(by == null ? {} : { why: stepText.stoppedBy[by] }) }
    }
    case TaskStatus.Running:
      // Accepted, and in its branch's merge queue: its host merges it once the queue's checks pass, so it isn't the person's meanwhile.
      if (inQueue)
        return {
          status,
          state: stepText.now[MERGE_QUEUE_STEP] ?? readyWordOf({ ...snapshot.task, change: shown }),
        }
      // Its folder coming back from its branch, set up again, before anything it was asked goes on (ADR-056).
      if (snapshot.task.folder === 'returning') return { status, state: text.returning }
      // On a step: what it does there, a review while its lead waits included.
      if (doing !== undefined) return { status, state: doing }
      // Drafted by the coordinator, or its plan counting down or held: being planned.
      if (phase === 'drafting' || phase === 'planned' || phase === 'held') return { status, state: text.planning }
      // Its lead's session kept, with no turn running: idle; else at work, between agents, or on its way, as the board says.
      return { status, state: snapshot.session?.held === true && snapshot.session.turnRunning !== true ? text.idle : text.working }
  }
}

/** A task's clock runs while it is under way or waits on the person. */
const ticking = (snapshot: ThreadSnapshot | null) =>
  snapshot !== null && (snapshot.session?.turnRunning === true || snapshot.task.phase === 'running' || snapshot.task.phase === 'waiting')

/**
 * How long a task has run: from its start until now while its clock runs;
 * once ready, until its last step reported; stopped, until the last thing it
 * said; settled, until it settled. Null before it starts.
 */
export const elapsedOf = (snapshot: ThreadSnapshot, now: string): string | null => {
  const { startedAt, settledAt, phase } = snapshot.task
  if (startedAt === null || snapshot.task.externalWait !== undefined) return null
  if (settledAt !== null) return running(startedAt, settledAt)
  if (ticking(snapshot)) return running(startedAt, now)
  const last = phase === 'ready' ? snapshot.items.findLast((item) => item.kind === 'step_result') : snapshot.items.at(-1)
  return running(startedAt, last?.createdAt ?? now)
}

/** How long the step it is on has run, while it runs: what its header's card says beside that step. */
export const tookOf = (snapshot: ThreadSnapshot, now: string): string | null => {
  const { phase, step, stepAt } = snapshot.task
  if (snapshot.task.externalWait !== undefined) return null
  return phase === 'running' && step !== null && stepAt !== null ? running(stepAt, now) : null
}

/**
 * Its plan's steps, for its header, each with who does it: the work its lead,
 * the one on it now or last, and each review the agent its plan names.
 */
export const stepsOf = (
  snapshot: ThreadSnapshot,
  lead: string,
  named: (agentId: string, model: string | null) => string,
): TaskHeaderStep[] => {
  const { steps, step, phase, followUp } = snapshot.task
  const planned = steps.filter((one) => !one.skipped)
  return trackFor(steps, step, phase === 'ready' || phase === 'settled', followUp === true).map((item, at) => {
    const one = planned[at]
    return { ...item, who: one === undefined || one.key === 'implement' ? lead : named(one.agentId, one.model) }
  })
}

/** Whether a key is meant for a field: one pressed in a text box, or with a modifier. */
const typing = (event: KeyboardEvent) => {
  const target = event.target
  return (
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select, [role="textbox"]') !== null))
  )
}

/**
 * The face a task opens on. A call waiting on the person is answered in the
 * conversation, whatever the task is. Otherwise a change that is ready, or
 * merged here with its remote still to have it, opens on what it made: there
 * is something there to accept. Any other task (a quick one, a prototype, a
 * review) has nothing to accept in its outputs, so it opens on its
 * conversation, where its lead's last word, its links and its questions are.
 */
export const openingFace = (snapshot: ThreadSnapshot): Face => {
  const { task } = snapshot
  if (snapshot.attention.length > 0 || (task.kind !== undefined && task.kind !== 'change')) return 'talk'
  return (task.phase === 'ready' && hasOutputs(snapshot)) || task.merged.some((one) => one.ahead > 0) ? 'out' : 'talk'
}

const noLead: ModelInfo = { id: 'none', name: text.noLead, short: text.noLead, runtime: '', efforts: [] }

/** The task's own say on its lead resolving conflicts, as its menu offers it: none goes by the project. */
const conflictsChoice = (own: boolean | null): TaskConflicts => (own === null ? 'project' : own ? 'on' : 'off')

/** How long a title may be, as the runtime keeps it. */
const TITLE_LENGTH = 60

/** The line of a file's first change, where its diff is read: for an editor to open at. */
const firstChange = (view: FileView): number | undefined => {
  if (view.state !== 'ready') return undefined
  for (const line of view.lines) {
    if (line.kind === DiffLineKind.Added) return line.new
    if (line.kind === DiffLineKind.Removed) return line.old
  }
  return undefined
}

/** When each block was written, as the thread says it: from the time it is drawn. */
const agoNow = (iso: string) => ago(iso)

/** What opens a task's thread: what the person asked for, in their words, or the images and files they sent with none. */
const openingOf = (snapshot: ThreadSnapshot): ReadonlyArray<RoundBlock> =>
  (snapshot.task.request === null && snapshot.task.requestPictures === undefined && snapshot.task.requestFiles === undefined) ||
  snapshot.earlier
    ? []
    : [
        {
          kind: 'you' as const,
          id: REQUEST,
          text: snapshot.task.request ?? '',
          at: snapshot.task.startedAt === null ? '' : ago(snapshot.task.startedAt),
          delivery: Delivery.Delivered,
          // A review's thread opens with the pull request it reviews, under what the person asked.
          links: snapshot.task.review == null ? [] : [reviewedUnfurl(snapshot.task.review)],
          // With the images and files they sent with it, as the coordinator's chat shows them.
          pictures: snapshot.task.requestPictures ?? [],
          files: snapshot.task.requestFiles ?? [],
        },
      ]

/** A task the thread says its lead started, for the chip in its place. */
type StartedTask = { readonly threadId: string; readonly title: string }

/** The document open beside the thread, drawn again only as it or its version changes, not as the thread streams. */
const KeptDocumentPanel = memo(DocumentPanel)

/**
 * A task's thread in rounds, drawn again as its lead's words stream, its
 * commands print and its clock ticks (`heard.ts`, `useNow`), and with it the
 * face it is in, which the task draws once (`children`): the rest of the task,
 * its header and composer, isn't. Its rounds are made again as the task's read
 * changes, a word streamed, or a tick: each second while the task's clock runs
 * (`ticking`), else each minute, for how long ago each was said.
 */
function LiveRounds({
  snapshot,
  pending,
  streaming,
  outputs,
  ticking: clockRuns,
  children,
}: {
  readonly snapshot: ThreadSnapshot
  /** What the person sent is on its way. */
  readonly pending: boolean
  readonly streaming: Heard<Streamed>
  readonly outputs: Heard<OutputSoFar>
  readonly ticking: boolean
  readonly children: (rounds: ReadonlyArray<RoundBlock>, versionOf: (whole: string) => string, now: string) => ReactNode
}) {
  const words = useStreaming(streaming, snapshot.items)
  const printed = usePrinted(outputs, snapshot.items)
  const now = useNow(true, clockRuns ? SECOND : MINUTE)
  const rounds = useMemo(() => {
    const { session } = snapshot
    return [
      ...openingOf(snapshot),
      // The thread in rounds: each ask, its lead's acknowledgement, its work in one line, and its result, which ends it (ADR-042).
      ...roundsOf(
        {
          items: snapshot.items,
          turnRunning: session?.turnRunning ?? false,
          turnStarted: session?.turnStartedAt ?? null,
          reading: readingNow(session, pending, snapshot.task.queued !== null || snapshot.task.waits !== null, snapshot.accepting),
          readingLocally: readingLocallyOf(session, snapshot.accepting, snapshot.task.queued !== null || snapshot.task.waits !== null),
          turnEnded: session?.turnEndedAt ?? null,
          // What the person asked for, which opens the thread above, is what the lead's first turn answers.
          openedAt: snapshot.task.request === null || snapshot.earlier ? null : snapshot.task.startedAt,
          worktree: snapshot.task.worktree,
          queue: queueShown(session, pending, snapshot.accepting, snapshot.items),
          outputs: printed,
          turns: turnsById(snapshot.turns),
        },
        words,
        agoNow,
        now,
      ),
    ]
  }, [snapshot, pending, printed, words, now])
  // What each document was last changed by, so one open beside the thread follows its edits: a round folded into its review's line too.
  const versionOf = useMemo(
    () =>
      documentVersions(
        rounds.flatMap((block) => (block.kind === 'round' ? block.parts : block.kind === 'verdict' ? (block.settle?.parts ?? []) : [])),
        snapshot.task.worktree,
      ),
    [rounds, snapshot.task.worktree],
  )
  return children(rounds, versionOf, now)
}

export function TaskView({
  model,
  onBack,
  onRules,
  onSignIn,
  onInstall,
  onConnections,
  onOpenTask,
  aside,
}: {
  model: TaskModel
  /** Back to the project, on Escape. */
  onBack: () => void
  /** Opens its project's rules, from a card the project always asks about. */
  onRules?: () => void
  /** Opens Settings at an agent's sign-in, started, for a lead that is signed out. */
  onSignIn?: (agentId: string) => void
  /** Opens the agent's tab in Settings, where it is installed, for a step whose agent isn't. */
  onInstall?: (agentId: string) => void
  /** Opens the code hosts and trackers in Settings, for one to connect or sign in to again. */
  onConnections?: () => void
  /** Opens another task, by its thread: one this task's lead started, from its thread's line. */
  onOpenTask?: (threadId: string) => void
  /**
   * Shown as an aside, in the coordinator's pane (docs/decisions/tasks.md, "Asides"): its conversation alone, the same
   * composer as here, with `bar` (its own moves) over it, and no header, other faces or keys of its own.
   */
  aside?: { readonly bar: ReactNode; readonly notice?: ReactNode }
}) {
  // What the person writes to the lead, kept by the task while they are elsewhere, as are its images and what they dictate.
  const kept = draftKey.task(model.snapshot?.threadId ?? '')
  // The words themselves are its composer's to show (DraftComposer): a word typed doesn't draw the task again.
  const setDraft = useSetDraft(kept)
  const threadId = model.snapshot?.threadId ?? null
  const voice = useDictation(kept, {
    projectId: model.snapshot?.project.id ?? null,
    to:
      threadId === null || model.snapshot === null
        ? null
        : {
            to: text.carriedTo(model.snapshot.task.title),
            back: { kind: 'task', threadId },
            // Sent from elsewhere only while its lead is on it; otherwise its own composer starts one.
            threadId: model.snapshot.session?.held === true ? threadId : null,
            send: text.carriedSend,
            take: text.carriedTake,
          },
  })
  // "Help me fix it" on a failed run: a prompt for the composer, unsent.
  const helpMe = useHelpMeFix(kept, model.snapshot?.session?.turnRunning ?? false, voice.inputRef)
  const { client, host: servicesHost } = useServices()
  // Images and files to send with what the person says, and which agents take images.
  const images = useAttachments(kept, servicesHost)
  const models = useModels()
  // Whether the person has their team's reviews posted once drafted: what a review's reach says it posts.
  const postsTeamReviews = usePostTeamReviews()?.on === true
  const steers = useSendMidTurn()?.to === 'steer'
  const [pick, setPick] = useState<Choice | null>(null)
  // A model or effort of the lead's own agent, picked and not yet taken by the runtime.
  const [moving, setMoving] = useState<Choice | null>(null)
  // Another agent's model, picked while a lead is on the task: it takes over with what the person says next.
  const [handover, setHandover] = useState<Choice | null>(null)
  // Where its code host is connected, opened beside its outputs once its branch is pushed.
  const [connecting, setConnecting] = useState(false)
  // Tasks the person just stopped this one waiting for: gone from its list at once, until its head is read again.
  const [letGo, setLetGo] = useState<ReadonlySet<string>>(new Set())
  // Its one repository only on this computer: the connection it is being put on from its card, or a host to connect first.
  const [putting, setPutting] = useState<string | null>(null)
  const [connectService, setConnectService] = useState<Service | null>(null)
  const connectionList = useQuery(reads(client).connections()).data ?? null
  // The command its lead left running whose output is shown.
  const [outputOf, setOutputOf] = useState<string | null>(null)
  // Abandoning it asks first, saying what happens to its worktree and branch, and offering to close its pull requests.
  const [abandoning, setAbandoning] = useState(false)
  // Its plan's team, while nothing of it has begun, as its project's board reads it; and its dialog, open.
  const teamed = useTeamed(model.snapshot?.project.id ?? null, model.snapshot?.task.id ?? null)
  const [changingTeam, setChangingTeam] = useState(false)
  // Attaching it to a pull request asks which; then, where its branch isn't based on that one's head, whether to start it there.
  const [attaching, setAttaching] = useState<{
    readonly value: string
    readonly start?: { readonly name: string; readonly source: string; readonly own: number }
  } | null>(null)
  // Abandoned, the pull requests it was to close that are still open, by address, offered again: null until then.
  const [leftOpen, setLeftOpen] = useState<ReadonlyArray<string> | null>(null)
  const endAbandoning = () => {
    setAbandoning(false)
    setLeftOpen(null)
  }
  // Whether its title is a field, from its menu's Rename or from pressing the title.
  const [renaming, setRenaming] = useState(false)
  // The face shown: the one the task's state opened on, read once, so it never moves under the person; then theirs.
  const [face, showFace] = useState<Face | null>(null)
  // Their choice is kept for the task, so opening it again from the board or home doesn't undo it.
  const taskId = model.snapshot?.task.id
  const setFace = useCallback(
    (value: Face) => {
      if (taskId !== undefined) chooseFace(taskId, value)
      showFace(value)
    },
    [taskId],
  )
  // An agent's question waiting is kept to answer it here, whatever else the task is.
  const [asking, setAsking] = useState<string | null | undefined>(undefined)
  // Without one, a permission waiting as it opens takes focus, so Enter answers it; one that comes later takes it only while nothing else has it.
  const [permitting, setPermitting] = useState(false)
  if (face === null && model.snapshot !== null) {
    const question = model.snapshot.attention.find((call) => call.kind === 'question')
    setAsking(question?.id ?? null)
    setPermitting(question === undefined && model.snapshot.attention.some((call) => call.kind === 'permission'))
    // A call waiting is answered in the conversation, ahead of a view picked earlier.
    showFace(model.snapshot.attention.length > 0 ? 'talk' : (chosenFaces.get(model.snapshot.task.id) ?? openingFace(model.snapshot)))
  } else if (permitting && model.snapshot !== null && !model.snapshot.attention.some((call) => call.kind === 'permission')) {
    // Those answered, one that comes later is like any other: it doesn't take focus from what is being typed.
    setPermitting(false)
  }
  const named = useModelNames()
  // What became of each review's findings, for its line in the thread, read again as each step reports.
  const settledOf = useReviewOutcomes(
    model.snapshot?.task.id ?? '',
    reviewsIn(model.snapshot?.items ?? []),
    latestReport(model.snapshot?.items ?? []),
  )
  const editors = useEditors(model.snapshot?.task.id ?? '')
  const editor = editors.main
  // A page beside the conversation (ADR-100): the task's run and the thread's links open there, and the conversation comes to the front for it.
  const showTalk = useCallback(() => setFace('talk'), [setFace])
  const opener = useOpener(taskId ?? null, showTalk)
  const navigate = useNavigate()
  const comments = useComments(kept)
  // The page belongs to the conversation: Outputs and Graph leave it out, and coming back brings it as it was (ADR-100).
  const conversation = face === null || face === 'talk' || (face === 'graph' && (model.snapshot?.task.graph?.length ?? 0) === 0)
  // What the thread's parts open: a picture in the lightbox, a document or a file the lead names, or a page, beside the thread.
  const host = useThreadHost(
    true,
    { threadId: model.snapshot?.threadId ?? null, taskId: model.snapshot?.task.id ?? null },
    taskId === undefined
      ? null
      : {
          owner: taskId,
          kind: 'task',
          draft: kept,
          opener,
          onDock: () => {
            pages.place(taskId, 'tab', { kind: 'task', threadId: model.snapshot?.threadId ?? '', draft: kept })
            void navigate({ to: '/pages/$owner', params: { owner: taskId } })
          },
        },
    conversation,
  )
  // A canvas its lead publishes or opens beside the conversation opens on the workbench as it arrives (ADR-104).
  useCanvasArrivals(model.snapshot?.items, host.openCanvas)
  // Report this, on a stuck step: Report a problem, with this task (DEV-61).
  const { reportProblem } = useServices().host
  const files = model.snapshot?.task.files ?? []
  // What it changed opens on the first file someone wrote, not a lockfile.
  const changes = useChanges(
    model.snapshot?.task.id ?? null,
    (files.find((file) => !isGenerated(file.path)) ?? files[0])?.path ?? null,
    // What the reviews found is placed and read again as the change moves, and as a review or its settling reports.
    [...files.map((file) => `${file.path}:${file.add}:${file.del}`), ...(model.snapshot?.reports ?? []).map((report) => report.id)].join(
      '\n',
    ),
  )
  const turnUndo = useTurnUndo(
    model,
    images,
    (prompt) => setDraft((current) => withQueued(current, prompt)),
    () => voice.inputRef.current,
    changes,
  )
  // ⌘D opens what the task changed, when it changed something. With its modifier, never set off by typing or by voice.
  const { show } = changes
  // The person's comments on its lines (DEV-175): gathered there, sent to the lead in one message, and read back where they are now.
  const lineComments = useLineComments(
    model.snapshot?.task.id ?? null,
    changes.open,
    // A commit moves no line against the base, but its files are no longer uncommitted: a comment it addressed is read again.
    [
      ...files.map((file) => `${file.path}:${file.add}:${file.del}:${file.uncommitted}`),
      ...(model.snapshot?.reports ?? []).map((report) => report.id),
    ].join('\n'),
  )
  const [commentShown, setCommentShown] = useState<string | null>(null)
  const [sendingComments, setSendingComments] = useState(false)
  // A comment's excerpt in the thread opens the diff on it, where the task changed something.
  const canOpenComment = files.length > 0
  const ways = useMemo(
    () => ({
      ...(onRules === undefined ? {} : { onRules }),
      ...(onSignIn === undefined ? {} : { onSignIn }),
      ...(canOpenComment
        ? {
            onOpenComment: (id: string, path: string) => {
              setCommentShown(id)
              show(path)
            },
          }
        : {}),
    }),
    [onRules, onSignIn, canOpenComment, show],
  )
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'd' || !commandDown(event) || event.shiftKey || event.altKey) return
      if (files.length === 0) return
      event.preventDefault()
      show()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [show, files.length])
  // What it changed is read from git as the task opens, and again as its outputs or changes show: the person's own edits too.
  const { readFiles } = model
  const showsTask = face !== null
  const showsOutputs = face === 'out'
  const showsChanges = changes.open
  const showed = useRef({ task: false, outputs: false, changes: false })
  useEffect(() => {
    const was = showed.current
    showed.current = { task: showsTask, outputs: showsOutputs, changes: showsChanges }
    if ((showsTask && !was.task) || (showsOutputs && !was.outputs) || (showsChanges && !was.changes)) readFiles()
  }, [showsTask, showsOutputs, showsChanges, readFiles])
  // Hidden while its screen is kept (`KeptScreens`), it opens again as it shows: a commit made meanwhile with nothing to say so shows.
  useEffect(
    () => () => {
      showed.current = { task: false, outputs: false, changes: false }
    },
    [],
  )
  // c, o and g switch the faces, and Escape goes back to the project: never while typing, or with something else open.
  const open = changes.open || abandoning || attaching !== null
  const hasGraph = (model.snapshot?.task.graph?.length ?? 0) > 0
  const embedded = aside !== undefined
  useEffect(() => {
    // An aside's keys are its project's.
    if (embedded) return
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || typing(event) || open) return
      if (event.key === 'Escape' && event.target === document.body) onBack()
      else if (event.key === text.facesKbd.talk) setFace('talk')
      else if (event.key === text.facesKbd.out) setFace('out')
      else if (event.key === text.facesKbd.graph && hasGraph) setFace('graph')
      else if (event.key === text.pageKbd && taskId !== undefined) {
        // p puts the task's page beside the conversation, its run's where it has none yet; and takes it away again.
        if (pages.where(taskId) === 'beside') pages.hide(taskId)
        else if (pages.state(taskId) !== null) {
          pages.place(taskId, 'beside')
          setFace('talk')
        } else {
          const url = model.snapshot?.task.launches.find((launch) => launch.ended === null && launch.url != null)?.url
          if (url == null) return
          opener.run(url)
        }
      } else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onBack, open, setFace, hasGraph, taskId, opener, model.snapshot?.task.launches, embedded])
  // The Graph face takes the person to a place in the conversation: earlier pages are read from the model as it is then.
  const latest = useRef(model)
  useLayoutEffect(() => {
    latest.current = model
  })
  const showInThread = useCallback(
    (itemId: string | undefined) => {
      setFace('talk')
      if (itemId === undefined) return
      void reveal(itemId, async () => {
        const now = latest.current
        if (now.snapshot?.earlier !== true) return false
        try {
          await now.loadEarlier()
        } catch {
          return false
        }
        return true
      })
    },
    [setFace],
  )
  useSearchReveal(model.snapshot?.threadId, showInThread)
  // The tasks its lead started, as the board has them: a chip where each was started, and a part of its own.
  const board = useStartedBoard(model.snapshot?.project.id, model.snapshot?.task.id, model.snapshot?.started)
  const started = startedBy(board, model.snapshot?.task.id)
  const startedAll = startedIn(board, model.snapshot?.started)
  // A running turn says how long it has worked so far, a task under way how long it has run, and a run of it how long it has been up.
  // Each place that says so ticks by itself (Now, LiveRounds): the task isn't drawn again each second.
  const clockRuns =
    ticking(model.snapshot) ||
    // A task it started that counts down to starting on its own.
    started.some(countsDown) ||
    // While what the person sent is on its way, or the lead starts for it, how long they have waited.
    model.pending ||
    model.snapshot?.session?.state === 'starting' ||
    (model.snapshot?.task.launches.some((launch) => launch.ended === null) ?? false)
  // What its pull request says while the task is open shows on the pill over the composer for a moment.
  const heard = useHeard(model.snapshot?.items ?? null)
  const snapshot = model.snapshot
  // An agent's rename types itself into the title; the person's own shows at once.
  const typedTitle = useTaskTitle(snapshot?.task.id, snapshot?.task.title ?? '')
  if (snapshot === null) {
    return (
      <div className={embedded ? s.aside : s.window}>
        {!embedded && <TitleBar lights="none">{null}</TitleBar>}
        {model.error === null ? (
          <div className={s.reading}>
            <ThreadMeasure>
              <ThreadSkeleton label={pendingText.thread} />
            </ThreadMeasure>
          </div>
        ) : (
          <div className={s.loading}>
            <ReadFailed error={model.error} />
          </div>
        )}
      </div>
    )
  }

  const session = snapshot.session
  // A pick holds only while the task stands as it was made for: one made with no lead on it is spent once a lead is, and one
  // of another agent to take over from the lead once that lead stops. The picker then reads the task as the runtime has it.
  const leadOn = session?.held === true
  if (pick !== null && leadOn) setPick(null)
  if (handover !== null && !leadOn) setHandover(null)
  const agentName = (id: string | null) =>
    model.agents.find((agent) => agent.id === id)?.name ?? (id === session?.agentId ? session.agentName : (id ?? ''))
  // Running or not, the task has its lead: the one on it now, else the last, else the one its plan names.
  // Its model as just picked, or chosen for its next turn, where it is the same agent's: the header says what the picker says.
  const next = session !== null && session.held ? (moving ?? upcomingOn(session)) : null
  const leadModel =
    session !== null && next !== null && next.agentId === session.agentId ? (next.model ?? session.model) : (session?.model ?? null)
  const lead =
    session !== null && session.held
      ? named(session.agentId, leadModel, session.account)
      : snapshot.task.lead === null
        ? noLead
        : named(snapshot.task.lead.agentId, snapshot.task.lead.model, snapshot.task.lead.account)
  const { status, state, why } = statusOf(snapshot, agentName)
  // Its steps as a graph, where the runtime keeps rounds of work for it; without, its face isn't offered.
  const shown: Face = face === null || (face === 'graph' && !hasGraph) ? 'talk' : face
  const busy = session?.turnRunning ?? false
  // A step that waits on the person: its call, not the thread, has the ways on.
  const stuckOpen = snapshot.attention.some((request) => request.kind === 'stuck')
  const queue = queueShown(session, model.pending, snapshot?.accepting, snapshot.items)
  const readingLocally = readingLocallyOf(session, snapshot.accepting, snapshot.task.queued !== null || snapshot.task.waits !== null)
  const listening = listeningOf(snapshot)
  const wait = waitOf(snapshot.task, upNextWords)
  // What its lead left running, and what Althar runs of it itself (ADR-096); a run's output is in its card.
  const left = session?.background ?? []
  // The one whose output shows, by its id: how long each has run is its pill's to say (Now), not read here.
  const outputShown = pillOf(left, snapshot.task.launches, '').find((one) => one.id === outputOf)
  // A review running now, while its lead waits: a line at the thread's end, by who reviews and for how long.
  const reviewer = snapshot.task.steps.find((one) => one.key === 'review' && !one.skipped)
  const reviewingAt = (now: string) =>
    snapshot.task.phase === 'running' && snapshot.task.step === 'review' && !busy && reviewer !== undefined
      ? { model: named(reviewer.agentId, reviewer.model), took: tookOf(snapshot, now) ?? '' }
      : null
  // A file the lead wrote or pointed at opens in the person's editor, as its changes do.
  const openFile = editor === undefined ? undefined : (path: string) => editors.open(editor.id, { path })
  // The document open beside the thread, as the editor opens it: by its whole path inside the task's folder.
  const docSource = host.doc?.source ?? host.doc?.path
  const docInEditor = docSource === undefined ? null : editorPath(docSource, snapshot.task.worktree)
  // A stopped task picks up with its last lead, on its model, while that agent can lead (or before the agents are read); else the agent that last spoke; else the first; with every one signed out, none.
  const lastLead = snapshot.task.lead
  const last = snapshot.items.findLast((item) => item.agentId !== null)?.agentId
  const resume = model.agents.find((agent) => agent.id === last) ?? model.agents[0]
  const canLead = (agentId: string) => !model.agentsKnown || model.agents.some((agent) => agent.id === agentId)
  const chosen: Choice | null =
    pick ??
    (lastLead !== null && canLead(lastLead.agentId)
      ? { agentId: lastLead.agentId, model: lastLead.model, effort: null }
      : resume === undefined
        ? null
        : { agentId: resume.id, model: null, effort: null })
  const waiting = session === null || !session.held || handover?.agentId === session.agentId ? null : handover
  // Its lead changed from its next turn, by the picker, the team dialog or a tool: the picker shows who leads it then, and so does the header.
  const pending: Choice | null = session === null || !session.held ? null : upcomingOn(session)
  // What the person just picked, shown until the runtime has it (or has refused it): at once, before anything is asked of the agent.
  // Handed the task by a usage limit, the lead stands in for the one the task was given, which takes it back at its reset.
  const standIn = session?.held === true && waiting === null && moving === null && pending === null ? (session.standsIn ?? null) : null
  const choice =
    session === null || !session.held
      ? chosen
      : (waiting ?? (moving !== null ? { ...moving, agentId: session.agentId } : null) ?? pending ?? runningOn(session))

  // The agent what the person says goes to: one picked to take over, else the lead on it, else the one it would start; and whether it takes images.
  const receiving = waiting?.agentId ?? (session?.held ? session.agentId : undefined) ?? chosen?.agentId ?? null
  const receiver = { name: agentName(receiving), takes: takesImages(models, receiving) }
  // With no lead working, what the person says starts the one picked, as its first turn; with another agent picked, that one takes over with it.
  const send = (body: string, now: boolean, outgoing?: Outgoing) => {
    setDraft('')
    if (outgoing !== undefined) images.clear()
    // Their comments went with it (taken as it was made, in submit).
    if (session === null || !session.held) return model.send(body, chosen ?? undefined, outgoing)
    if (waiting !== null) {
      setHandover(null)
      return model.handOver(waiting, body, outgoing)
    }
    return now ? model.sendNow(body, outgoing) : model.send(body, undefined, outgoing)
  }
  /**
   * What the composer sends: with its images, unless they can't go yet, when
   * the composer says why and keeps it all. One Althar doesn't take goes
   * back in the composer, words, images and the agent picked to take over.
   */
  const submit = (body: string, now: boolean) => {
    const own = images.take(receiver)
    if (own === null) return
    turnUndo.dismiss()
    // The comments made beside the conversation go after the person's words, their crops after the person's own pictures where pictures go.
    const gathered = takeAll(kept)
    const pictures = receiver.takes !== false
    const crops = pictures ? cropsOf(gathered) : { sent: [], pictures: [] }
    const outgoing: Outgoing = {
      ...own,
      sent: [...own.sent, ...crops.sent],
      pictures: [...own.pictures, ...crops.pictures],
      // Comments on canvases are kept with the message itself, in its command, and nowhere before (ADR-104).
      canvasComments: canvasCommentsOf(gathered),
    }
    const said = withComments(body, gathered, own.sent.length, pictures)
    const picked = waiting
    void send(said, now, outgoing).then((accepted) => {
      if (accepted) return
      setDraft((current) => withQueued(current, body))
      images.giveBack(own)
      giveCommentsBack(kept, gathered)
      if (picked !== null) setHandover(picked)
    })
  }
  // Picking changes nothing that runs: the same agent's model or effort is set for its next turn, another agent waits for what the person says.
  const choose = (next: Choice) => {
    if (session === null || !session.held) return setPick(next)
    if (next.agentId !== session.agentId) return setHandover(next)
    setHandover(null)
    setMoving(next)
    // Taken or not, the thread says what the lead is on from here: the choice shown until then goes, and a refusal is said by the line above the composer.
    // Only the last pick's end takes it away: one made after is still on its way.
    void model.choose(next).then(() => setMoving((now) => (now === next ? null : now)))
  }
  // The comments gathered on the diff go to the lead in one message of their own, the composer left as it is; given back where Althar doesn't take them.
  const sendComments = () => {
    const comments = lineComments.take()
    if (comments.length === 0) return
    const outgoing: Outgoing = { sent: [], pictures: [], files: [], attached: [], comments }
    setSendingComments(true)
    void model.send('', session === null || !session.held ? (chosen ?? undefined) : undefined, outgoing).then((accepted) => {
      setSendingComments(false)
      if (accepted) lineComments.reread()
      else lineComments.giveBack(comments)
    })
  }
  // A queued message goes back in the composer to be changed, and out of the queue, at once. One the lead had already read
  // comes back where it was, the line saying why, and the composer goes back to what it held, unless written in since.
  const edit = (id: string) => {
    const said = queuedOf(snapshot.items, queue, readingLocally).find((message) => message.id === id)
    // One whose images or files wouldn't fit beside those waiting stays in the queue, and the composer says why.
    if (said === undefined || !images.fits(said)) return
    let was: string | null = null
    let put: string | null = null
    // Taken back where the lead had it already: the words, images, files and whether it was dictated, as the composer held them.
    let unrestore: () => void = () => undefined
    const dictatedBefore = draftNow(kept).dictated
    const refused = () => {
      setDraft((current) => (current === put && was !== null ? was : current))
      unrestore()
      setDraftDictated(kept, dictatedBefore)
    }
    if (!model.takeBack(id, refused)) return
    setDraft((current) => {
      was = current
      put = withQueued(current, said.text)
      return put
    })
    if (said.dictated === true) setDraftDictated(kept, true)
    const unimage = images.restore(said)
    // Its comments on the diff wait there again, to be sent with the next; taken off with the rest where it was refused.
    const uncomment = said.comments === undefined ? () => undefined : lineComments.giveBack(said.comments)
    unrestore = () => {
      unimage()
      uncomment()
    }
  }

  // A queued message goes to the lead now, interrupting it, rather than when the lead is done: out of the queue, and said
  // again, at once. One the lead has already read stays as it was; one Althar didn't take goes back in the composer, as one
  // taken back to edit does.
  const sendQueuedNow = (id: string) => {
    const said = queuedOf(snapshot.items, queue, readingLocally).find((message) => message.id === id)
    if (said === undefined) return
    model.sendQueuedNow(id, said.text, outgoingOf(said), () => {
      setDraft((current) => withQueued(current, said.text))
      if (said.dictated === true) setDraftDictated(kept, true)
      images.restore(said)
      // Its comments on the diff wait there again, to be sent with the next.
      if (said.comments !== undefined) lineComments.giveBack(said.comments)
    })
  }

  const issue = snapshot.task.issue
  // Each issue it came from, on any trackers: from a runtime before, its one issue.
  const fromIssues =
    snapshot.task.fromIssues ?? (issue === null ? [] : [{ ...issue, ...(snapshot.task.issuePartOf === true ? { partOf: true } : {}) }])
  // What it can do as a whole, where it stands, as the runtime says: each in its menu only when it applies.
  const can = (action: TaskAction) => snapshot.task.actions.includes(action)
  const { planId } = snapshot.task
  // Its draft pull requests, marked ready from the menu too, while it is under way or ready.
  // The issues its lead drafted that wait to be filed, oldest first: one press files them all.
  const waitingIssues = snapshot.items.flatMap((item) =>
    item.kind === 'issue_draft' && item.content.state === 'pending' ? [item.content.draftId] : [],
  )
  const drafts = snapshot.task.phase === 'settled' ? [] : snapshot.task.changes.filter((one) => one.state === 'open' && one.draft)
  // Its pull requests still open, offered to close as it is abandoned; those left open after, offered again.
  const openChanges = snapshot.task.changes.filter((one) => one.state === 'open')
  const offered = leftOpen === null ? openChanges : openChanges.filter((one) => leftOpen.includes(one.url))
  // Its newest pull request that merged: what a merged task's commits came after.
  const mergedChange = snapshot.task.changes.findLast((one) => one.state === 'merged')
  // A task that finished and isn't a change: Done and Keep for later, beside where it stands; a review only keeps, as it settles
  // once posted; a change that built nothing only takes Done. Anything else is said to its lead. Not while its lead is mid-turn: what it does may still change where it stands.
  const settleable =
    !busy &&
    isSettleable({ kind: snapshot.task.kind ?? 'change', phase: snapshot.task.phase ?? '', nothingBuilt: snapshot.task.nothingBuilt })
  // Done for a plain task, or a review posted and answered since; one with a draft settles as it is posted.
  const done = takesDone({
    kind: snapshot.task.kind ?? 'change',
    reviewing: snapshot.task.review,
    nothingBuilt: snapshot.task.nothingBuilt,
  })
  // Held for Ship, Ship is its one way on, first in the chip; a finished task that isn't a change keeps Done and Keep beside it.
  const held = !busy && snapshot.task.phase === 'ready' ? snapshot.task.held : undefined
  // Keep for later, for any kind that finished, a prototype or a chat ending on its branch too: not one whose pull request is
  // open, or held for Ship, which wait on the person in their own ways.
  const keeps =
    !busy &&
    takesKeep({
      phase: snapshot.task.phase ?? '',
      state: snapshot.task.state,
      pullOpen: snapshot.task.changes.some((one) => one.state === 'open'),
      held: snapshot.task.held,
    })
  // What its review after a merge found: Fix it and Leave it, first in the chip.
  const found = !busy && snapshot.task.afterMerge?.state === 'found' ? snapshot.task.afterMerge : undefined
  const settle =
    settleable || keeps || held !== undefined || found !== undefined ? (
      <SettleWays
        place="header"
        {...(found === undefined
          ? {}
          : {
              onFix: () => void model.fixAfterMerge(),
              fixHint: afterMergeText.fixHint(found.words),
              onLeave: () => void model.leaveAfterMerge(),
              leaveHint: afterMergeText.leaveHint,
            })}
        {...(held === undefined
          ? {}
          : {
              onShip: () => void model.ship(),
              shipHint: shipText.hint(
                held.commits,
                snapshot.task.steps.some((step) => step.key === 'review' && !step.skipped),
              ),
            })}
        {...(settleable && done ? { onDone: () => void model.markDone(), doneHint: boardText.doneHint } : {})}
        {...(keeps ? { onKeep: () => void model.keep(), keepHint: boardText.keepHint } : {})}
        {...(model.doing === doing.ship
          ? { busy: 'ship' as const }
          : model.doing === doing.fixAfterMerge
            ? { busy: 'fix' as const }
            : model.doing === doing.leaveAfterMerge
              ? { busy: 'leave' as const }
              : model.doing === doing.markDone
                ? { busy: 'done' as const }
                : model.doing === doing.keep
                  ? { busy: 'keep' as const }
                  : {})}
      />
    ) : null
  // What it waits for and what waits for it (tasks wait for their blockers): its header's words open them while it waits, and a
  // part of its chip says what waits for it otherwise. One the person stops waiting for goes from the list at once.
  const waitedBy = (snapshot.task.waitedBy ?? []).map((one) => ({
    id: one.taskId,
    title: one.title,
    meta: blockerText.startsOnce,
    ...(onOpenTask === undefined ? {} : { onOpen: () => onOpenTask(one.threadId) }),
  }))
  const waitsList =
    openBlockers(snapshot.task).length === 0
      ? undefined
      : {
          waitsFor: (snapshot.task.waitsFor ?? [])
            .filter((one) => !letGo.has(one.taskId))
            .map((one) => ({
              id: one.taskId,
              title: one.title,
              stands: standsOf(one.stands),
              ...(onOpenTask === undefined ? {} : { onOpen: () => onOpenTask(one.threadId) }),
              onReopen: () => void model.reopenBlocker(one.taskId),
              onStopWaiting: () => {
                setLetGo((was) => new Set([...was, one.taskId]))
                // Read again by then: gone where it went through, back with a line where it didn't.
                void model.stopWaiting(one.taskId).finally(() => setLetGo((was) => new Set([...was].filter((id) => id !== one.taskId))))
              },
            })),
          waitedBy,
          ...(planId === null ? {} : { onStartNow: () => void model.startPlan(planId) }),
        }
  // A change its lead or the coordinator split, before it ships: Keep them together; one its lead's git made: Drop it. Never once
  // it was kept together, dropped, or opened its pull request.
  const settledSteps = new Set(
    snapshot.items.flatMap((item) =>
      item.kind === 'notice' && (item.content.step?.kind === 'joined' || item.content.step?.kind === 'dropped')
        ? [item.content.step.name]
        : [],
    ),
  )
  const stepAction = (step: NonNullable<Extract<ThreadItem, { kind: 'notice' }>['content']['step']>) => {
    if (step.kind !== 'new_change' || step.by === undefined || step.by === 'person' || settledSteps.has(step.name)) return undefined
    if (snapshot.task.phase === 'settled') return undefined
    const shipped = snapshot.task.changes.some((one) => one.change?.name === step.name)
    if (step.by === 'git') return { label: workStepText.dropIt, onPress: () => void model.dropChange(step.name) }
    return shipped ? undefined : { label: workStepText.keepTogether, onPress: () => void model.joinChanges(step.name) }
  }
  const readingAt = (now: string): StartedReading | null =>
    board === null || onOpenTask === undefined ? null : { board, now, agents: model.agents, onOpen: onOpenTask }
  // Its parts, just before the faces: what it changed is in its worktree's, which opens the changes over the window (ADR-097).
  const partsActionsAt = (reading: StartedReading | null): PartsActions => ({
    ...(reading === null || startedAll.length === 0 ? {} : { started: { tasks: startedAll, reading } }),
    seeChanges: () => changes.show(),
    changesKey: text.diffKey,
    ...(snapshot.task.worktree === null || editor === undefined
      ? {}
      : { openInEditor: { name: editor.name, open: () => editors.open(editor.id) } }),
    ...(snapshot.task.phase === 'settled' && snapshot.task.worktree !== null
      ? { removeFolder: () => void client.removeTaskFolder(snapshot.task.id, null) }
      : {}),
    // A running task moves between a worktree and Local, between its lead's turns.
    ...(snapshot.task.phase !== 'settled' && snapshot.task.worktree !== null && snapshot.task.branch !== null
      ? {
          move: (to, consent) => void model.move(to, consent),
          dropMove: () => void model.dropMove(),
          workToward: (branch) => void model.workToward(branch),
        }
      : {}),
    ...(snapshot.task.helpers === undefined ? {} : { stopHelper: (helper: string) => void model.stopHelper(helper) }),
    ...(snapshot.task.lines === undefined ? {} : { shipChange: (change: string) => void model.shipChange(change) }),
    merge: (change, bypassQueue) =>
      change.head === null
        ? undefined
        : void model.accept([{ head: change.head, url: change.url, ...(bypassQueue ? { bypassQueue: true } : {}) }]),
    mergeStanding: model.mergeStanding,
    mergeAwaits: model.mergeAwaits,
    postReview: (draftId) => void model.postReview(draftId),
    stopLaunch: (id) => void model.stopLaunch(id),
    openUrl: (url) => void window.open(url, '_blank'),
    toOutputs: () => setFace('out'),
    askLead: (words) => void model.send(words),
    ...(snapshot.task.changes.length === 0 && snapshot.host?.connected === true ? { openChange: () => void model.openChange() } : {}),
    ...(can('abandon') && snapshot.task.review == null ? { attach: (pullRequest: string) => void model.attach(pullRequest, false) } : {}),
  })
  const partsAt = (now: string) => {
    const partsActions = partsActionsAt(readingAt(now))
    return <TaskParts parts={partsOf(snapshot, partsActions)} kinds={kindsOf(snapshot, partsActions)} />
  }
  // What else it can do is in its menu.
  const actionsAt = (now: string) => (
    <>
      {/* What it built runs with no agent, in its worktree (ADR-044); a review runs nothing of what it reads. */}
      {snapshot.task.worktree !== null && snapshot.task.review == null && (
        <Runs
          projectId={snapshot.project.id}
          project={snapshot.project.name}
          taskId={snapshot.task.id}
          runnables={snapshot.task.runnables}
          launches={snapshot.task.launches}
          now={now}
          onRun={(id) => model.runProject(id)}
          onStop={(id) => void model.stopLaunch(id)}
          onClear={(id) => void model.clearLaunch(id)}
        />
      )}
      <TaskMenu
        // What its work goes into, where it isn't the default branch (ADR-093): first in its menu, out of its bar.
        {...(snapshot.task.toward === undefined ? {} : { toward: snapshot.task.toward })}
        onRename={() => setRenaming(true)}
        {...(can('start') && planId !== null ? { onStartNow: () => void model.startPlan(planId) } : {})}
        {...(teamed !== null && teamed.plan !== null && canHold(teamed) ? { onHold: () => void model.holdPlan(teamed.plan!.id) } : {})}
        {...(teamed === null ? {} : { onChangeTeam: () => setChangingTeam(true) })}
        {...(drafts.length > 0 ? { onMarkReady: () => void model.markAllReady(drafts.map((one) => one.url)) } : {})}
        // A task under way, or drafted, with a worktree, follows a pull request it didn't open, attached by its link (ADR-052); a
        // review reads one only.
        {...(can('abandon') && snapshot.task.phase !== 'settled' && snapshot.task.review == null && snapshot.task.worktree !== null
          ? {
              onAttach: () => {
                model.dismissError()
                setAttaching({ value: '' })
              },
            }
          : {})}
        // A prototype, a chat or a quick task made a change in one move: a reviewer on, and its pull request ending.
        {...(snapshot.task.toChange === true ? { onMakeChange: () => void model.makeChange() } : {})}
        // Its parts kept as a preset, named for it; and a chat moved between Scratch and the board, either way.
        onSavePreset={() => void model.savePreset(snapshot.task.title.slice(0, 40))}
        {...(snapshot.task.phase !== 'settled' &&
        (snapshot.task.scratch === true || (snapshot.task.kind === 'plain' && snapshot.task.changes.length === 0))
          ? {
              shelf: {
                to: snapshot.task.scratch === true ? ('board' as const) : ('scratch' as const),
                onMove: () => void model.shelve(snapshot.task.scratch === true ? null : 'scratch'),
              },
            }
          : {})}
        {...(can('stop') ? { onStop: () => void model.stop() } : {})}
        {...(can('resume') ? { onResume: () => void model.resume() } : {})}
        // A merged task abandons the commits after its pull request, and stays merged: one Abandon, said for what it does.
        {...(can('abandon') || can('leaveOut')
          ? {
              merged: can('leaveOut'),
              onAbandon: () => {
                model.dismissError()
                setAbandoning(true)
              },
            }
          : {})}
        {...(can('reopen') ? { onReopen: () => void model.reopen() } : {})}
        // Whether its lead resolves a conflict unasked, until it settles: as its project says, or otherwise.
        {...(snapshot.task.phase !== 'settled'
          ? {
              conflicts: {
                choice: conflictsChoice(snapshot.task.resolveConflicts.task),
                project: snapshot.task.resolveConflicts.project,
                onChange: (choice: TaskConflicts) => void model.setResolveConflicts(choice === 'project' ? null : choice === 'on'),
              },
              // And whether everything its agents ask is allowed: by its own switch, or its project's.
              allowEverything: {
                on: snapshot.task.allowEverything.task,
                project: snapshot.task.allowEverything.project,
                onChange: (on: boolean) => void model.setAllowEverything(on),
              },
            }
          : {})}
        // Held on by its project, allowing everything opens the project's rules, where it is turned off.
        {...(onRules === undefined ? {} : { onRules })}
        // Its folder opens in the editor files open in, once it has a worktree: a plain task's has no branch, but is there.
        {...(snapshot.task.worktree === null || editor === undefined
          ? {}
          : { onOpen: () => editors.open(editor.id), editor: editor.name, text: { open: openInText.in } })}
      />
    </>
  )

  // A conflict that is the person's (its lead couldn't resolve it, or wasn't asked), or one Althar couldn't look for: why, and what asks again.
  const conflict =
    snapshot.task.handedBack != null
      ? { words: snapshot.task.handedBack, act: text.resolveNow }
      : snapshot.task.conflictUnsent != null
        ? { words: text.conflictUnsent(snapshot.task.conflictUnsent), act: text.resolveNow }
        : snapshot.task.conflictUnchecked != null
          ? { words: text.conflictUnchecked(snapshot.task.conflictUnchecked), act: text.lookAgain }
          : null

  const line: ReactNode =
    waiting !== null ? (
      <>
        {text.handingOver(named(waiting.agentId, waiting.model).name, lead.name)}{' '}
        <LinkButton onClick={() => setHandover(null)}>{text.keep(lead.name)}</LinkButton>
      </>
    ) : (session === null || !session.held) && model.agentsKnown && model.agents.length === 0 ? (
      text.needsAgent
    ) : null

  const composer = (
    <div className={s.composer}>
      <DraftComposer
        draft={kept}
        // What a task that finished and isn't a change is likely told next, for Tab to take; its lead marks it done (settle_task). A
        // review's draft is posted by the person, on it, so nothing is suggested there.
        {...(helpMe.suggestion !== undefined
          ? { suggestion: helpMe.suggestion }
          : settleable && done && !embedded
            ? { suggestion: text.suggest }
            : {})}
        inputRef={voice.inputRef}
        dictation={voice.dictation}
        tray={voice.tray && <DictationTray {...voice.tray} />}
        carried={<CarriedOver here={kept} />}
        // The lines about who answers go on the composer's edge, under the chip, so neither covers the other.
        notice={
          model.error !== null || conflict !== null || line !== null || aside?.notice != null || turnUndo.notice !== null ? (
            <>
              {aside?.notice}
              {turnUndo.notice}
              {model.error !== null && (
                <Problem
                  as="div"
                  className={s.failure}
                  action={
                    <>
                      {model.hostSignedOut && onConnections !== undefined && (
                        <LinkButton onClick={onConnections}>{wayOutText.signIn}</LinkButton>
                      )}
                      <LinkButton onClick={model.dismissError}>{text.dismiss}</LinkButton>
                    </>
                  }
                >
                  {model.error}
                </Problem>
              )}
              {conflict !== null && (
                <div>
                  {conflict.words} <LinkButton onClick={() => void model.resolveConflictsNow()}>{conflict.act}</LinkButton>
                </div>
              )}
              {line !== null && <div>{line}</div>}
            </>
          ) : null
        }
        text={{ sendNowKey: modKey(keys.return) }}
        // What goes on outside the conversation, as one chip over its end: why it waits, what its lead left running, the pull requests it listens to.
        above={
          <>
            {aside?.bar}
            <Now ticking={clockRuns}>
              {(now) => (
                <Behind
                  wait={wait}
                  onStopHeld={(taskId) => {
                    // Stopping what a task left running frees its place.
                    const holder = snapshot.task.queued?.holders?.find((one) => one.taskId === taskId)
                    if (holder?.threadId != null) for (const command of holder.running) void model.stopHolding(holder.threadId, command.id)
                  }}
                  // Behind another in its project's line, it can go first in it from here; what continues keeps its order (ADR-065).
                  {...(snapshot.task.front === true ? { onFront: () => void model.moveToFront() } : {})}
                  processes={pillOf(left, snapshot.task.launches, now)}
                  onStop={(id) => {
                    const run = runIdOf(id)
                    void (run === null ? model.stopBackground(id) : model.stopLaunch(run))
                  }}
                  onDismiss={(id) => void model.clearBackground(id)}
                  onOutput={setOutputOf}
                  // Where it answers opens in the person's browser.
                  onOpenUrl={(id) => {
                    const run = runIdOf(id)
                    const url =
                      run === null
                        ? left.find((command) => command.id === id)?.url
                        : snapshot.task.launches.find((launch) => launch.id === run)?.url
                    // A run's address opens beside the conversation; what the lead left running answers there too.
                    if (url != null) opener.run(url)
                  }}
                  sources={listening}
                  heard={heard}
                  onStopListening={(url) => void model.stopListening(url)}
                  text={listeningText}
                />
              )}
            </Now>
          </>
        }
        onSubmit={(body) => submit(body, false)}
        onSendNow={(body) => submit(body, true)}
        steer={steers}
        {...images.props(receiver)}
        comments={comments.map((comment, index) => composerComment(comment, index + 1))}
        onOpenComment={(id) => {
          if (taskId === undefined) return
          // Pressed, a comment opens again on its page beside the conversation.
          pages.place(taskId, 'beside')
          setFace('talk')
          pages.reopen(taskId, id)
        }}
        onRemoveComment={(id) => drop(kept, id)}
        {...(busy ? { onStopAgent: () => void model.interrupt() } : {})}
        busy={busy}
        queued={queuedOf(snapshot.items, queue, readingLocally)}
        onEditQueued={edit}
        onSendQueuedNow={sendQueuedNow}
        onUnqueue={(id) => void model.takeBack(id)}
        // An aside's is the coordinator's, in a word: its lead is named in the picker.
        placeholder={
          busy ? (steers ? text.placeholderBusySteer : text.placeholderBusy) : embedded ? text.reply : text.placeholder(receiver.name)
        }
        meter={contextMeter(session, named, model.compact, { usage: snapshot.usage, heading: text.usageHeading })}
        // Another agent's model hands the task to that agent.
        picker={
          <>
            {model.agents.length > 0 && choice !== null && (
              <ModelChoice
                owner={text.lead}
                agents={model.agents}
                projectId={snapshot.project.id}
                value={choice}
                onChange={choose}
                {...(teamed === null ? {} : { onTeam: () => setChangingTeam(true) })}
              />
            )}
            {standIn !== null && (
              <StandInPlace
                given={named(standIn.agentId, standIn.model).name}
                until={standIn.until}
                why={standIn.why}
                onPutBack={() => choose({ agentId: standIn.agentId, model: standIn.model, effort: standIn.effort })}
              />
            )}
            {/* Where it works, as Codex says it under its composer: Local, in the person's own checkout (ADR-096). */}
            {snapshot.task.local === true && <LocalPlace path={snapshot.task.worktree} />}
          </>
        }
      />
    </div>
  )

  // A stuck step's call, answered in the conversation or where the Graph face opens it.
  const stuckCall = (request: AttentionRequest) =>
    request.stuck === null ? null : (
      <StuckCall
        key={request.id}
        request={request}
        stuck={request.stuck}
        agents={model.agents}
        agentName={agentName}
        onAnswer={model.answerStuck}
        {...(onSignIn === undefined ? {} : { onSignIn })}
        {...(onInstall === undefined ? {} : { onInstall })}
        {...(onConnections === undefined ? {} : { onConnect: onConnections })}
        {...(reportProblem === undefined
          ? {}
          : {
              onReport: (step: string) =>
                reportProblem({
                  kind: 'failed',
                  taskId: snapshot.task.id,
                  projectId: snapshot.project.id,
                  threadId: snapshot.threadId,
                  what: reportText.stuck(step),
                }),
            })}
      />
    )
  // Permissions waiting, as one stack with Allow all, in the conversation or where the Graph face opens the step asking:
  // there, opened to be answered, it takes focus, so Enter answers it.
  const permissionCalls = (requests: ReadonlyArray<AttentionRequest>, opened = false) => (
    <PermissionCalls
      requests={requests}
      project={snapshot.project.name}
      focusOnMount={opened || permitting || 'idle'}
      onAnswer={model.answer}
      // Out of what the project always asks about: everything on this task allowed, where it isn't yet; or the rules.
      wayOut={{
        ...(snapshot.task.allowEverything.task || snapshot.task.phase === 'settled'
          ? {}
          : { onAllowEverything: () => void model.setAllowEverything(true) }),
        ...(onRules === undefined ? {} : { onRules }),
      }}
    />
  )

  // What opens the thread, over its rounds, and what closes it, under them: drawn by the task, not again as its rounds are.
  // Whether its work ends in a merge: a task that ends with its branch alone merges nothing, unless a pull request is open for it already.
  const merges =
    snapshot.task.state !== 'done' &&
    snapshot.task.state !== 'abandoned' &&
    snapshot.task.kind !== 'plain' &&
    snapshot.task.kind !== 'review' &&
    (snapshot.task.end !== 'none' || snapshot.task.changes.some((one) => one.state === 'open'))
  const opening = (
    <>
      {fromIssues.length > 0 && !snapshot.earlier && (
        <div className={s.issues}>
          {fromIssues.map((issue) => {
            // The task's tie to it names it alone: two trackers may share its key.
            const tie = issue.link ?? `${issue.product}:${issue.ref}`
            return (
              <div key={tie} className={s.issue}>
                {/* A task with a merge says at its issue's foot whether that closes it or leaves it open. */}
                {merges ? (
                  <IssuePart
                    id={issue.key}
                    partOf={issue.partOf === true}
                    onChange={(partOf) => void model.setIssuePart(partOf, issue.link ?? issue.ref)}
                  >
                    <Issue
                      mark={productBrand(issue.product)}
                      source={productName(issue.product)}
                      id={issue.key}
                      tone={issue.product === 'linear' ? 'linear' : 'plain'}
                      title={issue.title}
                      href={issue.url}
                      status={{ state: issueStatus(issue.status.category), label: issue.status.name }}
                      {...(issue.priority === null || issue.priority.level === 'none'
                        ? {}
                        : { priority: { level: issuePriority(issue.priority.level), label: issue.priority.name } })}
                      {...(issue.container === null ? {} : { meta: issue.container })}
                    />
                  </IssuePart>
                ) : (
                  <Issue
                    mark={productBrand(issue.product)}
                    source={productName(issue.product)}
                    id={issue.key}
                    tone={issue.product === 'linear' ? 'linear' : 'plain'}
                    title={issue.title}
                    href={issue.url}
                    status={{ state: issueStatus(issue.status.category), label: issue.status.name }}
                    {...(issue.priority === null || issue.priority.level === 'none'
                      ? {}
                      : { priority: { level: issuePriority(issue.priority.level), label: issue.priority.name } })}
                    {...(issue.container === null ? {} : { meta: issue.container })}
                  />
                )}
              </div>
            )
          })}
        </div>
      )}
      <EarlierTurns
        key={snapshot.threadId}
        earlier={snapshot.earlier}
        load={model.loadEarlier}
        version={snapshot.items}
        loading={model.loadingEarlier}
      />
    </>
  )
  const closing = (
    <>
      {waitingIssues.length > 1 && (
        <div className={s.fileAll}>
          <Button
            variant="signal"
            size="small"
            busy={model.busy.has(presses.fileIssues)}
            onClick={() => void model.fileIssueDrafts(waitingIssues)}
          >
            {text.fileAll(waitingIssues.length)}
          </Button>
        </div>
      )}
      {snapshot.attention.map((request) => (request.kind === 'stuck' && request.stuck !== null ? stuckCall(request) : null))}
      {/* Before a Local task takes the person's checkout: its changes not committed, or a branch of theirs (ADR-096). */}
      {snapshot.attention.map((request) =>
        request.kind === 'checkout' && request.checkout !== undefined ? (
          <CheckoutAsk
            key={request.id}
            repository={request.checkout.repository}
            holdup={request.checkout.holdup}
            files={request.checkout.files}
            branch={request.checkout.branch}
            onAnswer={(answer) => void model.answerCheckout(request.id, answer)}
          />
        ) : null,
      )}
      {/* Held for a usage limit with nothing asked of the person: another model can carry it on now, or it keeps waiting. */}
      {snapshot.task.waits !== null && snapshot.attention.length === 0 && (
        <HeldLimit
          key={`${snapshot.task.waits.agentId}:${snapshot.task.waits.until}`}
          waits={snapshot.task.waits}
          step={snapshot.task.step === 'review' || snapshot.task.step === 'settle' ? snapshot.task.step : 'implement'}
          agents={model.agents}
          agentName={agentName}
          onHandOver={(to) => void model.handOverHeld(to)}
          {...(snapshot.task.step === 'review' ? { onSkip: () => void model.skipReview() } : {})}
        />
      )}
      {permissionCalls(snapshot.attention.filter((request) => request.kind === 'permission'))}
    </>
  )
  // The document open beside the thread opens in the editor from its panel.
  const openDoc = openFile === undefined || docInEditor === null ? undefined : () => openFile(docInEditor)

  // The finding you're on, where it is in the file you're on: an editor opens there.
  const onFinding = changes.findings.find((one) => one.id === changes.finding && one.path === changes.selected)
  const editorLine = onFinding?.line ?? firstChange(changes.view)
  return (
    <PageOpenerProvider value={opener}>
      <OpenFinding.Provider value={changes.showFindings}>
        <MessageMotion
          className={embedded ? s.aside : s.window}
          // What moves a message between the thread and its composer: not a word typed or streamed, nor a second ticking.
          version={[snapshot.items, queue, model.pending, shown]}
        >
          {/* The bar is the header: the way back and which task, then where it stands, its faces and what it opens. */}
          {!embedded && (
            <TitleBar
              lights="none"
              end={
                <Now ticking={clockRuns}>
                  {(now) => {
                    const took = tookOf(snapshot, now)
                    const elapsed = elapsedOf(snapshot, now)
                    return (
                      <TaskHeader
                        title={snapshot.task.title}
                        status={status}
                        state={state}
                        {...(why === undefined ? {} : { why })}
                        // Who does each step: while its plan runs, where it stands says so on hover, the reviewer not being the lead.
                        steps={stepsOf(snapshot, lead.name, (agentId, model) => named(agentId, model).name)}
                        {...(took === null ? {} : { took })}
                        {...(elapsed === null ? {} : { elapsed })}
                        faces={(hasGraph ? (['talk', 'out', 'graph'] as const) : (['talk', 'out'] as const)).map((value) => ({
                          value,
                          label: text.faces[value],
                          kbd: text.facesKbd[value],
                        }))}
                        face={shown}
                        onFace={setFace}
                        // Finished and the person's to settle: Done and Keep for later, inside where it stands; else who waits for it.
                        {...(settle !== null
                          ? { beside: settle }
                          : waitsList === undefined && waitedBy.length > 0
                            ? { beside: <TaskWaitedBy waitedBy={waitedBy} /> }
                            : {})}
                        {...(waitsList === undefined ? {} : { waits: waitsList })}
                        parts={partsAt(now)}
                        actions={actionsAt(now)}
                      />
                    )
                  }}
                </Now>
              }
            >
              <BackCrumb
                to={snapshot.project.name}
                kbd="esc"
                title={snapshot.task.title}
                shown={typedTitle}
                titleLevel={1}
                maxLength={TITLE_LENGTH}
                editing={renaming}
                onEditingChange={setRenaming}
                onRename={(title) => void model.rename(title)}
                onBack={onBack}
              />
            </TitleBar>
          )}
          {/* What a review's lead can reach, in a sentence under the header. */}
          {!embedded && snapshot.task.review != null && (
            <ReachLine className={s.reach} phrases={reachOf(snapshot.task.review, postsTeamReviews)} aria-label={text.reach} />
          )}
          {/* Run it, the person's word: how far to trust the pull request's code, an outside author's asked, the team's at once. */}
          {!embedded && snapshot.task.review != null && snapshot.task.phase !== 'settled' && (
            <div className={s.runIt}>
              {/* Running it, the person takes it back: its copy read only again, and its lead a reader. */}
              {snapshot.task.review.trust !== undefined && (
                <Button size="small" variant="quiet" onClick={() => void model.stopRunning()}>
                  {reachText.stopRunning}
                </Button>
              )}
              {snapshot.task.review.trust === 'full' ? null : snapshot.task.review.outside ? (
                <>
                  {snapshot.task.review.trust === undefined && (
                    <Button size="small" variant="quiet" onClick={() => void model.runIt('safe')}>
                      {reachText.runSafely}
                    </Button>
                  )}
                  <Button size="small" variant="quiet" onClick={() => void model.runIt('full')}>
                    {reachText.trustFully}
                  </Button>
                </>
              ) : (
                <Button size="small" variant="quiet" onClick={() => void model.runIt()}>
                  {reachText.runIt}
                </Button>
              )}
            </div>
          )}
          {!embedded && shown === 'graph' && hasGraph ? (
            <Now ticking={clockRuns}>
              {(now) => {
                const graph = taskGraphOf(snapshot, named, now)
                return (
                  graph !== null && (
                    <GraphFace
                      className={s.graphFace}
                      graph={graph}
                      stuck={stuckCall}
                      permissions={(requests) => permissionCalls(requests, true)}
                      onShow={showInThread}
                      onReview={changes.showFindings}
                      // The composer that says what went wrong is the conversation's: here, the face says it.
                      error={model.error}
                      onDismissError={model.dismissError}
                    />
                  )
                )
              }}
            </Now>
          ) : !embedded && shown === 'out' && !hasOutputsToShow(snapshot) ? (
            <NoOutputsView snapshot={snapshot} lead={lead.name} />
          ) : !embedded && shown === 'out' ? (
            <div
              className={connecting || connectService !== null || host.code !== null ? s.withPanel : s.outputsFace}
              style={host.code !== null && !connecting ? ({ '--panel-width': `${host.bench.width}px` } as CSSProperties) : undefined}
            >
              {/* Its evidence's screenshots open in the lightbox, as the thread's pictures do. */}
              <ThreadShellProvider value={host.shell}>
                <Outputs
                  snapshot={snapshot}
                  pending={model.doing !== null}
                  doing={model.doing}
                  error={model.error}
                  errorMore={model.errorMore}
                  onAccept={(changes) => void model.accept(changes)}
                  onMergeHere={() => void model.mergeHere()}
                  onOpenChange={() => void model.openChange()}
                  ship={model}
                  onPush={(head, url) => void model.push(head, url)}
                  refused={model.refused}
                  onReplace={(head, replaces, url) => void model.replace(head, replaces, url)}
                  // Bringing a pull request's commits in is the lead's: Althar fetches them, and the note says how to merge them.
                  // oxlint-disable-next-line althar/press-at-once -- What the note says is what the fetch found; the card is busy from the press.
                  onBringIn={(url) =>
                    void model.mergeNote(url).then((note) => {
                      if (note !== null) void send(note, false)
                    })
                  }
                  onMarkReady={(url) => void model.markReady(url)}
                  onMarkAllReady={(urls) => void model.markAllReady(urls)}
                  merging={model.merging}
                  mergeRefused={model.mergeRefused}
                  mergeStanding={model.mergeStanding}
                  mergeAwaits={model.mergeAwaits}
                  onPostScreenshots={model.postScreenshots}
                  onOpenFile={changes.show}
                  conflict={model.conflict}
                  onPushHere={() => void model.pushHere()}
                  onPushBranch={() => void model.pushBranch()}
                  onConnect={() => setConnecting(true)}
                  putOnHost={putOnHostOf(snapshot, connectionList, {
                    putting,
                    onPut: (id, connected) => (connected ? setPutting(id) : setConnectService(id as Service)),
                    onEnd: () => setPutting(null),
                  })}
                  // So is a conflict to settle, in words the lead acts on.
                  onResolve={() => {
                    model.dismissConflict()
                    void send(text.resolve(conflictsOf(model.conflict ?? '', snapshot.task.here)), false)
                  }}
                />
              </ThreadShellProvider>
              {connectService !== null ? (
                <ConnectPanel service={connectService} onClose={() => setConnectService(null)} />
              ) : connecting && snapshot.host !== null ? (
                <ConnectPanel service={serviceOfProduct(snapshot.host.product)} onClose={() => setConnecting(false)} />
              ) : (
                // A file a lead's report names, beside it, as beside the thread.
                host.workbench(null)
              )}
            </div>
          ) : (
            // Its rounds are drawn again as its lead's words stream and its clock ticks; the rest of its face is as the task drew it.
            <LiveRounds snapshot={snapshot} pending={model.pending} streaming={model.streaming} outputs={model.outputs} ticking={clockRuns}>
              {(blocks, versionOf, now) => {
                const reading = readingAt(now)
                return (
                  <TaskFace
                    className={s.face}
                    composer={composer}
                    // An aside sits under the conversation bar, which shades the thread scrolled beneath it.
                    under={embedded}
                    // A document the lead wrote, or a file it names, opens beside the thread on its workbench; a document follows its edits.
                    // An aside's, in the coordinator's narrow pane, has no room for one.
                    {...(embedded
                      ? {}
                      : {
                          panel: host.workbench(
                            host.doc && (
                              <KeptDocumentPanel
                                key={host.doc.source ?? host.doc.path ?? host.doc.title}
                                threadId={snapshot.threadId}
                                taskId={snapshot.task.id}
                                worktree={snapshot.task.worktree}
                                doc={host.doc}
                                version={versionOf(wholePath(host.doc.source ?? host.doc.path ?? '', snapshot.task.worktree))}
                                onClose={host.closeDoc}
                                {...(openDoc === undefined ? {} : { onOpen: openDoc })}
                              />
                            ),
                          ),
                          panelWidth: host.bench.width,
                        })}
                  >
                    <Thread label={text.thread} busy={busy}>
                      {opening}
                      <ThreadShellProvider value={host.shell}>
                        <ThreadWaysContext.Provider value={ways}>
                          <TaskThread
                            // An aside is the coordinator's, as its conversation is.
                            {...(embedded ? { signed: coordinatorSigned } : {})}
                            rounds={blocks}
                            gallery={{
                              reportId:
                                [...snapshot.reports, ...snapshot.items]
                                  .filter(
                                    (item) =>
                                      item.kind === 'step_result' && (item.content.step === 'implement' || item.content.step === 'settle'),
                                  )
                                  .sort((a, b) => a.sequence - b.sequence)
                                  .at(-1)?.id ?? '',
                              shots: outcomeOf(snapshot).shots,
                            }}
                            stepAction={stepAction}
                            versionOf={versionOf}
                            settledOf={settledOf}
                            reviewing={reviewingAt(now)}
                            threadId={snapshot.threadId}
                            worktree={snapshot.task.worktree}
                            {...(openFile === undefined ? {} : { openFile })}
                            session={session}
                            retryable={snapshot.retryable}
                            undoable={snapshot.undoable}
                            onUndoFrom={busy || model.pending || model.busy.has(presses.undo) ? undefined : turnUndo.ask}
                            project={snapshot.project.name}
                            // A failed turn is tried again here, unless its step waits on the person, whose call has its ways on.
                            {...(busy || stuckOpen
                              ? {}
                              : { onTryAgain: () => void model.tryAgain(), onCompact: () => void model.compact() })}
                            {...(onSignIn === undefined || stuckOpen ? {} : { onSignIn })}
                            onPassOn={(words) => void model.send(words)}
                            {...(onOpenTask === undefined ? {} : { onOpenTask })}
                            {...(reading === null
                              ? {}
                              : {
                                  started: (task: StartedTask) => (
                                    <StartedOf threadId={task.threadId} title={task.title} reading={reading} />
                                  ),
                                })}
                            onAnswerQuestion={model.answerQuestion}
                            {...(asking == null ? {} : { focusQuestion: asking })}
                            run={(run) => (
                              <RunOf
                                run={run}
                                threadTask={snapshot.task.id}
                                onStop={(id) => void model.stopLaunch(id)}
                                onRunAgain={(_taskId, runnableId) => void model.runProject(runnableId)}
                                onHelp={helpMe.help}
                              />
                            )}
                            // An issue the lead drafted is filed from its card, only when the person says.
                            draft={(draft) => (
                              <DraftCard
                                draft={draft}
                                actions={{
                                  onFile: (draftId) => void model.fileIssueDraft(draftId),
                                  onChange: model.changeIssueDraft,
                                  onDiscard: (draftId) => void model.discardIssueDraft(draftId),
                                  onPrefer: (atOnce) => void model.preferIssueCards(atOnce),
                                }}
                              />
                            )}
                            // Changes to its issue its lead or Althar proposed apply from their card, only when the person says.
                            changes={(changes) => (
                              <ChangesCard
                                changes={changes}
                                actions={{
                                  onApply: (changesId) => void model.applyIssueChanges(changesId),
                                  onDiscard: (changesId) => void model.discardIssueChanges(changesId),
                                  onPrefer: (atOnce) => void model.preferIssueCards(atOnce),
                                }}
                              />
                            )}
                            // A review the lead drafted is posted from its card, only when the person says.
                            review={(draft) => (
                              <ReviewCard
                                draft={draft}
                                actions={{
                                  onChange: model.changeReview,
                                  onPost: (draftId) => void model.postReview(draftId),
                                  onPostFromNow: (draftId, automationId) => void model.postReviewsFromNow(draftId, automationId),
                                  onDiscard: (draftId) => void model.discardReview(draftId),
                                }}
                              />
                            )}
                            // A small change's card: Merge as the header's, and Make it a full task (README section 6).
                            smallChange={(card) => (
                              <SmallChangeOf
                                card={card}
                                named={named}
                                projectId={snapshot.project.id}
                                agents={model.agents}
                                busy={model.busy.has(doing.accept)}
                                onMerge={(change) => void model.accept([change])}
                                {...(card.taskId === snapshot.task.id
                                  ? { changes: snapshot.task.changes, mergeStanding: model.mergeStanding }
                                  : {})}
                                {...(onOpenTask === undefined ? {} : { onOpen: onOpenTask })}
                                onShow={showInThread}
                              />
                            )}
                            // Auto's line on moving the lead to a lighter model, with Keep and Undo (README section 7).
                            modelMove={(move, itemId) => <ModelMoveOf move={move} itemId={itemId} named={named} />}
                            // A push the lead asked for is pushed as the outputs push: up to the head it shows.
                            push={(request, at) => (
                              <PushRequestOf
                                request={request}
                                at={at}
                                {...(lead.name === '' ? {} : { by: lead.name })}
                                pushing={model.busy.has(doing.push(request.url))}
                                onPush={(head, url) => void model.push(head, url)}
                              />
                            )}
                          />
                        </ThreadWaysContext.Provider>
                      </ThreadShellProvider>
                      {closing}
                    </Thread>
                  </TaskFace>
                )
              }}
            </LiveRounds>
          )}
          {host.lightbox}
          {turnUndo.dialog}
          {changingTeam && (
            <ChangeTeam projectId={snapshot.project.id} task={teamed} agents={model.agents} onClose={() => setChangingTeam(false)} />
          )}
          {abandoning && (
            <AbandonTask
              worktree={snapshot.task.worktree === null ? null : shortFolder(snapshot.task.worktree)}
              branch={snapshot.task.branch}
              changes={offered.map((one) => ({
                id: one.url,
                name: `${one.noun} ${one.prefix}${one.number}`,
                host: productName(one.product),
              }))}
              abandoned={leftOpen !== null}
              // Commits that wait for Ship: settling asks first, Ship them or leave them on the branch.
              {...(snapshot.task.held === undefined
                ? {}
                : {
                    held: {
                      commits: snapshot.task.held.commits,
                      onShip: () => {
                        endAbandoning()
                        void model.ship()
                      },
                    },
                  })}
              {...(mergedChange === undefined || !can('leaveOut')
                ? {}
                : {
                    merged: {
                      name: `${mergedChange.short} ${mergedChange.prefix}${mergedChange.number}`,
                      commits: snapshot.task.unshipped?.commits ?? 0,
                    },
                  })}
              busy={model.busy.has(presses.abandon)}
              {...(model.error === null ? {} : { error: model.error })}
              // oxlint-disable-next-line althar/press-at-once -- A dialog the host answers (closing pull requests): it stays open, busy, so a refusal lands in it.
              onAbandon={(choices) =>
                void model
                  .abandon(
                    offered
                      .filter((one) => choices.close.includes(one.url))
                      .map((one) => ({
                        url: one.url,
                        name: `${one.short} ${one.prefix}${one.number}`,
                        deleteBranch: choices.deleteBranch.includes(one.url),
                      })),
                  )
                  .then(({ abandoned, open }) => {
                    // Abandoned, with each it was to close closed: done. One its host wouldn't close stays offered, with why.
                    if (!abandoned) return
                    if (open.length === 0) endAbandoning()
                    else setLeftOpen(open)
                  })
              }
              onClose={endAbandoning}
            />
          )}
          {attaching !== null && (
            <AttachPullRequest
              key={attaching.start === undefined ? 'ask' : 'start'}
              defaultValue={attaching.value}
              {...(attaching.start === undefined
                ? {}
                : {
                    start: attaching.start,
                    onBack: () => {
                      model.dismissError()
                      setAttaching({ value: attaching.value })
                    },
                  })}
              busy={model.busy.has(presses.attach)}
              {...(model.error === null ? {} : { error: model.error })}
              // oxlint-disable-next-line althar/press-at-once -- A dialog the host answers: it stays open, busy, so a refusal lands in it.
              onAttach={(pullRequest, start) =>
                void model.attach(pullRequest, start).then((done) => {
                  if (done === null) return
                  setAttaching(
                    done.kind === 'start' ? { value: pullRequest, start: { name: done.name, source: done.source, own: done.own } } : null,
                  )
                })
              }
              onClose={() => setAttaching(null)}
            />
          )}
          {outputShown !== undefined && threadId !== null && (
            <BackgroundOutput
              threadId={threadId}
              id={outputShown.id}
              name={outputShown.name ?? outputShown.label ?? outputShown.command}
              command={outputShown.command}
              onClose={() => setOutputOf(null)}
            />
          )}
          {changes.open && (
            <ChangeView
              lights="space"
              branch={snapshot.task.branch ?? ''}
              {...(snapshot.task.baseRef === null ? {} : { base: snapshot.task.baseRef.replace(/^origin\//, '') })}
              files={[
                ...files.map((file) => ({ ...file, generated: isGenerated(file.path) })),
                ...changes.untouched
                  .filter((path) => !files.some((file) => file.path === path))
                  .map((path) => ({ path, status: 'modified' as const, add: 0, del: 0, untouched: true })),
                // A refused file can be absent from an older file list, or have been edited back to the task's base.
                ...turnUndo.reviewFiles
                  .filter((path) => !files.some((file) => file.path === path) && !changes.untouched.includes(path))
                  .map((path) => ({ path, status: 'modified' as const, add: 0, del: 0 })),
              ]}
              selected={changes.selected}
              onSelect={changes.select}
              findings={changes.findings}
              finding={changes.finding}
              onFinding={changes.goToFinding}
              comments={lineComments.comments}
              comment={commentShown}
              // Comments are on the task's own change: one settled takes none.
              {...(snapshot.task.phase === 'settled'
                ? {}
                : {
                    onComment: lineComments.add,
                    onEditComment: lineComments.edit,
                    onRemoveComment: lineComments.remove,
                    onSendComments: sendComments,
                    sendingComments,
                  })}
              view={changes.view}
              onRetry={changes.retry}
              onClose={() => {
                setCommentShown(null)
                changes.close()
              }}
              // A markdown file's pictures are read where the task works; a file it links to that isn't in the change opens in the editor.
              markdown={{ image: pictureOf(snapshot.threadId), ...(openFile === undefined ? {} : { open: openFile }) }}
              // An editor opens the task's folder there, at the file and its first change.
              actions={
                <OpenIn
                  taskId={snapshot.task.id}
                  {...(changes.selected === null ? {} : { path: changes.selected })}
                  {...(editorLine === undefined ? {} : { line: editorLine })}
                />
              }
            />
          )}
          {/* The project's runs and terminals, along its foot; a new terminal opens in this task's worktree. */}
          {!embedded && (
            <Foot
              projectId={snapshot.project.id}
              taskId={snapshot.task.id}
              where={snapshot.task.title}
              onHelp={helpMe.help}
              // This task's run again, its card in this thread; another's, from the line.
              onRunAgain={(launch) => launch.taskId === snapshot.task.id && void model.runProject(launch.runnableId ?? null) === undefined}
            />
          )}
        </MessageMotion>
      </OpenFinding.Provider>
    </PageOpenerProvider>
  )
}

/**
 * For a task whose one repository is only on this computer: the hosts it can
 * be put on from its card, those connected by their connection and the rest
 * to connect first, and the form that puts it on the one chosen.
 */
const putOnHostOf = (
  snapshot: ThreadSnapshot,
  list: import('@althar/contracts').ConnectionList | null,
  put: { readonly putting: string | null; readonly onPut: (id: string, connected: boolean) => void; readonly onEnd: () => void },
) => {
  const [only] = snapshot.task.here
  if (snapshot.task.here.length !== 1 || only === undefined || only.remote != null) return undefined
  const { ready, hosts } = hostChoices(list)
  const chosen = ready.find((connection) => connection.id === put.putting)
  return {
    hosts,
    onPut: (id: string) =>
      put.onPut(
        id,
        ready.some((connection) => connection.id === id),
      ),
    putting:
      chosen === undefined ? null : (
        <PutOnHost
          projectId={snapshot.project.id}
          repository={only.repository}
          name={only.name}
          branch={only.branch}
          connection={{ id: chosen.id, name: chosen.name, product: chosen.product, thing: thingOn(serviceOfProduct(chosen.product)) }}
          onDone={put.onEnd}
          onBack={put.onEnd}
        />
      ),
  }
}
