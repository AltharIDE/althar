// Scrappy: what the fake runtime answers, read from the page's state each time, so the app reads it as it changes.
import type { BoardSnapshot, CoordinatorSnapshot, ThreadSnapshot } from '@althar/contracts'

import { card, coordinatorSnapshot, snapshot } from '../../tests/fixtures'
import { althar, COORDINATOR, ROOT, TASK_ID, TASK_THREAD, TASK_TITLE } from './data'
import type { State } from './store'

const session = (turnRunning: boolean) => ({ ...snapshot().session!, agentId: 'claude-code', model: 'opus', turnRunning })

export const coordinatorOf = (s: State): CoordinatorSnapshot => ({
  ...coordinatorSnapshot({ project: { id: 'p1', name: althar.name } }),
  threadId: COORDINATOR,
  session: session(s.threads.coordinator.turnRunning),
  items: s.threads.coordinator.items,
})

export const threadOf = (s: State, threadId: string): ThreadSnapshot => {
  const base = snapshot()
  if (threadId !== TASK_THREAD) return { ...base, threadId, project: { id: 'p1', name: althar.name } }
  const thread = s.threads.task
  return {
    ...base,
    threadId: TASK_THREAD,
    project: { id: 'p1', name: althar.name },
    task: {
      ...base.task,
      id: TASK_ID,
      title: TASK_TITLE,
      slug: 'let-a-long-dictation-scroll-in-the-composer',
      branch: 'althar/let-a-long-dictation-scroll-in-the-composer',
      worktree: `${ROOT}/let-a-long-dictation-scroll-in-the-composer/althar`,
      phase: 'running',
      lead: { agentId: 'claude-code', model: 'opus', account: null },
      startedAt: new Date(Date.now() - 52 * 60_000).toISOString(),
      actions: ['abandon'],
    },
    session: session(thread.turnRunning),
    attention: [],
    items: thread.items,
    reports: [],
  }
}

export const boardOf = (s: State): BoardSnapshot => ({
  cursor: 1,
  calls: [],
  settledTotal: 0,
  tasks: [
    {
      ...card({ plan: null, issue: null }),
      taskId: TASK_ID,
      threadId: TASK_THREAD,
      title: TASK_TITLE,
      slug: 'let-a-long-dictation-scroll-in-the-composer',
      kind: 'plain',
      phase: 'running',
      branch: 'althar/let-a-long-dictation-scroll-in-the-composer',
      startedAt: new Date(Date.now() - 52 * 60_000).toISOString(),
      state: 'active',
      createdAt: new Date(Date.now() - 53 * 60_000).toISOString(),
      settledAt: null,
      changed: null,
      here: [],
    },
  ],
})
