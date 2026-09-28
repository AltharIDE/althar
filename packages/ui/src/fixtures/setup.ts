import { useState } from 'react'

import { Brand } from '../foundations/brands/brands'
import { ConnectKind, RuntimeState, SourceOrigin } from '../foundations/vocabulary'
import type { SelectOption } from '../primitives/Select/Select'
import type { ConnectOption } from '../setup/ConnectAgent/ConnectAgent'
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

/* The other ways to connect an agent, as this Mac finds them. */
export const CONNECT: ConnectOption[] = [
  { id: 'cursor', name: 'Cursor', brand: Brand.Cursor, kind: ConnectKind.App, state: 'Not installed' },
  { id: 'copilot', name: 'GitHub Copilot', brand: Brand.GitHubCopilot, kind: ConnectKind.App, state: 'Not installed' },
  { id: 'anthropic', name: 'Anthropic API', brand: Brand.Anthropic, kind: ConnectKind.Key },
  { id: 'openai', name: 'OpenAI API', brand: Brand.OpenAI, kind: ConnectKind.Key },
  { id: 'openrouter', name: 'OpenRouter', brand: Brand.OpenRouter, kind: ConnectKind.Key },
  { id: 'ollama', name: 'Ollama', brand: Brand.Ollama, kind: ConnectKind.Local, state: 'Running · 3 models', ready: true },
  { id: 'lm-studio', name: 'LM Studio', brand: Brand.LMStudio, kind: ConnectKind.Local, state: 'Not running' },
]

export const ROLES: SelectOption<string>[] = [
  { value: 'service', label: 'Service' },
  { value: 'frontend', label: 'Frontend' },
  { value: 'infrastructure', label: 'Infrastructure' },
  { value: 'library', label: 'Library' },
  { value: 'docs', label: 'Docs' },
  { value: 'other', label: 'Other' },
]

/* Meridian's repositories as Charrette read them, with what it found. */
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
    cloneTo: '~/Charrette/meridian-infra',
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
    cloneTo: '~/Charrette/meridian-infra',
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
        { id: `${name}-${now.length}`, name, where: url, origin: SourceOrigin.Clone, cloneTo: `~/Charrette/${name}`, role: 'other' },
      ])
    },
  }
}
