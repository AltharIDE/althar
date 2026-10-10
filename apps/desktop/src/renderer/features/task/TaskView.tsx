import { useEffect, useRef, useState } from 'react'

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
  type ModelInfo,
  TaskFace,
  TaskHeader,
  TaskMenu,
  TaskStatus,
  Thread,
  ThreadDivider,
  ThreadMeasure,
  ThreadSkeleton,
  TitleBar,
} from '@althar/ui'

import { waitsWords } from '../../shared/agents'
import { contextMeter } from '../../shared/ContextMeter'
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
import { blocksOf } from '../../shared/thread'
import { ThreadBlocks } from '../../shared/ThreadBlocks'
import { PermissionCalls } from './PermissionCall'
import { StuckCall } from './StuckCall'
import { ConnectPanel } from './ConnectPanel'
import { NoOutputsView } from './NoOutputsView'
import { conflictsOf, hasOutputs, Outputs } from './Outputs'
import s from './Task.module.css'
import { useChanges } from './useChanges'
import type { TaskModel } from './useTask'

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
      return `${only.branch} has moved on, and merging this task's branch into it conflicts in ${only.files}. Bring the branch up to date: merge ${only.branch} into it, settle each conflict so both sides' changes hold, run the checks, and commit the merge. Then say it's ready to merge again.`
    const where = conflicts.map((one) => `in ${one.name ?? 'the repository'}, ${one.branch} conflicts in ${one.files}`).join('; ')
    return `The default branches have moved on, and merging this task's branches into them conflicts: ${where}. Bring each branch up to date: merge its default branch into it, settle each conflict so both sides' changes hold, run the checks, and commit the merge. Then say it's ready to merge again.`
  },
  working: 'Working',
  needsYou: 'Needs you',
  ready: 'Ready for you',
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
 * ready, it waits on the person to accept it.
 */
export const statusOf = (
  snapshot: ThreadSnapshot,
  agentName: (id: string) => string = (id) => id,
): { readonly status: TaskStatus; readonly state: string } => {
  if (snapshot.attention.length > 0) return { status: TaskStatus.Yours, state: text.needsYou }
  const { waits, phase, step } = snapshot.task
  if (waits !== null) return { status: TaskStatus.Paused, state: waitsWords(agentName(waits.agentId), clock(waits.until)) }
  const doing = step === null ? undefined : stepText.now[step]
  if (snapshot.session?.turnRunning === true) return { status: TaskStatus.Running, state: doing ?? text.working }
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
  const [name] = stepNames([{ key: step === 'implement' ? 'implement' : 'review', agentId: '', model: null, skipped: false }])
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

const noLead: ModelInfo = { id: 'none', name: text.noLead, short: text.noLead, runtime: '', efforts: [] }

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
  const [pick, setPick] = useState<Choice | null>(null)
  // Another agent's model, picked while a lead is on the task: it takes over with what the person says next.
  const [handover, setHandover] = useState<Choice | null>(null)
  // Where its code host is connected, opened beside its outputs once its branch is pushed.
  const [connecting, setConnecting] = useState(false)
  // Abandoning it asks first, saying what happens to its worktree and branch.
  const [abandoning, setAbandoning] = useState(false)
  // The face shown: the one the task's state opened on, read once, so it never moves under the person; then theirs.
  const [face, setFace] = useState<Face | null>(null)
  // Ready, or merged here with its remote still to have it, it opens on what it made: there is something there to do.
  if (face === null && model.snapshot !== null)
    setFace(
      (model.snapshot.task.phase === 'ready' && hasOutputs(model.snapshot)) || model.snapshot.task.merged.some((one) => one.ahead > 0)
        ? 'out'
        : 'talk',
    )
  const named = useModelNames()
  const editors = useEditors(model.snapshot?.task.id ?? '')
  const editor = editors.main
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
  }, [onBack, open])
  // A running turn says how long it has worked so far, and a task under way how long it has run.
  const now = useNow(ticking(model.snapshot))
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

  // With no lead working, what the person says starts the one picked, as its first turn; with another agent picked, that one takes over with it.
  const send = (body: string, now: boolean) => {
    setDraft('')
    if (session === null) void model.send(body, chosen ?? undefined)
    else if (waiting !== null) {
      setHandover(null)
      void model.handOver(waiting, body)
    } else void (now ? model.sendNow(body) : model.send(body))
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
    if (said !== undefined && (await model.takeBack(id))) setDraft((current) => withQueued(current, said.text))
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
        {...(can('start') && planId !== null ? { onStartNow: () => void model.startPlan(planId) } : {})}
        {...(drafts.length > 0 ? { onMarkReady: () => void model.markAllReady(drafts.map((one) => one.url)) } : {})}
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
        // Its folder opens in the editor files open in, once it has a worktree.
        {...(snapshot.task.branch === null || editor === undefined
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
        onSubmit={(body) => send(body, false)}
        onSendNow={(body) => send(body, true)}
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
            steps={trackFor(snapshot.task.steps, snapshot.task.step, snapshot.task.phase === 'ready' || snapshot.task.phase === 'settled')}
            faces={(['talk', 'out'] as const).map((value) => ({ value, label: text.faces[value], kbd: text.facesKbd[value] }))}
            face={shown}
            onFace={setFace}
            actions={actions}
          />
        }
      >
        <BackCrumb to={snapshot.project.name} kbd="esc" title={snapshot.task.title} titleLevel={1} onBack={onBack} />
      </TitleBar>
      {shown === 'out' && !hasOutputs(snapshot) ? (
        <NoOutputsView snapshot={snapshot} lead={lead.name} />
      ) : shown === 'out' ? (
        <div className={connecting ? s.withPanel : s.outputsFace}>
          <Outputs
            snapshot={snapshot}
            lead={lead}
            pending={model.pending}
            error={model.error}
            onAccept={(changes) => void model.accept(changes)}
            onMergeHere={() => void model.mergeHere()}
            onOpenChange={() => void model.openChange()}
            onPush={(head, url) => void model.push(head, url)}
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
              send(text.resolve(conflictsOf(model.conflict ?? '', snapshot.task.here)), false)
            }}
          />
          {connecting && <ConnectPanel onClose={() => setConnecting(false)} />}
        </div>
      ) : (
        <TaskFace className={s.face} composer={composer}>
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
            <ThreadBlocks
              blocks={[
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
                        links: [],
                      },
                    ]),
                ...blocksOf(
                  { items: snapshot.items, turnRunning: busy, worktree: snapshot.task.worktree, queue },
                  model.streaming,
                  (iso) => ago(iso),
                  now,
                ),
              ]}
              session={session}
              project={snapshot.project.name}
              onPassOn={(words) => void model.send(words)}
            />
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
              requests={snapshot.attention.filter((request) => request.kind === 'permission' || request.stuck === null)}
              project={snapshot.project.name}
              onAnswer={model.answer}
            />
          </Thread>
        </TaskFace>
      )}
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
