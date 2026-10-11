import { CommandMatch, RuleKind, RulePlace } from '../foundations/vocabulary'
import type { AgentAccounts, RuleCommand } from '../screens/ProjectRules/ProjectRules'
import type { RepositoryNaming, RepositoryTemplate } from '../setup/Conventions/Conventions'

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
