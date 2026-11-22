import type { BoardSnapshot, BoardTask, ProjectSummary, ThreadItem, ThreadSnapshot } from '@althar/contracts'

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

/*
 * What the lab's fake runtime says: a team's project, storefront, whose board
 * holds the work of every role (a spec draft, a design prototype, builds, a
 * rollout and an incident), and the coordinator's conversation over it. The
 * features and their stages are features.ts's.
 */

export const STOREFRONT = 'p_storefront'
export const INFRA = 'p_infra'

const opened = Date.now()
export const minutesAgo = (minutes: number) => new Date(opened - minutes * 60_000).toISOString()

interface WorldTask {
  readonly slug: string
  readonly title: string
  readonly phase: BoardTask['phase']
  readonly ago: number
  readonly pr?: number
  readonly lead?: string
  readonly kind?: BoardTask['kind']
}

export const TASKS: ReadonlyArray<WorldTask> = [
  { slug: 'saved-carts-api', title: 'Saved carts: keep the cart on the server', phase: 'ready', ago: 40, pr: 418 },
  { slug: 'apple-pay-sheet', title: 'Apple Pay in the payment sheet', phase: 'running', ago: 18, lead: 'codex' },
  { slug: 'checkout-e2e-flake', title: 'Fix the flaky checkout end-to-end test', phase: 'running', ago: 9 },
  { slug: 'guest-checkout-directions', title: 'Guest checkout: three directions', phase: 'ready', ago: 70, kind: 'plain' },
  { slug: 'gift-cards-spec', title: 'Gift cards: draft the spec', phase: 'running', ago: 25, kind: 'plain' },
  { slug: 'refund-webhook-5xx', title: 'Why refund webhooks return 503', phase: 'running', ago: 6, kind: 'plain' },
  { slug: 'saved-carts-rollout', title: 'Roll saved carts out to staging', phase: 'planned', ago: 3 },
]

const threadIdOf = (slug: string) => `th_${slug}`
const taskIdOf = (slug: string) => `t_${slug}`
const coordinatorOf = (projectId: string) => `thc_${projectId}`

const taskCard = (task: WorldTask): BoardTask => ({
  ...card({
    taskId: taskIdOf(task.slug),
    threadId: threadIdOf(task.slug),
    title: task.title,
    slug: task.slug,
    phase: task.phase,
    kind: task.kind ?? 'change',
    branch: task.kind === 'plain' ? null : `althar/${task.slug}`,
    plan:
      task.phase === 'planned'
        ? {
            id: `pln_${task.slug}`,
            steps: [
              { key: 'implement', agentId: 'claude-code', model: null, skipped: false },
              { key: 'review', agentId: 'codex', model: null, skipped: false },
            ],
            startsAt: new Date(Date.now() + 10 * 60_000).toISOString(),
            reason: null,
            end: null,
          }
        : null,
    change:
      task.pr === undefined
        ? null
        : change({
            number: task.pr,
            title: task.title,
            url: `https://github.com/acme/storefront/pull/${task.pr}`,
            repository: 'acme/storefront',
            draft: false,
            checks: { outcome: 'passed', passed: 6, failed: 0, running: 0, total: 6, failing: [], list: [] },
          }),
    step: task.phase === 'running' ? 'implement' : null,
    lead: task.lead ?? 'claude-code',
    startedAt: task.phase === 'planned' ? null : minutesAgo(task.ago),
  }),
  state: 'active',
  createdAt: minutesAgo(task.ago),
  settledAt: null,
  changed: null,
  here: [],
})

const projectOf = (projectId: string): ProjectSummary => {
  const name = projectId === STOREFRONT ? 'storefront' : 'infra'
  return {
    id: projectId,
    name,
    slug: name,
    ink: projectId === STOREFRONT ? 'clay' : 'teal',
    lastWorkAt: minutesAgo(2),
    repository: `/home/team/Code/${name}`,
    repositories: [name],
    worktrees: `/home/team/Althar/${name}`,
    tasks: projectId === STOREFRONT ? TASKS.length : 0,
    running: projectId === STOREFRONT ? 4 : 0,
    yours: projectId === STOREFRONT ? 2 : 0,
    working: projectId === STOREFRONT ? 4 : 0,
    usageLimit: 'move',
    rotateAccounts: false,
    onlyAccounts: null,
    coordinatorThreadId: coordinatorOf(projectId),
  }
}

const projects = [projectOf(STOREFRONT), projectOf(INFRA)]

let cursor = 3
const boardOf = (projectId: string): BoardSnapshot => {
  cursor += 1
  if (projectId !== STOREFRONT) return { cursor, tasks: [], calls: [], settledTotal: 0 }
  return { cursor, tasks: TASKS.map(taskCard), calls: [], settledTotal: 63 }
}

const said = (who: 'you' | 'lead', text: string, ago: number): ThreadItem =>
  ({ ...(who === 'you' ? items.you(text) : items.says(text, 'claude-code')), createdAt: minutesAgo(ago) }) as ThreadItem

/** The coordinator's conversation in storefront: the same in every direction and lens. */
const COORDINATOR: ReadonlyArray<ThreadItem> = [
  said('you', 'Where is saved carts?', 52),
  said(
    'lead',
    'Built. **#412**, **#415** and **#418** are merged, the review passed and main is green, so Build is done and **Saved carts** waits on DevOps to ship.\n\nI drafted `specs/saved-carts/ops.md` from the spec: staging first, behind `saved_carts`, then 10% of production.',
    51,
  ),
  said('you', 'Guest checkout’s design is approved, start the build.', 14),
  said('lead', 'Design is done. I proposed two build tasks from `specs/guest-checkout/design/`; they’re in Engineering’s handoffs.', 13),
]

const taskThread = (threadId: string): ThreadSnapshot => {
  const task = TASKS.find((candidate) => threadIdOf(candidate.slug) === threadId)
  const base = snapshot()
  const slug = task?.slug ?? 'new'
  const running = task?.phase === 'running'
  return snapshot({
    threadId,
    project: { id: STOREFRONT, name: 'storefront' },
    task: {
      ...base.task,
      id: taskIdOf(slug),
      title: task?.title ?? 'New task',
      slug,
      kind: task?.kind ?? 'change',
      branch: `althar/${slug}`,
      worktree: null,
      phase: running ? 'running' : 'ready',
      steps: [{ key: 'implement', agentId: 'claude-code', model: null, skipped: false }],
      lead: { agentId: 'claude-code', model: null, account: null },
      startedAt: minutesAgo(task?.ago ?? 0),
    },
    session: {
      ...(base.session as NonNullable<ThreadSnapshot['session']>),
      turnRunning: running,
      turnStartedAt: running ? minutesAgo(1) : null,
    },
    items: [],
  })
}

export const makeClient = (): Client =>
  fakeClient({
    listProjects: async () => ({ cursor: 3, projects }),
    openProject: async (projectId) => projectOf(projectId),
    getHome: async () => home({ looked: minutesAgo(180), since: minutesAgo(180), projects }),
    getBoard: async (projectId) => boardOf(projectId),
    getCoordinator: async (projectId) =>
      coordinatorSnapshot({
        threadId: coordinatorOf(projectId),
        project: { id: projectId, name: projectOf(projectId).name },
        host: { product: 'github', name: 'GitHub', webUrl: 'https://github.com', connected: true },
        items: projectId === STOREFRONT ? [...COORDINATOR] : [],
      }),
    getThread: async (threadId) => taskThread(threadId),
    getRepositories: async () =>
      repositories.slice(0, 1).map((one) => ({ ...one, name: 'storefront', path: '/home/team/Code/storefront' })),
    listConnections: async () => ({ ...connectionList, connections: [githubConnection] }),
  }).client

/** The tabs the window keeps at every load: storefront's and infra's, storefront's on its conversation beside its board. */
export const TABS = { open: [STOREFRONT, INFRA], places: {}, rooms: { [STOREFRONT]: 'both', [INFRA]: 'both' } }
