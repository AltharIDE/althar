/*
 * How a model is named where several agents' models meet: the window's
 * pickers, and what Charrette says in a thread when work moves to another
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
