import type {
  AccountSignInState,
  AgentModels,
  AgentStatus,
  ChangeSummary,
  ConnectGuide,
  ConnectionCheck,
  ConnectionList,
  ConnectionSummary,
  CoordinatorSnapshot,
  HomeSnapshot,
  Load,
  Picture,
  ProjectNote,
  ProjectRulesView,
  ProjectRepository,
  ProjectSummary,
  Status,
  TaskSummary,
  ThreadItem,
  ThreadSnapshot,
  Unfurl,
  WatchEvent,
} from '@althar/contracts'
import { vi } from 'vitest'

import { type AppPreferences, DEFAULT_PREFERENCES } from '../src/main/appPreferences'
import type { Client, ProjectRulesChange } from '../src/renderer/data/client'
import type { Host } from '../src/renderer/data/services'

/* What the runtime would say, as plain values, and a client that says it. */

export const NOW = '2026-09-29T12:00:00.000Z'

/** An agent's usual sign-in, its first account. */
export const usual = (id: string, signIn: AgentStatus['signIn']): AgentStatus['accounts'][number] => ({
  id,
  name: 'main',
  home: null,
  signIn,
  paidBy: signIn === 'signed_in' ? 'plan' : 'unknown',
  outUntil: null,
  adoptedFrom: null,
})

/** A project's first rules, as the runtime keeps them. */
export const projectRules: ProjectRulesView = {
  projectId: 'p1',
  revision: 1,
  permissions: 'rules',
  alwaysAsk: ['default-branch', 'force-push', 'many-branches', 'delete-branch', 'deploy', 'outside'],
  never: [],
  alwaysAllow: [],
  commands: [],
  end: null,
  resolveConflicts: false,
  usageLimit: 'move',
  rotateAccounts: false,
  onlyAccounts: null,
  branchPattern: null,
  titlePattern: null,
  moveIssues: true,
  conventions: [{ repository: 'api', branch: null, title: null, template: null }],
}

export const agents: ReadonlyArray<AgentStatus> = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    signIn: 'signed_in',
    login: 'claude auth login',
    version: '2.1.263',
    ways: ['browser'],
    accounts: [usual('acc_claude', 'signed_in')],
    installed: true,
    kept: false,
    download: null,
  },
  {
    id: 'codex',
    name: 'Codex',
    signIn: 'unknown',
    login: 'codex login',
    version: '0.159.3',
    ways: ['browser', 'device'],
    accounts: [usual('acc_codex', 'unknown')],
    installed: true,
    kept: false,
    download: null,
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    signIn: 'signed_out',
    login: 'opencode auth login',
    version: null,
    ways: [],
    accounts: [usual('acc_opencode', 'signed_out')],
    installed: true,
    kept: false,
    download: { size: '45 MB', installing: false },
  },
]

/** OpenCode not on this Mac, which Althar can download. */
export const withoutOpenCode: ReadonlyArray<AgentStatus> = agents.map((agent) =>
  agent.id === 'opencode' ? { ...agent, installed: false, signIn: 'unknown', accounts: [usual('acc_opencode', 'unknown')] } : agent,
)

export const status: Status = { apiVersion: 1, appVersion: '0.0.0', agents }

export const efforts = (...names: ReadonlyArray<string>) => names.map((name) => ({ id: name.toLowerCase().replace(' ', '-'), name }))

/** A model with these effort levels, which starts at medium by itself. */
const offering =
  (levels: ReadonlyArray<{ readonly id: string; readonly name: string }>) =>
  (model: { readonly id: string; readonly name: string; readonly description: string | null }) => ({
    ...model,
    efforts: levels,
    effort: 'medium',
  })

/** What the agents offer: Claude Code's own default first, Codex's models by id, OpenCode still being asked. Claude Code takes images; Codex here doesn't; OpenCode hasn't said. */
export const models: ReadonlyArray<AgentModels> = [
  {
    agentId: 'claude-code',
    models: [
      { id: 'default', name: 'Default (recommended)', description: 'Opus for complex work' },
      { id: 'opus', name: 'Opus', description: null },
      { id: 'sonnet', name: 'Sonnet', description: 'For everyday tasks' },
    ].map(offering(efforts('Low', 'Medium', 'High'))),
    model: 'default',
    effort: 'medium',
    defaults: [],
    blocked: [],
    probing: false,
    images: true,
  },
  {
    agentId: 'codex',
    models: [
      { id: 'gpt-5.2-codex', name: 'gpt-5.2-codex', description: null },
      { id: 'gpt-5.2', name: 'gpt-5.2', description: null },
    ].map(offering(efforts('Low', 'Medium', 'High', 'Extra high'))),
    model: 'gpt-5.2-codex',
    effort: 'medium',
    defaults: [],
    blocked: [],
    probing: false,
    images: false,
  },
  { agentId: 'opencode', models: [], model: null, effort: null, defaults: [], blocked: [], probing: true, images: null },
]

/** A project's repositories as this Mac has them: one plain and one a fork, on GitHub as you, and one on GitLab, not connected. */
export const repositories: ReadonlyArray<ProjectRepository> = [
  {
    id: 'repo_api',
    name: 'meridian-api',
    path: '/Users/me/code/meridian-api',
    folder: null,
    branch: 'main',
    host: {
      product: 'github',
      name: 'GitHub',
      instance: null,
      path: 'meridian/api',
      url: 'https://github.com/meridian/api',
      account: { login: 'you', state: 'ready' },
    },
    role: 'service',
    fork: null,
    tasks: 1,
  },
  {
    id: 'repo_web',
    name: 'meridian-web',
    path: '/Users/me/code/meridian-web',
    folder: null,
    branch: 'main',
    host: {
      product: 'github',
      name: 'GitHub',
      instance: null,
      path: 'you/meridian-web',
      url: 'https://github.com/you/meridian-web',
      account: { login: 'you', state: 'ready' },
    },
    role: 'frontend',
    fork: { fork: 'you/meridian-web', upstream: 'meridian/web', target: 'fork' },
    tasks: 0,
  },
  {
    id: 'repo_infra',
    name: 'meridian-infra',
    path: '/Users/me/code/meridian-infra',
    folder: null,
    branch: 'trunk',
    host: {
      product: 'gitlab',
      name: 'GitLab',
      instance: null,
      path: 'meridian-ops/infra',
      url: 'https://gitlab.com/meridian-ops/infra',
      account: null,
    },
    role: 'infrastructure',
    fork: null,
    tasks: 0,
  },
]

export const project: ProjectSummary = {
  id: 'p1',
  name: 'meridian',
  slug: 'meridian',
  ink: 'teal',
  lastWorkAt: '2026-10-05T09:00:00.000Z',
  repository: '/code/meridian',
  repositories: ['meridian'],
  worktrees: '/Users/me/Althar/meridian',
  tasks: 1,
  running: 1,
  waiting: 0,
  working: 1,
  ready: 0,
  usageLimit: 'move',
  rotateAccounts: false,
  onlyAccounts: null,
}

export const task: TaskSummary = {
  id: 't1',
  projectId: 'p1',
  title: 'Add a retry',
  slug: 'add-a-retry',
  threadId: 'th1',
  state: 'active',
  branch: 'althar/add-a-retry',
  agentId: 'claude-code',
  waiting: 0,
  createdAt: NOW,
}

const GiB = 1024 ** 3
const MiB = 1024 ** 2

/** This Mac a moment ago, 32 GB of it: the task's lead running its suite, meridian's coordinator, and its default branch running. */
export const load: Load = {
  cpu: 0.42,
  memoryUsed: 12.5 * GiB,
  memoryTotal: 32 * GiB,
  pressure: 'normal',
  shares: [
    {
      kind: 'task',
      projectId: 'p1',
      project: 'meridian',
      taskId: 't1',
      threadId: 'th1',
      title: 'Add a retry',
      agent: { id: 'claude-code', name: 'Claude Code' },
      cpu: 0.3,
      memory: 1.5 * GiB,
      processes: 12,
    },
    {
      kind: 'coordinator',
      projectId: 'p1',
      project: 'meridian',
      taskId: null,
      threadId: null,
      title: null,
      agent: { id: 'codex', name: 'Codex' },
      cpu: 0.02,
      memory: 300 * MiB,
      processes: 1,
    },
    {
      kind: 'run',
      projectId: 'p1',
      project: 'meridian',
      taskId: null,
      threadId: null,
      title: null,
      agent: null,
      cpu: 0.01,
      memory: 220 * MiB,
      processes: 3,
    },
  ],
  history: [
    { cpu: 0.2, work: 0.1 },
    { cpu: 0.42, work: 0.33 },
  ],
}

let sequence = 0
const next = () => {
  sequence += 1
  return { id: `i${sequence}`, sequence, createdAt: NOW }
}

/** Thread items of each kind, as the runtime gives them. */
export const items = {
  you: (
    text: string,
    input: Extract<ThreadItem, { kind: 'user_message' }>['input'] = { state: 'delivered', interrupting: false },
    links: ReadonlyArray<Unfurl> = [],
    pictures: ReadonlyArray<Picture> = [],
  ): ThreadItem => ({
    ...next(),
    agentId: null,
    kind: 'user_message',
    content: { text, links, pictures },
    input,
  }),
  says: (text: string, agentId = 'claude-code', id?: string): ThreadItem => ({
    ...next(),
    ...(id === undefined ? {} : { id }),
    agentId,
    kind: 'agent_message',
    content: { text, pictures: [], files: [] },
  }),
  thinks: (text: string, agentId = 'claude-code'): ThreadItem => ({
    ...next(),
    agentId,
    kind: 'agent_thought',
    content: { text, pictures: [], files: [] },
  }),
  /** A message that hands back pictures or files beside its words. */
  hands: (
    text: string,
    handed: Partial<Pick<Extract<ThreadItem, { kind: 'agent_message' | 'agent_thought' }>['content'], 'pictures' | 'files'>>,
    agentId = 'claude-code',
  ): ThreadItem => ({
    ...next(),
    agentId,
    kind: 'agent_message',
    content: { text, pictures: [], files: [], ...handed },
  }),
  tool: (content: Partial<Extract<ThreadItem, { kind: 'tool_call' }>['content']> = {}, agentId = 'claude-code'): ThreadItem => ({
    ...next(),
    agentId,
    kind: 'tool_call',
    content: {
      title: 'Read checkout.ts',
      toolKind: 'read',
      status: 'completed',
      command: null,
      locations: [],
      declined: false,
      pictures: [],
      files: [],
      output: null,
      exit: null,
      ...content,
    },
  }),
  plan: (entries: ReadonlyArray<{ content: string; status: string }>, agentId = 'claude-code'): ThreadItem => ({
    ...next(),
    agentId,
    kind: 'plan',
    content: { entries },
  }),
  notice: (
    content: Partial<Extract<ThreadItem, { kind: 'notice' }>['content']> & { title: string },
    agentId: string | null = 'claude-code',
  ): ThreadItem => ({ ...next(), agentId, kind: 'notice', content: { source: 'agent', severity: 'info', description: null, ...content } }),
  step: (content: Partial<Extract<ThreadItem, { kind: 'step_result' }>['content']> = {}): ThreadItem => ({
    ...next(),
    agentId: null,
    kind: 'step_result',
    content: {
      step: 'implement',
      round: 0,
      summary: 'Added the retry.',
      verdict: null,
      findings: [],
      built: null,
      evidence: [],
      unverified: null,
      agentId: null,
      change: null,
      ...content,
    },
  }),
  arrival: (content: Partial<Extract<ThreadItem, { kind: 'arrival' }>['content']> = {}): ThreadItem => ({
    ...next(),
    agentId: null,
    kind: 'arrival',
    content: {
      source: 'github',
      kind: 'comment',
      from: 'dana',
      where: 'PR #12',
      text: 'Seconds or a date?',
      verdict: null,
      path: null,
      line: null,
      passed: null,
      failed: null,
      failing: [],
      url: null,
      outsider: false,
      ...content,
    },
  }),
  question: (content: Partial<Extract<ThreadItem, { kind: 'question' }>['content']> = {}, agentId = 'claude-code'): ThreadItem => ({
    ...next(),
    agentId,
    kind: 'question',
    content: {
      attentionId: 'q1',
      message: 'Which database?',
      toolCallId: null,
      fields: [
        {
          id: 'database',
          question: 'Which database should the cache use?',
          type: 'choice',
          options: [
            { value: 'postgres', label: 'Postgres', note: 'what production runs' },
            { value: 'sqlite', label: 'SQLite' },
          ],
          multiple: false,
          wordsField: 'database_custom',
          required: false,
        },
      ],
      state: 'open',
      answers: null,
      withdrawn: null,
      ...content,
    },
  }),
  card: (content: TaskCardContent, id?: string): ThreadItem => ({
    ...next(),
    ...(id === undefined ? {} : { id }),
    agentId: null,
    kind: 'task',
    content,
  }),
  /** A run of the project Althar started, up at its address unless told otherwise. */
  draft: (content: Partial<Extract<ThreadItem, { kind: 'issue_draft' }>['content']> = {}): ThreadItem => ({
    ...next(),
    agentId: null,
    kind: 'issue_draft',
    content: {
      draftId: 'idr_1',
      product: 'linear',
      tracker: 'Linear',
      container: 'Meridian',
      title: 'Refunds skip the rate limiter',
      body: 'Charges go through it; **refunds** don’t.',
      labels: ['payments'],
      state: 'pending',
      error: null,
      issue: null,
      ...content,
    },
  }),
  /** A review the lead drafted of ninemate's pull request, from a fork, waiting on the person. */
  review: (content: Partial<Extract<ThreadItem, { kind: 'review_draft' }>['content']> = {}): ThreadItem => ({
    ...next(),
    agentId: null,
    kind: 'review_draft',
    content: {
      draftId: 'rdr_1',
      product: 'github',
      repository: 'meridian/api',
      number: 1212,
      url: 'https://github.com/meridian/api/pull/1212',
      title: 'Honour Retry-After on refund webhooks',
      author: 'ninemate',
      outside: true,
      fork: true,
      drafter: 'Claude Code',
      account: 'ada',
      suggested: 'approve',
      verdict: null,
      summary: 'The fix is **right**, but it needs a test.',
      comments: [
        { id: 'c1', path: 'src/retry.ts', line: 41, body: 'Nothing covers the cap.', severity: 'blocking', kept: true },
        { id: 'c2', path: 'src/retry.ts', line: 57, body: 'Nit: seconds.', severity: 'nit', kept: true },
      ],
      state: 'pending',
      error: null,
      review: null,
      ...content,
    },
  }),
  run: (content: Partial<Extract<ThreadItem, { kind: 'run' }>['content']> = {}): ThreadItem => ({
    ...next(),
    agentId: null,
    kind: 'run',
    content: {
      launchId: 'proc_1',
      taskId: 't1',
      where: 'Fix the login timeout',
      command: 'bun run dev',
      url: 'http://localhost:4173/',
      startedAt: NOW,
      ended: null,
      ...content,
    },
  }),
  /** Althar setting up the task's worktree, installing the dependencies its lockfile names, still running unless told otherwise. */
  setup: (content: Partial<Extract<ThreadItem, { kind: 'setup' }>['content']> = {}): ThreadItem => ({
    ...next(),
    agentId: null,
    kind: 'setup',
    content: {
      repository: 'meridian',
      command: 'bun install --frozen-lockfile',
      kept: false,
      startedAt: NOW,
      ended: null,
      ...content,
    },
  }),
  push: (content: Partial<Extract<ThreadItem, { kind: 'push_request' }>['content']> = {}): ThreadItem => ({
    ...next(),
    agentId: null,
    kind: 'push_request',
    content: {
      url: 'https://github.com/meridian/api/pull/12',
      where: 'PR #12',
      product: 'github',
      head: 'def4567890',
      commits: [
        { sha: 'abc1234', subject: 'Read Retry-After as seconds' },
        { sha: 'def4567', subject: 'Name the retry option' },
      ],
      count: 2,
      moved: false,
      blocked: null,
      state: 'open',
      settledAt: null,
      ...content,
    },
  }),
}

type TaskCardContent = Extract<ThreadItem, { kind: 'task' }>['content']

/** The home with the one project, nothing running and nothing waiting, looked at the day before. */
export const home = (overrides: Partial<HomeSnapshot> = {}): HomeSnapshot => ({
  cursor: 1,
  looked: '2026-10-06T18:00:00.000Z',
  since: '2026-10-06T18:00:00.000Z',
  tasks: [],
  calls: [],
  events: [],
  projects: [project],
  ...overrides,
})

/** A task's card as the coordinator's thread has it: planned by default, starting in 20 seconds. */
export const card = (overrides: Partial<TaskCardContent> = {}): TaskCardContent => ({
  taskId: 't1',
  threadId: 'th1',
  title: 'Add a retry',
  slug: 'add-a-retry',
  phase: 'planned',
  kind: 'change',
  plan: {
    id: 'pln1',
    steps: [
      { key: 'implement', agentId: 'claude-code', model: null, skipped: false },
      { key: 'review', agentId: 'codex', model: null, skipped: false },
    ],
    startsAt: new Date(Date.now() + 20_000).toISOString(),
    reason: 'It knows the code.',
    end: null,
  },
  issue: null,
  change: null,
  step: null,
  summary: null,
  lead: 'claude-code',
  leadModel: null,
  leadEffort: null,
  branch: 'althar/add-a-retry',
  startedAt: null,
  waits: null,
  queued: null,
  ...overrides,
})

/** The coordinator's thread, as GetCoordinator gives it: no one working, starting on Claude Code. */
export const coordinatorSnapshot = (overrides: Partial<CoordinatorSnapshot> = {}): CoordinatorSnapshot => ({
  threadId: 'thc',
  cursor: 5,
  project: { id: 'p1', name: 'meridian' },
  session: null,
  suggested: { agentId: 'claude-code', agentName: 'Claude Code', model: null, effort: null, available: true },
  items: [],
  earlier: false,
  host: null,
  runCommand: null,
  launches: [],
  ...overrides,
})

/** A task's pull request, as last seen: a draft on GitHub, one check failed. */
export const change = (overrides: Partial<ChangeSummary> = {}): ChangeSummary => ({
  product: 'github',
  number: 12,
  title: 'Add a retry',
  url: 'https://github.com/meridian/api/pull/12',
  state: 'open',
  draft: true,
  noun: 'pull request',
  short: 'PR',
  prefix: '#',
  repository: 'meridian/api',
  slug: null,
  additions: 12,
  deletions: 3,
  changedFiles: 2,
  head: 'abc123',
  checks: {
    outcome: 'failed',
    passed: 1,
    failed: 1,
    running: 0,
    total: 2,
    failing: ['test'],
    list: [
      { name: 'test', state: 'failed', summary: '2 failed' },
      { name: 'lint', state: 'passed', summary: null },
    ],
  },
  listening: true,
  localHead: null,
  unpushed: 0,
  diverged: null,
  ...overrides,
})

export const snapshot = (overrides: Partial<ThreadSnapshot> = {}): ThreadSnapshot => ({
  threadId: 'th1',
  cursor: 10,
  project: { id: 'p1', name: 'meridian' },
  host: { product: 'github', name: 'GitHub', webUrl: 'https://github.com', connected: true },
  task: {
    id: 't1',
    title: 'Add a retry',
    description: '',
    request: null,
    slug: 'add-a-retry',
    state: 'active',
    branch: 'althar/add-a-retry',
    worktree: '/w/meridian',
    baseRef: 'main',
    phase: 'running',
    waits: null,
    queued: null,
    steps: [],
    lead: null,
    step: null,
    stepAt: null,
    startedAt: null,
    settledAt: null,
    issue: null,
    changes: [],
    files: [],
    commits: 0,
    here: [],
    merged: [],
    actions: ['stop', 'abandon'],
    planId: null,
    runCommand: null,
    launches: [],
    resolveConflicts: { task: null, project: false },
  },
  session: {
    id: 's1',
    agentId: 'claude-code',
    agentName: 'Claude Code',
    state: 'active',
    model: 'opus',
    account: null,
    effort: 'high',
    models: ['opus', 'sonnet'],
    turnRunning: false,
    context: null,
    background: [],
  },
  attention: [],
  items: [],
  earlier: false,
  reports: [],
  ...overrides,
})

export const githubConnection: ConnectionSummary = {
  id: 'conn1',
  product: 'github',
  name: 'GitHub',
  webUrl: 'https://github.com',
  account: { login: 'you', name: 'You' },
  auth: 'device_flow',
  state: 'ready',
}

/** What can be connected here, and what is: GitHub and Linear take a token; nothing connected yet; meridian's code is on GitHub. */
export const connectionList: ConnectionList = {
  cursor: 2,
  connections: [],
  products: [
    {
      product: 'github',
      service: 'github',
      name: 'GitHub',
      host: true,
      tracker: true,
      hostedUrl: 'https://github.com',
      selfHosted: true,
      browserSignIn: false,
      tokenNeeds: null,
      tokenPrefixes: ['github_pat_', 'ghp_'],
      tokenHelpForKey: null,
      keyChecks: [],
    },
    {
      product: 'linear',
      service: 'linear',
      name: 'Linear',
      host: false,
      tracker: true,
      hostedUrl: 'https://linear.app',
      selfHosted: false,
      browserSignIn: false,
      tokenNeeds: null,
      tokenPrefixes: ['lin_api_'],
      tokenHelpForKey: null,
      keyChecks: [],
    },
  ],
  places: [
    { product: 'github', webUrl: 'https://github.com', project: 'meridian', remote: null, repositories: ['northwind/meridian-api'] },
  ],
}

/** Where a GitHub token is made for meridian, filled in. */
export const GITHUB_TOKEN_PAGE =
  'https://github.com/settings/personal-access-tokens/new?name=Althar+for+meridian&target_name=northwind&expires_in=90&contents=write'

/** What connecting GitHub starts from: meridian's repository on it, and gh signed in to it as you. */
export const githubGuide: ConnectGuide = {
  service: 'github',
  places: [
    { product: 'github', webUrl: 'https://github.com', project: 'meridian', remote: 'origin', repositories: ['northwind/meridian-api'] },
  ],
  clis: [{ product: 'github', webUrl: 'https://github.com', tool: 'gh', account: 'you', scopes: ['repo', 'workflow', 'read:org'] }],
  email: null,
  tokenPages: [{ product: 'github', webUrl: 'https://github.com', url: GITHUB_TOKEN_PAGE }],
}

/** Everything a GitHub connection needs, which it can do; its token runs out on 8 January 2027. */
export const githubCheck: ConnectionCheck = {
  connectionId: 'conn1',
  lines: [
    { need: 'account', state: 'ok', fact: 'you', count: null, reason: null },
    { need: 'reach', state: 'ok', fact: 'northwind', count: null, reason: null },
    { need: 'push', state: 'ok', fact: null, count: null, reason: null },
    { need: 'changes', state: 'ok', fact: null, count: null, reason: null },
    { need: 'checks', state: 'ok', fact: null, count: null, reason: null },
    { need: 'issues', state: 'ok', fact: null, count: null, reason: null },
  ],
  expiresAt: '2027-01-08T00:00:00.000Z',
  renews: false,
  settings: 'https://github.com/settings/personal-access-tokens',
}

/** A client whose every call resolves with the fixtures, and whose watch the test drives with `emit`. */
export const fakeClient = (overrides: Partial<Client> = {}) => {
  const listeners = new Set<(event: WatchEvent) => void>()
  const watching: Array<number | undefined> = []
  const starts = new Set<() => void>()
  const client: Client = {
    status: vi.fn(async () => status),
    listProjects: vi.fn(async () => ({ cursor: 3, projects: [project] })),
    openProject: vi.fn(async () => project),
    readFolder: vi.fn(async () => ({ kind: 'repository' as const, name: 'meridian', repositories: [], project: null })),
    listTasks: vi.fn(async () => ({ cursor: 4, tasks: [task] })),
    searchTasks: vi.fn(async () => ({ tasks: [] })),
    createTask: vi.fn(async () => task),
    getThread: vi.fn(async () => snapshot()),
    getThreadItem: vi.fn(async (_threadId: string, itemId: string) => ({ ...items.says('Read again'), id: itemId })),
    readOutput: vi.fn(async () => ({ text: ' ✓ charges/limit (14)\n ✓ refunds/router (38)\n', dropped: 0 })),
    readDocument: vi.fn(async (_threadId: string, path: string) => ({
      path,
      body: '# Notes\n\nRefunds share the partner budget.\n',
      bytes: 42,
      lines: 3,
    })),
    getBoard: vi.fn(async () => ({ cursor: 1, tasks: [], calls: [], settledTotal: 0 })),
    getOlderSettled: vi.fn(async () => []),
    getHome: vi.fn(async () => home()),
    leftHome: vi.fn(async () => {}),
    seeTask: vi.fn(async () => {}),
    merge: vi.fn(async () => {}),
    push: vi.fn(async () => {}),
    replacePullRequest: vi.fn(async () => {}),
    mergeNote: vi.fn(async () => 'Merge them.'),
    mergeHere: vi.fn(async () => {}),
    pushHere: vi.fn(async () => {}),
    pushBranch: vi.fn(async () => {}),
    listEditors: vi.fn(async () => [
      { id: 'zed', name: 'Zed' },
      { id: 'finder', name: 'Finder' },
    ]),
    getLoad: vi.fn(async () => load),
    openInEditor: vi.fn(async () => true),
    installAgent: vi.fn(async () => {}),
    getFileDiff: vi.fn(async (_taskId: string, path: string) => ({
      file: { path, from: null, status: 'modified' as const, add: 1, del: 1, binary: false, uncommitted: false },
      lines: [
        { kind: 'hunk' as const, text: '@@ -1 +1 @@' },
        { kind: 'removed' as const, old: 1, text: 'const tries = 3', changed: ['3'] },
        { kind: 'added' as const, new: 1, text: 'const tries = 5', changed: ['5'] },
      ],
      truncated: false,
    })),
    startSession: vi.fn(async () => 's1'),
    switchAgent: vi.fn(async () => 's2'),
    setModel: vi.fn(async () => {}),
    setEffort: vi.fn(async () => {}),
    getModels: vi.fn(async () => models),
    setDefaultEffort: vi.fn(async () => {}),
    setModelBlocked: vi.fn(async () => {}),
    getSettings: vi.fn(async () => ({
      coAuthor: { on: true, line: 'Co-authored-by: Althar <337922799+AltharAi@users.noreply.github.com>' },
      agentsAtOnce: { count: 4, own: null, machine: { count: 4, cores: 10, memory: 16 } },
      postTeamReviews: false,
    })),
    setCoAuthor: vi.fn(async () => {}),
    setPostTeamReviews: vi.fn(async () => {}),
    setAgentsAtOnce: vi.fn(async () => {}),
    interrupt: vi.fn(async () => {}),
    stopTask: vi.fn(async () => {}),
    setTaskResolveConflicts: vi.fn(async () => {}),
    resumeTask: vi.fn(async () => {}),
    abandonTask: vi.fn(async () => {}),
    reopenTask: vi.fn(async () => {}),
    renameTask: vi.fn(async () => {}),
    send: vi.fn(async () => {}),
    takeBack: vi.fn(async () => {}),
    answer: vi.fn(async () => {}),
    answerQuestion: vi.fn(async () => {}),
    getCoordinator: vi.fn(async () => coordinatorSnapshot()),
    startTask: vi.fn(async () => task),
    startPlan: vi.fn(async () => {}),
    holdPlan: vi.fn(async () => {}),
    changePlan: vi.fn(async () => {}),
    changeIssueDraft: vi.fn(async () => {}),
    fileIssueDraft: vi.fn(async () => {}),
    discardIssueDraft: vi.fn(async () => {}),
    changeReviewDraft: vi.fn(async () => {}),
    postReviewDraft: vi.fn(async () => {}),
    discardReviewDraft: vi.fn(async () => {}),
    answerStuck: vi.fn(async () => {}),
    listConnections: vi.fn(async () => connectionList),
    startSignIn: vi.fn(async () => ({
      flowId: 'flow1',
      kind: 'device' as const,
      userCode: 'ABCD-1234',
      verificationUri: 'https://github.com/login/device',
      expiresAt: NOW,
    })),
    getSignIn: vi.fn(async () => ({ state: 'waiting' as const })),
    cancelSignIn: vi.fn(async () => {}),
    connectToken: vi.fn(async () => connectionList.connections[0] ?? githubConnection),
    getConnectGuide: vi.fn(async () => githubGuide),
    findServer: vi.fn(async (_service, webUrl: string) => ({ product: null, webUrl, reason: 'unreachable' as const, tokenPage: null })),
    connectCli: vi.fn(async () => githubConnection),
    checkConnection: vi.fn(async () => githubCheck),
    disconnect: vi.fn(async () => {}),
    renameProject: vi.fn(async () => {}),
    setProjectInk: vi.fn(async () => {}),
    removeProject: vi.fn(async () => {}),
    getRepositories: vi.fn(async () => repositories),
    addRepositories: vi.fn(async () => {}),
    leaveOutRepository: vi.fn(async () => {}),
    setRepository: vi.fn(async () => {}),
    getProjectRules: vi.fn(async (projectId: string) => ({ ...projectRules, projectId })),
    getProjectNotes: vi.fn(async (): Promise<ReadonlyArray<ProjectNote>> => []),
    dropProjectNote: vi.fn(async () => {}),
    getVocabulary: vi.fn(async () => ['RefundLedger', 'useEffect']),
    setProjectRules: vi.fn(async ({ projectId, ...change }: ProjectRulesChange) => ({ ...projectRules, ...change, projectId })),
    addAccount: vi.fn(async (input: { readonly agentId: string; readonly name: string; readonly grant?: string }) => ({
      ...usual('acc_added', 'signed_out'),
      name: input.name,
      home: '/Users/me/Library/Application Support/Althar/accounts/acc_added',
    })),
    renameAccount: vi.fn(async () => {}),
    removeAccount: vi.fn(async () => {}),
    orderAccounts: vi.fn(async () => {}),
    findAccounts: vi.fn(async () => [{ grant: 'grant_work', name: 'work', path: '/Users/me/.codex-work', tool: 'codex-profiles' }]),
    signInAccount: vi.fn(async () => ({ line: 'codex login', opened: true })),
    startAccountSignIn: vi.fn(async () => ({ flowId: 'flow_account', state: { state: 'starting' as const } })),
    getAccountSignIn: vi.fn(async (): Promise<AccountSignInState> => ({ state: 'starting' })),
    pasteAccountSignInCode: vi.fn(async () => {}),
    cancelAccountSignIn: vi.fn(async () => {}),
    listIssues: vi.fn(async () => ({ issues: [] })),
    markReady: vi.fn(async () => {}),
    openChange: vi.fn(async () => {}),
    skipReview: vi.fn(async () => {}),
    refreshTask: vi.fn(async () => {}),
    stopListening: vi.fn(async () => {}),
    closePullRequest: vi.fn(async () => ({ branch: null })),
    stopBackground: vi.fn(async () => {}),
    clearBackground: vi.fn(async () => {}),
    runProject: vi.fn(async (_projectId: string, taskId: string | null, _threadId: string | null) => ({
      id: 'proc_run',
      taskId,
      where: taskId === null ? 'main' : 'the task',
      command: 'bun run dev',
      url: null,
      startedAt: NOW,
      ended: null,
    })),
    stopLaunch: vi.fn(async () => {}),
    clearLaunch: vi.fn(async () => {}),
    watch: (listener, since, onWatching) => {
      watching.push(since)
      listeners.add(listener)
      // A watch is listening from the moment it starts, as the runtime's stream does once it is open.
      if (onWatching !== undefined) {
        starts.add(onWatching)
        onWatching()
      }
      return () => {
        listeners.delete(listener)
        if (onWatching !== undefined) starts.delete(onWatching)
      }
    },
    close: vi.fn(async () => {}),
    ...overrides,
  }
  return {
    client,
    emit: (event: WatchEvent) => listeners.forEach((listener) => listener(event)),
    /** The watch broke and started again, as after the runtime restarted: it listens again from now. */
    rewatch: () => starts.forEach((start) => start()),
    listeners,
    watching,
  }
}

/** The app's preferences as a main process would keep them: where each starts, then each change. */
const keptPreferences = (): Pick<Host, 'preferences' | 'setPreference'> => {
  let kept: AppPreferences = DEFAULT_PREFERENCES
  return {
    preferences: vi.fn(async () => kept),
    setPreference: vi.fn(async (key, value) => {
      kept = { ...kept, [key]: value }
      return kept
    }),
  }
}

export const fakeHost = (overrides: Partial<Host> = {}): Host => ({
  ...keptPreferences(),
  platform: 'darwin',
  window: vi.fn(),
  maximized: vi.fn(async () => false),
  onMaximized: vi.fn(() => () => {}),
  sounds: vi.fn(async () => ['Basso', 'Glass', 'Ping', 'Purr']),
  editorPicture: vi.fn(async (id: string) => `data:image/png;base64,${id}`),
  playSound: vi.fn(async () => {}),
  pickFolder: vi.fn(async () => 'grant_picked'),
  pickFolders: vi.fn(async (): Promise<ReadonlyArray<string>> => ['grant_picked']),
  grantDropped: vi.fn(async () => 'grant_dropped'),
  findRepositories: vi.fn(async () => ({ lookedIn: [], repositories: [] })),
  grantFound: vi.fn(async (id: string) => `grant_${id}`),
  onOpen: vi.fn(() => () => {}),
  onStoreFailed: vi.fn(() => () => {}),
  showBackup: vi.fn(async () => {}),
  appIcon: vi.fn(async () => 'cobalt'),
  setAppIcon: vi.fn(async () => {}),
  edge: vi.fn(async () => ({ place: 'island', notch: true, platform: 'darwin', tray: true })),
  setEdge: vi.fn(async () => {}),
  edgeDrawn: vi.fn(),
  onEdgePointed: vi.fn(() => () => {}),
  edgeSize: vi.fn(),
  openInWindow: vi.fn(),
  clipboardToken: vi.fn(async () => null),
  ...overrides,
})

/** A change the runtime's feed reports. */
export const changed = (
  aggregateType: string,
  aggregateId: string,
  threadId: string | null = 'th1',
  projectId: string | null = 'p1',
): WatchEvent => ({
  _tag: 'Changed',
  cursor: 20,
  aggregateType,
  aggregateId,
  projectId,
  threadId,
})

/** Text an agent is still writing, as the runtime streams it. */
export const streamed = (
  itemId: string,
  text: string,
  threadId = 'th1',
  kind: 'agent_message' | 'agent_thought' = 'agent_message',
  agentId = 'claude-code',
): WatchEvent => ({
  _tag: 'Streaming',
  threadId,
  itemId,
  kind,
  agentId,
  text,
})
