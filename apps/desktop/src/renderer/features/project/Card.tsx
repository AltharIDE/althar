import { useState } from 'react'

import type { AgentStatus, PlanStep } from '@charrette/contracts'
import { type LaunchStep, Select, TaskCard, TaskLaunch, TaskStatus } from '@charrette/ui'

import { modelInfo } from '../../shared/agents'
import { ago } from '../../shared/time'
import type { TaskCardContent } from '../../shared/thread'

/*
 * A task's card in the Talk room. Before it starts, its plan: who does each
 * step, why the coordinator chose the lead, and the time it starts on its
 * own, which the runtime keeps. You can change who does a step, skip the
 * review, hold it, or start it now. Once it starts, where it stands, and a
 * way in.
 */

/** How long a plan waits before it starts on its own: the runtime's countdown. */
export const COUNTDOWN = 25

export const text = {
  label: { implement: 'Implement', review: 'Review' } satisfies Record<PlanStep['key'], string>,
  status: {
    [TaskStatus.Running]: 'Running',
    [TaskStatus.Yours]: 'Needs you',
    [TaskStatus.Done]: 'Ready',
    [TaskStatus.Paused]: 'Paused',
    [TaskStatus.Stopped]: 'Stopped',
  } satisfies Record<TaskStatus, string>,
  now: { implement: 'Implementing', review: 'Reviewing', settle: 'Settling the review' } as Readonly<Record<string, string>>,
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
  readonly onChange: (planId: string, steps: ReadonlyArray<PlanStep>) => void
  readonly onOpen: (threadId: string) => void
}

type Plan = NonNullable<TaskCardContent['plan']>

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
  const [shown, setShown] = useState<{ readonly from: Plan; readonly steps: ReadonlyArray<PlanStep> }>({ from: plan, steps: plan.steps })
  const steps = shown.from === plan ? shown.steps : plan.steps
  const change = (next: ReadonlyArray<PlanStep>) => {
    setShown({ from: plan, steps: next })
    actions.onChange(plan.id, next)
  }
  const options = actions.agents.map((agent) => ({ value: agent.id, label: agent.name }))
  return (
    <TaskLaunch
      task={card.slug}
      title={card.title}
      project={actions.project}
      steps={launchSteps({ ...plan, steps }, (id) => actions.agentName(id))}
      onStepsChange={(next) =>
        change(steps.map((step) => ({ ...step, skipped: next.find((launch) => launch.id === step.key)?.skipped ?? step.skipped })))
      }
      picker={({ step, owner }) => (
        <Select
          label={owner}
          variant="filled"
          value={steps.find((planned) => planned.key === step.id)?.agentId ?? null}
          options={options}
          onChange={(agentId) => change(steps.map((planned) => (planned.key === step.id ? { ...planned, agentId, model: null } : planned)))}
        />
      )}
      wait={COUNTDOWN}
      {...(plan.startsAt === null ? {} : { startsAt: Date.parse(plan.startsAt) })}
      held={card.phase === 'held'}
      onHeldChange={(held) => {
        if (held) actions.onHold(plan.id)
      }}
      hideEnd
      onStart={() => actions.onStart(plan.id)}
    />
  )
}

export function Card({ card, actions }: { card: TaskCardContent; actions: CardActions }) {
  if ((card.phase === 'planned' || card.phase === 'held') && card.plan !== null)
    return <PlanCard key={card.plan.id} card={card} plan={card.plan} actions={actions} />
  const steps = (card.plan?.steps ?? []).filter((step) => !step.skipped).map((step) => text.label[step.key])
  // Settling a review's findings is part of the review.
  const at = card.step === null ? 0 : Math.max(0, steps.indexOf(text.label[card.step === 'implement' ? 'implement' : 'review']))
  const status = STATUS[card.phase]
  const now = status === TaskStatus.Done ? card.summary?.split('\n')[0] : card.step === null ? undefined : text.now[card.step]
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
      onOpen={() => actions.onOpen(card.threadId)}
      text={{ status: text.status, task: text.task }}
    />
  )
}
