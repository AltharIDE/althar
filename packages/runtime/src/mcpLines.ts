import { isReference, referenceOf, type ServerSpec } from '@althar/provider-adapters'

import { claudeJson, openCodeEntry } from './mcpSync'

/*
 * A server's entry as each of the person's agents keeps it in its own file, a
 * line at a time, for Settings to show beside the file's name: Claude Code's
 * JSON, Codex's TOML table, OpenCode's JSON. Each is drawn from the server as
 * read, in the shape that agent writes, which is also what sync would write
 * there. A value of its environment or headers that isn't a reference to a
 * variable is masked (`mask`), so a token written out in a file never shows.
 */

export const MASK = '••••'

/** A value that names a variable stays; one written out is masked, its `Bearer ` kept. */
const masked = (value: string) => {
  const bearer = /^(Bearer\s+)(.*)$/i.exec(value)
  if (bearer !== null) return isReference(bearer[2]!) ? value : `${bearer[1]}${MASK}`
  return isReference(value) ? value : MASK
}

const maskAll = (values: Readonly<Record<string, string>> | undefined) =>
  values === undefined ? undefined : Object.fromEntries(Object.entries(values).map(([key, value]) => [key, masked(value)]))

/** A server with the values of its environment and headers masked, where they aren't references. */
export const mask = (spec: ServerSpec): ServerSpec => {
  const env = maskAll(spec.env)
  const headers = maskAll(spec.headers)
  return { ...spec, ...(env === undefined ? {} : { env }), ...(headers === undefined ? {} : { headers }) }
}

/** `"name": {…}`, pretty-printed as the agents' JSON files have it. */
const jsonEntry = (name: string, value: Record<string, unknown>) => `${JSON.stringify(name)}: ${JSON.stringify(value, null, 2)}`.split('\n')

/** Claude Code's entry under `mcpServers`. */
export const claudeLines = (spec: ServerSpec): ReadonlyArray<string> => jsonEntry(spec.name, claudeJson(spec))

/** OpenCode's entry under `mcp`. */
export const openCodeLines = (spec: ServerSpec): ReadonlyArray<string> =>
  jsonEntry(spec.name, { ...openCodeEntry(spec), ...(spec.off === true ? { enabled: false } : {}) })

/** A TOML key: bare where it can be, quoted otherwise. */
const tomlKey = (key: string) => (/^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key))

const tomlValue = (value: string | boolean | ReadonlyArray<string>): string =>
  typeof value === 'boolean'
    ? String(value)
    : typeof value === 'string'
      ? JSON.stringify(value)
      : `[${value.map((one) => JSON.stringify(one)).join(', ')}]`

/** A server as `codex mcp add` would leave it in Codex's file (`codexArgs`): an address with its bearer token by its variable, or a command. */
export const asCodexWrites = (spec: ServerSpec): ServerSpec => {
  if (spec.transport === 'stdio')
    return {
      name: spec.name,
      transport: 'stdio',
      command: spec.command ?? '',
      ...(spec.args === undefined ? {} : { args: spec.args }),
      ...(spec.env === undefined ? {} : { env: spec.env }),
    }
  const bearer =
    spec.tokenVariable ?? referenceOf((spec.headers?.['Authorization'] ?? spec.headers?.['authorization'] ?? '').replace(/^Bearer\s+/i, ''))
  return { name: spec.name, transport: 'http', url: spec.url ?? '', ...(bearer === undefined ? {} : { tokenVariable: bearer }) }
}

/** Codex's `[mcp_servers.<name>]` table, with its environment and headers as tables of their own. */
export const codexLines = (spec: ServerSpec): ReadonlyArray<string> => {
  const table = `mcp_servers.${tomlKey(spec.name)}`
  const plain: Array<[string, string | boolean | ReadonlyArray<string>]> =
    spec.transport === 'stdio'
      ? [
          ['command', spec.command ?? ''],
          ['args', spec.args ?? []],
        ]
      : [['url', spec.url ?? '']]
  if (spec.tokenVariable !== undefined) plain.push(['bearer_token_env_var', spec.tokenVariable])
  if (spec.off === true) plain.push(['enabled', false])
  const lines = [`[${table}]`, ...plain.map(([key, value]) => `${key} = ${tomlValue(value)}`)]
  const sub = (name: string, values: Readonly<Record<string, string>> | undefined) =>
    values === undefined || Object.keys(values).length === 0
      ? []
      : ['', `[${table}.${name}]`, ...Object.entries(values).map(([key, value]) => `${tomlKey(key)} = ${tomlValue(value)}`)]
  return [...lines, ...sub('env', spec.env), ...sub('http_headers', spec.headers)]
}
