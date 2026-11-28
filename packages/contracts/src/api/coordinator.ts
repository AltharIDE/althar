import { Schema } from 'effect'
import { RpcGroup } from 'effect/rpc'
import { FeedPosition } from '../identities'
import { call, ClientAuthority, command, limit } from './rpc'
import { AccountUse, Cursor, Launch, PlanStep, Product, Runnable, SessionSummary, ThreadItems, TurnTime } from './shared'

/**
 * How the coordinator's thread is read: the person can clear its view, which
 * starts the thread where they cleared it and leaves the conversation to the
 * coordinator and to Show earlier, or forget the conversation altogether.
 */
export const ConversationView = Schema.Struct({
  /** The view was cleared: the thread starts at the clear, with what is still open carried in. */
  cleared: Schema.Boolean,
  /** The conversation before the clear is read in the thread's place. */
  earlierOpen: Schema.Boolean,
  /** The sequence where the cleared view begins; null while the view is whole. An item before it belongs to the earlier conversation. */
  from: Schema.NullOr(Schema.Int),
  /** There is something in the view to clear. */
  clearable: Schema.Boolean,
  /** There is a conversation to forget: its messages, or the session that holds it. */
  forgettable: Schema.Boolean,
  /** Moves on whenever the view is cleared, opened on the earlier conversation or restored, or the conversation is forgotten: pages read before it are of another thread. */
  version: Schema.Int,
})
export type ConversationView = typeof ConversationView.Type

/**
 * A project's coordinator thread: the agent working on it, if one is, the one
 * it would start on, and a page of its items. The coordinator starts when you
 * first say something to it.
 */
export const CoordinatorSnapshot = Schema.Struct({
  threadId: Schema.String,
  /** The runtime's placement for a new message, including work between sessions. */
  accepting: Schema.optional(Schema.Literals(['now', 'queued'])),
  cursor: Cursor,
  position: Schema.optional(FeedPosition),
  /** What the coordinator used today, since this computer's midnight, of each account it ran on (ADR-084). */
  usage: Schema.optional(Schema.Array(AccountUse)),
  project: Schema.Struct({ id: Schema.String, name: Schema.String }),
  session: Schema.NullOr(SessionSummary),
  /** Whether Try again can act now, from the runtime's retry rule. */
  retryable: Schema.optional(Schema.Boolean),
  /** The agent, model and effort it starts on: whatever you used last. Unavailable when that agent isn't signed in. */
  suggested: Schema.NullOr(
    Schema.Struct({
      agentId: Schema.String,
      agentName: Schema.String,
      model: Schema.NullOr(Schema.String),
      effort: Schema.NullOr(Schema.String),
      available: Schema.Boolean,
    }),
  ),
  items: ThreadItems,
  earlier: Schema.Boolean,
  /** Where the time went of each turn its page's items came in, that kept it; absent from a runtime before it. */
  turns: Schema.optional(Schema.Array(TurnTime)),
  view: ConversationView,
  /** Where the project's repository is hosted, when its remote says, and whether Althar is connected to it there. */
  host: Schema.NullOr(Schema.Struct({ product: Product, name: Schema.String, webUrl: Schema.String, connected: Schema.Boolean })),
  /** What the project runs, in its order, the first its default (ADR-044), as run in the default branch's copy; empty where nothing says how. */
  runnables: Schema.Array(Runnable),
  /** What Althar runs of the project's default branch. */
  launches: Schema.Array(Launch),
})
export type CoordinatorSnapshot = typeof CoordinatorSnapshot.Type

/**
 * The coordinator's own thread and the team on a task: its thread, forgetting its conversation, the cards it asks the person.
 * Who leads and reviews, helpers, a task waiting for another, and the branch a task works toward.
 */
export const CoordinatorApi = RpcGroup.make(
  /** The project's coordinator thread, made the first time it is asked for. */
  call('GetCoordinator', { projectId: Schema.String, before: Schema.optional(Schema.Int), limit }, CoordinatorSnapshot),
  /** Stops a task waiting for another (tasks wait for their blockers): where it waits for nothing else, its plan starts as planned. */
  command('StopWaiting', { taskId: Schema.String, on: Schema.String }, Schema.Void),
  /**
   * Changes who leads and who reviews a task at any time before it merges. Its lead changes from its next turn, never in the one it
   * is in; its reviewer until its review round starts, and from the next round during one, not once a review of it ran to its
   * end. A review skipped or never planned can be added until the task merges; where its work is up already, it starts a round.
   * Only supplied steps change; omit untouched steps, and explicitly skip the review step to remove its reviewer.
   */
  command('ChangeTeam', { taskId: Schema.String, steps: Schema.Array(PlanStep) }, Schema.Void),
  /** The person answers the coordinator's card asking to stop, hold, restart or settle a task: yes does it, as their own press would. */
  command('AnswerTaskAsk', { itemId: Schema.String, yes: Schema.Boolean }, Schema.Void),
  /**
   * Ends the coordinator's session and deletes its conversation, so nothing of
   * it can be read again; what is still open, and the project's notes, tasks
   * and errands, stay. Its next session starts from those. It can't be undone.
   */
  command('ForgetConversation', { threadId: Schema.String }, Schema.Void),
  /** Stops a helper the task's lead started, by its id (ADR-087): what it had said stays on its thread. */
  command('StopHelper', { taskId: Schema.String, helper: Schema.String }, Schema.Void),
  /**
   * Points a running task at another branch to work toward, or its default with null (a task is a conversation plus parts):
   * rebased where nothing is pushed, else onto a fresh branch whose pull request opens into it. What it did, in words.
   */
  command('WorkToward', { taskId: Schema.String, toward: Schema.NullOr(Schema.String) }, Schema.Array(Schema.String)),
).middleware(ClientAuthority)
