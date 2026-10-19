import { useState } from 'react'

import type { AgentStatus, ChangeSummary, PlanStep, TaskEnd as End } from '@althar/contracts'
import { type IssueRefProps, type LaunchStep, TaskCard, TaskEnd, TaskLaunch, TaskStatus } from '@althar/ui'

import { queuedWords, waitsWords } from '../../shared/agents'
import { type NameModel, useEffortNames, useModelNames } from '../../shared/modelNames'
import { Holders } from '../../shared/Holders'
import { ModelChoice } from '../../shared/ModelChoice'
import { productBrand } from '../../shared/products'
import { stepIndex, stepNames, stepText } from '../../shared/steps'
import { ago, clock } from '../../shared/time'
import type { TaskCardContent } from '../../shared/thread'
import s from './Card.module.css'

/*
 * A task's card in the Talk room. Before it starts, its plan: who does each
 * step, on which model and how hard it thinks, why the coordinator chose the
 * lead, and the time it starts on its own, which the runtime keeps. You can
 * change who does a step, skip the review, hold it, or start it now. Once it
 * starts, where it stands, and a way in.
 */

/** How long a plan waits before it starts on its own: the runtime's countdown. */
export const COUNTDOWN = 25

export const text = {
  label: stepText.label,
  status: {
    [TaskStatus.Running]: 'Running',
    [TaskStatus.Yours]: 'Needs you',
    [TaskStatus.Done]: 'Ready',
    [TaskStatus.Paused]: 'Paused',
    [TaskStatus.Queued]: 'Waiting',
    [TaskStatus.Stopped]: 'Stopped',
  } satisfies Record<TaskStatus, string>,
  now: stepText.now,
  task: (task: string, started: string) => (started === '' ? `Task ${task}` : `Task ${task} · ${started}`),
}

const STATUS: Readonly<Record<TaskCardContent['phase'], TaskStatus>> = {
  planned: TaskStatus.Running,
  held: TaskStatus.Stopped,
  running: TaskStatus.Running,
  waiting: TaskStatus.Yours,
  ready: TaskStatus.Done,
  kept: TaskStatus.Paused,
  stopped: TaskStatus.Stopped,
  settled: TaskStatus.Done,
}

export interface CardActions {
  readonly project: string
  readonly agents: ReadonlyArray<AgentStatus>
  readonly agentName: (id: string | null) => string
  readonly onStart: (planId: string) => void
  readonly onHold: (planId: string) => void
  readonly onChange: (planId: string, steps: ReadonlyArray<PlanStep>, end?: End | null) => void
  readonly onOpen: (threadId: string) => void
  /** Stops a command a task's lead left running, from the task that waits for the place it keeps. */
  readonly onStopBackground: (threadId: string, id: string) => void
}

type Plan = NonNullable<TaskCardContent['plan']>

/** The kit's ending, from the plan's. */
const ENDS: Readonly<Record<End, TaskEnd>> = { draft: TaskEnd.DraftPr, ready: TaskEnd.ReadyPr, none: TaskEnd.PushOnly }
const endOf = (end: TaskEnd): End => (end === TaskEnd.DraftPr ? 'draft' : end === TaskEnd.ReadyPr ? 'ready' : 'none')

/** The issue a task came from, as the kit marks it. */
const fromOf = (card: TaskCardContent): IssueRefProps | undefined =>
  card.issue === null ? undefined : { mark: productBrand(card.issue.product), id: card.issue.key, linear: card.issue.product === 'linear' }

/** The plan's steps as the kit shows them, by model; the agent's id rides on the model's runtime. */
const launchSteps = (plan: Plan, named: NameModel): ReadonlyArray<LaunchStep> =>
  plan.steps.map((step) => ({
    id: step.key,
    label: text.label[step.key],
    agents: [named(step.agentId, step.model)],
    ...(step.key === 'implement' && plan.reason !== null ? { why: plan.reason } : {}),
    optional: step.key === 'review',
    skipped: step.skipped,
  }))

function PlanCard({
  card,
  plan,
  actions,
  queued,
}: {
  card: TaskCardContent
  plan: Plan
  actions: CardActions
  /** Started, waiting for a free agent: what for. */
  queued?: string
}) {
  const named = useModelNames()
  // What the person changed shows at once; the runtime's copy replaces it when it comes back.
  const [shown, setShown] = useState<{ readonly from: Plan; readonly steps: ReadonlyArray<PlanStep>; readonly end: End | null }>({
    from: plan,
    steps: plan.steps,
    end: plan.end,
  })
  const steps = shown.from === plan ? shown.steps : plan.steps
  const end = shown.from === plan ? shown.end : plan.end
  const change = (next: ReadonlyArray<PlanStep>, nextEnd: End | null = end) => {
    setShown({ from: plan, steps: next, end: nextEnd })
    actions.onChange(plan.id, next, nextEnd)
  }
  const from = fromOf(card)
  return (
    <TaskLaunch
      task={card.slug}
      title={card.title}
      {...(from === undefined ? {} : { from })}
      project={actions.project}
      steps={launchSteps({ ...plan, steps }, named)}
      onStepsChange={(next) =>
        change(steps.map((step) => ({ ...step, skipped: next.find((launch) => launch.id === step.key)?.skipped ?? step.skipped })))
      }
      picker={({ step, owner }) => {
        const planned = steps.find((candidate) => candidate.key === step.id)
        return (
          planned !== undefined && (
            <ModelChoice
              owner={owner}
              agents={actions.agents}
              value={{ agentId: planned.agentId, model: planned.model, effort: planned.effort ?? null }}
              onChange={(choice) => change(steps.map((candidate) => (candidate.key === step.id ? { ...candidate, ...choice } : candidate)))}
              variant="field"
              placement="below"
            />
          )
        )
      }}
      wait={COUNTDOWN}
      {...(queued === undefined ? {} : { queued })}
      {...(plan.startsAt === null ? {} : { startsAt: Date.parse(plan.startsAt) })}
      held={card.phase === 'held'}
      onHeldChange={(held) => {
        if (held) actions.onHold(plan.id)
      }}
      // Where the repository's host isn't connected, the task ends on its branch, and there is no ending to pick.
      {...(end === null ? { hideEnd: true } : { end: ENDS[end], onEndChange: (next: TaskEnd) => change(steps, endOf(next)) })}
      // A draft pull request is where tasks end until projects have rules for it, so no rule is named.
      text={{ endByRule: () => '', ruleNote: (_project, note) => note }}
      onStart={() => actions.onStart(plan.id)}
    />
  )
}

/** Its pull requests in a few words: the latest, and those of its earlier rounds of work before it (ADR-034). */
const pullRequestsOf = (latest: ChangeSummary, earlier: ReadonlyArray<ChangeSummary>) => {
  const name = (change: ChangeSummary) => `${change.short} ${change.prefix}${change.number}`
  return earlier.length === 0 ? name(latest) : `${name(latest)}, after ${earlier.map(name).join(' and ')}`
}

/** A task's card, with, while it waits for a free agent, who holds the places. */
export function Card({ card, actions }: { card: TaskCardContent; actions: CardActions }) {
  const holders = card.queued?.holders
  if (holders === undefined || holders.length === 0) return <Shown card={card} actions={actions} />
  return (
    <div className={s.stack}>
      <Shown card={card} actions={actions} />
      <Holders holders={holders} onStop={actions.onStopBackground} />
    </div>
  )
}

function Shown({ card, actions }: { card: TaskCardContent; actions: CardActions }) {
  const named = useModelNames()
  const effortOf = useEffortNames()
  if ((card.phase === 'planned' || card.phase === 'held') && card.plan !== null)
    return <PlanCard key={card.plan.id} card={card} plan={card.plan} actions={actions} />
  // Started, its first step waiting for a free agent, the plan can still be changed: it says what it waits for where the clock was.
  if (card.planWaits === true && card.queued !== null && card.plan !== null)
    return <PlanCard key={card.plan.id} card={card} plan={card.plan} actions={actions} queued={queuedWords(card.queued)} />
  const steps = stepNames(card.plan?.steps ?? [], card.followUp === true)
  const at = stepIndex(steps, card.step)
  // Ready, but its lead couldn't resolve a conflict: it needs the person, and says why.
  const handedBack = card.phase === 'ready' ? (card.handedBack ?? null) : null
  // Waiting for a free agent, it says so, rather than that it runs.
  const status = card.queued !== null ? TaskStatus.Queued : handedBack === null ? STATUS[card.phase] : TaskStatus.Yours
  // A step held for a usage limit, or waiting for a free agent, says what it waits for, rather than what it does.
  const now =
    handedBack !== null
      ? handedBack
      : status === TaskStatus.Done
        ? card.summary?.split('\n')[0]
        : card.queued !== null
          ? queuedWords(card.queued)
          : card.waits !== null
            ? waitsWords(actions.agentName(card.waits.agentId), clock(card.waits.until))
            : card.step === null
              ? undefined
              : text.now[card.step]
  const from = fromOf(card)
  // How hard its lead thinks, whoever chose it: what its session is on, or the plan's until it has started.
  const effort = effortOf(card.lead, card.leadModel, card.leadEffort)
  return (
    <TaskCard
      task={card.slug}
      title={card.title}
      status={status}
      steps={steps}
      at={status === TaskStatus.Done || handedBack !== null ? steps.length - 1 : at}
      {...(now === undefined ? {} : { now })}
      started={card.startedAt === null ? '' : ago(card.startedAt)}
      lead={named(card.lead, card.leadModel)}
      {...(effort === null ? {} : { effort })}
      {...(card.branch === null ? {} : { branch: card.branch })}
      {...(from === undefined ? {} : { from })}
      {...(card.change === null ? {} : { pr: pullRequestsOf(card.change, card.earlier ?? []) })}
      onOpen={() => actions.onOpen(card.threadId)}
      text={{ status: text.status, task: text.task }}
    />
  )
}
