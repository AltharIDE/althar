/*
 * Which of the person's MCP servers a tool call goes to, and which of its
 * tools (ADR-097, "MCP calls and the irreversible list"). Claude Code's
 * bridge says the server in a call's `_meta` (`claudeCode.mcpServer`) and
 * names the tool `mcp__<server>__<tool>`; Codex names it `<server>.<tool>`
 * in some versions and `mcp.<server>.<tool>` in others. Althar's own server
 * is no one else's call, so it is never one of these.
 */

/** A call to an MCP server: the server by the name its config gives it, and the tool. */
export interface McpCall {
  readonly server: string
  readonly tool: string
}

const ALTHAR = /^althar$/i

/** The name forms agents give an MCP tool: Claude Code's, then Codex's two. */
const FORMS: ReadonlyArray<RegExp> = [/^mcp__([A-Za-z0-9_-]+?)__([A-Za-z0-9_.-]+)$/, /^mcp\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_.-]+)$/]

const fromName = (name: string): McpCall | undefined => {
  for (const form of FORMS) {
    const match = form.exec(name.trim())
    if (match !== null) return { server: match[1]!, tool: match[2]! }
  }
  return undefined
}

const record = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined

/**
 * The MCP call a tool call is, from its title and what its `_meta` says;
 * undefined for anything else, and for Althar's own server.
 */
export const mcpCallOf = (title: string, meta?: unknown): McpCall | undefined => {
  const claude = record(record(meta)?.['claudeCode'])
  const toolName = typeof claude?.['toolName'] === 'string' ? claude['toolName'] : undefined
  const server = record(claude?.['mcpServer'])?.['name']
  const named = fromName(toolName ?? title) ?? (toolName === undefined ? undefined : fromName(title))
  const call =
    typeof server === 'string' && server !== '' ? { server, tool: named?.tool ?? toolName?.replace(/^mcp__.*?__/, '') ?? title } : named
  if (call === undefined || ALTHAR.test(call.server)) return undefined
  return call
}
