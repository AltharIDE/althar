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

const NAME = /^[A-Za-z0-9_-]+$/
const TOOL = /^[A-Za-z0-9_.-]+$/

/** The name forms agents give an MCP tool: Claude Code's `mcp__server__tool`, then Codex's `mcp.server.tool`; read without a pattern that backtracks. */
const fromName = (name: string): McpCall | undefined => {
  const trimmed = name.trim()
  if (trimmed.startsWith('mcp__')) {
    const rest = trimmed.slice('mcp__'.length)
    const at = rest.indexOf('__')
    if (at <= 0) return undefined
    const server = rest.slice(0, at)
    const tool = rest.slice(at + 2)
    return NAME.test(server) && TOOL.test(tool) ? { server, tool } : undefined
  }
  if (trimmed.startsWith('mcp.')) {
    const [, server = '', ...tool] = trimmed.split('.')
    const joined = tool.join('.')
    return NAME.test(server) && joined !== '' && TOOL.test(joined) ? { server, tool: joined } : undefined
  }
  return undefined
}

const record = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined

/**
 * The tool of Althar's own server a tool call is, by its name there
 * (draft_task, propose_plan), from its title and what its `_meta` says;
 * undefined for any other call. Althar follows some of its own tools as they
 * are written (`drafts.ts` in the runtime).
 */
export const altharToolOf = (title: string, meta?: unknown): string | undefined => {
  const claude = record(record(meta)?.['claudeCode'])
  const toolName = typeof claude?.['toolName'] === 'string' ? claude['toolName'] : undefined
  const named = fromName(toolName ?? title) ?? (toolName === undefined ? undefined : fromName(title))
  if (named !== undefined) return ALTHAR.test(named.server) ? named.tool : undefined
  // Codex names some calls by server and tool alone: althar.draft_task, or althar/draft_task.
  return BARE.exec((toolName ?? title).trim())?.[1]
}
const BARE = /^althar[./:]([A-Za-z0-9_-]+)$/i

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
