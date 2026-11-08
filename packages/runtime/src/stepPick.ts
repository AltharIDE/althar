import { isAgentDefault, knownModelName } from '@althar/contracts'
import { Clock, Effect, Schema } from 'effect'

import { Agents } from './Config'
import { Models } from './Models'
import { blockedModelsOf } from './preferences'
import { ToolRefused } from './toolErrors'
import { describeModels, type Route, routeTo, usableModels } from './usableModels'

/*
 * A step's model, as list_models names it; or, as plans once did, an agent and its own id for the model. And how hard it
 * thinks, where named: one of the model's efforts as list_models writes them. Every tool that names an agent or a model
 * resolves it here, so each takes a name as list_models writes it or the agent's own id, and refuses one that doesn't
 * resolve at the call, with what the agent offers.
 */
export const StepPick = Schema.Struct({
  model: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  effort: Schema.optional(Schema.NullOr(Schema.String)),
})

/** An agent, by its id or its name ("claude-code", "Claude Code"); its id. */
export const agentIdOf = (asked: string): Effect.Effect<string, ToolRefused, Agents> =>
  Effect.gen(function* () {
    const agents = yield* Agents
    const wanted = asked.trim().toLowerCase()
    const found = agents.list.find(
      (entry) => entry.definition.id.toLowerCase() === wanted || entry.definition.name.toLowerCase() === wanted,
    )
    if (found !== undefined) return found.definition.id
    return yield* new ToolRefused({
      message: `Althar has no agent ${asked}. It has: ${agents.list.map((entry) => `${entry.definition.name} (${entry.definition.id})`).join(', ')}.`,
    })
  })

/**
 * A step's effort, where the plan names one: one of the levels its model
 * takes the way it goes, by its id or its name, kept as its id. Any other
 * is refused, with the ones it takes. Left out, the step starts at the
 * person's default for the model, or else at the model's own.
 */
export const effortOf = (
  named: string,
  levels: ReadonlyArray<{ readonly id: string; readonly name: string }>,
  asked: string | null | undefined,
): Effect.Effect<string | null, ToolRefused> => {
  if (asked == null) return Effect.succeed(null)
  const wanted = asked.trim().toLowerCase()
  const level = levels.find((one) => one.id.toLowerCase() === wanted || one.name.toLowerCase() === wanted)
  if (level !== undefined) return Effect.succeed(level.id)
  return Effect.fail(
    new ToolRefused({
      message:
        levels.length === 0
          ? `${named} has no effort to set. Leave effort out.`
          : `${named} has no effort ${asked}. Name one of its efforts, as list_models writes them: ${levels.map((one) => one.id).join(', ')}; or leave effort out.`,
    }),
  )
}

/**
 * A step's agent, model and effort, from what the plan names (ADR-015):
 * a model as list_models writes it, taken the best way there is; or an
 * agent, on its own id for a model or on its own default. An agent may be
 * named by its id or its name, and its model by its name or its id there.
 * With keepAgent, the agent is the one asked for, never another that offers the same model.
 */
export const stepOf = (projectId: string, pick: typeof StepPick.Type, use?: string, keepAgent = false) =>
  Effect.gen(function* () {
    const agents = yield* Agents
    // On the way it goes, at an effort that model takes there; named as the plan names it.
    const on = (route: Route, named: string) =>
      Effect.map(effortOf(named, route.efforts, pick.effort), (effort) => ({
        agentId: route.agentId,
        model: route.model,
        ...(effort === null ? {} : { effort }),
      }))
    const agentId = pick.agent === undefined ? undefined : yield* agentIdOf(pick.agent)
    if (pick.model !== undefined) {
      const route = routeTo(yield* usableModels(projectId), pick.model, agentId)
      // On the agent named, the model must go that way: another agent's route to it is not the one asked for.
      if (route !== null && (agentId === undefined || route.agentId === agentId)) return yield* on(route, pick.model)
      if (agentId === undefined)
        return yield* new ToolRefused({
          message: `No model called ${pick.model} can be used now. ${describeModels(yield* usableModels(projectId), yield* Clock.currentTimeMillis, use)}`,
        })
    }
    if (agentId === undefined)
      return yield* new ToolRefused({
        message: use === undefined ? 'Name the model, as list_models writes it.' : `Name the model, for ${use}.`,
      })
    const entry = agents.list.find((one) => one.definition.id === agentId)
    const agent = { id: agentId, name: entry?.definition.name ?? agentId }
    const offered = (yield* (yield* Models).catalog).find((one) => one.agentId === agentId)
    // The model the agent offers by that name or id; refused, with the ones it offers, where it offers none such. An agent whose models aren't known takes it as named.
    let model = pick.model
    let known = pick.model === undefined ? undefined : offered?.models.find((one) => one.id === pick.model)
    if (pick.model !== undefined && offered !== undefined && offered.models.length > 0) {
      const wanted = pick.model.trim().toLowerCase()
      known =
        offered.models.find((one) => one.id.toLowerCase() === wanted) ??
        offered.models.find((one) => !isAgentDefault(one) && knownModelName(agent, one).toLowerCase() === wanted)
      if (known === undefined) {
        const names = offered.models.filter((one) => !isAgentDefault(one)).map((one) => `${knownModelName(agent, one)} (${one.id})`)
        return yield* new ToolRefused({
          message: `${agent.name} doesn't offer ${pick.model}.${names.length === 0 ? '' : ` It offers: ${names.join(', ')}.`} Name one as list_models writes it, or its id.`,
        })
      }
      model = known.id
    }
    // Named the old way, by agent, a model the person switched off is still off: the same model another way, by the name people know it by, or none.
    if (model !== undefined && (yield* blockedModelsOf(agentId)).includes(model)) {
      // Where the agent is the one asked for (a step handed on), the model isn't taken to another.
      const elsewhere = known === undefined || keepAgent ? null : routeTo(yield* usableModels(projectId), knownModelName(agent, known))
      if (elsewhere !== null) return yield* on(elsewhere, model)
      return yield* new ToolRefused({
        message: `The person switched ${model} off for ${agent.name}. ${describeModels(yield* usableModels(projectId), yield* Clock.currentTimeMillis, use)}`,
      })
    }
    // Its efforts as the agent offers that model; on its own default, they aren't known, so none is taken.
    const levels = pick.effort == null || known === undefined ? [] : known.efforts
    const effort = yield* effortOf(pick.model ?? `${agent.name}'s default model`, levels, pick.effort)
    return { agentId, model: model ?? null, ...(effort === null ? {} : { effort }) }
  })
