import { Brand } from '../foundations/brands/brands'
import type { CodeHost } from '../foundations/codeHost'
import { ChangeState, CheckState } from '../foundations/vocabulary'
import type { ChangeSetProps, PullRequest } from '../outputs/ChangeSet/ChangeSet'
import type { ChangeCheck } from '../primitives/Checks/Checks'
import { GEMINI_PRO, OPUS, SONNET } from './models'

export const GITHUB: CodeHost = { name: 'GitHub', brand: Brand.GitHub }

/* Task 418's change, across Meridian's API and web app, at each point on its way to you. */

export const PRS_418: PullRequest[] = [
  {
    repo: 'stripe-internal/meridian-api',
    number: 1187,
    url: 'https://github.com/stripe-internal/meridian-api/pull/1187',
    files: [
      { path: 'src/auth/session.ts', add: 64, del: 22 },
      { path: 'src/auth/principal-cache.ts', add: 31, del: 9 },
      { path: 'test/auth/rotation.test.ts', add: 31, del: 0 },
    ],
  },
  {
    repo: 'stripe-internal/meridian-web',
    number: 412,
    url: 'https://github.com/stripe-internal/meridian-web/pull/412',
    files: [{ path: 'src/middleware/require-auth.ts', add: 14, del: 3 }],
    after: { number: 1187, why: 'calls invalidate() from the API change' },
  },
]

export const PR_416: PullRequest[] = [
  {
    repo: 'stripe-internal/meridian-api',
    number: 1191,
    url: 'https://github.com/stripe-internal/meridian-api/pull/1191',
    files: [
      { path: 'src/refunds/create.ts', add: 21, del: 7 },
      { path: 'src/refunds/idempotency.ts', add: 9, del: 2 },
      { path: 'test/refunds/idempotency.test.ts', add: 18, del: 0 },
    ],
  },
]

export const CHECKS_RUNNING: ChangeCheck[] = [
  { id: 'unit', name: 'Unit', state: CheckState.Passed, detail: '214 passed' },
  { id: 'review', name: 'Review', state: CheckState.Passed, by: [SONNET, GEMINI_PRO], detail: '3 findings, 3 fixed' },
  { id: 'security', name: 'Security review', state: CheckState.Running, by: [SONNET], added: true, detail: 'reading the diff · 6m' },
  { id: 'integration', name: 'Integration', state: CheckState.Queued, detail: 'after the security review' },
]

export const CHECKS_HELD: ChangeCheck[] = [
  { id: 'unit', name: 'Unit', state: CheckState.Passed, detail: '209 passed' },
  { id: 'review', name: 'Review', state: CheckState.Held, by: [SONNET, GEMINI_PRO], detail: '3 findings · one waits on your call' },
  { id: 'integration', name: 'Integration', state: CheckState.Queued, detail: 'after the fixes' },
]

export const CHECKS_FAILED: ChangeCheck[] = [
  { id: 'unit', name: 'Unit', state: CheckState.Passed, detail: '216 passed' },
  { id: 'integration', name: 'Integration', state: CheckState.Failed, detail: '2 of 38 failed · the lead is fixing them' },
]

export const CHECKS_PASSED: ChangeCheck[] = [
  { id: 'unit', name: 'Unit', state: CheckState.Passed, detail: '216 passed' },
  { id: 'review', name: 'Review', state: CheckState.Passed, by: [SONNET, GEMINI_PRO], detail: '2 rounds · clean on the second' },
  { id: 'security', name: 'Security review', state: CheckState.Passed, by: [SONNET], added: true, detail: 'no findings' },
  { id: 'integration', name: 'Integration', state: CheckState.Passed, detail: '38 passed, across both repositories' },
]

type Data = Omit<ChangeSetProps, 'onAccept' | 'onSendBack' | 'onReviewDiff' | 'onOpenFile' | 'text'>

const BASE_418 = {
  host: GITHUB,
  title: 'Repair token refresh on privilege change',
  branch: 'ch/418-token-refresh',
  base: 'main',
  lead: OPUS,
  reviewers: [SONNET, GEMINI_PRO],
  prs: PRS_418,
}

export const CHANGE_DRAFT: Data = {
  ...BASE_418,
  state: ChangeState.Draft,
  note: 'Opens for review when every check passes',
  commits: 9,
  checks: CHECKS_RUNNING,
}

export const CHANGE_HELD: Data = {
  ...BASE_418,
  state: ChangeState.Draft,
  note: 'Held until you make the call on the fallback',
  commits: 6,
  checks: CHECKS_HELD,
}

export const CHANGE_READY: Data = {
  ...BASE_418,
  state: ChangeState.Ready,
  note: 'Every check passed · nothing merges until you accept',
  commits: 11,
  checks: CHECKS_PASSED,
}

export const CHANGE_MERGED: Data = {
  ...BASE_418,
  state: ChangeState.Merged,
  note: 'Accepted by you · merged in order · 3h ago',
  commits: 11,
  checks: CHECKS_PASSED,
}

export const CHANGE_ONE_REPO: Data = {
  host: GITHUB,
  title: 'Return 409 when a refund idempotency key is reused',
  branch: 'ch/416-idem-409',
  base: 'main',
  lead: OPUS,
  reviewers: [OPUS],
  prs: PR_416,
  state: ChangeState.Ready,
  note: 'Every check passed · nothing merges until you accept',
  commits: 4,
  checks: [
    { id: 'unit', name: 'Unit', state: CheckState.Passed, detail: '88 passed' },
    { id: 'review', name: 'Review', state: CheckState.Passed, by: [OPUS], detail: '1 finding, fixed' },
    { id: 'integration', name: 'Integration', state: CheckState.Passed, detail: '12 passed' },
  ],
}
