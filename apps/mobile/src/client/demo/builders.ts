import type {
  AttentionRequest,
  ChangedFile,
  ChangeSummary,
  ChecksSummary,
  HomeCall,
  HomeTask,
  ProjectSummary,
  SessionSummary,
  TaskCard,
  ThreadItem,
  ThreadSnapshot,
} from '@althar/contracts'

/*
 * Builders for the demo's records: each fills what the contract requires and
 * the demo doesn't care about, so a scenario reads as what it shows.
 */

export const ago = (now: number, minutes: number): string => new Date(now - minutes * 60_000).toISOString()
export const ahead = (now: number, minutes: number): string => new Date(now + minutes * 60_000).toISOString()

export const slugOf = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)

export const project = (over: Partial<ProjectSummary> & Pick<ProjectSummary, 'id' | 'name' | 'ink'>): ProjectSummary => ({
  slug: slugOf(over.name),
  lastWorkAt: null,
  repository: over.name,
  repositories: [over.name],
  worktrees: `~/.althar/worktrees/${over.name}`,
  tasks: 0,
  running: 0,
  waiting: 0,
  working: 0,
  ready: 0,
  usageLimit: 'move',
  rotateAccounts: false,
  onlyAccounts: null,
  coordinatorThreadId: `thr_coord_${over.id}`,
  ...over,
})

export const task = (over: Partial<HomeTask> & Pick<HomeTask, 'taskId' | 'title' | 'phase' | 'projectId'>): HomeTask => ({
  threadId: `thr_${over.taskId}`,
  slug: slugOf(over.title),
  kind: 'change',
  handed: null,
  reviewing: null,
  plan: null,
  issue: null,
  change: null,
  earlier: [],
  unshipped: null,
  step: null,
  followUp: false,
  summary: null,
  lead: null,
  leadModel: null,
  leadEffort: null,
  branch: `althar/${slugOf(over.title)}`,
  startedAt: null,
  waits: null,
  handedBack: null,
  keptAt: null,
  queued: null,
  planWaits: false,
  inLine: false,
  state: 'active',
  createdAt: new Date().toISOString(),
  settledAt: null,
  changed: null,
  here: [],
  ...over,
})

export const checks = (passed: number, failed: number, running: number, failing: ReadonlyArray<string> = []): ChecksSummary => ({
  outcome: running > 0 ? 'running' : failed > 0 ? 'failed' : passed > 0 ? 'passed' : 'none',
  passed,
  failed,
  running,
  total: passed + failed + running,
  failing: [...failing],
  list: [
    ...failing.map((name) => ({ name, state: 'failed' as const, summary: 'Exited 1' })),
    ...Array.from({ length: Math.min(passed, 4) }, (_, i) => ({
      name: ['typecheck', 'unit (ubuntu)', 'unit (macos)', 'lint'][i] ?? `check ${i}`,
      state: 'passed' as const,
      summary: null,
    })),
  ],
})

export const pullRequest = (over: Partial<ChangeSummary> & Pick<ChangeSummary, 'number' | 'title' | 'repository'>): ChangeSummary => ({
  product: 'github',
  url: `https://github.com/${over.repository}/pull/${over.number}`,
  state: 'open',
  draft: true,
  noun: 'pull request',
  short: 'PR',
  prefix: '#',
  slug: null,
  additions: null,
  deletions: null,
  changedFiles: null,
  checks: null,
  target: 'main',
  conflicts: false,
  head: '9f3c2ab',
  listening: true,
  localHead: '9f3c2ab',
  unpushed: 0,
  diverged: null,
  ...over,
})

export const call = (
  over: Partial<HomeCall> & Pick<HomeCall, 'id' | 'kind' | 'title' | 'reason' | 'projectId' | 'threadId' | 'createdAt'>,
): HomeCall => ({
  command: null,
  stuck: null,
  taskId: null,
  taskTitle: null,
  taskSlug: null,
  ...over,
})

export const attentionOf = (homeCall: HomeCall): AttentionRequest => {
  const { taskId: _taskId, threadId: _threadId, taskTitle: _taskTitle, taskSlug: _taskSlug, projectId: _projectId, ...attention } = homeCall
  return attention
}

export const file = (path: string, add: number, del: number, over: Partial<ChangedFile> = {}): ChangedFile => ({
  path,
  from: null,
  status: del === 0 && add > 0 ? 'added' : 'modified',
  add,
  del,
  binary: false,
  uncommitted: false,
  ...over,
})

export const session = (over: Partial<SessionSummary> & Pick<SessionSummary, 'id' | 'agentId' | 'agentName'>): SessionSummary => ({
  state: 'running',
  model: null,
  account: null,
  effort: null,
  models: [],
  turnRunning: false,
  turnStartedAt: null,
  turnEndedAt: null,
  held: true,
  context: null,
  background: [],
  ...over,
})

let sequence = 0
const item = (agentId: string | null, at: string) => ({ id: `item_${++sequence}`, sequence, agentId, createdAt: at })

export const say = {
  person: (text: string, at: string): ThreadItem => ({
    ...item(null, at),
    kind: 'user_message',
    content: { text, links: [], pictures: [] },
    input: null,
  }),
  agent: (agentId: string, text: string, at: string): ThreadItem => ({
    ...item(agentId, at),
    kind: 'agent_message',
    content: { text, pictures: [], files: [] },
  }),
  tool: (
    agentId: string,
    at: string,
    title: string,
    toolKind: 'execute' | 'edit' | 'read' | 'search',
    over: { readonly command?: string; readonly path?: string; readonly exit?: number; readonly status?: string } = {},
  ): ThreadItem => ({
    ...item(agentId, at),
    kind: 'tool_call',
    content: {
      title,
      toolKind,
      status: over.status ?? 'completed',
      command: over.command ?? null,
      locations: over.path === undefined ? [] : [{ path: over.path }],
      declined: false,
      pictures: [],
      files: [],
      output: over.command === undefined ? null : { kept: true, lines: 24, bytes: 1800, dropped: 0, error: null },
      exit: over.exit ?? (over.command === undefined ? null : 0),
    },
  }),
  /** A task's card in the coordinator's conversation: its plan before it starts, then where it stands. */
  task: (card: TaskCard, at: string): ThreadItem => ({ ...item(null, at), kind: 'task', content: card }),
  notice: (title: string, at: string, severity: 'info' | 'warning' | 'error' = 'info', description: string | null = null): ThreadItem => ({
    ...item(null, at),
    kind: 'notice',
    content: { source: 'runtime', severity, title, description },
  }),
  result: (
    agentId: string,
    at: string,
    content: {
      readonly step: 'implement' | 'review' | 'settle' | 'publish'
      readonly round?: number
      readonly summary: string
      readonly change?: ChangeSummary | null
      readonly verdict?: 'pass' | 'changes_requested' | null
      readonly findings?: ReadonlyArray<{
        severity: 'blocking' | 'major' | 'minor' | 'nit'
        file: string | null
        line: number | null
        claim: string
      }>
      readonly checked?: ReadonlyArray<{ caption: string; command: string; exit: number }>
      readonly unverified?: ReadonlyArray<string>
    },
  ): ThreadItem => ({
    ...item(agentId, at),
    kind: 'step_result',
    content: {
      step: content.step,
      round: content.round ?? 0,
      summary: content.summary,
      change: content.change ?? null,
      verdict: content.verdict ?? null,
      findings: [...(content.findings ?? [])],
      built: null,
      evidence: (content.checked ?? []).map((check) => ({
        kind: 'command' as const,
        caption: check.caption,
        picture: null,
        command: check.command,
        exit: check.exit,
        text: null,
        dropped: 0,
      })),
      unverified: content.unverified === undefined ? null : [...content.unverified],
      agentId,
    },
  }),
}

/** A task's thread, from its card and what was said in it. */
export const thread = (
  card: HomeTask,
  projectName: string,
  items: ReadonlyArray<ThreadItem>,
  over: {
    readonly request?: string
    readonly files?: ReadonlyArray<ChangedFile>
    readonly commits?: number
    readonly session?: SessionSummary | null
    readonly attention?: ReadonlyArray<AttentionRequest>
  } = {},
): ThreadSnapshot => ({
  threadId: card.threadId,
  cursor: 0,
  project: { id: card.projectId, name: projectName },
  host: { product: 'github', name: 'GitHub', webUrl: 'https://github.com', connected: true },
  task: {
    id: card.taskId,
    title: card.title,
    description: over.request ?? card.title,
    request: over.request ?? null,
    slug: card.slug,
    state: card.state,
    branch: card.branch,
    worktree: `~/.althar/worktrees/${card.slug}`,
    baseRef: 'main',
    phase: card.phase,
    kind: card.kind,
    handedBack: card.handedBack ?? null,
    waits: card.waits,
    queued: card.queued,
    steps: card.plan?.steps ?? [],
    lead: card.lead === null ? null : { agentId: card.lead, model: card.leadModel, account: null },
    step: card.step,
    stepAt: card.startedAt,
    startedAt: card.startedAt,
    settledAt: card.settledAt,
    issue: null,
    changes: card.change === null ? [] : [card.change],
    files: [...(over.files ?? [])],
    commits: over.commits ?? 0,
    here: [],
    merged: [],
    actions: card.phase === 'running' || card.phase === 'waiting' ? ['stop', 'abandon'] : ['abandon'],
    planId: null,
    runnables: [],
    launches: [],
    resolveConflicts: { task: null, project: true },
    allowEverything: { task: false, project: false },
    review: card.reviewing ?? null,
  },
  session: over.session ?? null,
  attention: [...(over.attention ?? [])],
  items: [...items],
  earlier: false,
  reports: items.filter((one) => one.kind === 'step_result'),
})
