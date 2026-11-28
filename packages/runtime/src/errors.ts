import { Schema } from 'effect'

import { gitSummary } from './gitSaid'

/**
 * A git command failed: what git wrote to stderr, never the command line in
 * its place. Where it wrote nothing, how it ended says why: its exit code, the
 * signal that stopped it, or that it ran past its time and Althar stopped waiting
 * (`timedOut`, after `timeout` milliseconds), with cancellation requested. `reason` is for a process or
 * output limit Althar itself stopped, never something git wrote.
 */
export class GitFailed extends Schema.TaggedError<GitFailed>()('GitFailed', {
  args: Schema.Array(Schema.String),
  cwd: Schema.String,
  stderr: Schema.String,
  reason: Schema.optional(Schema.String),
  code: Schema.optional(Schema.Number),
  signal: Schema.optional(Schema.String),
  timedOut: Schema.optional(Schema.Boolean),
  timeout: Schema.optional(Schema.Number),
}) {
  /** What git said, in a line with no secret in it, so a pretty-printed cause, as a log's, says it after `GitFailed:`. */
  override get message() {
    return gitSummary(this)
  }
}

/** The folder opened as a project is not inside a git repository. */
export class NotARepository extends Schema.TaggedError<NotARepository>()('NotARepository', {
  path: Schema.String,
}) {}

/** A new repository can't be made where the person chose: a folder of its name is there already, or the name makes no folder. */
export class RepositoryRefused extends Schema.TaggedError<RepositoryRefused>()('RepositoryRefused', {
  reason: Schema.Literals(['taken', 'no_name']),
  /** The folder it would be. */
  name: Schema.String,
  /** The folder it would be in. */
  parent: Schema.String,
}) {}

/**
 * A folder Althar won't make a project's repository of as it is: one it
 * can't read; one too wide to be one project, the home folder or the disk's
 * root; one with more files than a repository should start with (`count`);
 * one with git repositories inside it already (`names`), which git would
 * take in as empty links; one with a .git git can't read (`broken_repository`),
 * left as it is; or the folder a clone would go in, there already
 * with something in it.
 */
export class FolderRefused extends Schema.TaggedError<FolderRefused>()('FolderRefused', {
  reason: Schema.Literals(['unreadable', 'too_wide', 'too_many', 'repositories_inside', 'broken_repository', 'taken']),
  path: Schema.String,
  count: Schema.optional(Schema.Number),
  names: Schema.optional(Schema.Array(Schema.String)),
}) {}

/**
 * A repository that couldn't be cloned: its host wants the person signed in
 * to its organization's single sign-on first (`url`, where they can); it
 * isn't there, or the sign-in can't see it; or git failed otherwise
 * (`detail`, its words).
 */
export class CloneRefused extends Schema.TaggedError<CloneRefused>()('CloneRefused', {
  reason: Schema.Literals(['sso', 'not_found', 'failed']),
  /** The repository, as its host names it: northwind/app. */
  remote: Schema.String,
  /** Its host's name: GitHub. */
  host: Schema.String,
  url: Schema.optional(Schema.String),
  detail: Schema.optional(Schema.String),
}) {}

/**
 * A project's repository that can't be put on a host: it has a remote
 * already (`remote`); one of that name is there already, with something in
 * it; or it was made there and pushing to it failed (`detail`), which trying
 * again picks up from.
 */
export class PublishRefused extends Schema.TaggedError<PublishRefused>()('PublishRefused', {
  reason: Schema.Literals(['has_remote', 'taken', 'push_failed']),
  remote: Schema.String,
  host: Schema.String,
  detail: Schema.optional(Schema.String),
}) {}

/** A task in a project of several repositories that names none, or one the project doesn't have: `choices` are the ones it has. */
export class RepositoriesNeeded extends Schema.TaggedError<RepositoriesNeeded>()('RepositoriesNeeded', {
  unknown: Schema.Array(Schema.String),
  choices: Schema.Array(Schema.String),
}) {}

/** A branch to work toward (ADR-093) that a repository's remote doesn't have, nor its clone here. */
export class BranchNotFound extends Schema.TaggedError<BranchNotFound>()('BranchNotFound', {
  branch: Schema.String,
  repository: Schema.String,
}) {}

/** A branch the person asked Althar to make that it couldn't (ADR-093): why, in words for them. */
export class BranchRefused extends Schema.TaggedError<BranchRefused>()('BranchRefused', {
  message: Schema.String,
}) {}

/**
 * A change to a project that can't be made: a name that is empty, the
 * project's last repository left out (a task needs one to work in), a role
 * that isn't one, or a pull request target for a repository that isn't a fork.
 */
export class ProjectRefused extends Schema.TaggedError<ProjectRefused>()('ProjectRefused', {
  reason: Schema.Literals(['no_name', 'last_repository', 'no_role', 'not_a_fork', 'no_upstream_access', 'id_taken', 'bad_setup']),
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

/** The coordinator's view has nothing in it to clear. */
export class NothingToClear extends Schema.TaggedError<NothingToClear>()('NothingToClear', {
  threadId: Schema.String,
}) {}

export class RetryRefused extends Schema.TaggedError<RetryRefused>()('RetryRefused', {}) {}

/** Undo could lose newer work, or has no complete checkpoint to restore. */
export class UndoRefused extends Schema.TaggedError<UndoRefused>()('UndoRefused', {
  message: Schema.String,
  files: Schema.Array(Schema.String),
  why: Schema.optional(Schema.Literals(['edited', 'staged'])),
}) {}

/** The agent could not be started, or its session could not be set up. */
export class SessionFailed extends Schema.TaggedError<SessionFailed>()('SessionFailed', {
  agentId: Schema.String,
  /** Everything that went wrong, for the log. */
  reason: Schema.String,
  /** What went wrong, in a sentence a person reads. */
  summary: Schema.String,
  /** The model it was asked for, where the agent stopped listing it and still didn't after being asked again a while. */
  modelGone: Schema.optional(Schema.String),
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
 * Shipping a task (a task is a conversation plus parts, "A tweak waits for
 * Ship") can't go as asked: what the person's turns committed is held for
 * Ship, and only Ship pushes it (`held`); the task is at work, and ships once
 * that's done (`working`); or nothing waits to go up (`nothing`).
 */
/** A change the task can't start or change as asked (a task is a conversation plus parts), in words for whoever asked. */
export class ChangeRefused extends Schema.TaggedError<ChangeRefused>()('ChangeRefused', { message: Schema.String }) {}

export class ShipRefused extends Schema.TaggedError<ShipRefused>()('ShipRefused', {
  taskId: Schema.String,
  /**
   * `not_shipping`: no Ship of the task is under way, for RouteShip to change the route of. `merging`: its merge went to
   * its host before RouteShip took it no further than ready.
   */
  why: Schema.Literals(['held', 'working', 'nothing', 'not_shipping', 'merging']),
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
    'nothing',
  ]),
  detail: Schema.String,
  /** The branch it would merge into, named by its repository in a task of several: main, web’s main. */
  into: Schema.optional(Schema.String),
  /** The files in the way, by their path in the repository: those that conflict, have changes not committed, or git doesn't track; or the submodule. */
  files: Schema.optional(Schema.Array(Schema.String)),
}) {}

/**
 * A push its remote won't take: it has commits this one doesn't (`behind`),
 * git couldn't sign in there (`denied`), the account signed in may not push
 * there (`forbidden`), the branch is protected (`protected`), the host
 * couldn't be reached (`unreachable`), it got no answer in time, as while
 * git waits for a sign-in no one can give (`unanswered`), or the remote
 * itself said no, as a hook does (`refused`, with what it said), or git
 * failed in a way none of these says (`failed`, all it said in `detail`). Replacing a
 * pull request's commits also stops where the pull request moved on from
 * the head the person saw (`moved`), and where the project's rules never
 * allow a force push (`never`). A contributor's branch rejects force pushes
 * (`contributor_force_push`) and needs the author's current permission for a
 * plain push (`maintainer_edits_disabled`).
 */
export class PushRefused extends Schema.TaggedError<PushRefused>()('PushRefused', {
  taskId: Schema.String,
  why: Schema.Literals([
    'behind',
    'denied',
    'forbidden',
    'protected',
    'unreachable',
    'unanswered',
    'refused',
    'failed',
    'moved',
    'never',
    'contributor_force_push',
    'maintainer_edits_disabled',
    'fork_gone',
    'unplaced',
    'no_push_address',
  ]),
  /** The branch it follows: origin/main. */
  remote: Schema.String,
  /** What the remote said, for one it refused. */
  said: Schema.optional(Schema.String),
  /** The code host the remote is on, by name, where Althar knows it: GitLab. */
  host: Schema.optional(Schema.String),
  /** All git said and how it ended, for a quiet Details. */
  detail: Schema.optional(Schema.String),
  /** For `protected`, the project's Repository files switches that are off and would let them go. */
  needs: Schema.optional(Schema.Array(Schema.Literals(['writeSkills', 'writeOpenSpec', 'pushProtected']))),
  /**
   * For one Althar pushed with a connection's sign-in, as opening a pull request does: whose it is, how it signs in (a token
   * pasted or taken from gh or glab, or Althar's app), and the repository it was refused for, as its host names it.
   */
  signIn: Schema.optional(
    Schema.Struct({
      account: Schema.String,
      kind: Schema.Literals(['token', 'app']),
      product: Schema.String,
      repository: Schema.String,
      /**
       * Why, where the host established it when asked again: the account's role there, or the sign-in while the account may
       * push. Absent where it didn't say, as when GitHub gives no permissions for the repository.
       */
      cause: Schema.optional(Schema.Literals(['role', 'token'])),
    }),
  ),
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
 * folder isn't ready or isn't on this computer, or can't come back: its
 * branch is gone, or something else is in its place. `name` is its own,
 * where Althar knows it.
 */
export class FileRefused extends Schema.TaggedError<FileRefused>()('FileRefused', {
  reason: Schema.Literals(['too_large', 'too_many_files', 'too_many', 'too_much', 'unreadable', 'missing', 'nowhere', 'gone', 'in_way']),
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
 * Its team doesn't change without a lead in its plan to change.
 */
export class TaskRefused extends Schema.TaggedError<TaskRefused>()('TaskRefused', {
  taskId: Schema.String,
  why: Schema.Literals([
    'merged',
    'branch_gone',
    'abandoned',
    'no_title',
    'title_too_long',
    'folder_in_use',
    'folder_in_way',
    'no_lead',
    'pull_open',
  ]),
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
/**
 * A task's screenshots can't go in a comment on its pull request as asked
 * (ADR-077): its host takes no pictures, there are none to post, or a
 * picture of them is no longer kept. Said in words for the person.
 */
export class ScreenshotsRefused extends Schema.TaggedError<ScreenshotsRefused>()('ScreenshotsRefused', {
  why: Schema.Literals(['no_pictures', 'none', 'unkept']),
  message: Schema.String,
}) {}
