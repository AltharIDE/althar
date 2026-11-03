import type { IconName } from '../../foundations/Icon/icons'
import { Brand } from '../../foundations/brands/brands'
import { ProjectInk } from '../../foundations/ProjectMark/drawing'
import { FindingState, GraphNodeState, Severity } from '../../foundations/vocabulary'
import type { ModelInfo } from '../../primitives/Model/Model'
import type { SealFacts } from '../../seal/seal'
import type { ReviewFinding } from '../../thread/Review/Review'
import type { StepGraphLane, StepGraphRound, StepGraphStep } from '../../thread/StepGraph/StepGraph'

/*
 * What the welcome shows: one made-up project, Meridian, its repositories
 * and its tasks, and one task in it, 418, followed from what was asked to
 * its review. Content, not fixtures: it ships with the welcome.
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
export const GPT = model('gpt-5.2', 'GPT-5.2', 'GPT-5.2', Brand.OpenAI, 'codex')

/* ---- the project ---- */

export const PROJECT = { name: 'Meridian', seed: 'meridian', ink: ProjectInk.Ochre }

export const REPOSITORIES = [
  { name: 'meridian/api', where: '~/Projects/meridian-api', role: 'Service' },
  { name: 'meridian/web', where: '~/Projects/meridian-web', role: 'Frontend' },
  { name: 'meridian/infra', where: '~/Projects/meridian-infra', role: 'Infrastructure' },
] as const

/* What every project has of its own. */
export const HAS: readonly { icon: IconName; name: string }[] = [
  { icon: 'agents', name: 'Its coordinator' },
  { icon: 'work', name: 'Its board' },
  { icon: 'lock', name: 'Its rules' },
  { icon: 'knowledge', name: 'Its notes' },
]

export const TASKS = [
  { task: '418', title: 'Repair token refresh', branch: 'althar/repair-token-refresh' },
  { task: '421', title: 'Rate-limit refunds', branch: 'althar/rate-limit-refunds' },
  { task: '427', title: 'Backfill idempotency keys', branch: 'althar/backfill-keys' },
] as const

/* ---- task 418, asked of the coordinator ---- */

export const ASKED: StepGraphRound = {
  id: 'r1',
  by: 'You asked',
  said: 'Token refresh breaks when someone’s role changes. Fix it, and keep the old cache.',
}

export const REPLY =
  'One task. Opus 5 leads it and writes the change; GPT-5.2 reviews it. A security review joins because it touches auth. It starts unless you change it.'

export const STEPS = ['Implement', 'Review', 'Security review', 'Verify'] as const

export const TASK = {
  task: '418',
  title: 'Repair token refresh on privilege change',
  kind: 'Delivery',
}

/* What the lead is doing, step by step. */
export const DOING = ['writing the change', 'GPT-5.2 reading it', 'a security review, added by a rule', 'running the tests'] as const

/* ---- its steps, a lane for each maker's agent ---- */

export const LANES: readonly StepGraphLane[] = [
  { id: 'lead', who: { kind: 'model', model: OPUS }, lead: true },
  { id: 'reviewer', who: { kind: 'model', model: GPT } },
]

const step = (id: string, lane: string, label: string, state: GraphNodeState, extra: Partial<StepGraphStep> = {}): StepGraphStep => ({
  id,
  lane,
  round: ASKED.id,
  label,
  state,
  ...extra,
})
const IMPLEMENTED = step('implement', 'lead', 'Implement', GraphNodeState.Done, { corner: '24m' })
const REVIEWED = step('review', 'reviewer', 'Review', GraphNodeState.Done, { corner: '2m', outcome: '2 findings', warn: true })

/* The steps as they stand after each beat: implemented, reviewed by another maker's agent, settled by the lead. */
export const LOOP: readonly (readonly StepGraphStep[])[] = [
  [
    step('implement', 'lead', 'Implement', GraphNodeState.Now, { corner: '4m' }),
    step('review', 'reviewer', 'Review', GraphNodeState.Next, { corner: 'next' }),
  ],
  [IMPLEMENTED, step('review', 'reviewer', 'Review', GraphNodeState.Now, { corner: '1m' })],
  [IMPLEMENTED, REVIEWED, step('settle', 'lead', 'Settle', GraphNodeState.Now, { corner: '3m' })],
  [IMPLEMENTED, REVIEWED, step('settle', 'lead', 'Settle', GraphNodeState.Done, { corner: '6m', outcome: '1 fixed, 1 kept' })],
]

/* ---- its review: GPT-5.2 read what Opus 5 wrote; the lead fixes one finding and sets the other aside ---- */

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
