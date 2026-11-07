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
  const found = typeof named === 'string' && named !== '' ? named : /^mcp__([A-Za-z0-9_-]+?)__[A-Za-z0-9_.-]+$/.exec(toolName)?.[1]
  return found === undefined || /^althar$/i.test(found) ? undefined : found
}
