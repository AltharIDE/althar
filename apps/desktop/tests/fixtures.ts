import type {
  AgentModels,
  AgentStatus,
  ChangeSummary,
  ConnectionList,
  ConnectionSummary,
  CoordinatorSnapshot,
  ProjectSummary,
  Status,
  TaskSummary,
  ThreadItem,
  ThreadSnapshot,
  Unfurl,
  WatchEvent,
} from '@charrette/contracts'
import { vi } from 'vitest'

import type { Client } from '../src/renderer/data/client'
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

export const agents: ReadonlyArray<AgentStatus> = [
  { id: 'claude-code', name: 'Claude Code', signIn: 'signed_in', login: 'claude auth login', accounts: [usual('acc_claude', 'signed_in')] },
  { id: 'codex', name: 'Codex', signIn: 'unknown', login: 'codex login', accounts: [usual('acc_codex', 'unknown')] },
  { id: 'opencode', name: 'OpenCode', signIn: 'signed_out', login: 'opencode auth login', accounts: [usual('acc_opencode', 'signed_out')] },
]

export const status: Status = { apiVersion: 1, appVersion: '0.0.0', agents }

const efforts = (...names: ReadonlyArray<string>) => names.map((name) => ({ id: name.toLowerCase().replace(' ', '-'), name }))

/** What the agents offer: Claude Code's own default first, Codex's models by id, OpenCode still being asked. */
export const models: ReadonlyArray<AgentModels> = [
  {
    agentId: 'claude-code',
    models: [
      { id: 'default', name: 'Default (recommended)', description: 'Opus for complex work' },
      { id: 'opus', name: 'Opus', description: null },
      { id: 'sonnet', name: 'Sonnet', description: 'For everyday tasks' },
    ],
    efforts: efforts('Low', 'Medium', 'High'),
    model: 'default',
    effort: 'medium',
    defaults: [],
    probing: false,
  },
  {
    agentId: 'codex',
    models: [
      { id: 'gpt-5.2-codex', name: 'gpt-5.2-codex', description: null },
      { id: 'gpt-5.2', name: 'gpt-5.2', description: null },
    ],
    efforts: efforts('Low', 'Medium', 'High', 'Extra high'),
    model: 'gpt-5.2-codex',
    effort: 'medium',
    defaults: [],
    probing: false,
  },
  { agentId: 'opencode', models: [], efforts: [], model: null, effort: null, defaults: [], probing: true },
]

export const project: ProjectSummary = {
  id: 'p1',
  name: 'meridian',
  slug: 'meridian',
  repository: '/code/meridian',
  tasks: 1,
  running: 1,
  waiting: 0,
  usageLimit: 'move',
}

export const task: TaskSummary = {
  id: 't1',
  projectId: 'p1',
  title: 'Add a retry',
  slug: 'add-a-retry',
  threadId: 'th1',
  state: 'active',
  branch: 'charrette/add-a-retry',
  agentId: 'claude-code',
  waiting: 0,
  createdAt: NOW,
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
  ): ThreadItem => ({
    ...next(),
    agentId: null,
    kind: 'user_message',
    content: { text, links },
    input,
  }),
  says: (text: string, agentId = 'claude-code', id?: string): ThreadItem => ({
    ...next(),
    ...(id === undefined ? {} : { id }),
    agentId,
    kind: 'agent_message',
    content: { text },
  }),
  thinks: (text: string, agentId = 'claude-code'): ThreadItem => ({ ...next(), agentId, kind: 'agent_thought', content: { text } }),
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
  card: (content: TaskCardContent, id?: string): ThreadItem => ({
    ...next(),
    ...(id === undefined ? {} : { id }),
    agentId: null,
    kind: 'task',
    content,
  }),
}

type TaskCardContent = Extract<ThreadItem, { kind: 'task' }>['content']

/** A task's card as the coordinator's thread has it: planned by default, starting in 20 seconds. */
export const card = (overrides: Partial<TaskCardContent> = {}): TaskCardContent => ({
  taskId: 't1',
  threadId: 'th1',
  title: 'Add a retry',
  slug: 'add-a-retry',
  phase: 'planned',
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
  branch: 'charrette/add-a-retry',
  startedAt: null,
  waits: null,
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
  ...overrides,
})

export const snapshot = (overrides: Partial<ThreadSnapshot> = {}): ThreadSnapshot => ({
  threadId: 'th1',
  cursor: 10,
  project: { id: 'p1', name: 'meridian' },
  task: {
    id: 't1',
    title: 'Add a retry',
    description: '',
    slug: 'add-a-retry',
    state: 'active',
    branch: 'charrette/add-a-retry',
    worktree: '/w/meridian',
    baseRef: 'main',
    phase: 'running',
    waits: null,
    issue: null,
    changes: [],
    files: [],
    commits: 0,
  },
  session: {
    id: 's1',
    agentId: 'claude-code',
    agentName: 'Claude Code',
    state: 'active',
    model: 'opus',
    effort: 'high',
    models: ['opus', 'sonnet'],
    turnRunning: false,
  },
  attention: [],
  items: [],
  earlier: false,
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

/** What can be connected here, and what is: GitHub signs in in the browser, Linear takes a token; nothing connected yet. */
export const connectionList: ConnectionList = {
  cursor: 2,
  connections: [],
  products: [
    {
      product: 'github',
      name: 'GitHub',
      host: true,
      tracker: true,
      hostedUrl: 'https://github.com',
      selfHosted: true,
      browserSignIn: true,
      tokenNeedsUser: false,
      tokenHelp: 'https://github.com/settings/personal-access-tokens/new',
    },
    {
      product: 'linear',
      name: 'Linear',
      host: false,
      tracker: true,
      hostedUrl: 'https://linear.app',
      selfHosted: false,
      browserSignIn: false,
      tokenNeedsUser: false,
      tokenHelp: 'https://linear.app/settings/account/security',
    },
  ],
}

/** A client whose every call resolves with the fixtures, and whose watch the test drives with `emit`. */
export const fakeClient = (overrides: Partial<Client> = {}) => {
  const listeners = new Set<(event: WatchEvent) => void>()
  const watching: Array<number | undefined> = []
  const client: Client = {
    status: vi.fn(async () => status),
    listProjects: vi.fn(async () => ({ cursor: 3, projects: [project] })),
    openProject: vi.fn(async () => project),
    listTasks: vi.fn(async () => ({ cursor: 4, tasks: [task] })),
    createTask: vi.fn(async () => task),
    getThread: vi.fn(async () => snapshot()),
    getThreadItem: vi.fn(async (_threadId: string, itemId: string) => ({ ...items.says('Read again'), id: itemId })),
    getBoard: vi.fn(async () => ({ cursor: 1, tasks: [], calls: [] })),
    merge: vi.fn(async () => {}),
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
    interrupt: vi.fn(async () => {}),
    stopSession: vi.fn(async () => {}),
    send: vi.fn(async () => {}),
    answer: vi.fn(async () => {}),
    getCoordinator: vi.fn(async () => coordinatorSnapshot()),
    startTask: vi.fn(async () => task),
    startPlan: vi.fn(async () => {}),
    holdPlan: vi.fn(async () => {}),
    changePlan: vi.fn(async () => {}),
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
    disconnect: vi.fn(async () => {}),
    addAccount: vi.fn(async (input: { readonly agentId: string; readonly name: string; readonly grant?: string }) => ({
      ...usual('acc_added', 'signed_out'),
      name: input.name,
      home: '/Users/me/Library/Application Support/Charrette/accounts/acc_added',
    })),
    renameAccount: vi.fn(async () => {}),
    removeAccount: vi.fn(async () => {}),
    orderAccounts: vi.fn(async () => {}),
    findAccounts: vi.fn(async () => [{ grant: 'grant_work', name: 'work', path: '/Users/me/.codex-work', tool: 'codex-profiles' }]),
    signInAccount: vi.fn(async () => ({ line: 'codex login', opened: true })),
    listIssues: vi.fn(async () => ({ issues: [] })),
    markReady: vi.fn(async () => {}),
    openChange: vi.fn(async () => {}),
    refreshTask: vi.fn(async () => {}),
    watch: (listener, since) => {
      watching.push(since)
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    close: vi.fn(async () => {}),
    ...overrides,
  }
  return { client, emit: (event: WatchEvent) => listeners.forEach((listener) => listener(event)), listeners, watching }
}

export const fakeHost = (overrides: Partial<Host> = {}): Host => ({
  pickFolder: vi.fn(async () => 'grant_picked'),
  grantDropped: vi.fn(async () => 'grant_dropped'),
  onOpen: vi.fn(() => () => {}),
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
