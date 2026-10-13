import type { AgentStatus, BoardCall, BoardTask, PlanStep } from '@althar/contracts'
import {
  AcceptCard,
  Board,
  BoardColumn,
  BoardLane,
  BoardList,
  Button,
  CallCard,
  NextRow,
  Outcome,
  SettledRow,
  TaskStatus,
  Wait,
  WorkCard,
} from '@althar/ui'

import { queuedWords, waitsWords } from '../../shared/agents'
import { useModelNames } from '../../shared/modelNames'
import { callKindOf, kindWords, readyKindOf, whereOf } from '../../shared/calls'
import { moreOf as questionMore } from '../../shared/questions'
import { productBrand, productName } from '../../shared/products'
import { afterSteps, stepText } from '../../shared/steps'
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
  /** A round of work after its plan, in place of Implement, as the person asked its lead for more. */
  followUp: 'Follow-up',
  /** Ready with commits after its last pull request, in none yet: a new one is the person's to open. */
  unshipped: 'Ready for a new pull request',
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
  allow: 'Allow',
  deny: 'Don’t allow',
  /** What a question's card offers: to answer it, in its task. */
  answer: 'Answer',
  merged: (name: string) => `${name} merged`,
  closed: (name: string) => `${name} closed`,
  abandoned: 'Abandoned',
  showOlder: 'Show older',
}

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
  onShowOlder,
}: {
  lanes: Lanes
  agents: ReadonlyArray<AgentStatus>
  /** The time now, for countdowns and how long work has run. */
  now: string
  /** Opens a task, by its thread. */
  onOpen: (threadId: string) => void
  /** Loads the next page of settled work; absent where every settled task is already shown. */
  onShowOlder?: () => void
}) {
  const name = (id: string | null) => agents.find((agent) => agent.id === id)?.name ?? id ?? ''
  const named = useModelNames()
  const lead = (task: BoardTask) => named(task.lead, task.leadModel)

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
          // Waiting for a free agent, it says so, rather than that it runs.
          const status = work.queued !== null ? TaskStatus.Queued : (STATUS[work.phase] ?? TaskStatus.Running)
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
              {...(work.queued !== null
                ? { note: queuedWords(work.queued) }
                : work.waits !== null
                  ? { note: waitsWords(name(work.waits.agentId), clock(work.waits.until)) }
                  : status === TaskStatus.Stopped
                    ? { note: text.stopped }
                    : afterSteps(work.step)
                      ? { note: stepText.now[work.step ?? ''] ?? '' }
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
          // Commits after its last pull request merged or closed: its branch, as for work with none, until a new one opens; with
          // another of its repositories' pull requests open, that one, to accept, and the branch under it with what is in none.
          const change = work.unshipped == null || work.change?.state === 'open' ? work.change : null
          const after =
            work.unshipped == null || work.branch === null ? null : { name: work.branch, add: work.unshipped.add, del: work.unshipped.del }
          const brand = change === null ? undefined : productBrand(change.product)
          return (
            <AcceptCard
              key={work.taskId}
              task={work.slug}
              title={work.title}
              {...(change === null
                ? work.branch === null
                  ? {}
                  : {
                      branch: {
                        name: work.branch,
                        add: work.unshipped?.add ?? work.changed?.add ?? 0,
                        del: work.unshipped?.del ?? work.changed?.del ?? 0,
                      },
                    }
                : {
                    prs: [
                      {
                        repo: change.repository.slice(change.repository.lastIndexOf('/') + 1),
                        number: change.number,
                        // A host that doesn't count lines shows no size, rather than +0 −0.
                        ...(change.additions === null || change.deletions === null ? {} : { add: change.additions, del: change.deletions }),
                      },
                    ],
                    host: { name: productName(change.product), ...(brand === undefined ? {} : { brand }) },
                    checks: change.checks?.passed ?? 0,
                    ...(after === null ? {} : { branch: after }),
                  })}
              // Its lead couldn't resolve a conflict: it is stuck, and the card says why.
              {...(work.handedBack == null ? {} : { note: work.handedBack })}
              onOpen={() => onOpen(work.threadId)}
              text={{
                task: unnamed,
                ...(change === null ? {} : { number: (n: number) => `${change.prefix}${n}` }),
                // Handed back (a conflict its lead couldn't resolve) says so first; else commits in no pull request yet.
                ...(work.handedBack != null
                  ? { kind: readyKindOf(work) }
                  : change === null && work.unshipped != null
                    ? { kind: text.unshipped }
                    : {}),
              }}
            />
          )
        })}
      </BoardColumn>

      <BoardColumn lane={BoardLane.Settled} count={lanes.settledTotal}>
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
        {onShowOlder !== undefined && (
          <Button variant="quiet" size="small" onClick={onShowOlder}>
            {text.showOlder}
          </Button>
        )}
      </BoardColumn>
    </Board>
  )
}

/** A call as its card on the board says it: a step that needs the person, or an approval. */
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
