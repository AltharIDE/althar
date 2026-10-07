import { useState } from 'react'

import type { AgentStatus, PlanStep, TaskEnd as End } from '@althar/contracts'
import { type IssueRefProps, type LaunchStep, TaskCard, TaskEnd, TaskLaunch, TaskStatus } from '@althar/ui'

import { modelInfo, waitsWords } from '../../shared/agents'
import { ModelChoice } from '../../shared/ModelChoice'
import { productBrand } from '../../shared/products'
import { stepIndex, stepNames, stepText } from '../../shared/steps'
import { ago, clock } from '../../shared/time'
import type { TaskCardContent } from '../../shared/thread'

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
}

type Plan = NonNullable<TaskCardContent['plan']>

/** The kit's ending, from the plan's. */
const ENDS: Readonly<Record<End, TaskEnd>> = { draft: TaskEnd.DraftPr, ready: TaskEnd.ReadyPr, none: TaskEnd.PushOnly }
const endOf = (end: TaskEnd): End => (end === TaskEnd.DraftPr ? 'draft' : end === TaskEnd.ReadyPr ? 'ready' : 'none')

/** The issue a task came from, as the kit marks it. */
const fromOf = (card: TaskCardContent): IssueRefProps | undefined =>
  card.issue === null ? undefined : { mark: productBrand(card.issue.product), id: card.issue.key, linear: card.issue.product === 'linear' }

/** The plan's steps as the kit shows them; the agent's id rides on the model's runtime. */
const launchSteps = (plan: Plan, agentName: (id: string) => string): ReadonlyArray<LaunchStep> =>
  plan.steps.map((step) => ({
    id: step.key,
    label: text.label[step.key],
    agents: [modelInfo({ id: step.agentId, name: agentName(step.agentId) }, step.model)],
    ...(step.key === 'implement' && plan.reason !== null ? { why: plan.reason } : {}),
    optional: step.key === 'review',
    skipped: step.skipped,
  }))

function PlanCard({ card, plan, actions }: { card: TaskCardContent; plan: Plan; actions: CardActions }) {
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
      steps={launchSteps({ ...plan, steps }, (id) => actions.agentName(id))}
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

export function Card({ card, actions }: { card: TaskCardContent; actions: CardActions }) {
  if ((card.phase === 'planned' || card.phase === 'held') && card.plan !== null)
    return <PlanCard key={card.plan.id} card={card} plan={card.plan} actions={actions} />
  const steps = stepNames(card.plan?.steps ?? [])
  const at = stepIndex(steps, card.step)
  const status = STATUS[card.phase]
  // A step held for a usage limit says what it waits for, rather than what it does.
  const now =
    status === TaskStatus.Done
      ? card.summary?.split('\n')[0]
      : card.waits !== null
        ? waitsWords(actions.agentName(card.waits.agentId), clock(card.waits.until))
        : card.step === null
          ? undefined
          : text.now[card.step]
  const from = fromOf(card)
  return (
    <TaskCard
      task={card.slug}
      title={card.title}
      status={status}
      steps={steps}
      at={status === TaskStatus.Done ? steps.length - 1 : at}
      {...(now === undefined ? {} : { now })}
      started={card.startedAt === null ? '' : ago(card.startedAt)}
      lead={modelInfo({ id: card.lead ?? 'agent', name: actions.agentName(card.lead) }, null)}
      {...(card.branch === null ? {} : { branch: card.branch })}
      {...(from === undefined ? {} : { from })}
      {...(card.change === null ? {} : { pr: `${card.change.short} ${card.change.prefix}${card.change.number}` })}
      onOpen={() => actions.onOpen(card.threadId)}
      text={{ status: text.status, task: text.task }}
    />
  )
}
