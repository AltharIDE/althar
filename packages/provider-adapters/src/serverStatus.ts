/*
 * Whether one of the person's MCP servers is up in a session, and which
 * server a tool call went to (ADR-097, "A server that fails"). claude-agent-acp
 * reports a server that failed to start or needs the person to sign in in a
 * notice's `_meta.claudeCode` (`kind: "mcpServerStatus"`, the server's name and
 * its status); a call to one of its tools is named `mcp__<server>__<tool>`, or
 * says its server in `_meta.claudeCode.mcpServer`.
 */

/** How a server stands, as the agent says: only those that stop its tools matter here. */
export type ServerStatus = 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled'

const STATUSES: ReadonlyArray<string> = ['connected', 'failed', 'needs-auth', 'pending', 'disabled']

const record = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined

/** What a status update says of a server, from the update's `_meta`; undefined for anything else. */
export const serverStatusOf = (meta: unknown): { readonly server: string; readonly status: ServerStatus } | undefined => {
  const claude = record(record(meta)?.['claudeCode'])
  if (claude?.['kind'] !== 'mcpServerStatus') return undefined
  const { server, status } = claude
  return typeof server === 'string' && server !== '' && typeof status === 'string' && STATUSES.includes(status)
    ? { server, status: status as ServerStatus }
    : undefined
}

/** The server a tool call goes to, by its title or what its `_meta` names; Althar's own server is no one else's. */
export const serverOfCall = (title: string, meta?: unknown): string | undefined => {
  const claude = record(record(meta)?.['claudeCode'])
  const named = record(claude?.['mcpServer'])?.['name']
  const toolName = typeof claude?.['toolName'] === 'string' ? claude['toolName'] : title
  const found = typeof named === 'string' && named !== '' ? named : serverInToolName(toolName)
  return found === undefined || /^althar$/i.test(found) ? undefined : found
}

const SERVER_CHARS = /^[A-Za-z0-9_-]+$/
const TOOL_CHARS = /^[A-Za-z0-9_.-]+$/

/** `mcp__<server>__<tool>` split at its first `__` after the server's first character, without a pattern that backtracks. */
const serverInToolName = (name: string): string | undefined => {
  if (!name.startsWith('mcp__')) return undefined
  const rest = name.slice('mcp__'.length)
  const at = rest.indexOf('__', 1)
  if (at < 0) return undefined
  const server = rest.slice(0, at)
  return SERVER_CHARS.test(server) && TOOL_CHARS.test(rest.slice(at + 2)) ? server : undefined
}
