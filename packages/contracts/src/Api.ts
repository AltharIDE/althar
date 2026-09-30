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

export const AgentStatus = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  signIn: SignIn,
  /** The agent's own command for signing in, when it isn't. */
  login: Schema.String,
})
export type AgentStatus = typeof AgentStatus.Type

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
  content: Schema.Struct({ text: Schema.String }),
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
    step: Schema.Literals(['implement', 'review', 'settle']),
    /** The review round, from 0. */
    round: Schema.Number,
    summary: Schema.String,
    verdict: Schema.NullOr(Schema.Literals(['pass', 'changes_requested'])),
    findings: Schema.Array(Finding),
    /** Who reported it, for a review. */
    agentId: Schema.NullOr(Schema.String),
  }),
})

/** A step of a task's plan: which kind, who does it, and whether it is skipped. For now only Implement and Review. */
export const PlanStep = Schema.Struct({
  key: Schema.Literals(['implement', 'review']),
  agentId: Schema.String,
  model: Schema.NullOr(Schema.String),
  skipped: Schema.Boolean,
})
export type PlanStep = typeof PlanStep.Type

/** Where a task stands, as the coordinator's thread shows it. */
export const TaskPhase = Schema.Literals(['planned', 'held', 'running', 'waiting', 'ready', 'stopped', 'settled'])
export type TaskPhase = typeof TaskPhase.Type

/**
 * A task in the coordinator's thread: its plan before it starts, with the
 * time it starts on its own, then its card as it runs. Charrette posts it and
 * keeps it current; no agent writes it.
 */
export const TaskItem = Schema.Struct({
  ...itemFields,
  kind: Schema.Literal('task'),
  content: Schema.Struct({
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
      }),
    ),
    /** The step it is on, by key, while it runs. */
    step: Schema.NullOr(Schema.String),
    /** The latest summary the lead reported. */
    summary: Schema.NullOr(Schema.String),
    /** The agent that leads it, or last did: the plan's lead until one starts. */
    lead: Schema.NullOr(Schema.String),
    branch: Schema.NullOr(Schema.String),
    startedAt: Schema.NullOr(Schema.String),
  }),
})

export const ThreadItem = Schema.Union([UserMessageItem, AgentTextItem, ToolCallItem, PlanItem, NoticeItem, StepResultItem, TaskItem])
export type ThreadItem = typeof ThreadItem.Type

export const SessionSummary = Schema.Struct({
  id: Schema.String,
  agentId: Schema.String,
  agentName: Schema.String,
  state: Schema.String,
  model: Schema.NullOr(Schema.String),
  /** The models the agent offers for this session. */
  models: Schema.Array(Schema.String),
  turnRunning: Schema.Boolean,
})
export type SessionSummary = typeof SessionSummary.Type

export const AttentionRequest = Schema.Struct({
  id: Schema.String,
  /** What the agent wants to do, as it put it. */
  title: Schema.String,
  /** Why it waits for the person: the rule that keeps it for them. */
  reason: Schema.String,
  command: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
})
export type AttentionRequest = typeof AttentionRequest.Type

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
  }),
  session: Schema.NullOr(SessionSummary),
  attention: Schema.Array(AttentionRequest),
  /** The newest items before the page's start, oldest first. */
  items: Schema.Array(ThreadItem),
  /** There are items before these. */
  earlier: Schema.Boolean,
})
export type ThreadSnapshot = typeof ThreadSnapshot.Type

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
  /** The agent and model it starts on: whatever you used last. Unavailable when that agent isn't signed in. */
  suggested: Schema.NullOr(
    Schema.Struct({ agentId: Schema.String, agentName: Schema.String, model: Schema.NullOr(Schema.String), available: Schema.Boolean }),
  ),
  items: Schema.Array(ThreadItem),
  earlier: Schema.Boolean,
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
  command('CreateTask', { projectId: Schema.String, title: Schema.String, description: Schema.optional(Schema.String) }, TaskSummary),
  /** The thread, with the newest `limit` items before `before` (a sequence), or none with `limit: 0`. */
  call('GetThread', { threadId: Schema.String, before: Schema.optional(Schema.Int), limit }, ThreadSnapshot),
  call('GetThreadItem', { threadId: Schema.String, itemId: Schema.String }, ThreadItem),
  /** The project's coordinator thread, made the first time it is asked for. */
  call('GetCoordinator', { projectId: Schema.String, before: Schema.optional(Schema.Int), limit }, CoordinatorSnapshot),
  /** Starts a task you planned yourself: it shows in the coordinator's thread like one it planned, and starts at once. */
  command(
    'StartTask',
    { projectId: Schema.String, title: Schema.String, description: Schema.optional(Schema.String), steps: Schema.Array(PlanStep) },
    TaskSummary,
  ),
  /** Starts a planned task now, rather than when its time runs out. */
  command('StartPlan', { planId: Schema.String }, Schema.Void),
  /** Holds a planned task: it waits until you start it. */
  command('HoldPlan', { planId: Schema.String }, Schema.Void),
  /** Changes who does a planned task's steps, or skips one, before it starts. */
  command('ChangePlan', { planId: Schema.String, steps: Schema.Array(PlanStep) }, Schema.Void),
  command('StartSession', { threadId: Schema.String, agentId: Schema.String, model: Schema.optional(Schema.String) }, Schema.String),
  command('SwitchAgent', { threadId: Schema.String, agentId: Schema.String, model: Schema.optional(Schema.String) }, Schema.String),
  command('SetModel', { threadId: Schema.String, model: Schema.String }, Schema.Void),
  command('Interrupt', { threadId: Schema.String }, Schema.Void),
  command('StopSession', { threadId: Schema.String }, Schema.Void),
  command('Send', { threadId: Schema.String, body: Schema.String, disposition: Disposition }, Schema.Void),
  command(
    'Answer',
    { attentionId: Schema.String, decision: Schema.Literals(['allow', 'reject']), reason: Schema.optional(Schema.String) },
    Schema.Void,
  ),
  /** What changes after `since`, or from now without it. */
  Rpc.make('Watch', { payload: { since: Schema.optional(Cursor) }, success: WatchEvent, error: ApiError, stream: true }),
)
export type Api = typeof Api
