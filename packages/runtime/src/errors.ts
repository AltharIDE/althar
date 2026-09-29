import { Schema } from 'effect'

/** A git command failed. */
export class GitFailed extends Schema.TaggedError<GitFailed>()('GitFailed', {
  args: Schema.Array(Schema.String),
  cwd: Schema.String,
  stderr: Schema.String,
}) {}

/** The folder opened as a project is not inside a git repository. */
export class NotARepository extends Schema.TaggedError<NotARepository>()('NotARepository', {
  path: Schema.String,
}) {}

/** Something the caller named does not exist. */
export class NotFound extends Schema.TaggedError<NotFound>()('NotFound', {
  kind: Schema.String,
  id: Schema.String,
}) {}

/** The runtime has no agent by that id. */
export class UnknownAgent extends Schema.TaggedError<UnknownAgent>()('UnknownAgent', {
  agentId: Schema.String,
}) {}

/** A thread already has a session running; a thread runs one at a time. */
export class SessionRunning extends Schema.TaggedError<SessionRunning>()('SessionRunning', {
  threadId: Schema.String,
}) {}

/** The thread has no session running. */
export class NoSession extends Schema.TaggedError<NoSession>()('NoSession', {
  threadId: Schema.String,
}) {}

/** The agent could not be started, or its session could not be set up. */
export class SessionFailed extends Schema.TaggedError<SessionFailed>()('SessionFailed', {
  agentId: Schema.String,
  reason: Schema.String,
}) {}

/** The attention request has already been answered, or was withdrawn. */
export class AttentionClosed extends Schema.TaggedError<AttentionClosed>()('AttentionClosed', {
  attentionId: Schema.String,
}) {}
