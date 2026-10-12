/*
 * How a model is named where several agents' models meet: the window's
 * pickers, and what Althar says in a thread when work moves to another
 * agent. Each agent names its models for its own app, so a name can lean on
 * what that app shows around it.
 */

/** An agent's own default, as it names it ("Default (recommended)"), or an agent whose models aren't known. */
export const agentDefaultName = (agent: string) => `${agent} default`

/** The family a name leaves out, from the model's id: `GPT-` for gpt-6-sol, which its agent calls "6 Sol". */
const familyOf = (id: string): string | undefined => {
  const family = /^([a-z]+)-\d/i.exec(id.slice(id.lastIndexOf('/') + 1))?.[1]
  if (family === undefined) return undefined
  return family.length <= 3 ? `${family.toUpperCase()}-` : `${family.charAt(0).toUpperCase()}${family.slice(1)} `
}

/**
 * A model's name among every agent's models: what an agent calls its own
 * default says whose it is, a provider before a slash ("OpenCode Zen/Big
 * Pickle") is kept apart, and a name that starts at the version has its
 * family back.
 */
export const modelName = (
  agentName: string,
  model: { readonly id: string; readonly name: string },
): { readonly name: string; readonly provider: string | undefined } => {
  if (/^default\b/i.test(model.name)) return { name: agentDefaultName(agentName), provider: undefined }
  const slash = model.name.indexOf('/')
  const provider = slash > 0 ? model.name.slice(0, slash).trim() : undefined
  const name = model.name.slice(slash + 1).trim()
  const family = /^\d/.test(name) ? familyOf(model.id) : undefined
  return { name: family === undefined ? name : `${family}${name}`, provider }
}

/** The family an agent leaves out of its models' names: Claude Code calls Claude Sonnet 5.5 "Sonnet 5.5". */
const FAMILIES: Readonly<Record<string, string>> = { 'claude-code': 'Claude' }

/**
 * A model as people know it, in a list of one agent's models or of every
 * model Althar can use: its family back where the agent leaves it out
 * ("Claude Sonnet 5.5", "GPT-6 Astra"), without the provider an agent like
 * OpenCode puts before it ("GLM-5.3").
 */
export const knownModelName = (
  agent: { readonly id: string; readonly name: string },
  model: { readonly id: string; readonly name: string },
): string => {
  const { name } = modelName(agent.name, model)
  const family = FAMILIES[agent.id]
  return family === undefined || name.toLowerCase().startsWith(family.toLowerCase()) ? name : `${family} ${name}`
}

/** An agent's own default among its models ("Default (recommended)"), which stands for another of them. */
export const isAgentDefault = (model: { readonly name: string }) => /^default\b/i.test(model.name)

/**
 * The model an agent's own default stands for, by the name its line gives it
 * ("Opus 5.5"); the id given where it isn't the default, and null where the
 * default names none of the agent's models.
 */
export const standsFor = (
  models: ReadonlyArray<{ readonly id: string; readonly name: string; readonly description: string | null }>,
  id: string | null,
): string | null => {
  const model = models.find((one) => one.id === id)
  if (model === undefined || !isAgentDefault(model)) return id
  return models.find((one) => !isAgentDefault(one) && one.name === model.description)?.id ?? null
}
