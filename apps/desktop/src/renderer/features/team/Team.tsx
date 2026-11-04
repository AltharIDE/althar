import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import type { AgentStatus, BoardTask, PlanStep, TaskEnd as End } from '@althar/contracts'
import { IconButton, Menu, MenuItem, TeamDialog } from '@althar/ui'

import { messageOf } from '../../data/client'
import { keys, reads } from '../../data/reads'
import { useServices } from '../../data/services'
import { useEffortNames, useModelNames } from '../../shared/modelNames'
import { ModelChoice } from '../../shared/ModelChoice'
import type { Choice } from '../../shared/models'
import { stepText } from '../../shared/steps'
import { ENDS, endOf } from '../project/Card'

/*
 * Who does a task whose plan hasn't begun, changed from wherever the task
 * shows: its row up next, its own ⋯ and its composer's model picker. The same
 * plan the coordinator's plan card changes, through the same commands:
 * ChangePlan, then StartPlan for one that starts now. A plan held or on its
 * countdown can change and start; one started whose first step waits for a
 * free agent, nothing of it begun, can still change (`planWaits`), as its
 * card says. Once its lead has worked on it, its team is the task's own.
 */

export const text = {
  more: 'More for this task',
  menu: 'This task',
  start: 'Start',
  change: 'Change the team…',
  /** The team in a line, at the head of a row's menu: Opus 5.5 · High, GPT-6.1 Sol reviews. */
  team: (lead: string, review: string | null) => (review === null ? lead : `${lead}, ${review}`),
  reviews: (name: string) => `${name} reviews`,
  noReview: 'no review',
}

type Plan = NonNullable<BoardTask['plan']>

/** A task whose team can change, as the board reads it. */
export type Teamed = Pick<BoardTask, 'taskId' | 'title' | 'phase' | 'plan' | 'planWaits' | 'queued' | 'reviewing'>

/**
 * What changing its team does where it stands: `starts`, a plan held or on its countdown, which can start now too; `waits`,
 * started, its first step waiting for a free agent with nothing begun, which only changes. Null where its team can't change.
 */
export const teamChangeOf = (task: Teamed): 'starts' | 'waits' | null => {
  if (task.plan === null) return null
  if (task.phase === 'planned' || task.phase === 'held') return 'starts'
  return task.planWaits === true && task.queued !== null ? 'waits' : null
}

/** A task of a project's board whose team can change, by its id; null while the board is read, or where it can't, or with no task. */
export const useTeamed = (projectId: string | null, taskId: string | null): Teamed | null => {
  const { client } = useServices()
  const board = useQuery({ ...reads(client).board(projectId ?? ''), enabled: projectId !== null })
  const task = board.data?.tasks.find((one) => one.taskId === taskId)
  return task === undefined || teamChangeOf(task) === null ? null : task
}

/** Its team in a line: who leads, how hard, and who reviews. */
const useTeamLine = (plan: Plan) => {
  const named = useModelNames()
  const effortOf = useEffortNames()
  const lead = plan.steps.find((step) => step.key === 'implement')
  const review = plan.steps.find((step) => step.key === 'review')
  if (lead === undefined) return null
  const effort = effortOf(lead.agentId, lead.model, lead.effort ?? null)
  const leadWords = effort === null ? named(lead.agentId, lead.model).name : `${named(lead.agentId, lead.model).name} · ${effort}`
  return text.team(
    leadWords,
    review === undefined ? null : review.skipped ? text.noReview : text.reviews(named(review.agentId, review.model).name),
  )
}

/** A row's menu, up next: who's on it, then Start where it starts now, and Change the team…. */
export function TeamMenu({ task, onStart, onChange }: { task: Teamed; onStart?: () => void; onChange: () => void }) {
  const line = useTeamLine(task.plan!)
  return (
    <Menu
      trigger={<IconButton icon="more" size="small" label={text.more} />}
      label={text.menu}
      align="end"
      width={300}
      {...(line === null ? {} : { note: line })}
    >
      {onStart !== undefined && (
        <MenuItem icon="play" onSelect={onStart}>
          {text.start}
        </MenuItem>
      )}
      <MenuItem icon="agents" onSelect={onChange}>
        {text.change}
      </MenuItem>
    </Menu>
  )
}

const choiceOf = (step: PlanStep): Choice => ({ agentId: step.agentId, model: step.model, effort: step.effort ?? null })

/**
 * The team, in a dialog: each step's picker, the composer's own, and how the work ends, kept until the person saves. A plan
 * held or on its countdown can start with it at once.
 */
export function ChangeTeam({
  projectId,
  task,
  agents,
  onClose,
}: {
  projectId: string
  task: Teamed
  agents: ReadonlyArray<AgentStatus>
  onClose: () => void
}) {
  const { client, cache } = useServices()
  const plan = task.plan!
  const [steps, setSteps] = useState<ReadonlyArray<PlanStep>>(plan.steps)
  const [end, setEnd] = useState<End | null>(plan.end)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Only the agents the plan allows: a review's lead only reads, so an agent that can't be held to that isn't offered.
  const allowed = plan.agents
  const offered = allowed === undefined ? agents : agents.filter((agent) => allowed.includes(agent.id))
  const put = (key: PlanStep['key'], patch: Partial<PlanStep>) =>
    setSteps((was) => was.map((step) => (step.key === key ? { ...step, ...patch } : step)))
  const save = async (andStart: boolean) => {
    setBusy(true)
    setError(null)
    try {
      await client.changePlan(plan.id, steps, end)
      if (andStart) await client.startPlan(plan.id)
      void cache.invalidateQueries({ queryKey: keys.board(projectId) })
      onClose()
    } catch (failure) {
      setError(messageOf(failure))
      setBusy(false)
    }
  }
  const reviews = task.reviewing != null
  return (
    <TeamDialog
      task={task.title}
      steps={steps.map((step) => ({
        id: step.key,
        label: stepText.label[reviews ? 'review' : step.key],
        picker: (
          <ModelChoice
            owner={stepText.label[step.key]}
            agents={offered}
            projectId={projectId}
            value={choiceOf(step)}
            onChange={(choice) => put(step.key, { ...choice, skipped: false })}
            {...(step.key === 'review' ? { onRemove: () => put('review', { skipped: true }) } : {})}
            variant="field"
            placement="below"
          />
        ),
        ...(step.key === 'implement' && plan.reason !== null ? { why: plan.reason } : {}),
        skipped: step.skipped,
        ...(step.key === 'review' ? { onAdd: () => put('review', { skipped: false }) } : {}),
      }))}
      // Where the repository's host isn't connected, the task ends on its branch, and there is no ending to pick.
      {...(end === null ? {} : { end: { value: ENDS[end], onChange: (next) => setEnd(endOf(next)) } })}
      onSave={() => void save(false)}
      {...(teamChangeOf(task) === 'starts' ? { onStart: () => void save(true) } : {})}
      onClose={onClose}
      busy={busy}
      error={error}
    />
  )
}
