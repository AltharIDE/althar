import type { AgentStatus, ProjectSummary, Status, TaskSummary, ThreadItem, ThreadSnapshot, WatchEvent } from '@charrette/contracts'
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
}

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
