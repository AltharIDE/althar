import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'
import { CodeLine } from './internal'
import { call, ClientAuthority, command, SocketAllowed, socketCanCall } from './rpc'
import { ApiError, Launch, OutputText, ShownTerminal } from './shared'

/** An open pull request the Run menu offers to run (ADR-066). */
export const OfferedPullRequest = Schema.Struct({
  number: Schema.Number,
  /** As its host writes it: PR #12, MR !12. */
  name: Schema.String,
  title: Schema.String,
  branch: Schema.String,
  author: Schema.NullOr(Schema.String),
  draft: Schema.Boolean,
  /** Its branch is on a fork. */
  fork: Schema.Boolean,
})
export type OfferedPullRequest = typeof OfferedPullRequest.Type

/** What one of a project's repositories offers to run, as its remote has it now: its open pull requests, then its branches. */
export const OfferedRefs = Schema.Struct({
  repository: Schema.String,
  pullRequests: Schema.Array(OfferedPullRequest),
  /** By name, its default first. */
  branches: Schema.Array(Schema.String),
  /** Why it lists less than it might, in words; null where it lists all. */
  note: Schema.NullOr(Schema.String),
  /** The host of its remote, by name, where no connection of Althar's reaches it: its pull requests aren't listed until one does. Null where one does, or it has no remote. */
  unconnected: Schema.NullOr(Schema.String),
  /** Its host has more open pull requests than it listed: asked again with words, it searches them there. */
  more: Schema.Boolean,
})
export type OfferedRefs = typeof OfferedRefs.Type

/** A script in one of a project's package.json files, as Althar would run it from its repository's root. */
export const RepositoryScript = Schema.Struct({
  /** The repository it is in, by name. */
  repository: Schema.String,
  /** The package it is in: `althar` at the root, `@althar/ui` in a workspace. */
  package: Schema.String,
  name: Schema.String,
  /** What the script itself says: `storybook dev --port 6006 --no-open`. */
  body: Schema.String,
  /** The command that runs it: `bun --filter @althar/ui storybook`. */
  command: Schema.String,
})
export type RepositoryScript = typeof RepositoryScript.Type

/** What a terminal prints, as it comes: what it printed so far first, then each piece; and once, how its shell ended. */
export const TerminalChunk = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Data'), data: Schema.String }),
  Schema.Struct({ _tag: Schema.Literal('Exit'), code: Schema.Number }),
])
export type TerminalChunk = typeof TerminalChunk.Type

const TerminalSize = Schema.Int.check(Schema.isBetween({ minimum: 2, maximum: 2_000 }))

/**
 * What Althar runs or opens on this computer for a project: runnables, scripts, launches and their output, terminals.
 * What a session left running in the background, and opening a task's files in an editor.
 */
export const LaunchesApi = RpcGroup.make(
  /** What a command a thread's session left running has printed so far, while its session lives. */
  call('ReadBackgroundOutput', { threadId: Schema.String, id: Schema.String }, OutputText),
  /** The editors on this device a task's files open in, by the name people know them. */
  call('ListEditors', {}, Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String }))),
  /** Opens a task's folder in an editor, at one of its files and a line where given; whether it could. The path is the task's, as its changes list it. */
  command(
    'OpenInEditor',
    { taskId: Schema.String, editor: Schema.String, path: Schema.optional(Schema.String), line: Schema.optional(Schema.Number) },
    Schema.Boolean,
  ),
  /**
   * Opens a file a thread's agent named in an editor, at a line where given,
   * by its path as FindCode named it: a task's in the task's folder, the
   * coordinator's in the person's own checkout of its repository, the folder
   * alone where the file isn't there. Whether it could.
   */
  command(
    'OpenCode',
    { threadId: Schema.String, editor: Schema.String, path: Schema.String, line: Schema.optional(CodeLine) },
    Schema.Boolean,
  ),
  /** Stops a command the session on a thread left running; it goes from the list. */
  command('StopBackground', { threadId: Schema.String, id: Schema.String }, Schema.Void),
  /** Clears one that ended by itself from the list. */
  command('ClearBackground', { threadId: Schema.String, id: Schema.String }, Schema.Void),
  /**
   * Runs one of the project's runnables with no agent, its default without
   * one: what the task built, in its worktree, or, with no task, a copy of the
   * default branch, or of the branch or pull request named, which Althar
   * fetches first (ADR-066). One already running there is the one returned.
   */
  command(
    'RunProject',
    {
      projectId: Schema.String,
      taskId: Schema.NullOr(Schema.String),
      /** The thread it was asked for in, where its card goes; null for none. */
      threadId: Schema.NullOr(Schema.String),
      runnableId: Schema.optional(Schema.String),
      /** A branch on the repository's remote, by name. */
      branch: Schema.optional(Schema.String),
      /** A pull request, by its number or link. */
      pullRequest: Schema.optional(Schema.String),
      repository: Schema.optional(Schema.String),
    },
    Launch,
  ),
  /**
   * What the project's repositories offer to run besides their default
   * branch, asked of their remotes now: open pull requests, then branches.
   * With words, only the open pull requests whose titles have them, searched
   * on the host, for one past those a first listing had room for.
   */
  call('GetRunnableRefs', { projectId: Schema.String, text: Schema.optional(Schema.String) }, Schema.Array(OfferedRefs)),
  /**
   * Keeps something for the project to run (ADR-044): a new one, at the end
   * of the list, or, by id, a change to one. A null command is the
   * repository's own way to run. In a project of several repositories, say
   * which; the first otherwise.
   */
  command(
    'KeepRunnable',
    {
      projectId: Schema.String,
      id: Schema.optional(Schema.String),
      name: Schema.NullOr(Schema.String),
      command: Schema.NullOr(Schema.String),
      repository: Schema.optional(Schema.String),
    },
    Schema.Struct({ id: Schema.String }),
  ),
  /** Drops one of the project's runnables; one running goes on until stopped. */
  command('DropRunnable', { projectId: Schema.String, id: Schema.String }, Schema.Void),
  /** Puts the project's runnables in the person's order: the first is its default. */
  command('OrderRunnables', { projectId: Schema.String, ids: Schema.Array(Schema.String) }, Schema.Void),
  /** The scripts in the project's package.json files, to pick something to run from; its repositories as they are here. */
  call('GetRepositoryScripts', { projectId: Schema.String }, Schema.Array(RepositoryScript)),
  /** Stops a run of the project; it goes from the list. */
  command('StopLaunch', { id: Schema.String }, Schema.Void),
  /** Clears a run that ended by itself from the list. */
  command('ClearLaunch', { id: Schema.String }, Schema.Void),
  /** What a run of the project has printed so far, the end of it; readable a while after it leaves the list, while Althar runs. */
  call('ReadLaunchOutput', { id: Schema.String }, OutputText),
  /**
   * Opens a terminal, by the id the client gave it, so the client shows it
   * at once: in the folder the run named ran in, else in the task's
   * worktree, else in the project's repository. One by that id already open
   * is the one returned.
   */
  command(
    'OpenTerminal',
    {
      id: Schema.String.check(Schema.isPattern(/^term_[A-Za-z0-9_-]{6,64}$/)),
      projectId: Schema.String,
      taskId: Schema.NullOr(Schema.String),
      launchId: Schema.optional(Schema.String),
      cols: TerminalSize,
      rows: TerminalSize,
    },
    ShownTerminal,
  ),
  /** The project's terminals, in the order they opened. */
  call('ListTerminals', { projectId: Schema.String }, Schema.Array(ShownTerminal)),
  /** What Althar runs of the project itself, its tasks' too, in the order they started. */
  call('ListLaunches', { projectId: Schema.String }, Schema.Array(Launch)),
  /** What a terminal prints: what it printed so far, kept to its end, then each piece as it comes, until it ends or is closed. */
  Rpc.make('AttachTerminal', { payload: { id: Schema.String }, success: TerminalChunk, error: ApiError, stream: true }).annotate(
    SocketAllowed,
    socketCanCall('AttachTerminal'),
  ),
  /** What the person typed or pasted into a terminal, as its keys send it. */
  call('WriteTerminal', { id: Schema.String, data: Schema.String.check(Schema.isMaxLength(1_000_000)) }, Schema.Void),
  /** A terminal's new size, in characters. */
  call('ResizeTerminal', { id: Schema.String, cols: TerminalSize, rows: TerminalSize }, Schema.Void),
  /** Closes a terminal, stopping its shell and whatever runs in it. */
  command('CloseTerminal', { id: Schema.String }, Schema.Void),
).middleware(ClientAuthority)
