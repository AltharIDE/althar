import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'

import type { ThreadSnapshot } from '@althar/contracts'
import {
  ChangeView,
  ChromeButton,
  Composer,
  Issue,
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

import { useModels } from '../../data/models'
import { modelInfo, waitsWords } from '../../shared/agents'
import { contextMeter } from '../../shared/ContextMeter'
import { queuedOf, queueShown, withQueued } from '../../shared/items'
import { ModelChoice } from '../../shared/ModelChoice'
import { pendingText } from '../../shared/Pending'
import { catalogOf, type Choice, modelName, runningOn } from '../../shared/models'
import { issuePriority, issueStatus, productBrand, productName } from '../../shared/products'
import { stepNames, stepText, trackFor } from '../../shared/steps'
import { ago, clock, running, useNow } from '../../shared/time'
import { blocksOf } from '../../shared/thread'
import { ThreadBlocks } from '../../shared/ThreadBlocks'
import { PermissionCall } from './PermissionCall'
import { StuckCall } from './StuckCall'
import { hasOutputs, Outputs } from './Outputs'
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
  noLead: 'No lead',
  lead: 'Lead',
  placeholderBusy: 'Add to the queue, or interrupt the lead',
  placeholder: (lead: string) => `Tell ${lead} something`,
  handsOver: (agent: string) => `hands the task to ${agent}`,
  takesOver: (to: string, from: string) => `${to} takes over from a brief; ${from}’s turn stops.`,
  handOver: 'Hand it over',
  working: 'Working',
  needsYou: 'Needs you',
  ready: 'Ready for you',
  done: 'Done',
  idle: 'Idle',
  stopped: 'Stopped',
  faces: { talk: 'Conversation', out: 'Outputs' } satisfies Record<Face, string>,
  facesKbd: { talk: 'c', out: 'o' } satisfies Record<Face, string>,
  nothingBuilt: 'Nothing is built yet, so there is nothing else to look at.',
  /** How long it has been on what it is doing now, or since it last changed. */
  since: {
    step: (step: string, took: string) => `${step} · ${took}`,
    waiting: (took: string) => `waiting · ${took}`,
    ready: (ago: string) => `ready · ${ago}`,
    done: (ago: string) => `done · ${ago}`,
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
  if (phase === 'settled') return { status: TaskStatus.Done, state: text.done }
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
  if (phase === 'settled') return settledAt === null ? null : text.since.done(ago(settledAt, new Date(now)))
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

export function TaskView({
  model,
  onBack,
  nav,
}: {
  model: TaskModel
  /** Back to the project, on Escape. */
  onBack: () => void
  /** The project's bar over it; a bare bar until the task says which project it is in. */
  nav?: ReactNode
}) {
  const [draft, setDraft] = useState('')
  const [pick, setPick] = useState<Choice | null>(null)
  // The face shown: the one the task's state opened on, read once, so it never moves under the person; then theirs.
  const [face, setFace] = useState<Face | null>(null)
  if (face === null && model.snapshot !== null)
    setFace(model.snapshot.task.phase === 'ready' && hasOutputs(model.snapshot) ? 'out' : 'talk')
  const known = useModels()
  const catalog = useMemo(() => catalogOf(known ?? [], model.agents), [known, model.agents])
  const files = model.snapshot?.task.files ?? []
  const changes = useChanges(model.snapshot?.task.id ?? null, files[0]?.path ?? null)
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
  const outputs = model.snapshot !== null && hasOutputs(model.snapshot)
  const open = changes.open
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || typing(event) || open) return
      if (event.key === 'Escape' && event.target === document.body) onBack()
      else if (outputs && event.key === text.facesKbd.talk) setFace('talk')
      else if (outputs && event.key === text.facesKbd.out) setFace('out')
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onBack, outputs, open])
  // A running turn says how long it has worked so far, and a task under way how long it has run.
  const now = useNow(ticking(model.snapshot))
  const snapshot = model.snapshot
  if (snapshot === null) {
    return (
      <div className={s.window}>
        {nav ?? <TitleBar lights="none">{null}</TitleBar>}
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
  const lead =
    session === null
      ? noLead
      : modelInfo({ id: session.agentId, name: session.agentName }, modelName(catalog, session.agentId, session.model))
  const { status, state } = statusOf(snapshot, agentName)
  const elapsed = elapsedOf(snapshot, now)
  const since = sinceOf(snapshot, now)
  const shown: Face = outputs ? (face ?? 'talk') : 'talk'
  const busy = session?.turnRunning ?? false
  const queue = queueShown(session, model.pending)
  // A stopped task picks up with the agent that last led it, when it still can.
  const last = snapshot.items.findLast((item) => item.agentId !== null)?.agentId
  const resume = model.agents.find((agent) => agent.id === last) ?? model.agents[0]
  const chosen: Choice | null = pick ?? (resume === undefined ? null : { agentId: resume.id, model: null, effort: null })
  const choice = session === null ? chosen : runningOn(session)

  // With no lead working, what the person says starts the one picked, as its first turn.
  const send = (body: string, now: boolean) => {
    setDraft('')
    if (session === null) void model.send(body, chosen ?? undefined)
    else void (now ? model.sendNow(body) : model.send(body))
  }
  // A queued message goes back in the composer to be changed, and out of the queue, unless the lead has it already.
  const edit = async (id: string) => {
    const said = queuedOf(snapshot.items, queue).find((message) => message.id === id)
    if (said !== undefined && (await model.takeBack(id))) setDraft((current) => withQueued(current, said.text))
  }

  const issue = snapshot.task.issue
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
      {session !== null && <TaskMenu status={status} onStop={() => void model.stop()} />}
    </>
  )

  const composer = (
    <div className={s.composer}>
      {model.error !== null && (
        <p className={s.failure} role="alert">
          {model.error} <LinkButton onClick={model.dismissError}>{text.dismiss}</LinkButton>
        </p>
      )}
      <Composer
        value={draft}
        onChange={setDraft}
        onSubmit={(body) => send(body, false)}
        onSendNow={(body) => send(body, true)}
        {...(busy ? { onStopAgent: () => void model.interrupt() } : {})}
        busy={busy}
        queued={queuedOf(snapshot.items, queue)}
        onEditQueued={(id) => void edit(id)}
        onUnqueue={(id) => void model.takeBack(id)}
        placeholder={busy ? text.placeholderBusy : text.placeholder(session?.agentName ?? agentName(chosen?.agentId ?? null))}
        meter={contextMeter(session)}
        // Another agent's model hands the task to that agent.
        picker={
          model.agents.length > 0 &&
          choice !== null && (
            <ModelChoice
              owner={text.lead}
              agents={model.agents}
              value={choice}
              onChange={(next) => (session === null ? setPick(next) : void model.choose(next))}
              // A lead that runs is handed over by another agent's model; one at work, only once the person says.
              {...(session === null ? {} : { handover: { note: text.handsOver, ask: busy ? text.takesOver : null } })}
              text={{ proceed: text.handOver }}
            />
          )
        }
      />
    </div>
  )

  return (
    <div className={s.window}>
      {nav ?? <TitleBar lights="none">{null}</TitleBar>}
      <div className={s.head}>
        {/* Both faces keep the conversation's width, so switching doesn't move the page. */}
        <ThreadMeasure>
          <TaskHeader
            title={snapshot.task.title}
            status={status}
            state={state}
            lead={lead}
            {...(snapshot.task.branch === null ? {} : { branch: snapshot.task.branch })}
            {...(since === null ? {} : { since })}
            {...(elapsed === null ? {} : { elapsed })}
            steps={trackFor(snapshot.task.steps, snapshot.task.step, snapshot.task.phase === 'ready' || snapshot.task.phase === 'settled')}
            {...(outputs
              ? {
                  faces: (['talk', 'out'] as const).map((value) => ({ value, label: text.faces[value], kbd: text.facesKbd[value] })),
                  face: shown,
                  onFace: setFace,
                }
              : { facesNote: text.nothingBuilt })}
            actions={actions}
          />
        </ThreadMeasure>
      </div>
      {shown === 'out' ? (
        <Outputs
          snapshot={snapshot}
          lead={lead}
          agentName={agentName}
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
        />
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
              blocks={blocksOf(
                { items: snapshot.items, turnRunning: busy, worktree: snapshot.task.worktree, queue },
                model.streaming,
                (iso) => ago(iso),
                now,
              )}
              agentName={agentName}
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
              ) : (
                <PermissionCall key={request.id} request={request} project={snapshot.project.name} onAnswer={model.answer} />
              ),
            )}
          </Thread>
        </TaskFace>
      )}
      {changes.open && (
        <ChangeView
          lights="space"
          branch={snapshot.task.branch ?? ''}
          {...(snapshot.task.baseRef === null ? {} : { base: snapshot.task.baseRef.replace(/^origin\//, '') })}
          files={files}
          selected={changes.selected}
          onSelect={changes.select}
          view={changes.view}
          onRetry={changes.retry}
          onClose={changes.close}
        />
      )}
    </div>
  )
}
