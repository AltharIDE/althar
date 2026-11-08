import { EarlierTurns } from '../../shared/EarlierTurns'
import { ThreadWaysContext } from '../../shared/ThreadBlocks'
import { useNavigate } from '@tanstack/react-router'
import { type CSSProperties, type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import type { AttentionRequest, TaskAction, ThreadSnapshot } from '@althar/contracts'
import {
  CheckoutAsk,
  AbandonTask,
  AttachPullRequest,
  ChangeView,
  BackCrumb,
  Button,
  ChromeButton,
  Delivery,
  DiffLineKind,
  type FileView,
  commandDown,
  Behind,
  Composer,
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
} from '@althar/ui'

import { isAnswered, isSettleable, takesDone } from '../../shared/calls'
import { text as boardText } from '../board/BoardView'
import { doing } from './actions'
import { queuedWords, reconnectsWords, upNextWords, waitsWords } from '../../shared/agents'
import { useModels } from '../../data/models'
import { contextMeter } from '../../shared/ContextMeter'
import { CarriedOver } from '../../shared/dictation/Carried'
import { useDictation } from '../../shared/dictation/useDictation'
import { draftKey, setDraftDictated, useDraft } from '../../shared/drafts'
import { isGenerated } from '../../shared/generated'
import { OpenIn, text as openInText, useEditors } from '../../shared/OpenIn'
import { queuedOf, queueShown, readingNow, withQueued } from '../../shared/items'
import { ModelChoice } from '../../shared/ModelChoice'
import { pendingText } from '../../shared/Pending'
import { useModelNames } from '../../shared/modelNames'
import { type Choice, runningOn } from '../../shared/models'
import { issuePriority, issueStatus, productBrand, productName } from '../../shared/products'
import { readyWordOf } from '../../shared/standing'
import { stepText, trackFor } from '../../shared/steps'
import { inMergeQueue, MERGE_QUEUE_STEP } from '../../data/merges'
import { ago, clock, running, useNow } from '../../shared/time'
import { shortFolder } from '../../shared/folders'
import { documentVersions, editorPath, wholePath } from '../../shared/handed'
import { roundsOf } from '../../shared/rounds'
import { kindsOf, type PartsActions, partsOf } from './parts'
import { DocumentPanel, useThreadHost } from '../../shared/ThreadHost'
import { type Outgoing, outgoingOf, takesImages, useAttachments } from '../../shared/useAttachments'
import { pillOf, runIdOf } from '../../shared/running'
import { RunOf } from '../../shared/RunOf'
import { Runs } from '../runs/Runs'
import { PushRequestOf } from '../../shared/PushRequestOf'
import { localText } from '../../shared/local'
import { LocalPlace } from '../../shared/LocalPlace'
import { wayOutText } from '../../shared/WayOut'
import { listeningText, listeningOf, useHeard, waitOf } from './behind'
import { ChangesCard } from '../../shared/ChangesCard'
import { DraftCard } from '../../shared/DraftCard'
import { PermissionCalls } from './PermissionCall'
import { reachOf, ReviewCard, reviewedUnfurl } from './ReviewCard'
import { usePostTeamReviews } from '../settings/usePostTeamReviews'
import { HeldLimit } from './LimitCall'
import { StuckCall } from './StuckCall'
import { TaskThread } from './TaskThread'
import { SmallChangeOf } from './SmallChangeOf'
import { ModelMoveOf } from './ModelMoveOf'
import { latestReport, reviewsIn, useReviewOutcomes } from './reviewOutcomes'
import { ConnectPanel } from '../connections/ConnectPanel'
import { serviceOfProduct } from '../connections/ways'
import { useServices } from '../../data/services'
import { text as reportText } from '../report/reportWords'
import { BackgroundOutput } from './BackgroundOutput'
import { NoOutputsView } from './NoOutputsView'
import { conflictsOf, hasOutputs, hasOutputsToShow, latestOf, Outputs } from './Outputs'
import s from './Task.module.css'
import { OpenFinding } from './Reports'
import { useChanges } from './useChanges'
import { ChangeTeam, useTeamed } from '../team/Team'
import type { TaskModel } from './useTask'
import { chooseFace, chosenFaces } from './chosenFaces'
import { PageOpenerProvider, useOpener } from '../browser/opener'
import { pages } from '../browser/pages'
import { composerComment, cropsOf, drop, giveBack as giveCommentsBack, takeAll, useComments, withComments } from '../../shared/comments'
import { REQUEST, taskGraphOf } from './graph'
import { GraphFace } from './GraphFace'
import { reveal } from './reveal'

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
  /** Whose usage the composer's ring says, under the context. */
  usageHeading: 'This task so far',
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
  /** Issues its lead drafted wait for the person to file. */
  issues: 'Issues to file',
  /** Changes its lead proposed to its issue wait for the person to apply. */
  issueChanges: 'Issue changes to apply',
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
  if (snapshot.attention.length > 0) return { status: TaskStatus.Yours, state: text.needsYou }
  // No call waits, yet the task does: issues its lead drafted wait to be filed, or changes it proposed to its issue to be applied.
  if (snapshot.task.phase === 'waiting')
    return {
      status: TaskStatus.Yours,
      state: snapshot.items.some(
        (item) => item.kind === 'issue_draft' && item.content.state !== 'filed' && item.content.state !== 'discarded',
      )
        ? text.issues
        : text.issueChanges,
    }
  const { waits, queued, phase, step } = snapshot.task
  if (waits !== null)
    return { status: TaskStatus.Paused, state: waitsWords(agentName(waits.agentId), clock(waits.until), step, waits.left) }
  // Held for the connection, it carries on by itself once it is back (ADR-060).
  if (snapshot.task.reconnects != null) return { status: TaskStatus.Paused, state: reconnectsWords(snapshot.task.reconnects, clock) }
  if (queued !== null) return { status: TaskStatus.Queued, state: queuedWords(queued) }
  // Started Local, it waits for its checkout: another task's there, or the person's changes aren't committed (ADR-096).
  if (snapshot.task.waitsForCheckout != null)
    return { status: TaskStatus.Queued, state: localText.word, why: localText.waits(snapshot.task.waitsForCheckout) }
  // Its folder coming back from its branch, set up again, before anything it was asked goes on (ADR-056).
  if (snapshot.task.folder === 'returning') return { status: TaskStatus.Running, state: text.returning }
  // A round of work after its plan is its lead following up, as the person asked (ADR-034).
  const doing =
    step === null ? undefined : step === 'implement' && snapshot.task.followUp === true ? stepText.followingUp : stepText.now[step]
  if (snapshot.session?.turnRunning === true) return { status: TaskStatus.Running, state: doing ?? text.working }
  // A review drafted is the person's to post (DEV-96).
  if (phase === 'ready' && snapshot.task.review != null && !isAnswered(snapshot.task.review))
    return { status: TaskStatus.Yours, state: text.drafted }
  // A task that isn't a change, finished: settling it, or keeping it for later, is the person's.
  if (phase === 'ready' && (snapshot.task.kind === 'plain' || snapshot.task.kind === 'review'))
    return { status: TaskStatus.Yours, state: text.finished }
  if (phase === 'ready') {
    // Said as its card on the board says it: a conflict its lead couldn't resolve, commits for a new pull request, a pull request
    // with something in its way.
    const ready = readyWordOf(snapshot.task, latestOf(snapshot.task.changes).latest[0] ?? null)
    // Accepted, and in its branch's merge queue: its host merges it once the queue's checks pass, so it isn't the person's meanwhile.
    if (inMergeQueue(snapshot.task.changes)) return { status: TaskStatus.Running, state: stepText.now[MERGE_QUEUE_STEP] ?? ready }
    // A run that passed review is ready, whatever its lead is doing now: accepting it is the person's.
    return { status: TaskStatus.Yours, state: ready }
  }
  // Kept for later: out of Needs you as it is, until the person writes to it or settles it.
  if (phase === 'kept') return { status: TaskStatus.Paused, state: text.kept }
  // Abandoned, it says so in place of where it stood, as stopped does.
  if (phase === 'settled') return { status: TaskStatus.Done, state: snapshot.task.state === 'abandoned' ? text.abandoned : text.done }
  // On a step another agent takes, a review, while its lead waits.
  if (phase === 'running' && doing !== undefined) return { status: TaskStatus.Running, state: doing }
  // Drafted by the coordinator, its plan not proposed yet: under way, nowhere on the board.
  if (phase === 'drafting') return { status: TaskStatus.Running, state: text.planning }
  // Stopped, as its card says, whatever session its lead keeps; and what stopped it, where something says, in the board's words.
  if (phase === 'stopped' || snapshot.session === null || !snapshot.session.held) {
    const by = snapshot.task.stopped?.by
    // Its pull request ready to merge as it is: said beside the word, as what stopped it is not all there is to say.
    const state = snapshot.task.mergeable === true ? stepText.stoppedMergeable : stepText.stopped
    return { status: TaskStatus.Stopped, state, ...(by == null ? {} : { why: stepText.stoppedBy[by] }) }
  }
  return { status: TaskStatus.Running, state: text.idle }
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
  if (startedAt === null) return null
  if (settledAt !== null) return running(startedAt, settledAt)
  if (ticking(snapshot)) return running(startedAt, now)
  const last = phase === 'ready' ? snapshot.items.findLast((item) => item.kind === 'step_result') : snapshot.items.at(-1)
  return running(startedAt, last?.createdAt ?? now)
}

/** How long the step it is on has run, while it runs: what its header's card says beside that step. */
export const tookOf = (snapshot: ThreadSnapshot, now: string): string | null => {
  const { phase, step, stepAt } = snapshot.task
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

export function TaskView({
  model,
  onBack,
  onRules,
  onSignIn,
  onConnections,
  onOpenTask,
}: {
  model: TaskModel
  /** Back to the project, on Escape. */
  onBack: () => void
  /** Opens its project's rules, from a card the project always asks about. */
  onRules?: () => void
  /** Opens Settings at an agent's sign-in, started, for a lead that is signed out. */
  onSignIn?: (agentId: string) => void
  /** Opens the code hosts and trackers in Settings, for one to connect or sign in to again. */
  onConnections?: () => void
  /** Opens another task, by its thread: one this task's lead started, from its thread's line. */
  onOpenTask?: (threadId: string) => void
}) {
  // What the person writes to the lead, kept by the task while they are elsewhere, as are its images and what they dictate.
  const kept = draftKey.task(model.snapshot?.threadId ?? '')
  const [draft, setDraft] = useDraft(kept)
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
  const { client, host: servicesHost } = useServices()
  // Images and files to send with what the person says, and which agents take images.
  const images = useAttachments(kept, servicesHost)
  const models = useModels()
  // Whether the person has their team's reviews posted once drafted: what a review's reach says it posts.
  const postsTeamReviews = usePostTeamReviews()?.on === true
  const [pick, setPick] = useState<Choice | null>(null)
  // Another agent's model, picked while a lead is on the task: it takes over with what the person says next.
  const [handover, setHandover] = useState<Choice | null>(null)
  // Where its code host is connected, opened beside its outputs once its branch is pushed.
  const [connecting, setConnecting] = useState(false)
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
  const ways = useMemo(
    () => ({ ...(onRules === undefined ? {} : { onRules }), ...(onSignIn === undefined ? {} : { onSignIn }) }),
    [onRules, onSignIn],
  )
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
  // ⌘D opens what the task changed, when it changed something. With its modifier, never set off by typing or by voice.
  const { show } = changes
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
  useEffect(() => {
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
  }, [onBack, open, setFace, hasGraph, taskId, opener, model.snapshot?.task.launches])
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
  // A running turn says how long it has worked so far, a task under way how long it has run, and a run of it how long it has been up.
  const now = useNow(
    ticking(model.snapshot) ||
      // While what the person sent is on its way, or the lead starts for it, how long they have waited.
      model.pending ||
      model.snapshot?.session?.state === 'starting' ||
      (model.snapshot?.task.launches.some((launch) => launch.ended === null) ?? false),
  )
  // What its pull request says while the task is open shows on the pill over the composer for a moment.
  const heard = useHeard(model.snapshot?.items ?? null)
  const snapshot = model.snapshot
  if (snapshot === null) {
    return (
      <div className={s.window}>
        <TitleBar lights="none">{null}</TitleBar>
        {model.error === null ? (
          <div className={s.reading}>
            <ThreadMeasure>
              <ThreadSkeleton label={pendingText.thread} />
            </ThreadMeasure>
          </div>
        ) : (
          <div className={s.loading}>
            <p role="alert">{model.error}</p>
          </div>
        )}
      </div>
    )
  }

  const session = snapshot.session
  const agentName = (id: string | null) =>
    model.agents.find((agent) => agent.id === id)?.name ?? (id === session?.agentId ? session.agentName : (id ?? ''))
  // Running or not, the task has its lead: the one on it now, else the last, else the one its plan names.
  const lead =
    session !== null && session.held
      ? named(session.agentId, session.model, session.account)
      : snapshot.task.lead === null
        ? noLead
        : named(snapshot.task.lead.agentId, snapshot.task.lead.model, snapshot.task.lead.account)
  const { status, state, why } = statusOf(snapshot, agentName)
  const elapsed = elapsedOf(snapshot, now)
  const took = tookOf(snapshot, now)
  // Its steps as a graph, where the runtime keeps rounds of work for it; without, its face isn't offered.
  const graph = taskGraphOf(snapshot, named, now)
  const shown: Face = face === null || (face === 'graph' && graph === null) ? 'talk' : face
  const busy = session?.turnRunning ?? false
  // A step that waits on the person: its call, not the thread, has the ways on.
  const stuckOpen = snapshot.attention.some((request) => request.kind === 'stuck')
  const queue = queueShown(session, model.pending)
  const listening = listeningOf(snapshot)
  const wait = waitOf(snapshot.task, upNextWords)
  // What its lead left running, and what Althar runs of it itself (ADR-096); a run's output is in its card.
  const left = session?.background ?? []
  const leftRunning = pillOf(left, snapshot.task.launches, now)
  const outputShown = leftRunning.find((one) => one.id === outputOf)
  const blocks = [
    // What the person asked for opens the thread, in their words, before anything the lead did.
    // Sent with no words, the images and files they sent are what they asked for.
    ...((snapshot.task.request === null && snapshot.task.requestPictures === undefined && snapshot.task.requestFiles === undefined) ||
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
        ]),
    // The thread in rounds: each ask, its lead's acknowledgement, its work in one line, and its result, which ends it (ADR-042).
    ...roundsOf(
      {
        items: snapshot.items,
        turnRunning: busy,
        turnStarted: session?.turnStartedAt ?? null,
        reading: readingNow(session, model.pending, snapshot.task.queued !== null || snapshot.task.waits !== null),
        turnEnded: session?.turnEndedAt ?? null,
        // What the person asked for, which opens the thread above, is what the lead's first turn answers.
        openedAt: snapshot.task.request === null || snapshot.earlier ? null : snapshot.task.startedAt,
        worktree: snapshot.task.worktree,
        queue,
        outputs: model.outputs,
      },
      model.streaming,
      (iso) => ago(iso),
      now,
    ),
  ]
  // What each document was last changed by, so one open beside the thread follows its edits: a round folded into its review's line too.
  const versionOf = documentVersions(
    blocks.flatMap((block) => (block.kind === 'round' ? block.parts : block.kind === 'verdict' ? (block.settle?.parts ?? []) : [])),
    snapshot.task.worktree,
  )
  // A review running now, while its lead waits: a line at the thread's end, by who reviews and for how long.
  const reviewer = snapshot.task.steps.find((one) => one.key === 'review' && !one.skipped)
  const reviewing =
    snapshot.task.phase === 'running' && snapshot.task.step === 'review' && !busy && reviewer !== undefined
      ? { model: named(reviewer.agentId, reviewer.model), took: took ?? '' }
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
  // Its lead changed from its next turn, by the team dialog or a tool: the picker shows who leads it then.
  const upcoming = session?.held === true ? session.nextLead : null
  const pending: Choice | null =
    session === null || upcoming == null
      ? null
      : {
          agentId: upcoming.agentId,
          model: upcoming.model ?? (upcoming.agentId === session.agentId ? session.model : null),
          effort: upcoming.effort ?? (upcoming.agentId === session.agentId ? session.effort : null),
        }
  const choice = session === null || !session.held ? chosen : (waiting ?? pending ?? runningOn(session))

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
    // The comments made beside the conversation go after the person's words, their crops after the person's own pictures where pictures go.
    const gathered = takeAll(kept)
    const pictures = receiver.takes !== false
    const crops = pictures ? cropsOf(gathered) : { sent: [], pictures: [] }
    const outgoing: Outgoing = { ...own, sent: [...own.sent, ...crops.sent], pictures: [...own.pictures, ...crops.pictures] }
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
    void model.choose(next)
  }
  // A queued message goes back in the composer to be changed, and out of the queue, unless the lead has it already.
  const edit = async (id: string) => {
    const said = queuedOf(snapshot.items, queue).find((message) => message.id === id)
    // One whose images or files wouldn't fit beside those waiting stays in the queue, and the composer says why.
    if (said === undefined || !images.fits(said)) return
    if (await model.takeBack(id)) {
      setDraft((current) => withQueued(current, said.text))
      if (said.dictated === true) setDraftDictated(kept, true)
      images.restore(said)
    }
  }

  // A queued message goes to the lead now, interrupting it, rather than when the lead is done: out of the queue, and said again. One the lead has already read stays as it was.
  const sendQueuedNow = async (id: string) => {
    const said = queuedOf(snapshot.items, queue).find((message) => message.id === id)
    if (said === undefined || !(await model.takeBack(id))) return
    if (await model.sendNow(said.text, outgoingOf(said))) return
    // Althar didn't take it: it goes back in the composer, as one taken back to edit does.
    setDraft((current) => withQueued(current, said.text))
    if (said.dictated === true) setDraftDictated(kept, true)
    images.restore(said)
  }

  const issue = snapshot.task.issue
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
  const settle = settleable ? (
    <SettleWays
      place="header"
      {...(done ? { onDone: () => void model.markDone(), doneHint: boardText.doneHint } : {})}
      {...(snapshot.task.phase === 'ready' && snapshot.task.kind !== 'change'
        ? { onKeep: () => void model.keep(), keepHint: boardText.keepHint }
        : {})}
      {...(model.doing === doing.markDone ? { busy: 'done' as const } : model.doing === doing.keep ? { busy: 'keep' as const } : {})}
    />
  ) : null
  // Its parts, just before the faces: what it changed is in its worktree's, which opens the changes over the window (ADR-097).
  const partsActions: PartsActions = {
    seeChanges: () => changes.show(),
    changesKey: text.diffKey,
    ...(snapshot.task.worktree === null || editor === undefined
      ? {}
      : { openInEditor: { name: editor.name, open: () => editors.open(editor.id) } }),
    ...(snapshot.task.phase === 'settled' && snapshot.task.worktree !== null
      ? { removeFolder: () => void client.removeTaskFolder(snapshot.task.id, null) }
      : {}),
    merge: (change) => (change.head === null ? undefined : void model.accept([{ head: change.head, url: change.url }])),
    postReview: (draftId) => void model.postReview(draftId),
    stopLaunch: (id) => void model.stopLaunch(id),
    openUrl: (url) => void window.open(url, '_blank'),
    toOutputs: () => setFace('out'),
    askLead: (words) => void model.send(words),
    ...(snapshot.task.changes.length === 0 && snapshot.host?.connected === true ? { openChange: () => void model.openChange() } : {}),
    ...(can('abandon') && snapshot.task.review == null ? { attach: (pullRequest: string) => void model.attach(pullRequest, false) } : {}),
  }
  const parts = <TaskParts parts={partsOf(snapshot, partsActions)} kinds={kindsOf(snapshot, partsActions)} />
  // What else it can do is in its menu.
  const actions = (
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
          onRun={(id) => void model.runProject(id)}
          onStop={(id) => void model.stopLaunch(id)}
          onClear={(id) => void model.clearLaunch(id)}
        />
      )}
      <TaskMenu
        // What its work goes into, where it isn't the default branch (ADR-093): first in its menu, out of its bar.
        {...(snapshot.task.toward === undefined ? {} : { toward: snapshot.task.toward })}
        onRename={() => setRenaming(true)}
        {...(can('start') && planId !== null ? { onStartNow: () => void model.startPlan(planId) } : {})}
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
        {...(snapshot.task.skipReview === true ? { onSkipReview: () => void model.skipReview() } : {})}
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
      <Composer
        value={draft}
        onChange={setDraft}
        // What a task that finished and isn't a change is likely told next, for Tab to take; its lead marks it done (settle_task). A
        // review's draft is posted by the person, on it, so nothing is suggested there.
        {...(settleable && done ? { suggestion: text.suggest } : {})}
        inputRef={voice.inputRef}
        dictation={voice.dictation}
        tray={voice.tray && <DictationTray {...voice.tray} />}
        carried={<CarriedOver here={kept} />}
        // The lines about who answers go on the composer's edge, under the chip, so neither covers the other.
        notice={
          model.error !== null || conflict !== null || line !== null ? (
            <>
              {model.error !== null && (
                <div className={s.failure} role="alert">
                  {model.error}{' '}
                  {model.hostSignedOut && onConnections !== undefined && (
                    <LinkButton onClick={onConnections}>{wayOutText.signIn}</LinkButton>
                  )}{' '}
                  <LinkButton onClick={model.dismissError}>{text.dismiss}</LinkButton>
                </div>
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
          <Behind
            wait={wait}
            onStopHeld={(taskId) => {
              // Stopping what a task left running frees its place.
              const holder = snapshot.task.queued?.holders?.find((one) => one.taskId === taskId)
              if (holder?.threadId != null) for (const command of holder.running) void model.stopHolding(holder.threadId, command.id)
            }}
            // Behind another in its project's line, it can go first in it from here; what continues keeps its order (ADR-065).
            {...(snapshot.task.front === true ? { onFront: () => void model.moveToFront() } : {})}
            processes={leftRunning}
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
        }
        onSubmit={(body) => submit(body, false)}
        onSendNow={(body) => submit(body, true)}
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
        queued={queuedOf(snapshot.items, queue)}
        onEditQueued={(id) => void edit(id)}
        onSendQueuedNow={(id) => void sendQueuedNow(id)}
        onUnqueue={(id) => void model.takeBack(id)}
        placeholder={busy ? text.placeholderBusy : text.placeholder(receiver.name)}
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

  // The finding you're on, where it is in the file you're on: an editor opens there.
  const onFinding = changes.findings.find((one) => one.id === changes.finding && one.path === changes.selected)
  const editorLine = onFinding?.line ?? firstChange(changes.view)
  return (
    <PageOpenerProvider value={opener}>
      <OpenFinding.Provider value={changes.showFindings}>
        <div className={s.window}>
          {/* The bar is the header: the way back and which task, then where it stands, its faces and what it opens. */}
          <TitleBar
            lights="none"
            end={
              <TaskHeader
                title={snapshot.task.title}
                status={status}
                state={state}
                {...(why === undefined ? {} : { why })}
                // Who does each step: while its plan runs, where it stands says so on hover, the reviewer not being the lead.
                steps={stepsOf(snapshot, lead.name, (agentId, model) => named(agentId, model).name)}
                {...(took === null ? {} : { took })}
                {...(elapsed === null ? {} : { elapsed })}
                faces={(graph === null ? (['talk', 'out'] as const) : (['talk', 'out', 'graph'] as const)).map((value) => ({
                  value,
                  label: text.faces[value],
                  kbd: text.facesKbd[value],
                }))}
                face={shown}
                onFace={setFace}
                // Finished and the person's to settle: Done and Keep for later, inside where it stands.
                {...(settle === null ? {} : { beside: settle })}
                parts={parts}
                actions={actions}
              />
            }
          >
            <BackCrumb
              to={snapshot.project.name}
              kbd="esc"
              title={snapshot.task.title}
              titleLevel={1}
              maxLength={TITLE_LENGTH}
              editing={renaming}
              onEditingChange={setRenaming}
              onRename={(title) => void model.rename(title)}
              onBack={onBack}
            />
          </TitleBar>
          {/* What a review's lead can reach, in a sentence under the header. */}
          {snapshot.task.review != null && (
            <ReachLine className={s.reach} phrases={reachOf(snapshot.task.review, postsTeamReviews)} aria-label={text.reach} />
          )}
          {shown === 'graph' && graph !== null ? (
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
          ) : shown === 'out' && !hasOutputsToShow(snapshot) ? (
            <NoOutputsView snapshot={snapshot} lead={lead.name} />
          ) : shown === 'out' ? (
            <div
              className={connecting || host.code !== null ? s.withPanel : s.outputsFace}
              style={host.code !== null && !connecting ? ({ '--panel-width': `${host.bench.width}px` } as CSSProperties) : undefined}
            >
              {/* Its evidence's screenshots open in the lightbox, as the thread's pictures do. */}
              <ThreadShellProvider value={host.shell}>
                <Outputs
                  snapshot={snapshot}
                  pending={model.pending}
                  doing={model.doing}
                  error={model.error}
                  errorMore={model.errorMore}
                  onAccept={(changes) => void model.accept(changes)}
                  onMergeHere={() => void model.mergeHere()}
                  onOpenChange={() => void model.openChange()}
                  onPush={(head, url) => void model.push(head, url)}
                  refused={model.refused}
                  onReplace={(head, replaces, url) => void model.replace(head, replaces, url)}
                  // Bringing a pull request's commits in is the lead's: Althar fetches them, and the note says how to merge them.
                  onBringIn={(url) =>
                    void model.mergeNote(url).then((note) => {
                      if (note !== null) void send(note, false)
                    })
                  }
                  onMarkReady={(url) => void model.markReady(url)}
                  onMarkAllReady={(urls) => void model.markAllReady(urls)}
                  merging={model.merging}
                  mergeRefused={model.mergeRefused}
                  onPostScreenshots={model.postScreenshots}
                  onOpenFile={changes.show}
                  conflict={model.conflict}
                  onPushHere={() => void model.pushHere()}
                  onPushBranch={() => void model.pushBranch()}
                  onConnect={() => setConnecting(true)}
                  // So is a conflict to settle, in words the lead acts on.
                  onResolve={() => {
                    model.dismissConflict()
                    void send(text.resolve(conflictsOf(model.conflict ?? '', snapshot.task.here)), false)
                  }}
                />
              </ThreadShellProvider>
              {connecting && snapshot.host !== null ? (
                <ConnectPanel service={serviceOfProduct(snapshot.host.product)} onClose={() => setConnecting(false)} />
              ) : (
                // A file a lead's report names, beside it, as beside the thread.
                host.workbench(null)
              )}
            </div>
          ) : (
            <TaskFace
              className={s.face}
              composer={composer}
              // A document the lead wrote, or a file it names, opens beside the thread on its workbench; a document follows its edits.
              panel={host.workbench(
                host.doc && (
                  <DocumentPanel
                    key={host.doc.source ?? host.doc.path ?? host.doc.title}
                    threadId={snapshot.threadId}
                    doc={host.doc}
                    version={versionOf(wholePath(host.doc.source ?? host.doc.path ?? '', snapshot.task.worktree))}
                    onClose={host.closeDoc}
                    {...(openFile === undefined || docInEditor === null ? {} : { onOpen: () => openFile(docInEditor) })}
                  />
                ),
              )}
              panelWidth={host.bench.width}
            >
              <Thread label={text.thread} busy={busy}>
                {issue !== null && !snapshot.earlier && (
                  <div className={s.issue}>
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
                    {/* Whether the task does all of its issue, so its merge closes it, or only part, so its merge leaves it open. */}
                    {snapshot.task.state !== 'done' && snapshot.task.state !== 'abandoned' && (
                      <IssuePart
                        id={issue.key}
                        partOf={snapshot.task.issuePartOf === true}
                        onChange={(partOf) => void model.setIssuePart(partOf)}
                      />
                    )}
                  </div>
                )}
                <EarlierTurns
                  key={snapshot.threadId}
                  earlier={snapshot.earlier}
                  load={model.loadEarlier}
                  version={snapshot.items}
                  loading={model.loadingEarlier}
                />
                <ThreadShellProvider value={host.shell}>
                  <ThreadWaysContext.Provider value={ways}>
                    <TaskThread
                      rounds={blocks}
                      versionOf={versionOf}
                      settledOf={settledOf}
                      reviewing={reviewing}
                      threadId={snapshot.threadId}
                      worktree={snapshot.task.worktree}
                      {...(openFile === undefined ? {} : { openFile })}
                      session={session}
                      retryable={snapshot.retryable}
                      project={snapshot.project.name}
                      // A failed turn is tried again here, unless its step waits on the person, whose call has its ways on.
                      {...(busy || stuckOpen ? {} : { onTryAgain: () => void model.tryAgain(), onCompact: () => void model.compact() })}
                      {...(onSignIn === undefined || stuckOpen ? {} : { onSignIn })}
                      onPassOn={(words) => void model.send(words)}
                      {...(onOpenTask === undefined ? {} : { onOpenTask })}
                      onAnswerQuestion={model.answerQuestion}
                      {...(asking == null ? {} : { focusQuestion: asking })}
                      run={(run) => (
                        <RunOf
                          run={run}
                          now={now}
                          onStop={(id) => void model.stopLaunch(id)}
                          onRunAgain={(_taskId, runnableId) => void model.runProject(runnableId)}
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
                          busy={model.pending}
                          onMerge={(change) => void model.accept([change])}
                          {...(onOpenTask === undefined ? {} : { onOpen: onOpenTask })}
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
                          pushing={model.pending}
                          onPush={(head, url) => void model.push(head, url)}
                        />
                      )}
                    />
                  </ThreadWaysContext.Provider>
                </ThreadShellProvider>
                {waitingIssues.length > 1 && (
                  <div className={s.fileAll}>
                    <Button
                      variant="signal"
                      size="small"
                      busy={model.pending}
                      onClick={() =>
                        void (async () => {
                          for (const draftId of waitingIssues) await model.fileIssueDraft(draftId)
                        })()
                      }
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
              </Thread>
            </TaskFace>
          )}
          {host.lightbox}
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
              {...(mergedChange === undefined || !can('leaveOut')
                ? {}
                : {
                    merged: {
                      name: `${mergedChange.short} ${mergedChange.prefix}${mergedChange.number}`,
                      commits: snapshot.task.unshipped?.commits ?? 0,
                    },
                  })}
              busy={model.pending}
              {...(model.error === null ? {} : { error: model.error })}
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
              busy={model.pending}
              {...(model.error === null ? {} : { error: model.error })}
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
              ]}
              selected={changes.selected}
              onSelect={changes.select}
              findings={changes.findings}
              finding={changes.finding}
              onFinding={changes.goToFinding}
              view={changes.view}
              onRetry={changes.retry}
              onClose={changes.close}
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
        </div>
      </OpenFinding.Provider>
    </PageOpenerProvider>
  )
}
