import { knownModelName } from '@althar/contracts'
import { Effect, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { Agents } from './Config'
import { Instance } from './Instance'
import { Models } from './Models'
import { PlanParameters, type PlanStep, type TaskEnd } from './Runs'

/*
 * What became of the coordinator's plans while it wasn't speaking: the
 * person changed who does a task's steps or how it ends, held it, started
 * or declined it, or its time came and it started. The coordinator proposed
 * each plan and moved on; the card is the person's to change, and nothing
 * else tells it. Read before what the person says next, it speaks of each
 * plan as it now is, not as it proposed it.
 */

/** The plan events the coordinator hears of, by what each did. */
const HEARD = ['task_plan.changed', 'task_plan.held', 'task_plan.accepted', 'task_plan.declined'] as const

const endWords = (end: TaskEnd | null | undefined) => {
  switch (end) {
    case 'draft':
      return 'it ends as a draft pull request'
    case 'ready':
      return 'it ends as a pull request ready for review'
    case 'none':
      return 'it ends with its branch pushed'
    case null:
    case undefined:
      return 'it ends on its branch, with nothing sent to the host'
  }
}

/** The coordinator's news since its last turn on the thread, or null with none: nothing changed, or it has never spoken. */
export const coordinatorNews = (threadId: string, projectId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const instance = yield* Instance
    const [last] = yield* sql<{ at: string | null }>`SELECT max(requested_at) AS at FROM turn_deliveries WHERE thread_id = ${threadId}`
    if (last?.at === null || last?.at === undefined) return null
    const events = yield* sql<{ planId: string; type: (typeof HEARD)[number]; actorId: string }>`
      SELECT aggregate_id AS plan_id, type, actor_id FROM record_events
      WHERE project_id = ${projectId} AND aggregate_type = 'task_plan' AND occurred_at > ${last.at} AND type IN ${sql.in(HEARD)}
      ORDER BY sequence`
    if (events.length === 0) return null

    const agents = yield* Agents
    const catalog = yield* (yield* Models).catalog
    /** A step's model as people know it, from what its agent offers; its id where the agent doesn't say. */
    const modelOf = (step: PlanStep) => {
      const entry = agents.list.find((one) => one.definition.id === step.agentId)
      const agent = { id: step.agentId, name: entry?.definition.name ?? step.agentId }
      const model = catalog.find((one) => one.agentId === step.agentId)?.models.find((one) => one.id === step.model)
      const name = model === undefined ? (step.model === null ? `${agent.name}'s default model` : step.model) : knownModelName(agent, model)
      return step.effort === undefined || step.effort === null ? name : `${name} (effort ${step.effort})`
    }
    const team = (parameters: PlanParameters) => {
      const lead = parameters.steps.find((step) => step.key === 'implement')
      const review = parameters.steps.find((step) => step.key === 'review')
      return [
        lead === undefined ? 'no lead' : `${modelOf(lead)} leads`,
        review === undefined || review.skipped ? 'no review' : `${modelOf(review)} reviews`,
      ].join(', ')
    }
    const decode = Schema.decodeUnknownSync(Schema.fromJsonString(PlanParameters))

    const lines: Array<string> = []
    for (const planId of new Set(events.map((event) => event.planId))) {
      const mine = events.filter((event) => event.planId === planId)
      const [plan] = yield* sql<{
        state: string
        startsAt: string | null
        parameters: string
        slug: string
        title: string
        taskState: string
      }>`
        SELECT p.state, p.starts_at, p.parameters, k.slug, k.title, k.state AS task_state
        FROM task_plans p JOIN tasks k ON k.id = p.task_id WHERE p.id = ${planId}`
      // A plan replaced since by another of the task's is told by the newer one.
      if (plan === undefined || plan.state === 'replaced') continue
      const [proposed] = yield* sql<{ payload: string; actorId: string }>`
        SELECT payload, actor_id FROM record_events WHERE aggregate_id = ${planId} AND type = 'task_plan.proposed'`
      const now = decode(plan.parameters)
      const said: Array<string> = []
      if (mine.some((event) => event.type === 'task_plan.changed' && event.actorId !== instance.coordinatorId)) {
        const before = proposed === undefined ? undefined : decode(proposed.payload)
        const was = proposed?.actorId === instance.coordinatorId ? 'you proposed' : 'it was'
        const ends = (before?.end ?? null) !== (now.end ?? null)
        said.push(
          before === undefined
            ? `The person changed its plan. Now ${team(now)}; ${endWords(now.end)}.`
            : `The person changed its plan: ${was} ${team(before)}${ends ? `, and ${endWords(before.end)}` : ''}. Now ${team(now)}${ends ? `, and ${endWords(now.end)}` : ''}.`,
        )
      }
      if (plan.state === 'accepted')
        said.push(
          plan.taskState === 'done'
            ? 'It has started and is done.'
            : plan.taskState === 'abandoned'
              ? 'It started, and the person abandoned it.'
              : 'It has started.',
        )
      else if (plan.state === 'declined') said.push('It was declined: it won’t run.')
      else if (plan.state === 'proposed' && plan.startsAt === null) said.push('The person is holding it: it waits until they start it.')
      if (said.length > 0) lines.push(`- ${plan.slug} (${plan.title}): ${said.join(' ')}`)
    }
    if (lines.length === 0) return null
    return `Since you last spoke, in Althar:\n${lines.join('\n')}\nSpeak of these plans as they are now, not as they were proposed.`
  })
