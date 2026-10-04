import { Brand, type ModelInfo } from '@althar/ui'

/*
 * How an agent is drawn: its mark, and a ModelInfo for the kit's components,
 * which take one already resolved. The model's own name comes from the agent
 * (see models.ts).
 */

const BRANDS: Readonly<Record<string, Brand>> = {
  'claude-code': Brand.Anthropic,
  codex: Brand.OpenAI,
}

export const brandOf = (agentId: string): Brand | undefined => BRANDS[agentId]

/** The agent working on a task, and the model it uses, as the kit's ModelInfo. */
export const modelInfo = (agent: { readonly id: string; readonly name: string }, model: string | null): ModelInfo => {
  const mark = brandOf(agent.id)
  return {
    id: model ?? agent.id,
    name: model === null ? agent.name : `${agent.name} · ${model}`,
    // A model's own name ("default", "small") says little without the agent's.
    short: model === null ? agent.name : `${agent.name} · ${model}`,
    ...(mark === undefined ? {} : { mark }),
    runtime: agent.id,
    efforts: [],
  }
}

/** What a step held for a usage limit waits for: the agent, and when it is back. */
export const waitsWords = (agent: string, at: string) => `Waits for ${agent}, back at ${at}`
