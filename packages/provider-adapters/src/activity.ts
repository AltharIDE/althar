import type { ToolKind } from '@althar/domain'

/*
 * What an agent does beyond the repository, read from its tool calls: a web
 * search or a page it reads (`webCallOf`), a sub-agent it starts
 * (`subAgentOf`), and which sub-agent a call is made by (`parentOf`). Each
 * agent says these its own way, as its adapter reports them:
 *
 * - Claude Code names its tool in `_meta.claudeCode.toolName` (`WebSearch`,
 *   `WebFetch`, `Task` or `Agent`), with the input in `rawInput`, and stamps
 *   a sub-agent's own calls with `_meta.claudeCode.parentToolUseId`.
 * - Codex reports a web search as a `search` call whose input is its item
 *   (`type: 'webSearch'`, with a query and an action: a search, a page it
 *   opens, or a search in one), and a sub-agent as a `spawnAgent` call.
 * - OpenCode reports a page it reads as a `fetch` call with its `url`, and a
 *   sub-agent as its `task` tool, a `think` call with `subagent_type`.
 *
 * Anything else is no one of these, and stays the call it is.
 */

/** A search on the web, by its query, or a page the agent read, by its address. */
export type WebCall = { readonly action: 'search'; readonly query: string } | { readonly action: 'fetch'; readonly url: string }

/** A sub-agent the agent started: what it was asked to do, in a line, and what kind and model it is, where it says. */
export interface SubAgentCall {
  readonly label: string
  readonly type?: string
  readonly model?: string
}

const record = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined

const words = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined)

const claudeOf = (meta: unknown) => record(record(meta)?.['claudeCode'])

/** The tool Claude Code says it runs, where it says. */
const claudeTool = (meta: unknown): string | undefined => words(claudeOf(meta)?.['toolName'])

/** How long a query, or a sub-agent's line, is kept: what it is, at a glance. */
const LINE = 200

const line = (text: string) => {
  const first = text.split('\n')[0]?.trim() ?? ''
  return first.length > LINE ? `${first.slice(0, LINE - 1)}…` : first
}

/**
 * A page's address as it is kept: where it is, without its query or
 * fragment, which may carry a token (docs/architecture/07). Not an address
 * at all, nothing.
 */
export const pageOf = (url: string): string | undefined => {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
    return `${parsed.origin}${parsed.pathname === '/' ? '' : parsed.pathname}`
  } catch {
    return undefined
  }
}

const search = (query: string | undefined): WebCall | undefined =>
  query === undefined ? undefined : { action: 'search', query: line(query) }

const fetched = (url: string | undefined): WebCall | undefined => {
  const page = url === undefined ? undefined : pageOf(url)
  return page === undefined ? undefined : { action: 'fetch', url: page }
}

/** Codex's web search item: a search, by its query or queries; a page it opened, or searched in, by its address. */
const codexWeb = (input: Readonly<Record<string, unknown>>): WebCall | undefined => {
  const action = record(input['action'])
  const type = words(action?.['type'])
  if (type === 'openPage' || type === 'findInPage') return fetched(words(action?.['url']))
  const queries = Array.isArray(action?.['queries']) ? action['queries'].flatMap((one) => words(one) ?? []) : []
  return search(words(action?.['query']) ?? (queries.length > 0 ? queries.join(', ') : undefined) ?? words(input['query']))
}

/** The web call a tool call is, from what it says it is and its input; undefined for any other. */
export const webCallOf = (kind: ToolKind | undefined, rawInput: unknown, meta?: unknown): WebCall | undefined => {
  const input = record(rawInput)
  // Claude Code's updates after the first name the tool again without its input: what the first said stands.
  if (input === undefined) return undefined
  const tool = claudeTool(meta)
  if (tool === 'WebSearch') return search(words(input['query'])) ?? { action: 'search', query: '' }
  if (tool === 'WebFetch') return fetched(words(input['url']))
  if (input['type'] === 'webSearch') return codexWeb(input)
  // Any other agent's fetch, by the address it reads.
  if (kind === 'fetch') return fetched(words(input['url'])) ?? search(words(input['query']))
  return undefined
}

/** The sub-agent a tool call starts, from what it says it is and its input; undefined for any other call. */
export const subAgentOf = (title: string, rawInput: unknown, meta?: unknown): SubAgentCall | undefined => {
  const input = record(rawInput)
  // Codex's: the call that spawns one, with what it was asked where it says.
  if (title === 'spawnAgent') {
    const model = words(input?.['model'])
    return { label: line(words(input?.['prompt']) ?? 'Sub-agent'), ...(model === undefined ? {} : { model }) }
  }
  // As for a web call: an update without its input says nothing new of what it was asked.
  if (input === undefined) return undefined
  const tool = claudeTool(meta)
  const type = words(input['subagent_type'])
  const model = words(input['model'])
  const described = words(input['description'])
  const asked = words(input['prompt'])
  const of = (label: string): SubAgentCall => ({
    label: line(label),
    ...(type === undefined ? {} : { type }),
    ...(model === undefined ? {} : { model }),
  })
  // Claude Code's Task, named Agent in later versions; and any agent's tool that names the kind of sub-agent it starts.
  if (tool === 'Task' || tool === 'Agent' || (type !== undefined && (described !== undefined || asked !== undefined)))
    return of(described ?? asked ?? (title.trim() === '' ? 'Sub-agent' : title))
  return undefined
}

/** The sub-agent's call a tool call is made by, by that call's id, where the agent says (Claude Code). */
export const parentOf = (meta: unknown): string | undefined => words(claudeOf(meta)?.['parentToolUseId'])
