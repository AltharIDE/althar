/*
 * Demo content: one project (Meridian, a payments API) and the task that
 * rate-limits its refunds. Stories and the workbench share it, so every
 * component shows the same world. Not part of the package's API.
 */
import type { DiffLine } from '../thread/Diff/Diff'
import type { AllowedItem, PermissionRequest } from '../thread/Permission/Permission'
import type { RateLimitOption } from '../thread/RateLimit/RateLimit'
import type { ReviewFinding } from '../thread/Review/Review'
import type { StepRef } from '../thread/Shell/Shell'
import { AllowedBy, DiffLineKind, FindingState, Severity, StepState } from '../foundations/vocabulary'
import s from './fixtures.module.css'
import { CODEX, GEMINI_PRO, GPT_MINI, OPUS, QWEN, SONNET } from './models'

export const PROJECT = 'Meridian'

export const refDoc = {
  title: 'Rate limits on refunds',
  body: [
    '# Rate limits on refunds',
    'Refunds draw on the same per-partner budget as charges: 600 requests a minute, shared between the two.',
    '## Over the limit',
    'The API answers `429 Too Many Requests` with a `Retry-After` header, in whole seconds. Nothing is queued: a refused refund was not recorded and can be sent again as it was.',
    '```http\nHTTP/1.1 429 Too Many Requests\nRetry-After: 12\nX-RateLimit-Remaining: 0\n```',
    '## What partners should do',
    '- Wait for `Retry-After`, then resend with the same idempotency key\n- Do not retry faster than the header says\n- Treat `X-RateLimit-Remaining` as advice, not a promise',
    '> Charges and refunds share one budget. A partner sending both at full rate will see refunds refused first.',
    '## Changes',
    'Added in 2.14. Before 2.14 refunds were not limited at all.',
  ].join('\n\n'),
}

export const summaryDoc = {
  title: 'What changed in task 431',
  body: [
    '## Summary',
    'Refunds now go through the same partner limiter as charges and share its budget.',
    '- `src/refunds/router.ts` wraps the refund route in `withPartnerLimit`\n- `src/refunds/limit.test.ts` covers 429, Retry-After, and the shared bucket\n- `docs/api/refunds-rate-limits.md` documents it for partners',
    '## Verified',
    'Staging was frozen, so yesterday’s 1,200 refunds were replayed against the branch locally. Headers match charges exactly.',
    '## Not done',
    'No change to the limit itself. Partners near 600 a minute will now see refunds refused; three did yesterday.',
  ].join('\n\n'),
}

/* The team's own instructions for the review step. */
export const reviewDoc = {
  title: 'review.md',
  body: [
    `# How we review in ${PROJECT}`,
    'You are reviewing a change before it reaches a partner. Report findings; do not fix them.',
    '## Look hardest at',
    '- Anything that moves money: charges, refunds, payouts\n- Idempotency: a retried request must never act twice\n- What partners see: status codes, headers, error bodies',
    '## Leave alone',
    '- Style the linter already enforces\n- Naming, unless it misleads',
    '## Severity',
    'High means a partner could lose money or see a wrong answer. Medium means we would fix it before merging. Low is worth a note.',
  ].join('\n\n'),
}

export const STEPS: Record<'review' | 'security', StepRef & { n: number; of: number }> = {
  review: { id: 'review', n: 3, of: 6, label: 'Review', model: SONNET, state: StepState.Done },
  security: { id: 'security', n: 4, of: 6, label: 'Security review', model: SONNET, state: StepState.Done },
}

/* One review, two reviewers, combined. */
export const FINDINGS: readonly ReviewFinding[] = [
  {
    id: 'f1',
    severity: Severity.High,
    at: 'src/refunds/router.ts:21',
    by: [SONNET, GEMINI_PRO],
    state: FindingState.Open,
    claim: 'The limiter runs after the idempotency lookup, so a replayed request spends budget without doing anything.',
  },
  {
    id: 'f2',
    severity: Severity.Medium,
    at: 'src/charges/limit.ts:42',
    by: [SONNET],
    state: FindingState.Open,
    claim: 'Refunds share the charges bucket, so a partner at full charge volume will have refunds refused. Give refunds their own bucket.',
    against: { model: GEMINI_PRO, text: 'the spec says one budget per partner, so sharing is intended.' },
  },
  {
    id: 'f3',
    severity: Severity.Low,
    at: 'src/refunds/limit.test.ts:52',
    by: [GEMINI_PRO],
    state: FindingState.Open,
    claim: 'The reset test waits on the wall clock. Use fake timers so it cannot flake.',
  },
]

export const SET_ASIDE = 'The spec attached to this task says one budget per partner, and Gemini 3 Pro read it the same way.'

/** The usual end: the lead fixed two and set one aside. */
export const FINDINGS_SETTLED: readonly ReviewFinding[] = FINDINGS.map((f) =>
  f.id === 'f2' ? { ...f, state: FindingState.Aside, reason: SET_ASIDE } : { ...f, state: FindingState.Fixed, round: 2 },
)

/** The reviewers disagree and nothing on the task settles it. */
export const FINDINGS_YOURS: readonly ReviewFinding[] = FINDINGS.map((f) =>
  f.id === 'f2'
    ? {
        ...f,
        state: FindingState.Yours,
        ask: 'The reviewers disagree and nothing on the task settles it. One budget, or a bucket for refunds?',
      }
    : f,
)

/** Two calls for you: the disagreement, and a fix whose reach goes past the task. */
export const FINDINGS_SEVERAL_YOURS: readonly ReviewFinding[] = FINDINGS_YOURS.map((f) =>
  f.id === 'f1'
    ? {
        ...f,
        state: FindingState.Yours,
        ask: 'The fix moves the limiter ahead of the idempotency lookup for every route that shares it, charges included. All routes, or refunds only?',
      }
    : f,
)

export const ROUTER_DIFF: readonly DiffLine[] = [
  { kind: DiffLineKind.Hunk, text: '@@ -18,9 +18,20 @@ export const refunds = router()' },
  { kind: DiffLineKind.Context, old: 18, new: 18, text: "import { idempotent } from '../idempotency'" },
  { kind: DiffLineKind.Added, new: 19, text: "import { withPartnerLimit } from '../charges/limit'" },
  { kind: DiffLineKind.Context, old: 19, new: 20, text: '' },
  { kind: DiffLineKind.Removed, old: 20, text: "refunds.post('/', idempotent(createRefund))", changed: ['))'] },
  {
    kind: DiffLineKind.Added,
    new: 21,
    text: "refunds.post('/', withPartnerLimit(idempotent(createRefund), {",
    changed: ['withPartnerLimit(', '), {'],
  },
  { kind: DiffLineKind.Added, new: 22, text: "  bucket: 'partner'," },
  { kind: DiffLineKind.Added, new: 23, text: "  retryAfter: 'seconds'," },
  { kind: DiffLineKind.Added, new: 24, text: '}))' },
]

export const ROUTER_CODE = `import { idempotent } from '../idempotency'
import { withPartnerLimit } from '../charges/limit'

refunds.post('/', withPartnerLimit(idempotent(createRefund), {
  bucket: 'partner',
  retryAfter: 'seconds',
}))`

/* The file an edit touched, as the side panel shows it. */
export const routerFile = { title: 'router.ts', path: 'src/refunds/router.ts', body: '```ts\n' + ROUTER_CODE + '\n```' }

export const TEST_OUTPUT = [
  ' ✓ refunds/router › returns 429 over the partner limit',
  ' ✓ refunds/router › sets Retry-After in seconds',
  ' ✓ refunds/router › shares the bucket with charges',
  '',
  ' Test Files  4 passed (4)',
  '      Tests  38 passed (38)',
]
export const TEST_EARLIER = [
  ' RUN  v3.2.4 /meridian',
  '',
  ' ✓ charges/limit › counts a charge against the partner bucket',
  ' ✓ charges/limit › answers 429 with Retry-After',
  ' ✓ refunds/handler › refuses a refund over the limit',
  ' ✓ refunds/handler › keeps the idempotency key on a retry',
]

export const LINT_OUTPUT = [
  'src/refunds/limit.test.ts',
  "  14:7  error  'partner' is assigned a value but never used",
  '  52:3  error  Unexpected console statement',
  '',
  '✗ 2 problems (2 errors, 0 warnings)',
]

export const STAGING: PermissionRequest = {
  id: 'replay-staging',
  step: 'Verify on staging',
  agent: CODEX,
  what: 'Run a command that reaches staging',
  cmd: 'pnpm replay --env staging --from 2026-09-25 refunds',
  prefix: 'pnpm replay',
  why: `Passed to you by the lead: staging is on ${PROJECT}’s always-ask list.`,
  kind: 'anything that reaches staging',
}

export const REQUESTS: readonly PermissionRequest[] = [
  STAGING,
  {
    id: 'curl-staging',
    step: 'Verify on staging',
    agent: CODEX,
    what: 'Fetch a page on staging',
    cmd: 'curl https://staging.meridian.dev/health',
    prefix: 'curl https://staging.meridian.dev',
    why: `Staging is on ${PROJECT}’s always-ask list.`,
    kind: 'anything that reaches staging',
  },
  {
    id: 'docs-publish',
    step: 'Docs',
    agent: GPT_MINI,
    what: 'Publish a preview of the docs',
    cmd: 'pnpm docs:publish --preview',
    why: `Publishing is on ${PROJECT}’s always-ask list.`,
  },
]

export const ALLOWED: readonly AllowedItem[] = [
  { id: 'a1', step: 'Security review', cmd: 'pnpm test webhooks/deliver', by: AllowedBy.Rule, rule: 'Rule: tests always run' },
  {
    id: 'a2',
    step: 'Security review',
    cmd: 'rg -n "partnerId" src/logging/',
    by: AllowedBy.Lead,
    lead: OPUS,
    why: 'read-only, inside the workspace',
  },
  {
    id: 'a3',
    step: 'Implement',
    cmd: 'pnpm add -D @sinonjs/fake-timers',
    by: AllowedBy.Lead,
    lead: OPUS,
    why: 'dev dependency the fix needs',
  },
]

export const LIMIT_OPTIONS: readonly RateLimitOption[] = [
  { model: CODEX, note: 'Codex · 38% of this week used' },
  { model: GEMINI_PRO, note: 'Gemini CLI · billed per token' },
  { model: QWEN, note: 'Ollama · this Mac, slower' },
  { model: SONNET, note: 'same limit, resets 14:00', busy: true },
]

/** A partner dashboard, drawn for the screenshots the agent sends. */
export function Dash({ after }: { after?: boolean }) {
  return (
    <span className={s.dash}>
      <span className={s.bar}>
        <i />
        Acme<span>Refunds</span>
      </span>
      <span className={s.body}>
        <span className={s.h}>Refunds</span>
        <span className={s.row}>
          <b>re_3Pq · order 88213</b>
          <span>€42.00</span>
          <span>just now</span>
        </span>
        <span className={s.row}>
          <b>re_3Pp · order 88207</b>
          <span>€18.50</span>
          <span>1 min ago</span>
        </span>
        {after ? (
          <span className={s.note}>
            <b>Too many refunds right now.</b> Sent again automatically in 12 s.
          </span>
        ) : (
          <span className={s.toast}>Something went wrong. Try again.</span>
        )}
      </span>
    </span>
  )
}
