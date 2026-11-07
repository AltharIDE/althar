// Scrappy: the tasks the page shows, each state a list of repositories in the order they merge, as a runtime that knew each one's own state would hand them on.
import type { ChangedFile } from '../../src/primitives/FileChanges/FileChanges'

export type HostKey = 'gitlab' | 'github'

export interface Host {
  readonly product: HostKey
  readonly name: string
  readonly noun: string
  readonly short: string
  readonly prefix: string
  readonly web: string
}

export const HOSTS: Record<HostKey, Host> = {
  gitlab: { product: 'gitlab', name: 'GitLab', noun: 'merge request', short: 'MR', prefix: '!', web: 'https://gitlab.fnt.dev' },
  github: { product: 'github', name: 'GitHub', noun: 'pull request', short: 'PR', prefix: '#', web: 'https://github.com' },
}

/**
 * Where one repository's part of the change stands. `branch`: no pull request, its host not connected. `waiting`: next in the
 * order while one before it merges. `refused`: its host wouldn't merge it, and those after it waited.
 */
export type RepoState = 'draft' | 'open' | 'waiting' | 'merging' | 'merged' | 'refused' | 'branch'

export type CheckWord = 'passed' | 'running' | 'queued' | 'failed'

export interface Check {
  readonly name: string
  readonly state: CheckWord
  readonly summary?: string
}

export interface Repo {
  /** Its folder here, which its files' paths start with in the task's worktree. */
  readonly slug: string
  /** owner/name on its host. */
  readonly path: string
  readonly host: HostKey
  /** Whether Althar is connected to its host. */
  readonly connected: boolean
  /** None while its work is on its branch. */
  readonly number: number | null
  readonly state: RepoState
  readonly checks: readonly Check[]
  /** Files it conflicts with its target in, as its host says. */
  readonly conflict?: readonly string[]
  /** Why its host refused to merge it. */
  readonly refused?: string
  /** Its files, by their paths in it. */
  readonly files: readonly ChangedFile[]
}

export type ReviewWord = 'passed' | 'failed' | 'running'

export interface Scenario {
  readonly key: string
  readonly label: string
  readonly project: 'fnt' | 'meridian'
  readonly title: string
  readonly branch: string
  /** In the order they merge: what the others build on first. */
  readonly repos: readonly Repo[]
  readonly review: ReviewWord | null
}

/* ——— The checks each repository's pipeline runs, by name. ——— */

const ENGINE_JOBS = ['lint', 'typecheck', 'test:unit', 'test:graphql', 'build', 'docker:build', 'sast', 'review-app']
const FRONTEND_JOBS = [
  'install',
  'lint',
  'typecheck',
  'test:unit',
  'e2e:chat',
  'e2e:settings',
  'build',
  'lighthouse',
  'docker:build',
  'review-app',
]
const PROTO_JOBS = ['buf lint', 'buf breaking']
const API_JOBS = ['build', 'test', 'golangci-lint', 'CodeQL']
const WEB_JOBS = ['typecheck', 'test', 'e2e', 'Vercel']
const IOS_JOBS = ['build', 'test (iOS 18)', 'SwiftLint']

const SUMMARIES: Record<string, string> = {
  'test:unit': '214 passed',
  'test:graphql': '61 passed',
  'e2e:chat': '2 of 14 specs failed',
  'e2e:settings': '9 passed',
  lighthouse: '98',
  test: '312 passed',
  'test (iOS 18)': '88 passed',
}

/** Its jobs: the first `passed` passed, those named failed, the rest running. */
const jobs = (names: readonly string[], passed: number, failed: readonly string[] = []): Check[] =>
  names.map((name, at) => {
    const state: CheckWord = failed.includes(name) ? 'failed' : at < passed + failed.length ? 'passed' : 'running'
    const summary = state === 'passed' || state === 'failed' ? SUMMARIES[name] : undefined
    return { name, state, ...(summary === undefined ? {} : { summary }) }
  })
const all = (names: readonly string[]) => jobs(names, names.length)

/* ——— fnt: its engine and its frontend, on the team's own GitLab. ——— */

const ENGINE_FILES: ChangedFile[] = [
  { path: 'schema.graphql', add: 1, del: 0 },
  { path: 'src/graphql/schema.ts', add: 1, del: 0 },
  { path: 'src/graphql/resolvers/prompt-debug.ts', add: 4, del: 0 },
  { path: 'src/graphql/resolvers/prompt-debug-enabled.test.ts', add: 73, del: 0 },
  { path: 'src/graphql/support/operations.ts', add: 6, del: 0 },
]
const FRONTEND_FILES: ChangedFile[] = [
  { path: 'app/chat/page.tsx', add: 17, del: 3 },
  { path: 'lib/chat/prompt-debug.ts', add: 14, del: 0 },
  { path: 'lib/graphql/schema.graphql', add: 1, del: 0 },
  { path: 'lib/graphql/hooks/useMessages.ts', add: 22, del: 0 },
  { path: 'lib/graphql/queries/messages.ts', add: 6, del: 0 },
  { path: 'tests/unit/prompt-debug.test.js', add: 29, del: 0 },
]
const SDK_FILES: ChangedFile[] = [
  { path: 'src/types/message.ts', add: 9, del: 0 },
  { path: 'CHANGELOG.md', add: 4, del: 0 },
]

const engine = (state: RepoState, checks: Check[], more: Partial<Repo> = {}): Repo => ({
  slug: 'engine',
  path: 'fnt/engine',
  host: 'gitlab',
  connected: true,
  number: 52,
  state,
  checks,
  files: ENGINE_FILES,
  ...more,
})
const frontend = (state: RepoState, checks: Check[], more: Partial<Repo> = {}): Repo => ({
  slug: 'frontend',
  path: 'fnt/frontend',
  host: 'gitlab',
  connected: true,
  number: 27,
  state,
  checks,
  files: FRONTEND_FILES,
  ...more,
})
const sdk: Repo = {
  slug: 'sdk',
  path: 'fnt-labs/sdk',
  host: 'github',
  connected: false,
  number: null,
  state: 'branch',
  checks: [],
  files: SDK_FILES,
}

/* ——— meridian: invoices, from the schema to the iPhone app, on GitHub. ——— */

const meridian = (
  slug: string,
  number: number,
  state: RepoState,
  checks: Check[],
  files: ChangedFile[],
  more: Partial<Repo> = {},
): Repo => ({ slug, path: `meridian/${slug}`, host: 'github', connected: true, number, state, checks, files, ...more })

const PROTO_FILES: ChangedFile[] = [{ path: 'invoices/v1/export.proto', add: 48, del: 0 }]
const API_FILES: ChangedFile[] = [
  { path: 'internal/invoices/export.go', add: 162, del: 0 },
  { path: 'internal/invoices/export_test.go', add: 97, del: 0 },
  { path: 'internal/http/routes.go', add: 6, del: 1 },
]
const WEB_FILES: ChangedFile[] = [
  { path: 'src/billing/ExportButton.tsx', add: 54, del: 0 },
  { path: 'src/billing/InvoicesPage.tsx', add: 8, del: 2 },
  { path: 'src/api/invoices.ts', add: 21, del: 0 },
]
const IOS_FILES: ChangedFile[] = [
  { path: 'Meridian/Billing/InvoiceExportSheet.swift', add: 88, del: 0 },
  { path: 'Meridian/Billing/InvoicesView.swift', add: 12, del: 3 },
  { path: 'MeridianTests/InvoiceExportTests.swift', add: 41, del: 0 },
]

const FNT = { project: 'fnt' as const, title: 'Show the prompt behind each chat reply', branch: 'althar/prompt-debug' }

export const SCENARIOS: readonly Scenario[] = [
  { ...FNT, key: 'one', label: 'One repository', repos: [engine('draft', jobs(ENGINE_JOBS, 5))], review: 'passed' },
  {
    ...FNT,
    key: 'drafts',
    label: 'Both drafts',
    repos: [engine('draft', jobs(ENGINE_JOBS, 5)), frontend('draft', jobs(FRONTEND_JOBS, 2))],
    review: 'passed',
  },
  {
    ...FNT,
    key: 'one-ready',
    label: 'One ready, one draft',
    repos: [engine('open', all(ENGINE_JOBS)), frontend('draft', jobs(FRONTEND_JOBS, 6))],
    review: 'passed',
  },
  {
    ...FNT,
    key: 'failing',
    label: 'Checks fail in one',
    repos: [engine('open', all(ENGINE_JOBS)), frontend('open', jobs(FRONTEND_JOBS, 9, ['e2e:chat']))],
    review: 'passed',
  },
  {
    ...FNT,
    key: 'conflict',
    label: 'A conflict in one',
    repos: [
      engine('open', all(ENGINE_JOBS)),
      frontend('open', all(FRONTEND_JOBS), { conflict: ['app/chat/page.tsx', 'lib/graphql/schema.graphql'] }),
    ],
    review: 'passed',
  },
  {
    ...FNT,
    key: 'ready',
    label: 'Ready to merge',
    repos: [engine('open', all(ENGINE_JOBS)), frontend('open', all(FRONTEND_JOBS))],
    review: 'passed',
  },
  {
    ...FNT,
    key: 'merging',
    label: 'Merging, in order',
    repos: [engine('merging', all(ENGINE_JOBS)), frontend('waiting', all(FRONTEND_JOBS))],
    review: 'passed',
  },
  {
    ...FNT,
    key: 'merged-one',
    label: 'One merged, one open',
    repos: [engine('merged', all(ENGINE_JOBS)), frontend('open', all(FRONTEND_JOBS))],
    review: 'passed',
  },
  {
    ...FNT,
    key: 'refused',
    label: 'A merge refused',
    repos: [
      engine('merged', all(ENGINE_JOBS)),
      frontend('refused', all(FRONTEND_JOBS), { refused: 'main moved on, and it merges only by fast-forward' }),
    ],
    review: 'passed',
  },
  {
    project: 'meridian',
    key: 'four',
    label: 'Four repositories',
    title: 'Let customers export invoices as CSV',
    branch: 'althar/invoice-export',
    repos: [
      meridian('proto', 88, 'open', all(PROTO_JOBS), PROTO_FILES),
      meridian('api', 1187, 'open', all(API_JOBS), API_FILES),
      meridian('web', 642, 'open', jobs(WEB_JOBS, 2), WEB_FILES),
      meridian('ios', 318, 'draft', jobs(IOS_JOBS, 1), IOS_FILES),
    ],
    review: 'passed',
  },
  {
    ...FNT,
    key: 'unconnected',
    label: 'A host not connected',
    repos: [engine('open', all(ENGINE_JOBS)), frontend('open', all(FRONTEND_JOBS)), sdk],
    review: 'passed',
  },
]

export const scenarioOf = (key: string | null | undefined): Scenario | undefined => SCENARIOS.find((one) => one.key === key)

export const hostOf = (repo: Repo): Host => HOSTS[repo.host]

/** Its pull request's page on its host. */
export const urlOf = (repo: Repo) =>
  repo.host === 'gitlab'
    ? `${HOSTS.gitlab.web}/${repo.path}/-/merge_requests/${repo.number ?? 0}`
    : `${HOSTS.github.web}/${repo.path}/pull/${repo.number ?? 0}`

/** Its host's own page for a new pull request from the task's branch. */
export const newPullRequestOf = (repo: Repo, branch: string) =>
  repo.host === 'gitlab'
    ? `${HOSTS.gitlab.web}/${repo.path}/-/merge_requests/new?merge_request[source_branch]=${branch}`
    : `${HOSTS.github.web}/${repo.path}/compare/main...${branch}?expand=1`
