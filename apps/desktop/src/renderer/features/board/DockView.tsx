import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'

import type { AgentStatus, BoardTask, ThreadSnapshot } from '@althar/contracts'
import { AcceptPeek, ActionButton, Dock, type PeekStep, TaskStatus, TrackStep, WorkPeek } from '@althar/ui'

import { keys, reads } from '../../data/reads'
import { useServices } from '../../data/services'
import { waitsWords } from '../../shared/agents'
import { useModelNames } from '../../shared/modelNames'
import { callKindOf } from '../../shared/calls'
import { checkOf } from '../../shared/checks'
import { mergeHereLabel } from '../../shared/mergeHere'
import { productBrand, productName } from '../../shared/products'
import { ago, clock } from '../../shared/time'
import { PermissionCall } from '../task/PermissionCall'
import { StuckCall } from '../task/StuckCall'
import { text as boardText, type DockTarget, trackOf } from './BoardView'
import s from './Board.module.css'
import type { BoardModel } from './useBoard'

/*
 * The dock beside the board: what you opened from it, to answer or accept
 * without leaving. A call is answered here as in its task. Work ready to
 * accept shows its pull request, files and checks, and is merged, or sent
 * back to its lead with a note; work that ended on its branch can open its
 * pull request. Anything else shows its steps, and its task is a click away.
 */

export const text = {
  label: 'Beside the board',
  phase: {
    planned: 'Up next',
    held: 'Up next',
    running: 'Running',
    waiting: 'Running',
    stopped: 'Stopped',
    ready: 'Ready',
    settled: 'Settled',
  } satisfies Record<BoardTask['phase'], string>,
  openTask: 'Open the task',
  review: 'Review the changes',
  openChange: 'Open a pull request',
  stepNote: { now: 'now', done: 'done' },
}

/** A task's steps, as the dock lists them: done, the one it is on, and those to come. */
const stepsOf = (task: BoardTask): ReadonlyArray<PeekStep> => {
  const { steps, at } = trackOf(task)
  const finished = task.phase === 'ready' || task.phase === 'settled'
  // A plan that hasn't started has all its steps to come.
  const waiting = task.phase === 'planned' || task.phase === 'held'
  return steps.map((label, index) => ({
    label,
    state: waiting ? TrackStep.Next : finished || index < at ? TrackStep.Done : index === at ? TrackStep.Now : TrackStep.Next,
  }))
}

/**
 * A task's head as the board stood (`version`): its files, for accepting.
 * Read ahead with the board (`useBoard`), so the dock opens with it; until a
 * newer one is read, the last one shows, or the thread as the window last
 * read it.
 */
export const useHead = (threadId: string | null, version: number) => {
  const { client, cache } = useServices()
  const read = useQuery({
    ...reads(client).head(threadId ?? '', version),
    enabled: threadId !== null,
    placeholderData: (previous) => previous ?? (threadId === null ? undefined : cache.getQueryData<ThreadSnapshot>(keys.thread(threadId))),
  })
  const head = read.data ?? null
  return head?.task.id === undefined || threadId === null ? null : head
}

/** Reads ahead the thread of what the dock shows, so opening its task from there is instant. */
const useThreadAhead = (threadId: string | null) => {
  const { client, cache } = useServices()
  useEffect(() => {
    if (threadId !== null) void cache.prefetchQuery(reads(client).thread(threadId))
  }, [client, cache, threadId])
}

export function DockView({
  label = text.label,
  target,
  model,
  agents,
  project,
  now,
  onClose,
  onTask,
  onChanges,
}: {
  /** What the dock is called, for its landmark: beside the board, unless told. */
  label?: string
  target: DockTarget
  model: BoardModel
  agents: ReadonlyArray<AgentStatus>
  project: string
  now: string
  onClose: () => void
  onTask: (threadId: string) => void
  /** Opens a task's changes over the window, on a file or the first. */
  onChanges: (task: BoardTask, path?: string) => void
}) {
  const board = model.board
  const call = target.kind === 'call' ? board?.calls.find((candidate) => candidate.id === target.id) : undefined
  const task = target.kind === 'task' ? board?.tasks.find((candidate) => candidate.taskId === target.id) : undefined
  const head = useHead(task?.phase === 'ready' && task.change !== null ? task.threadId : null, board?.cursor ?? 0)
  useThreadAhead(call?.threadId ?? task?.threadId ?? null)
  const named = useModelNames()
  const name = (id: string | null) => agents.find((agent) => agent.id === id)?.name ?? id ?? ''
  const open = (threadId: string) => (
    <div className={s.actions}>
      <ActionButton icon="arrow" onClick={() => onTask(threadId)}>
        {text.openTask}
      </ActionButton>
    </div>
  )

  if (call !== undefined) {
    const stuck = call.stuck
    return (
      <Dock label={label} name={callKindOf(call)} sub={`${call.taskTitle} · ${ago(call.createdAt, new Date(now))}`} call onClose={onClose}>
        {stuck === null ? (
          <PermissionCall request={call} project={project} onAnswer={model.answer} />
        ) : (
          <StuckCall
            request={call}
            stuck={stuck}
            agents={agents}
            agentName={name}
            onAnswer={(id, answer) => void model.answerStuck(id, answer)}
          />
        )}
        {open(call.threadId)}
      </Dock>
    )
  }

  if (task === undefined) return null
  const lead = named(task.lead, task.leadModel)
  // Its branch names it; a task without one, its slug.
  const sub = task.branch ?? task.slug
  const change = task.change

  if (task.phase === 'ready' && change !== null) {
    const brand = productBrand(change.product)
    return (
      <Dock label={label} name={text.phase.ready} sub={sub} onClose={onClose}>
        <AcceptPeek
          title={task.title}
          {...(task.summary === null ? {} : { because: task.summary.split('\n')[0] ?? '' })}
          repo={change.repository}
          number={change.number}
          host={{ name: productName(change.product), ...(brand === undefined ? {} : { brand }) }}
          url={change.url}
          lead={lead}
          files={(head?.task.files ?? []).map((file) => ({ path: file.path, add: file.add, del: file.del }))}
          checks={(change.checks?.list ?? []).map(checkOf)}
          // The head the dock showed: a pull request that moved on since isn't merged unseen.
          onAccept={() => void model.merge(task.taskId, change.head ?? '', change.url)}
          onSendBack={(note) => void model.sendBack(task, note)}
          // What the lead committed since, up to the head the dock showed: pushed first, as the person says.
          unpushed={change.localHead === null ? 0 : change.unpushed}
          onPush={() => void model.push(task.taskId, change.localHead ?? '', change.url)}
          pushing={model.pushing === task.taskId}
          onOpenFile={(path) => onChanges(task, path)}
          accepting={model.merging === task.taskId}
          sendingBack={model.sending === task.taskId}
          {...(model.error === null ? {} : { error: model.error })}
          text={{ number: (n: number) => `${change.prefix}${n}` }}
        />
        <div className={s.actions}>
          {/* A repository of the task that ended on its branch merges here, beside the pull request of the rest. */}
          {task.here.length > 0 && (
            <ActionButton icon="branch" disabled={model.merging === task.taskId} onClick={() => void model.mergeHere(task)}>
              {mergeHereLabel(task.here, true)}
            </ActionButton>
          )}
          <ActionButton icon="arrow" onClick={() => onTask(task.threadId)}>
            {text.openTask}
          </ActionButton>
        </div>
      </Dock>
    )
  }

  const waiting =
    task.phase === 'held'
      ? boardText.held
      : task.phase === 'planned' && task.plan?.startsAt != null
        ? boardText.startsIn(Math.ceil((new Date(task.plan.startsAt).getTime() - new Date(now).getTime()) / 1000))
        : null
  return (
    <Dock label={label} name={text.phase[task.phase]} sub={sub} onClose={onClose}>
      <WorkPeek
        title={task.title}
        {...(waiting !== null
          ? { note: waiting }
          : task.waits !== null
            ? { note: waitsWords(name(task.waits.agentId), clock(task.waits.until)) }
            : task.summary === null
              ? {}
              : { note: task.summary.split('\n')[0] ?? '' })}
        status={
          task.phase === 'waiting'
            ? TaskStatus.Yours
            : task.phase === 'stopped'
              ? TaskStatus.Stopped
              : task.phase === 'running'
                ? TaskStatus.Running
                : TaskStatus.Done
        }
        steps={stepsOf(task)}
        lead={lead}
      />
      {model.error !== null && (
        <p className={s.failure} role="alert">
          {model.error}
        </p>
      )}
      <div className={s.actions}>
        {task.phase === 'ready' && (
          <ActionButton icon="file" onClick={() => onChanges(task)}>
            {text.review}
          </ActionButton>
        )}
        {/* Work that ended on its branch merges here, or can still open its pull request, as the person says. */}
        {task.phase === 'ready' && change === null && task.here.length > 0 && (
          <ActionButton icon="branch" disabled={model.merging === task.taskId} onClick={() => void model.mergeHere(task)}>
            {mergeHereLabel(task.here)}
          </ActionButton>
        )}
        {task.phase === 'ready' && change === null && (
          <ActionButton icon="pr" disabled={model.opening === task.taskId} onClick={() => void model.openChange(task.taskId)}>
            {text.openChange}
          </ActionButton>
        )}
        <ActionButton icon="arrow" onClick={() => onTask(task.threadId)}>
          {text.openTask}
        </ActionButton>
      </div>
    </Dock>
  )
}
