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

/** A task in a project of several repositories that names none, or one the project doesn't have: `choices` are the ones it has. */
export class RepositoriesNeeded extends Schema.TaggedError<RepositoriesNeeded>()('RepositoriesNeeded', {
  unknown: Schema.Array(Schema.String),
  choices: Schema.Array(Schema.String),
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
  /** Everything that went wrong, for the log. */
  reason: Schema.String,
  /** What went wrong, in a sentence a person reads. */
  summary: Schema.String,
}) {}

/** The agent didn't take the effort it was asked for, or offers none; it carries on as it was. */
export class EffortUnchanged extends Schema.TaggedError<EffortUnchanged>()('EffortUnchanged', {
  agentId: Schema.String,
  effort: Schema.String,
  summary: Schema.String,
}) {}

/** The agent didn't take the model it was asked for; it carries on with the one it had. */
export class ModelUnchanged extends Schema.TaggedError<ModelUnchanged>()('ModelUnchanged', {
  agentId: Schema.String,
  model: Schema.String,
  summary: Schema.String,
}) {}

/** The attention request has already been answered, or was withdrawn. */
export class AttentionClosed extends Schema.TaggedError<AttentionClosed>()('AttentionClosed', {
  attentionId: Schema.String,
}) {}

/** An outward action's earlier answer was lost, and doing it again could do it twice: the person checks. */
export class OutwardUncertain extends Schema.TaggedError<OutwardUncertain>()('OutwardUncertain', {
  operation: Schema.String,
}) {}

/**
 * A task's pull request opens once its work is done, once, and while the
 * task is open: it is still working, its work stopped short, it is settled,
 * or it has one.
 */
export class NoChangeToOpen extends Schema.TaggedError<NoChangeToOpen>()('NoChangeToOpen', {
  taskId: Schema.String,
  why: Schema.Literals(['working', 'stopped', 'settled', 'opened']),
}) {}

/**
 * A task's branch can't be merged here: it has a pull request to merge
 * instead, it's settled, what the person saw isn't on its branch any more,
 * it conflicts, or the default branch is checked out with changes not
 * committed. `detail` says where.
 */
export class CantMerge extends Schema.TaggedError<CantMerge>()('CantMerge', {
  taskId: Schema.String,
  why: Schema.Literals(['pull_request', 'settled', 'changed', 'conflicts', 'busy', 'untracked', 'moved', 'missing']),
  detail: Schema.String,
}) {}

/** The pull request moved on since the person looked: accepting it would merge what they didn't see. */
export class ChangedSinceSeen extends Schema.TaggedError<ChangedSinceSeen>()('ChangedSinceSeen', {
  taskId: Schema.String,
}) {}
