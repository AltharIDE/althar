import type { BoardSnapshot, BoardTask, IssueSummary, ProjectSummary, ThreadItem, ThreadSnapshot } from '@althar/contracts'

import type { Client } from '../../src/renderer/data/client'
import { card, change, connectionList, fakeClient, githubConnection, home, items, repositories, snapshot } from '../../tests/fixtures'
import { type Ending, lab } from './state'

/*
 * What the lab's fake runtime says: althar, with one task on its board that
 * came from a Linear issue, and that task's thread. The bar's ending decides
 * whether the task ends in a pull request (none yet, or #1012 open) or with
 * none, as a prototype does.
 */

export const ALTHAR = 'p_althar'
const THREAD = 'th_undo-a-sent-message'
const TASK = 't_undo-a-sent-message'
const SLUG = 'undo-a-sent-message'
const TITLE = 'Undo a sent message, composer side'
export const PR = 1012

const opened = Date.now()
const minutesAgo = (minutes: number) => new Date(opened - minutes * 60_000).toISOString()

/** The issue the task came from, and a second one, on another tracker, for the crowded case. */
export const ISSUES: ReadonlyArray<IssueSummary> = [
  {
    product: 'linear',
    ref: 'DEV-211',
    key: 'DEV-211',
    title: 'Undo a message once it’s sent',
    url: 'https://linear.app/althar/issue/DEV-211',
    status: { name: 'In Progress', category: 'started' },
    priority: { level: 'high', name: 'High' },
    container: 'Althar',
  },
  {
    product: 'github',
    ref: 'AltharIDE/althar#842',
    key: '#842',
    title: 'After a restart, an undone message’s words are gone from the composer instead of back in it',
    url: 'https://github.com/AltharIDE/althar/issues/842',
    status: { name: 'Open', category: 'todo' },
    priority: null,
    container: 'AltharIDE/althar',
  },
]

const project: ProjectSummary = {
  id: ALTHAR,
  name: 'althar',
  slug: 'althar',
  ink: 'clay',
  lastWorkAt: minutesAgo(2),
  repository: '/Users/balazs/Code/althar',
  repositories: ['althar'],
  worktrees: '/Users/balazs/Charrette/althar',
  tasks: 1,
  running: 1,
  yours: 0,
  working: 1,
  usageLimit: 'move',
  rotateAccounts: false,
  onlyAccounts: null,
  coordinatorThreadId: 'thc_althar',
}

const pullRequest = () =>
  change({
    number: PR,
    title: TITLE,
    url: `https://github.com/AltharIDE/althar/pull/${PR}`,
    repository: 'AltharIDE/althar',
    draft: false,
    checks: { outcome: 'passed', passed: 6, failed: 0, running: 0, total: 6, failing: [], list: [] },
  })

const boardOf = (): BoardSnapshot => {
  const { ending } = lab.get()
  const task: BoardTask = {
    ...card({
      taskId: TASK,
      threadId: THREAD,
      title: TITLE,
      slug: SLUG,
      phase: 'ready',
      kind: ending === 'none' ? 'plain' : 'change',
      plan: null,
      branch: `althar/${SLUG}`,
      change: ending === 'open' ? pullRequest() : null,
      lead: 'claude-code',
      startedAt: minutesAgo(40),
    }),
    state: 'active',
    createdAt: minutesAgo(45),
    settledAt: null,
    changed: null,
    here: [],
  }
  return { cursor: 4, tasks: [task], calls: [], settledTotal: 41 }
}

const at =
  (ago: number) =>
  (item: ThreadItem): ThreadItem =>
    ({ ...item, createdAt: minutesAgo(ago) }) as ThreadItem

const threadItems = (): ReadonlyArray<ThreadItem> => [
  at(40)(items.you('Take the composer side of DEV-211: Undo on a sent message for its first minute. The runtime side can wait.')),
  at(39)(
    items.says(
      'I’ll add Undo to a sent message for its first minute, putting its words back in the composer, and leave the runtime alone.',
    ),
  ),
  at(38)(items.tool({ title: 'Read Composer.tsx', toolKind: 'read' })),
  at(36)(items.tool({ title: 'Edit Composer.tsx', toolKind: 'edit' })),
  at(33)(
    items.tool({
      title: 'bunx vitest run tests/composer.test.tsx',
      toolKind: 'execute',
      command: 'bunx vitest run tests/composer.test.tsx',
    }),
  ),
  at(31)(
    items.says(
      'A sent message has Undo for its first minute. Pressed, the message goes and its words are back in the composer, where the cursor was. The runtime still sends it at once, so a turn that has started is not called back.',
    ),
  ),
]

const endOf = (ending: Ending) => (ending === 'none' ? 'none' : 'ready')

const threadOf = (): ThreadSnapshot => {
  const { ending } = lab.get()
  const base = snapshot()
  return snapshot({
    threadId: THREAD,
    project: { id: ALTHAR, name: 'althar' },
    task: {
      ...base.task,
      id: TASK,
      title: TITLE,
      slug: SLUG,
      kind: ending === 'none' ? 'plain' : 'change',
      branch: `althar/${SLUG}`,
      worktree: `/Users/balazs/Charrette/althar/${SLUG}/althar`,
      phase: 'ready',
      end: endOf(ending),
      steps: [
        { key: 'implement', agentId: 'claude-code', model: null, skipped: false },
        ...(ending === 'none' ? [] : [{ key: 'review' as const, agentId: 'codex', model: null, skipped: false }]),
      ],
      lead: { agentId: 'claude-code', model: null, account: null },
      startedAt: minutesAgo(40),
      issue: ISSUES[0]!,
      issuePartOf: lab.get().partOf[ISSUES[0]!.key] === true,
      changes: ending === 'open' ? [pullRequest()] : [],
      files: [
        {
          path: 'apps/desktop/src/renderer/features/task/Composer.tsx',
          from: null,
          status: 'modified',
          add: 48,
          del: 6,
          binary: false,
          uncommitted: false,
        },
        { path: 'apps/desktop/tests/composer.test.tsx', from: null, status: 'added', add: 31, del: 0, binary: false, uncommitted: false },
      ],
      commits: 2,
    },
    session: {
      ...(base.session as NonNullable<ThreadSnapshot['session']>),
      turnRunning: false,
      held: false,
    },
    items: threadItems(),
  })
}

export const makeClient = (): Client =>
  fakeClient({
    listProjects: async () => ({ cursor: 3, projects: [project] }),
    openProject: async () => project,
    getHome: async () => home({ looked: minutesAgo(180), since: minutesAgo(180), projects: [project] }),
    getBoard: async () => boardOf(),
    getThread: async () => threadOf(),
    getRepositories: async () => repositories.slice(0, 1).map((one) => ({ ...one, name: 'althar', path: '/Users/balazs/Code/althar' })),
    listConnections: async () => ({ ...connectionList, connections: [githubConnection] }),
    setTaskIssuePart: async (_taskId, partOf) => lab.setPart(ISSUES[0]!.key, partOf),
  }).client

export const TASK_THREAD = THREAD
export const TASK_ID = TASK
/** The tabs the window keeps at every load: althar's, on its board. */
export const TABS = { open: [ALTHAR], places: {}, rooms: { [ALTHAR]: 'both' } }
