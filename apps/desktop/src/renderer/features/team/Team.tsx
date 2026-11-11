import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import type { AgentStatus, BoardTask, PlanStep, TaskEnd as End } from '@althar/contracts'
import { IconButton, Menu, MenuItem, modelRoomText, TeamDialog, UsageTone, usageTone } from '@althar/ui'

import { messageOf } from '../../data/client'
import { keys, reads } from '../../data/reads'
import { useServices } from '../../data/services'
import { useEffortNames, useModelNames } from '../../shared/modelNames'
import { ModelChoice } from '../../shared/ModelChoice'
import type { Choice } from '../../shared/models'
import { stepText } from '../../shared/steps'
import { useModelRooms } from '../usage/usePlan'
import { ENDS, endOf } from '../project/Card'

/*
 * Who does a task whose plan hasn't begun, changed from wherever the task
 * shows: its row up next, its own ⋯ and its composer's model picker. The same
 * plan the coordinator's plan card changes, through the same commands:
 * ChangePlan, then StartPlan for one that starts now. A plan held or on its
 * countdown can change and start; one started whose first step waits for a
 * free agent, nothing of it begun, can still change (`planWaits`), as its
 * card says. Once it has begun, its team still changes until it is settled, through
 * ChangeTeam: its lead from its next turn, its reviewer until its review round
 * starts, from the next round during one, and not once its review is done. Merged,
 * it stays as it is.
 */

export const text = {
  /** A row's menu, named apart from the task's own ⋯ in its header. */
  more: 'The team',
  menu: 'The team',
  start: 'Start',
  hold: 'Hold',
  change: 'Change the team…',
  /** The team in a line, at the head of a row's menu: Opus 5.5 · High, GPT-6.1 Sol reviews. */
  team: (lead: string, review: string | null) => (review === null ? lead : `${lead}, ${review}`),
  reviews: (name: string) => `${name} reviews`,
  noReview: 'no review',
  /** Its team can't change any more: it started with the team it had. */
  begun: 'It started with the team it had.',
  /** A task that has begun: when each change takes effect. */
  nextTurn: 'From its next turn.',
  nextRound: 'From the next round.',
  reviewDone: 'The review is done, so the reviewer stays.',
  merged: 'It’s merged, so its team stays.',
  settled: 'It’s settled, so its team stays.',
}

type Plan = NonNullable<BoardTask['plan']>

/** A task whose team can change, as the board reads it. */
export type Teamed = Pick<
  BoardTask,
  'taskId' | 'title' | 'phase' | 'plan' | 'planWaits' | 'queued' | 'reviewing' | 'kind' | 'change' | 'reviewerChange'
> &
  Partial<Pick<BoardTask, 'holdable'>>

/**
 * Whether its plan can be held, as its card does: on its countdown, or started with its first step still waiting for a free
 * agent or, Local, its checkout, nothing of it begun (`holdable`). Holding takes it out of the line until the person
 * starts it.
 */
export const canHold = (task: Teamed): boolean => task.plan !== null && (task.phase === 'planned' || task.holdable === true)

/**
 * What changing its team does where it stands: `starts`, a plan held or on its countdown, which can start now too; `waits`,
 * started, its first step waiting for a free agent with nothing begun, which only changes; `begun`, at work or after, which
 * changes its lead from its next turn and its reviewer while its review allows. Null where its team can't change: a task
 * settled or abandoned.
 */
export const teamChangeOf = (task: Teamed): 'starts' | 'waits' | 'begun' | null => {
  if (task.plan === null) return null
  if (task.phase === 'planned' || task.phase === 'held') return 'starts'
  if (task.planWaits === true && task.queued !== null) return 'waits'
  return task.phase === 'drafting' || task.phase === 'settled' ? null : 'begun'
}

/** A task of a project's board whose team can change, by its id; null while the board is read, or where it can't, or with no task. */
export const useTeamed = (projectId: string | null, taskId: string | null): Teamed | null => {
  const { client } = useServices()
  const board = useQuery({ ...reads(client).board(projectId ?? ''), enabled: projectId !== null })
  const task = board.data?.tasks.find((one) => one.taskId === taskId)
  return task === undefined || teamChangeOf(task) === null ? null : task
}

/** Its team in a line: who leads, how hard, with how much is left of its plan where that is nearly out, and who reviews. */
const useTeamLine = (plan: Plan, projectId: string) => {
  const named = useModelNames()
  const effortOf = useEffortNames()
  const roomOf = useModelRooms(projectId)
  const lead = plan.steps.find((step) => step.key === 'implement')
  const review = plan.steps.find((step) => step.key === 'review')
  if (lead === undefined) return null
  const leadInfo = named(lead.agentId, lead.model)
  const effort = effortOf(lead.agentId, lead.model, lead.effort ?? null)
  const room = roomOf(leadInfo)
  // Said as the picker's chip says it, once nearly out: 9% left · until 17:10, Out · until 18:00.
  const low =
    room == null ||
    usageTone(room.left) === UsageTone.Plenty ||
    usageTone(room.left) === UsageTone.Half ||
    usageTone(room.left) === UsageTone.Low
      ? null
      : `${room.left === 0 ? modelRoomText.chipOut : modelRoomText.chipLeft(room.left)}${room.until === null ? '' : ` · ${modelRoomText.until(room.until)}`}`
  const leadWords = `${leadInfo.name}${effort === null ? '' : ` · ${effort}`}${low === null ? '' : ` (${low})`}`
  return text.team(
    leadWords,
    review === undefined ? null : review.skipped ? text.noReview : text.reviews(named(review.agentId, review.model).name),
  )
}

/** A row's menu, up next: who's on it, then Start where it starts now, Hold where it can be held, and Change the team…. */
export function TeamMenu({
  projectId,
  task,
  onStart,
  onHold,
  onChange,
}: {
  projectId: string
  task: Teamed
  onStart?: () => void
  onHold?: () => void
  onChange: () => void
}) {
  const line = useTeamLine(task.plan!, projectId)
  return (
    <Menu
      trigger={<IconButton icon="more" size="small" label={text.more} />}
      label={text.menu}
      align="end"
      width={320}
      {...(line === null ? {} : { note: line })}
    >
      {onStart !== undefined && (
        <MenuItem icon="play" onSelect={onStart}>
          {text.start}
        </MenuItem>
      )}
      {onHold !== undefined && (
        <MenuItem icon="hold" onSelect={onHold}>
          {text.hold}
        </MenuItem>
      )}
      <MenuItem icon="agents" onSelect={onChange}>
        {text.change}
      </MenuItem>
    </Menu>
  )
}

const choiceOf = (step: PlanStep): Choice => ({ agentId: step.agentId, model: step.model, effort: step.effort ?? null })

/** What the person changed of each step, laid on the plan as it is now: what someone else changed meanwhile stays. */
type Edits = Partial<Record<PlanStep['key'], Partial<PlanStep>>>
const withEdits = (steps: ReadonlyArray<PlanStep>, edits: Edits) => steps.map((step) => ({ ...step, ...edits[step.key] }))

/**
 * The team, in a dialog: each step's picker, the composer's own, and how the work ends, kept until the person saves. A plan
 * held or on its countdown can start with it at once; one on its countdown is held as the dialog opens, so it doesn't start
 * with the team it had while the person changes it. `task` is the task as its board reads it now, null once its team can't
 * change: then it says so, rather than going with what the person picked.
 */
export function ChangeTeam({
  projectId,
  task,
  agents,
  onClose,
}: {
  projectId: string
  task: Teamed | null
  agents: ReadonlyArray<AgentStatus>
  onClose: () => void
}) {
  const { client, cache } = useServices()
  const named = useModelNames()
  // The task as it opened: what the dialog shows once it can no longer change.
  const [first] = useState(task)
  const [edits, setEdits] = useState<Edits>({})
  const [end, setEnd] = useState<End | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const firstPlan = first?.plan ?? null
  useEffect(() => {
    // Its countdown stops while its team is changed: held, it starts when the person says.
    if (first?.phase === 'planned' && firstPlan !== null) void client.holdPlan(firstPlan.id).catch(() => undefined)
  }, [client, first, firstPlan])
  if (first === null || firstPlan === null) return null
  const now = task ?? first
  const plan = now.plan ?? firstPlan
  const how = task === null ? null : teamChangeOf(task)
  // A task that has begun changes through ChangeTeam, until it is merged or settled.
  const begun = teamChangeOf(first) === 'begun'
  const merged = begun && now.change?.state === 'merged'
  const gone = how === null || merged
  // A plan made with no review has no review step: a change that can still have one shows it, off, for the person to add.
  const lead = plan.steps.find((step) => step.key === 'implement')
  const addable =
    begun &&
    now.kind === 'change' &&
    now.reviewing == null &&
    now.reviewerChange !== 'never' &&
    !plan.steps.some((step) => step.key === 'review')
  const given: ReadonlyArray<PlanStep> =
    addable && lead !== undefined
      ? [
          ...plan.steps,
          {
            key: 'review',
            agentId: agents.map((one) => one.id).find((id) => id !== lead.agentId) ?? lead.agentId,
            model: null,
            skipped: true,
          },
        ]
      : plan.steps
  const steps = withEdits(given, edits)
  const ending = end === undefined ? plan.end : end
  const put = (key: PlanStep['key'], patch: Partial<PlanStep>) => setEdits((was) => ({ ...was, [key]: { ...was[key], ...patch } }))
  const save = async (andStart: boolean) => {
    setBusy(true)
    setError(null)
    try {
      if (begun) await client.changeTeam(now.taskId, steps)
      else {
        await client.changePlan(plan.id, steps, ending)
        if (andStart) await client.startPlan(plan.id)
      }
      void cache.invalidateQueries({ queryKey: keys.board(projectId) })
      onClose()
    } catch (failure) {
      setError(messageOf(failure))
      setBusy(false)
    }
  }
  // A review its task has, or a change that can still have one; a plain task or a review shows only what it has.
  const reviewShown = (step: PlanStep) =>
    !begun || (now.reviewing == null && (!step.skipped ? true : now.kind === 'change' && now.reviewerChange !== 'never'))
  const reviews = now.reviewing != null
  const label = (key: PlanStep['key']) => stepText.label[reviews ? 'review' : key]
  return (
    <TeamDialog
      task={now.title}
      steps={steps
        .filter((step) => step.key !== 'review' || reviewShown(step))
        .map((step) => {
          const locked = begun && step.key === 'review' && now.reviewerChange === 'never'
          return {
            id: step.key,
            label: label(step.key),
            picker: (
              <ModelChoice
                owner={label(step.key)}
                agents={agents}
                projectId={projectId}
                value={choiceOf(step)}
                onChange={(choice) => put(step.key, { ...choice, skipped: false })}
                {...(step.key === 'review' ? { onRemove: () => put('review', { skipped: true }) } : {})}
                variant="field"
                placement="below"
              />
            ),
            ...(locked ? { locked: named(step.agentId, step.model).name } : {}),
            ...(begun
              ? {
                  why: locked
                    ? text.reviewDone
                    : step.key === 'implement'
                      ? text.nextTurn
                      : now.reviewerChange === 'next_round'
                        ? text.nextRound
                        : undefined,
                }
              : step.key === 'implement' && plan.reason !== null
                ? { why: plan.reason }
                : {}),
            skipped: step.skipped,
            ...(step.key === 'review' && !locked ? { onAdd: () => put('review', { skipped: false }) } : {}),
          }
        })}
      // Where the repository's host isn't connected, the task ends on its branch, and there is no ending to pick; a task
      // that has begun keeps the ending it has.
      {...(ending === null || begun ? {} : { end: { value: ENDS[ending], onChange: (next) => setEnd(endOf(next)) } })}
      {...(gone ? {} : { onSave: () => void save(false) })}
      {...(!gone && how === 'starts' ? { onStart: () => void save(true) } : {})}
      onClose={onClose}
      busy={busy}
      error={merged ? text.merged : how === null ? (begun ? text.settled : text.begun) : error}
    />
  )
}
