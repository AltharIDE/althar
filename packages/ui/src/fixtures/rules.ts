import { CommandMatch, RuleKind, RulePlace } from '../foundations/vocabulary'
import type { AgentAccounts, RuleCommand } from '../screens/ProjectRules/ProjectRules'
import type { RepositoryNaming, RepositoryTemplate } from '../setup/Conventions/Conventions'
import type { ImportRule, SkippedRule } from '../setup/RulesImport/RulesImport'

/*
 * Meridian's rules, as the rules screen draws them: where each kind of
 * request sits, the commands it names (some kept from a permission's
 * "always allow"), how its three repositories name branches and describe
 * pull requests, and Claude Code with two accounts.
 */

export const MERIDIAN_KINDS: Readonly<Record<RuleKind, RulePlace>> = {
  [RuleKind.DefaultBranch]: RulePlace.Ask,
  [RuleKind.ForcePush]: RulePlace.Never,
  [RuleKind.ManyBranches]: RulePlace.Rest,
  [RuleKind.DeleteBranch]: RulePlace.Ask,
  [RuleKind.Deploy]: RulePlace.Ask,
  [RuleKind.Outside]: RulePlace.Rest,
}

const command = (place: RuleCommand['place'], pattern: string, match = CommandMatch.Prefix): RuleCommand => ({
  id: `${place}:${match}:${pattern}`,
  pattern,
  match,
  place,
})

export const MERIDIAN_COMMANDS: readonly RuleCommand[] = [
  command(RulePlace.Never, 'aws s3 rm'),
  command(RulePlace.Never, 'doppler secrets'),
  command(RulePlace.Ask, 'stripe'),
  command(RulePlace.Ask, 'psql'),
  command(RulePlace.Ask, 'docker push'),
  command(RulePlace.Allow, 'bun test'),
  command(RulePlace.Allow, 'bun install'),
  command(RulePlace.Allow, 'git fetch'),
  command(RulePlace.Allow, 'curl localhost'),
  command(RulePlace.Allow, 'docker compose up'),
  command(RulePlace.Allow, 'pnpm replay --env staging --from 2026-09-25 refunds', CommandMatch.Exact),
]

/** What a pattern makes for the example task, as the desktop app works it out. */
export const exampleName = (pattern: string) =>
  pattern.replace('{key}', 'MER-128').replace('{slug}', 'refund-banner').replace('{title}', 'Show the refund banner')

/** Each repository's CONTRIBUTING.md names branches alike. */
export const MERIDIAN_BRANCHES: readonly RepositoryNaming[] = [
  { id: 'app', name: 'meridian-app', found: { pattern: 'feat/{key}-{slug}', from: 'CONTRIBUTING.md' } },
  { id: 'api', name: 'meridian-api', found: { pattern: 'feat/{key}-{slug}', from: 'CONTRIBUTING.md' } },
  { id: 'infra', name: 'meridian-infra', found: { pattern: 'feat/{key}-{slug}', from: 'AGENTS.md' } },
]

/** Where the infrastructure's docs say nothing, so Althar names its branches its own way. */
export const MERIDIAN_BRANCHES_APART: readonly RepositoryNaming[] = [
  { id: 'app', name: 'meridian-app', found: { pattern: 'feat/{key}-{slug}', from: 'CONTRIBUTING.md' } },
  { id: 'api', name: 'meridian-api', found: null },
  { id: 'infra', name: 'meridian-infra', found: null },
]

export const MERIDIAN_TITLES: readonly RepositoryNaming[] = [
  { id: 'app', name: 'meridian-app', found: null },
  { id: 'api', name: 'meridian-api', found: null },
  { id: 'infra', name: 'meridian-infra', found: null },
]

export const MERIDIAN_TEMPLATES: readonly RepositoryTemplate[] = [
  { id: 'app', name: 'meridian-app', path: '.github/pull_request_template.md' },
  { id: 'api', name: 'meridian-api', path: '.github/PULL_REQUEST_TEMPLATE.md' },
  { id: 'infra', name: 'meridian-infra', path: null },
]

export const MERIDIAN_ACCOUNTS: readonly AgentAccounts[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    accounts: [
      { id: 'personal', label: 'Personal' },
      { id: 'work', label: 'Work' },
    ],
  },
]

/** What Meridian's agents' own settings say, as rules it can take: Claude Code's, the person's Codex rules, OpenCode's. */
export const MERIDIAN_IMPORT: readonly ImportRule[] = [
  {
    id: 'rm',
    place: RulePlace.Never,
    pattern: 'rm -rf',
    match: CommandMatch.Prefix,
    from: '.claude/settings.json',
    said: 'Bash(rm -rf:*)',
  },
  {
    id: 'push',
    place: RulePlace.Never,
    pattern: 'git push --force',
    match: CommandMatch.Prefix,
    from: '~/.codex/rules/default.rules',
    said: 'prefix_rule(pattern = ["git", "push", "--force"], decision = "forbidden")',
  },
  {
    id: 'tf',
    place: RulePlace.Ask,
    pattern: 'terraform',
    match: CommandMatch.Prefix,
    from: 'opencode.json',
    said: 'bash: "terraform *": "ask"',
  },
  {
    id: 'test',
    place: RulePlace.Allow,
    pattern: 'npm test',
    match: CommandMatch.Prefix,
    from: '.claude/settings.json',
    said: 'Bash(npm test:*)',
  },
  {
    id: 'status',
    place: RulePlace.Allow,
    pattern: 'git status',
    match: CommandMatch.Exact,
    from: '.claude/settings.local.json',
    said: 'Bash(git status)',
  },
]

/** What can't be one of its rules, with why, as the desktop app says it. */
export const MERIDIAN_SKIPPED: readonly SkippedRule[] = [
  { id: 'env', from: '.claude/settings.json', said: 'Read(./.env)', why: 'A rule on files: the project’s rules don’t hold paths yet.' },
  {
    id: 'fetch',
    from: '.claude/settings.json',
    said: 'WebFetch(domain:stripe.com)',
    why: 'A rule on the web: the project’s rules don’t hold domains yet.',
  },
  {
    id: 'merge',
    from: '~/.claude/settings.json',
    said: 'Bash(gh pr merge:*)',
    why: 'No project can change this: agents reach the code host through Althar.',
  },
]
