import type { ModelInfo } from '../../primitives/Model/Model'
import { Brand } from '../../foundations/brands/brands'
import { FindingState, RuntimeState, Severity, TaskStatus, Wait } from '../../foundations/vocabulary'
import type { RuntimeEntry } from '../../setup/Runtimes/Runtimes'
import type { SealFacts } from '../../seal/seal'
import type { ReviewFinding } from '../../thread/Review/Review'

/*
 * What the welcome shows: one made-up project, Meridian, and one task in it,
 * 418, followed from what was asked to its review. Content, not fixtures:
 * it ships with the welcome.
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

/* The review of 418's change: GPT-5.2 read what Opus 5 wrote. The lead fixes one finding and sets the other aside. */
export const REVIEWING = 'reading the change'
export const FIX = 'r1'
export const FINDINGS: readonly ReviewFinding[] = [
  {
    id: FIX,
    severity: Severity.High,
    at: 'src/auth/refresh.ts:48',
    by: [GPT],
    state: FindingState.Open,
    claim: 'The old cache is read before the role check, so a demoted session keeps its old scopes until the token expires.',
  },
  {
    id: 'r2',
    severity: Severity.Medium,
    at: 'src/auth/principal.ts:21',
    by: [GPT],
    state: FindingState.Open,
    claim: 'Rotate the token on every role change, not only when a role is taken away.',
  },
]
export const SET_ASIDE = 'Promotions already get a new token at sign-in, and the task asked for demotions only.'
export const SEALED = 'Reviewed by GPT-5.2 in 2 passes'
export const SEAL: SealFacts = { model: 'GPT-5.2', sha: '2f67c42', passes: 2, date: '2026-11-01' }
