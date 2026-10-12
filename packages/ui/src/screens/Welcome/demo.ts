import type { ModelInfo } from '../../primitives/Model/Model'
import { Brand } from '../../foundations/brands/brands'
import { CheckState, RuntimeState, SourceOrigin, TaskStatus, Wait } from '../../foundations/vocabulary'
import type { ChangeCheck } from '../../primitives/Checks/Checks'
import type { RuntimeEntry } from '../../setup/Runtimes/Runtimes'
import type { SourceEntry } from '../../setup/SourceMap/SourceMap'

/*
 * What the welcome shows: one made-up project, Meridian, and one task in it,
 * 418, followed from the project to the change. Content, not fixtures: it
 * ships with the welcome.
 */

const model = (id: string, name: string, short: string, mark: Brand, runtime: string): ModelInfo => ({
  id,
  name,
  short,
  mark,
  runtime,
  context: 1000,
  efforts: [],
})

export const OPUS = model('claude-opus-5', 'Claude Opus 5', 'Opus 5', Brand.Anthropic, 'claude-code')
export const SONNET = model('claude-sonnet-5', 'Claude Sonnet 5', 'Sonnet 5', Brand.Anthropic, 'claude-code')
export const GPT = model('gpt-5.2', 'GPT-5.2', 'GPT-5.2', Brand.OpenAI, 'codex')
export const GEMINI = model('gemini-3-pro', 'Gemini 3 Pro', 'Gemini 3 Pro', Brand.Google, 'gemini-cli')

export const STEPS = ['Implement', 'Review', 'Security review', 'Verify'] as const

export const SOURCES: SourceEntry[] = [
  {
    id: 'api',
    name: 'meridian-api',
    where: '~/code/meridian-api',
    origin: SourceOrigin.Existing,
    branch: 'main',
    remote: 'github.com/meridian/api',
    role: 'service',
  },
  {
    id: 'web',
    name: 'meridian-web',
    where: '~/code/meridian-web',
    origin: SourceOrigin.Existing,
    branch: 'main',
    remote: 'github.com/meridian/web',
    role: 'frontend',
  },
]

export const ROLES = [
  { value: 'service', label: 'Service' },
  { value: 'frontend', label: 'Frontend' },
]

export const NOTES = [
  { id: 'n1', title: 'All money values are integer minor units', meta: 'Convention · used by 24 tasks' },
  { id: 'n2', title: 'Webhook deliveries must stay idempotent', meta: 'Decision · used by 9 tasks' },
]

export const LEARNED = { id: 'n3', title: 'Session tokens rotate on privilege change', meta: 'Found by task 418 · just now' }

export const TASK = {
  task: '418',
  title: 'Repair token refresh on privilege change',
  kind: 'Delivery',
}

/* What the lead is doing, step by step. */
export const DOING = ['writing the change', 'two reviewers reading it', 'a security review, added by a rule', 'running the tests'] as const

export const NEXT_UP = [
  {
    task: '427',
    kind: 'Delivery',
    title: 'Backfill idempotency keys on old refunds',
    wait: Wait.Workers,
    reason: 'Starts when an agent is free',
  },
  { task: '429', kind: 'Delivery', title: 'Sign webhook v2 payloads', wait: Wait.After, reason: 'Starts when 418 merges' },
]

export const CALL = {
  kind: 'Decision',
  title: 'Retry after a 429, or fail fast?',
  because: 'Both are defensible; the refunds API has no rule for it yet.',
  options: [
    { id: 'retry', label: 'Queue and retry with backoff', note: 'Caller sees pending. Matches the webhook retries.' },
    { id: 'fail', label: 'Fail fast to the caller', note: 'Consistent with the rest of the refunds API.' },
  ],
}

export const RUNNING_421 = { task: '421', kind: 'Delivery', title: 'Rate-limit refund creation per merchant', status: TaskStatus.Running }

export const PRS = [
  {
    repo: 'meridian/api',
    number: 1191,
    files: [
      { path: 'src/auth/refresh.ts', add: 31, del: 9 },
      { path: 'src/auth/principal.ts', add: 12, del: 4 },
      { path: 'test/auth/refresh.test.ts', add: 44, del: 0 },
    ],
  },
  {
    repo: 'meridian/web',
    number: 512,
    after: { number: 1191, why: 'uses the new refresh endpoint' },
    files: [{ path: 'app/session/useSession.ts', add: 14, del: 6 }],
  },
]

export const checks = (stage: number): ChangeCheck[] => [
  { id: 'unit', name: 'Unit', state: CheckState.Passed, detail: '216 passed' },
  { id: 'review', name: 'Review', state: CheckState.Passed, by: [GPT, GEMINI], detail: '3 findings, 3 fixed' },
  {
    id: 'security',
    name: 'Security review',
    state: stage > 0 ? CheckState.Passed : CheckState.Running,
    by: [SONNET],
    added: true,
    detail: stage > 0 ? 'no findings' : 'reading the diff',
  },
  {
    id: 'integration',
    name: 'Integration',
    state: stage > 1 ? CheckState.Passed : stage > 0 ? CheckState.Running : CheckState.Queued,
    detail: stage > 1 ? '38 passed, across both repositories' : stage > 0 ? 'running' : 'after the security review',
  },
]

export const AGENTS: RuntimeEntry[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    brand: Brand.ClaudeCode,
    state: RuntimeState.Ready,
    account: 'you@meridian.dev · Max',
    version: '2.4.1',
  },
  { id: 'codex', name: 'Codex', brand: Brand.Codex, state: RuntimeState.Ready, account: 'you@meridian.dev · Pro', version: '0.52.0' },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    brand: Brand.GeminiCli,
    state: RuntimeState.Ready,
    account: 'you@meridian.dev',
    version: '1.8.0',
  },
]
