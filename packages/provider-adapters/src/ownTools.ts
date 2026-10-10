import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { parse as parseToml } from 'smol-toml'

/*
 * The person's own MCP servers, kept out of an agent's sessions (ADR-011:
 * agents reach code hosts and trackers only through Althar). Codex and
 * OpenCode load every server their config files name, the person's and a
 * repository's, beside the one Althar gives a session, so a server that acts
 * on GitHub with the person's token would be the agent's too. Each is
 * switched off by name as the agent starts, through the config the agent
 * takes from its environment; the files themselves are only read, each one
 * the agent itself would read. Claude Code needs none of this: it loads only
 * the servers it is given.
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

/**
 * The folders from the session's folder up to its repository's root (the
 * first with a `.git`), the root first, as both agents look for a project's
 * config; outside a repository, up to the top.
 */
const upToRepository = (cwd: string): ReadonlyArray<string> => {
  const folders: string[] = []
  for (let folder = cwd; ; folder = dirname(folder)) {
    folders.push(folder)
    if (existsSync(join(folder, '.git')) || dirname(folder) === folder) return folders.toReversed()
  }
}

/** How Codex reaches a server: the command it runs, or the URL it calls. */
type CodexTransport = { readonly command: string } | { readonly url: string }

/** The MCP servers a Codex config file names, each with how it is reached; none where the file isn't TOML. */
export const codexServers = (toml: string): ReadonlyMap<string, CodexTransport | null> => {
  let config: unknown
  try {
    config = parseToml(toml)
  } catch {
    return new Map()
  }
  const servers = typeof config === 'object' && config !== null ? (config as { mcp_servers?: unknown }).mcp_servers : undefined
  if (typeof servers !== 'object' || servers === null) return new Map()
  return new Map(
    Object.entries(servers).map(([name, server]) => {
      const { command, url } = (typeof server === 'object' && server !== null ? server : {}) as { command?: unknown; url?: unknown }
      return [name, typeof command === 'string' ? { command } : typeof url === 'string' ? { url } : null]
    }),
  )
}

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
 * Codex's: the servers its system config, its home's `config.toml` and a
 * project's `.codex/config.toml` (each from the repository's root down to the
 * session's folder) name, each switched off by dotted keys in `CODEX_CONFIG`,
 * which codex-acp applies to every session and leaves beside the servers it
 * is given. Codex refuses a server it can't reach, so each is switched off
 * with how it is reached, as the first file to name it says: where Codex
 * loads that server, it is the same; where it doesn't (a project it doesn't
 * trust), it is a server of its own, off. A name with a dot in it can't be
 * reached that way, and stays.
 */
export const codexWithoutOwnTools = ({ env, homeDir, cwd }: StartingAt): Readonly<Record<string, string>> => {
  const files = [
    '/etc/codex/config.toml',
    join(env.CODEX_HOME || join(homeDir, '.codex'), 'config.toml'),
    ...upToRepository(cwd).map((folder) => join(folder, '.codex', 'config.toml')),
  ]
  const servers = new Map<string, CodexTransport>()
  for (const file of files)
    for (const [name, transport] of codexServers(read(file)))
      if (transport !== null && !servers.has(name) && !name.includes('.') && name !== ALTHAR) servers.set(name, transport)
  return servers.size === 0
    ? {}
    : {
        CODEX_CONFIG: JSON.stringify(
          Object.fromEntries(
            [...servers].flatMap(([name, transport]) => [
              'command' in transport ? [`mcp_servers.${name}.command`, transport.command] : [`mcp_servers.${name}.url`, transport.url],
              [`mcp_servers.${name}.enabled`, false],
            ]),
          ),
        ),
      }
}

/**
 * OpenCode's: the servers named in each file it reads, the way it finds
 * them: its global config (`config.json`, `opencode.json` and `.jsonc` in
 * `~/.config/opencode`), the file `OPENCODE_CONFIG` names, a project's
 * `opencode.json` and `.opencode` folder in each folder from the session's up
 * to the repository's root, `~/.opencode`, and `OPENCODE_CONFIG_DIR`. Each is
 * switched off in the config it takes from `OPENCODE_CONFIG_CONTENT`, which it
 * merges over the files; a name it doesn't load is only a switch, and harmless.
 * `base` is the rest of that config.
 */
export const openCodeWithoutOwnTools =
  (base: Readonly<Record<string, unknown>>) =>
  ({ env, homeDir, cwd }: StartingAt): Readonly<Record<string, string>> => {
    const global = join(env.XDG_CONFIG_HOME || join(homeDir, '.config'), 'opencode')
    const project = env.OPENCODE_DISABLE_PROJECT_CONFIG ? [] : upToRepository(cwd)
    const folders = [
      ...project,
      ...project.map((folder) => join(folder, '.opencode')),
      join(homeDir, '.opencode'),
      ...(env.OPENCODE_CONFIG_DIR ? [env.OPENCODE_CONFIG_DIR] : []),
    ]
    const files = [
      join(global, 'config.json'),
      join(global, 'opencode.json'),
      join(global, 'opencode.jsonc'),
      ...(env.OPENCODE_CONFIG ? [env.OPENCODE_CONFIG] : []),
      ...folders.flatMap((folder) => [join(folder, 'opencode.json'), join(folder, 'opencode.jsonc')]),
    ]
    const names = [...new Set(files.flatMap((file) => openCodeServers(read(file))))].filter((name) => name !== ALTHAR)
    return {
      OPENCODE_CONFIG_CONTENT: JSON.stringify(
        names.length === 0 ? base : { ...base, mcp: Object.fromEntries(names.map((name) => [name, { enabled: false }])) },
      ),
    }
  }

/** The name Althar gives its own server: one of the person's by that name is left to the agent's own handling of the clash. */
const ALTHAR = 'althar'
