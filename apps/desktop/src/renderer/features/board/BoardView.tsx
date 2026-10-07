import type { AgentStatus, BoardCall, BoardTask, PlanStep } from '@althar/contracts'
import {
  AcceptCard,
  Board,
  BoardColumn,
  BoardLane,
  BoardList,
  CallCard,
  NextRow,
  Outcome,
  SettledRow,
  TaskStatus,
  Wait,
  WorkCard,
} from '@althar/ui'

import { modelInfo, waitsWords } from '../../shared/agents'
import { productBrand, productName } from '../../shared/products'
import { ago, clock, running } from '../../shared/time'
import { text as stuckText } from '../task/StuckCall'
import { type Lanes } from './lanes'

/*
 * The project's work, as the kit's board lays it out: up next, running,
 * needs you, settled. Each card opens its task, where a call is answered and
 * work is accepted.
 */

export const text = {
  label: 'The project’s work',
  startsIn: (seconds: number) => (seconds <= 0 ? 'Starting' : `Starts in ${seconds}s`),
  held: 'Held. Starts when you say',
  step: { implement: 'Implement', review: 'Review' } satisfies Record<PlanStep['key'], string>,
  conversation: 'Conversation',
  status: {
    [TaskStatus.Running]: 'Running',
    [TaskStatus.Yours]: 'Waiting on you',
    [TaskStatus.Done]: 'Done',
    [TaskStatus.Paused]: 'Paused',
    [TaskStatus.Stopped]: 'Stopped',
  } satisfies Record<TaskStatus, string>,
  stopped: 'No agent is working on it',
  approval: 'Approval',
  allow: 'Allow',
  deny: 'Don’t allow',
  merged: (name: string) => `${name} merged`,
  closed: (name: string) => `${name} closed`,
  abandoned: 'Abandoned',
}

/** What the home's dock holds: a task, by its id, or a call. */
export type DockTarget = { readonly kind: 'task'; readonly id: string } | { readonly kind: 'call'; readonly id: string }

/** A task's steps as its card's track names them, and the one it is on. */
export const trackOf = (task: BoardTask) => {
  const planned = (task.plan?.steps ?? []).filter((step) => !step.skipped).map((step) => step.key)
  if (planned.length === 0) return { steps: [text.conversation], at: 0 }
  // Settling a review's findings is part of the review.
  const on = task.step === 'implement' ? 'implement' : task.step === null || task.step === 'publish' ? null : 'review'
  const at = on === null ? (task.step === 'publish' ? planned.length - 1 : 0) : Math.max(0, planned.indexOf(on))
  return { steps: planned.map((key) => text.step[key]), at }
}

/** A card names its task by its title alone: its slug says the same again, in code. */
const unnamed = () => ''

const STATUS: Readonly<Partial<Record<BoardTask['phase'], TaskStatus>>> = {
  running: TaskStatus.Running,
  waiting: TaskStatus.Yours,
  stopped: TaskStatus.Stopped,
}

export function BoardView({
  lanes,
  agents,
  now,
  onOpen,
}: {
  lanes: Lanes
  agents: ReadonlyArray<AgentStatus>
  /** The time now, for countdowns and how long work has run. */
  now: string
  /** Opens a task, by its thread. */
  onOpen: (threadId: string) => void
}) {
  const name = (id: string | null) => agents.find((agent) => agent.id === id)?.name ?? id ?? ''
  const lead = (task: BoardTask) => modelInfo({ id: task.lead ?? 'agent', name: name(task.lead) }, null)

  return (
    <Board label={text.label}>
      <BoardColumn lane={BoardLane.Next} count={lanes.next.length}>
        <BoardList>
          {lanes.next.map((work, index) => {
            const startsAt = work.plan?.startsAt ?? null
            return (
              <NextRow
                key={work.taskId}
                place={index + 1}
                task={work.slug}
                title={work.title}
                wait={startsAt === null ? Wait.You : Wait.Workers}
                reason={
                  startsAt === null ? text.held : text.startsIn(Math.ceil((new Date(startsAt).getTime() - new Date(now).getTime()) / 1000))
                }
                onOpen={() => onOpen(work.threadId)}
                text={{ task: unnamed }}
              />
            )
          })}
        </BoardList>
      </BoardColumn>

      <BoardColumn lane={BoardLane.Running} count={lanes.running.length}>
        {lanes.running.map((work) => {
          const { steps, at } = trackOf(work)
          const status = STATUS[work.phase] ?? TaskStatus.Running
          return (
            <WorkCard
              key={work.taskId}
              task={work.slug}
              title={work.title}
              status={status}
              steps={steps}
              at={at}
              elapsed={work.startedAt === null ? '' : running(work.startedAt, now)}
              lead={lead(work)}
              {...(work.waits !== null
                ? { note: waitsWords(name(work.waits.agentId), clock(work.waits.until)) }
                : status === TaskStatus.Stopped
                  ? { note: text.stopped }
                  : steps.length === 1
                    ? { note: '' }
                    : {})}
              onOpen={() => onOpen(work.threadId)}
              text={{ status: text.status, task: unnamed }}
            />
          )
        })}
      </BoardColumn>

      <BoardColumn lane={BoardLane.Yours} count={lanes.calls.length + lanes.ready.length}>
        {lanes.calls.map((waiting) => (
          <CallCard key={waiting.id} {...callCardOf(waiting, name)} onOpen={() => onOpen(waiting.threadId)} />
        ))}
        {lanes.ready.map((work) => {
          const change = work.change
          const brand = change === null ? undefined : productBrand(change.product)
          return (
            <AcceptCard
              key={work.taskId}
              task={work.slug}
              title={work.title}
              {...(change === null
                ? work.branch === null
                  ? {}
                  : { branch: { name: work.branch, add: work.changed?.add ?? 0, del: work.changed?.del ?? 0 } }
                : {
                    prs: [
                      {
                        repo: change.repository.slice(change.repository.lastIndexOf('/') + 1),
                        number: change.number,
                        add: change.additions ?? 0,
                        del: change.deletions ?? 0,
                      },
                    ],
                    host: { name: productName(change.product), ...(brand === undefined ? {} : { brand }) },
                    checks: change.checks?.passed ?? 0,
                  })}
              onOpen={() => onOpen(work.threadId)}
              text={{ task: unnamed, ...(change === null ? {} : { number: (n: number) => `${change.prefix}${n}` }) }}
            />
          )
        })}
      </BoardColumn>

      <BoardColumn lane={BoardLane.Settled} count={lanes.settled.length}>
        <BoardList>
          {lanes.settled.map((work) => {
            const change = work.change
            const outcome = change?.state === 'merged' ? Outcome.Merged : work.state === 'abandoned' ? Outcome.Abandoned : Outcome.Done
            const named = change === null ? null : `${change.short} ${change.prefix}${change.number}`
            return (
              <SettledRow
                key={work.taskId}
                outcome={outcome}
                task={work.slug}
                title={work.title}
                {...(named === null
                  ? work.branch === null
                    ? {}
                    : { meta: work.branch }
                  : { meta: change?.state === 'merged' ? text.merged(named) : text.closed(named) })}
                at={work.settledAt === null ? '' : ago(work.settledAt, new Date(now))}
                onOpen={() => onOpen(work.threadId)}
                text={{ task: unnamed }}
              />
            )
          })}
        </BoardList>
      </BoardColumn>
    </Board>
  )
}

/** A call as its card on the board says it: a step that needs the person, or an approval. */
export const callCardOf = (waiting: BoardCall, name: (id: string | null) => string) => {
  if (waiting.stuck !== null) {
    const stuck = waiting.stuck
    return {
      kind: stuckText.step[stuck.step],
      title:
        stuck.step === 'publish' && stuck.why !== 'not_connected'
          ? stuckText.publishing(stuck)
          : stuckText.what(stuck, name(stuck.agentId) || 'The agent'),
      options: [],
      from: waiting.taskTitle,
      at: ago(waiting.createdAt),
    }
  }
  return {
    kind: text.approval,
    title: waiting.title,
    because: waiting.reason,
    options: [text.allow, text.deny],
    from: waiting.taskTitle,
    at: ago(waiting.createdAt),
  }
}
