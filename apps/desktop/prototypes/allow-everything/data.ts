// Scrappy: what the fake runtime holds. meridian, its rules, and one task whose lead has asked seven things in a row.
import type {
  AttentionRequest,
  BoardCall,
  BoardSnapshot,
  BoardTask,
  ProjectRulesView,
  ProjectSummary,
  RuleKind,
  ThreadItem,
  ThreadSnapshot,
} from '@althar/contracts'

import { card, change, items, project, projectRules, snapshot } from '../../tests/fixtures'

const MINUTE = 60_000
/** A moment some minutes ago, as the runtime stamps it. */
export const ago = (minutes: number) => new Date(Date.now() - minutes * MINUTE).toISOString()

export const meridian: ProjectSummary = { ...project, tasks: 5, running: 2, waiting: 1, working: 2, ready: 1 }

/** meridian's rules: what always asks is the usual, Never names one kind and one command, two commands go ahead, and the rest is allowed. */
export const firstRules: ProjectRulesView = {
  ...projectRules,
  projectId: 'p1',
  revision: 4,
  permissions: 'rules',
  alwaysAsk: ['default-branch', 'force-push', 'deploy', 'outside'],
  never: ['delete-branch'],
  alwaysAllow: [],
  commands: [
    { pattern: 'terraform destroy', decision: 'never' },
    { pattern: 'bun test', decision: 'allow' },
    { pattern: 'bun run lint', decision: 'allow' },
  ],
  end: 'draft',
  conventions: [{ repository: 'meridian', branch: null, title: null, template: '.github/pull_request_template.md' }],
}

export const TASK = {
  title: 'Fix the login timeout',
  slug: 'fix-the-login-timeout',
  branch: 'althar/fix-the-login-timeout',
  request: 'People get logged out after 15 minutes even with “Remember me” ticked. Find out why and fix it, and check it on staging.',
}

/** A request the lead makes that waits: what Althar's rules say of it, as the runtime would. */
export interface Prompt {
  readonly id: string
  readonly title: string
  readonly command: string
  readonly reason: string
  /** The kind it is, where Althar can tell: on meridian's Always ask me list. */
  readonly kind: RuleKind | null
  /** Althar can't read it: under allow everything, it is refused while Never names anything. */
  readonly unclear: boolean
  readonly prefix: string | null
  readonly minutes: number
}

const CANT_TELL = 'Althar can’t tell what this command does until it runs, so it asks.'
const outside = (path: string) => `Writing outside the task’s worktree always asks: ${path}`

/** The burst: seven in a row, the deploy in front. Four of a kind meridian always asks about; three Althar can't read. */
export const PROMPTS: ReadonlyArray<Prompt> = [
  {
    id: 'p1',
    title: 'Deploy the fix to staging',
    command: 'fly deploy --app meridian-staging --strategy immediate',
    reason: 'Deploying or publishing always asks.',
    kind: 'deploy',
    unclear: false,
    prefix: 'fly deploy',
    minutes: 4,
  },
  {
    id: 'p2',
    title: 'Run the session timeout end-to-end tests',
    command: 'eval "$(fnm env)" && bun run test:e2e -- --grep "session timeout"',
    reason: CANT_TELL,
    kind: null,
    unclear: true,
    prefix: null,
    minutes: 4,
  },
  {
    id: 'p3',
    title: 'Copy the test environment where the staging run reads it',
    command: 'cp .env.example ~/.meridian/env.test',
    reason: outside('~/.meridian/env.test'),
    kind: 'outside',
    unclear: false,
    prefix: null,
    minutes: 3,
  },
  {
    id: 'p4',
    title: 'Run the auth tests with the configured session length',
    command: 'SESSION_TTL=$(node -p "require(\'./config/auth\').ttl") bun test src/auth',
    reason: CANT_TELL,
    kind: null,
    unclear: true,
    prefix: null,
    minutes: 3,
  },
  {
    id: 'p5',
    title: 'Point the staging run at the session fixture',
    command: 'ln -sf "$PWD/fixtures/session.json" ~/.meridian/session.json',
    reason: outside('~/.meridian/session.json'),
    kind: 'outside',
    unclear: false,
    prefix: null,
    minutes: 2,
  },
  {
    id: 'p6',
    title: 'Run the staging suite from the repository’s root',
    command: 'bunx playwright test --config "$(git rev-parse --show-toplevel)/e2e/staging.config.ts"',
    reason: CANT_TELL,
    kind: null,
    unclear: true,
    prefix: null,
    minutes: 2,
  },
  {
    id: 'p7',
    title: 'Keep the staging session for the report',
    command: 'curl -s https://meridian-staging.fly.dev/api/session -o ~/.meridian/last-session.json',
    reason: outside('~/.meridian/last-session.json'),
    kind: 'outside',
    unclear: false,
    prefix: null,
    minutes: 1,
  },
]

export const promptOf = (id: string) => PROMPTS.find((prompt) => prompt.id === id)

/** A prompt as the runtime sends it, with the "always" answers its rules would keep: none to allow for a kind that always asks. */
export const attentionOf = (prompt: Prompt, rules: ProjectRulesView): AttentionRequest => {
  const asks = prompt.kind !== null && rules.alwaysAsk.includes(prompt.kind)
  const scopes = [...(prompt.prefix === null ? [] : (['prefix'] as const)), ...(prompt.kind === null ? [] : (['kind'] as const))]
  return {
    id: prompt.id,
    kind: 'permission',
    title: prompt.title,
    reason: prompt.reason,
    command: prompt.command,
    stuck: null,
    always: {
      command: prompt.command,
      prefix: prompt.prefix,
      kind: prompt.kind,
      allow: asks ? [] : ['exact', ...scopes],
      deny: ['exact', ...scopes],
    },
    createdAt: ago(prompt.minutes),
  }
}

const tool = (minutes: number, content: Parameters<typeof items.tool>[0]): ThreadItem => ({
  ...items.tool(content),
  createdAt: ago(minutes),
})
const says = (minutes: number, text: string): ThreadItem => ({ ...items.says(text), createdAt: ago(minutes) })

/** The lead's work so far: it found the cause, fixed it, ran the unit tests (allowed by a rule), and turned to staging. */
const threadItems = (): ThreadItem[] => [
  says(24, 'Reading how sessions are made and refreshed.'),
  tool(24, {
    title: 'Read src/auth/session.ts',
    toolKind: 'read',
    locations: [{ path: '/Users/me/Althar/meridian/fix-the-login-timeout/src/auth/session.ts' }],
  }),
  tool(23, {
    title: 'Read config/auth.ts',
    toolKind: 'read',
    locations: [{ path: '/Users/me/Althar/meridian/fix-the-login-timeout/config/auth.ts' }],
  }),
  says(
    21,
    'Found it. `config/auth.ts` gives the session length in **minutes** (`ttl: 43200` for 30 days), but `refresh()` reads `SESSION_TTL` as seconds and caps it at 900. So “Remember me” never outlives 15 minutes. I’ll make the unit explicit and drop the cap.',
  ),
  tool(19, {
    title: 'Edit config/auth.ts',
    toolKind: 'edit',
    locations: [{ path: '/Users/me/Althar/meridian/fix-the-login-timeout/config/auth.ts' }],
  }),
  tool(18, {
    title: 'Edit src/auth/session.ts',
    toolKind: 'edit',
    locations: [{ path: '/Users/me/Althar/meridian/fix-the-login-timeout/src/auth/session.ts' }],
  }),
  tool(16, {
    title: 'bun test src/auth',
    toolKind: 'execute',
    command: 'bun test src/auth',
    output: { kept: true, lines: 4, bytes: 64, dropped: 0, error: null },
    exit: 0,
    allowedBy: { pattern: 'bun test', match: 'prefix' },
  }),
  says(
    5,
    'Unit tests pass. Now I’ll check it where it broke: deploy the branch to staging, run the session timeout end-to-end tests against it, and keep the session it hands back for the report.',
  ),
]

/** Made once, so each read has the same items by the same ids, as the runtime's would. */
const ITEMS = threadItems()

export const threadOf = (rules: ProjectRulesView, waiting: ReadonlyArray<string>, settled: boolean): ThreadSnapshot => {
  const base = snapshot()
  return {
    ...base,
    threadId: 'th1',
    project: { id: 'p1', name: 'meridian' },
    task: {
      ...base.task,
      id: 't1',
      title: TASK.title,
      slug: TASK.slug,
      request: TASK.request,
      branch: TASK.branch,
      worktree: '/Users/me/Althar/meridian/fix-the-login-timeout',
      phase: 'running',
      step: 'implement',
      stepAt: ago(26),
      startedAt: ago(26),
      steps: [
        { key: 'implement', agentId: 'claude-code', model: 'opus', skipped: false },
        { key: 'review', agentId: 'codex', model: null, skipped: false },
      ],
      lead: { agentId: 'claude-code', model: 'opus', account: null },
      files: [
        { path: 'config/auth.ts', from: null, status: 'modified', add: 6, del: 2, binary: false, uncommitted: false },
        { path: 'src/auth/session.ts', from: null, status: 'modified', add: 14, del: 7, binary: false, uncommitted: false },
        { path: 'src/auth/session.test.ts', from: null, status: 'modified', add: 18, del: 0, binary: false, uncommitted: true },
      ],
      commits: 2,
      actions: ['stop', 'abandon'],
      resolveConflicts: { task: null, project: false },
    },
    session: { ...base.session!, model: 'opus', effort: 'high', turnRunning: !settled },
    attention: PROMPTS.filter((prompt) => waiting.includes(prompt.id)).map((prompt) => attentionOf(prompt, rules)),
    items: ITEMS,
  }
}

/* ——— The board: the task, and meridian's other work around it ——— */

const boardTask = (overrides: Partial<BoardTask>): BoardTask => ({
  ...card({ plan: null, issue: null }),
  state: 'active',
  createdAt: ago(60),
  settledAt: null,
  changed: null,
  here: [],
  ...overrides,
})

const twoSteps = (id: string) => ({
  id,
  steps: [
    { key: 'implement' as const, agentId: 'claude-code', model: null, skipped: false },
    { key: 'review' as const, agentId: 'codex', model: null, skipped: false },
  ],
  startsAt: null,
  reason: null,
  end: null,
})

export const boardOf = (rules: ProjectRulesView, waiting: ReadonlyArray<string>): BoardSnapshot => {
  const first = PROMPTS.find((prompt) => waiting.includes(prompt.id))
  const call: BoardCall | null =
    first === undefined ? null : { ...attentionOf(first, rules), taskId: 't1', threadId: 'th1', taskTitle: TASK.title, taskSlug: TASK.slug }
  return {
    cursor: 1,
    settledTotal: 14,
    calls: call === null ? [] : [call],
    tasks: [
      boardTask({
        taskId: 't1',
        threadId: 'th1',
        title: TASK.title,
        slug: TASK.slug,
        phase: call === null ? 'running' : 'waiting',
        kind: 'change',
        plan: twoSteps('pl1'),
        step: 'implement',
        branch: TASK.branch,
        startedAt: ago(26),
        createdAt: ago(27),
        changed: { files: 3, add: 38, del: 9 },
      }),
      boardTask({
        taskId: 't2',
        threadId: 'th2',
        title: 'Refunds skip the rate limiter',
        slug: 'refunds-skip-the-rate-limiter',
        phase: 'running',
        kind: 'change',
        plan: twoSteps('pl2'),
        step: 'review',
        branch: 'althar/refunds-skip-the-rate-limiter',
        startedAt: ago(41),
        changed: { files: 5, add: 112, del: 31 },
      }),
      boardTask({
        taskId: 't3',
        threadId: 'th3',
        title: 'Retry webhook deliveries with backoff',
        slug: 'retry-webhook-deliveries',
        phase: 'ready',
        kind: 'change',
        plan: twoSteps('pl3'),
        branch: 'althar/retry-webhook-deliveries',
        startedAt: ago(130),
        change: change({
          number: 128,
          title: 'Retry webhook deliveries with backoff',
          url: 'https://github.com/meridian/api/pull/128',
          checks: { outcome: 'passed', passed: 4, failed: 0, running: 0, total: 4, failing: [], list: [] },
        }),
      }),
      boardTask({
        taskId: 't4',
        threadId: 'th4',
        title: 'Show the renewal date on invoices',
        slug: 'show-the-renewal-date-on-invoices',
        phase: 'planned',
        kind: 'change',
        plan: { ...twoSteps('pl4'), startsAt: new Date(Date.now() + 40_000).toISOString() },
      }),
      boardTask({
        taskId: 't5',
        threadId: 'th5',
        title: 'Upgrade to Bun 1.3.5',
        slug: 'upgrade-to-bun-1-3-5',
        phase: 'settled',
        kind: 'change',
        state: 'done',
        settledAt: ago(300),
        change: change({ number: 121, state: 'merged', draft: false }),
      }),
    ],
  }
}
