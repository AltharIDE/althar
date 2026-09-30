import type {
  AgentStatus,
  CoordinatorSnapshot,
  ProjectSummary,
  Status,
  TaskSummary,
  ThreadItem,
  ThreadSnapshot,
  WatchEvent,
} from '@charrette/contracts'
import { vi } from 'vitest'

import type { Client } from '../src/renderer/data/client'
import type { Host } from '../src/renderer/data/services'

/* What the runtime would say, as plain values, and a client that says it. */

export const NOW = '2026-09-29T12:00:00.000Z'

export const agents: ReadonlyArray<AgentStatus> = [
  { id: 'claude-code', name: 'Claude Code', signIn: 'signed_in', login: 'claude auth login' },
  { id: 'codex', name: 'Codex', signIn: 'unknown', login: 'codex login' },
  { id: 'opencode', name: 'OpenCode', signIn: 'signed_out', login: 'opencode auth login' },
]

export const status: Status = { apiVersion: 1, appVersion: '0.0.0', agents }

export const project: ProjectSummary = {
  id: 'p1',
  name: 'meridian',
  slug: 'meridian',
  repository: '/code/meridian',
  tasks: 1,
  running: 1,
  waiting: 0,
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
  ): ThreadItem => ({
    ...next(),
    agentId: null,
    kind: 'user_message',
    content: { text },
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
    content: { step: 'implement', round: 0, summary: 'Added the retry.', verdict: null, findings: [], agentId: null, ...content },
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
  },
  step: null,
  summary: null,
  lead: 'claude-code',
  branch: 'charrette/add-a-retry',
  startedAt: null,
  ...overrides,
})

/** The coordinator's thread, as GetCoordinator gives it: no one working, starting on Claude Code. */
export const coordinatorSnapshot = (overrides: Partial<CoordinatorSnapshot> = {}): CoordinatorSnapshot => ({
  threadId: 'thc',
  cursor: 5,
  project: { id: 'p1', name: 'meridian' },
  session: null,
  suggested: { agentId: 'claude-code', agentName: 'Claude Code', model: null, available: true },
  items: [],
  earlier: false,
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
  },
  session: {
    id: 's1',
    agentId: 'claude-code',
    agentName: 'Claude Code',
    state: 'active',
    model: 'opus',
    models: ['opus', 'sonnet'],
    turnRunning: false,
  },
  attention: [],
  items: [],
  earlier: false,
  ...overrides,
})

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
    startSession: vi.fn(async () => 's1'),
    switchAgent: vi.fn(async () => 's2'),
    setModel: vi.fn(async () => {}),
    interrupt: vi.fn(async () => {}),
    stopSession: vi.fn(async () => {}),
    send: vi.fn(async () => {}),
    answer: vi.fn(async () => {}),
    getCoordinator: vi.fn(async () => coordinatorSnapshot()),
    startTask: vi.fn(async () => task),
    startPlan: vi.fn(async () => {}),
    holdPlan: vi.fn(async () => {}),
    changePlan: vi.fn(async () => {}),
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
