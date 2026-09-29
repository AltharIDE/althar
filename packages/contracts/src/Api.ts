import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

/*
 * What a client can ask the runtime (docs/architecture/02): commands that
 * change state, queries that return what a screen shows, and one stream of
 * what changes. Everything is a schema, checked on both sides of the port.
 * Queries return projections shaped for screens, never tables.
 */

/** Bumped when a change would break a client built against an older API. */
export const API_VERSION = 1

export class ApiError extends Schema.TaggedError<ApiError>()('ApiError', {
  /** What kind of failure: the runtime's error tag, such as `NotARepository` or `SessionFailed`. */
  reason: Schema.String,
  message: Schema.String,
}) {}

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

export const ItemKind = Schema.Literals(['user_message', 'agent_message', 'agent_thought', 'tool_call', 'plan', 'step_result', 'notice'])
export type ItemKind = typeof ItemKind.Type

export const ThreadItem = Schema.Struct({
  id: Schema.String,
  sequence: Schema.Number,
  kind: ItemKind,
  /** The item's content as recorded: `{ text }` for messages, `{ title, kind, status, … }` for a tool call. */
  content: Schema.Unknown,
  /** Which agent said it, for what agents say. */
  agentId: Schema.NullOr(Schema.String),
  toolCallId: Schema.NullOr(Schema.String),
  /** For what the person said: where it stands with the lead, and whether it was sent to interrupt. */
  input: Schema.NullOr(Schema.Struct({ state: Schema.Literals(['queued', 'delivered', 'superseded']), interrupting: Schema.Boolean })),
  createdAt: Schema.String,
})
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

export const TurnSummary = Schema.Struct({
  id: Schema.String,
  state: Schema.String,
  errorClass: Schema.NullOr(Schema.String),
  requestedAt: Schema.String,
  endedAt: Schema.NullOr(Schema.String),
})
export type TurnSummary = typeof TurnSummary.Type

export const ThreadSnapshot = Schema.Struct({
  threadId: Schema.String,
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
  items: Schema.Array(ThreadItem),
  attention: Schema.Array(AttentionRequest),
  turns: Schema.Array(TurnSummary),
})
export type ThreadSnapshot = typeof ThreadSnapshot.Type

/**
 * What changes, as it happens. `Changed` says a record changed, from the
 * store's change feed: a client refetches what shows it. `Streaming` is an
 * agent's message or thought as far as it has come, whole each time, before
 * the store has all of it: a client shows it in place of the item's text.
 */
export const WatchEvent = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal('Changed'),
    aggregateType: Schema.String,
    aggregateId: Schema.String,
    projectId: Schema.NullOr(Schema.String),
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

export const Api = RpcGroup.make(
  Rpc.make('Status', { success: Status, error: ApiError }),
  Rpc.make('ListProjects', { success: Schema.Array(ProjectSummary), error: ApiError }),
  call('OpenProject', { path: Schema.String }, ProjectSummary),
  call('ListTasks', { projectId: Schema.String }, Schema.Array(TaskSummary)),
  call('CreateTask', { projectId: Schema.String, title: Schema.String, description: Schema.optional(Schema.String) }, TaskSummary),
  call('GetThread', { threadId: Schema.String }, ThreadSnapshot),
  call('StartSession', { threadId: Schema.String, agentId: Schema.String, model: Schema.optional(Schema.String) }, Schema.String),
  call('SwitchAgent', { threadId: Schema.String, agentId: Schema.String, model: Schema.optional(Schema.String) }, Schema.String),
  call('SetModel', { threadId: Schema.String, model: Schema.String }, Schema.Void),
  call('Interrupt', { threadId: Schema.String }, Schema.Void),
  call('StopSession', { threadId: Schema.String }, Schema.Void),
  call('Send', { threadId: Schema.String, body: Schema.String, disposition: Disposition }, Schema.Void),
  call(
    'Answer',
    { attentionId: Schema.String, decision: Schema.Literals(['allow', 'reject']), reason: Schema.optional(Schema.String) },
    Schema.Void,
  ),
  Rpc.make('Watch', { success: WatchEvent, error: ApiError, stream: true }),
)
export type Api = typeof Api
