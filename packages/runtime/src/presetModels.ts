import { NEARLY_OUT } from './Limits'
import type { Route, UsableModel } from './usableModels'

/*
 * The models a preset's plan takes (`planFromPreset`): the agent's own id for a model the preset names, and a reviewer where it
 * needs one and names none, picked as the coordinator picks one (another maker's than the lead's, the strongest that can be
 * used), never the lead's own model.
 */

/** An agent and a model there, as a step names them; a null model is the agent's own. */
export interface ModelPick {
  readonly agentId: string
  readonly model: string | null
}

/** What a preset's plan needs of the models Althar can use now. */
export interface PresetModels {
  /** A model the preset names, as its agent lists it: `claude-opus-5-5` is the `claude-opus-5` Claude Code offers. Itself where it isn't listed. */
  readonly named: (pick: ModelPick) => ModelPick
  /** A model as people know it (Claude Opus 5.5), from what the agents offer; null where none of them offers it. */
  readonly nameOf: (pick: ModelPick) => string | null
  /**
   * A reviewer for a lead: the plan's own where it is another maker's than the lead's, else the strongest model of another maker that
   * can be used, else any other than the lead's own. Null where no model but the lead's can be used.
   */
  readonly reviewerFor: (lead: ModelPick, planned: ModelPick | undefined) => ModelPick | null
}

/** A model's words without what ids and names write differently: `claude-opus-5-5`, `Claude Opus 5.5` and `anthropic/claude-opus-5.5` are one. */
const squash = (words: string): string => words.toLowerCase().replace(/[^a-z0-9]+/g, '')

/** Whether a model goes by these words: its id on any agent, its name as people know it, or its id in the scores' list. */
const goesBy = (model: UsableModel, words: string): boolean => {
  const wanted = squash(words.slice(words.lastIndexOf('/') + 1))
  if (wanted === '') return false
  return (
    squash(model.name) === wanted ||
    (model.fact !== null && squash(model.fact.slug.slice(model.fact.slug.lastIndexOf('/') + 1)) === wanted) ||
    model.routes.some((route) => squash(route.model.slice(route.model.lastIndexOf('/') + 1)) === wanted)
  )
}

/** The usable model a pick is: by its agent's own id for it, else by its name, either way written as the list writes it. */
const modelOf = (usable: ReadonlyArray<UsableModel>, pick: ModelPick): UsableModel | undefined => {
  if (pick.model === null) return undefined
  const model = pick.model
  return (
    usable.find((one) => one.routes.some((route) => route.agentId === pick.agentId && route.model === model)) ??
    usable.find((one) => one.routes.some((route) => route.agentId === pick.agentId) && goesBy(one, model))
  )
}

const nearlyOut = (route: Route | undefined) => route?.room != null && route.room.leftPercent < NEARLY_OUT

export const presetModels = (usable: ReadonlyArray<UsableModel>): PresetModels => {
  const named = (pick: ModelPick): ModelPick => {
    const route = modelOf(usable, pick)?.routes.find((one) => one.agentId === pick.agentId)
    return route === undefined ? pick : { agentId: route.agentId, model: route.model }
  }
  const routeOf = (model: UsableModel, agentId?: string): ModelPick => {
    const route = model.routes.find((one) => one.agentId === agentId) ?? model.routes[0]!
    return { agentId: route.agentId, model: route.model }
  }
  return {
    named,
    nameOf: (pick) => modelOf(usable, pick)?.name ?? null,
    reviewerFor: (lead, planned) => {
      const own = modelOf(usable, lead)
      const apart = (model: UsableModel) => model !== own && (own?.maker == null || model.maker !== own.maker)
      // What the plan already has, where it stands apart from the lead.
      if (planned !== undefined) {
        const kept = modelOf(usable, planned)
        if (kept !== undefined && apart(kept)) return routeOf(kept, planned.agentId)
        // A model the list doesn't offer can't be told from the lead's by its maker: it stays unless it is the lead's own.
        if (kept === undefined && (planned.agentId !== lead.agentId || planned.model !== lead.model)) return planned
      }
      const strongest = (models: ReadonlyArray<UsableModel>) =>
        models
          .filter((model) => model.routes.length > 0 && model !== own)
          .toSorted(
            (a, b) =>
              Number(nearlyOut(a.routes[0])) - Number(nearlyOut(b.routes[0])) ||
              (b.fact?.intelligence ?? -1) - (a.fact?.intelligence ?? -1) ||
              a.name.localeCompare(b.name),
          )[0]
      const other = strongest(usable.filter(apart)) ?? strongest(usable)
      return other === undefined ? null : routeOf(other)
    },
  }
}
