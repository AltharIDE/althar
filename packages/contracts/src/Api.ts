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

export const ThreadItem = Schema.Union([UserMessageItem, AgentTextItem, ToolCallItem, PlanItem, NoticeItem])
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
