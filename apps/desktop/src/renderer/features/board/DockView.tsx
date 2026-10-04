import { useEffect, useState } from 'react'

import type { AgentStatus, BoardTask, ThreadSnapshot } from '@althar/contracts'
import { AcceptPeek, ActionButton, Dock, type PeekStep, TaskStatus, TrackStep, WorkPeek } from '@althar/ui'

import { useServices } from '../../data/services'
import { modelInfo, waitsWords } from '../../shared/agents'
import { checkOf } from '../../shared/checks'
import { productBrand, productName } from '../../shared/products'
import { ago, clock } from '../../shared/time'
import { PermissionCall } from '../task/PermissionCall'
import { StuckCall, text as stuckText } from '../task/StuckCall'
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

/** A task's head, read when the dock opens on it and again as the board changes: its files, for accepting. */
export const useHead = (threadId: string | null, version: number) => {
  const { client } = useServices()
  const [head, setHead] = useState<ThreadSnapshot | null>(null)
  useEffect(() => {
    if (threadId === null) return
    let current = true
    client.getThread(threadId, { limit: 0 }).then(
      (read) => {
        if (current) setHead(read)
      },
      () => undefined,
    )
    return () => {
      current = false
    }
  }, [client, threadId, version])
  return head?.task.id === undefined || threadId === null ? null : head
}

export function DockView({
  target,
  model,
  agents,
  project,
  now,
  onClose,
  onTask,
  onChanges,
}: {
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
      <Dock
        label={text.label}
        name={stuck === null ? boardText.approval : stuckText.step[stuck.step]}
        sub={`${call.taskTitle} · ${ago(call.createdAt, new Date(now))}`}
        call
        onClose={onClose}
      >
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
  const lead = modelInfo({ id: task.lead ?? 'agent', name: name(task.lead) }, null)
  // Its branch names it; a task without one, its slug.
  const sub = task.branch ?? task.slug
  const change = task.change

  if (task.phase === 'ready' && change !== null) {
    const brand = productBrand(change.product)
    return (
      <Dock label={text.label} name={text.phase.ready} sub={sub} onClose={onClose}>
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
          onAccept={() => void model.merge(task.taskId, change.head ?? '')}
          onSendBack={(note) => void model.sendBack(task, note)}
          onOpenFile={(path) => onChanges(task, path)}
          accepting={model.merging === task.taskId}
          sendingBack={model.sending === task.taskId}
          {...(model.error === null ? {} : { error: model.error })}
          text={{ number: (n: number) => `${change.prefix}${n}` }}
        />
        {open(task.threadId)}
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
    <Dock label={text.label} name={text.phase[task.phase]} sub={sub} onClose={onClose}>
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
        {/* Work that ended on its branch can still open its pull request, as the person says. */}
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
