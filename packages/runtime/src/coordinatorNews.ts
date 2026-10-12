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
 * or declined it, or its time came and it started. And of the issues it
 * drafted: the person changed one, filed it or discarded it, or filing it
 * failed. The coordinator proposed each plan and drafted each issue and moved
 * on; the cards are the person's, and nothing else tells it. Read before
 * what the person says next, it speaks of each as it now is, not as it
 * proposed or drafted it.
 *
 * What it has been told is counted by the ledger's order, not by the clock:
 * the news is everything after the record of the turn before, read in the
 * same transaction that records this turn, so nothing lands between what it
 * is told now and where the next turn's news starts.
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

/** A step's model as people know it, from what its agent offers; its id where the agent doesn't say. */
export type ModelNamer = (step: PlanStep) => string

/** Names each step's model from every agent's models, as far as they are known: read before the turn is recorded, as asking an agent may take a while. */
export const modelNamer = Effect.gen(function* () {
  const agents = yield* Agents
  const catalog = yield* (yield* Models).catalog
  return (step: PlanStep) => {
    const entry = agents.list.find((one) => one.definition.id === step.agentId)
    const agent = { id: step.agentId, name: entry?.definition.name ?? step.agentId }
    const model = catalog.find((one) => one.agentId === step.agentId)?.models.find((one) => one.id === step.model)
    return model === undefined ? (step.model === null ? `${agent.name}'s default model` : step.model) : knownModelName(agent, model)
  }
})

/** A step's effort, by the id the coordinator's tools take; without one, it starts at the person's default for its model, or the model's own. */
const effortWords = (effort: string | null | undefined) => (effort == null ? 'default effort' : `effort ${effort}`)

/**
 * The coordinator's news since its last turn on the thread, or null with
 * none: nothing changed, or it has never spoken. Read in the transaction
 * that records the turn it goes with.
 */
export const coordinatorNews = (threadId: string, projectId: string, modelOf: ModelNamer) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const instance = yield* Instance
    // Where the turn before was recorded, in the ledger's order.
    const [last] = yield* sql<{ sequence: number | null }>`
      SELECT max(e.sequence) AS sequence FROM record_events e JOIN turn_deliveries d ON d.id = e.aggregate_id
      WHERE e.aggregate_type = 'turn_delivery' AND e.type = 'turn_delivery.requested' AND d.thread_id = ${threadId}`
    if (last?.sequence === null || last?.sequence === undefined) return null
    const events = yield* sql<{ planId: string; type: (typeof HEARD)[number]; actorId: string }>`
      SELECT aggregate_id AS plan_id, type, actor_id FROM record_events
      WHERE project_id = ${projectId} AND aggregate_type = 'task_plan' AND sequence > ${last.sequence} AND type IN ${sql.in(HEARD)}
      ORDER BY sequence`
    const drafts = yield* draftNews(projectId, last.sequence)
    if (events.length === 0 && drafts.length === 0) return null

    /** Who does a plan's steps; each step's effort too where it isn't what the other plan gives it, as its ending is said only where it changed. */
    const team = (parameters: PlanParameters, other: PlanParameters) => {
      const named = (step: PlanStep) => {
        const was = other.steps.find((one) => one.key === step.key)
        return (was?.effort ?? null) === (step.effort ?? null) ? modelOf(step) : `${modelOf(step)} (${effortWords(step.effort)})`
      }
      // Every plan has its lead; a review may be left out, or skipped.
      const review = parameters.steps.find((step) => step.key === 'review' && !step.skipped)
      return [
        ...parameters.steps.filter((step) => step.key === 'implement').map((lead) => `${named(lead)} leads`),
        review === undefined ? 'no review' : `${named(review)} reviews`,
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
        // Every plan is recorded as it is proposed: what it was then.
        const before = decode(proposed?.payload ?? plan.parameters)
        const was = proposed?.actorId === instance.coordinatorId ? 'you proposed' : 'it was'
        const ends = (before.end ?? null) !== (now.end ?? null)
        said.push(
          `The person changed its plan: ${was} ${team(before, now)}${ends ? `, and ${endWords(before.end)}` : ''}. Now ${team(now, before)}${ends ? `, and ${endWords(now.end)}` : ''}.`,
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
    if (lines.length === 0 && drafts.length === 0) return null
    const close =
      drafts.length === 0
        ? 'Speak of these plans as they are now, not as they were proposed.'
        : lines.length === 0
          ? 'Speak of these issues as they are now, not as you drafted them.'
          : 'Speak of these plans and issues as they are now, not as you proposed or drafted them.'
    return `Since you last spoke, in Althar:\n${[...lines, ...drafts].join('\n')}\n${close}`
  })

/** The issue draft events the coordinator hears of: the person changed one, filed it, or discarded it; or filing it failed, or may have. */
const DRAFTED = [
  'issue_draft.changed',
  'issue_draft.filed',
  'issue_draft.failed',
  'issue_draft.uncertain',
  'issue_draft.discarded',
] as const

/** What became of the issues the coordinator drafted, since a place in the ledger: a line for each, as it now stands. */
const draftNews = (projectId: string, since: number) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const instance = yield* Instance
    const events = yield* sql<{ draftId: string; type: (typeof DRAFTED)[number]; actorId: string }>`
      SELECT aggregate_id AS draft_id, type, actor_id FROM record_events
      WHERE project_id = ${projectId} AND aggregate_type = 'issue_draft' AND sequence > ${since} AND type IN ${sql.in(DRAFTED)}
      ORDER BY sequence`
    const lines: Array<string> = []
    for (const draftId of new Set(events.map((event) => event.draftId))) {
      const mine = events.filter((event) => event.draftId === draftId)
      const [draft] = yield* sql<{
        title: string
        state: string
        containerName: string
        trackerName: string
        issueKey: string | null
        issueUrl: string | null
        error: string | null
        drafted: string | null
        doubted: number
      }>`
        SELECT d.title, d.state, d.container_name, d.tracker_name, d.issue_key, d.issue_url, d.error,
          (SELECT json_extract(payload, '$.title') FROM record_events WHERE aggregate_id = d.id AND type = 'issue_draft.drafted') AS drafted,
          -- Whether a try to file it ever ended unsure: that issue may be on the tracker, whatever became of the draft since.
          EXISTS (SELECT 1 FROM record_events WHERE aggregate_id = d.id AND type = 'issue_draft.uncertain') AS doubted
        FROM issue_drafts d WHERE d.id = ${draftId}`
      if (draft === undefined) continue
      const tracker = draft.trackerName
      // Changed by the person, it is told by what it says now, and what it said when drafted.
      const changed = mine.some((event) => event.type === 'issue_draft.changed' && event.actorId !== instance.coordinatorId)
      const was = changed && draft.drafted !== null && draft.drafted !== draft.title ? ` (you drafted it as “${draft.drafted}”)` : ''
      const edited = changed ? ' The person changed it before filing it.' : ''
      if (draft.state === 'filed')
        lines.push(
          `- The issue “${draft.title}”${was} is filed on ${tracker}, in ${draft.containerName}, as ${draft.issueKey ?? ''}: ${draft.issueUrl ?? ''}.${edited}`,
        )
      else if (draft.state === 'discarded')
        lines.push(
          draft.doubted === 1
            ? `- The person discarded the issue “${draft.title}”${was} without filing it again. An earlier try may have reached ${tracker} before its answer was lost, so it may be there; Althar doesn’t know.`
            : `- The person discarded the issue “${draft.title}”${was}: nothing was filed.`,
        )
      else if (draft.state === 'failed')
        lines.push(
          `- The issue “${draft.title}”${was} couldn’t be filed on ${tracker}: ${draft.error ?? ''} The person can file it again from its card.`,
        )
      else if (draft.state === 'uncertain')
        lines.push(
          `- The issue “${draft.title}”${was} may or may not be on ${tracker}: ${draft.error ?? ''} The person decides once they have looked.`,
        )
      else if (changed)
        lines.push(`- The person changed the issue you drafted${was}: it now reads “${draft.title}”, and waits on them to file it.`)
    }
    return lines
  })
