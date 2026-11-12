import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/*
 * The person's agents' own settings, as a spec makes them: a home of the profile's own (the app reads it where
 * `ALTHAR_AGENT_HOME` doesn't name another), so nothing of the real `~/.claude.json`, `~/.codex` or
 * `~/.config/opencode` is read or written. Each file is written as that agent writes it, and the record of how each
 * server stands as the app keeps it, so the tiles can say Failed to start and Not signed in without an agent's own
 * command, which the app's PATH in a spec doesn't have.
 */

/** Where the app reads the agents' settings in a spec: a home inside the profile. */
export const agentHomeIn = (home: string): string => join(home, 'profile', 'agent-home')

const put = (path: string, text: string) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

/** OpenCode's own file, with its servers: `{ name: { type, command | url } }`. No agent's command is needed to write it. */
export const seedOpenCode = (home: string, servers: Readonly<Record<string, Record<string, unknown>>>) =>
  put(join(agentHomeIn(home), '.config', 'opencode', 'opencode.json'), `${JSON.stringify({ mcp: servers }, null, 2)}\n`)

/** Claude Code's own file, with its servers. */
export const seedClaude = (home: string, servers: Readonly<Record<string, Record<string, unknown>>>) =>
  put(join(agentHomeIn(home), '.claude.json'), `${JSON.stringify({ mcpServers: servers }, null, 2)}\n`)

/** Codex's own file: tables of `[mcp_servers.<name>]`, each `key = "value"` or a list of strings. */
export const seedCodex = (home: string, servers: Readonly<Record<string, Readonly<Record<string, string | ReadonlyArray<string>>>>>) => {
  const value = (each: string | ReadonlyArray<string>) =>
    typeof each === 'string' ? JSON.stringify(each) : `[${each.map((one) => JSON.stringify(one)).join(', ')}]`
  const text = Object.entries(servers)
    .map(
      ([name, entries]) =>
        `[mcp_servers.${name}]\n${Object.entries(entries)
          .map(([key, each]) => `${key} = ${value(each)}`)
          .join('\n')}\n`,
    )
    .join('\n')
  put(join(agentHomeIn(home), '.codex', 'config.toml'), text)
}

/** A skill in an agent's own folder: its SKILL.md, as `name` and `description` say it. */
export const seedSkill = (home: string, folder: string, name: string, description: string) =>
  put(join(agentHomeIn(home), folder, name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\n${description}\n`)

/** How the servers stood when the agents last said (`mcp-health.json`): by server, then agent. */
export const seedHealth = (
  home: string,
  servers: Readonly<
    Record<
      string,
      Readonly<
        Partial<Record<'claude' | 'codex' | 'opencode', { status: 'connected' | 'needs-auth' | 'failed' | 'unknown'; why?: string }>>
      >
    >
  >,
) => {
  const at = new Date().toISOString()
  const record = {
    checkedAt: at,
    servers: Object.fromEntries(
      Object.entries(servers).map(([name, agents]) => [
        name,
        Object.fromEntries(Object.entries(agents).map(([agent, entry]) => [agent, { ...entry, at }])),
      ]),
    ),
  }
  put(join(home, 'profile', 'agent-sync', 'mcp-health.json'), `${JSON.stringify(record, null, 2)}\n`)
}
