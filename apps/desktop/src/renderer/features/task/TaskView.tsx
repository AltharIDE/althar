import { useCallback, useEffect, useRef, useState } from 'react'

import type { TaskAction, ThreadSnapshot } from '@althar/contracts'
import {
  AbandonTask,
  ChangeView,
  BackCrumb,
  ChromeButton,
  Delivery,
  DiffLineKind,
  type FileView,
  Composer,
  DictationTray,
  Issue,
  TaskActivity,
  LinkButton,
  Listening,
  type ModelInfo,
  Running,
  TaskFace,
  TaskHeader,
  ReachLine,
  type TaskConflicts,
  TaskMenu,
  TaskStatus,
  Finished,
  Thread,
  ThreadDivider,
  ThreadShellProvider,
  ThreadMeasure,
  ThreadSkeleton,
  TitleBar,
} from '@althar/ui'

import { queuedWords, waitsWords } from '../../shared/agents'
import { useModels } from '../../data/models'
import { contextMeter } from '../../shared/ContextMeter'
import { Holders } from '../../shared/Holders'
import { useDictation } from '../../shared/dictation/useDictation'
import { isGenerated } from '../../shared/generated'
import { OpenIn, text as openInText, useEditors } from '../../shared/OpenIn'
import { queuedOf, queueShown, withQueued } from '../../shared/items'
import { ModelChoice } from '../../shared/ModelChoice'
import { pendingText } from '../../shared/Pending'
import { useModelNames } from '../../shared/modelNames'
import { type Choice, runningOn } from '../../shared/models'
import { issuePriority, issueStatus, productBrand, productName } from '../../shared/products'
import { stepNames, stepText, trackFor } from '../../shared/steps'
import { ago, clock, running, useNow } from '../../shared/time'
import { shortFolder } from '../../shared/folders'
import { documentVersions, editorPath, wholePath } from '../../shared/handed'
import { taskEvidence } from '../../shared/evidence'
import { blocksOf } from '../../shared/thread'
import { ThreadBlocks } from '../../shared/ThreadBlocks'
import { DocumentPanel, useThreadHost } from '../../shared/ThreadHost'
import { type Outgoing, takesImages, useImages } from '../../shared/useImages'
import { runningOf } from '../../shared/running'
import { RunOf } from '../../shared/RunOf'
import { PushRequestOf } from '../../shared/PushRequestOf'
import { behindText, listeningOf, useHeard } from './behind'
import { PermissionCalls } from './PermissionCall'
import { reachOf, ReviewCard, reviewedUnfurl } from './ReviewCard'
import { usePostTeamReviews } from '../settings/usePostTeamReviews'
import { StuckCall } from './StuckCall'
import { ConnectPanel } from '../connections/ConnectPanel'
import { serviceOfProduct } from '../connections/ways'
import { NoOutputsView } from './NoOutputsView'
import { conflictsOf, hasOutputs, Outputs } from './Outputs'
import s from './Task.module.css'
import { useChanges } from './useChanges'
import type { TaskModel } from './useTask'
import { chosenFaces } from './chosenFaces'

/*
 * A task, with two faces under its header, as in the prototype: the
 * conversation, its thread and the composer that talks to its lead, where
 * the person is while the work happens; and its outputs, what it changed,
 * where they decide whether to accept it. A ready task opens on its outputs,
 * anything else on the conversation, and the person switches with the
 * header's switch, or c and o. The project's bar is over it, so the way
 * around the project is the one its own screen has. What the rules keep for
 * the person arrives as a call at the end of the thread. What it changed
 * opens over the whole window, file by file, from the header, its outputs,
 * or ⌘D. Escape goes back to the project. Everything drawn here is the
 * kit's; this view only arranges it.
 */

/** The task's faces: its conversation, and what it made. */
type Face = 'talk' | 'out'

export const text = {
  thread: 'Thread',
  /** The sentence under a review's header: what its lead can reach. */
  reach: 'What this review’s lead can reach',
  noLead: 'No lead yet',
  lead: 'Lead',
  placeholderBusy: 'Add to the queue, or interrupt the lead',
  placeholder: (lead: string) => (lead === '' ? 'Tell the lead something' : `Tell ${lead} something`),
  needsAgent: 'No agent is signed in, so nothing can pick this up. Sign one in from Settings; what you send waits for it.',
  handsOver: (agent: string) => `hands the task to ${agent}`,
  /** Another agent's model, picked: nothing happens until the person says something. */
  handingOver: (to: string, from: string) => `${to} takes over from ${from} when you send.`,
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
  ready: 'Ready for you',
  /** A review of someone else's pull request, drafted: the person's to post. */
  drafted: 'Review drafted',
  done: 'Done',
  abandoned: 'Abandoned',
  idle: 'Idle',
  stopped: 'Stopped',
  faces: { talk: 'Conversation', out: 'Outputs' } satisfies Record<Face, string>,
  facesKbd: { talk: 'c', out: 'o' } satisfies Record<Face, string>,
  /** How long it has been on what it is doing now, or since it last changed. */
  since: {
    step: (step: string, took: string) => `${step} · ${took}`,
    waiting: (took: string) => `waiting · ${took}`,
    ready: (ago: string) => `ready · ${ago}`,
    done: (ago: string) => `done · ${ago}`,
    abandoned: (ago: string) => `abandoned · ${ago}`,
    stopped: (ago: string) => `stopped · ${ago}`,
  },
  dismiss: 'Dismiss',
  earlier: 'Earlier in this task',
  showEarlier: 'Show',
  loadingEarlier: 'Showing…',
  files: (count: number) => (count === 1 ? '1 file' : `${count} files`),
  reviewDiff: 'Review the changes',
  diffKey: '⌘D',
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
): { readonly status: TaskStatus; readonly state: string } => {
  if (snapshot.attention.length > 0) return { status: TaskStatus.Yours, state: text.needsYou }
  const { waits, queued, phase, step } = snapshot.task
  if (waits !== null) return { status: TaskStatus.Paused, state: waitsWords(agentName(waits.agentId), clock(waits.until)) }
  if (queued !== null) return { status: TaskStatus.Queued, state: queuedWords(queued) }
  // A round of work after its plan is its lead following up, as the person asked (ADR-034).
  const doing =
    step === null ? undefined : step === 'implement' && snapshot.task.followUp === true ? stepText.followingUp : stepText.now[step]
  if (snapshot.session?.turnRunning === true) return { status: TaskStatus.Running, state: doing ?? text.working }
  // Ready, but its lead couldn't resolve a conflict with its default branch: it needs the person before it can be accepted.
  if (phase === 'ready' && snapshot.task.handedBack != null) return { status: TaskStatus.Yours, state: text.needsYou }
  // A review drafted is the person's to post (DEV-96).
  if (phase === 'ready' && snapshot.task.review != null) return { status: TaskStatus.Yours, state: text.drafted }
  // A run that passed review is ready, whatever its lead is doing now: accepting it is the person's.
  if (phase === 'ready') return { status: TaskStatus.Yours, state: text.ready }
  // Abandoned, it says so in place of where it stood, as stopped does.
  if (phase === 'settled') return { status: TaskStatus.Done, state: snapshot.task.state === 'abandoned' ? text.abandoned : text.done }
  // On a step another agent takes, a review, while its lead waits.
  if (phase === 'running' && doing !== undefined) return { status: TaskStatus.Running, state: doing }
  if (snapshot.session === null) return { status: TaskStatus.Stopped, state: text.stopped }
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

/**
 * Since when a task has been where it stands, for its header's facts: on its
 * step, how long; waiting on the person, how long; ready, done or stopped,
 * how long ago. Nothing for a lead that is idle between steps, or held for a
 * usage limit, which its state already says.
 */
export const sinceOf = (snapshot: ThreadSnapshot, now: string): string | null => {
  const { phase, step, stepAt, settledAt, waits } = snapshot.task
  const [call] = snapshot.attention
  if (call !== undefined) return text.since.waiting(running(call.createdAt, now))
  if (waits !== null) return null
  if (phase === 'settled')
    return settledAt === null
      ? null
      : (snapshot.task.state === 'abandoned' ? text.since.abandoned : text.since.done)(ago(settledAt, new Date(now)))
  if (phase === 'ready' && snapshot.task.handedBack != null) return null
  if (phase === 'ready') {
    const reported = snapshot.items.findLast((item) => item.kind === 'step_result')
    return reported === undefined ? null : text.since.ready(ago(reported.createdAt, new Date(now)))
  }
  if (phase === 'stopped') {
    const last = snapshot.items.at(-1)
    return last === undefined ? null : text.since.stopped(ago(last.createdAt, new Date(now)))
  }
  if (step === null || stepAt === null) return null
  // By the step's name, as its track says it: settling a review is part of the review.
  const [name] = stepNames(
    [{ key: step === 'implement' ? 'implement' : 'review', agentId: '', model: null, skipped: false }],
    snapshot.task.followUp === true,
  )
  return name === undefined ? null : text.since.step(name.toLowerCase(), running(stepAt, now))
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
}: {
  model: TaskModel
  /** Back to the project, on Escape. */
  onBack: () => void
}) {
  const [draft, setDraft] = useState('')
  const voice = useDictation(setDraft, { projectId: model.snapshot?.project.id ?? null })
  // Images to send with what the person says, and which agents take them.
  const images = useImages()
  const models = useModels()
  // Whether the person has their team's reviews posted once drafted: what a review's reach says it posts.
  const postsTeamReviews = usePostTeamReviews()?.on === true
  const [pick, setPick] = useState<Choice | null>(null)
  // Another agent's model, picked while a lead is on the task: it takes over with what the person says next.
  const [handover, setHandover] = useState<Choice | null>(null)
  // Where its code host is connected, opened beside its outputs once its branch is pushed.
  const [connecting, setConnecting] = useState(false)
  // Abandoning it asks first, saying what happens to its worktree and branch.
  const [abandoning, setAbandoning] = useState(false)
  // Whether its title is a field, from its menu's Rename or from pressing the title.
  const [renaming, setRenaming] = useState(false)
  // The face shown: the one the task's state opened on, read once, so it never moves under the person; then theirs.
  const [face, showFace] = useState<Face | null>(null)
  // Their choice is kept for the task, so opening it again from the board or home doesn't undo it.
  const taskId = model.snapshot?.task.id
  const setFace = useCallback(
    (value: Face) => {
      if (taskId !== undefined) chosenFaces.set(taskId, value)
      showFace(value)
    },
    [taskId],
  )
  // An agent's question waiting is kept to answer it here, whatever else the task is.
  const [asking, setAsking] = useState<string | null | undefined>(undefined)
  if (face === null && model.snapshot !== null) {
    setAsking(model.snapshot.attention.find((call) => call.kind === 'question')?.id ?? null)
    // A call waiting is answered in the conversation, ahead of a view picked earlier.
    showFace(model.snapshot.attention.length > 0 ? 'talk' : (chosenFaces.get(model.snapshot.task.id) ?? openingFace(model.snapshot)))
  }
  const named = useModelNames()
  const editors = useEditors(model.snapshot?.task.id ?? '')
  const editor = editors.main
  // What the thread's parts open: a picture in the lightbox, a document beside the thread.
  const host = useThreadHost()
  const files = model.snapshot?.task.files ?? []
  // What it changed opens on the first file someone wrote, not a lockfile.
  const changes = useChanges(model.snapshot?.task.id ?? null, (files.find((file) => !isGenerated(file.path)) ?? files[0])?.path ?? null)
  // ⌘D opens what the task changed, when it changed something. With its modifier, never set off by typing or by voice.
  const { show } = changes
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'd' || !(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return
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
  // c and o switch the faces, and Escape goes back to the project: never while typing, or with something else open.
  const open = changes.open || abandoning
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || typing(event) || open) return
      if (event.key === 'Escape' && event.target === document.body) onBack()
      else if (event.key === text.facesKbd.talk) setFace('talk')
      else if (event.key === text.facesKbd.out) setFace('out')
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onBack, open, setFace])
  // A running turn says how long it has worked so far, a task under way how long it has run, and a run of it how long it has been up.
  const now = useNow(ticking(model.snapshot) || (model.snapshot?.task.launches.some((launch) => launch.ended === null) ?? false))
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
    session !== null
      ? named(session.agentId, session.model, session.account)
      : snapshot.task.lead === null
        ? noLead
        : named(snapshot.task.lead.agentId, snapshot.task.lead.model, snapshot.task.lead.account)
  const { status, state } = statusOf(snapshot, agentName)
  const elapsed = elapsedOf(snapshot, now)
  const since = sinceOf(snapshot, now)
  const shown: Face = face ?? 'talk'
  const busy = session?.turnRunning ?? false
  const queue = queueShown(session, model.pending)
  const listening = listeningOf(snapshot)
  // What its lead left running, and what Althar runs of it itself: one list, each stopped its own way.
  const running = [...(session?.background ?? []), ...snapshot.task.launches]
  const launched = new Set(snapshot.task.launches.map((launch) => launch.id))
  const leftRunning = runningOf(running, now)
  const blocks = [
    // What the person asked for opens the thread, in their words, before anything the lead did.
    ...(snapshot.task.request === null || snapshot.earlier
      ? []
      : [
          {
            kind: 'you' as const,
            id: 'request',
            text: snapshot.task.request,
            at: snapshot.task.startedAt === null ? '' : ago(snapshot.task.startedAt),
            delivery: Delivery.Delivered,
            // A review's thread opens with the pull request it reviews, under what the person asked.
            links: snapshot.task.review == null ? [] : [reviewedUnfurl(snapshot.task.review)],
            pictures: [],
          },
        ]),
    ...blocksOf(
      { items: snapshot.items, turnRunning: busy, worktree: snapshot.task.worktree, queue, outputs: model.outputs },
      model.streaming,
      (iso) => ago(iso),
      now,
    ),
  ]
  // What the task built, as its lead last said it, closes its thread once no step is under way, with what its steps showed gathered under it.
  const finished = taskEvidence(snapshot.items, snapshot.reports)
  const closing = finished.built !== null && !busy && snapshot.task.step === null && snapshot.task.phase !== 'waiting'
  // What each document was last changed by, so one open beside the thread follows its edits.
  const versionOf = documentVersions(
    blocks.flatMap((block) => (block.kind === 'turn' ? block.parts : [])),
    snapshot.task.worktree,
  )
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
  const waiting = session === null || handover?.agentId === session.agentId ? null : handover
  const choice = session === null ? chosen : (waiting ?? runningOn(session))

  // The agent what the person says goes to: one picked to take over, else the lead on it, else the one it would start; and whether it takes images.
  const receiving = waiting?.agentId ?? session?.agentId ?? chosen?.agentId ?? null
  const receiver = { name: agentName(receiving), takes: takesImages(models, receiving) }
  // With no lead working, what the person says starts the one picked, as its first turn; with another agent picked, that one takes over with it.
  const send = (body: string, now: boolean, outgoing?: Outgoing) => {
    setDraft('')
    if (outgoing !== undefined) images.clear()
    if (session === null) return model.send(body, chosen ?? undefined, outgoing)
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
    const outgoing = images.take(receiver)
    if (outgoing === null) return
    const picked = waiting
    void send(body, now, outgoing).then((accepted) => {
      if (accepted) return
      setDraft((current) => withQueued(current, body))
      images.giveBack(outgoing)
      if (picked !== null) setHandover(picked)
    })
  }
  // Picking changes nothing that runs: the same agent's model or effort is set for its next turn, another agent waits for what the person says.
  const choose = (next: Choice) => {
    if (session === null) return setPick(next)
    if (next.agentId !== session.agentId) return setHandover(next)
    setHandover(null)
    void model.choose(next)
  }
  // A queued message goes back in the composer to be changed, and out of the queue, unless the lead has it already.
  const edit = async (id: string) => {
    const said = queuedOf(snapshot.items, queue).find((message) => message.id === id)
    // One whose images wouldn't fit beside those waiting stays in the queue, and the composer says why.
    if (said === undefined || !images.fits(said.pictures)) return
    if (await model.takeBack(id)) {
      setDraft((current) => withQueued(current, said.text))
      images.restore(said.pictures)
    }
  }

  const issue = snapshot.task.issue
  // What it can do as a whole, where it stands, as the runtime says: each in its menu only when it applies.
  const can = (action: TaskAction) => snapshot.task.actions.includes(action)
  const { planId } = snapshot.task
  // Its draft pull requests, marked ready from the menu too, while it is under way or ready.
  const drafts = snapshot.task.phase === 'settled' ? [] : snapshot.task.changes.filter((one) => one.state === 'open' && one.draft)
  const openChange = snapshot.task.changes.find((one) => one.state === 'open')
  // What it changed opens over the window; what else it can do is in its menu.
  const actions = (
    <>
      {files.length > 0 && (
        <ChromeButton
          icon="file"
          label={text.files(files.length)}
          kbd={text.diffKey}
          expanded={changes.open}
          onClick={() => changes.show()}
        />
      )}
      <TaskMenu
        onRename={() => setRenaming(true)}
        // What it built runs with no agent, where its repository says how.
        {...(snapshot.task.runCommand === null ? {} : { run: { command: snapshot.task.runCommand, onRun: () => void model.runProject() } })}
        {...(can('start') && planId !== null ? { onStartNow: () => void model.startPlan(planId) } : {})}
        {...(drafts.length > 0 ? { onMarkReady: () => void model.markAllReady(drafts.map((one) => one.url)) } : {})}
        {...(snapshot.task.skipReview === true ? { onSkipReview: () => void model.skipReview() } : {})}
        {...(can('stop') ? { onStop: () => void model.stop() } : {})}
        {...(can('resume') ? { onResume: () => void model.resume() } : {})}
        {...(can('abandon')
          ? {
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
            }
          : {})}
        // Its folder opens in the editor files open in, once it has a worktree: a plain task's has no branch, but is there.
        {...(snapshot.task.worktree === null || editor === undefined
          ? {}
          : { onOpen: () => editors.open(editor.id), editor: editor.name, text: { open: openInText.in } })}
      />
    </>
  )

  const composer = (
    <div className={s.composer}>
      {model.error !== null && (
        <p className={s.failure} role="alert">
          {model.error} <LinkButton onClick={model.dismissError}>{text.dismiss}</LinkButton>
        </p>
      )}
      {session === null && model.agentsKnown && model.agents.length === 0 && <p className={s.handover}>{text.needsAgent}</p>}
      <Holders holders={snapshot.task.queued?.holders} onStop={(holder, id) => void model.stopHolding(holder, id)} />
      {waiting !== null && (
        <p className={s.handover}>
          {text.handingOver(named(waiting.agentId, waiting.model).name, lead.name)}{' '}
          <LinkButton onClick={() => setHandover(null)}>{text.keep(lead.name)}</LinkButton>
        </p>
      )}
      <Composer
        value={draft}
        onChange={setDraft}
        inputRef={voice.inputRef}
        dictation={voice.dictation}
        tray={voice.tray && <DictationTray {...voice.tray} />}
        // What goes on outside the conversation floats over its end: the pull requests it listens to, and what its lead left running.
        above={
          (listening.length > 0 || leftRunning.length > 0) && (
            <>
              {listening.length > 0 && (
                <Listening sources={listening} heard={heard} onStop={(url) => void model.stopListening(url)} note={behindText.note} />
              )}
              <Running
                processes={leftRunning}
                onStop={(id) => void (launched.has(id) ? model.stopLaunch(id) : model.stopBackground(id))}
                onDismiss={(id) => void (launched.has(id) ? model.clearLaunch(id) : model.clearBackground(id))}
                // Where it answers opens in the person's browser.
                onOpenUrl={(id) => {
                  const url = running.find((command) => command.id === id)?.url
                  if (url != null) window.open(url, '_blank')
                }}
              />
            </>
          )
        }
        onSubmit={(body) => submit(body, false)}
        onSendNow={(body) => submit(body, true)}
        {...images.props(receiver)}
        {...(busy ? { onStopAgent: () => void model.interrupt() } : {})}
        busy={busy}
        queued={queuedOf(snapshot.items, queue)}
        onEditQueued={(id) => void edit(id)}
        onUnqueue={(id) => void model.takeBack(id)}
        placeholder={busy ? text.placeholderBusy : text.placeholder(session?.agentName ?? agentName(chosen?.agentId ?? null))}
        meter={contextMeter(session, named)}
        // Another agent's model hands the task to that agent.
        picker={
          model.agents.length > 0 &&
          choice !== null && (
            <ModelChoice
              owner={text.lead}
              agents={model.agents}
              value={choice}
              onChange={choose}
              // Another agent's model hands the task over, once the person says something.
              {...(session === null ? {} : { handover: { note: text.handsOver, ask: null } })}
            />
          )
        }
      />
    </div>
  )

  return (
    <div className={s.window}>
      {/* The bar is the header: the way back and which task, then where it stands, its faces and what it opens. */}
      <TitleBar
        lights="none"
        end={
          <TaskHeader
            title={snapshot.task.title}
            status={status}
            state={state}
            lead={lead}
            {...(snapshot.task.branch === null ? {} : { branch: snapshot.task.branch })}
            {...(since === null ? {} : { since })}
            {...(elapsed === null ? {} : { elapsed })}
            steps={trackFor(
              snapshot.task.steps,
              snapshot.task.step,
              snapshot.task.phase === 'ready' || snapshot.task.phase === 'settled',
              snapshot.task.followUp === true,
            )}
            faces={(['talk', 'out'] as const).map((value) => ({ value, label: text.faces[value], kbd: text.facesKbd[value] }))}
            face={shown}
            onFace={setFace}
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
      {shown === 'out' && !hasOutputs(snapshot) ? (
        <NoOutputsView snapshot={snapshot} lead={lead.name} />
      ) : shown === 'out' ? (
        <div className={connecting ? s.withPanel : s.outputsFace}>
          {/* Its evidence's screenshots open in the lightbox, as the thread's pictures do. */}
          <ThreadShellProvider value={host.shell}>
            <Outputs
              snapshot={snapshot}
              lead={lead}
              pending={model.pending}
              doing={model.doing}
              error={model.error}
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
              // Sending it back is a note to its lead, which starts it again if it stopped.
              onSendBack={(note) => send(note, false)}
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
          {connecting && snapshot.host !== null && (
            <ConnectPanel service={serviceOfProduct(snapshot.host.product)} onClose={() => setConnecting(false)} />
          )}
        </div>
      ) : (
        <TaskFace
          className={s.face}
          composer={composer}
          // A document the lead wrote opens beside the thread, where the kit puts one, and follows its edits.
          panel={
            host.doc && (
              <DocumentPanel
                key={host.doc.source ?? host.doc.path ?? host.doc.title}
                threadId={snapshot.threadId}
                doc={host.doc}
                version={versionOf(wholePath(host.doc.source ?? host.doc.path ?? '', snapshot.task.worktree))}
                onClose={host.closeDoc}
                {...(openFile === undefined || docInEditor === null ? {} : { onOpen: () => openFile(docInEditor) })}
              />
            )
          }
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
              </div>
            )}
            {snapshot.earlier && (
              <ThreadDivider
                icon="up"
                action={model.loadingEarlier ? text.loadingEarlier : text.showEarlier}
                onAction={() => void model.loadEarlier()}
              >
                {text.earlier}
              </ThreadDivider>
            )}
            <ThreadShellProvider value={host.shell}>
              <ThreadBlocks
                blocks={blocks}
                threadId={snapshot.threadId}
                worktree={snapshot.task.worktree}
                {...(openFile === undefined ? {} : { openFile })}
                gathered={closing}
                session={session}
                project={snapshot.project.name}
                onPassOn={(words) => void model.send(words)}
                onAnswerQuestion={model.answerQuestion}
                {...(asking == null ? {} : { focusQuestion: asking })}
                run={(run) => (
                  <RunOf run={run} now={now} onStop={(id) => void model.stopLaunch(id)} onRunAgain={() => void model.runProject()} />
                )}
                // A review the lead drafted is posted from its card, only when the person says.
                review={(draft) => (
                  <ReviewCard
                    draft={draft}
                    actions={{
                      onChange: model.changeReview,
                      onPost: (draftId) => void model.postReview(draftId),
                      onDiscard: (draftId) => void model.discardReview(draftId),
                    }}
                  />
                )}
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
              {closing && finished.built !== null && (
                <Finished built={finished.built} pieces={finished.pieces} unverified={finished.unverified} />
              )}
            </ThreadShellProvider>
            {snapshot.attention.map((request) =>
              request.kind === 'stuck' && request.stuck !== null ? (
                <StuckCall
                  key={request.id}
                  request={request}
                  stuck={request.stuck}
                  agents={model.agents}
                  agentName={agentName}
                  onAnswer={(attentionId, answer) => void model.answerStuck(attentionId, answer)}
                />
              ) : null,
            )}
            <PermissionCalls
              requests={snapshot.attention.filter((request) => request.kind === 'permission')}
              project={snapshot.project.name}
              onAnswer={model.answer}
            />
          </Thread>
        </TaskFace>
      )}
      {host.lightbox}
      {abandoning && (
        <AbandonTask
          activity={can('stop') ? TaskActivity.Working : can('start') ? TaskActivity.Planned : TaskActivity.Still}
          worktree={snapshot.task.worktree === null ? null : shortFolder(snapshot.task.worktree)}
          branch={snapshot.task.branch}
          {...(openChange === undefined
            ? {}
            : { change: { name: `${openChange.short} ${openChange.prefix}${openChange.number}`, host: productName(openChange.product) } })}
          busy={model.pending}
          {...(model.error === null ? {} : { error: model.error })}
          onAbandon={() => void model.abandon().then((abandoned) => abandoned && setAbandoning(false))}
          onClose={() => setAbandoning(false)}
        />
      )}
      {changes.open && (
        <ChangeView
          lights="space"
          branch={snapshot.task.branch ?? ''}
          {...(snapshot.task.baseRef === null ? {} : { base: snapshot.task.baseRef.replace(/^origin\//, '') })}
          files={files.map((file) => ({ ...file, generated: isGenerated(file.path) }))}
          selected={changes.selected}
          onSelect={changes.select}
          view={changes.view}
          onRetry={changes.retry}
          onClose={changes.close}
          // An editor opens the task's folder there, at the file and its first change.
          actions={
            <OpenIn
              taskId={snapshot.task.id}
              {...(changes.selected === null ? {} : { path: changes.selected })}
              {...(firstChange(changes.view) === undefined ? {} : { line: firstChange(changes.view) })}
            />
          }
        />
      )}
    </div>
  )
}
