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
  reason: Schema.Literals(['no_name', 'last_repository', 'no_role', 'not_a_fork', 'id_taken']),
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

/** An answer to a question that leaves one of its questions unanswered: no option picked and no words. */
export class QuestionUnanswered extends Schema.TaggedError<QuestionUnanswered>()('QuestionUnanswered', {
  attentionId: Schema.String,
  field: Schema.String,
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

/** Waiting for a reset, for a call that has none to wait for: only a step a usage limit stopped, where its reset is known, can wait. */
export class NothingToWaitFor extends Schema.TaggedError<NothingToWaitFor>()('NothingToWaitFor', {
  attentionId: Schema.String,
}) {}

/** Handing over a step held for a usage limit, for a task with none: it carried on at the reset, or was stopped, meanwhile. */
export class NotHeld extends Schema.TaggedError<NotHeld>()('NotHeld', {
  taskId: Schema.String,
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
 * A task's pull request opens once its work is done, and another once its
 * last merged or closed with commits after it (ADR-034): it is still
 * working, its work stopped short, it is settled, it has one open, its
 * branch has nothing that isn't in one, what the lead changed isn't all
 * committed, or its new commits conflict with the default branch. `detail`
 * says which files, for the last two.
 */
export class NoChangeToOpen extends Schema.TaggedError<NoChangeToOpen>()('NoChangeToOpen', {
  taskId: Schema.String,
  why: Schema.Literals(['working', 'settled', 'opened', 'nothing', 'uncommitted', 'conflicts']),
  detail: Schema.optional(Schema.String),
}) {}

/**
 * A task's branch can't be merged here: it has a pull request to merge
 * instead, it's settled, what the person saw isn't on its branch any more,
 * it conflicts (and, where the project says so, the lead is resolving it),
 * or the default branch is checked out with changes not committed to files
 * the merge changes, or with changes in a submodule the merge moves, or
 * either could not be read. `detail` says where, and `into` and `files` say
 * it in a few words.
 */
export class CantMerge extends Schema.TaggedError<CantMerge>()('CantMerge', {
  taskId: Schema.String,
  why: Schema.Literals([
    'pull_request',
    'settled',
    'changed',
    'conflicts',
    'resolving',
    'busy',
    'submodule',
    'unreadable',
    'untracked',
    'moved',
    'missing',
  ]),
  detail: Schema.String,
  /** The branch it would merge into, named by its repository in a task of several: main, web’s main. */
  into: Schema.optional(Schema.String),
  /** The files in the way, by their path in the repository: those that conflict, have changes not committed, or git doesn't track; or the submodule. */
  files: Schema.optional(Schema.Array(Schema.String)),
}) {}

/**
 * A push its remote won't take: it has commits this one doesn't (`behind`),
 * git couldn't sign in there (`denied`), or the remote itself said no, such
 * as a protected branch (`refused`, with what it said). Replacing a pull
 * request's commits also stops where the pull request moved on from the
 * head the person saw (`moved`), and where the project's rules never allow
 * a force push (`never`).
 */
export class PushRefused extends Schema.TaggedError<PushRefused>()('PushRefused', {
  taskId: Schema.String,
  why: Schema.Literals(['behind', 'denied', 'refused', 'moved', 'never', 'protected']),
  /** The branch it follows: origin/main. */
  remote: Schema.String,
  /** What the remote said, for one it refused; for `protected`, the skill or OpenSpec paths that were held back. */
  said: Schema.optional(Schema.String),
  /** For `protected`, the project's Repository files switches that are off and would let them go. */
  needs: Schema.optional(Schema.Array(Schema.Literals(['writeSkills', 'writeOpenSpec', 'pushProtected']))),
}) {}

/**
 * A pull request can't be attached to the task (ADR-052), in words for the
 * person or the coordinator: it isn't one, it's closed, its branch is
 * somewhere the task doesn't push to, another task follows it, or its
 * branch couldn't start from its head.
 */
export class AttachRefused extends Schema.TaggedError<AttachRefused>()('AttachRefused', {
  taskId: Schema.String,
  message: Schema.String,
}) {}

/** A link given for an issue points at something else on its host: `what` is it, in the host's words ("pull request", "merge request"). */
export class NotAnIssue extends Schema.TaggedError<NotAnIssue>()('NotAnIssue', {
  link: Schema.String,
  what: Schema.String,
}) {}

/**
 * The pull request moved on since the person looked: accepting it would merge
 * what they didn't see. Or, for a push (`branch`), the commit they saw isn't
 * on the task's branch any more: pushing would send what they didn't see.
 * Or, for a finished task's folder (`folder`), more of what is in it would
 * be lost with it than the person was told as they chose to remove it.
 */
export class ChangedSinceSeen extends Schema.TaggedError<ChangedSinceSeen>()('ChangedSinceSeen', {
  taskId: Schema.String,
  what: Schema.optional(Schema.Literals(['branch', 'folder'])),
}) {}

/**
 * A document the window asked for that Althar won't read: a file that isn't
 * markdown, one outside the task's worktrees, or one too large to show.
 */
export class DocumentRefused extends Schema.TaggedError<DocumentRefused>()('DocumentRefused', {
  path: Schema.String,
  reason: Schema.Literals(['not_markdown', 'outside', 'too_large']),
}) {}

/**
 * An image sent with a message that Althar won't send: a kind other than
 * PNG, JPEG, GIF or WebP, one larger than a message's images may be, more
 * images than a message carries, one kept before that isn't there any more,
 * or none of them kept, where there is nowhere to keep them. `name` is the
 * image's, where it had one.
 */
export class ImageRefused extends Schema.TaggedError<ImageRefused>()('ImageRefused', {
  reason: Schema.Literals(['unsupported', 'too_large', 'too_many', 'missing', 'unkept']),
  name: Schema.NullOr(Schema.String),
}) {}

/**
 * A file or folder sent with a message that Althar won't send: one larger
 * than a message's files may be, a folder of more files than that, more files
 * than a message carries or more bytes all together, one Althar can't read, one kept before that isn't
 * there any more, or one with nowhere to be copied to, as for a task whose
 * folder isn't ready or isn't on this computer. `name` is its own, where
 * Althar knows it.
 */
export class FileRefused extends Schema.TaggedError<FileRefused>()('FileRefused', {
  reason: Schema.Literals(['too_large', 'too_many_files', 'too_many', 'too_much', 'unreadable', 'missing', 'nowhere']),
  name: Schema.NullOr(Schema.String),
}) {}

/**
 * A task that can't take that turn in its course: a merged task is done for
 * good, so it is never abandoned or reopened; one whose worktree went with
 * its branch can't be reopened on it; and an abandoned one has no agent on
 * it until it is reopened. A title can't be empty or longer than a title may be.
 * And a finished task isn't done while what its agents left running, such as
 * a page, wouldn't stop. Its folder isn't removed by hand while something
 * runs from it, and doesn't come back where something else is in its place.
 */
export class TaskRefused extends Schema.TaggedError<TaskRefused>()('TaskRefused', {
  taskId: Schema.String,
  why: Schema.Literals(['merged', 'branch_gone', 'abandoned', 'no_title', 'title_too_long', 'folder_in_use', 'folder_in_way']),
}) {}

/** A finished task's folder that couldn't be removed: its last commit couldn't be kept, or something of it is left (ADR-056). */
export class FolderStayed extends Schema.TaggedError<FolderStayed>()('FolderStayed', {
  path: Schema.String,
}) {}

/** gh or glab didn't get to say whether it is signed in: it timed out, or couldn't be started. */
export class CliUnanswered extends Schema.TaggedError<CliUnanswered>()('CliUnanswered', {
  tool: Schema.String,
  message: Schema.String,
}) {}

/** A skills store operation that couldn't be done, in words for the person, is `@althar/skills`' own `SkillRefused`. */
export { SkillRefused } from '@althar/skills'
