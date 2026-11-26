import { Schema } from 'effect'
import { RpcGroup } from 'effect/rpc'
import { FeedPosition } from '../identities'
import { KnownArray } from '../open'
import { call, ClientAuthority, command } from './rpc'
import { BoardCall, BoardTask, CheckoutAsk, Cursor, TaskSummary, WorksIn } from './shared'

export const MoveOutcome = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('moved') }),
  Schema.Struct({ kind: Schema.Literal('waits'), why: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal('asks'),
    ask: CheckoutAsk,
    seen: Schema.Struct({ branch: Schema.NullOr(Schema.String), head: Schema.String }),
  }),
])
export type MoveOutcome = typeof MoveOutcome.Type

export const TaskList = Schema.Struct({ cursor: Cursor, position: Schema.optional(FeedPosition), tasks: Schema.Array(TaskSummary) })
export type TaskList = typeof TaskList.Type

/** What a press that settled a card in Needs you did (DEV-173). */
export const OnePressAction = Schema.Literals(['merge', 'push', 'done', 'keep', 'resolve', 'carry_on', 'allow', 'reject'])
export type OnePressAction = typeof OnePressAction.Type

/**
 * A project's board: every task it hasn't settled, and the most recently
 * settled, each with its card; and every call that waits on the person.
 * Which lane each goes in is the window's to say.
 */
export const BoardSnapshot = Schema.Struct({
  cursor: Cursor,
  position: Schema.optional(FeedPosition),
  tasks: Schema.Array(BoardTask),
  calls: KnownArray('kind', [BoardCall]),
  /** How many tasks the project has settled (done or abandoned), in all: `tasks` holds only the most recent of them. */
  settledTotal: Schema.Number,
})
export type BoardSnapshot = typeof BoardSnapshot.Type

/**
 * A task as a whole: listing and making them, the board and its pages, and its lifecycle (stop, resume, abandon, done, reopen, rename, shelve).
 * Where it stands in line and where it works (Up next, start anyway, worktree or Local), and its shape.
 */
export const TasksApi = RpcGroup.make(
  call('ListTasks', { projectId: Schema.String }, TaskList),
  command(
    'CreateTask',
    {
      projectId: Schema.String,
      title: Schema.String,
      description: Schema.optional(Schema.String),
      issue: Schema.optional(Schema.String),
      /** Other issues it comes from, beside issue, on any trackers: each its link or key. */
      issues: Schema.optional(Schema.Array(Schema.String)),
      /** The project's repositories it changes, by name: needed only in a project of several. */
      repositories: Schema.optional(Schema.Array(Schema.String)),
    },
    TaskSummary,
  ),
  /** A project's board: its tasks, by card, and the calls that wait on the person. */
  call('GetBoard', { projectId: Schema.String, cached: Schema.optional(Schema.Boolean) }, BoardSnapshot),
  /** The next page of a project's settled tasks, as cards, older than the one settled at `before` (`taskId` breaking a tie), most recent first. */
  call(
    'GetOlderSettled',
    { projectId: Schema.String, before: Schema.String, taskId: Schema.String },
    Schema.Struct({ tasks: Schema.Array(BoardTask) }),
  ),
  /**
   * The person opened a task's screen. A plain task that finished, with
   * nothing to accept and nothing waiting on them, is done once seen.
   */
  command('SeeTask', { taskId: Schema.String }, Schema.Void),
  /**
   * The person settled a card in Needs you with one press where it shows, the
   * board or the home, not its task's screen (DEV-173): kept on this computer,
   * with whether its task went unopened since the card came in. A call's,
   * by the call; else the task's.
   */
  command(
    'SettledWithOnePress',
    { taskId: Schema.optional(Schema.String), attentionId: Schema.optional(Schema.String), action: OnePressAction },
    Schema.Void,
  ),
  /**
   * Takes a small change out of the fast lane: its change is reviewed before it merges, by the reviewer its plan named,
   * instead of after. The card folds to the line saying what was made.
   */
  command('MakeItAFullTask', { taskId: Schema.String }, Schema.Void),
  /**
   * Puts a task in its project's Up next at a place, from 0 the front, the
   * rest keeping their order; past the end is its end. What continues and
   * the line are one order: a task goes anywhere in it. A plan waiting to
   * start starts, at that place. Places are given in that order, kept after
   * a restart; a task that joins later goes to its end. Nothing moves for a
   * task that isn't up next.
   */
  command('MoveInLine', { taskId: Schema.String, to: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)) }, Schema.Void),
  /** Puts a project's line back in the order its tasks began waiting: the oldest first. */
  command('LineOldestFirst', { projectId: Schema.String }, Schema.Void),
  /**
   * Starts what of a task waits for a place now, whatever is free, as the person's own start, which never waits (ADR-037):
   * Start anyway, on a task held back while this computer lets fewer agents work than the number. False, and nothing
   * changes, where nothing of it waits any more.
   */
  command('StartAnyway', { taskId: Schema.String }, Schema.Boolean),
  /** Stops a task: every agent on it stops, and the step it was on waits until the person resumes it. */
  command('StopTask', { taskId: Schema.String }, Schema.Void),
  /** Allows everything its agents ask on one task, short of what its project never allows; turned on, what waits on the person is decided again. */
  command('SetTaskAllowEverything', { taskId: Schema.String, allowEverything: Schema.Boolean }, Schema.Void),
  /**
   * Carries a stopped task on from the step it was on: with its last lead,
   * or the agent and model given. What the person said before it waits in
   * its thread and is the lead's first word.
   */
  command(
    'ResumeTask',
    {
      taskId: Schema.String,
      agentId: Schema.optional(Schema.String),
      /** Its model and effort: the agent's own where null or left out. */
      model: Schema.optional(Schema.NullOr(Schema.String)),
      effort: Schema.optional(Schema.NullOr(Schema.String)),
    },
    Schema.Void,
  ),
  /** Settles a task without its change: its agents stop and its plan doesn't start; its worktree and branch stay as they are. */
  command('AbandonTask', { taskId: Schema.String }, Schema.Void),
  /**
   * Settles a finished task that isn't a change, as Done: what its agents
   * left running, such as a page, stops. Nothing for a change, or one at work.
   */
  command('MarkTaskDone', { taskId: Schema.String }, Schema.Void),
  /**
   * Takes a finished task that isn't a change out of Needs you as it is,
   * kept for later: nothing stops. Writing to it again brings it back.
   */
  command('KeepTaskForLater', { taskId: Schema.String }, Schema.Void),
  /** Gives a task another title, in any state. Its slug, branch, worktree folder, and the title of a pull request or issue already opened, stay as they are. */
  command('RenameTask', { taskId: Schema.String, title: Schema.String }, Schema.Void),
  /** Opens an abandoned task again, on the same worktree and branch; nothing runs until the person says so. Never a merged one. */
  command('ReopenTask', { taskId: Schema.String }, Schema.Void),
  /**
   * Moves a running task between a worktree and Local, between its lead's turns (a task is a conversation plus parts): moved
   * at once, or waiting, and why, tried again until it can; or asking first, about a checkout on a branch of the person's own,
   * which `consent`, what they were shown, answers.
   */
  command(
    'MoveTask',
    {
      taskId: Schema.String,
      to: WorksIn,
      change: Schema.optional(Schema.NullOr(Schema.String)),
      consent: Schema.optional(Schema.Struct({ branch: Schema.NullOr(Schema.String), head: Schema.String })),
    },
    MoveOutcome,
  ),
  /** Calls off a move that waits: the task stays where it works. */
  command('DropMove', { taskId: Schema.String }, Schema.Void),
  /** Puts a task on Scratch, or on the board with null (a task is a conversation plus parts, "Chats and Scratch"). */
  command('ShelveTask', { taskId: Schema.String, shelf: Schema.NullOr(Schema.Literal('scratch')) }, Schema.Void),
  /**
   * Gives a task another preset's parts at once, as its menu's Make it a change does (a task is a conversation plus parts):
   * its review, its ending, a worktree with its branch where it had none, and where it sits; its lead stays.
   */
  command('ShapeTask', { taskId: Schema.String, preset: Schema.String }, Schema.Void),
).middleware(ClientAuthority)
