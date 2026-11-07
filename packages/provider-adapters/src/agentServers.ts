import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { parse as parseToml } from 'smol-toml'

/*
 * The person's own MCP servers, as each of their agents keeps them
 * (ADR-097): Claude Code in `~/.claude.json` (its user scope), Codex in
 * `~/.codex/config.toml` (`CODEX_HOME` where it is set), OpenCode in
 * `~/.config/opencode/opencode.json` (or `.jsonc`, or `config.json`); and a
 * repository's own `.mcp.json`, which only Claude Code reads. Each is read
 * into one shape, so the same server can be told apart from one set up two
 * ways, and a file Althar can't read is said, not guessed at. Nothing here
 * writes; `McpSync` does, through each agent's own command.
 */

/** The person's agents whose servers Althar reads, and keeps the same where they ask it to. */
export const SYNCED_AGENTS = ['claude', 'codex', 'opencode'] as const
export type SyncedAgent = (typeof SYNCED_AGENTS)[number]

/** One MCP server, as an agent's config sets it up: a command it runs, or an address it calls. */
export interface ServerSpec {
  readonly name: string
  readonly transport: 'stdio' | 'http' | 'sse'
  readonly command?: string
  readonly args?: ReadonlyArray<string>
  /** Its environment, as the file writes it: a value, or a reference to one (`${VAR}`, `{env:VAR}`). */
  readonly env?: Readonly<Record<string, string>>
  readonly url?: string
  readonly headers?: Readonly<Record<string, string>>
  /** Where the bearer token is read from, by its variable's name (Codex's `bearer_token_env_var`). */
  readonly tokenVariable?: string
  /** Off in that agent, as the person set it. */
  readonly off?: boolean
}

/** One agent's servers, as its file says them; or why they couldn't be read. */
export interface AgentServers {
  readonly agent: SyncedAgent
  /** The file read, as the person would name it. */
  readonly file: string
  /** The file's path on this computer. */
  readonly path: string
  readonly servers: ReadonlyArray<ServerSpec>
  /** Why the file couldn't be read: it's there, but isn't what that agent writes. Absent where it was read, or isn't there. */
  readonly problem?: string
}

/** Where to look: the person's home, and the environment that moves an agent's folder. */
export interface ServerHome {
  readonly homeDir: string
  readonly env?: Readonly<Record<string, string | undefined>>
}

const record = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined

const strings = (value: unknown): ReadonlyArray<string> | undefined =>
  Array.isArray(value) && value.every((each) => typeof each === 'string') ? (value as ReadonlyArray<string>) : undefined

const stringRecord = (value: unknown): Readonly<Record<string, string>> | undefined => {
  const found = record(value)
  if (found === undefined) return undefined
  const kept = Object.fromEntries(Object.entries(found).flatMap(([key, each]) => (typeof each === 'string' ? [[key, each]] : [])))
  return Object.keys(kept).length === 0 ? undefined : kept
}

/** JSON with its comments taken out, read a character at a time: strings kept whole, line and block comments dropped. */
const withoutComments = (text: string): string => {
  let out = ''
  let index = 0
  while (index < text.length) {
    const char = text[index]!
    if (char === '"') {
      let end = index + 1
      while (end < text.length && text[end] !== '"') end += text[end] === '\\' ? 2 : 1
      out += text.slice(index, end + 1)
      index = end + 1
    } else if (char === '/' && text[index + 1] === '/') {
      const end = text.indexOf('\n', index)
      index = end === -1 ? text.length : end
    } else if (char === '/' && text[index + 1] === '*') {
      const end = text.indexOf('*/', index + 2)
      index = end === -1 ? text.length : end + 2
    } else {
      out += char
      index += 1
    }
  }
  return out
}

/** A comma before a closing bracket or brace, as `.jsonc` allows, taken out: read a character at a time. */
const withoutTrailingCommas = (text: string): string => {
  let out = ''
  let inString = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!
    if (inString) {
      out += char
      if (char === '\\') {
        out += text[index + 1] ?? ''
        index += 1
      } else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    if (char === ',') {
      let next = index + 1
      while (next < text.length && /\s/.test(text[next]!)) next += 1
      if (text[next] === '}' || text[next] === ']') continue
    }
    out += char
  }
  return out
}

/** JSON with comments and trailing commas, as OpenCode's `.jsonc` allows; undefined where it isn't JSON after all. */
export const parseJsonc = (text: string): unknown => {
  try {
    return JSON.parse(withoutTrailingCommas(withoutComments(text)))
  } catch {
    return undefined
  }
}

/** Fields that may be undefined as read, dropped from the spec where they are. */
type Loose<T> = { [K in keyof T]?: T[K] | undefined }

const spec = (name: string, fields: Loose<Omit<ServerSpec, 'name'>> & Pick<ServerSpec, 'transport'>): ServerSpec =>
  Object.fromEntries(Object.entries({ name, ...fields }).filter(([, value]) => value !== undefined)) as unknown as ServerSpec

/** Claude Code's servers, as `mcpServers` in `~/.claude.json` or a repository's `.mcp.json` keeps them. */
export const claudeServersIn = (config: unknown): ReadonlyArray<ServerSpec> =>
  Object.entries(record(record(config)?.['mcpServers']) ?? {}).flatMap(([name, value]) => {
    const server = record(value)
    if (server === undefined) return []
    const type = server['type']
    const url = typeof server['url'] === 'string' ? server['url'] : undefined
    const command = typeof server['command'] === 'string' ? server['command'] : undefined
    if (url !== undefined)
      return [spec(name, { transport: type === 'sse' ? 'sse' : 'http', url, headers: stringRecord(server['headers']) })]
    if (command === undefined) return []
    return [spec(name, { transport: 'stdio', command, args: strings(server['args']), env: stringRecord(server['env']) })]
  })

/** Codex's servers, as `[mcp_servers.<name>]` in its `config.toml` keeps them. */
export const codexServersIn = (config: unknown): ReadonlyArray<ServerSpec> =>
  Object.entries(record(record(config)?.['mcp_servers']) ?? {}).flatMap(([name, value]) => {
    const server = record(value)
    if (server === undefined) return []
    const off = server['enabled'] === false ? true : undefined
    const url = typeof server['url'] === 'string' ? server['url'] : undefined
    const command = typeof server['command'] === 'string' ? server['command'] : undefined
    if (url !== undefined)
      return [
        spec(name, {
          transport: 'http',
          url,
          tokenVariable: typeof server['bearer_token_env_var'] === 'string' ? server['bearer_token_env_var'] : undefined,
          headers: stringRecord(server['http_headers']),
          off,
        }),
      ]
    if (command === undefined) return []
    return [spec(name, { transport: 'stdio', command, args: strings(server['args']), env: stringRecord(server['env']), off })]
  })

/** OpenCode's servers, as `mcp` in its `opencode.json` keeps them: a local command, as one list, or a remote address. */
export const openCodeServersIn = (config: unknown): ReadonlyArray<ServerSpec> =>
  Object.entries(record(record(config)?.['mcp']) ?? {}).flatMap(([name, value]) => {
    const server = record(value)
    if (server === undefined) return []
    const off = server['enabled'] === false ? true : undefined
    if (server['type'] === 'remote' && typeof server['url'] === 'string')
      return [spec(name, { transport: 'http', url: server['url'], headers: stringRecord(server['headers']), off })]
    const [command, ...args] = strings(server['command']) ?? []
    if (command === undefined) return []
    return [
      spec(name, {
        transport: 'stdio',
        command,
        args: args.length === 0 ? undefined : args,
        env: stringRecord(server['environment']),
        off,
      }),
    ]
  })

const readText = (path: string): string | undefined => {
  try {
    return existsSync(path) ? readFileSync(path, 'utf8') : undefined
  } catch {
    return undefined
  }
}

/** Where each agent keeps its servers on this computer, as the person names the file, and its path. */
export const serverFiles = ({ homeDir, env = {} }: ServerHome): Readonly<Record<SyncedAgent, { file: string; path: string }>> => {
  const codexHome = env['CODEX_HOME'] || join(homeDir, '.codex')
  const openCode = join(env['XDG_CONFIG_HOME'] || join(homeDir, '.config'), 'opencode')
  const openCodeFile = ['opencode.jsonc', 'opencode.json', 'config.json'].map((name) => join(openCode, name)).find(existsSync)
  return {
    claude: { file: '~/.claude.json', path: join(homeDir, '.claude.json') },
    codex: { file: env['CODEX_HOME'] ? join(codexHome, 'config.toml') : '~/.codex/config.toml', path: join(codexHome, 'config.toml') },
    opencode: {
      file: openCodeFile === undefined ? '~/.config/opencode/opencode.json' : openCodeFile.replace(homeDir, '~'),
      path: openCodeFile ?? join(openCode, 'opencode.json'),
    },
  }
}

/** One agent's servers, read from its own file. */
export const agentServers = (agent: SyncedAgent, home: ServerHome): AgentServers => {
  const { file, path } = serverFiles(home)[agent]
  const text = readText(path)
  if (text === undefined) return { agent, file, path, servers: [] }
  if (agent === 'codex') {
    try {
      return { agent, file, path, servers: codexServersIn(parseToml(text)) }
    } catch (error) {
      const line = /line (\d+)/i.exec(error instanceof Error ? error.message : '')?.[1]
      return {
        agent,
        file,
        path,
        servers: [],
        problem: line === undefined ? 'it isn’t TOML Althar can read' : `it has a mistake on line ${line}`,
      }
    }
  }
  const config =
    agent === 'opencode'
      ? parseJsonc(text)
      : (() => {
          try {
            return JSON.parse(text) as unknown
          } catch {
            return undefined
          }
        })()
  if (config === undefined) return { agent, file, path, servers: [], problem: 'it isn’t JSON Althar can read' }
  return { agent, file, path, servers: agent === 'claude' ? claudeServersIn(config) : openCodeServersIn(config) }
}

/** A repository's own servers, from its `.mcp.json`: the project's, which only Claude Code reads. */
export const repositoryServers = (root: string): ReadonlyArray<ServerSpec> => {
  const text = readText(join(root, '.mcp.json'))
  if (text === undefined) return []
  try {
    return claudeServersIn(JSON.parse(text))
  } catch {
    return []
  }
}

/** A value that names a variable rather than holding a secret: `${VAR}`, `{env:VAR}`, or `$VAR`. */
export const isReference = (value: string): boolean =>
  /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$|^\{env:[A-Za-z_][A-Za-z0-9_]*\}$|^\$[A-Za-z_][A-Za-z0-9_]*$/.test(value)

/** The variable a reference names, whichever agent's way it is written. */
export const referenceOf = (value: string): string | undefined =>
  /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$|^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$|^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(value)?.slice(1).find(Boolean)

/** What a server runs or calls, in a line: `npx -y @github/github-mcp-server`, `https://mcp.linear.app/mcp`. */
export const runsOf = (server: ServerSpec): string => server.url ?? [server.command ?? '', ...(server.args ?? [])].join(' ').trim()

/**
 * A server's whole set-up, as one agent's way of writing it or another's
 * would read: the same reference to a variable whichever way it is written
 * (`${VAR}`, `{env:VAR}`, `$VAR`), a bearer token by its variable the same as
 * an `Authorization` header naming it, and a remote server the same over
 * HTTP or SSE, as OpenCode writes both alike. Whether it is off is said apart.
 */
const canonical = (server: ServerSpec): string => {
  const value = (raw: string) => {
    const bearer = /^Bearer\s+(.*)$/i.exec(raw)
    const name = referenceOf(bearer?.[1] ?? raw)
    return name === undefined ? raw : bearer === null ? `\${${name}}` : `Bearer \${${name}}`
  }
  const sorted = (values: Readonly<Record<string, string>> | undefined) =>
    Object.entries(values ?? {})
      .map(([key, raw]) => [key.toLowerCase() === 'authorization' ? 'authorization' : key, value(raw)] as const)
      .sort(([one], [other]) => one.localeCompare(other))
  const headers = sorted({
    ...server.headers,
    ...(server.tokenVariable === undefined ? {} : { Authorization: `Bearer \${${server.tokenVariable}}` }),
  })
  return JSON.stringify([
    server.transport === 'stdio' ? 'stdio' : 'remote',
    server.url ?? '',
    server.command ?? '',
    server.args ?? [],
    sorted(server.env),
    headers,
  ])
}

/** Whether two agents set a server up the same way: the same command, arguments and environment, or address and headers. */
export const sameServer = (one: ServerSpec, other: ServerSpec): boolean => canonical(one) === canonical(other)

/** Whether a server is still exactly as Althar wrote it: set up the same, and not turned off since. */
export const asWritten = (now: ServerSpec, written: ServerSpec): boolean =>
  sameServer(now, written) && (now.off === true) === (written.off === true)
