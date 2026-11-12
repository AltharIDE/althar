/*
 * The person's own skills a session is not given (ADR-097, "Skills"): those
 * the person turned off for its role or its project. Each agent loads them
 * from its own folders, its plugins and the repository, so each is held back
 * in the agent itself, the way that agent documents, as its session starts.
 * Read from the agents Althar runs, 8 November 2026:
 *
 * - Claude Code 2.1.318 (claude-agent-sdk 0.3.318, through claude-agent-acp
 *   0.101.0): its `Skill` tool refuses a skill a `Skill(<name>)` deny rule
 *   names ("Skill execution blocked by permission rules"), matching the name
 *   it is called by, a plugin's as `<plugin>:<skill>`; and `skillOverrides`
 *   `"off"` "hides it from both" the model's list and `/name`, which its
 *   session settings (the flag settings) carry. A plugin's skill isn't read
 *   from `skillOverrides`, so only its deny rule holds it: its name may stay
 *   in the list the model reads, and loading it is refused.
 * - Codex 0.165.0 (through codex-acp 2.5.0): `[[skills.config]]` entries,
 *   each with a `name` or a `path` selector and `enabled = false`, which
 *   codex-acp passes on from `CODEX_CONFIG`'s `skills.config` and adds its own
 *   to. By name, as codex-acp's own are: the name its `SKILL.md` gives it.
 * - OpenCode 2.2.6 and 1.x: `permission.skill`, `{ "<id>": "deny" }`, which
 *   2.x reads as a rule on its `skill` tool's load of that id (its folder's
 *   name), and 1.x documents as hiding it and refusing it.
 */

/** One of the person's skills a session is not given. */
export interface HeldSkill {
  /** As Althar lists it: its folder's name, which Claude Code and OpenCode call it by; a plugin's as `<plugin>:<skill>`. */
  readonly name: string
  /** What its `SKILL.md` calls it, where that isn't its folder's name: the name Codex goes by. */
  readonly called?: string
}

const plugin = (name: string) => name.includes(':')

const namesOf = (held: ReadonlyArray<HeldSkill>) => [
  ...new Set(held.flatMap((skill) => [skill.name, ...(skill.called === undefined ? [] : [skill.called])])),
]

/** Claude Code's session settings with each held skill denied, and those of its own folders off its list. */
export const claudeHolding = <Settings extends { readonly permissions: { readonly deny?: ReadonlyArray<string> } }>(
  settings: Settings,
  held: ReadonlyArray<HeldSkill> | undefined,
): Settings => {
  if (held === undefined || held.length === 0) return settings
  const names = namesOf(held)
  const off = names.filter((name) => !plugin(name))
  return {
    ...settings,
    permissions: { ...settings.permissions, deny: [...(settings.permissions.deny ?? []), ...names.map((name) => `Skill(${name})`)] },
    ...(off.length === 0 ? {} : { skillOverrides: Object.fromEntries(off.map((name) => [name, 'off'])) }),
  }
}

/** Codex's `CODEX_CONFIG` with each held skill switched off by name, beside what it already says of skills. */
export const codexHolding = (
  config: Readonly<Record<string, unknown>>,
  held: ReadonlyArray<HeldSkill> | undefined,
): Readonly<Record<string, unknown>> => {
  if (held === undefined || held.length === 0) return config
  const skills = (typeof config.skills === 'object' && config.skills !== null ? config.skills : {}) as Readonly<Record<string, unknown>>
  const rules = Array.isArray(skills.config) ? (skills.config as ReadonlyArray<unknown>) : []
  // A plugin's skill is Claude Code's: Codex has none by that name.
  const names = [...new Set(held.filter((skill) => !plugin(skill.name)).flatMap((skill) => [skill.called ?? skill.name, skill.name]))]
  return { ...config, skills: { ...skills, config: [...rules, ...names.map((name) => ({ name, enabled: false }))] } }
}

type OpenCodePermission = Readonly<Record<string, unknown>>

/** OpenCode's config with each held skill denied, globally and for its built-in agents, whose own rules come after. */
export const openCodeHolding = (
  config: Readonly<Record<string, unknown>>,
  held: ReadonlyArray<HeldSkill> | undefined,
): Readonly<Record<string, unknown>> => {
  if (held === undefined || held.length === 0) return config
  const ids = held.filter((skill) => !plugin(skill.name)).map((skill) => skill.name)
  if (ids.length === 0) return config
  const denied = Object.fromEntries(ids.map((id) => [id, 'deny']))
  const withSkill = (permission: unknown): OpenCodePermission => {
    const own = (typeof permission === 'object' && permission !== null ? permission : {}) as OpenCodePermission
    const skill = own.skill
    // A single word for every skill stays as the first rule, the held ones after it.
    const before = typeof skill === 'string' ? { '*': skill } : typeof skill === 'object' && skill !== null ? skill : {}
    return { ...own, skill: { ...before, ...denied } }
  }
  const agent = (typeof config.agent === 'object' && config.agent !== null ? config.agent : {}) as Readonly<Record<string, unknown>>
  return {
    ...config,
    permission: withSkill(config.permission),
    agent: Object.fromEntries(
      Object.entries(agent).map(([name, one]) => {
        const fields = (typeof one === 'object' && one !== null ? one : {}) as Readonly<Record<string, unknown>>
        return [name, { ...fields, permission: withSkill(fields.permission) }]
      }),
    ),
  }
}
