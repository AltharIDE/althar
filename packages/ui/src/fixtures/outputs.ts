import { Brand } from '../foundations/brands/brands'
import type { CodeHost } from '../foundations/codeHost'
import { ChangeState, CheckState } from '../foundations/vocabulary'
import type { ChangeSetProps, PullRequest } from '../outputs/ChangeSet/ChangeSet'
import type { TrackStop } from '../outputs/ChangeSet/ChangeTrack'
import type { ChangeCheck } from '../primitives/Checks/Checks'
import { GEMINI_PRO, OPUS, SONNET } from './models'

export const GITHUB: CodeHost = { name: 'GitHub', brand: Brand.GitHub }
export const GITLAB: CodeHost = { name: 'GitLab', brand: Brand.GitLab }

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

type Data = Omit<ChangeSetProps, 'actions' | 'onReviewDiff' | 'onOpenFile' | 'text'>

/** The host's checks alone: its review is a line of its own. */
const hosts = (checks: ChangeCheck[]) => checks.filter((check) => check.id !== 'review')

const BASE_418 = { host: GITHUB, prs: PRS_418 }

export const CHANGE_DRAFT: Data = {
  ...BASE_418,
  state: ChangeState.Draft,
  checks: hosts(CHECKS_RUNNING),
  review: { state: CheckState.Passed, by: [SONNET, GEMINI_PRO] },
}

export const CHANGE_HELD: Data = {
  ...BASE_418,
  state: ChangeState.Draft,
  checks: CHECKS_HELD,
}

export const CHANGE_READY: Data = {
  ...BASE_418,
  state: ChangeState.Ready,
  checks: hosts(CHECKS_PASSED),
  review: { state: CheckState.Passed, by: [SONNET, GEMINI_PRO] },
}

export const CHANGE_FAILED: Data = {
  ...BASE_418,
  state: ChangeState.Ready,
  checks: CHECKS_FAILED,
  review: { state: CheckState.Passed, by: [SONNET, GEMINI_PRO] },
}

export const CHANGE_MERGED: Data = { ...CHANGE_READY, state: ChangeState.Merged }
/** Accepted, and in its branch's merge queue: its host merges it once the queue's checks pass. */
export const CHANGE_QUEUED: Data = { ...CHANGE_READY, state: ChangeState.Queued }

export const CHANGE_ONE_REPO: Data = {
  host: GITHUB,
  prs: PR_416,
  state: ChangeState.Ready,
  checks: [
    { id: 'unit', name: 'Unit', state: CheckState.Passed, detail: '88 passed' },
    { id: 'integration', name: 'Integration', state: CheckState.Passed, detail: '12 passed' },
  ],
  review: { state: CheckState.Passed, by: [OPUS] },
}

/** Work that ended on its branch, with no pull request: its repository's files, and the review it passed; it merges on this Mac. */
export const CHANGE_BRANCH: Data = {
  prs: [{ repo: 'meridian-api', files: PR_416[0]?.files ?? [] }],
  state: ChangeState.Branch,
  branch: 'althar/return-409-on-reuse',
  review: { state: CheckState.Passed, by: [SONNET] },
}

/** A fix for signed-in redirects, ended on its branch: two commits not pushed, and paths too long for the card beside what it made. */
export const CHANGE_REDIRECTS: Data = {
  prs: [
    {
      repo: 'frontend',
      files: [
        { path: 'middleware.ts', add: 2, del: 6 },
        { path: 'app/hooks/useAuthPageRedirect.ts', add: 26, del: 0 },
        { path: 'app/login/page.tsx', add: 4, del: 0 },
        { path: 'app/signup/page.tsx', add: 4, del: 0 },
        { path: 'lib/auth-page-destination.ts', add: 7, del: 0 },
        { path: 'e2e/07-auth-page-redirects.spec.ts', add: 51, del: 0 },
        { path: 'tests/unit/auth-page-destination.test.js', add: 9, del: 0 },
        { path: 'tests/unit/middleware.test.js', add: 19, del: 0 },
      ],
    },
  ],
  state: ChangeState.Branch,
  branch: 'althar/fnt-225-fix-signed-in-redirects-on-auth-pages',
  remote: { name: 'origin', pushed: true, ahead: 2 },
  review: { state: CheckState.Passed, by: [SONNET] },
}

/** A nightly dependency check's files: the lockfile, and a manifest in nearly every folder. */
export const NIGHTLY_FILES = [
  { path: 'bun.lock', add: 214, del: 263 },
  { path: 'package.json', add: 9, del: 9 },
  { path: '.github/workflows/ci.yml', add: 2, del: 2 },
  { path: 'apps/cli/package.json', add: 3, del: 3 },
  { path: 'apps/desktop/package.json', add: 11, del: 11 },
  { path: 'apps/report/package.json', add: 2, del: 2 },
  { path: 'apps/site/package.json', add: 4, del: 4 },
  { path: 'brand/package.json', add: 1, del: 1 },
  { path: 'packages/connectors/package.json', add: 2, del: 2 },
  { path: 'packages/contracts/package.json', add: 1, del: 1 },
  { path: 'packages/provider-adapters/package.json', add: 3, del: 3 },
  { path: 'packages/runtime/package.json', add: 4, del: 4 },
  { path: 'packages/ui/package.json', add: 8, del: 8 },
  { path: 'patches/@agentclientprotocol%2Fclaude-agent-acp@0.99.0.patch', add: 164, del: 195 },
]

/** A nightly check its lead stopped, on its branch: pushed once, two commits since, no pull request yet. */
export const CHANGE_NIGHTLY: Data = {
  prs: [{ repo: 'althar', files: NIGHTLY_FILES }],
  state: ChangeState.Branch,
  branch: 'althar/nightly-dependency-check-27-oct',
  remote: { name: 'origin', pushed: true, ahead: 2 },
}

/* fnt's prompt debugging, across its engine and its frontend on GitLab: engine's schema first, which frontend reads. */

const jobs = (names: readonly string[], state: CheckState, failed: readonly string[] = []): ChangeCheck[] =>
  names.map((name) => ({ id: name, name, state: failed.includes(name) ? CheckState.Failed : state }))

const ENGINE_JOBS = ['lint', 'typecheck', 'unit', 'integration', 'schema:diff', 'build', 'image', 'migrate:dry-run']
const FRONTEND_JOBS = [
  'lint',
  'typecheck',
  'unit',
  'build',
  'storybook',
  'e2e:auth',
  'e2e:chat',
  'e2e:settings',
  'lighthouse',
  'bundle-size',
]

export const ENGINE_FILES = [
  { path: 'schema.graphql', add: 1, del: 0 },
  { path: 'src/graphql/schema.ts', add: 1, del: 0 },
  { path: 'src/graphql/resolvers/prompt-debug.ts', add: 4, del: 0 },
  { path: 'src/graphql/support/operations.ts', add: 6, del: 0 },
  { path: 'tests/prompt-debug-enabled.test.ts', add: 73, del: 0 },
]
export const FRONTEND_FILES = [
  { path: 'app/chat/page.tsx', add: 17, del: 3 },
  { path: 'lib/chat/prompt-debug.ts', add: 14, del: 0 },
  { path: 'lib/graphql/schema.graphql', add: 1, del: 0 },
  { path: 'lib/graphql/hooks/useMessages.ts', add: 22, del: 0 },
  { path: 'lib/graphql/queries/messages.ts', add: 6, del: 0 },
  { path: 'tests/unit/prompt-debug.test.js', add: 29, del: 0 },
]

const engine = (more: Partial<TrackStop> = {}): TrackStop => ({
  name: 'engine',
  number: '!52',
  url: 'https://gitlab.com/fnt/engine/-/merge_requests/52',
  host: GITLAB,
  standing: 'open',
  target: 'main',
  checks: jobs(ENGINE_JOBS, CheckState.Passed),
  files: ENGINE_FILES,
  folder: 'engine',
  ...more,
})
const frontend = (more: Partial<TrackStop> = {}): TrackStop => ({
  name: 'frontend',
  number: '!27',
  url: 'https://gitlab.com/fnt/frontend/-/merge_requests/27',
  host: GITLAB,
  standing: 'open',
  target: 'main',
  checks: jobs(FRONTEND_JOBS, CheckState.Passed),
  files: FRONTEND_FILES,
  folder: 'frontend',
  ...more,
})

/** Both drafts, just opened: their checks running. */
export const TRACK_DRAFTS: TrackStop[] = [
  engine({
    standing: 'draft',
    checks: [...jobs(ENGINE_JOBS.slice(0, 3), CheckState.Passed), ...jobs(ENGINE_JOBS.slice(3), CheckState.Running)],
  }),
  frontend({ standing: 'draft', checks: jobs(FRONTEND_JOBS, CheckState.Queued) }),
]
/** engine marked ready, frontend still a draft. */
export const TRACK_ONE_READY: TrackStop[] = [
  engine(),
  frontend({
    standing: 'draft',
    checks: [...jobs(FRONTEND_JOBS.slice(0, 6), CheckState.Passed), ...jobs(FRONTEND_JOBS.slice(6), CheckState.Running)],
  }),
]
/** frontend's e2e:chat failed; engine's all passed. */
export const TRACK_FAILING: TrackStop[] = [engine(), frontend({ checks: jobs(FRONTEND_JOBS, CheckState.Passed, ['e2e:chat']) })]
/** frontend conflicts with main since another change merged. */
export const TRACK_CONFLICT: TrackStop[] = [engine(), frontend({ conflicts: true })]
/** Ready to accept: every check passed in both. */
export const TRACK_READY: TrackStop[] = [engine(), frontend()]
/** Accepted: engine merging, frontend after it. */
export const TRACK_MERGING: TrackStop[] = [engine({ standing: 'merging' }), frontend({ standing: 'waiting' })]
/** engine merged; frontend open, still to merge. */
export const TRACK_ONE_MERGED: TrackStop[] = [engine({ standing: 'merged' }), frontend()]
/** engine merged; GitLab refused frontend, whose branch main had moved past. */
export const TRACK_REFUSED: TrackStop[] = [
  engine({ standing: 'merged' }),
  frontend({
    standing: 'refused',
    refused: 'main moved on, and frontend merges only by fast-forward. Its branch needs main merged in first.',
  }),
]
/** engine in main's merge queue; frontend waits for it to land. */
export const TRACK_QUEUED: TrackStop[] = [engine({ standing: 'queued' }), frontend()]

/** Meridian's rate limits, across four repositories on GitHub: the shared types first, then the API, the web app and the docs. */
export const TRACK_FOUR: TrackStop[] = [
  {
    name: 'meridian-types',
    number: '#88',
    url: 'https://github.com/stripe-internal/meridian-types/pull/88',
    host: GITHUB,
    standing: 'merged',
    target: 'main',
    checks: jobs(['build', 'test'], CheckState.Passed),
    files: [{ path: 'src/limits.ts', add: 18, del: 2 }],
    folder: 'meridian-types',
  },
  {
    name: 'meridian-api',
    number: '#1187',
    url: 'https://github.com/stripe-internal/meridian-api/pull/1187',
    host: GITHUB,
    standing: 'open',
    target: 'main',
    checks: jobs(['lint', 'unit', 'integration', 'contract'], CheckState.Passed),
    files: [
      { path: 'src/middleware/rate-limit.ts', add: 64, del: 12 },
      { path: 'src/middleware/rate-limit.test.ts', add: 88, del: 0 },
      { path: 'src/config.ts', add: 6, del: 1 },
    ],
    folder: 'meridian-api',
  },
  {
    name: 'meridian-web',
    number: '#412',
    url: 'https://github.com/stripe-internal/meridian-web/pull/412',
    host: GITHUB,
    standing: 'draft',
    target: 'main',
    checks: [...jobs(['lint', 'unit'], CheckState.Passed), ...jobs(['e2e', 'visual'], CheckState.Running)],
    files: [
      { path: 'src/middleware/require-auth.ts', add: 14, del: 3 },
      { path: 'src/components/TooManyRequests.tsx', add: 41, del: 0 },
    ],
    folder: 'meridian-web',
  },
  {
    name: 'meridian-docs',
    number: '#203',
    url: 'https://github.com/stripe-internal/meridian-docs/pull/203',
    host: GITHUB,
    standing: 'draft',
    target: 'main',
    checks: [],
    files: [{ path: 'guides/rate-limits.md', add: 52, del: 4 }],
    folder: 'meridian-docs',
  },
]
