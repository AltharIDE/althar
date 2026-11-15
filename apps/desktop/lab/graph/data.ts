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
import { chatItems } from './chat/items'
import { plan, tell } from './plan'
import { clock, scenario, scenarioKey, stage, worldNow } from './state'
import { taskItems } from './task/thread'
import { graphOf, type NodeView, taskIdOf, threadIdOf } from './view'

/*
 * What the made-up runtime says, read from the plan and the simulation as
 * they stand: the project, its board, the coordinator's conversation where
 * the request was made, talked over and launched, and each task's thread.
 * Before launch nothing of the request is on the board; after, the board
 * moves as the work does, and the page tells the window as each card changes.
 */

export const PROJECT = 'p_lab'
export const COORDINATOR = 'thc_lab'

/** Althar Cloud is Althar's own work; the other requests are a payments app's. */
export const projectName = () => (scenarioKey.get() === 'cloud' ? 'althar' : 'meridian')
const repository = () => (scenarioKey.get() === 'cloud' ? 'althar/althar' : 'meridian/api')

/** A minute of work ago, as a time on the wall: the clock's now is the window's now. */
export const at = (minute: number) => new Date(Date.now() - (clock.get() - minute) * 60_000).toISOString()
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

const pullUrl = (number: number) => `https://github.com/${repository()}/pull/${number}`

export const changeOf = (node: NodeView): ChangeSummary | null => {
  if (node.pr === null) return null
  const phase = node.now.phase
  const running = phase === 'checks' || phase === 'fixing'
  const failed = phase === 'failed'
  const list = ['types', 'unit', node.spec.flaky?.check ?? node.spec.breaks?.check ?? 'e2e', 'lint']
  return change({
    number: node.spec.pr,
    title: node.spec.title,
    url: pullUrl(node.spec.pr),
    repository: repository(),
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
export const phaseOf = (node: NodeView): Phase => {
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

const reviewerOf = (node: NodeView) => (node.spec.lead === 'codex' ? 'claude-code' : 'codex')

export const cardOf = (node: NodeView) => {
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
              { key: 'review', agentId: reviewerOf(node), model: null, skipped: false },
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
    reason: 'Reaching outside the sandbox asks while it is on.',
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
const other = (
  slug: string,
  title: string,
  phase: 'running' | 'settled' | 'ready',
  lead: 'claude-code' | 'codex',
  minutes: number,
  pr?: number,
): BoardTask => ({
  ...card({
    taskId: `t_${slug}`,
    threadId: `th_${slug}`,
    title,
    slug,
    phase,
    kind: 'change',
    plan: null,
    lead,
    branch: `althar/${slug}`,
    ...(phase === 'running' ? { step: 'implement' as const, startedAt: minutesAgo(minutes) } : {}),
    ...(pr === undefined
      ? {}
      : {
          change: change({
            number: pr,
            title,
            state: phase === 'settled' ? 'merged' : 'open',
            draft: false,
            url: pullUrl(pr),
            repository: repository(),
          }),
        }),
  }),
  state: phase === 'settled' ? 'merged' : 'open',
  createdAt: minutesAgo(minutes + 30),
  settledAt: phase === 'settled' ? minutesAgo(minutes) : null,
  changed: null,
  here: [],
})

const othersOf = (): ReadonlyArray<BoardTask> =>
  scenarioKey.get() === 'cloud'
    ? [
        other('virtualize-the-thread-view', 'Virtualize the thread view', 'running', 'claude-code', 34),
        other('changelog-0-9-0', 'Changelog shows 0.9.0’s publish time', 'running', 'codex', 12),
        other('errand-lines-plain-words', 'Errand lines on hold read in plain words', 'settled', 'claude-code', 140, 966),
        other('small-change-team', 'A small change’s card lets you pick its team', 'settled', 'claude-code', 260, 961),
        other('landing-gallery', 'A gallery of the app on the landing page', 'settled', 'claude-code', 380, 963),
      ]
    : [
        other('retry-webhooks', 'Retry failed webhooks with backoff', 'running', 'claude-code', 26),
        other('currency-rounding', 'Round refunds in the charge’s currency', 'settled', 'claude-code', 180, 405),
        other('stripe-sdk', 'Upgrade the Stripe SDK to 19', 'settled', 'codex', 320, 402),
      ]

/** The request's tasks as the graph has them, once launched; none while it's planned. */
export const nodesNow = (): ReadonlyArray<NodeView> => (stage.get() === 'run' ? graphOf(scenario(), worldNow()).nodes : [])

const projectSummary = (): ProjectSummary => {
  const nodes = nodesNow()
  const others = othersOf()
  const running = others.filter((one) => one.phase === 'running').length
  return {
    id: PROJECT,
    name: projectName(),
    slug: projectName(),
    ink: 'teal',
    lastWorkAt: minutesAgo(1),
    repository: `/Users/balazs/Code/${projectName()}`,
    repositories: [projectName()],
    worktrees: `/Users/balazs/Charrette/${projectName()}`,
    tasks: nodes.length + others.length,
    running: nodes.filter((one) => one.stand === 'running').length + running,
    yours: nodes.filter((one) => one.stand === 'yours').length,
    working: nodes.filter((one) => one.stand === 'running').length + running,
    usageLimit: 'move',
    rotateAccounts: false,
    onlyAccounts: null,
    coordinatorThreadId: COORDINATOR,
  }
}

export const boardNow = (): BoardSnapshot => {
  const nodes = nodesNow()
  const others = othersOf()
  return {
    cursor: 3,
    tasks: [...nodes.map(boardTaskOf), ...others],
    calls: nodes.filter((one) => one.now.phase === 'asks').map(callOf),
    settledTotal: nodes.filter((one) => one.stand === 'done').length + others.filter((one) => one.phase === 'settled').length,
  }
}

/** Each item placed at its minute, in order, with an id that holds across reads. */
let sequence = 0
const placed = (item: ThreadItem, id: string, minute: number): ThreadItem => {
  sequence += 1
  return { ...item, id, sequence, createdAt: at(minute) } as ThreadItem
}

/** How a part writes a thread's items: the person's words, an agent's, and the plan's card, each at its minute. */
export interface Writer {
  readonly you: (text: string, id: string, minute: number) => ThreadItem
  readonly says: (text: string, id: string, minute: number, agentId?: string) => ThreadItem
  /** The plan, as a card in the conversation, drawn by the chat option on show as its kind says (chat/items.ts). */
  readonly plan: (kind: string, version: number, id: string, minute: number) => ThreadItem
}

const writer: Writer = {
  you: (text, id, minute) => placed(items.you(text), id, minute),
  says: (text, id, minute, agentId = 'claude-code') => placed(items.says(text, agentId), id, minute),
  plan: (kind, version, id, minute) =>
    placed(
      items.card(
        card({
          taskId: `plan_${version}`,
          threadId: COORDINATOR,
          title: scenario().name,
          slug: `plan@${kind}@${version}`,
          phase: 'planned',
          kind: 'change',
          plan: null,
        }),
      ),
      id,
      minute,
    ),
}

// In the order of their minutes, numbered so.
const coordinatorItems = (): ReadonlyArray<ThreadItem> => chatItems(writer).map((item, i) => ({ ...item, sequence: i + 1 }) as ThreadItem)

const threadOf = (threadId: string): ThreadSnapshot => {
  const s = scenario()
  const node = nodesNow().find((one) => threadIdOf(s, one.key) === threadId)
  if (node === undefined) return snapshot({ threadId, project: { id: PROJECT, name: projectName() } })
  const base = snapshot()
  const phase = phaseOf(node)
  sequence = 0
  const said = taskItems(node, writer)
  const one = changeOf(node)
  return snapshot({
    threadId,
    project: { id: PROJECT, name: projectName() },
    task: {
      ...base.task,
      id: taskIdOf(s, node.key),
      title: node.spec.title,
      slug: node.slug,
      branch: `althar/${node.slug}`,
      worktree: `/Users/balazs/Charrette/${projectName()}/${node.slug}/${projectName()}`,
      phase,
      state: node.now.phase === 'merged' ? 'settled' : 'active',
      step: phase === 'running' ? (node.now.phase === 'implement' ? 'implement' : 'review') : null,
      stepAt: at(node.now.since),
      startedAt: node.now.startedAt === null ? null : at(node.now.startedAt),
      settledAt: node.now.mergedAt === null ? null : at(node.now.mergedAt),
      changes: one === null ? [] : [one],
      steps: [
        { key: 'implement', agentId: node.spec.lead, model: node.spec.model, skipped: false },
        { key: 'review', agentId: reviewerOf(node), model: null, skipped: false },
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

/** When the person's next message to the coordinator is, on the lab's clock: just before launch while it's planned. */
let typed = 0
const minuteNow = () => {
  typed += 1
  return stage.get() === 'plan' ? -1 + typed * 0.01 : clock.get()
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
    getCoordinator: async () => {
      const thinking = plan.get().thinking
      const base = snapshot().session as NonNullable<ThreadSnapshot['session']>
      return coordinatorSnapshot({
        threadId: COORDINATOR,
        project: { id: PROJECT, name: projectName() },
        host: { product: 'github', name: 'GitHub', webUrl: 'https://github.com', connected: true },
        session: { ...base, model: 'claude-opus-5-5', turnRunning: thinking, turnStartedAt: thinking ? minutesAgo(0) : null, held: false },
        items: [...coordinatorItems()],
      })
    },
    getThread: async (threadId) => threadOf(threadId),
    // A thread on screen reads a changed item on its own: the coordinator's cards, as they stand now.
    getThreadItem: async (threadId: string, itemId: string) => {
      const found = threadId === COORDINATOR ? coordinatorItems() : threadOf(threadId).items
      return found.find((one) => one.id === itemId) ?? null
    },
    // What the person tells the coordinator goes to the plan: it answers a moment later, with a new version where it changed it.
    send: async (input: { threadId: string; body: string }) => {
      if (input.threadId === COORDINATOR) tell(input.body, minuteNow())
    },
    getRepositories: async () =>
      repositories.slice(0, 1).map((one) => ({ ...one, name: projectName(), path: `/Users/balazs/Code/${projectName()}` })),
    listConnections: async () => ({ ...connectionList, connections: [githubConnection] }),
  } as Partial<Client>)

/** The tabs the window keeps at every load: the project's, on its board and conversation side by side. */
export const TABS = { open: [PROJECT], places: {}, rooms: { [PROJECT]: 'both' } }
