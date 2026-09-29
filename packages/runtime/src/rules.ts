import { isAbsolute, relative, resolve } from 'node:path'

import type { PermissionRequest } from '@charrette/provider-adapters'

/*
 * The project rules for the MVP (docs/plans/mvp.md): everything is allowed and
 * recorded, except what the always-ask list keeps for the person. Pushes to
 * the default branch, force pushes, merges, deploy and publish commands, and
 * writes outside the task's worktree.
 */

export type Verdict = { readonly verdict: 'allow' } | { readonly verdict: 'ask'; readonly reason: string }

export interface RuleContext {
  /** The task's worktree, where the agent works. */
  readonly worktree: string
  /** The branch pushes to which always ask. */
  readonly defaultBranch: string
}

const ALLOW: Verdict = { verdict: 'allow' }

const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null && key in value ? (value as Record<string, unknown>)[key] : undefined

/** The command an execute request runs: from its raw input where the agent gives one, else its title. */
export const commandOf = (request: PermissionRequest): string => {
  const command = field(request.rawInput, 'command') ?? field(request.rawInput, 'cmd')
  if (typeof command === 'string') return command
  if (Array.isArray(command) && command.every((part) => typeof part === 'string')) return command.join(' ')
  return request.title
}

const PATH_KEYS = ['file_path', 'filePath', 'path', 'notebook_path', 'old_path', 'new_path', 'destination', 'source']

/** Every path an action names: the agent's locations, and path fields of its raw input. */
export const pathsOf = (request: PermissionRequest): ReadonlyArray<string> => [
  ...new Set([
    ...request.paths,
    ...PATH_KEYS.map((key) => field(request.rawInput, key)).filter((value): value is string => typeof value === 'string' && value !== ''),
  ]),
]

const inside = (root: string, path: string) => {
  const within = relative(root, resolve(root, path))
  return within === '' || (!within.startsWith('..') && !isAbsolute(within))
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const always = (command: string, defaultBranch: string): string | undefined => {
  if (/\bgit\s+push\b/.test(command)) {
    if (/\s(--force|--force-with-lease|-f)\b|\s\+\S/.test(command)) return 'A force push always asks.'
    if (new RegExp(`(^|[\\s:])${escape(defaultBranch)}(\\s|$)`).test(command.slice(command.search(/\bpush\b/)))) {
      return `A push to ${defaultBranch} always asks.`
    }
  }
  if (/\b(gh\s+pr\s+merge|glab\s+mr\s+merge)\b/.test(command)) return 'A merge always asks.'
  if (
    /\bdeploy\b|\b(wrangler|vercel|netlify|flyctl|fly|firebase|serverless|cdk)\s+(deploy|publish)\b|\bvercel\b.*--prod\b|\bkubectl\s+(apply|delete|rollout)\b|\bterraform\s+(apply|destroy)\b|\bpulumi\s+up\b|\bhelm\s+(install|upgrade)\b|\b(npm|bun|pnpm|yarn|cargo)\s+publish\b|\bgh\s+release\s+create\b/.test(
      command,
    )
  ) {
    return 'Deploying or publishing always asks.'
  }
  return undefined
}

/**
 * Decides a permission request from the rules. A command is checked against
 * the always-ask list; a write, against the worktree. Anything the rules don't
 * keep for the person is allowed.
 */
export const decide = (request: PermissionRequest, context: RuleContext): Verdict => {
  if (request.kind === 'execute' || request.kind === 'other') {
    const reason = always(commandOf(request), context.defaultBranch)
    if (reason !== undefined) return { verdict: 'ask', reason }
  }
  if (request.kind === 'edit' || request.kind === 'delete' || request.kind === 'move') {
    const outside = pathsOf(request).find((path) => !inside(context.worktree, path))
    if (outside !== undefined) return { verdict: 'ask', reason: `Writing outside the task's worktree always asks: ${outside}` }
  }
  return ALLOW
}
