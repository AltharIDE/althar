import { useState } from 'react'

import type { AgentStatus, ChangeSummary, PlanStep, TaskEnd as End } from '@althar/contracts'
import { type IssueRefProps, type LaunchStep, TaskCard, TaskEnd, TaskLaunch, TaskStatus } from '@althar/ui'

import { queuedWords, reconnectsWords, waitsWords } from '../../shared/agents'
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
  /** The project's id, for each model's room in a step's picker; absent outside a project. */
  readonly projectId?: string
  readonly agents: ReadonlyArray<AgentStatus>
  readonly agentName: (id: string | null) => string
  readonly onStart: (planId: string) => void
  readonly onHold: (planId: string) => void
  readonly onChange: (planId: string, steps: ReadonlyArray<PlanStep>, end?: End | null) => void
  readonly onOpen: (threadId: string) => void
  /** Stops a command a task's lead left running, from the task that waits for the place it keeps. */
  readonly onStopBackground: (threadId: string, id: string) => void
  /** The one waiting task that shows who holds the places, the newest: the others only wait. */
  readonly holdersOn?: string | null
}

type Plan = NonNullable<TaskCardContent['plan']>

/** The kit's ending, from the plan's. */
const ENDS: Readonly<Record<End, TaskEnd>> = { draft: TaskEnd.DraftPr, ready: TaskEnd.ReadyPr, none: TaskEnd.PushOnly }
const endOf = (end: TaskEnd): End => (end === TaskEnd.DraftPr ? 'draft' : end === TaskEnd.ReadyPr ? 'ready' : 'none')

/** The issue a task came from, as the kit marks it. */
const fromOf = (card: TaskCardContent): IssueRefProps | undefined =>
  card.issue === null ? undefined : { mark: productBrand(card.issue.product), id: card.issue.key, linear: card.issue.product === 'linear' }

/**
 * The plan's steps as the kit shows them, by model; the agent's id rides on
 * the model's runtime. A review of someone else's pull request has one, its
 * lead, which reviews.
 */
const launchSteps = (plan: Plan, named: NameModel, reviews: boolean): ReadonlyArray<LaunchStep> =>
  plan.steps.map((step) => ({
    id: step.key,
    label: text.label[reviews ? 'review' : step.key],
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
  // Only the agents the plan allows: a review's lead only reads, so an agent that can't be held to that isn't offered.
  const allowed = plan.agents
  const agents = allowed === undefined ? actions.agents : actions.agents.filter((agent) => allowed.includes(agent.id))
  return (
    <TaskLaunch
      task={card.slug}
      title={card.title}
      {...(from === undefined ? {} : { from })}
      project={actions.project}
      steps={launchSteps({ ...plan, steps }, named, card.reviewing != null)}
      onStepsChange={(next) =>
        change(steps.map((step) => ({ ...step, skipped: next.find((launch) => launch.id === step.key)?.skipped ?? step.skipped })))
      }
      picker={({ step, owner }) => {
        const planned = steps.find((candidate) => candidate.key === step.id)
        return (
          planned !== undefined && (
            <ModelChoice
              owner={owner}
              agents={agents}
              value={{ agentId: planned.agentId, model: planned.model, effort: planned.effort ?? null }}
              {...(actions.projectId === undefined ? {} : { projectId: actions.projectId })}
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

/** Its latest pull request; those of its earlier rounds of work (ADR-034) are on its own view. */
const pullRequestOf = (latest: ChangeSummary) => `${latest.short} ${latest.prefix}${latest.number}`

/** A task's card, with, while it waits for a free agent and is the newest to, the servers that keep a place. */
export function Card({ card, actions }: { card: TaskCardContent; actions: CardActions }) {
  const holders = card.queued?.holders
  if (holders === undefined || holders.length === 0 || (actions.holdersOn !== undefined && actions.holdersOn !== card.threadId))
    return <Shown card={card} actions={actions} />
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
  // A review has no steps to go through: its lead reads and drafts.
  const steps = stepNames(card.reviewing == null ? (card.plan?.steps ?? []) : [], card.followUp === true)
  const at = stepIndex(steps, card.step)
  // Ready, but its lead couldn't resolve a conflict, or brought its failing checks to the person: it needs them, and says why.
  const handedBack = card.phase === 'ready' ? (card.handedBack ?? card.checksBack ?? null) : null
  // Waiting for a free agent, it says so, rather than that it runs.
  // Held for a usage limit, it is paused until the reset, as on the board, unless the person moves it on.
  const status =
    card.queued !== null
      ? TaskStatus.Queued
      : handedBack !== null
        ? TaskStatus.Yours
        : (card.waits !== null || card.reconnects != null) && card.phase === 'running'
          ? TaskStatus.Paused
          : STATUS[card.phase]
  // A step held for a usage limit, or waiting for a free agent, says what it waits for, rather than what it does.
  const now =
    handedBack !== null
      ? handedBack
      : status === TaskStatus.Done
        ? card.summary?.split('\n')[0]
        : card.queued !== null
          ? queuedWords(card.queued)
          : card.waits !== null
            ? waitsWords(actions.agentName(card.waits.agentId), clock(card.waits.until), undefined, card.waits.left)
            : card.reconnects != null
              ? reconnectsWords(card.reconnects, clock)
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
      {...(from === undefined ? {} : { from })}
      {...(card.change === null ? {} : { pr: pullRequestOf(card.change) })}
      onOpen={() => actions.onOpen(card.threadId)}
      text={{ status: text.status }}
    />
  )
}
