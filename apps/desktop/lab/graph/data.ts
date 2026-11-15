import type { BoardCall, BoardSnapshot, BoardTask, ChangeSummary, ProjectSummary, ThreadItem, ThreadSnapshot } from '@althar/contracts'

import type { Client } from '../../src/renderer/data/client'
import {
  card,
  change,
  connectionList,
  coordinatorSnapshot,
  fakeClient,
  githubConnection,
  home,
  items,
  repositories,
  snapshot,
} from '../../tests/fixtures'
import { clock, scenario, worldNow } from './state'
import { graphOf, type NodeView, taskIdOf, threadIdOf } from './view'

/*
 * What the made-up runtime says, read from the simulation as it stands:
 * the project, its board, the coordinator's conversation where the request
 * was made and split, and each task's thread. The board moves as the work
 * does; the page tells the window a card changed as each task moves.
 */

export const PROJECT = 'p_meridian'
export const COORDINATOR = 'thc_meridian'
const REPOSITORY = 'meridian/api'

/** A minute of work ago, as a time on the wall: the clock's now is the window's now. */
export const at = (minute: number) => new Date(Date.now() - (clock.get() - minute) * 60_000).toISOString()
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

const pullUrl = (number: number) => `https://github.com/${REPOSITORY}/pull/${number}`

const changeOf = (node: NodeView): ChangeSummary | null => {
  if (node.pr === null) return null
  const phase = node.now.phase
  const running = phase === 'checks' || phase === 'fixing'
  const failed = phase === 'failed'
  const list = ['types', 'unit', node.spec.flaky?.check ?? node.spec.breaks?.check ?? 'e2e', 'lint']
  return change({
    number: node.spec.pr,
    title: node.spec.title,
    url: pullUrl(node.spec.pr),
    repository: REPOSITORY,
    state: phase === 'merged' ? 'merged' : 'open',
    draft: false,
    checks: {
      outcome: failed ? 'failed' : running ? 'running' : 'passed',
      passed: failed ? 3 : running ? 2 : 4,
      failed: failed ? 1 : 0,
      running: running ? 2 : 0,
      total: 4,
      failing: failed ? [list[2] as string] : [],
      list: list.map((name, i) => ({
        name,
        state: failed && i === 2 ? ('failed' as const) : running && i >= 2 ? ('running' as const) : ('passed' as const),
        summary: null,
      })),
    },
  })
}

type Phase = BoardTask['phase']
const phaseOf = (node: NodeView): Phase => {
  switch (node.now.phase) {
    case 'waits':
      return 'held'
    case 'starting':
      return 'planned'
    case 'implement':
    case 'review':
    case 'checks':
    case 'fixing':
      return 'running'
    case 'asks':
      return 'waiting'
    case 'failed':
      return 'stopped'
    case 'ready':
      return 'ready'
    case 'merged':
      return 'settled'
  }
}

const cardOf = (node: NodeView) => {
  const phase = phaseOf(node)
  const s = scenario()
  const startsAt =
    node.now.phase === 'starting'
      ? new Date(Date.now() + Math.max(1, (1.5 - (clock.get() - node.now.since)) * 20) * 1000).toISOString()
      : null
  return card({
    taskId: taskIdOf(s, node.key),
    threadId: threadIdOf(s, node.key),
    title: node.spec.title,
    slug: node.slug,
    phase,
    kind: 'change',
    branch: `althar/${node.slug}`,
    plan:
      phase === 'planned' || phase === 'held'
        ? {
            id: `pln_${node.slug}`,
            steps: [
              { key: 'implement', agentId: node.spec.lead, model: node.spec.model, skipped: false },
              { key: 'review', agentId: node.spec.lead === 'codex' ? 'claude-code' : 'codex', model: null, skipped: false },
            ],
            startsAt,
            reason: null,
            end: null,
          }
        : null,
    change: changeOf(node),
    step: node.now.phase === 'implement' || node.now.phase === 'asks' ? 'implement' : phase === 'running' ? 'review' : null,
    summary: null,
    lead: node.spec.lead,
    leadModel: node.spec.model,
    startedAt: node.now.startedAt === null ? null : at(node.now.startedAt),
    ...(node.now.phase === 'failed' ? { stopped: { by: 'althar' as const, at: at(node.now.since) } } : {}),
  })
}

const boardTaskOf = (node: NodeView): BoardTask => ({
  ...cardOf(node),
  state: node.now.phase === 'merged' ? 'merged' : 'open',
  createdAt: at(0),
  settledAt: node.now.mergedAt === null ? null : at(node.now.mergedAt),
  changed: null,
  here: [],
})

const callOf = (node: NodeView): BoardCall => {
  const s = scenario()
  return {
    id: `call_${node.slug}`,
    kind: 'permission',
    title: `Run ${node.spec.asks?.command ?? ''}`,
    reason: 'Starting a container asks while the sandbox is on.',
    command: node.spec.asks?.command ?? '',
    stuck: null,
    createdAt: at(node.now.since),
    taskId: taskIdOf(s, node.key),
    threadId: threadIdOf(s, node.key),
    taskTitle: node.spec.title,
    taskSlug: node.slug,
  } as BoardCall
}

/* What else the project holds, so the board reads like a day's work. */
const OTHERS: ReadonlyArray<BoardTask> = [
  {
    ...card({
      taskId: 't_retry-webhooks',
      threadId: 'th_retry-webhooks',
      title: 'Retry failed webhooks with backoff',
      slug: 'retry-webhooks',
      phase: 'running',
      kind: 'change',
      plan: null,
      step: 'implement',
      lead: 'claude-code',
      branch: 'althar/retry-webhooks',
      startedAt: minutesAgo(26),
    }),
    state: 'open',
    createdAt: minutesAgo(30),
    settledAt: null,
    changed: null,
    here: [],
  },
  {
    ...card({
      taskId: 't_currency-rounding',
      threadId: 'th_currency-rounding',
      title: 'Round refunds in the charge’s currency',
      slug: 'currency-rounding',
      phase: 'settled',
      kind: 'change',
      plan: null,
      lead: 'claude-code',
      branch: 'althar/currency-rounding',
      change: change({
        number: 405,
        title: 'Round refunds in the charge’s currency',
        state: 'merged',
        draft: false,
        url: pullUrl(405),
        repository: REPOSITORY,
      }),
    }),
    state: 'merged',
    createdAt: minutesAgo(400),
    settledAt: minutesAgo(180),
    changed: null,
    here: [],
  },
  {
    ...card({
      taskId: 't_stripe-sdk',
      threadId: 'th_stripe-sdk',
      title: 'Upgrade the Stripe SDK to 19',
      slug: 'stripe-sdk',
      phase: 'settled',
      kind: 'change',
      plan: null,
      lead: 'codex',
      branch: 'althar/stripe-sdk',
      change: change({
        number: 402,
        title: 'Upgrade the Stripe SDK to 19',
        state: 'merged',
        draft: false,
        url: pullUrl(402),
        repository: REPOSITORY,
      }),
    }),
    state: 'merged',
    createdAt: minutesAgo(600),
    settledAt: minutesAgo(320),
    changed: null,
    here: [],
  },
]

const nodesNow = () => graphOf(scenario(), worldNow()).nodes

const projectSummary = (): ProjectSummary => {
  const nodes = nodesNow()
  return {
    id: PROJECT,
    name: 'meridian',
    slug: 'meridian',
    ink: 'teal',
    lastWorkAt: minutesAgo(1),
    repository: '/Users/balazs/Code/meridian',
    repositories: ['meridian'],
    worktrees: '/Users/balazs/Charrette/meridian',
    tasks: nodes.length + OTHERS.length,
    running: nodes.filter((one) => one.stand === 'running').length + 1,
    yours: nodes.filter((one) => one.stand === 'yours').length,
    working: nodes.filter((one) => one.stand === 'running').length + 1,
    usageLimit: 'move',
    rotateAccounts: false,
    onlyAccounts: null,
    coordinatorThreadId: COORDINATOR,
  }
}

export const boardNow = (): BoardSnapshot => {
  const nodes = nodesNow()
  return {
    cursor: 3,
    tasks: [...nodes.map(boardTaskOf), ...OTHERS],
    calls: nodes.filter((one) => one.now.phase === 'asks').map(callOf),
    settledTotal: nodes.filter((one) => one.stand === 'done').length + 2,
  }
}

/** Each item placed at its minute, in order, with an id that holds across reads. */
const placed = (item: ThreadItem, id: string, sequence: number, minute: number): ThreadItem =>
  ({ ...item, id, sequence, createdAt: at(minute) }) as ThreadItem

const coordinatorItems = (): ReadonlyArray<ThreadItem> => {
  const s = scenario()
  const nodes = nodesNow()
  return [
    placed(items.you('Is anything still waiting on the Stripe upgrade?'), 'c_earlier_you', 1, -340),
    placed(items.says('No: #402 merged this morning and nothing else was waiting for it.'), 'c_earlier_says', 2, -339),
    placed(items.you(s.asked), 'c_asked', 3, -1),
    placed(items.says(s.answer), 'c_answer', 4, -0.5),
    ...nodes.map((node, i) => placed(items.card(cardOf(node)), `card_${node.key}`, 5 + i, -0.4)),
  ]
}

const threadOf = (threadId: string): ThreadSnapshot => {
  const s = scenario()
  const node = nodesNow().find((one) => threadIdOf(s, one.key) === threadId)
  if (node === undefined) return snapshot({ threadId, project: { id: PROJECT, name: 'meridian' } })
  const base = snapshot()
  const phase = phaseOf(node)
  const said: ThreadItem[] = [
    placed(items.you(`${node.spec.title}. Part of: ${s.asked}`), `${threadId}_you`, 1, -0.4),
    ...(node.now.startedAt === null
      ? []
      : [
          placed(
            items.says(
              `I’ll ${node.spec.title.charAt(0).toLowerCase()}${node.spec.title.slice(1)}, then open its pull request.`,
              node.spec.lead,
            ),
            `${threadId}_says`,
            2,
            node.now.startedAt,
          ),
        ]),
  ]
  const one = changeOf(node)
  return snapshot({
    threadId,
    project: { id: PROJECT, name: 'meridian' },
    task: {
      ...base.task,
      id: taskIdOf(s, node.key),
      title: node.spec.title,
      slug: node.slug,
      branch: `althar/${node.slug}`,
      worktree: `/Users/balazs/Charrette/meridian/${node.slug}/meridian`,
      phase,
      state: node.now.phase === 'merged' ? 'settled' : 'active',
      step: phase === 'running' ? (node.now.phase === 'implement' ? 'implement' : 'review') : null,
      stepAt: at(node.now.since),
      startedAt: node.now.startedAt === null ? null : at(node.now.startedAt),
      settledAt: node.now.mergedAt === null ? null : at(node.now.mergedAt),
      changes: one === null ? [] : [one],
      steps: [
        { key: 'implement', agentId: node.spec.lead, model: node.spec.model, skipped: false },
        { key: 'review', agentId: node.spec.lead === 'codex' ? 'claude-code' : 'codex', model: null, skipped: false },
      ],
      lead: { agentId: node.spec.lead, model: node.spec.model, account: null },
      actions: node.now.phase === 'merged' ? [] : ['stop', 'abandon'],
    },
    session: {
      ...(base.session as NonNullable<ThreadSnapshot['session']>),
      agentId: node.spec.lead,
      agentName: node.spec.lead === 'codex' ? 'Codex' : 'Claude Code',
      model: node.spec.model,
      turnRunning: phase === 'running',
    },
    items: said,
  })
}

export const makeClient = () =>
  fakeClient({
    listProjects: async () => ({ cursor: 3, projects: [projectSummary()] }),
    openProject: async () => projectSummary(),
    getHome: async () =>
      home({
        looked: minutesAgo(180),
        since: minutesAgo(180),
        projects: [projectSummary()],
        tasks: boardNow()
          .tasks.filter((task) => task.phase !== 'settled')
          .map((task) => ({ ...task, projectId: PROJECT })),
        calls: boardNow().calls.map((call) => ({ ...call, projectId: PROJECT })),
      }),
    getBoard: async () => boardNow(),
    getCoordinator: async () =>
      coordinatorSnapshot({
        threadId: COORDINATOR,
        project: { id: PROJECT, name: 'meridian' },
        host: { product: 'github', name: 'GitHub', webUrl: 'https://github.com', connected: true },
        items: [...coordinatorItems()],
      }),
    getThread: async (threadId) => threadOf(threadId),
    // A thread on screen reads a changed item on its own: the coordinator's cards, as they stand now.
    getThreadItem: async (threadId: string, itemId: string) => {
      const items = threadId === COORDINATOR ? coordinatorItems() : threadOf(threadId).items
      return items.find((one) => one.id === itemId) ?? null
    },
    getRepositories: async () => repositories.slice(0, 1).map((one) => ({ ...one, name: 'meridian', path: '/Users/balazs/Code/meridian' })),
    listConnections: async () => ({ ...connectionList, connections: [githubConnection] }),
  } as Partial<Client>)

/** The tabs the window keeps at every load: meridian's, on its board and conversation side by side. */
export const TABS = { open: [PROJECT], places: {}, rooms: { [PROJECT]: 'both' } }
