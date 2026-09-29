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
export const item = (kind: ThreadItem['kind'], content: unknown, extra: Partial<ThreadItem> = {}): ThreadItem => {
  sequence += 1
  return {
    id: `i${sequence}`,
    sequence,
    kind,
    content,
    agentId: kind === 'user_message' ? null : 'claude-code',
    toolCallId: null,
    input: kind === 'user_message' ? { state: 'delivered', interrupting: false } : null,
    createdAt: NOW,
    ...extra,
  }
}

export const snapshot = (overrides: Partial<ThreadSnapshot> = {}): ThreadSnapshot => ({
  threadId: 'th1',
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
  items: [],
  attention: [],
  turns: [],
  ...overrides,
})

/** A client whose every call resolves with the fixtures, and whose watch the test drives with `emit`. */
export const fakeClient = (overrides: Partial<Client> = {}) => {
  const listeners = new Set<(event: WatchEvent) => void>()
  const client: Client = {
    status: vi.fn(async () => status),
    listProjects: vi.fn(async () => [project]),
    openProject: vi.fn(async () => project),
    listTasks: vi.fn(async () => [task]),
    createTask: vi.fn(async () => task),
    getThread: vi.fn(async () => snapshot()),
    startSession: vi.fn(async () => 's1'),
    switchAgent: vi.fn(async () => 's2'),
    setModel: vi.fn(async () => {}),
    interrupt: vi.fn(async () => {}),
    stopSession: vi.fn(async () => {}),
    send: vi.fn(async () => {}),
    answer: vi.fn(async () => {}),
    watch: (listener) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    close: vi.fn(async () => {}),
    ...overrides,
  }
  return { client, emit: (event: WatchEvent) => listeners.forEach((listener) => listener(event)), listeners }
}

export const fakeHost = (overrides: Partial<Host> = {}): Host => ({
  pickFolder: vi.fn(async () => '/code/meridian'),
  pathOf: vi.fn(() => '/code/dropped'),
  ...overrides,
})
