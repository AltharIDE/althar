import { useState } from 'react'

import { Brand } from '../foundations/brands/brands'
import { RuntimeState, SourceOrigin } from '../foundations/vocabulary'
import type { SelectOption } from '../primitives/Select/Select'
import type { AccountEntry, FoundFolder } from '../setup/Accounts/Accounts'
import type { AgentTab } from '../setup/AgentTabs/AgentTabs'
import type { ServiceConnection, ServiceOption } from '../setup/Connections/Connections'
import type { AgentGlance, MarkGlance } from '../setup/ControlCenter/ControlCenter'
import type { SwitchedModel } from '../setup/ModelSwitches/ModelSwitches'
import type { RuntimeEntry } from '../setup/Runtimes/Runtimes'
import type { SourceEntry } from '../setup/SourceMap/SourceMap'

const CLAUDE_CODE = { id: 'claude-code', name: 'Claude Code', brand: Brand.ClaudeCode }
const CODEX = { id: 'codex', name: 'Codex', brand: Brand.Codex }
const GEMINI_CLI = { id: 'gemini-cli', name: 'Gemini CLI', brand: Brand.GeminiCli }
const OLLAMA = { id: 'ollama', name: 'Ollama', brand: Brand.Ollama }

/* What a first run finds on a typical Mac: one signed in, one signed out, one not installed. */
export const FIRST_RUN: RuntimeEntry[] = [
  { ...CLAUDE_CODE, state: RuntimeState.Ready, account: 'you@meridian.dev · Max', version: '2.4.1' },
  { ...CODEX, state: RuntimeState.SignedOut },
  { ...GEMINI_CLI, state: RuntimeState.Missing },
]

/* Nothing ready yet. */
export const NONE_READY: RuntimeEntry[] = [
  { ...CLAUDE_CODE, state: RuntimeState.SignedOut },
  { ...CODEX, state: RuntimeState.Missing },
]

/* Every state a runtime can be in, once work is running on them. */
export const EVERY_STATE: RuntimeEntry[] = [
  { ...CLAUDE_CODE, state: RuntimeState.OutOfUsage, resets: '16:00', movesTo: 'Codex' },
  { ...CODEX, state: RuntimeState.Ready, account: 'you@meridian.dev · Pro', version: '0.52.0' },
  { ...GEMINI_CLI, state: RuntimeState.SignedOut, waiting: 2 },
  { ...OLLAMA, state: RuntimeState.Outdated, version: '0.3.2', needs: '0.5' },
  { id: 'aider', name: 'Aider', state: RuntimeState.Checking },
]

export const ROLES: SelectOption<string>[] = [
  { value: 'service', label: 'Service' },
  { value: 'frontend', label: 'Frontend' },
  { value: 'infrastructure', label: 'Infrastructure' },
  { value: 'library', label: 'Library' },
  { value: 'docs', label: 'Docs' },
  { value: 'other', label: 'Other' },
]

/* Meridian's repositories as Althar read them, with what it found. */
export const MERIDIAN_MAP: SourceEntry[] = [
  {
    id: 'api',
    name: 'meridian-api',
    where: '~/code/meridian-api',
    origin: SourceOrigin.Existing,
    branch: 'main',
    remote: 'github.com/meridian/api',
    role: 'service',
    findings: [
      { id: 'dirty', text: 'Changes not yet committed on main. They stay as they are; tasks work in a worktree of their own.' },
      {
        id: 'nested',
        text: 'A repository inside it, at vendor/stripe-mock.',
        choice: {
          label: 'What to do with vendor/stripe-mock',
          options: [
            { value: 'part', label: 'Leave it as part of meridian-api' },
            { value: 'own', label: 'Add it as a source of its own' },
          ],
          value: 'part',
        },
      },
    ],
  },
  {
    id: 'web',
    name: 'meridian-web',
    where: '~/code/meridian-web',
    origin: SourceOrigin.Existing,
    branch: 'refund-status',
    remote: 'github.com/you/meridian-web',
    role: 'frontend',
    findings: [
      {
        id: 'fork',
        text: 'Its remote is your fork of meridian/web.',
        choice: {
          label: 'Where tasks open pull requests',
          options: [
            { value: 'upstream', label: 'Pull requests on meridian/web' },
            { value: 'fork', label: 'Pull requests on your fork' },
          ],
          value: 'upstream',
        },
      },
    ],
  },
  {
    id: 'platform',
    name: 'platform',
    where: '~/code/platform',
    origin: SourceOrigin.Existing,
    branch: 'main',
    remote: 'github.com/meridian/platform',
    role: 'library',
    findings: [
      {
        id: 'mono',
        text: 'A workspace of 14 packages.',
        choice: {
          label: 'Where in platform tasks may change things',
          options: [
            { value: 'money', label: 'Only packages/money and apps/billing' },
            { value: 'all', label: 'Anywhere in it' },
          ],
          value: 'money',
        },
      },
    ],
  },
  {
    id: 'infra',
    name: 'meridian-infra',
    where: 'github.com/meridian/infra',
    origin: SourceOrigin.Clone,
    cloneTo: '~/Althar/meridian-infra',
    role: 'infrastructure',
  },
]

/* One repository, still being read. */
export const READING_MAP: SourceEntry[] = [
  { id: 'docs', name: 'meridian-docs', where: '~/code/meridian-docs', origin: SourceOrigin.Existing, reading: true, role: 'docs' },
]

/* The corners: a repository with no remote, and one to map later. */
export const EDGE_MAP: SourceEntry[] = [
  {
    id: 'ledger',
    name: 'ledger-scripts',
    where: '~/code/ledger-scripts',
    origin: SourceOrigin.Existing,
    branch: 'main',
    role: 'other',
    findings: [{ id: 'local', text: 'Only on this Mac. Your other devices and your team can’t work in it until it has a remote.' }],
  },
  {
    id: 'infra',
    name: 'meridian-infra',
    where: 'github.com/meridian/infra',
    origin: SourceOrigin.Later,
    cloneTo: '~/Althar/meridian-infra',
    role: 'infrastructure',
  },
]

/* Opening one folder that needs nothing decided: the project is made at once. */
export const ONE_REPOSITORY: SourceEntry[] = [
  {
    id: 'halyard',
    name: 'halyard-api',
    where: '~/code/halyard-api',
    origin: SourceOrigin.Existing,
    branch: 'main',
    remote: 'github.com/halyard/api',
    role: 'service',
  },
]

/** A source map you can change, in memory, for stories: roles, origins, findings, removing and adding. */
export function useSourceMap(initial: readonly SourceEntry[]) {
  const [sources, setSources] = useState<readonly SourceEntry[]>(initial)
  const change = (id: string, f: (x: SourceEntry) => SourceEntry) => setSources((now) => now.map((x) => (x.id === id ? f(x) : x)))
  return {
    sources,
    onRoleChange: (id: string, role: string) => change(id, (x) => ({ ...x, role })),
    onOriginChange: (id: string, origin: SourceOrigin) => change(id, (x) => ({ ...x, origin })),
    onFindingChange: (id: string, finding: string, value: string) =>
      change(id, (x) => ({
        ...x,
        findings: x.findings?.map((f) => (f.id === finding && f.choice ? { ...f, choice: { ...f.choice, value } } : f)),
      })),
    onRemove: (id: string) => setSources((now) => now.filter((x) => x.id !== id)),
    onAddUrl: (url: string) => {
      const name =
        url
          .replace(/\.git$/, '')
          .split('/')
          .pop() || url
      setSources((now) => [
        ...now,
        { id: `${name}-${now.length}`, name, where: url, origin: SourceOrigin.Clone, cloneTo: `~/Althar/${name}`, role: 'other' },
      ])
    },
  }
}

/* The code hosts and trackers a person can connect: GitHub signs in in the browser; Linear, Trello and Jira take a token here. */
export const SERVICES: ServiceOption[] = [
  {
    id: 'github',
    name: 'GitHub',
    brand: Brand.GitHub,
    what: 'Pull requests and issues',
    hostedUrl: 'https://github.com',
    selfHosted: true,
    browserSignIn: true,
    tokenHelp: 'https://github.com/settings/personal-access-tokens/new',
  },
  {
    id: 'linear',
    name: 'Linear',
    brand: Brand.Linear,
    what: 'Issues',
    hostedUrl: 'https://linear.app',
    selfHosted: false,
    browserSignIn: false,
    tokenHelp: 'https://linear.app/settings/account/security',
  },
  {
    id: 'trello',
    name: 'Trello',
    brand: Brand.Trello,
    what: 'Issues',
    hostedUrl: 'https://trello.com',
    selfHosted: false,
    browserSignIn: false,
    tokenNeeds: 'key',
    tokenHelp: 'https://trello.com/power-ups/admin',
    tokenHelpForKey: 'https://trello.com/1/authorize?expiration=never&name=Althar&scope=read,write&response_type=token&key={key}',
    keyChecks: [
      { pattern: '^[0-9a-fA-F]{64}$', says: 'That’s the Power-Up’s secret; paste its API key' },
      { pattern: '^(?![0-9a-fA-F]{32}$)', says: 'An API key is 32 characters' },
    ],
  },
  {
    id: 'jira_cloud',
    name: 'Jira',
    brand: Brand.Jira,
    what: 'Issues',
    hostedUrl: null,
    selfHosted: false,
    browserSignIn: false,
    tokenNeeds: 'email',
    tokenHelp: 'https://id.atlassian.com/manage-profile/security/api-tokens',
    instanceExample: 'https://your-site.atlassian.net',
  },
]

/* Signed in to GitHub twice, on github.com and a company's own server; Linear's token stopped working. */
export const CONNECTED: ServiceConnection[] = [
  { id: 'conn_1', service: 'github', account: 'you' },
  { id: 'conn_2', service: 'github', account: 'you', instance: 'https://git.meridian.dev' },
  { id: 'conn_3', service: 'linear', account: 'You', needsSignIn: true },
]

/** Codex with five accounts: its usual folder, one Althar made, one codex-profiles made that is out of usage, one signed out, and a key, billed per use, last. */
export const ACCOUNTS: AccountEntry[] = [
  {
    id: 'acc_usual',
    name: 'Personal',
    place: { kind: 'usual' },
    state: { kind: 'ready', paid: 'plan' },
    who: 'you@meridian.dev',
    plan: 'ChatGPT Pro',
  },
  {
    id: 'acc_work',
    name: 'Northwind',
    place: { kind: 'own' },
    state: { kind: 'ready', paid: 'plan' },
    who: 'dana@northwind.io',
    plan: 'ChatGPT Team',
  },
  {
    id: 'acc_client',
    name: 'Client',
    place: { kind: 'adopted', folder: '~/.codex-client', from: 'codex-profiles' },
    state: { kind: 'out', back: '14:00' },
  },
  { id: 'acc_side', name: 'side', place: { kind: 'own' }, state: { kind: 'signedOut' } },
  { id: 'acc_key', name: 'API key', place: { kind: 'own' }, state: { kind: 'ready', paid: 'key' }, who: 'OpenAI key ····4f2a' },
]

/** Folders account switchers keep Codex accounts in, not added yet. */
export const FOUND: FoundFolder[] = [
  { id: 'grant_personal', name: 'personal', folder: '~/.codex-personal', from: 'codex-profiles' },
  { id: 'grant_side', name: 'side', folder: '~/.local/share/codex-accounts/accounts/side', from: 'codex-account-switcher' },
]

/** The agents on this Mac, as Settings shows them one at a time. */
export const AGENT_TABS: AgentTab[] = [
  { ...CLAUDE_CODE, line: 'Anthropic · 2.4.1' },
  { ...CODEX, line: 'OpenAI · 0.159.3', yours: true },
  { id: 'opencode', name: 'OpenCode', brand: Brand.OpenCode, line: 'Any provider · 1.4.0' },
]

/** The same agents at a glance, in the Control Center's Agents module: one word each on where it stands. */
export const AGENT_GLANCES: AgentGlance[] = [
  { ...CLAUDE_CODE, line: 'Acme out until 14:20', tone: 'quiet' },
  { ...CODEX, line: 'Northwind signed out', tone: 'yours' },
  { id: 'opencode', name: 'OpenCode', brand: Brand.OpenCode, line: '1 account' },
]

/** Code hosts and trackers at a glance: faint where not connected, a dot where one needs signing in again. */
export const MARK_GLANCES: MarkGlance[] = [
  { id: 'github', name: 'GitHub', brand: Brand.GitHub },
  { id: 'gitlab', name: 'GitLab', brand: Brand.GitLab, faint: true },
  { id: 'bitbucket', name: 'Bitbucket', brand: Brand.Bitbucket, faint: true },
  { id: 'linear', name: 'Linear', brand: Brand.Linear, yours: true },
  { id: 'jira', name: 'Jira', brand: Brand.Jira, faint: true },
  { id: 'trello', name: 'Trello', brand: Brand.Trello, faint: true },
]

/** Codex's models. */
export const CODEX_MODELS: SwitchedModel[] = [
  { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol' },
  { id: 'gpt-5.2-codex', name: 'GPT-5.2 Codex' },
  { id: 'gpt-5-mini', name: 'GPT-5 mini' },
]

/** The line each commit gets while Althar is co-author: its GitHub account's private address, so GitHub shows its picture. */
export const CO_AUTHOR_TRAILER = 'Co-authored-by: Althar <337922799+AltharAi@users.noreply.github.com>'
