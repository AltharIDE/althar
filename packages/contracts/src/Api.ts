import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

/*
 * What a client can ask the runtime (docs/architecture/02): commands that
 * change state, queries that return what a screen shows, and one stream of
 * what changes. Everything is a schema, checked on both sides of the port.
 * Queries return projections shaped for screens, never tables.
 *
 * Every command carries an id the client makes, so a retry is answered from
 * the first one's receipt instead of running again. Every query says the
 * change-feed cursor it read at, so a client watches from there and misses
 * nothing between the two.
 */

/** Bumped when a change would break a client built against an older API. */
export const API_VERSION = 1

export class ApiError extends Schema.TaggedError<ApiError>()('ApiError', {
  /** What kind of failure: the runtime's error tag, such as `NotARepository` or `SessionFailed`. */
  reason: Schema.String,
  /** What went wrong, in words the window can show. */
  message: Schema.String,
}) {}

/** A command's id, made by the client: `cmd_` and 32 hex digits. The same id twice is a retry. */
export const CommandId = Schema.String.check(Schema.isPattern(/^cmd_[0-9a-f]{32}$/))
export type CommandId = typeof CommandId.Type

/** A position in the store's change feed. Events after it are the ones a client hasn't seen. */
export const Cursor = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

export const SignIn = Schema.Literals(['signed_in', 'signed_out', 'unknown'])
export type SignIn = typeof SignIn.Type

/** One sign-in of an agent, in a folder of its own (ADR-012): the agent's usual folder first. */
export const AccountStatus = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  /** Its folder, to recognise it by; null for the agent's usual one. */
  home: Schema.NullOr(Schema.String),
  signIn: SignIn,
  paidBy: Schema.Literals(['plan', 'key', 'unknown']),
  /** Out of usage until then, where it is. */
  outUntil: Schema.NullOr(Schema.String),
  /** What made its folder, when Charrette didn't. */
  adoptedFrom: Schema.NullOr(Schema.String),
})
export type AccountStatus = typeof AccountStatus.Type

export const AgentStatus = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  /** Signed in where any of its accounts is. */
  signIn: SignIn,
  /** The agent's own command for signing in, when it isn't. */
  login: Schema.String,
  /** Its accounts, in the person's order. */
  accounts: Schema.Array(AccountStatus),
})
export type AgentStatus = typeof AgentStatus.Type

/** A folder an account switcher keeps one of the agent's accounts in, by a grant for it. */
export const FoundAccount = Schema.Struct({
  grant: Schema.String,
  /** Its name there, as the account's. */
  name: Schema.String,
  /** The folder, shown, never sent back. */
  path: Schema.String,
  /** The switcher that keeps such folders. */
  tool: Schema.String,
})
export type FoundAccount = typeof FoundAccount.Type

/**
 * The models an agent offers, and how hard each can be asked to think, in
 * the agent's own names: from its latest session, or asked of it once.
 */
export const AgentModels = Schema.Struct({
  agentId: Schema.String,
  models: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String, description: Schema.NullOr(Schema.String) })),
  /** Lowest first; empty where the agent has no such choice. */
  efforts: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })),
  /** What it is on, as last seen: its own default, or what it was last set to. */
  model: Schema.NullOr(Schema.String),
  effort: Schema.NullOr(Schema.String),
  /** The person's default effort for each model they set one for: a session on it starts there. */
  defaults: Schema.Array(Schema.Struct({ model: Schema.String, effort: Schema.String })),
  /** Being asked now, for an agent not seen before: read again shortly. */
  probing: Schema.Boolean,
})
export type AgentModels = typeof AgentModels.Type

export const Status = Schema.Struct({
  apiVersion: Schema.Number,
  appVersion: Schema.String,
  agents: Schema.Array(AgentStatus),
})
export type Status = typeof Status.Type

export const ProjectSummary = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  slug: Schema.String,
  repository: Schema.NullOr(Schema.String),
  tasks: Schema.Number,
  /** Sessions working now. */
  running: Schema.Number,
  /** Questions waiting on the person. */
  waiting: Schema.Number,
  /** When an agent reaches its usage limit: its work moves on to the next free agent, or waits for the reset. */
  usageLimit: Schema.Literals(['move', 'wait']),
})
export type ProjectSummary = typeof ProjectSummary.Type

export const ProjectList = Schema.Struct({ cursor: Cursor, projects: Schema.Array(ProjectSummary) })
export type ProjectList = typeof ProjectList.Type

export const TaskSummary = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  title: Schema.String,
  slug: Schema.String,
  threadId: Schema.String,
  state: Schema.String,
  branch: Schema.NullOr(Schema.String),
  /** The agent working on it now, if one is. */
  agentId: Schema.NullOr(Schema.String),
  waiting: Schema.Number,
  createdAt: Schema.String,
})
export type TaskSummary = typeof TaskSummary.Type

export const TaskList = Schema.Struct({ cursor: Cursor, tasks: Schema.Array(TaskSummary) })
export type TaskList = typeof TaskList.Type

/* ---- Code hosts and trackers (docs/architecture/06) ---- */

/** A code host or tracker Charrette connects to. Cloud and Data Center are separate products. */
export const Product = Schema.Literals(['github', 'gitlab', 'bitbucket_cloud', 'bitbucket_dc', 'linear', 'jira_cloud', 'jira_dc', 'trello'])
export type Product = typeof Product.Type

/** A person's sign-in to a code host or tracker, on this Mac. */
export const ConnectionSummary = Schema.Struct({
  id: Schema.String,
  product: Product,
  /** The product's name: GitHub, Linear. */
  name: Schema.String,
  /** The instance: https://github.com, or a company's own server. */
  webUrl: Schema.String,
  account: Schema.Struct({ login: Schema.String, name: Schema.NullOr(Schema.String) }),
  auth: Schema.Literals(['device_flow', 'pkce', 'token']),
  /** Ready, or its token stopped working and it needs signing in again. */
  state: Schema.Literals(['ready', 'reauth_required']),
})
export type ConnectionSummary = typeof ConnectionSummary.Type

/** A product a person can connect, and how they sign in to it. */
export const ProductOption = Schema.Struct({
  product: Product,
  name: Schema.String,
  host: Schema.Boolean,
  tracker: Schema.Boolean,
  /** The hosted service's address; null for one that only runs on a company's own server. */
  hostedUrl: Schema.NullOr(Schema.String),
  /** An instance on a company's own server can be connected, by its address. */
  selfHosted: Schema.Boolean,
  /** The service's own sign-in, in the browser, is set up here; otherwise a pasted token. */
  browserSignIn: Schema.Boolean,
  /** A pasted token goes with the account's email. */
  tokenNeedsUser: Schema.Boolean,
  /** Where the person makes a token, on the hosted service. */
  tokenHelp: Schema.String,
})
export type ProductOption = typeof ProductOption.Type

export const ConnectionList = Schema.Struct({
  cursor: Cursor,
  connections: Schema.Array(ConnectionSummary),
  products: Schema.Array(ProductOption),
})
export type ConnectionList = typeof ConnectionList.Type

/** A sign-in under way: a code to type on the service's page, or a page to approve in the browser. */
export const SignInStart = Schema.Union([
  Schema.Struct({
    flowId: Schema.String,
    kind: Schema.Literal('device'),
    userCode: Schema.String,
    verificationUri: Schema.String,
    expiresAt: Schema.String,
  }),
  Schema.Struct({ flowId: Schema.String, kind: Schema.Literal('browser'), url: Schema.String }),
])
export type SignInStart = typeof SignInStart.Type

export const SignInState = Schema.Union([
  Schema.Struct({ state: Schema.Literal('waiting') }),
  Schema.Struct({ state: Schema.Literal('done'), connectionId: Schema.String }),
  Schema.Struct({ state: Schema.Literal('ended'), reason: Schema.Literals(['denied', 'expired', 'failed']), message: Schema.String }),
])
export type SignInState = typeof SignInState.Type

/** Where an issue stands: in the tracker's words, and as a category every tracker's statuses fall into. */
export const IssueStatus = Schema.Struct({
  name: Schema.String,
  category: Schema.Literals(['triage', 'backlog', 'todo', 'started', 'done', 'cancelled']),
})

/** An issue on a connected tracker, or in the project's repository. */
export const IssueSummary = Schema.Struct({
  product: Product,
  /** What it is read by again: its key, or owner/repo#12. */
  ref: Schema.String,
  key: Schema.String,
  title: Schema.String,
  url: Schema.String,
  status: IssueStatus,
  priority: Schema.NullOr(Schema.Struct({ level: Schema.String, name: Schema.String })),
  container: Schema.NullOr(Schema.String),
})
export type IssueSummary = typeof IssueSummary.Type

export const IssueList = Schema.Struct({ issues: Schema.Array(IssueSummary) })
export type IssueList = typeof IssueList.Type

/** A head's checks, summed up: how many passed, failed and still run, and which failed. */
export const ChecksSummary = Schema.Struct({
  outcome: Schema.Literals(['none', 'running', 'passed', 'failed']),
  passed: Schema.Number,
  failed: Schema.Number,
  running: Schema.Number,
  total: Schema.Number,
  failing: Schema.Array(Schema.String),
  /** Each check, by name, as it stands, with what it said of itself. */
  list: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      state: Schema.Literals(['queued', 'running', 'passed', 'failed', 'skipped', 'cancelled', 'neutral']),
      summary: Schema.NullOr(Schema.String),
    }),
  ),
})
export type ChecksSummary = typeof ChecksSummary.Type

/** A task's pull request (GitLab's merge request), as last seen, in its host's words. */
export const ChangeSummary = Schema.Struct({
  product: Product,
  number: Schema.Number,
  title: Schema.String,
  url: Schema.String,
  state: Schema.Literals(['open', 'merged', 'closed']),
  draft: Schema.Boolean,
  /** The host's words: pull request or merge request, PR or MR, # or !. */
  noun: Schema.String,
  short: Schema.String,
  prefix: Schema.String,
  repository: Schema.String,
  additions: Schema.NullOr(Schema.Number),
  deletions: Schema.NullOr(Schema.Number),
  changedFiles: Schema.NullOr(Schema.Number),
  checks: Schema.NullOr(ChecksSummary),
  /** The commit at its head, as last seen: what accepting it merges, and nothing newer. */
  head: Schema.NullOr(Schema.String),
  /** Charrette asks its host for news while the task is open. */
  listening: Schema.Boolean,
})
export type ChangeSummary = typeof ChangeSummary.Type

/** What a task does when its steps are done: open a draft pull request, open one for review, or push its branch only. */
export const TaskEnd = Schema.Literals(['draft', 'ready', 'none'])
export type TaskEnd = typeof TaskEnd.Type

/** A link the person pasted, unfurled: an issue, or a pull request. */
export const Unfurl = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('issue'),
    product: Product,
    key: Schema.String,
    title: Schema.String,
    url: Schema.String,
    status: IssueStatus,
    priority: Schema.NullOr(Schema.Struct({ level: Schema.String, name: Schema.String })),
    container: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal('change'),
    product: Product,
    key: Schema.String,
    title: Schema.String,
    url: Schema.String,
    state: Schema.Literals(['draft', 'open', 'merged', 'closed']),
    repository: Schema.String,
  }),
])
export type Unfurl = typeof Unfurl.Type

/* ---- A thread's items, each kind with its own content ---- */

/** A file a tool call touches, and the line, when it says. */
export const ToolLocation = Schema.Struct({ path: Schema.String, line: Schema.optional(Schema.Number) })

const itemFields = {
  id: Schema.String,
  sequence: Schema.Number,
  /** Which agent said it, for what agents say. */
  agentId: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
}

/** What the person said, and where it stands with the lead. */
export const UserMessageItem = Schema.Struct({
  ...itemFields,
  kind: Schema.Literal('user_message'),
  /** What they said, and the links in it Charrette could unfurl. */
  content: Schema.Struct({ text: Schema.String, links: Schema.Array(Unfurl) }),
  input: Schema.NullOr(Schema.Struct({ state: Schema.Literals(['queued', 'delivered', 'superseded']), interrupting: Schema.Boolean })),
})

/** What an agent said or thought, as far as the store has it. */
export const AgentTextItem = Schema.Struct({
  ...itemFields,
  kind: Schema.Literals(['agent_message', 'agent_thought']),
  content: Schema.Struct({ text: Schema.String }),
})

/** A tool call: what it is, how it stands, the command it runs and the files it touches, without its raw input and output. */
export const ToolCallItem = Schema.Struct({
  ...itemFields,
  kind: Schema.Literal('tool_call'),
  content: Schema.Struct({
    title: Schema.String,
    /** ACP's tool kind: read, edit, execute, and so on. */
    toolKind: Schema.String,
    /** ACP's status: pending, in_progress, completed or failed. */
    status: Schema.String,
    command: Schema.NullOr(Schema.String),
    locations: Schema.Array(ToolLocation),
    /** Refused when it asked: by the rules, the lead or the person. */
    declined: Schema.Boolean,
  }),
})

/** The agent's plan, as it last said it. */
export const PlanItem = Schema.Struct({
  ...itemFields,
  kind: Schema.Literal('plan'),
  content: Schema.Struct({ entries: Schema.Array(Schema.Struct({ content: Schema.String, status: Schema.String })) }),
})

/** Something the agent or Charrette notes: a warning from the agent, or a change of scene, such as another agent taking over. */
export const NoticeItem = Schema.Struct({
  ...itemFields,
  kind: Schema.Literal('notice'),
  content: Schema.Struct({
    source: Schema.Literals(['agent', 'runtime']),
    severity: Schema.Literals(['info', 'warning', 'error']),
    title: Schema.String,
    description: Schema.NullOr(Schema.String),
  }),
})

/** Something a review found: how much it matters, where it is, and what is wrong. */
export const Finding = Schema.Struct({
  severity: Schema.Literals(['blocking', 'major', 'minor', 'nit']),
  file: Schema.NullOr(Schema.String),
  line: Schema.NullOr(Schema.Number),
  claim: Schema.String,
})
export type Finding = typeof Finding.Type

/**
 * What a step reported when it ended: the lead's summary of its work or of
 * settling a review, or the review's verdict and findings. The person reads
 * this rather than the work itself.
 */
export const StepResultItem = Schema.Struct({
  ...itemFields,
  kind: Schema.Literal('step_result'),
  content: Schema.Struct({
    step: Schema.Literals(['implement', 'review', 'settle', 'publish']),
    /** The review round, from 0. */
    round: Schema.Number,
    summary: Schema.String,
    /** For publishing: the pull request it opened. */
    change: Schema.NullOr(ChangeSummary),
    verdict: Schema.NullOr(Schema.Literals(['pass', 'changes_requested'])),
    findings: Schema.Array(Finding),
    /** Who reported it, for a review. */
    agentId: Schema.NullOr(Schema.String),
  }),
})

/**
 * Something heard from outside, written by someone else: a comment or a
 * review on the task's pull request, its checks finishing, its being merged,
 * closed or marked ready. It reads as a quoted note, not either side of the
 * conversation.
 */
export const ArrivalItem = Schema.Struct({
  ...itemFields,
  kind: Schema.Literal('arrival'),
  content: Schema.Struct({
    source: Product,
    kind: Schema.Literals(['comment', 'review', 'checks', 'merged', 'closed', 'ready']),
    /** Who: a login; null for what the host itself says. */
    from: Schema.NullOr(Schema.String),
    /** Where: PR #12. */
    where: Schema.String,
    text: Schema.NullOr(Schema.String),
    verdict: Schema.NullOr(Schema.Literals(['approved', 'changes_requested', 'commented'])),
    path: Schema.NullOr(Schema.String),
    line: Schema.NullOr(Schema.Number),
    passed: Schema.NullOr(Schema.Number),
    failed: Schema.NullOr(Schema.Number),
    failing: Schema.Array(Schema.String),
    url: Schema.NullOr(Schema.String),
    /** Said by someone who can't write to the repository, as anyone can on a public one: not passed to the lead, for the person to pass on. */
    outsider: Schema.Boolean,
  }),
})

/** A step of a task's plan: which kind, who does it, and whether it is skipped. For now only Implement and Review. */
export const PlanStep = Schema.Struct({
  key: Schema.Literals(['implement', 'review']),
  agentId: Schema.String,
  model: Schema.NullOr(Schema.String),
  /** How hard its agent thinks; the agent's own default without one. */
  effort: Schema.optional(Schema.NullOr(Schema.String)),
  skipped: Schema.Boolean,
})
export type PlanStep = typeof PlanStep.Type

/** Where a task stands, as the coordinator's thread shows it. */
export const TaskPhase = Schema.Literals(['planned', 'held', 'running', 'waiting', 'ready', 'stopped', 'settled'])
export type TaskPhase = typeof TaskPhase.Type

/**
 * A task as its card shows it, in the coordinator's thread and on the board:
 * where it stands, its plan, the issue it came from, its pull request, the
 * step it is on, what its lead last reported, who leads it.
 */
export const TaskCard = Schema.Struct({
  taskId: Schema.String,
  threadId: Schema.String,
  title: Schema.String,
  slug: Schema.String,
  phase: TaskPhase,
  plan: Schema.NullOr(
    Schema.Struct({
      id: Schema.String,
      steps: Schema.Array(PlanStep),
      /** When it starts on its own; null once held or started. */
      startsAt: Schema.NullOr(Schema.String),
      /** Why the coordinator chose the lead. */
      reason: Schema.NullOr(Schema.String),
      /** What happens when the work is done; null where nothing reaches the repository's host. */
      end: Schema.NullOr(TaskEnd),
    }),
  ),
  /** The issue it came from. */
  issue: Schema.NullOr(Schema.Struct({ product: Product, key: Schema.String, title: Schema.String, url: Schema.String })),
  /** Its pull request, once opened. */
  change: Schema.NullOr(ChangeSummary),
  /** The step it is on, by key, while it runs. */
  step: Schema.NullOr(Schema.String),
  /** The latest summary the lead reported. */
  summary: Schema.NullOr(Schema.String),
  /** The agent that leads it, or last did: the plan's lead until one starts. */
  lead: Schema.NullOr(Schema.String),
  branch: Schema.NullOr(Schema.String),
  startedAt: Schema.NullOr(Schema.String),
  /** The step is held until an agent's usage limit resets: which agent, and when it is back. */
  waits: Schema.NullOr(Schema.Struct({ agentId: Schema.String, until: Schema.String })),
})
export type TaskCard = typeof TaskCard.Type

/**
 * A task in the coordinator's thread: its plan before it starts, with the
 * time it starts on its own, then its card as it runs. Charrette posts it and
 * keeps it current; no agent writes it.
 */
export const TaskItem = Schema.Struct({
  ...itemFields,
  kind: Schema.Literal('task'),
  content: TaskCard,
})

export const ThreadItem = Schema.Union([
  UserMessageItem,
  AgentTextItem,
  ToolCallItem,
  PlanItem,
  NoticeItem,
  StepResultItem,
  TaskItem,
  ArrivalItem,
])
export type ThreadItem = typeof ThreadItem.Type

export const SessionSummary = Schema.Struct({
  id: Schema.String,
  agentId: Schema.String,
  agentName: Schema.String,
  state: Schema.String,
  model: Schema.NullOr(Schema.String),
  /** How hard it thinks, where the agent offers a choice. */
  effort: Schema.NullOr(Schema.String),
  /** The models the agent offers for this session. */
  models: Schema.Array(Schema.String),
  turnRunning: Schema.Boolean,
})
export type SessionSummary = typeof SessionSummary.Type

/**
 * A step of a task's plan that needs the person (docs/architecture/05): its
 * agent didn't report after a reminder, went, couldn't start, or a restart
 * stopped it; or review ran out of rounds with changes it hasn't seen.
 */
export const StuckStep = Schema.Struct({
  step: Schema.Literals(['implement', 'review', 'settle', 'publish']),
  why: Schema.Literals(['no_report', 'session_ended', 'failed_to_start', 'restarted', 'round_limit', 'not_connected', 'usage_limit']),
  /** What went wrong, in the agent's or Charrette's words; for the last round, the lead's summary. */
  detail: Schema.NullOr(Schema.String),
  /** The agent on the step. */
  agentId: Schema.NullOr(Schema.String),
  /** The review round, from 0. */
  round: Schema.Number,
  /** Review findings the lead hasn't settled. */
  open: Schema.Number,
})
export type StuckStep = typeof StuckStep.Type

/** A call waiting on the person: a permission the rules keep for them, or a step that needs them. */
export const AttentionRequest = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(['permission', 'stuck']),
  /** What the agent wants to do, as it put it. */
  title: Schema.String,
  /** Why it waits for the person: the rule that keeps it for them. */
  reason: Schema.String,
  command: Schema.NullOr(Schema.String),
  /** For a step that needs the person: which, and why. */
  stuck: Schema.NullOr(StuckStep),
  createdAt: Schema.String,
})
export type AttentionRequest = typeof AttentionRequest.Type

/**
 * A file a task changed, from its base to its worktree as it stands: how,
 * how much, and whether some of that isn't committed yet, so isn't in what
 * Charrette pushes.
 */
export const ChangedFile = Schema.Struct({
  path: Schema.String,
  /** Where it was, for a file that moved. */
  from: Schema.NullOr(Schema.String),
  status: Schema.Literals(['added', 'modified', 'deleted', 'renamed']),
  add: Schema.Number,
  del: Schema.Number,
  binary: Schema.Boolean,
  uncommitted: Schema.Boolean,
})
export type ChangedFile = typeof ChangedFile.Type

/** A line of a diff: a hunk's head, or a line of the file, with its numbers and, for a changed line, the stretch that differs. */
export const DiffLine = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('hunk'), text: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('context'), old: Schema.Number, new: Schema.Number, text: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal('added'),
    new: Schema.Number,
    text: Schema.String,
    changed: Schema.optional(Schema.Array(Schema.String)),
  }),
  Schema.Struct({
    kind: Schema.Literal('removed'),
    old: Schema.Number,
    text: Schema.String,
    changed: Schema.optional(Schema.Array(Schema.String)),
  }),
])
export type DiffLine = typeof DiffLine.Type

/** One file's diff, read from git when asked for, never kept: its lines, cut short past a limit and saying so. */
export const FileDiff = Schema.Struct({
  file: ChangedFile,
  lines: Schema.Array(DiffLine),
  truncated: Schema.Boolean,
})
export type FileDiff = typeof FileDiff.Type

/** A task's thread: its task and project, the agent working on it, the calls waiting on the person, and a page of its items. */
export const ThreadSnapshot = Schema.Struct({
  threadId: Schema.String,
  cursor: Cursor,
  project: Schema.Struct({ id: Schema.String, name: Schema.String }),
  task: Schema.Struct({
    id: Schema.String,
    title: Schema.String,
    description: Schema.String,
    slug: Schema.String,
    state: Schema.String,
    branch: Schema.NullOr(Schema.String),
    worktree: Schema.NullOr(Schema.String),
    baseRef: Schema.NullOr(Schema.String),
    /** Where it stands, as its card says: ready once its run passed review. */
    phase: Schema.NullOr(TaskPhase),
    /** Its step held until an agent's usage limit resets: which agent, and when it is back. */
    waits: Schema.NullOr(Schema.Struct({ agentId: Schema.String, until: Schema.String })),
    /** The issue it came from. */
    issue: Schema.NullOr(IssueSummary),
    /** Its pull requests, as last seen. */
    changes: Schema.Array(ChangeSummary),
    /** What it changed since it started, committed or not, file by file, and in how many commits; empty without a worktree here. */
    files: Schema.Array(ChangedFile),
    commits: Schema.Number,
  }),
  session: Schema.NullOr(SessionSummary),
  attention: Schema.Array(AttentionRequest),
  /** The newest items before the page's start, oldest first. */
  items: Schema.Array(ThreadItem),
  /** There are items before these. */
  earlier: Schema.Boolean,
})
export type ThreadSnapshot = typeof ThreadSnapshot.Type

/** A task on the board: its card, how it ended, and, ready without a pull request, how big its change is. */
export const BoardTask = Schema.Struct({
  ...TaskCard.fields,
  state: Schema.String,
  createdAt: Schema.String,
  settledAt: Schema.NullOr(Schema.String),
  /** What a ready task changed, when it has no pull request to say so: its files, and lines added and removed. */
  changed: Schema.NullOr(Schema.Struct({ files: Schema.Number, add: Schema.Number, del: Schema.Number })),
})
export type BoardTask = typeof BoardTask.Type

/** A call that waits on the person, with the task it holds. */
export const BoardCall = Schema.Struct({
  ...AttentionRequest.fields,
  taskId: Schema.String,
  threadId: Schema.String,
  taskTitle: Schema.String,
  taskSlug: Schema.String,
})
export type BoardCall = typeof BoardCall.Type

/**
 * A project's board: every task it hasn't settled, and the most recently
 * settled, each with its card; and every call that waits on the person.
 * Which lane each goes in is the window's to say.
 */
export const BoardSnapshot = Schema.Struct({
  cursor: Cursor,
  tasks: Schema.Array(BoardTask),
  calls: Schema.Array(BoardCall),
})
export type BoardSnapshot = typeof BoardSnapshot.Type

/**
 * A project's coordinator thread: the agent working on it, if one is, the one
 * it would start on, and a page of its items. The coordinator starts when you
 * first say something to it.
 */
export const CoordinatorSnapshot = Schema.Struct({
  threadId: Schema.String,
  cursor: Cursor,
  project: Schema.Struct({ id: Schema.String, name: Schema.String }),
  session: Schema.NullOr(SessionSummary),
  /** The agent, model and effort it starts on: whatever you used last. Unavailable when that agent isn't signed in. */
  suggested: Schema.NullOr(
    Schema.Struct({
      agentId: Schema.String,
      agentName: Schema.String,
      model: Schema.NullOr(Schema.String),
      effort: Schema.NullOr(Schema.String),
      available: Schema.Boolean,
    }),
  ),
  items: Schema.Array(ThreadItem),
  earlier: Schema.Boolean,
  /** Where the project's repository is hosted, when its remote says, and whether Charrette is connected to it there. */
  host: Schema.NullOr(Schema.Struct({ product: Product, name: Schema.String, webUrl: Schema.String, connected: Schema.Boolean })),
})
export type CoordinatorSnapshot = typeof CoordinatorSnapshot.Type

/** Items to a page, when a client doesn't say. */
export const PAGE = 100

/**
 * What changes, as it happens. `Changed` says a record changed, from the
 * store's change feed, with its cursor and, when it belongs to one, its
 * thread: a client reads again what shows it. `Streaming` is an agent's
 * message or thought as far as it has come, whole each time, before the store
 * has all of it: a client shows it in place of the item's text. It is not in
 * the feed, so it has no cursor.
 */
export const WatchEvent = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal('Changed'),
    cursor: Cursor,
    aggregateType: Schema.String,
    aggregateId: Schema.String,
    projectId: Schema.NullOr(Schema.String),
    threadId: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    _tag: Schema.Literal('Streaming'),
    threadId: Schema.String,
    itemId: Schema.String,
    /** What it is and who is saying it, so a client can show it before it has read the item. */
    kind: Schema.Literals(['agent_message', 'agent_thought']),
    agentId: Schema.String,
    text: Schema.String,
  }),
])
export type WatchEvent = typeof WatchEvent.Type

export const Disposition = Schema.Literals(['after_current', 'interrupt_and_continue'])

const call = <const Tag extends string, P extends Schema.Struct.Fields, S extends Schema.Top>(tag: Tag, payload: P, success: S) =>
  Rpc.make(tag, { payload, success, error: ApiError })

/** A command: what it says, and the client's id for it. */
const command = <const Tag extends string, P extends Schema.Struct.Fields, S extends Schema.Top>(tag: Tag, payload: P, success: S) =>
  call(tag, { commandId: CommandId, ...payload }, success)

const limit = Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 500 })))

export const Api = RpcGroup.make(
  /** The runtime's version and the agents on this machine. Sign-in is checked at most once a minute, unless `recheck`. */
  call('Status', { recheck: Schema.optional(Schema.Boolean) }, Status),
  Rpc.make('ListProjects', { success: ProjectList, error: ApiError }),
  /** Opens the folder the person chose, by the grant the app gave for it: the window never names a path. */
  command('OpenProject', { grant: Schema.String }, ProjectSummary),
  call('ListTasks', { projectId: Schema.String }, TaskList),
  command(
    'CreateTask',
    { projectId: Schema.String, title: Schema.String, description: Schema.optional(Schema.String), issue: Schema.optional(Schema.String) },
    TaskSummary,
  ),
  /** The thread, with the newest `limit` items before `before` (a sequence), or none with `limit: 0`. */
  call('GetThread', { threadId: Schema.String, before: Schema.optional(Schema.Int), limit }, ThreadSnapshot),
  /** One file a task changed, as a diff from its base to its worktree. */
  call('GetFileDiff', { taskId: Schema.String, path: Schema.String }, FileDiff),
  /** A project's board: its tasks, by card, and the calls that wait on the person. */
  call('GetBoard', { projectId: Schema.String }, BoardSnapshot),
  call('GetThreadItem', { threadId: Schema.String, itemId: Schema.String }, ThreadItem),
  /** The project's coordinator thread, made the first time it is asked for. */
  call('GetCoordinator', { projectId: Schema.String, before: Schema.optional(Schema.Int), limit }, CoordinatorSnapshot),
  /** Starts a task you planned yourself: it shows in the coordinator's thread like one it planned, and starts at once. */
  command(
    'StartTask',
    {
      projectId: Schema.String,
      title: Schema.String,
      description: Schema.optional(Schema.String),
      steps: Schema.Array(PlanStep),
      /** The issue it comes from: its link or its key. */
      issue: Schema.optional(Schema.String),
      /** What happens when the work is done; without it, a draft pull request where the repository's host is connected. */
      end: Schema.optional(Schema.NullOr(TaskEnd)),
    },
    TaskSummary,
  ),
  /** Starts a planned task now, rather than when its time runs out. */
  command('StartPlan', { planId: Schema.String }, Schema.Void),
  /** Holds a planned task: it waits until you start it. */
  command('HoldPlan', { planId: Schema.String }, Schema.Void),
  /** Changes who does a planned task's steps, or skips one, before it starts. */
  command(
    'ChangePlan',
    { planId: Schema.String, steps: Schema.Array(PlanStep), end: Schema.optional(Schema.NullOr(TaskEnd)) },
    Schema.Void,
  ),
  command(
    'StartSession',
    { threadId: Schema.String, agentId: Schema.String, model: Schema.optional(Schema.String), effort: Schema.optional(Schema.String) },
    Schema.String,
  ),
  command(
    'SwitchAgent',
    { threadId: Schema.String, agentId: Schema.String, model: Schema.optional(Schema.String), effort: Schema.optional(Schema.String) },
    Schema.String,
  ),
  command('SetModel', { threadId: Schema.String, model: Schema.String }, Schema.Void),
  /** How hard the thread's agent thinks, from here on. */
  command('SetEffort', { threadId: Schema.String, effort: Schema.String }, Schema.Void),
  /** Every agent's models and efforts, as far as Charrette knows them. */
  call('GetModels', {}, Schema.Array(AgentModels)),
  /** The person's default effort for one of an agent's models, kept for the profile. */
  command('SetDefaultEffort', { agentId: Schema.String, model: Schema.String, effort: Schema.String }, Schema.Void),
  command('Interrupt', { threadId: Schema.String }, Schema.Void),
  command('StopSession', { threadId: Schema.String }, Schema.Void),
  command('Send', { threadId: Schema.String, body: Schema.String, disposition: Disposition }, Schema.Void),
  /** The person's answer to a step that needs them: tell its agent what to do, hand it to an agent, or abandon it (a review is gone on without). */
  command(
    'AnswerStuck',
    {
      attentionId: Schema.String,
      answer: Schema.Union([
        Schema.Struct({ kind: Schema.Literal('tell'), note: Schema.String }),
        Schema.Struct({ kind: Schema.Literal('retry'), agentId: Schema.String }),
        Schema.Struct({ kind: Schema.Literal('abandon') }),
      ]),
    },
    Schema.Void,
  ),
  command(
    'Answer',
    { attentionId: Schema.String, decision: Schema.Literals(['allow', 'reject']), reason: Schema.optional(Schema.String) },
    Schema.Void,
  ),
  /** The connections on this Mac, and the code hosts and trackers a person can connect. */
  Rpc.make('ListConnections', { success: ConnectionList, error: ApiError }),
  /** Starts the service's own sign-in: a code to type on its page, or a page to approve in the browser. */
  command('StartSignIn', { product: Product, webUrl: Schema.optional(Schema.String) }, SignInStart),
  /** How a sign-in stands. */
  call('GetSignIn', { flowId: Schema.String }, SignInState),
  command('CancelSignIn', { flowId: Schema.String }, Schema.Void),
  /** Connects with a token the person pasted, which goes to the keychain. */
  command(
    'ConnectToken',
    { product: Product, webUrl: Schema.optional(Schema.String), user: Schema.optional(Schema.String), token: Schema.String },
    ConnectionSummary,
  ),
  command('Disconnect', { connectionId: Schema.String }, Schema.Void),
  /** The person's open issues on the connected trackers, and in the project's repository. */
  call('ListIssues', { projectId: Schema.String }, IssueList),
  /** Marks the task's draft pull request ready for review. */
  command('MarkReady', { taskId: Schema.String }, Schema.Void),
  /**
   * Adds an account to an agent: the folder a grant names, as another tool
   * made it, or, without one, a folder Charrette makes, to sign in to.
   */
  command('AddAccount', { agentId: Schema.String, name: Schema.String, grant: Schema.optional(Schema.String) }, AccountStatus),
  command('RenameAccount', { accountId: Schema.String, name: Schema.String }, Schema.Void),
  /** Stops using an account; its folder, with its sign-in, stays. Not the agent's usual one. */
  command('RemoveAccount', { accountId: Schema.String }, Schema.Void),
  /** Puts an agent's accounts in the person's order: the first that can runs work first. */
  command('OrderAccounts', { agentId: Schema.String, accountIds: Schema.Array(Schema.String) }, Schema.Void),
  /** Folders account switchers keep the agent's accounts in, not added yet. */
  call('FindAccounts', { agentId: Schema.String }, Schema.Struct({ found: Schema.Array(FoundAccount) })),
  /**
   * Opens the agent's own sign-in for the account, in Terminal, where the
   * person signs in: the line it runs, and whether it could open it.
   */
  command('SignInAccount', { accountId: Schema.String }, Schema.Struct({ line: Schema.String, opened: Schema.Boolean })),
  /** What the project does when an agent reaches its usage limit. */
  command('SetUsageLimit', { projectId: Schema.String, policy: Schema.Literals(['move', 'wait']) }, Schema.Void),
  /** Opens the pull request of a task whose work ended on its branch: a draft, as the person said. */
  command('OpenChange', { taskId: Schema.String }, Schema.Void),
  /**
   * Merges the task's pull request at the head the person saw, because they
   * said to; a draft is marked ready first. A pull request that moved on
   * since isn't merged. Agents never merge.
   */
  command('Merge', { taskId: Schema.String, head: Schema.String }, Schema.Void),
  /** Asks the task's pull request for news now. */
  command('RefreshTask', { taskId: Schema.String }, Schema.Void),
  /** What changes after `since`, or from now without it. */
  Rpc.make('Watch', { payload: { since: Schema.optional(Cursor) }, success: WatchEvent, error: ApiError, stream: true }),
)
export type Api = typeof Api
