import { Effect, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { Agents } from './Config'
import { blockedModelsOf } from './preferences'
import { PlanParameters, type PlanStep } from './Runs'
import { SignIns } from './SignIns'

/*
 * Auto (ADR-097): who does a task the person starts without picking, as the
 * project's composer starts one while its coordinator is off. The team the
 * project's last planned task had, step by step, where each step's agent
 * can still work and its model isn't switched off: the person's usual lead
 * and reviewer, as the coordinator would have planned them. A step whose
 * agent can't goes; a lead that can't is the first agent that can, on its
 * own model. Nothing where no agent can work.
 */

/** No agent can work, so Auto has no one to give a task. */
export class NoAgentCanWork extends Schema.TaggedError<NoAgentCanWork>()('NoAgentCanWork', {}) {}

/** How many of the project's latest plans Auto looks back over for a team whose agents can work. */
const LOOKED_BACK = 20

/** The team Auto gives a new task in a project, and why, in a few words for its card; null where no agent can work. */
export const autoTeam = (projectId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const agents = yield* Agents
    const signIns = yield* SignIns
    const can = (step: PlanStep) =>
      Effect.gen(function* () {
        if (!agents.list.some((entry) => entry.definition.id === step.agentId)) return false
        if ((yield* signIns.of(step.agentId)) === 'signed_out') return false
        return step.model === null || !(yield* blockedModelsOf(step.agentId)).includes(step.model)
      })
    const plans = yield* sql<{ parameters: string }>`
      SELECT parameters FROM task_plans WHERE project_id = ${projectId} ORDER BY proposed_at DESC, rowid DESC LIMIT ${LOOKED_BACK}`
    for (const plan of plans) {
      const read = Schema.decodeUnknownOption(Schema.fromJsonString(PlanParameters))(plan.parameters)
      if (read._tag === 'None') continue
      const lead = read.value.steps.find((step) => step.key === 'implement' && !step.skipped)
      if (lead === undefined || !(yield* can(lead))) continue
      const review = read.value.steps.find((step) => step.key === 'review' && !step.skipped)
      const steps: ReadonlyArray<PlanStep> = [
        { ...lead, skipped: false },
        ...(review !== undefined && (yield* can(review)) ? [{ ...review, skipped: false }] : []),
      ]
      return { steps, reason: 'Auto: the team of the project’s last task' }
    }
    for (const entry of agents.list) {
      const step: PlanStep = { key: 'implement', agentId: entry.definition.id, model: null, skipped: false }
      if (yield* can(step)) return { steps: [step], reason: `Auto: ${entry.definition.name}, on its own model` }
    }
    return null
  })
