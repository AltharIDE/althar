import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/*
 * The person's own MCP servers, kept out of an agent's sessions (ADR-011:
 * agents reach code hosts and trackers only through Althar). Codex and
 * OpenCode load every server their config files name, the person's and a
 * repository's, beside the one Althar gives a session, so a server that acts
 * on GitHub with the person's token would be the agent's too. Each is
 * switched off by name as the agent starts, through the config the agent
 * takes from its environment; the files themselves are only read. Claude
 * Code needs none of this: it loads only the servers it is given.
 */

/** Where an agent starts: its environment (the account's home among it), the person's home folder, and the session's folder. */
export interface StartingAt {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly homeDir: string
  readonly cwd: string
}

const read = (path: string) => {
  try {
    return existsSync(path) ? readFileSync(path, 'utf8') : ''
  } catch {
    return ''
  }
}

/** A server's name as a TOML key: bare, or quoted. */
const tomlKey = (raw: string) => (raw.startsWith('"') || raw.startsWith("'") ? raw.slice(1, -1) : raw).trim()

/** The MCP servers a Codex config file names, by its `[mcp_servers.<name>]` tables. */
export const codexServers = (toml: string): ReadonlyArray<string> => [
  ...new Set(
    [...toml.matchAll(/^\s*\[\s*mcp_servers\s*\.\s*("[^"]+"|'[^']+'|[A-Za-z0-9_-]+)\s*[\].]/gm)].map((match) => tomlKey(match[1] ?? '')),
  ),
]

/** JSON with comments and trailing commas, as OpenCode's `.jsonc` allows; nothing where it isn't JSON after all. */
const jsonc = (text: string): unknown => {
  const stripped = text
    .replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (_, quoted: string | undefined) => quoted ?? '')
    .replace(/,(\s*[}\]])/g, '$1')
  try {
    return JSON.parse(stripped)
  } catch {
    return null
  }
}

/** The MCP servers an OpenCode config file names, by its `mcp` object. */
export const openCodeServers = (text: string): ReadonlyArray<string> => {
  const config = jsonc(text)
  const mcp = typeof config === 'object' && config !== null ? (config as { mcp?: unknown }).mcp : undefined
  return typeof mcp === 'object' && mcp !== null ? Object.keys(mcp) : []
}

/**
 * Codex's: the servers its home's `config.toml` names, and a repository's
 * `.codex/config.toml`, each switched off by a dotted key in `CODEX_CONFIG`,
 * which codex-acp applies to every session and leaves beside the servers it
 * is given. A name with a dot in it can't be reached that way, and stays.
 */
export const codexWithoutOwnTools = ({ env, homeDir, cwd }: StartingAt): Readonly<Record<string, string>> => {
  const home = env.CODEX_HOME || join(homeDir, '.codex')
  const names = [...new Set([...codexServers(read(join(home, 'config.toml'))), ...codexServers(read(join(cwd, '.codex', 'config.toml')))])]
  const off = names.filter((name) => !name.includes('.') && name !== ALTHAR)
  return off.length === 0
    ? {}
    : { CODEX_CONFIG: JSON.stringify(Object.fromEntries(off.map((name) => [`mcp_servers.${name}.enabled`, false]))) }
}

/**
 * OpenCode's: the servers its global config names (`~/.config/opencode`, or
 * the folder `OPENCODE_CONFIG_DIR` says), and a project's `opencode.json`,
 * each switched off in the config it takes from `OPENCODE_CONFIG_CONTENT`,
 * which it merges over the files. `base` is the rest of that config.
 */
export const openCodeWithoutOwnTools =
  (base: Readonly<Record<string, unknown>>) =>
  ({ env, homeDir, cwd }: StartingAt): Readonly<Record<string, string>> => {
    const config = join(env.XDG_CONFIG_HOME || join(homeDir, '.config'), 'opencode')
    const folders = [config, ...(env.OPENCODE_CONFIG_DIR ? [env.OPENCODE_CONFIG_DIR] : []), cwd, join(cwd, '.opencode')]
    const names = [
      ...new Set(
        folders.flatMap((folder) => ['opencode.json', 'opencode.jsonc'].flatMap((file) => openCodeServers(read(join(folder, file))))),
      ),
    ].filter((name) => name !== ALTHAR)
    return {
      OPENCODE_CONFIG_CONTENT: JSON.stringify(
        names.length === 0 ? base : { ...base, mcp: Object.fromEntries(names.map((name) => [name, { enabled: false }])) },
      ),
    }
  }

/** The name Althar gives its own server: one of the person's by that name is left to the agent's own handling of the clash. */
const ALTHAR = 'althar'
