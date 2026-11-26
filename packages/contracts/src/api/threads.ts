import { Schema } from 'effect'
import { RpcGroup } from 'effect/rpc'
import { SentCanvasComment } from '../canvases'
import { GoalControl, ThreadGoal } from '../goals'
import { FeedPosition } from '../identities'
import { LineComments } from '../lineComments'
import { KnownArray, KnownOrNull } from '../open'
import { call, ClientAuthority, command, limit } from './rpc'
import {
  AccountUse,
  AfterMergeReview,
  AttachedFile,
  AttentionRequest,
  ChangedFile,
  ChangeSummary,
  CheckoutWait,
  Cursor,
  HeldForConnection,
  HeldForExternal,
  HeldForLimit,
  HeldForShip,
  IssueSummary,
  Launch,
  LinkedTask,
  OutputText,
  Picture,
  PlanStep,
  Product,
  Queued,
  ReviewBrief,
  Runnable,
  SentFiles,
  SentImages,
  SessionSummary,
  ShipRoute,
  TaskBlocker,
  TaskEnd,
  TaskKind,
  TaskPhase,
  TaskRepositoryHere,
  TaskStopped,
  ThreadItem,
  ThreadItems,
  TurnTime,
  Unshipped,
  WorksIn,
} from './shared'

/** The most items one `GetThreadItems` reads. */
export const THREAD_ITEMS_AT_ONCE = 500

/** An issue a task came from: as last seen, and whether the task does only part of it, so its merge comments on it rather than closing it. */
export const TaskIssue = Schema.Struct({
  ...IssueSummary.fields,
  partOf: Schema.optional(Schema.Boolean),
  /** The id of the task's tie to it, which names it alone where two trackers share its key. Absent from a runtime before. */
  link: Schema.optional(Schema.String),
})
export type TaskIssue = typeof TaskIssue.Type

/** Images in the task's collection, independent of how its conversation is paged. */
export const EvidenceGallery = Schema.Struct({
  revision: Schema.Number,
  shots: Schema.Array(
    Schema.Struct({
      key: Schema.String,
      id: Schema.String,
      caption: Schema.String,
      picture: Picture,
      sequence: Schema.optional(Schema.Number),
      reportedAt: Schema.optional(Schema.String),
      needsRefresh: Schema.optional(Schema.Boolean),
      earlier: Schema.optional(Schema.Boolean),
    }),
  ),
})
export type EvidenceGallery = typeof EvidenceGallery.Type

/** A stop on a Ship's route. */
export const ShipStop = Schema.Literals(['review', 'push', 'ready', 'merge'])
export type ShipStop = typeof ShipStop.Type

/**
 * The route Ship takes on a task when pressed without one chosen: the
 * person's own default (Settings' `shipRoute`), else what the task's plan and
 * ending say, bent where the task makes a stop pointless: no review where it
 * has no reviewer (`reviewable` false), and no further than Ready where main
 * needs someone else's approval (`bent`).
 */
export const ShipRouteOf = Schema.Struct({
  route: ShipRoute,
  /** Whether a review can come first: it has a reviewer to run one. */
  reviewable: Schema.Boolean,
  /** Why it goes less far than the person's default, where it does: main needs an approval from someone else. */
  bent: Schema.NullOr(Schema.Literals(['approval'])),
})
export type ShipRouteOf = typeof ShipRouteOf.Type

/** A Ship under way: its route, as chosen or changed since, and the stop it is at. */
export const ShipUnderWay = Schema.Struct({ route: ShipRoute, at: ShipStop })
export type ShipUnderWay = typeof ShipUnderWay.Type

/**
 * What the person can do to a task as a whole, where it stands now, as its
 * menu offers it (docs/architecture/05, "Task and run lifecycle"): start its
 * plan now, stop it, resume what stopping cut short, leave out the commits
 * after its last pull request that are in none yet (ADR-034), abandon it, or
 * reopen it once abandoned. A merged task has none, but leaving those out.
 */
export const TaskAction = Schema.Literals(['start', 'stop', 'resume', 'leaveOut', 'abandon', 'reopen'])
export type TaskAction = typeof TaskAction.Type

/** A repository a task merged into its default branch here, and how that branch stands with its remote. */
export const TaskRepositoryMerged = Schema.Struct({
  repository: Schema.String,
  name: Schema.String,
  branch: Schema.String,
  /** The branch it follows there: origin/main. */
  remote: Schema.NullOr(Schema.String),
  /** Commits on the branch here the remote doesn't have. */
  ahead: Schema.Number,
})
export type TaskRepositoryMerged = typeof TaskRepositoryMerged.Type

/**
 * Where a step of a task's graph stands: done; running (an agent on it); waiting (on a call of the person's); held (until an
 * agent is free or back from its usage limit); failed; cancelled (cut short, as a stop does); next (still to come).
 */
export const GraphStepState = Schema.Literals(['done', 'running', 'waiting', 'held', 'failed', 'cancelled', 'next'])
export type GraphStepState = typeof GraphStepState.Type

/** A step of a round of work, as the runtime's graph has it: one node, however many times it was tried. */
export const GraphStep = Schema.Struct({
  /** Its node's id, or, for a step still to come, its round's id with its key and iteration. */
  id: Schema.String,
  key: Schema.Literals(['implement', 'review', 'settle', 'publish']),
  /** The how-manyth review, or the settling of the how-manyth review, from 0, as a step's report counts it. */
  iteration: Schema.Int,
  state: GraphStepState,
  /** What it is held for, while it is. */
  hold: Schema.NullOr(Schema.Literals(['usage_limit', 'agent_unavailable', 'machine_busy'])),
  /** The agent on its last try, on which model; the one its plan names for a step to come; none for Althar's own (publishing). */
  agentId: Schema.NullOr(Schema.String),
  model: Schema.NullOr(Schema.String),
  /** When its first try started, and its last ended. */
  startedAt: Schema.NullOr(Schema.String),
  endedAt: Schema.NullOr(Schema.String),
  /** A change to the steps put it in after its round began, as making a quick task a change does. */
  added: Schema.Boolean,
})
export type GraphStep = typeof GraphStep.Type

/**
 * A round of work of a task: its plan's run, or a follow-up (ADR-034), with its steps in the order they ran, then those
 * still to come.
 */
export const GraphRound = Schema.Struct({
  /** Its run's id. */
  id: Schema.String,
  followUp: Schema.Boolean,
  /** A Ship's run (a task is a conversation plus parts): the person shipped what waited, with no work step. Absent otherwise. */
  ships: Schema.optional(Schema.Boolean),
  createdAt: Schema.String,
  endedAt: Schema.NullOr(Schema.String),
  /** What the person said that started it, for a follow-up: their message, or what the coordinator passed on. */
  said: Schema.NullOr(Schema.Struct({ itemId: Schema.String, text: Schema.String, relayed: Schema.Boolean })),
  /** When a change to its steps added to them, if one did. */
  changedAt: Schema.NullOr(Schema.String),
  steps: Schema.Array(GraphStep),
  /** The helpers its lead started in it (ADR-087), each a lane of its model's on the Graph face. Absent where none. */
  helpers: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        name: Schema.String,
        agentId: Schema.String,
        model: Schema.NullOr(Schema.String),
        state: Schema.Literals(['working', 'done', 'stopped', 'failed']),
        startedAt: Schema.String,
        endedAt: Schema.NullOr(Schema.String),
      }),
    ),
  ),
})
export type GraphRound = typeof GraphRound.Type

/** A task's thread: its task and project, the agent working on it, the calls waiting on the person, and a page of its items. */
export const ThreadSnapshot = Schema.Struct({
  threadId: Schema.String,
  /** The runtime's placement for a new message, including work between sessions. */
  accepting: Schema.optional(Schema.Literals(['now', 'queued'])),
  /** The complete visual collection, read independently of the thread's report limit. */
  gallery: Schema.optional(EvidenceGallery),

  /** Changes when undo rewrites the visible conversation; pages from an older version must be dropped. */
  conversationVersion: Schema.optional(Schema.Int),
  /** Delivered messages with a complete file checkpoint, eligible for Undo from here. */
  undoable: Schema.optional(Schema.Array(Schema.String)),
  cursor: Cursor,
  position: Schema.optional(FeedPosition),
  /** What the task used of each account its agents ran on, in every thread of it, its reviews' too (ADR-084). */
  usage: Schema.optional(Schema.Array(AccountUse)),
  project: Schema.Struct({ id: Schema.String, name: Schema.String }),
  /** Where the project's repository is hosted, and whether Althar is connected there: what a pull request needs. */
  host: Schema.NullOr(Schema.Struct({ product: Product, name: Schema.String, webUrl: Schema.String, connected: Schema.Boolean })),
  task: Schema.Struct({
    id: Schema.String,
    goal: Schema.optional(Schema.NullOr(ThreadGoal)),
    title: Schema.String,
    description: Schema.String,
    /** What the person asked for, in their words, which its thread opens with; null for a task made before Althar kept it. */
    request: Schema.NullOr(Schema.String),
    /** The images the person sent with it, as their message to the coordinator shows them; none where they sent none. */
    requestPictures: Schema.optional(Schema.Array(Picture)),
    /** The files and folders they sent with it, as that message shows them. */
    requestFiles: Schema.optional(Schema.Array(AttachedFile)),
    slug: Schema.String,
    state: Schema.String,
    branch: Schema.NullOr(Schema.String),
    worktree: Schema.NullOr(Schema.String),
    /** It works Local, its folder the repository's own checkout here (ADR-091); absent for a worktree. */
    local: Schema.optional(Schema.Boolean),
    /** A chat on Scratch, off the board's lanes (a task is a conversation plus parts); absent for a task on the board. */
    scratch: Schema.optional(Schema.Boolean),
    /**
     * An artifact's own chat (ADR-104, "Talking to an artifact"): the canvas it is about, or null while it draws its first
     * version. It opens as the artifact, never as a task. Absent for any other task.
     */
    artifact: Schema.optional(Schema.Struct({ canvasId: Schema.NullOr(Schema.String) })),
    /**
     * Its changes, where it holds several (a task is a conversation plus parts, "The header lists every change"): each by
     * name and branch, the change it is stacked on or waits for, its pull request's link, whether commits wait for Ship on
     * it, and the helper at work on it. Absent with one change, whose row is the worktree's and its pull request's.
     */
    lines: Schema.optional(
      Schema.Array(
        Schema.Struct({
          id: Schema.String,
          name: Schema.String,
          branch: Schema.String,
          stackedOn: Schema.NullOr(Schema.String),
          waitsFor: Schema.NullOr(Schema.String),
          url: Schema.NullOr(Schema.String),
          waiting: Schema.Boolean,
          helper: Schema.NullOr(Schema.String),
        }),
      ),
    ),
    /** The helpers its lead started that are at work (ADR-087): each by name, the change it works on, and its model. */
    helpers: Schema.optional(
      Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String, change: Schema.NullOr(Schema.String), model: Schema.String })),
    ),
    /**
     * A move between a worktree and Local the person asked for that waits (a task is a conversation plus parts): where to,
     * and why, in words. `seen`, where it asks first, about a checkout on a branch of the person's own: what it was on and at,
     * which Switch it holds for.
     */
    moving: Schema.optional(
      Schema.Struct({
        to: WorksIn,
        why: Schema.String,
        seen: Schema.optional(Schema.Struct({ branch: Schema.NullOr(Schema.String), head: Schema.String })),
      }),
    ),
    /** Started Local, what it waits for before its lead starts, as its card says. */
    waitsForCheckout: Schema.optional(Schema.NullOr(CheckoutWait)),
    /** The tasks its plan waits for, and how each stands, as its card says (tasks wait for their blockers). */
    waitsFor: Schema.optional(Schema.Array(TaskBlocker)),
    /** The open tasks that wait for it, as its card says. */
    waitedBy: Schema.optional(Schema.Array(LinkedTask)),
    /** The branch its work goes into, where it isn't its repository's default (ADR-093): release/0.8.0; absent for the default. */
    toward: Schema.optional(Schema.String),
    /**
     * Its folder, where it isn't on this computer as it should be: removed once
     * the task finished (ADR-056), or coming back, from its branch, and
     * setting up again. Absent while it is here.
     */
    folder: Schema.optional(Schema.Literals(['removed', 'returning'])),
    baseRef: Schema.NullOr(Schema.String),
    /** Where it stands, as its card says: ready once its run passed review. */
    phase: Schema.NullOr(TaskPhase),
    /** Stopped, no agent on it: what stopped its lead, and when, as its card says. Absent while it isn't stopped. */
    stopped: Schema.optional(Schema.NullOr(TaskStopped)),
    /** Stopped, with its open pull request ready to merge as it stands: it can be accepted all the same, as its card says. */
    mergeable: Schema.optional(Schema.Literal(true)),
    /** What it makes, read from what it has now, as its card says: where it opens, an outputs view for a change only. */
    kind: Schema.optional(TaskKind),
    /** Why its lead couldn't resolve a conflict, or fix the checks on the merge, which is the person's now, as its card says. */
    handedBack: Schema.optional(Schema.NullOr(Schema.String)),
    /** Why the checks failing on its pull request are the person's, as its card says (ADR-070). */
    checksBack: Schema.optional(Schema.NullOr(Schema.String)),
    /** Why its conflict with its default branch wasn't asked of its lead, as its card says, beside Resolve now. */
    conflictUnsent: Schema.optional(Schema.NullOr(Schema.String)),
    /** Why Althar couldn't look for a conflict with its default branch, as its card says, beside Look again. */
    conflictUnchecked: Schema.optional(Schema.NullOr(Schema.String)),
    /** When its lead made it a change, where it began as a quick task: what it showed before was a prototype's, not the change's. */
    madeChangeAt: Schema.optional(Schema.NullOr(Schema.String)),
    /** Its step held until an agent's usage limit resets: which agent, and when it is back. */
    waits: Schema.NullOr(HeldForLimit),
    /** Its step held for the connection: absent or null otherwise (ADR-060). */
    reconnects: Schema.optional(Schema.NullOr(HeldForConnection)),
    externalWait: Schema.optional(HeldForExternal),
    /** It waits for a place among the agents this machine runs at once: how many are busy, and how many it runs at once. */
    queued: Schema.NullOr(Queued),
    /** Its place in its project's Up next, waiting for a place, as its card says: 1 gets one first; absent out of it. */
    place: Schema.optional(Schema.Int),
    /** It waits up next behind another of its tasks, or is a plan waiting to start, so the person can put it at the front. */
    front: Schema.optional(Schema.Boolean),
    /** Its plan's steps, as its header's track shows them; empty without a plan. */
    steps: Schema.Array(PlanStep),
    /** Its plan's ending: a first or new pull request goes through Ship and its review, even before a hold was recorded. */
    end: Schema.optional(Schema.NullOr(TaskEnd)),
    /** Its rounds of work as its graph had them, oldest first: what its Graph face draws. Absent from a runtime before it. */
    graph: Schema.optional(Schema.Array(GraphRound)),
    /** Who leads it, running or not: the last agent on its thread, on its model and account, else the one its plan names. */
    lead: Schema.NullOr(
      Schema.Struct({ agentId: Schema.String, model: Schema.NullOr(Schema.String), account: Schema.NullOr(Schema.String) }),
    ),
    /** The step it is on, by key, while it runs, and since when. */
    step: Schema.NullOr(Schema.String),
    stepAt: Schema.NullOr(Schema.String),
    /** When its work started, and when it settled: how long it has run. */
    startedAt: Schema.NullOr(Schema.String),
    settledAt: Schema.NullOr(Schema.String),
    /** The (first) issue it came from. */
    issue: Schema.NullOr(IssueSummary),
    /** It does only part of its (first) issue: its merge comments on it and leaves it open, rather than closing it. */
    issuePartOf: Schema.optional(Schema.Boolean),
    /** Each issue it came from, on any trackers, the first being `issue`, each with its own `partOf`. Absent from a runtime before. */
    fromIssues: Schema.optional(Schema.Array(TaskIssue)),
    /** Its pull requests, as last seen, oldest first. */
    changes: Schema.Array(ChangeSummary),
    /** Commits after its last pull request merged or closed, in none yet: what Open a new pull request opens one with. */
    unshipped: Schema.optional(Schema.NullOr(Unshipped)),
    /** What waits on its branch for Ship, as its card has it (`TaskCard.held`). Absent while nothing is held. */
    held: Schema.optional(HeldForShip),
    /** When its lead last answered the person unseen, as its card has it (`TaskCard.replied`). */
    replied: Schema.optional(Schema.String),
    /** Its review after a merge, under way or waiting on the person, as its card has it (`TaskCard.afterMerge`). */
    afterMerge: Schema.optional(AfterMergeReview),
    /** A change ready that built nothing: no commits on its branch, no pull request open or merged. Absent otherwise. */
    nothingBuilt: Schema.optional(Schema.Boolean),
    /** The review of its run under way can still be skipped, as the person may (ADR-034). */
    skipReview: Schema.optional(Schema.Boolean),
    /** The route its Ship takes when pressed without one chosen, while something waits for Ship. Absent otherwise. */
    shipRoute: Schema.optional(ShipRouteOf),
    /** Its Ship under way: the route and the stop it is at. Absent while none is. */
    shipping: Schema.optional(ShipUnderWay),
    /**
     * It can be made a change in one move, as its menu's Make it a change does: begun, of its own work, not merged, and
     * ending with no pull request (a prototype, a chat, a quick task).
     */
    toChange: Schema.optional(Schema.Boolean),
    /** It runs a round of work after its plan. */
    followUp: Schema.optional(Schema.Boolean),
    /** What it changed since it started, committed or not, file by file, and in how many commits; empty without a worktree here. */
    files: Schema.Array(ChangedFile),
    commits: Schema.Number,
    /** Its repositories with no pull request, not merged yet, which merge here. */
    here: Schema.Array(TaskRepositoryHere),
    /** Those it merged here: into which branch, the remote that branch follows (none for a repository without one), and how many commits that remote doesn't have yet. */
    merged: Schema.Array(TaskRepositoryMerged),
    /** What the person can do to it as a whole now, in its menu's order. */
    actions: Schema.Array(TaskAction),
    /** Its plan still waiting to start, by id, for starting it now; null once started, or where it has none. */
    planId: Schema.NullOr(Schema.String),
    /** The worker assigned to this task's accepted plan. */
    workerId: Schema.optional(Schema.NullOr(Schema.String)),
    /** What it can run in its worktree, in the project's order, the first its default (ADR-044); empty where nothing says how. */
    runnables: Schema.Array(Runnable),
    /** What Althar runs of it, in its worktree. */
    launches: Schema.Array(Launch),
    /**
     * Whether its lead resolves a conflict with its default branch on its
     * own, unasked: as the task says, or, where it says nothing (null), as
     * its project's rules do, which `project` is.
     */
    resolveConflicts: Schema.Struct({ task: Schema.NullOr(Schema.Boolean), project: Schema.Boolean }),
    /**
     * Whether everything its agents ask is allowed, short of what its project
     * never allows: turned on for the task (`task`), or by its project's
     * rules for every task (`project`).
     */
    allowEverything: Schema.Struct({ task: Schema.Boolean, project: Schema.Boolean }),
    /** Someone else's pull request it reviews, where it is a review: its thread opens with it, and its view says what the lead can reach. */
    review: Schema.optional(Schema.NullOr(ReviewBrief)),
  }),
  session: Schema.NullOr(SessionSummary),
  /** Whether Try again can act now, from the runtime's retry rule. */
  retryable: Schema.optional(Schema.Boolean),
  /** A call of a kind a newer home has and this client doesn't know is left out: it couldn't be answered here. */
  attention: KnownArray('kind', [AttentionRequest]),
  /** The newest items before the page's start, oldest first. */
  items: ThreadItems,
  /** There are items before these. */
  earlier: Schema.Boolean,
  /** Its steps' reports, on this page or not, newest two hundred: its finished view is read from the lead's, its graph from all. */
  reports: ThreadItems,
  /** Where the time went of each turn its page's items came in, that kept it; absent from a runtime before it. */
  turns: Schema.optional(Schema.Array(TurnTime)),
  /** Every task its lead started, oldest first, whatever page of its thread says so and however long ago they settled. */
  started: Schema.optional(
    Schema.Array(Schema.Struct({ taskId: Schema.String, slug: Schema.String, title: Schema.String, threadId: Schema.String })),
  ),
})
export type ThreadSnapshot = typeof ThreadSnapshot.Type

/** A markdown document an agent wrote, read from where it is now: its path as asked, its text, and how big. */
export const DocumentText = Schema.Struct({ path: Schema.String, body: Schema.String, bytes: Schema.Number, lines: Schema.Number })
export type DocumentText = typeof DocumentText.Type

export const Disposition = Schema.Literals(['after_current', 'interrupt_and_continue'])

/**
 * A thread's items and what they hold: pages of items, one or several items, a command's output, a document.
 * Saying something to a thread, taking it back, its goal; clearing its view and showing what came earlier.
 */
export const ThreadsApi = RpcGroup.make(
  /** The thread, with the newest `limit` items before `before` (a sequence), or none with `limit: 0`. */
  call(
    'GetThread',
    {
      threadId: Schema.String,
      before: Schema.optional(Schema.Int),
      limit,
      /** Reads the files its task changed from git, past what the runtime keeps: for the person looking at them. */
      fresh: Schema.optional(Schema.Boolean),
    },
    ThreadSnapshot,
  ),
  /**
   * One item of a thread, as its page has it: null for one the thread keeps
   * for Althar and never shows, such as what a lead could see, and, to a
   * client, for one of a kind it doesn't know.
   */
  call('GetThreadItem', { threadId: Schema.String, itemId: Schema.String }, KnownOrNull('kind', ThreadItem.members)),
  /**
   * Several items of a thread at once, as `GetThreadItem` reads each: what a
   * burst of changes touched, in one call. Those of them the thread shows; an
   * item asked for and not among them is one it keeps for Althar, or gone.
   */
  call(
    'GetThreadItems',
    { threadId: Schema.String, itemIds: Schema.Array(Schema.String).check(Schema.isMaxLength(THREAD_ITEMS_AT_ONCE)) },
    ThreadItems,
  ),
  /** What a command in a thread printed, as kept once it ended. */
  call('ReadOutput', { threadId: Schema.String, itemId: Schema.String }, OutputText),
  /**
   * A markdown document an agent in a thread wrote, as it is now in the
   * task's worktree: by the path the thread names it by. Only a markdown
   * file inside one of the task's worktrees, and not too large to read.
   */
  call('ReadDocument', { threadId: Schema.String, path: Schema.String }, DocumentText),
  /**
   * Clears the view of a project's coordinator thread: it starts here, with
   * what is still open carried in. Nothing is forgotten: the coordinator keeps
   * the conversation, and the earlier part stays a press away.
   */
  command('ClearView', { threadId: Schema.String }, Schema.Void),
  /** Opens the conversation before a cleared view in the thread's place, or puts it away again. */
  command('ShowEarlier', { threadId: Schema.String, open: Schema.Boolean }, Schema.Void),
  /** Takes back a cleared view: the whole thread shows again. */
  command('UndoClearView', { threadId: Schema.String }, Schema.Void),
  /** Says something to a thread's agent, with any images, files and folders: empty words with any of them are a message too. */
  command(
    'Send',
    {
      threadId: Schema.String,
      body: Schema.String,
      disposition: Disposition,
      images: Schema.optional(SentImages),
      files: Schema.optional(SentFiles),
      /** Any of its words came from dictation, even if the person edited them after: the agent is told, so it reads past what was misheard. */
      dictated: Schema.optional(Schema.Boolean),
      /** Comments on lines of a task's diff (decisions: desktop-app § Comments on the diff): the agent reads each with its file, its lines and the code quoted, after the words. */
      comments: Schema.optional(LineComments),
      /** The person's comments on canvases (ADR-104), kept with the message and in the same command: until it is sent, each is only the person's draft. */
      canvasComments: Schema.optional(Schema.Array(SentCanvasComment).check(Schema.isMaxLength(50))),
    },
    Schema.Void,
  ),
  command(
    'SetThreadGoal',
    {
      threadId: Schema.String,
      control: GoalControl,
      lead: Schema.optional(
        Schema.Struct({ agentId: Schema.String, model: Schema.optional(Schema.String), effort: Schema.optional(Schema.String) }),
      ),
    },
    Schema.NullOr(ThreadGoal),
  ),
  /** Takes back a message still waiting its turn, by its item: to edit it, or to drop it. One the agent already has stays. */
  command('TakeBack', { itemId: Schema.String }, Schema.Void),
).middleware(ClientAuthority)
