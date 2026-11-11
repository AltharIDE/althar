import type { McpCall } from '@althar/provider-adapters'

/*
 * What a call to one of the person's MCP servers does (ADR-097, "MCP calls
 * and the irreversible list"): whether it only reads or acts on the outside
 * world, and where it acts, whether it is one of the kinds that can't be
 * undone, which ask the person: merging or publishing, speaking for them,
 * or losing work and history. Read by the tool's name and arguments: the
 * servers people use for their hosts and trackers (GitHub's, GitLab's,
 * Linear's, Atlassian's) name their tools plainly, and any server's name for
 * a merge, a release, a deletion or a post says so too. A general `graphql`
 * or `api` tool is read by its mutation or method. What a name doesn't say
 * goes ahead, as an unreadable command does.
 */

/** The kinds of what can't be undone that an MCP call can be, as Rules lists them. */
export type McpKind = 'history' | 'publish' | 'speak'

export interface McpAct {
  readonly server: string
  readonly tool: string
  /** It changes something outside: posts, merges, moves an issue. A read doesn't. */
  readonly acts: boolean
  /** One of the kinds that can't be undone, which asks the person. */
  readonly kind?: McpKind
  /** The action, as a button says it: Merge #635. */
  readonly verb: string
  /** What it did, once done: Merged #635. */
  readonly done: string
  /** What can't be taken back, in one line, for one of the kinds. */
  readonly stays?: string
  /** The words it would post, for one that speaks for the person. */
  readonly words?: string
}

const record = (value: unknown): Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

const stringOf = (input: Readonly<Record<string, unknown>>, keys: ReadonlyArray<string>): string | undefined => {
  for (const key of keys) {
    const value = input[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
    if (typeof value === 'number') return String(value)
  }
  return undefined
}

/** What it acts on, as people name it: #635, DEV-188, or nothing. */
const targetOf = (input: Readonly<Record<string, unknown>>): string | undefined => {
  const number = stringOf(input, ['pull_number', 'pullNumber', 'pr_number', 'prNumber', 'issue_number', 'issueNumber', 'number', 'iid'])
  if (number !== undefined && /^\d+$/.test(number)) return `#${number}`
  const key = stringOf(input, ['identifier', 'issueId', 'issue_id', 'issueKey', 'key', 'id'])
  if (key !== undefined && /^[A-Z][A-Z0-9]+-\d+$/.test(key)) return key
  return undefined
}

/** The words a post would say, from its call's input. */
const wordsOf = (input: Readonly<Record<string, unknown>>): string | undefined =>
  stringOf(input, ['body', 'text', 'message', 'comment', 'content', 'markdown'])

/** The tool's name as words: `create_pull_request_review` is create pull request review. */
const wordsInName = (tool: string): ReadonlyArray<string> =>
  tool
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((each) => each !== '')

const READS = new Set([
  'get',
  'list',
  'search',
  'read',
  'fetch',
  'find',
  'query',
  'describe',
  'view',
  'show',
  'download',
  'lookup',
  'resolve',
  'snapshot',
  'screenshot',
  'take',
  'navigate',
  'check',
])
const MERGES = new Set(['merge', 'automerge', 'enqueue'])
const PUBLISHES = new Set(['publish', 'release', 'deploy', 'tag', 'unpublish', 'destroy', 'teardown'])
const POSTS = new Set(['comment', 'comments', 'review', 'reply', 'post', 'send', 'message', 'email', 'mail', 'chat', 'notify', 'dm'])
const DELETES = new Set(['delete', 'remove', 'force', 'reset', 'archive', 'purge'])
/** What a delete or remove takes from the code itself, as opposed to a label or an assignee. */
const HISTORY = new Set(['branch', 'ref', 'repository', 'repo', 'tag', 'file', 'files', 'commit', 'project'])
const DEFAULT_BRANCHES = new Set(['main', 'master', 'trunk', 'develop'])

const capital = (words: string) => words.charAt(0).toUpperCase() + words.slice(1)

/** A general call (`graphql`, `api`) read by what it sends: a mutation's name, or a method and path. */
const generalOf = (input: Readonly<Record<string, unknown>>): ReadonlyArray<string> | undefined => {
  const query = stringOf(input, ['query', 'mutation'])
  if (query !== undefined) {
    const mutation = /\bmutation\b[^{]*\{\s*([A-Za-z_]+)/.exec(query)
    return mutation === null ? [] : ['act', ...wordsInName(mutation[1]!)]
  }
  const method = stringOf(input, ['method'])?.toUpperCase()
  const path = stringOf(input, ['path', 'endpoint', 'url']) ?? ''
  if (method === undefined) return undefined
  if (method === 'GET' || method === 'HEAD') return []
  const words = wordsInName(path)
  return ['act', ...(method === 'DELETE' ? ['delete'] : []), ...(words.includes('merge') ? ['merge'] : []), ...words]
}

/** What one MCP call does, read by its server's tool and arguments. */
export const mcpActOf = (call: McpCall, rawInput: unknown): McpAct => {
  const input = record(rawInput)
  const name = wordsInName(call.tool)
  const general = name.length === 1 && (name[0] === 'graphql' || name[0] === 'api') ? generalOf(input) : undefined
  const words = general ?? name
  const target = targetOf(input)
  const on = target === undefined ? '' : ` ${target}`
  const base = { server: call.server, tool: call.tool }
  const reads =
    general !== undefined
      ? general.length === 0
      : // A browser's tools act on a page on this computer, which nothing outside sees.
        words[0] === 'browser' || (words.length > 0 && READS.has(words[0]!))
  if (reads) return { ...base, acts: false, verb: capital(words.join(' ')), done: capital(words.join(' ')) }

  if (words.some((each) => MERGES.has(each)))
    return {
      ...base,
      acts: true,
      kind: 'publish',
      verb: `Merge${on}`,
      done: `Merged${on}`,
      stays: `Its commits stay in ${stringOf(input, ['base', 'base_branch', 'into']) ?? 'the base branch'}’s history; only a revert takes them out.`,
    }
  if (words.some((each) => PUBLISHES.has(each)) && !words.includes('draft'))
    return {
      ...base,
      acts: true,
      kind: 'publish',
      verb: capital(words.find((each) => PUBLISHES.has(each))!) + on,
      done: `${capital(words.join(' '))}${on}`,
      stays: 'It reaches everyone at once, and what went out stays out.',
    }
  const deletes = words.find((each) => DELETES.has(each))
  if (deletes !== undefined && words.some((each) => HISTORY.has(each)))
    return {
      ...base,
      acts: true,
      kind: 'history',
      verb: capital(words.join(' ')) + on,
      done: capital(words.join(' ')) + on,
      stays: 'What it takes away is gone for everyone who shares it.',
    }
  const branch = stringOf(input, ['branch', 'ref'])
  const writes = words.includes('push') || words.includes('file') || words.includes('files')
  if (writes && branch !== undefined && DEFAULT_BRANCHES.has(branch))
    return {
      ...base,
      acts: true,
      kind: 'history',
      verb: `Push to ${branch}`,
      done: `Pushed to ${branch}`,
      stays: `It’s in ${branch}’s history at once; only a revert takes it out.`,
    }
  // A draft, or a review still pending, is no one's to read yet: it posts when submitted.
  const unsent = words.includes('draft') || (words.includes('pending') && !words.includes('submit'))
  if (words.some((each) => POSTS.has(each)) && !unsent) {
    const said = wordsOf(input)
    return {
      ...base,
      acts: true,
      kind: 'speak',
      verb: target === undefined ? 'Post it' : `Post on ${target}`,
      done: target === undefined ? 'Posted' : `Posted on ${target}`,
      stays: 'Everyone watching it is told at once; it can’t be called back.',
      ...(said === undefined ? {} : { words: said }),
    }
  }
  return { ...base, acts: true, verb: capital(words.join(' ')) + on, done: capital(words.join(' ')) + on }
}
