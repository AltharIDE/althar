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

/**
 * A change to a project that can't be made: a name that is empty, the
 * project's last repository left out (a task needs one to work in), a role
 * that isn't one, or a pull request target for a repository that isn't a fork.
 */
export class ProjectRefused extends Schema.TaggedError<ProjectRefused>()('ProjectRefused', {
  reason: Schema.Literals(['no_name', 'last_repository', 'no_role', 'not_a_fork']),
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

/** An allow rule for words the project's rules ask about or never allow, which come first (ADR-018): it would replace them, or do nothing. */
export class RuleOnAnotherList extends Schema.TaggedError<RuleOnAnotherList>()('RuleOnAnotherList', {
  pattern: Schema.String,
  exact: Schema.Boolean,
  list: Schema.Literals(['ask', 'never']),
}) {}

/** A change made against rules that have moved on since it was read: another change came first, and would be lost. */
export class RulesChanged extends Schema.TaggedError<RulesChanged>()('RulesChanged', {
  projectId: Schema.String,
  revision: Schema.Number,
  expected: Schema.Number,
}) {}

/** An "always" answer by a scope the request wasn't offered: no rule of it would hold (ADR-018). */
export class AlwaysNotOffered extends Schema.TaggedError<AlwaysNotOffered>()('AlwaysNotOffered', {
  attentionId: Schema.String,
  scope: Schema.String,
}) {}

/** The message went to the agent before it could be taken back, or was taken back already. */
export class AlreadyDelivered extends Schema.TaggedError<AlreadyDelivered>()('AlreadyDelivered', {
  itemId: Schema.String,
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

/**
 * A default branch merged here that its remote won't take: it has commits
 * this one doesn't (`behind`), git couldn't sign in there (`denied`), or the
 * remote itself said no, such as a protected branch (`refused`, with what it said).
 */
export class PushRefused extends Schema.TaggedError<PushRefused>()('PushRefused', {
  taskId: Schema.String,
  why: Schema.Literals(['behind', 'denied', 'refused']),
  /** The branch it follows: origin/main. */
  remote: Schema.String,
  /** What the remote said, for one it refused. */
  said: Schema.optional(Schema.String),
}) {}

/** A link given for an issue points at something else on its host: `what` is it, in the host's words ("pull request", "merge request"). */
export class NotAnIssue extends Schema.TaggedError<NotAnIssue>()('NotAnIssue', {
  link: Schema.String,
  what: Schema.String,
}) {}

/** The pull request moved on since the person looked: accepting it would merge what they didn't see. */
export class ChangedSinceSeen extends Schema.TaggedError<ChangedSinceSeen>()('ChangedSinceSeen', {
  taskId: Schema.String,
}) {}

/**
 * A task that can't take that turn in its course: a merged task is done for
 * good, so it is never abandoned or reopened; one whose worktree went with
 * its branch can't be reopened on it; and an abandoned one has no agent on
 * it until it is reopened.
 */
export class TaskRefused extends Schema.TaggedError<TaskRefused>()('TaskRefused', {
  taskId: Schema.String,
  why: Schema.Literals(['merged', 'branch_gone', 'abandoned']),
}) {}
