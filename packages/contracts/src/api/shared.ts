import { Schema } from 'effect'
import { AutomationCard, FromAutomation } from '../automations'
import { CanvasKind } from '../canvases'
import { MESSAGE_FILES } from '../files'
import { SentLineComment } from '../lineComments'
import { KnownArray, OpenLiterals } from '../open'
import { MESSAGE_IMAGES } from '../pictures'
import { SettingChangeCard } from '../settings'

/* What the calls of more than one area use (src/api/<area>.ts has each area's own). */

export class ApiError extends Schema.TaggedError<ApiError>()('ApiError', {
  /** What kind of failure: the runtime's error tag, such as `NotARepository` or `SessionFailed`. */
  reason: Schema.String,
  /** What went wrong, in words the window can show. */
  message: Schema.String,
  /** Its own kind within the reason, where it has one: why a merge couldn't happen (`conflicts`). */
  why: Schema.optional(Schema.String),
  /** What it concerns, where the window can act on it: the files a merge conflicts in. */
  detail: Schema.optional(Schema.String),
  /** For `ApiVersionMismatch`: the API version the client said it speaks; left out where it said none. */
  clientVersion: Schema.optional(Schema.Int),
  /** For `ApiVersionMismatch`: the API version the runtime serves. */
  runtimeVersion: Schema.optional(Schema.Int),
}) {}

/** A command's id, made by the client: `cmd_` and 32 hex digits. The same id twice is a retry. */
export const CommandId = Schema.String.check(Schema.isPattern(/^cmd_[0-9a-f]{32}$/))
export type CommandId = typeof CommandId.Type

/** A position in the store's change feed. Events after it are the ones a client hasn't seen. */
export const Cursor = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

/** What a project does when an agent reaches its usage limit: moves the work on to the next free agent, waits for the reset, or asks the person. */
export const UsageLimit = Schema.Literals(['move', 'wait', 'ask'])
export type UsageLimit = typeof UsageLimit.Type

/**
 * Where a task works (ADR-091): a worktree of its own, or Local, in each of
 * its repositories' own checkout on this device, where the person works, one
 * task at a time.
 */
export const WorksIn = Schema.Literals(['worktree', 'checkout'])
export type WorksIn = typeof WorksIn.Type

/** Another task, by its id and title: one that works in a checkout another waits for. */
export const OtherTask = Schema.Struct({ taskId: Schema.String, title: Schema.String })
export type OtherTask = typeof OtherTask.Type

/**
 * What a Local task waits for before it starts (ADR-091): a checkout another
 * task works in (`taken`, by that task), or the person committing what isn't
 * committed in it, as they chose (`changes`).
 */
export const CheckoutWait = Schema.Union([
  Schema.Struct({ why: Schema.Literal('taken'), by: OtherTask }),
  Schema.Struct({ why: Schema.Literal('changes'), repository: Schema.String }),
])
export type CheckoutWait = typeof CheckoutWait.Type

/**
 * What Althar asks before a Local task takes a repository's checkout
 * (ADR-091): it has changes not committed (`changes`, which files), or is
 * on a branch of the person's own (`branch`), which it never switches
 * without asking. `base` is the branch tasks start from.
 */
export const CheckoutAsk = Schema.Struct({
  repository: Schema.String,
  holdup: Schema.Literals(['changes', 'branch']),
  files: Schema.Array(Schema.String),
  branch: Schema.NullOr(Schema.String),
  base: Schema.String,
})
export type CheckoutAsk = typeof CheckoutAsk.Type

/** What moving a running task did: moved; waiting, and why; or asking first, about the checkout as it was seen. */
/** A preset's parts (a task is a conversation plus parts, "Presets"): only a start; the parts are what a task has. */
export const PresetParts = Schema.Struct({
  workspace: Schema.Literals(['copy', 'worktree', 'local']),
  checked: Schema.Literals(['before', 'after', 'none']),
  /** How it ends; absent, as the project's "How a task ends" says. */
  end: Schema.optional(Schema.Literals(['draft', 'ready', 'none'])),
  shelf: Schema.Literals(['scratch', 'board']),
  /** Its lead and reviewer as `agent/model`; null, picked as for any step. A built-in names none. */
  lead: Schema.NullOr(Schema.String),
  reviewer: Schema.NullOr(Schema.String),
  /** Their efforts, as their models write them; absent or null, their own or the person's default. */
  effort: Schema.optional(Schema.NullOr(Schema.String)),
  reviewerEffort: Schema.optional(Schema.NullOr(Schema.String)),
  brief: Schema.String,
  reviews: Schema.optional(Schema.Boolean),
})
export type PresetParts = typeof PresetParts.Type

export const SignIn = Schema.Literals(['signed_in', 'signed_out', 'unknown'])
export type SignIn = typeof SignIn.Type

/** One sign-in of an agent, in a folder of its own (ADR-012): the agent's usual folder first. */
export const AccountStatus = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  /** Its folder, to recognise it by; null for the agent's usual one. */
  home: Schema.NullOr(Schema.String),
  signIn: SignIn,
  paidBy: Schema.Literals(['plan', 'key', 'unknown']),
  /** Out of usage until then, where it is. */
  outUntil: Schema.NullOr(Schema.String),
  /** What made its folder, when Althar didn't. */
  adoptedFrom: Schema.NullOr(Schema.String),
  /** The selected GitHub sign-in host for the Copilot CLI account. */
  signInHost: Schema.optional(Schema.String),
  /** When its sign-in ends, where its agent's status says (Claude Code's claude.ai sign-in); not given where it doesn't. */
  endsAt: Schema.optional(Schema.String),
  /** Its sign-in ends within the days the runtime warns in, or has ended: given with `endsAt`, so the row and the warning agree. */
  endsSoon: Schema.optional(Schema.Boolean),
  /**
   * For an agent that reaches several providers with sign-ins of their own (OpenCode): each one it lists as signed in, and, where
   * a turn on it was refused since, when; how it is paid for where that is known (OpenCode Go a plan, Zen per use). Not given
   * where the agent has one sign-in for everything.
   */
  providers: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        name: Schema.String,
        refusedAt: Schema.NullOr(Schema.String),
        pays: Schema.optional(Schema.Literals(['plan', 'key'])),
      }),
    ),
  ),
})
export type AccountStatus = typeof AccountStatus.Type

/** A plan's window by its length: five hours, a week, a month; anything else, with the agent's name for it. */
export const UsageWindowKind = Schema.Literals(['five_hour', 'weekly', 'monthly', 'other'])
export type UsageWindowKind = typeof UsageWindowKind.Type

/** How much of one window of a plan is used, and when it resets. */
export const UsageWindow = Schema.Struct({
  kind: UsageWindowKind,
  /** The agent's name for it where it gave one: a model's window, or extra usage. */
  label: Schema.NullOr(Schema.String),
  /** 0 to 100. */
  usedPercent: Schema.Number,
  resetsAt: Schema.NullOr(Schema.String),
})
export type UsageWindow = typeof UsageWindow.Type

/**
 * Why an account's usage is missing or old, a fault to fix (docs/plans/plan-usage.md):
 * it is signed out, its sign-in has expired (the agent renews it when it next
 * runs), the provider answered in another shape or can't be reached, the
 * source isn't allowed, the agent has not been read yet, or its sign-ins
 * can't be told plan from key. An agent that reports no usage anyone can
 * read is not a fault: it says so in `noReading`.
 */
export const UsageFaultKind = Schema.Literals([
  'sign_in_again',
  'expired',
  'source_changed',
  'unreachable',
  'no_source',
  'no_data_yet',
  'cannot_classify',
])
export type UsageFaultKind = typeof UsageFaultKind.Type

/** One account's plan usage: its windows as last read, from where, and how old; or the fault. */
export const AccountUsage = Schema.Struct({
  agentId: Schema.String,
  agentName: Schema.String,
  accountId: Schema.String,
  accountName: Schema.String,
  paidBy: Schema.Literals(['plan', 'key', 'unknown']),
  /** Where the windows came from: ACP, an adapter's extension, the agent's own channel, or the provider's endpoint; null before any. */
  source: Schema.NullOr(Schema.Literals(['acp', 'acp_extension', 'agent', 'endpoint'])),
  /** When Althar last saw these numbers; null before any. */
  observedAt: Schema.NullOr(Schema.String),
  /** The plan as the agent names it: plus, pro, max. */
  plan: Schema.NullOr(Schema.String),
  windows: Schema.Array(UsageWindow),
  /**
   * The windows last read of it that have reset since, as last read: not in `windows`, and their `usedPercent` is what it was
   * then, not now. Until they are read again they are only a reset to show.
   */
  resetWindows: Schema.optional(Schema.Array(UsageWindow)),
  /** Why the numbers are missing or old, where they are; the windows shown are the last ones then. */
  fault: Schema.NullOr(Schema.Struct({ kind: UsageFaultKind, message: Schema.String })),
  /** Why Althar reads no usage for it, where the agent reports none anyone can read: shown calmly, not as a fault. */
  noReading: Schema.NullOr(Schema.String),
  /**
   * Every window last read of it has reset since, so none is in `windows`: how much is used is unknown until it is read
   * again. `observedAt` and `fault` still say how old the last reading is and why there is no newer one.
   */
  resetSince: Schema.Boolean,
})
export type AccountUsage = typeof AccountUsage.Type

/**
 * An account whose sign-in ends within its last days, or has just ended (DEV-196): the one warning Althar raises about it, until
 * the person signs in again or puts it aside. Raised once for each sign-in.
 */
export const SignInEnding = Schema.Struct({
  agentId: Schema.String,
  agentName: Schema.String,
  accountId: Schema.String,
  accountName: Schema.String,
  /** The agent has more than one account here, so the account is worth naming. */
  several: Schema.Boolean,
  endsAt: Schema.String,
  /** Where it stands: within its last days, any day now (past the earliest it can end), or ended, by its date or as its check already says signed out. Put aside at one, it is raised again at a later one. */
  stage: Schema.Literals(['soon', 'last', 'ended']),
})
export type SignInEnding = typeof SignInEnding.Type

/** Every account's plan usage, and the sign-ins that end soon, read with them. */
export const PlanUsage = Schema.Struct({ accounts: Schema.Array(AccountUsage), endings: Schema.optional(Schema.Array(SignInEnding)) })
export type PlanUsage = typeof PlanUsage.Type

/**
 * When finished tasks' folders go (ADR-056): by how each task ended
 * (`smart`: a review's at once, a merged change's after 3 days, a done
 * task's after a week, an abandoned one's after 2 weeks, sooner when space
 * runs low), one wait for all, or only when the person cleans up.
 */
export const FolderWait = Schema.Literals(['smart', 'day', 'week', 'month', 'never'])
export type FolderWait = typeof FolderWait.Type

/**
 * What a small change's review after it merges brings back (docs/decisions/reviews.md): `major`, only blocking and major findings
 * come back to the person, the rest stay in the thread; `all`, any finding does; `none`, no review is owed after the merge.
 */
export const AFTER_MERGE_REVIEWS = ['major', 'all', 'none'] as const
export const AfterMergeRule = Schema.Literals(AFTER_MERGE_REVIEWS)
export type AfterMergeRule = typeof AfterMergeRule.Type

/** How new conversations choose an agent's account; `first` keeps automatic switching off. */
export const AccountStrategy = Schema.Literals(['first', 'most_room', 'least_room', 'random', 'in_order'])
export type AccountStrategy = typeof AccountStrategy.Type

/**
 * How far a Ship takes what waits: as far as a push (a draft stays one, a new
 * pull request opens as one), ready for review (a draft is marked ready, a new
 * one opens ready), or merged, once the checks main requires pass.
 */
export const ShipFar = Schema.Literals(['push', 'ready', 'merge'])
export type ShipFar = typeof ShipFar.Type

/** A Ship's route: whether its review comes first, and how far it goes. */
export const ShipRoute = Schema.Struct({ review: Schema.Boolean, far: ShipFar })
export type ShipRoute = typeof ShipRoute.Type

/** A project's ink: the colour its mark is drawn in, chosen when it was made and kept until the person picks another. */
export const ProjectInk = Schema.Literals([
  'clay',
  'ochre',
  'sand',
  'olive',
  'moss',
  'teal',
  'slate',
  'indigo',
  'plum',
  'rose',
  'brick',
  'umber',
])
export type ProjectInk = typeof ProjectInk.Type

export const ProjectSummary = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  slug: Schema.String,
  ink: ProjectInk,
  /** When a task of it was last made or settled; null before it had one. */
  lastWorkAt: Schema.NullOr(Schema.String),
  repository: Schema.NullOr(Schema.String),
  /** The repositories its tasks may change, by name, the first first. */
  repositories: Schema.Array(Schema.String),
  /** The folder its tasks' worktrees are in on this Mac; null before it has had a task. */
  worktrees: Schema.NullOr(Schema.String),
  tasks: Schema.Number,
  /** Sessions working now. */
  running: Schema.Number,
  /** What waits on the person there, each thing once, as its board's Needs you counts it (`waitingOn`). */
  yours: Schema.Number,
  /** Tasks under way: a step running, or held until an agent's usage limit resets. */
  working: Schema.Number,
  /** When an agent reaches its usage limit: its work moves on to the next free agent, waits for the reset, or asks the person. */
  usageLimit: UsageLimit,
  /** Whether work moves on to an agent's next account here when one runs out (ADR-012): off unless the person turned it on. */
  rotateAccounts: Schema.Boolean,
  /** The accounts each agent may use here, by agent; null for every one. */
  onlyAccounts: Schema.NullOr(Schema.Record(Schema.String, Schema.Array(Schema.String))),
  /** The thread of its conversation with the coordinator: what opens a call of the coordinator's there. */
  coordinatorThreadId: Schema.optional(Schema.NullOr(Schema.String)),
})
export type ProjectSummary = typeof ProjectSummary.Type

/** A code host or tracker Althar connects to. Cloud and Data Center are separate products. */
export const Product = Schema.Literals([
  'github',
  'gitlab',
  'bitbucket_cloud',
  'bitbucket_dc',
  'linear',
  'jira_cloud',
  'jira_dc',
  'trello',
  'clickup',
])
export type Product = typeof Product.Type

/** The kinds of request a project's rules can have ask the person, or refuse (ADR-013). */
export const RuleKind = Schema.Literals(['default-branch', 'force-push', 'many-branches', 'delete-branch', 'deploy', 'outside', 'speak'])
export type RuleKind = typeof RuleKind.Type

/** How far an "always" answer to a permission reaches (ADR-018): this exact command, commands that start the same way, or the kind it is. */
export const AlwaysScope = Schema.Literals(['exact', 'prefix', 'kind'])
export type AlwaysScope = typeof AlwaysScope.Type

/** What let a request through without asking: a kind the project always allows, or one of its command rules. */
export const AllowedBy = Schema.Union([
  Schema.Struct({ kind: RuleKind }),
  Schema.Struct({ pattern: Schema.String, match: Schema.Literals(['prefix', 'exact']) }),
])
export type AllowedBy = typeof AllowedBy.Type

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

/** Where an issue stands: in the tracker's words, and as a category every tracker's statuses fall into. */
export const IssueStatus = Schema.Struct({
  name: Schema.String,
  category: Schema.Literals(['triage', 'backlog', 'todo', 'started', 'done', 'cancelled']),
})

/** An issue on a connected tracker, or in the project's repository. */
export const IssueSummary = Schema.Struct({
  product: Product,
  /** What it is read by again: its key, or owner/repo#12. */
  ref: Schema.String,
  key: Schema.String,
  title: Schema.String,
  url: Schema.String,
  status: IssueStatus,
  priority: Schema.NullOr(Schema.Struct({ level: Schema.String, name: Schema.String })),
  container: Schema.NullOr(Schema.String),
})
export type IssueSummary = typeof IssueSummary.Type

/** A head's checks, summed up: how many passed, failed and still run, and which failed. */
export const ChecksSummary = Schema.Struct({
  outcome: Schema.Literals(['none', 'running', 'passed', 'failed']),
  passed: Schema.Number,
  failed: Schema.Number,
  running: Schema.Number,
  total: Schema.Number,
  failing: Schema.Array(Schema.String),
  /** Each check, by name, as it stands, with what it said of itself. */
  list: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      state: Schema.Literals(['queued', 'running', 'passed', 'failed', 'skipped', 'cancelled', 'neutral']),
      summary: Schema.NullOr(Schema.String),
    }),
  ),
})
export type ChecksSummary = typeof ChecksSummary.Type

/** A task's pull request (GitLab's merge request), as last seen, in its host's words. */
/**
 * Where a task's screenshots stand on one of its pull requests (ADR-077):
 * none posted yet; posted, and as Outputs shows them now; or posted, with so
 * many changed since, or gone or new. `synced` where the project's rules
 * post them on their own as they change. The views the person left out of
 * it, by key (`screenshotsNow`), stay out whoever posts. The comment, once
 * there is one, and why the last try failed, where it did.
 */
export const ScreenshotsOnChange = Schema.Struct({
  standing: Schema.Literals(['unposted', 'posted', 'changed']),
  changed: Schema.Number,
  synced: Schema.Boolean,
  leftOut: Schema.Array(Schema.String),
  commentUrl: Schema.NullOr(Schema.String),
  failed: Schema.NullOr(Schema.String),
})
export type ScreenshotsOnChange = typeof ScreenshotsOnChange.Type

/**
 * One thing merging a change needs on its host, as it stands (DEV-204):
 * met, unmet (someone has something to do), waiting (on someone asked, or
 * something under way), or unknown, where the host doesn't say, never taken
 * as met. Each kind says what it is about, in numbers and names:
 *
 * - `checks`: its required checks, `have` of `need` passed; `who` those that
 *   failed, else those still to finish; `required` their names, where the host
 *   says which are (absent, every check counts); `apart`, the others, which
 *   don't hold it back;
 * - `approvals`: `have` of `need` (absent where the host doesn't say how
 *   many); `who` approved, or, waiting, who is asked;
 * - `code_owners`: a code owner's review, `who` it waits on;
 * - `changes_requested`: none outstanding, else `who` asked for them;
 * - `conversations`: all resolved, `have` of `need` where the host counts;
 * - `up_to_date`: has what its target has, `have` commits behind where not;
 * - `conflicts`, `draft`: no conflict with its target; not a draft;
 * - `pushed`: nothing of its lead's left to push, `have` commits where there
 *   is, waiting where they go up on their own, `said` where they wait for
 *   Ship; unmet too where its branch and it have parted;
 * - `signatures`: every commit signed, `have` not;
 * - `linear_history`: merged as a squash or rebase;
 * - `merge_queue`: merges through its branch's queue, waiting once in it;
 * - `other`: something else holds it back, in the host's words (`said`), or
 *   a rule Althar can't read.
 */
export const MergeNeed = Schema.Struct({
  kind: Schema.Literals([
    'checks',
    'approvals',
    'code_owners',
    'changes_requested',
    'conversations',
    'up_to_date',
    'conflicts',
    'draft',
    'pushed',
    'signatures',
    'linear_history',
    'merge_queue',
    'other',
  ]),
  state: Schema.Literals(['met', 'unmet', 'waiting', 'unknown']),
  have: Schema.optional(Schema.Number),
  need: Schema.optional(Schema.Number),
  who: Schema.optional(Schema.Array(Schema.String)),
  said: Schema.optional(Schema.String),
  required: Schema.optional(Schema.Array(Schema.String)),
  apart: Schema.optional(Schema.Struct({ passed: Schema.Number, failed: Schema.Array(Schema.String), running: Schema.Number })),
})
export type MergeNeed = typeof MergeNeed.Type

export const ChangeSummary = Schema.Struct({
  product: Product,
  number: Schema.Number,
  title: Schema.String,
  url: Schema.String,
  state: Schema.Literals(['open', 'merged', 'closed']),
  draft: Schema.Boolean,
  /** The host's words: pull request or merge request, PR or MR, # or !. */
  noun: Schema.String,
  short: Schema.String,
  prefix: Schema.String,
  repository: Schema.String,
  /** Its repository's folder here, which its files' paths start with in a task of several; null where it isn't known. */
  slug: Schema.NullOr(Schema.String),
  /**
   * The change of the task it is the pull request of (a task is a conversation plus parts, "A task holds as many changes as
   * it needs"): by its worktree's id, and its name where the task has several (null for its first, which the task's title
   * names). Absent where Althar can't tell, as for one it was only told of. `below`, for one stacked on another of the
   * task's changes whose pull request is still open, names that one (PR #714): Merge merges it first.
   */
  change: Schema.optional(
    Schema.Struct({
      id: Schema.String,
      name: Schema.NullOr(Schema.String),
      below: Schema.optional(Schema.String),
      /** The change it waits for to merge, without building on its code: its failing checks wait with it. */
      waitsFor: Schema.optional(Schema.String),
    }),
  ),
  additions: Schema.NullOr(Schema.Number),
  deletions: Schema.NullOr(Schema.Number),
  changedFiles: Schema.NullOr(Schema.Number),
  checks: Schema.NullOr(ChecksSummary),
  /** The branch it merges into, as last seen: main. Absent where Althar saw it before it kept this. */
  target: Schema.optional(Schema.String),
  /**
   * Whether its host says it conflicts with that branch, as last seen, so it
   * can't merge until its branch is brought up to date. Null or absent where
   * the host hasn't worked it out, or doesn't say.
   */
  conflicts: Schema.optional(Schema.NullOr(Schema.Boolean)),
  /** In its target branch's merge queue, where accepting it put it: its host merges it once the queue's checks pass. */
  queued: Schema.optional(Schema.Boolean),
  /** The commit at its head, as last seen: what accepting it merges, and nothing newer. */
  head: Schema.NullOr(Schema.String),
  /** Althar asks its host for news while the task is open. */
  listening: Schema.Boolean,
  /** The head of the task's branch here, for an open one: what pushing it pushes, and nothing newer. */
  localHead: Schema.NullOr(Schema.String),
  /** The task attached to a contributor’s branch with maintainer edits. */
  maintainerEdit: Schema.optional(Schema.Boolean),
  /** Commits on the task's branch here that aren't on it yet: the person pushes them once they've looked. */
  unpushed: Schema.Number,
  /**
   * Where its project's rules push the lead's commits on their own (ADR-072):
   * `held` null while those here go up as its lead's turn ends, so they are
   * nothing for the person to push; else why they wait for the person's push,
   * in a few words. Absent where every push is the person's, as for
   * commits made outside its lead's turn, which nothing pushes (DEV-173).
   * `ship` where they wait on a branch held for Ship, whatever the rules
   * say: Ship sends them up, after its review, and nothing else pushes
   * them, the person's Push included (a task is a conversation plus parts).
   */
  pushing: Schema.optional(Schema.Struct({ held: Schema.NullOr(Schema.String), ship: Schema.optional(Schema.Boolean) })),
  /**
   * Where the task's branch here no longer simply adds to it, so a plain
   * push would be refused; null while it does. `rewritten`: commits Althar
   * pushed were rewritten here, `local` new ones in place of `onPullRequest`
   * of its own. `moved`: it has commits pushed from elsewhere that the branch
   * doesn't, `onPullRequest` of them where they are here to count.
   */
  diverged: Schema.NullOr(
    Schema.Struct({
      kind: Schema.Literals(['rewritten', 'moved']),
      local: Schema.Number,
      onPullRequest: Schema.NullOr(Schema.Number),
    }),
  ),
  /**
   * Where the task's screenshots stand on it (ADR-077): the one comment that
   * shows them, as Outputs does. Absent where its host takes no pictures, or
   * it isn't open.
   */
  screenshots: Schema.optional(ScreenshotsOnChange),
  /**
   * What merging it needs, each as it stands, in order, for an open one
   * (DEV-204): its host's requirements as last read, with its checks, its
   * conflict, whether it is a draft and what is left to push. Absent where its
   * host doesn't read them, or hasn't yet.
   */
  needs: Schema.optional(Schema.Array(MergeNeed)),
  /** The host explicitly allows this viewer to merge without its queue; the action rechecks it. */
  canBypassQueue: Schema.optional(Schema.Boolean),
})
export type ChangeSummary = typeof ChangeSummary.Type

/** What a task does when its steps are done: open a draft pull request, open one for review, or push its branch only. */
export const TaskEnd = Schema.Literals(['draft', 'ready', 'none'])
export type TaskEnd = typeof TaskEnd.Type

/** The address as the message has it, which can differ from the one the tracker or host gives (`url`); none on a link unfurled before it was kept. */
const Pasted = Schema.optional(Schema.String)

/** A link the person pasted, unfurled: an issue, or a pull request. */
export const Unfurl = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('issue'),
    product: Product,
    key: Schema.String,
    title: Schema.String,
    url: Schema.String,
    pasted: Pasted,
    status: IssueStatus,
    priority: Schema.NullOr(Schema.Struct({ level: Schema.String, name: Schema.String })),
    container: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal('change'),
    product: Product,
    key: Schema.String,
    title: Schema.String,
    url: Schema.String,
    pasted: Pasted,
    state: Schema.Literals(['draft', 'open', 'merged', 'closed']),
    repository: Schema.String,
  }),
])
export type Unfurl = typeof Unfurl.Type

/* ---- A thread's items, each kind with its own content ---- */

/** A file a tool call touches, and the line, when it says. */
export const ToolLocation = Schema.Struct({ path: Schema.String, line: Schema.optional(Schema.Number) })

const itemFields = {
  id: Schema.String,
  sequence: Schema.Number,
  /** Which agent said it, for what agents say. */
  agentId: Schema.NullOr(Schema.String),
  /**
   * The model its turn ran on, as the runtime recorded it when the turn was given (DEV-154): a session's own
   * model is what it is on now, so a round read after a switch would otherwise take the new model's name.
   * Absent for what no agent wrote, and for threads from before the runtime kept it.
   */
  model: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: Schema.String,
  /** The turn it came in, by its delivery's id, where an agent's turn wrote it: what its line's time is read from (`TurnTime`). */
  turn: Schema.optional(Schema.String),
}

/**
 * A picture an agent handed back, in a message or a tool's result, or one
 * the person sent with a message: kept in the artifact store by its digest,
 * by which the window asks for its bytes, or not kept, saying why.
 */
export const Picture = Schema.Struct({
  /** Its SHA-256; null for one that wasn't kept. */
  digest: Schema.NullOr(Schema.String),
  mediaType: Schema.String,
  bytes: Schema.Number,
  width: Schema.NullOr(Schema.Number),
  height: Schema.NullOr(Schema.Number),
  /** What it is called, where the agent said. */
  name: Schema.NullOr(Schema.String),
  /** Why it wasn't kept: too large, a kind the window doesn't draw, or nowhere to keep it. */
  unkept: Schema.NullOr(Schema.Literals(['too_large', 'unsupported', 'unkept'])),
})
export type Picture = typeof Picture.Type

/**
 * An image the person sends with a message: its bytes, in base64, as the
 * window read them; or one Althar keeps already, by its digest, as when a
 * message waiting its turn is taken back to change and sent again. Its name
 * is its file's, where it had one. The runtime believes the bytes, not the
 * name: only PNG, JPEG, GIF and WebP are sent, each of at most
 * `MESSAGE_IMAGES.bytes`.
 */
export const SentImage = Schema.Union([
  Schema.Struct({ data: Schema.String, name: Schema.NullOr(Schema.String) }),
  Schema.Struct({ digest: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)), name: Schema.NullOr(Schema.String) }),
])
export type SentImage = typeof SentImage.Type

/** The images sent with one message, in the order they show: at most `MESSAGE_IMAGES.count`. */
export const SentImages = Schema.Array(SentImage).check(Schema.isMaxLength(MESSAGE_IMAGES.count))

/**
 * A file or folder the person sends with a message: by the grant the app
 * gave for it as it was dropped, pasted or picked, the window never naming a
 * path; or one Althar keeps a copy of already, by that copy's id, as when a
 * message waiting its turn is taken back to change and sent again. Each is
 * copied where the thread's agent reads, and the prompt links the copy.
 */
export const SentFile = Schema.Union([Schema.Struct({ grant: Schema.String }), Schema.Struct({ kept: Schema.String })])
export type SentFile = typeof SentFile.Type

/** The files and folders sent with one message, in the order they show: at most `MESSAGE_FILES.count`. */
export const SentFiles = Schema.Array(SentFile).check(Schema.isMaxLength(MESSAGE_FILES.count))

/**
 * A file or folder the person sent with a message, as Althar copied it for
 * the agent: its name, what it is, how large (a folder, all its files, and
 * how many), and where the copy is, which the agent was sent a link to.
 */
export const AttachedFile = Schema.Struct({
  /** The copy's id, by which it is sent again (`SentFile`'s `kept`). */
  id: Schema.String,
  name: Schema.String,
  kind: Schema.Literals(['file', 'folder']),
  /** What it is, as its name says; null for a folder, or a name that says nothing. */
  mediaType: Schema.NullOr(Schema.String),
  bytes: Schema.Number,
  /** A folder's files, at every depth; null for a file. */
  entries: Schema.NullOr(Schema.Number),
  /** Where its copy is, in the thread's folder, for the agent to read. */
  path: Schema.String,
})
export type AttachedFile = typeof AttachedFile.Type

/** What the person said, and where it stands with the lead. */
export const UserMessageItem = Schema.Struct({
  ...itemFields,
  kind: Schema.Literal('user_message'),
  /** What they said, the links in it Althar could unfurl, and the images, files and folders they sent with it. */
  content: Schema.Struct({
    text: Schema.String,
    links: Schema.Array(Unfurl),
    pictures: Schema.Array(Picture),
    files: Schema.Array(AttachedFile),
    /** What they said of lines of the task's diff, each with the code it is on (decisions: desktop-app § Comments on the diff). */
    comments: Schema.optional(Schema.Array(SentLineComment)),
  }),
  input: Schema.NullOr(
    Schema.Struct({
      state: Schema.Literals(['queued', 'delivered', 'superseded', 'withdrawn']),
      interrupting: Schema.Boolean,
      /** A turn has taken this input, even if delivery to the agent is still pending. */
      claimed: Schema.optional(Schema.Boolean),
      /** Some of its words came from dictation: the agent was told it may have been misheard. Taken back, it goes back to the composer so. */
      dictated: Schema.optional(Schema.Boolean),
    }),
  ),
})

/** A file an agent wrote whole, or pointed at: by its path as it named it, never its contents. */
export const FileMention = Schema.Struct({
  path: Schema.String,
  how: Schema.Literals(['wrote', 'linked']),
  mediaType: Schema.NullOr(Schema.String),
  bytes: Schema.NullOr(Schema.Number),
  title: Schema.NullOr(Schema.String),
})
export type FileMention = typeof FileMention.Type

/** What a command printed, once it ended: whether it was kept (ReadOutput reads it), how much, and how many of its first lines weren't kept. */
export const CommandOutput = Schema.Struct({
  /** False when it printed nothing, or there was nowhere to keep it. */
  kept: Schema.Boolean,
  lines: Schema.Number,
  bytes: Schema.Number,
  dropped: Schema.Number,
  /** What the tool said of how it ended, where it failed or was stopped: its error, apart from what it printed. */
  error: Schema.NullOr(Schema.String),
})
export type CommandOutput = typeof CommandOutput.Type

/** What a message or a tool call handed back beside its words. */
const handedFields = {
  pictures: Schema.Array(Picture),
  files: Schema.Array(FileMention),
}

/**
 * What an agent said or thought, as far as the store has it, and the pictures and files it handed back as it spoke; and,
 * where the agent says (Codex), whether a message is its answer, ending its turn, or a word on the way.
 */
export const AgentTextItem = Schema.Struct({
  ...itemFields,
  kind: Schema.Literals(['agent_message', 'agent_thought']),
  content: Schema.Struct({ text: Schema.String, ...handedFields, answer: Schema.optional(Schema.Boolean) }),
})

/**
 * A tool call: what it is, how it stands, the command it runs and the files
 * it touches, without its raw input and output; and what it handed back:
 * pictures, files it wrote whole or pointed at, and, for a command that
 * ended, what it printed and its exit code.
 */
export const ToolCallItem = Schema.Struct({
  ...itemFields,
  kind: Schema.Literal('tool_call'),
  content: Schema.Struct({
    title: Schema.String,
    /** ACP's tool kind: read, edit, execute, and so on. */
    toolKind: Schema.String,
    /** ACP's status: pending, in_progress, completed or failed. */
    status: Schema.String,
    command: Schema.NullOr(Schema.String),
    /** A command as it reads at a glance (see BackgroundCommand); absent where it is not shortened or there is no command. */
    label: Schema.optional(Schema.String),
    locations: Schema.Array(ToolLocation),
    /** Refused when it asked: by the rules, the lead or the person. */
    declined: Schema.Boolean,
    /** For a refused call: who refused it, and the reason they gave where they gave one. */
    declinedBy: Schema.optional(Schema.Literals(['rules', 'coordinator', 'person'])),
    declinedWhy: Schema.optional(Schema.String),
    /** The agent asking the person something: its question stands in the thread in its place. */
    asks: Schema.optional(Schema.Boolean),
    /**
     * For a call to one of the person's MCP servers that failed because the server was down: which, and why, as its agent
     * reported the server's status (`needs-auth` for one not signed in, `failed` for one that didn't start). Signing in turns
     * the call to done.
     */
    server: Schema.optional(
      Schema.Struct({ name: Schema.String, down: Schema.Literals(['needs-auth', 'failed']), agentId: Schema.optional(Schema.String) }),
    ),
    /** Let through without asking by the project's allow rules, the first that did (ADR-018); absent otherwise. */
    allowedBy: Schema.optional(AllowedBy),
    /** The skills it loads, by the agent's own word (`reported`), or a read of their `SKILL.md`, where the agent has no such word. */
    skill: Schema.optional(Schema.Struct({ names: Schema.Array(Schema.String), reported: Schema.Boolean })),
    /**
     * A call to one of the person's MCP servers (ADR-097): the server and its
     * tool, whether it acts on the outside world or only reads, what it did in
     * a few words, the words it posted, and where to see what it did, read
     * from its result.
     */
    mcp: Schema.optional(
      Schema.Struct({
        server: Schema.String,
        tool: Schema.String,
        acts: Schema.Boolean,
        did: Schema.String,
        words: Schema.optional(Schema.String),
        link: Schema.optional(Schema.String),
      }),
    ),
    /** A search on the web, by its query, or a page the agent read, by its address without its query: what the thread shows of it. */
    web: Schema.optional(
      Schema.Union([
        Schema.Struct({ action: Schema.Literal('search'), query: Schema.String }),
        Schema.Struct({ action: Schema.Literal('fetch'), url: Schema.String }),
      ]),
    ),
    /**
     * A sub-agent the agent started: what it was asked to do, in a line, its
     * kind and model where the agent says, and the start of what it reported
     * back once it ended.
     */
    subAgent: Schema.optional(
      Schema.Struct({
        label: Schema.String,
        type: Schema.optional(Schema.String),
        model: Schema.optional(Schema.String),
        said: Schema.optional(Schema.String),
      }),
    ),
    /** The sub-agent's call that made it, by that call's item, where the agent says which (Claude Code): it stands under it. */
    parent: Schema.optional(Schema.String),
    ...handedFields,
    output: Schema.NullOr(CommandOutput),
    exit: Schema.NullOr(Schema.Number),
  }),
})

/** The agent's plan, as it last said it. */
export const PlanItem = Schema.Struct({
  ...itemFields,
  kind: Schema.Literal('plan'),
  content: Schema.Struct({ entries: Schema.Array(Schema.Struct({ content: Schema.String, status: Schema.String })) }),
})

/** One option of something an agent asks, by the value it wants back. */
export const QuestionChoice = Schema.Struct({
  value: Schema.String,
  label: Schema.String,
  /** What the agent says it implies. */
  note: Schema.optional(Schema.String),
})
export type QuestionChoice = typeof QuestionChoice.Type

/** One thing an agent asks the person, as a field of its form. */
export const QuestionField = Schema.Struct({
  id: Schema.String,
  question: Schema.String,
  /** A short name the agent gave it: "Database". */
  header: Schema.optional(Schema.String),
  /** A choice of the agent's options, words, a number, or yes or no. */
  type: Schema.Literals(['choice', 'text', 'number', 'boolean']),
  options: Schema.Array(QuestionChoice),
  /** Several options may be picked. */
  multiple: Schema.Boolean,
  /** Where the agent takes an answer in the person's own words beside a choice. */
  wordsField: Schema.optional(Schema.String),
  required: Schema.Boolean,
})
export type QuestionField = typeof QuestionField.Type

/** What the person said to one field: the options picked, by value, and any words of their own. */
export const FieldAnswer = Schema.Struct({
  values: Schema.Array(Schema.String),
  words: Schema.optional(Schema.String),
})
export type FieldAnswer = typeof FieldAnswer.Type

/**
 * A question an agent asked the person, where it was asked: open until they
 * answer it in place; then what they said. Withdrawn when the agent took it
 * back or its turn was stopped (`turn`), or its task was stopped (`task`).
 */
export const QuestionItem = Schema.Struct({
  ...itemFields,
  kind: Schema.Literal('question'),
  content: Schema.Struct({
    attentionId: Schema.String,
    /** What the agent said with it. */
    message: Schema.String,
    /** The agent's own tool call the question stands for; the thread shows the question in its place. */
    toolCallId: Schema.NullOr(Schema.String),
    fields: Schema.Array(QuestionField),
    state: Schema.Literals(['open', 'answered', 'withdrawn']),
    answers: Schema.NullOr(Schema.Record(Schema.String, FieldAnswer)),
    withdrawn: Schema.NullOr(Schema.Literals(['turn', 'task'])),
  }),
})

/** A failed check's log, as its arrival shows it: its end, or why there is none to read ("GitHub refused (401)"). */
export const CheckLogShown = Schema.Struct({
  name: Schema.String,
  url: Schema.NullOr(Schema.String),
  log: Schema.NullOr(Schema.String),
  missing: Schema.NullOr(Schema.String),
})
export type CheckLogShown = typeof CheckLogShown.Type

/**
 * Something the agent or Althar notes: a warning from the agent, or a change of scene, such as another agent taking over.
 * What Althar notes has a role, where it isn't news: `aside` for its own housekeeping along the way (a branch made, a
 * loop stopped), which a task's thread keeps with its lead's work; `relayed` for what the coordinator passed on to a
 * task's lead, written when the lead received it, which starts a round of the thread as what the person says does.
 */
export const NoticeItem = Schema.Struct({
  ...itemFields,
  kind: Schema.Literal('notice'),
  content: Schema.Struct({
    source: Schema.Literals(['agent', 'runtime']),
    severity: Schema.Literals(['info', 'warning', 'error']),
    title: Schema.String,
    description: Schema.NullOr(Schema.String),
    /** What the line is built on, kept apart from it: a host's raw answer, pretty-printed, drawn folded under "Details". */
    details: Schema.optional(Schema.String),
    /**
     * Words in the title that are links, by their label (#698, DEV-145): each is drawn as a link to its address. `at`, where
     * given, is where the label starts in the title, for a label that also stands earlier in it ("test" in "test / linux").
     */
    links: Schema.optional(Schema.Array(Schema.Struct({ label: Schema.String, url: Schema.String, at: Schema.optional(Schema.Number) }))),
    /** The failed checks the line names, such as the merge queue's: the end of each one's log, or why it couldn't be read, folded under it. */
    logs: Schema.optional(Schema.Array(CheckLogShown)),
    /**
     * How the thread draws it, where not as Althar's own line: an aside in the
     * work, what the coordinator relayed, or its task's folder going or coming
     * back, a line across the thread (ADR-056); the agent's context compacted,
     * a line with its summary behind it; or its turn interrupted by the person.
     * What was brought in from another tool, and where from, is Althar's own
     * line (`brought`, workspaces-and-runs, "Bringing in other tools' work").
     * One a newer home draws that this client doesn't know is `unknown`, drawn
     * as Althar's own line.
     */
    role: Schema.optional(OpenLiterals(['aside', 'relayed', 'folder', 'compacted', 'interrupted', 'brought'], 'unknown')),
    /**
     * For the agent compacting its context (`compacted`): how it stands, the
     * summary it kept where it said one, and why it failed. Its description
     * says how far it took the context, where Althar knows.
     */
    compaction: Schema.optional(
      Schema.Struct({
        status: Schema.Literals(['in_progress', 'completed', 'failed', 'cancelled']),
        summary: Schema.optional(Schema.String),
        error: Schema.optional(Schema.String),
      }),
    ),
    /** A task the line is about, which it links to: one this task's lead started (ADR-097), once. */
    task: Schema.optional(Schema.Struct({ taskId: Schema.String, slug: Schema.String, title: Schema.String, threadId: Schema.String })),
    /**
     * A step of the work it marks, drawn as a stamped row of its own (a task is a conversation plus parts, "How it reads"): a
     * change started, by its name and branch, and what it works toward where that isn't the task's.
     */
    step: Schema.optional(
      Schema.Struct({
        /** A change started, shipped, merged, kept together with another, or dropped; or a helper its lead started (ADR-087). */
        kind: Schema.Literals(['new_change', 'shipped', 'merged', 'joined', 'dropped', 'helper']),
        name: Schema.String,
        /** Its branch; for one shipped or merged, its pull request as people say it (PR #714). */
        branch: Schema.String,
        /** What it works toward, where that isn't the task's: another change's branch it stacks on, or a branch of its own. */
        toward: Schema.NullOr(Schema.String),
        /** Who split the work: its lead or the coordinator on their own, or its lead's git; Keep them together and Drop it offer only then. */
        by: Schema.optional(Schema.Literals(['lead', 'coordinator', 'git', 'person'])),
        /** The change it waits for to merge, without building on its code. */
        waits: Schema.optional(Schema.String),
        /** A helper's own thread, which its row opens to in place: what it did, as it did it. */
        thread: Schema.optional(Schema.String),
      }),
    ),
    /**
     * What the line offers: a review a lead or the coordinator offered a task whose work turned real with none
     * (`offer_review`), by its reviewer, which Add puts on and No thanks turns down for good; or, in the project's
     * conversation, what was picked to bring in from other tools and didn't come in, each by name and why, with what
     * Try again brings in again (`BringIn`, twice as once). (A preset is offered on its task's card, `presetOffer`, not here.)
     */
    offer: Schema.optional(
      Schema.Union([
        Schema.Struct({
          kind: Schema.Literal('review'),
          projectId: Schema.String,
          taskId: Schema.String,
          agentId: Schema.String,
          model: Schema.NullOr(Schema.String),
          effort: Schema.optional(Schema.NullOr(Schema.String)),
        }),
        Schema.Struct({
          kind: Schema.Literal('bring_in'),
          projectId: Schema.String,
          /** What didn't come in, by name, and why. */
          missed: Schema.Array(Schema.Struct({ name: Schema.String, why: Schema.String })),
          /** What trying again would bring in: empty where nothing that failed could come in on another try. */
          worktrees: Schema.Array(Schema.String),
          setups: Schema.Array(Schema.String),
          conversations: Schema.Array(Schema.String),
        }),
      ]),
    ),
    /**
     * For an agent's turn that failed: why, as the runtime classes it
     * (`auth_required`, `usage_limit`, `context_full`, `session_lost`,
     * `invalid_request`, `unknown`, `agent_exited`…), so the thread offers the
     * way out that fits.
     */
    failure: Schema.optional(Schema.String),
  }),
})

/** Something a review found: how much it matters, where it is, and what is wrong. */
export const Finding = Schema.Struct({
  severity: Schema.Literals(['blocking', 'major', 'minor', 'nit']),
  file: Schema.NullOr(Schema.String),
  line: Schema.NullOr(Schema.Number),
  claim: Schema.String,
  /** The finding in a line, as its reviewer titled it; absent from a review before reviewers gave one. */
  title: Schema.optional(Schema.NullOr(Schema.String)),
})
export type Finding = typeof Finding.Type

/**
 * Something the lead shows to say its change does what it should, with a
 * caption saying what it shows: a screenshot or a recording, as a picture
 * kept like one an agent hands back; a command or a test run, with its exit
 * code and the end of what it printed; or a response, a log or a note, as
 * text.
 */
export const Evidence = Schema.Struct({
  kind: Schema.Literals(['screenshot', 'recording', 'command', 'test_run', 'response', 'log', 'note']),
  caption: Schema.String,
  picture: Schema.NullOr(Picture),
  command: Schema.NullOr(Schema.String),
  exit: Schema.NullOr(Schema.Number),
  /** What it printed or said: its end, where it was long. */
  text: Schema.NullOr(Schema.String),
  /** Lines from the start of the text that weren't kept. */
  dropped: Schema.Number,
  /** For a picture of the work as built: the view it shows, by a name its lead keeps each time it takes it again ("Running page"). Absent where it gave none. */
  view: Schema.optional(Schema.String),
  /** For a picture: one of the options the person chose between, or an exploration, not the work as built. It stays in the thread, and out of a change's Outputs and its pull request. */
  option: Schema.optional(Schema.Boolean),
  /** For a picture: the work before the change, the before of the view it names (`view`, or its caption's name). Shown beside that view's picture in the pull request's comment. */
  before: Schema.optional(Schema.Boolean),
})
export type Evidence = typeof Evidence.Type

/** An explicit edit to the task's visual collection. Omission never removes a view. */
export const GalleryUpdate = Schema.Struct({
  mode: Schema.Literals(['patch', 'replace']),
  remove: Schema.optional(Schema.Array(Schema.String)),
  invalidate: Schema.optional(Schema.Array(Schema.String)),
})
export type GalleryUpdate = typeof GalleryUpdate.Type

/**
 * What a step reported when it ended: the lead's summary of its work or of
 * settling a review, or the review's verdict and findings. The person reads
 * this rather than the work itself.
 */
export const StepResultItem = Schema.Struct({
  ...itemFields,
  kind: Schema.Literal('step_result'),
  content: Schema.Struct({
    step: Schema.Literals(['implement', 'review', 'settle', 'publish']),
    /** The review round, from 0. */
    round: Schema.Number,
    summary: Schema.String,
    /** For publishing: the pull request it opened. */
    change: Schema.NullOr(ChangeSummary),
    verdict: Schema.NullOr(Schema.Literals(['pass', 'changes_requested'])),
    findings: Schema.Array(Finding),
    /** For the lead's steps: what the task has built, as it stood then; the latest is the task's summary, which a step that changed the work says again. Null where it didn't say. */
    built: Schema.NullOr(Schema.String),
    /** For the lead's steps: what it showed of its change working. */
    evidence: Schema.Array(Evidence),
    /** For the lead's steps: the views an earlier step pictured that still show the work as it is, carried beside this step's own pictures. */
    keptViews: Schema.optional(Schema.Array(Schema.String)),
    gallery: Schema.optional(GalleryUpdate),
    /** For the lead's steps: what it couldn't show, as it said it; null where it didn't say, so an earlier step's list stands. */
    unverified: Schema.NullOr(Schema.Array(Schema.String)),
    /** For the lead's steps: its pull request's description, by the slug of the repository each is for, where it gave one. */
    descriptions: Schema.optional(Schema.Record(Schema.String, Schema.String)),
    /**
     * For a review after a merge: the pull request that merged, which it read, as its host names it; and `kept` where what it
     * found stays in the thread, nothing in it being what the project's rule brings back to the person (only blocking and
     * major findings, under Major only). Absent for any other.
     */
    afterMerge: Schema.optional(Schema.Struct({ url: Schema.String, words: Schema.String, kept: Schema.optional(Schema.Boolean) })),
    /** Who reported it, for a review. */
    agentId: Schema.NullOr(Schema.String),
    /**
     * The model its step ran on, as the runtime recorded it when it reported (DEV-154): a session's own model is
     * what it is on now, so a round read after a switch would otherwise take the new model's name. Absent for
     * reports from before the runtime kept it.
     */
    model: Schema.optional(Schema.NullOr(Schema.String)),
  }),
})

/** A picture a lead showed in the thread, with what it shows. */
export const ShownPicture = Schema.Struct({ caption: Schema.String, picture: Picture })
export type ShownPicture = typeof ShownPicture.Type

/**
 * Pictures a lead showed the person in its thread, at any time, step or no
 * step (show_pictures): in order, each with a caption, kept as a step's
 * screenshots are, so they stay once the worktree is gone.
 */
export const PicturesItem = Schema.Struct({
  ...itemFields,
  kind: Schema.Literal('pictures'),
  content: Schema.Struct({ pictures: Schema.Array(ShownPicture) }),
})

/**
 * A version of one of the project's canvases an agent published (ADR-104),
 * in the thread it was published from: its name, title, kind and version,
 * which open it beside the conversation. Althar posts it; the canvas is the
 * project's, so it opens from any conversation, and this is only where it
 * was drawn.
 */
export const CanvasItem = Schema.Struct({
  ...itemFields,
  kind: Schema.Literal('canvas'),
  content: Schema.Struct({
    canvasId: Schema.String,
    name: Schema.String,
    title: Schema.String,
    canvasKind: CanvasKind,
    version: Schema.Number,
    note: Schema.NullOr(Schema.String),
    /** What the agent did: published this version, or opened it beside its conversation. */
    action: Schema.Literals(['published', 'opened']),
    /** Whether it opens beside the conversation as it arrives: a publish or an open that asked to. */
    open: Schema.Boolean,
  }),
})

/**
 * Something heard from outside, written by someone else: a comment or a
 * review on the task's pull request, its checks finishing, its being merged,
 * closed or marked ready. It reads as a quoted note, not either side of the
 * conversation.
 */
export const ArrivalItem = Schema.Struct({
  ...itemFields,
  kind: Schema.Literal('arrival'),
  content: Schema.Struct({
    source: Product,
    kind: Schema.Literals(['comment', 'review', 'checks', 'merged', 'closed', 'ready']),
    /** Who: a login; null for what the host itself says. */
    from: Schema.NullOr(Schema.String),
    /** Where: PR #12. */
    where: Schema.String,
    text: Schema.NullOr(Schema.String),
    verdict: Schema.NullOr(Schema.Literals(['approved', 'changes_requested', 'commented'])),
    path: Schema.NullOr(Schema.String),
    line: Schema.NullOr(Schema.Number),
    passed: Schema.NullOr(Schema.Number),
    failed: Schema.NullOr(Schema.Number),
    failing: Schema.Array(Schema.String),
    /** Checks its host doesn't require that failed or were cancelled (#1117): not counted in `failed`, said quietly. Absent where none. */
    optional: Schema.optional(Schema.Array(Schema.String)),
    /** Failed checks' logs: the end of each, or why Althar couldn't read it, with the check's page. None from before it read them here. */
    logs: Schema.Array(CheckLogShown),
    url: Schema.NullOr(Schema.String),
    /** Said by someone who can't write to the repository, as anyone can on a public one: not passed to the lead, for the person to pass on. */
    outsider: Schema.Boolean,
    /**
     * Said by a review or triage bot (code-hosts § Review and triage bots): `trusted`, it reached the lead as findings; not, it didn't, and this, the first it
     * said on the pull request, offers to trust it. Absent for anyone else, and for a bot Althar doesn't recognise as a reviewer.
     */
    bot: Schema.optional(Schema.Struct({ login: Schema.String, name: Schema.String, trusted: Schema.Boolean })),
  }),
})

/** A step of a task's plan: which kind, who does it, and whether it is skipped. For now only Implement and Review. */
export const PlanStep = Schema.Struct({
  key: Schema.Literals(['implement', 'review']),
  agentId: Schema.String,
  model: Schema.NullOr(Schema.String),
  /** How hard its agent thinks; the agent's own default without one. */
  effort: Schema.optional(Schema.NullOr(Schema.String)),
  skipped: Schema.Boolean,
})
export type PlanStep = typeof PlanStep.Type

export const WorkerPlanRequirements = Schema.Struct({
  repositoryCount: Schema.Int,
  homeOnly: Schema.Boolean,
  readOnly: Schema.Boolean,
})
export type WorkerPlanRequirements = typeof WorkerPlanRequirements.Type

/**
 * A command the agent left running in the background, such as a dev server
 * (docs/decisions/021): what it runs, where it answers once its output says,
 * and how it ended if it did by itself. It runs as long as its session does.
 */
export const BackgroundCommand = Schema.Struct({
  id: Schema.String,
  command: Schema.String,
  /** What the agent says it does, where it named it apart from the command: "Site dev server". Absent where it only gave the command. */
  name: Schema.optional(Schema.String),
  /** The command as it reads at a glance, without a leading `cd`, variables, `timeout` or output plumbing; the command is the whole of it. */
  label: Schema.optional(Schema.String),
  /** Where it answers, as its output said, as a browser opens it: http://localhost:5173/. Null until it says, or where it never does. */
  url: Schema.NullOr(Schema.String),
  startedAt: Schema.String,
  /** It ended by itself: when, and its exit code where its output says. Null while it runs. */
  ended: Schema.NullOr(Schema.Struct({ at: Schema.String, code: Schema.NullOr(Schema.Number) })),
})
export type BackgroundCommand = typeof BackgroundCommand.Type

/**
 * A task's agent holding a place among the agents this machine runs at once
 * (ADR-032): at work in its step or a turn, or, `kept`, only by what it left
 * running that is at work, which `running` lists, to stop from here.
 */
export const Holder = Schema.Struct({
  taskId: Schema.String,
  title: Schema.String,
  /** The thread its agent is on, where what it left running is stopped; null where it has no session yet. */
  threadId: Schema.NullOr(Schema.String),
  kept: Schema.Boolean,
  agentId: Schema.optional(Schema.String),
  role: Schema.optional(Schema.Literals(['lead', 'reviewer', 'helper'])),
  reason: Schema.optional(Schema.Literals(['starting', 'turn', 'background'])),
  running: Schema.Array(BackgroundCommand),
})
export type Holder = typeof Holder.Type

/** Why fewer agents than the person's number may work for now: this computer's memory, or its CPU, is under pressure. */
export const PlacesWhy = Schema.Literals(['memory', 'cpu'])
export type PlacesWhy = typeof PlacesWhy.Type

/**
 * Work waiting for a place among the agents this machine runs at once
 * (ADR-032), as it says why: how many tasks' agents are busy, which hold the
 * places, and how many the machine runs at once. It starts on its own, oldest
 * first, when one is free.
 */
export const Queued = Schema.Struct({
  busy: Schema.Int,
  atOnce: Schema.Int,
  holders: Schema.optional(Schema.Array(Holder)),
  configured: Schema.optional(Schema.Int),
  offline: Schema.optional(Schema.Boolean),
  /**
   * Held back for now, and why: with the person's number it would have a place, but this computer's memory or CPU lets
   * fewer agents work (`atOnce` < `configured`). It starts as that frees up, or at once where the person starts it anyway.
   */
  held: Schema.optional(PlacesWhy),
})

export type Queued = typeof Queued.Type

/**
 * Commits on a task's branch after its last pull request merged or closed,
 * in none yet: what Open a new pull request opens one with (ADR-034).
 */
/** What waits on a task's branch for Ship: since when it's held, and how many commits wait, across its repositories. */
export const HeldForShip = Schema.Struct({
  since: Schema.String,
  commits: Schema.Number,
})
export type HeldForShip = typeof HeldForShip.Type

export const Unshipped = Schema.Struct({
  commits: Schema.Int,
  /** Lines they add and remove, all together. */
  add: Schema.Int,
  del: Schema.Int,
})
export type Unshipped = typeof Unshipped.Type

/**
 * Where a task stands, as the coordinator's thread shows it. `drafting` is a
 * task drafted before its plan is proposed: off the board until the plan comes,
 * as its card in the coordinator's thread is. `kept` is a finished task that
 * isn't a change, which the person kept for later: out of Needs you as it is,
 * not settled.
 */
export const TaskPhase = Schema.Literals(['drafting', 'planned', 'held', 'running', 'waiting', 'ready', 'kept', 'stopped', 'settled'])
export type TaskPhase = typeof TaskPhase.Type

/**
 * What a task makes, read from what it has and never stored (DEV-96): a
 * change has a pull request of its own, commits or changes on its branch, or
 * a plan that ends in one; a review reads someone else's pull request and
 * has no branch of its own; any other task is plain: a question, a
 * prototype, a release from this Mac. A task only moves toward change.
 */
export const TaskKind = Schema.Literals(['change', 'review', 'plain'])
export type TaskKind = typeof TaskKind.Type

/**
 * What a plain task handed back, for its card while it waits for the person:
 * the pictures its lead showed when it last reported, and the files it wrote
 * or pointed at in what it last said, with the lines each added where git
 * can say.
 */
export const Handed = Schema.Struct({
  pictures: Schema.Array(Picture),
  files: Schema.Array(Schema.Struct({ path: Schema.String, add: Schema.NullOr(Schema.Number) })),
})
export type Handed = typeof Handed.Type

/** What a review says of a pull request as a whole: approve it, ask for changes, or only comment. */
export const ReviewVerdict = Schema.Literals(['approve', 'changes', 'comment'])
export type ReviewVerdict = typeof ReviewVerdict.Type

/**
 * Someone else's pull request a task reviews, as its card and its view show
 * it: what it is, whether it comes from outside, how big it is, what the
 * lead's latest draft found (its comments, the blocking among them, and its
 * verdict), and the review once posted.
 */
export const ReviewBrief = Schema.Struct({
  /** Its code host. */
  product: Product,
  /** owner/name. */
  repository: Schema.String,
  number: Schema.Int,
  url: Schema.String,
  title: Schema.String,
  author: Schema.String,
  outside: Schema.Boolean,
  additions: Schema.NullOr(Schema.Int),
  deletions: Schema.NullOr(Schema.Int),
  /** Comments in the latest draft, and those of them that block it; none before the lead drafts. */
  findings: Schema.Int,
  blocking: Schema.Int,
  /** The latest draft's verdict, as chosen; null before one is drafted, or while none is chosen. */
  verdict: Schema.NullOr(ReviewVerdict),
  /** The review, once posted: its link and when. */
  posted: Schema.NullOr(Schema.Struct({ url: Schema.String, at: Schema.String })),
  /**
   * Whether a draft waits for the person to post it. None once its review
   * was posted: written to again, its lead answered, it is finished, the
   * person's to mark done or keep for later, as a quick task is (ADR-051).
   */
  waiting: Schema.optional(Schema.Boolean),
  /**
   * How far its code is trusted, once the person said Run it (a task is a conversation plus parts): `safe`, it runs offline
   * with its install scripts off; `full`, as the team's code. Absent while its lead only reads.
   */
  trust: Schema.optional(Schema.Literals(['safe', 'full'])),
})
export type ReviewBrief = typeof ReviewBrief.Type

/**
 * An account that could take over a step a usage limit stopped: the agent,
 * the account, and the model it would run, by the agent's id for it (null
 * for the agent's own). Each of the project's accounts but the one out,
 * whether out of usage or signed in, as they stood: the window reads which
 * are free now.
 */
export const LimitChoice = Schema.Struct({ agentId: Schema.String, accountId: Schema.String, model: Schema.NullOr(Schema.String) })
export type LimitChoice = typeof LimitChoice.Type

/**
 * A step held until an agent's usage limit resets: which agent and account
 * ran out, and when it is back; why it waits rather than moving on (the
 * project waits for resets, it moves on but no other model was free, or the
 * person said to wait); and who could take it over now, as they stood when it
 * was held: the window reads which are free. Held before Althar kept those,
 * it says only who and until when.
 */
export const HeldForLimit = Schema.Struct({
  agentId: Schema.String,
  until: Schema.String,
  accountId: Schema.optional(Schema.NullOr(Schema.String)),
  why: Schema.optional(Schema.Literals(['waits', 'nothing_free', 'asked'])),
  choices: Schema.optional(Schema.Array(LimitChoice)),
  /** Held before it ran out, as a new step on an agent nearly out: the share of its tightest limit left, 0 to 100. */
  left: Schema.optional(Schema.Number),
})
export type HeldForLimit = typeof HeldForLimit.Type

/**
 * A step held for the connection (ADR-060): its agent, and its service by
 * name; `offline` while the computer is offline or its service doesn't
 * answer, when it carries on once it does; else when its service, which
 * failed, is tried again, and what it said.
 */
export const HeldForConnection = Schema.Struct({
  agentId: Schema.String,
  service: Schema.String,
  offline: Schema.Boolean,
  /** When it is tried again; null while it waits for the connection. */
  next: Schema.NullOr(Schema.String),
  failure: Schema.NullOr(Schema.String),
})
export type HeldForConnection = typeof HeldForConnection.Type

/** A lead yielded while the runtime watches a condition on its host, or waits until a time. */
export const HeldForExternal = Schema.Struct({
  reason: Schema.String,
  deadline: Schema.String,
  lastCheck: Schema.NullOr(Schema.String),
  nextCheck: Schema.String,
  error: Schema.NullOr(Schema.String),
})
export type HeldForExternal = typeof HeldForExternal.Type

/**
 * A task as its card shows it, in the coordinator's thread and on the board:
 * where it stands, its plan, the issue it came from, its pull request, the
 * step it is on, what its lead last reported, who leads it.
 */
/** A task's review after a merge, as its card and header say it: which pull request, and where the review stands. */
export const AfterMergeReview = Schema.Struct({
  url: Schema.String,
  /** The pull request, as its host names it: `#715`. */
  words: Schema.String,
  /** Under way, or what it found waits on the person. */
  state: Schema.Literals(['running', 'found']),
  /** How many it found, once it has. */
  findings: Schema.Number,
})
export type AfterMergeReview = typeof AfterMergeReview.Type

/**
 * How a task another waits for stands (tasks wait for their blockers): `planned` before its lead starts, `working` while it
 * does, `stuck` where it waits on the person or stopped, `review` with its pull request open, `merged` once it is done (its
 * work in), `abandoned` once given up: the task waiting for it then waits on the person.
 */
export const BlockerStanding = Schema.Literals(['planned', 'working', 'stuck', 'review', 'merged', 'abandoned'])
export type BlockerStanding = typeof BlockerStanding.Type

/** Another task named on a task's card: what it waits for, or what waits for it. */
export const LinkedTask = Schema.Struct({ taskId: Schema.String, slug: Schema.String, title: Schema.String, threadId: Schema.String })
export type LinkedTask = typeof LinkedTask.Type

/** A task this one waits for, and how it stands. */
export const TaskBlocker = Schema.Struct({ ...LinkedTask.fields, stands: BlockerStanding })
export type TaskBlocker = typeof TaskBlocker.Type

/** An issue a task came from, as its card shows it, with the connection Althar reads it and moves it through, where it has one. */
export const CardIssue = Schema.Struct({
  product: Product,
  key: Schema.String,
  title: Schema.String,
  url: Schema.String,
  connectionId: Schema.optional(Schema.String),
})
export type CardIssue = typeof CardIssue.Type

/** Another task, as a stopped task's card names it: by its title, and its thread, which opens it. */
export const TaskNamed = Schema.Struct({ threadId: Schema.String, title: Schema.String })
export type TaskNamed = typeof TaskNamed.Type

/**
 * What stopped a task's lead, and when. `by` is what its lead's turn ended in: the person declining a call or interrupting it,
 * else Althar, or null where nothing says. `who` is who stopped it, where it is on record: the person, the coordinator, or a
 * lead (another task's, named in `lead`); with `why`, the reason they gave, and `into`, the task its work went on in, where it
 * was folded into another. A task folded into another is settled in all but name: Resume still carries it on.
 */
export const TaskStopped = Schema.Struct({
  by: Schema.NullOr(Schema.Literals(['declined', 'interrupted', 'althar'])),
  at: Schema.NullOr(Schema.String),
  who: Schema.optional(Schema.Literals(['person', 'coordinator', 'lead'])),
  lead: Schema.optional(TaskNamed),
  why: Schema.optional(Schema.String),
  into: Schema.optional(TaskNamed),
})
export type TaskStopped = typeof TaskStopped.Type

export const TaskCard = Schema.Struct({
  /** Open errands concerning this task, from durable records. */
  errands: Schema.optional(Schema.Array(Schema.String)),
  taskId: Schema.String,
  threadId: Schema.String,
  title: Schema.String,
  slug: Schema.String,
  phase: TaskPhase,
  /**
   * Stopped, no agent on it: what stopped its lead, and when. Absent while it isn't stopped; `by` is null where nothing says,
   * `at` where nothing says when. Only a task an agent worked on is stopped, or one drafted whose plan never came: one whose
   * lead is on its way is under way.
   */
  stopped: Schema.optional(Schema.NullOr(TaskStopped)),
  /**
   * Stopped, with its open pull request ready to merge as it stands (not a draft, no conflict, every check passed): the
   * person can accept it all the same, next to Carry on. Absent otherwise.
   */
  mergeable: Schema.optional(Schema.Literal(true)),
  /**
   * Its folder being set up before its lead's first turn (ADR-023): the install its lockfile names, or the setup kept for its
   * repository. Absent otherwise.
   */
  settingUp: Schema.optional(Schema.Literals(['install', 'kept'])),
  /** Discarded: settled without its work, whatever it stood at then (drafted, planned, held or at work). Absent otherwise. */
  discarded: Schema.optional(Schema.Literal(true)),
  /**
   * Drafted, and its plan never came: no plan proposed or started, nothing run. Its card says so and offers to plan or
   * discard it, rather than that it stopped. Absent otherwise, and while its plan is still on its way.
   */
  unplanned: Schema.optional(Schema.Literal(true)),
  /** What it makes, read from what it has now: its card's word, and what the card shows. */
  kind: TaskKind,
  /** The task whose lead started it (ADR-097: leads start tasks), which its card names; absent for one the person or the coordinator started. */
  startedBy: Schema.optional(Schema.Struct({ taskId: Schema.String, slug: Schema.String, title: Schema.String, threadId: Schema.String })),
  /** A plain task's pictures and files, while it has some; null or absent otherwise. */
  handed: Schema.optional(Schema.NullOr(Handed)),
  /** The pull request a review task reads, and how its review stands; null or absent for any other task. */
  reviewing: Schema.optional(Schema.NullOr(ReviewBrief)),
  plan: Schema.NullOr(
    Schema.Struct({
      id: Schema.String,
      steps: Schema.Array(PlanStep),
      /** When it starts on its own; null once held or started. */
      startsAt: Schema.NullOr(Schema.String),
      /** How many seconds it waited from being proposed to starting on its own: the whole countdown, as the person's setting had it then. */
      startsAfter: Schema.optional(Schema.Number),
      /** Why the coordinator chose the lead. */
      reason: Schema.NullOr(Schema.String),
      /** What happens when the work is done; null where nothing reaches the repository's host. */
      end: Schema.NullOr(TaskEnd),
      /** Where it works (ADR-091); absent for a worktree, as a review's. */
      worksIn: Schema.optional(WorksIn),
      /** Facts the home reads before offering a worker for the lead. Absent on earlier homes. */
      workerRequirements: Schema.optional(WorkerPlanRequirements),
      /** The preset its parts are, as the card's kicker names it first (a task is a conversation plus parts): Change, Chat. */
      preset: Schema.optional(Schema.String),
      /** Its review reads only once it merges (a small change's, by an explicit request): its review step is then skipped before that, and still has its reviewer. */
      reviewAfterMerge: Schema.optional(Schema.Boolean),
      /** Why it works where it does, in the coordinator's words, where that isn't the project's default; null otherwise. */
      worksInWhy: Schema.optional(Schema.NullOr(Schema.String)),
      /** The task working Local now, which it would wait for there; null where Local is free. */
      localTaken: Schema.optional(Schema.NullOr(OtherTask)),
      /** The branch its work goes into, where it isn't the default (ADR-093): release/0.8.0; null or absent for the default. */
      toward: Schema.optional(Schema.NullOr(Schema.String)),
      /** Its repository's default branch, which `toward` null means. */
      defaultBranch: Schema.optional(Schema.String),
      /** Its repository's branches on the remote, its default first, for the person to point it at another until it starts. */
      branches: Schema.optional(Schema.Array(Schema.String)),
      /** That repository, by its id: where a branch named in the list that it doesn't have is made (CreateBranch). */
      repositoryId: Schema.optional(Schema.String),
    }),
  ),
  /** The (first) issue it came from, and the connection Althar reads it and moves it through, where it has one. */
  issue: Schema.NullOr(CardIssue),
  /** Each issue it came from, on any trackers, the first being `issue`. Absent where it came from one or none, and from a runtime before. */
  fromIssues: Schema.optional(Schema.Array(CardIssue)),
  /** Its pull request, once opened: the open one, else its latest. */
  change: Schema.NullOr(ChangeSummary),
  /** Its other pull requests, newest first: those of earlier rounds of its work, merged or closed (ADR-034). */
  earlier: Schema.optional(Schema.Array(ChangeSummary)),
  /** Commits after its last pull request merged or closed, in none yet; null or absent where there are none. */
  unshipped: Schema.optional(Schema.NullOr(Unshipped)),
  /**
   * What the person's turns with its lead committed after its plan waits on
   * its branch for Ship, which reviews it and then sends it up (a task is a
   * conversation plus parts, "A tweak waits for Ship"): since when, and how
   * many commits. Absent while nothing is held, and from a runtime before it.
   */
  held: Schema.optional(HeldForShip),
  /**
   * When its lead answered a turn the person's words began after its plan, where they haven't had the task open since: it
   * waits in Needs you until they do (a task is a conversation plus parts). Absent otherwise, and from a runtime before it.
   */
  replied: Schema.optional(Schema.String),
  /**
   * Its review after a merge (a task is a conversation plus parts, "After merge, in the same task"): the task's own reviewer
   * reading a pull request of its that merged with something no review read, under way, or what it found, waiting on the
   * person for Fix it or Leave it. Absent otherwise, and from a runtime before it.
   */
  afterMerge: Schema.optional(AfterMergeReview),
  /** How many changes it holds, where it holds more than one (a task is a conversation plus parts); absent for one. */
  changeCount: Schema.optional(Schema.Int),
  /**
   * Where each of its several changes stands, in the task's order (a task is a conversation plus parts, "The card keeps one
   * fact"): what its one sentence counts and names the exception of, and the marks at its foot. Absent with one change.
   */
  changeMarks: Schema.optional(
    Schema.Array(
      Schema.Struct({
        name: Schema.String,
        stands: Schema.Literals(['unshipped', 'draft', 'checking', 'failing', 'ready', 'merged', 'closed']),
      }),
    ),
  ),
  /**
   * A chat on Scratch (a task is a conversation plus parts, "Chats and Scratch"): off the board's lanes, listed by its latest
   * exchange, unless something of it waits on the person. Absent for a task on the board.
   */
  scratch: Schema.optional(Schema.Boolean),
  /**
   * What its lead left for the person to do on a tracker, where something waits: issues it drafted, to file, and changes it
   * proposed to its issue, to apply. Absent where none waits.
   */
  issues: Schema.optional(Schema.Struct({ drafts: Schema.Int, changes: Schema.Int })),
  /**
   * A chat's latest exchange, as Scratch lists it (a task is a conversation plus parts, "Chats and Scratch"): when, who said
   * it, and its first line. Absent for a task on the board, and for a chat with nothing said yet.
   */
  latest: Schema.optional(Schema.Struct({ at: Schema.String, by: Schema.Literals(['person', 'lead']), said: Schema.String })),
  /**
   * An aside the person opened with + and has said nothing in yet: its lead waits for their first words. Only its own pill
   * shows it, while it is open, and + opens it again rather than another. Absent otherwise.
   */
  unsaid: Schema.optional(Schema.Boolean),
  /**
   * An aside's answer, as its card in the coordinator's thread shows it: its lead's latest report, or, where the person asked
   * it more since, its lead's first line after they did. What its lead says after reporting (that Althar has the summary, say)
   * isn't its answer. Absent for a task on the board, and for an aside with neither yet.
   */
  answer: Schema.optional(Schema.String),
  /** A change ready that built nothing: no commits on its branch and no pull request open or merged. Absent otherwise. */
  nothingBuilt: Schema.optional(Schema.Boolean),
  /**
   * When a change of its reviewer takes effect, once its steps have begun: `now`, before its review round starts or between
   * rounds; `next_round`, in a round under way; `next_ship`, once a review of it ran to its end or it merged: the reviewer named
   * reads what ships next. A skipped review, or one never planned, is not a done one. Absent before its plan runs.
   */
  reviewerChange: Schema.optional(Schema.Literals(['now', 'next_round', 'next_ship'])),
  /**
   * The review its lead or the coordinator offered it, as its work turned real with none (`offer_review`, after the person
   * asked to harden a prototype, say), while it stands: no review on yet, not turned down, not merged. The offer's line in
   * the thread reads it: Add puts this step on (ChangeTeam), No thanks turns it down (DeclineReview), and it isn't offered
   * again. Absent otherwise.
   */
  reviewOffer: Schema.optional(PlanStep),
  /** The step it is on, by key, while it runs. */
  step: Schema.NullOr(Schema.String),
  /**
   * Its Ship's stop past its push, while `step` is still `publish`: marking its pull request ready, or waiting to merge on the
   * checks main requires. Its card and header say that stop, not the opening of a pull request. Absent otherwise.
   */
  shipAt: Schema.optional(Schema.Literals(['ready', 'merge'])),
  /** It runs a round of work after its plan, as the person asked its lead for more (ADR-034). */
  followUp: Schema.optional(Schema.Boolean),
  /** The latest summary the lead reported. */
  summary: Schema.NullOr(Schema.String),
  /** The agent that leads it, or last did: the plan's lead until one starts. */
  lead: Schema.NullOr(Schema.String),
  /** The model it leads on, by the agent's id for it: its latest session's, or the plan's; null for the agent's own. */
  leadModel: Schema.NullOr(Schema.String),
  /** How hard its lead thinks, by the agent's id for the level: its latest session's, or the plan's until that has said; null where neither says. */
  leadEffort: Schema.NullOr(Schema.String),
  branch: Schema.NullOr(Schema.String),
  startedAt: Schema.NullOr(Schema.String),
  /** It works Local, in its repositories' own checkouts here (ADR-091); absent for a worktree. */
  local: Schema.optional(Schema.Boolean),
  /** Started Local, it waits before any agent works on it: for another task's checkout, or the person's commit (ADR-091). */
  waitsForCheckout: Schema.optional(Schema.NullOr(CheckoutWait)),
  /** The branch its work goes into, where it isn't its repository's default (ADR-093): release/0.8.0; absent for the default. */
  toward: Schema.optional(Schema.String),
  /** The step is held until an agent's usage limit resets: which agent, and when it is back. */
  waits: Schema.NullOr(HeldForLimit),
  /** The step is held for the connection: absent or null otherwise (ADR-060). */
  reconnects: Schema.optional(Schema.NullOr(HeldForConnection)),
  externalWait: Schema.optional(HeldForExternal),
  /**
   * Ready, but its lead couldn't resolve the conflict its branch has with its
   * default branch, or fix the checks that failed on the merge Althar pushed,
   * so it's the person's: why, in a sentence. Without it, nothing is.
   */
  handedBack: Schema.optional(Schema.NullOr(Schema.String)),
  /**
   * Ready, its pull request's checks failing, and its lead brought them to the
   * person rather than fixing them (broken on its default branch, say), or
   * spent its tries (ADR-070): why, in a line, with what would fix it. Without
   * it, its lead sees them through, or they don't fail.
   */
  checksBack: Schema.optional(Schema.NullOr(Schema.String)),
  /**
   * Its branch conflicts with its default branch, and Althar didn't ask its
   * lead to resolve it though the rules say it resolves conflicts: why, in a
   * sentence, beside Resolve now (ADR-030). Without it, nothing is unsaid.
   */
  conflictUnsent: Schema.optional(Schema.NullOr(Schema.String)),
  /**
   * Althar couldn't look here for whether its branch conflicts with its
   * default branch, and its host doesn't say it does, where the rules say it
   * resolves conflicts: why, in a sentence, beside Look again (ADR-030).
   */
  conflictUnchecked: Schema.optional(Schema.NullOr(Schema.String)),
  /** When the person kept it for later, while it is (`kept`); null or absent otherwise. */
  keptAt: Schema.optional(Schema.NullOr(Schema.String)),
  /** It waits for a place among the agents this machine runs at once (ADR-032): how many are busy, and how many it runs at once. */
  queued: Schema.NullOr(Queued),
  /**
   * The tasks it waits for (tasks wait for their blockers), in the order they were named, merged ones included: its plan
   * starts by itself once they have all merged, and waits on the person once one of them is abandoned. Absent where it waits
   * for none, and once it started.
   */
  waitsFor: Schema.optional(Schema.Array(TaskBlocker)),
  /** The open tasks that wait for it, whose plans start once it merges. Absent where none does. */
  waitedBy: Schema.optional(Schema.Array(LinkedTask)),
  /** Its plan's first step waits for a place, nothing of it started yet: the person can still change the plan. */
  planWaits: Schema.optional(Schema.Boolean),
  /**
   * Its plan can still be held: nothing of it has begun, and its first step waits for a place among the agents or for its
   * checkout. Holding takes it out of the line until the person starts it.
   */
  holdable: Schema.optional(Schema.Boolean),
  /**
   * It waits for a place before any agent has worked on it, whatever its
   * kind (a plan's first step, a review's or a quick task's lead's first
   * turn): it is in its project's line, up next.
   */
  inLine: Schema.optional(Schema.Boolean),
  /**
   * It is under way and none of its agents is at work, and it goes on by
   * itself (ADR-065): its next turn waits for a place (`queued`), or its step
   * is held for a usage limit (`waits`) or the connection (`reconnects`). It
   * is up next, not running.
   */
  continues: Schema.optional(Schema.Boolean),
  /**
   * A turn Althar asked of its lead or reviewer waits for a place, none of its agents at work: the person can let it go
   * (`Interrupt` on its thread), and its agent reads what it would have said with its next turn.
   */
  turnWaits: Schema.optional(Schema.Boolean),
  /**
   * With `inLine`, or `continues` and `queued`: its place in its project's
   * Up next, in the order it gets one, what continues and the line in one
   * order, the person's where they put it; 1 gets one first.
   */
  place: Schema.optional(Schema.Int),
  /** With `inLine`: the line is in an order the person gave it, not the oldest first. */
  reordered: Schema.optional(Schema.Boolean),
  /** The automation whose run it is, where one started it; null or absent otherwise. */
  automation: Schema.optional(Schema.NullOr(FromAutomation)),
  /**
   * Its parts, offered to keep as a preset (a task is a conversation plus parts, "Presets"): parts the person set up
   * themselves a few times, by a name in plain words, which Keep saves from this task. `near`: a built-in preset they
   * are but for one thing, said instead of a new one. `kept`: the preset kept from it, which Undo removes. Absent where
   * nothing was offered on it, or the person said not to.
   */
  presetOffer: Schema.optional(
    Schema.Struct({
      name: Schema.String,
      parts: PresetParts,
      near: Schema.optional(Schema.Struct({ preset: Schema.String, differs: Schema.String })),
      kept: Schema.optional(Schema.Struct({ id: Schema.String, name: Schema.String })),
    }),
  ),
})
export type TaskCard = typeof TaskCard.Type

/**
 * A task in the coordinator's thread: its plan before it starts, with the
 * time it starts on its own, then its card as it runs. Althar posts it and
 * keeps it current; no agent writes it.
 */
export const TaskItem = Schema.Struct({
  ...itemFields,
  kind: Schema.Literal('task'),
  content: TaskCard,
})

/**
 * A run of the project Althar started itself (docs/decisions/022), in the
 * thread it was asked for in: where it runs, the command, where it answers
 * once it says, and how it ended. Althar posts it and keeps it current; it
 * stays as a record once the run is over.
 */
export const RunItem = Schema.Struct({
  ...itemFields,
  kind: Schema.Literal('run'),
  content: Schema.Struct({
    launchId: Schema.String,
    /** What it runs: the task's, or null for a copy of the default branch. */
    taskId: Schema.NullOr(Schema.String),
    /** Which of the project's runnables it runs (ADR-044), for running it again; absent on a card from before there were several. */
    runnableId: Schema.optional(Schema.NullOr(Schema.String)),
    /** What the project keeps it as, in the Run list: Storybook; absent or null where it has no name. */
    name: Schema.optional(Schema.NullOr(Schema.String)),
    /** Where it runs, in words: the task's title, the default branch, or the branch it runs. */
    where: Schema.String,
    /** The branch or pull request it runs a copy of, at a glance, and what was asked for, to run it again (ADR-066); absent or null for the default branch or a task's. */
    branch: Schema.optional(Schema.NullOr(Schema.String)),
    ref: Schema.optional(Schema.NullOr(Schema.Struct({ kind: Schema.Literals(['branch', 'pull_request']), which: Schema.String }))),
    command: Schema.String,
    url: Schema.NullOr(Schema.String),
    startedAt: Schema.String,
    /** It ended: by itself, with its exit code where known and its last line; or stopped. Null while it runs. */
    ended: Schema.NullOr(
      Schema.Struct({ at: Schema.String, code: Schema.NullOr(Schema.Number), stopped: Schema.Boolean, last: Schema.NullOr(Schema.String) }),
    ),
  }),
})

/** One commit of a push the lead asked for: by its short id and its subject. */
export const PushCommit = Schema.Struct({ sha: Schema.String, subject: Schema.String })
export type PushCommit = typeof PushCommit.Type

/**
 * The lead asking the person to push its new commits to the task's pull
 * request, in the task's thread: the commits that would go up, from the pull
 * request's head to the branch's, and the head Push pushes, which is the
 * person's to press. Althar keeps it current: pushed once they push that far;
 * replaced when the lead asks again; closed when the pull request is no
 * longer open. Where the branch changed since, so what was shown isn't on it
 * any more, it shows what is on it now, and Push pushes that.
 */
export const PushRequestItem = Schema.Struct({
  ...itemFields,
  kind: Schema.Literal('push_request'),
  content: Schema.Struct({
    /** The pull request's address: what Push names to the runtime. */
    url: Schema.String,
    /** How the lead and the person name it: PR #106, or web#3 in a task of several repositories. */
    where: Schema.String,
    product: Product,
    /** The commit Push pushes up to, and nothing newer: the branch's head when it was shown. */
    head: Schema.String,
    /** The commits that would go up, oldest first; the first few where there are many. */
    commits: Schema.Array(PushCommit),
    /** How many commits would go up in all. */
    count: Schema.Number,
    /** The branch changed since the lead asked: what this shows is what is on it now. */
    moved: Schema.Boolean,
    /**
     * Why what is on the branch now can't go up, where it changed so: it no
     * longer has what the pull request has (`rewritten`), so a push would need
     * forcing; the pull request has commits the branch doesn't (`behind`); or
     * Althar can't tell what the pull request has (`unknown`). Null otherwise.
     */
    blocked: Schema.NullOr(Schema.Literals(['rewritten', 'behind', 'unknown'])),
    state: Schema.Literals(['open', 'pushed', 'replaced', 'closed']),
    /** When it was pushed, replaced or closed; null while it's open. */
    settledAt: Schema.NullOr(Schema.String),
  }),
})

/** An issue's priority, as every tracker's fall into. */
export const IssuePriority = Schema.Literals(['urgent', 'high', 'medium', 'low', 'none'])
export type IssuePriority = typeof IssuePriority.Type

/** Where an issue the coordinator drafted stands: waiting on you, being filed, filed, not filed and why, perhaps filed (its answer was lost), or discarded. */
export const IssueDraftState = Schema.Literals(['pending', 'filing', 'filed', 'failed', 'uncertain', 'discarded'])
export type IssueDraftState = typeof IssueDraftState.Type

/**
 * One thing changed on an issue, or filed with it, in the tracker's words:
 * its status, closed, its priority, who it is assigned to (null for nobody),
 * its project, milestone, cycle or parent (null for none), its estimate, its
 * type, its components, when it is due, its title, its description; labels,
 * or people where it takes several, added and taken off; or, applied at
 * once, a comment and a link.
 */
export const IssueChangeLine = Schema.Union([
  Schema.Struct({
    field: Schema.Literals([
      'status',
      'close',
      'priority',
      'assignee',
      'project',
      'milestone',
      'cycle',
      'parent',
      'estimate',
      'type',
      'components',
      'due',
      'title',
      'description',
      'comment',
      'link',
    ]),
    to: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({ field: Schema.Literals(['labels', 'assignees']), add: Schema.Array(Schema.String), remove: Schema.Array(Schema.String) }),
])
export type IssueChangeLine = typeof IssueChangeLine.Type

/**
 * An issue the coordinator drafted on a connected tracker, in its thread
 * (docs/architecture/06, "Drafting issues"): where it goes, what it says,
 * and where it stands. Nothing is filed until the person files it here; they
 * can change it first, or discard it. Althar posts it and keeps it current.
 */
export const IssueDraftCard = Schema.Struct({
  draftId: Schema.String,
  product: Product,
  /** The tracker, by its product's name, and its site or account where another connection of the product would leave it unclear: Jira (acme.atlassian.net). */
  tracker: Schema.String,
  /** Where it goes there, by the tracker's name for it: a team, a project, a list on a board, a repository. */
  container: Schema.String,
  title: Schema.String,
  /** Markdown. */
  body: Schema.String,
  labels: Schema.Array(Schema.String),
  /** The priority it is filed with, where the tracker has priorities; null for none, or the tracker's default. */
  priority: Schema.NullOr(IssuePriority),
  state: IssueDraftState,
  /** Why it wasn't filed, while it stands failed, or why it may have been, while uncertain: in the tracker's words, or Althar's. */
  error: Schema.NullOr(Schema.String),
  /** The issue, once filed: its key as the tracker shows it, and its link. */
  issue: Schema.NullOr(Schema.Struct({ key: Schema.String, url: Schema.String })),
  /** What else it is filed with, in the tracker's words: its project, milestone, assignees and the like. Absent on drafts from before. */
  fields: Schema.optional(Schema.Array(IssueChangeLine)),
  /** Whether it was filed at once, as the person prefers, rather than waiting on them here. */
  direct: Schema.optional(Schema.Boolean),
  /** What its tracker left off once filed, in a line each: a label it hasn't, a field it refused. */
  leftOff: Schema.optional(Schema.Array(Schema.String)),
})
export type IssueDraftCard = typeof IssueDraftCard.Type

export const IssueDraftItem = Schema.Struct({
  ...itemFields,
  kind: Schema.Literal('issue_draft'),
  content: IssueDraftCard,
})

/** Where changes to issues stand: waiting on you, being applied, applied, not all applied (each issue says why), or discarded. */
export const IssueChangeState = Schema.Literals(['pending', 'applying', 'applied', 'failed', 'discarded'])
export type IssueChangeState = typeof IssueChangeState.Type

/**
 * Changes to one or more issues on the person's trackers, in the thread of
 * whoever proposed them (docs/architecture/06, "Changing issues"): each
 * issue, what changes on it, and how applying it went. Status, priority,
 * assignee, labels and closing wait on the person to apply them here, unless
 * the project lets them through; a comment and a link are applied already.
 * Althar posts it and keeps it current.
 */
export const IssueChangesCard = Schema.Struct({
  changesId: Schema.String,
  /** Why, in a sentence, where whoever proposed it said: its pull request merged. */
  note: Schema.NullOr(Schema.String),
  /** Where the note links to, where a pull request moved its task's issue: the pull request. */
  noteUrl: Schema.optional(Schema.NullOr(Schema.String)),
  /** The title of the task whose pull request moved its issue. */
  task: Schema.optional(Schema.NullOr(Schema.String)),
  state: IssueChangeState,
  /** Why not all of it applied, while it stands failed. */
  error: Schema.NullOr(Schema.String),
  /** Whether the project's rules applied it without asking. */
  direct: Schema.Boolean,
  issues: Schema.Array(
    Schema.Struct({
      product: Product,
      tracker: Schema.String,
      key: Schema.String,
      url: Schema.String,
      title: Schema.String,
      /** Its status before the change, in its tracker's words; unset on cards from before it was kept. */
      from: Schema.optional(Schema.NullOr(Schema.String)),
      /** Its status once a close applied, in its tracker's words. */
      became: Schema.optional(Schema.NullOr(Schema.String)),
      changes: Schema.Array(IssueChangeLine),
      /** Applied, or not and why; null until it was tried. */
      applied: Schema.NullOr(Schema.Boolean),
      error: Schema.NullOr(Schema.String),
    }),
  ),
})
export type IssueChangesCard = typeof IssueChangesCard.Type

export const IssueChangesItem = Schema.Struct({
  ...itemFields,
  kind: Schema.Literal('issue_changes'),
  content: IssueChangesCard,
})

/** How much a comment in a review matters, as its lead says: blocking it, a major or minor point, or a nit. */
export const ReviewSeverity = Schema.Literals(['blocking', 'major', 'minor', 'nit'])
export type ReviewSeverity = typeof ReviewSeverity.Type

/** Where a review the lead drafted stands: waiting on you, being posted, posted, not posted and why, perhaps posted (its answer was lost), or discarded. */
export const ReviewDraftState = Schema.Literals(['pending', 'posting', 'posted', 'failed', 'uncertain', 'discarded'])
export type ReviewDraftState = typeof ReviewDraftState.Type

/** A comment in a review draft, on a line of the pull request as it now reads: kept, or dropped by the person. */
export const ReviewComment = Schema.Struct({
  id: Schema.String,
  path: Schema.String,
  line: Schema.Int,
  /** Markdown. */
  body: Schema.String,
  severity: ReviewSeverity,
  kept: Schema.Boolean,
})
export type ReviewComment = typeof ReviewComment.Type

/**
 * A review the lead of a review task drafted of someone else's pull request,
 * in the task's thread (docs/architecture/06, "Reviewing someone else's pull
 * request"): the pull request, the lead's verdict and the one chosen, the
 * summary, its comments on lines, and where it stands. Nothing reaches the
 * code host until the person posts it here, or their setting posts their
 * team's; they can change it first, or discard it. Althar posts it and keeps
 * it current.
 */
export const ReviewDraftCard = Schema.Struct({
  draftId: Schema.String,
  product: Product,
  /** The pull request's repository, as its host names it: owner/name. */
  repository: Schema.String,
  number: Schema.Int,
  url: Schema.String,
  title: Schema.String,
  /** Who opened it, by their login. */
  author: Schema.String,
  /** It comes from outside the repository's people: from a fork, or by an author the host doesn't name one of them. */
  outside: Schema.Boolean,
  /** It comes from a fork: why it counts as outside, where it does. */
  fork: Schema.Boolean,
  /** The agent that drafted it, by name; null where Althar couldn't tell. */
  drafter: Schema.NullOr(Schema.String),
  /** Who it posts as on the host: the connection's account. */
  account: Schema.NullOr(Schema.String),
  /** The lead's verdict: only a suggestion. */
  suggested: ReviewVerdict,
  /** The verdict it posts with: the lead's to begin with, but none for an outside pull request the lead would approve. */
  verdict: Schema.NullOr(ReviewVerdict),
  /** Markdown. */
  summary: Schema.String,
  comments: Schema.Array(ReviewComment),
  state: ReviewDraftState,
  /** Why it wasn't posted, while it stands failed, or why it may have been, while uncertain: in the host's words, or Althar's. */
  error: Schema.NullOr(Schema.String),
  /** The review, once posted: its link and when. */
  review: Schema.NullOr(Schema.Struct({ url: Schema.String, at: Schema.String })),
  /**
   * The automation whose run drafted it, where one did, and whether its
   * reviews post themselves now: its first waits for the person, who can let
   * the next ones post. Null or absent otherwise.
   */
  automation: Schema.optional(Schema.NullOr(Schema.Struct({ ...FromAutomation.fields, postsReviews: Schema.Boolean }))),
})
export type ReviewDraftCard = typeof ReviewDraftCard.Type

export const ReviewDraftItem = Schema.Struct({
  ...itemFields,
  kind: Schema.Literal('review_draft'),
  content: ReviewDraftCard,
})

/**
 * Althar setting up a task's worktree before its lead starts (ADR-023), in
 * the task's thread: the repository, what runs, and how it ended. Althar
 * posts it and keeps it current; it stays as a record once the setup is over.
 */
export const SetupItem = Schema.Struct({
  ...itemFields,
  kind: Schema.Literal('setup'),
  content: Schema.Struct({
    /** The repository whose worktree it sets up, by name. */
    repository: Schema.String,
    command: Schema.String,
    /** It is the setup kept for the repository, rather than the install Althar worked out from its lockfile. */
    kept: Schema.Boolean,
    startedAt: Schema.String,
    /**
     * How it ended: its exit code, 0 for done, null where it didn't end by
     * itself; out of time; stopped because Althar quit; what it copied and
     * the end of what it printed; and the files a recorded setup names that
     * it couldn't copy, which fail it too (ADR-080). Null while it runs.
     */
    ended: Schema.NullOr(
      Schema.Struct({
        at: Schema.String,
        code: Schema.NullOr(Schema.Number),
        timedOut: Schema.Boolean,
        stopped: Schema.Boolean,
        last: Schema.NullOr(Schema.String),
        missing: Schema.optional(Schema.Array(Schema.String)),
      }),
    ),
  }),
})

/**
 * An automation in the coordinator's thread: as the coordinator proposed or
 * changed it, or asking the person to resume it or run it now. The person
 * turns it on there. Althar posts it and keeps it current.
 */
export const AutomationItem = Schema.Struct({
  ...itemFields,
  kind: Schema.Literal('automation'),
  content: AutomationCard,
})

/**
 * The coordinator asking the person to stop, hold, restart, settle or accept
 * a task, or answer its stuck step, in its thread, where no message of theirs
 * in that turn asked it to (ADR-086): one button, which does it as the
 * person's own press, and Not now. Answered, it says what became of it: done, declined, or nothing to do
 * any more and why. Althar posts it and keeps it current.
 */
export const TaskAskItem = Schema.Struct({
  ...itemFields,
  kind: Schema.Literal('task_ask'),
  content: Schema.Struct({
    taskId: Schema.String,
    /** The task's own thread, where its title opens it. */
    threadId: Schema.String,
    slug: Schema.String,
    /** The task's title when it was asked. */
    title: Schema.String,
    /**
     * What it asks: to stop the task, or only its lead's turn; hold its plan; restart it; settle it done, kept for later, or
     * discarded; accept it by merging it here, or push what merged; or answer its stuck step: accepted as it is, its review
     * skipped, tried again, or handed on.
     */
    move: Schema.Literals([
      'stop',
      'stop_turn',
      'hold',
      'restart',
      'done',
      'keep',
      'discard',
      'merge_here',
      'push_here',
      'as_is',
      'skip_review',
      'again',
      'hand_on',
    ]),
    /** Where it goes, where the card names it: the branch a merge here goes into, or the model a stuck step is handed to. */
    to: Schema.optional(Schema.String),
    /** Why the coordinator asks, in a line. */
    why: Schema.NullOr(Schema.String),
    state: Schema.Literals(['open', 'done', 'declined', 'moot']),
    /** What was done, or why there was nothing to do; null while open, and when declined. */
    said: Schema.NullOr(Schema.String),
  }),
})

/**
 * An agent's change to a setting, in its thread (ADR-097): a line with Undo, or a card the person presses where it loosens
 * what asks and no message of theirs asked for it. Althar posts it and keeps it current.
 */
export const SettingItem = Schema.Struct({
  ...itemFields,
  kind: Schema.Literal('setting'),
  content: SettingChangeCard,
})

/** One step of a small change, as its card shows it: what happened, and when. */
export const SmallChangeStep = Schema.Struct({
  key: Schema.Literals(['started', 'changed', 'checks', 'merged', 'review']),
  /** What happened, in a few words: "Changed 1 line in RunMenu.tsx", "Checks pass". */
  what: Schema.String,
  /** When it happened; null until it has. */
  at: Schema.NullOr(Schema.String),
  done: Schema.Boolean,
})

/**
 * A small change's card in its thread: the one-step path a change of a few lines takes. It says what it skipped, each
 * step with its time, and Merge, which still asks; Make it a full task takes the review before it merges instead of
 * after. Althar posts it when the change starts and keeps it current.
 */
export const SmallChangeItem = Schema.Struct({
  ...itemFields,
  kind: Schema.Literal('small_change'),
  content: Schema.Struct({
    taskId: Schema.String,
    /** The task's own thread, where its title opens it. */
    threadId: Schema.String,
    slug: Schema.String,
    title: Schema.String,
    /** Who leads it, and on which model and effort: the lighter one the small path picks. */
    lead: Schema.Struct({
      agentId: Schema.String,
      model: Schema.NullOr(Schema.String),
      effort: Schema.optional(Schema.NullOr(Schema.String)),
    }),
    /** What the path leaves out, in a short line each: "no plan", "reviewed after it merges". */
    skips: Schema.Array(Schema.String),
    /** Explicit after-merge timing; false for new size-only Small changes. Absent on older cards. */
    reviewAfterMerge: Schema.optional(Schema.Boolean),
    steps: Schema.Array(SmallChangeStep),
    /** Its pull request as last seen, where it has one: Merge acts on it, and the card says when it is merged. */
    change: Schema.NullOr(ChangeSummary),
    /** Where its review went once it merged, where one was started: the task that reads the merged change. */
    review: Schema.optional(
      Schema.NullOr(Schema.Struct({ taskId: Schema.String, slug: Schema.String, threadId: Schema.String, title: Schema.String })),
    ),
    /** The person made it a full task, reviewed before it merges: the review task it was given, before and after it merges. */
    fullTask: Schema.optional(
      Schema.NullOr(Schema.Struct({ taskId: Schema.String, slug: Schema.String, threadId: Schema.String, title: Schema.String })),
    ),
    /**
     * Where that full task's review stands: reading, its draft approving or with nothing on its lines (`clear`), with
     * findings on lines (`found`, how many), or its run over with no draft (`stopped`); when it drafted. Absent where it
     * isn't a full task, and from a runtime before it.
     */
    reviewBefore: Schema.optional(
      Schema.Struct({
        state: Schema.Literals(['running', 'clear', 'found', 'stopped']),
        findings: Schema.Number,
        at: Schema.NullOr(Schema.String),
      }),
    ),
    /**
     * What its review after the merge brings back: the project's rule (`afterMergeReview`), the task's own word over it (null
     * where it has none; SetReviewAfterMerge changes it until it merges), and what holds of the two. `none` holds: no review
     * after its merge. Absent from a runtime before it.
     */
    afterMerge: Schema.optional(
      Schema.Struct({
        project: AfterMergeRule,
        task: Schema.NullOr(Schema.Literals(['review', 'none'])),
        holds: AfterMergeRule,
      }),
    ),
    /** Who reads it after it merges, as its plan names them; null where its plan names none. Absent from a runtime before it. */
    reviewer: Schema.optional(Schema.NullOr(Schema.Struct({ agentId: Schema.String, model: Schema.NullOr(Schema.String) }))),
    /**
     * Its review after the merge, once one is owed: under way, nothing found, only what the rule keeps in the thread
     * (`quiet`), what waits on the person (`found`), its lead fixing that, the person leaving it, or stopped; how many it
     * found; and its report's item in this thread,
     * where its findings are, once it reported. Absent before one is owed, and from a runtime before it.
     */
    reviewAfter: Schema.optional(
      Schema.Struct({
        state: Schema.Literals(['running', 'clear', 'quiet', 'found', 'fixing', 'left', 'stopped']),
        findings: Schema.Number,
        at: Schema.NullOr(Schema.String),
        item: Schema.NullOr(Schema.String),
      }),
    ),
  }),
})

/**
 * Auto moving a task's lead to a lighter model, in its thread, because the plan is nearly out: from and to which model,
 * the plan's usage and when it resets, and the way back for this task. Its words after the line are the new model's.
 * Althar posts it and keeps it current.
 */
export const ModelMoveItem = Schema.Struct({
  ...itemFields,
  kind: Schema.Literal('model_move'),
  content: Schema.Struct({
    taskId: Schema.String,
    /** The model it moved from, and the lighter one it moved to, as the agent's ids for them. */
    from: Schema.Struct({ agentId: Schema.String, model: Schema.NullOr(Schema.String) }),
    to: Schema.Struct({ agentId: Schema.String, model: Schema.NullOr(Schema.String) }),
    /** Why: which window of the plan, the share of it used, and when it resets. */
    why: Schema.Struct({
      /** 0 to 100, used. */
      percent: Schema.Number,
      /** The plan's own name, as the line says it: Claude. */
      plan: Schema.String,
      /** The window as a thread says it: "the week". */
      window: Schema.String,
      resetsAt: Schema.NullOr(Schema.String),
    }),
    /** The person kept the heavier model for this task: the way back was pressed, and Undo puts the move again. */
    kept: Schema.Boolean,
  }),
})

/** Where one pull request in the merge line stands. */
export const MergeLineState = Schema.Literals(['waiting', 'checks', 'queued', 'merging', 'merged', 'sent_back', 'conflict'])
export type MergeLineState = typeof MergeLineState.Type

/**
 * The merge line for a branch, in the thread of whoever asked for the merges: each pull request in order, with where it
 * stands. Althar posts it once and keeps it current; it folds to one line once every pull request has merged.
 */
export const MergeLineItem = Schema.Struct({
  ...itemFields,
  kind: Schema.Literal('merge_line'),
  content: Schema.Struct({
    /** The repository and branch it is for, which tell its card from another's in the same thread. */
    key: Schema.String,
    /** The branch, where it isn't the repository's default; null where it is. */
    branch: Schema.NullOr(Schema.String),
    rows: Schema.Array(
      Schema.Struct({
        number: Schema.Number,
        title: Schema.String,
        url: Schema.String,
        state: MergeLineState,
        /** For a pull request that needs someone: what is wrong, and who settles it. */
        reason: Schema.optional(Schema.String),
      }),
    ),
  }),
})

export const ThreadItem = Schema.Union([
  SettingItem,
  SmallChangeItem,
  ModelMoveItem,
  MergeLineItem,
  UserMessageItem,
  AgentTextItem,
  ToolCallItem,
  PlanItem,
  NoticeItem,
  StepResultItem,
  TaskItem,
  ArrivalItem,
  QuestionItem,
  RunItem,
  IssueDraftItem,
  SetupItem,
  PushRequestItem,
  ReviewDraftItem,
  IssueChangesItem,
  AutomationItem,
  PicturesItem,
  TaskAskItem,
  CanvasItem,
])
export type ThreadItem = typeof ThreadItem.Type

/** A thread's items as a client reads them: one of a kind a newer home has and this client doesn't know is left out. */
export const ThreadItems = KnownArray('kind', ThreadItem.members)

/** How full an agent's context is: the tokens in it, and how many it holds. */
export const ContextUse = Schema.Struct({ used: Schema.Number, size: Schema.Number })
export type ContextUse = typeof ContextUse.Type

/**
 * What a task, or the coordinator's day, used of one account its agents ran
 * on (ADR-084): on a plan, the share of its week; paid per use, the dollars.
 * No total across accounts: a share of a week and dollars don't add up. An
 * agent that reaches several providers, each paid its own way (OpenCode), has
 * one for each provider its turns ran on.
 */
/**
 * Where a turn's time went, in milliseconds (a task is a conversation plus
 * parts, "Where a turn's time goes"): waiting for a place among the agents at
 * work here, starting its session or handing it over to a fresh one, and the
 * agent's own work, of which the tools it ran are a part. Kept as the turn
 * ends; a turn before Althar kept it has none.
 */
export const TurnTime = Schema.Struct({
  /** The turn, by its delivery's id, as its items name it (`turn`). */
  id: Schema.String,
  place: Schema.Number,
  session: Schema.Number,
  /** How its session began, where it was its first turn: started for the work, or handed over to a fresh one; null otherwise. */
  starting: Schema.NullOr(Schema.Literals(['start', 'handover'])),
  work: Schema.Number,
  tools: Schema.Number,
  /** In a task of several changes, where its commits went: each change it committed to, by name, and how many. */
  changes: Schema.optional(Schema.Array(Schema.Struct({ name: Schema.String, commits: Schema.Number }))),
  /** Getting the turn ready before its prompt went out: the coordinator's copies, its news, the turn's record. */
  ready: Schema.optional(Schema.Number),
  /** Of `ready`, bringing the coordinator's copies of the repositories up to date. */
  copies: Schema.optional(Schema.Number),
  /** From the prompt going out to the agent's first word, thought or call. */
  first: Schema.optional(Schema.Number),
})
export type TurnTime = typeof TurnTime.Type

export const AccountUse = Schema.Struct({
  accountId: Schema.String,
  agentId: Schema.String,
  agentName: Schema.String,
  accountName: Schema.String,
  /** Whether the agent has more than one account here, so the account's own name tells them apart. */
  several: Schema.Boolean,
  paidBy: Schema.Literals(['plan', 'key']),
  /** The plan as the agent names it: pro, max; null paid per use, or where it didn't say. */
  plan: Schema.NullOr(Schema.String),
  /** On a plan, the points of its week's percent it took: an estimate, from the week's readings; null where none was read. */
  took: Schema.NullOr(Schema.Number),
  /** Paid per use, the dollars spent: what the agent said, else its tokens at list prices; null where neither is known. */
  spent: Schema.NullOr(Schema.Number),
  /** Whether the figure is an estimate: a plan's share always; dollars where a session was priced at list prices, not said by its agent. */
  estimated: Schema.Boolean,
  /** The models that ran on it, by id, in the order they first did. */
  models: Schema.Array(Schema.String),
  tokens: Schema.Number,
  /** Its tokens by model, in the order the models first ran (ADR-087: a task's usage by model, its helpers' too). */
  byModel: Schema.optional(Schema.Array(Schema.Struct({ model: Schema.String, tokens: Schema.Number }))),
  /** The provider within the agent these turns ran on, by id (OpenCode's `opencode`, Zen); absent for an agent with one. */
  provider: Schema.optional(Schema.String),
  /** Why there is no figure, where it can't be known: said on the figure, as its place stays quiet. */
  why: Schema.optional(Schema.String),
})
export type AccountUse = typeof AccountUse.Type

/**
 * The project as Althar runs it itself, with no agent (docs/decisions/022):
 * in a task's worktree, to see what it built, or, `taskId` null, in a copy of
 * the default branch, or of a branch or pull request Althar fetched for it
 * (ADR-066). It runs until the person stops it, or Althar quits.
 */
export const Launch = Schema.Struct({
  ...BackgroundCommand.fields,
  taskId: Schema.NullOr(Schema.String),
  /** Which of the project's runnables it runs (ADR-044). */
  runnableId: Schema.NullOr(Schema.String),
  /** Where it runs, in words: the task's title, the default branch, or the branch it runs. */
  where: Schema.String,
  workerId: Schema.optional(Schema.String.check(Schema.isPattern(/^wrk_[a-f0-9]{32}$/))),
  /** The branch or pull request it runs a copy of, at a glance (feature/x, PR #12 · feature/x); none for the default branch or a task's. */
  branch: Schema.optional(Schema.NullOr(Schema.String)),
})
export type Launch = typeof Launch.Type

/**
 * Something a project runs, with no agent (ADR-044): one of a list in the
 * person's order, the first its default, each in one of its repositories.
 * Its command is what it runs where it is shown: in a task's worktree on the
 * task, in the default branch's copy on the project. One that is its
 * repository's own way (`own`) runs what is kept for the repository with
 * set_run_command, or worked out from it (ADR-023).
 */
export const Runnable = Schema.Struct({
  id: Schema.String,
  /** What it is, in a word or two, where someone named it: Storybook. */
  name: Schema.NullOr(Schema.String),
  /** What it runs: `bun --filter @althar/ui storybook`. */
  command: Schema.String,
  /** The repository it runs in, by name. */
  repository: Schema.String,
  /** It is its repository's own way to run, kept for it or worked out: no command of its own. */
  own: Schema.Boolean,
  /** Who said how it runs: worked out from the repository, or kept by the person, the coordinator or another agent. */
  from: Schema.Literals(['repository', 'person', 'coordinator', 'agent']),
})
export type Runnable = typeof Runnable.Type

export const SessionSummary = Schema.Struct({
  id: Schema.String,
  agentId: Schema.String,
  agentName: Schema.String,
  state: Schema.String,
  model: Schema.NullOr(Schema.String),
  /** The account it runs on, by its name; null where it isn't known. */
  account: Schema.NullOr(Schema.String),
  /** How hard it thinks, where the agent offers a choice. */
  effort: Schema.NullOr(Schema.String),
  /** The models the agent offers for this session. */
  models: Schema.Array(Schema.String),
  /** Whether a new message waits behind work already claimed, including a turn still preparing its prompt. */
  accepting: Schema.optional(Schema.Literals(['now', 'queued'])),
  turnRunning: Schema.Boolean,
  /** When the turn running started, by the runtime's clock; null between turns. What the wait for its first word is counted from. */
  turnStartedAt: Schema.NullOr(Schema.String),
  /**
   * When its last turn ended, by the runtime's clock; null before its first,
   * or where the runtime no longer holds it. A message delivered before it
   * was answered, if with nothing: no reply is waited for on it any more.
   */
  turnEndedAt: Schema.NullOr(Schema.String),
  /**
   * Whether the runtime still holds a session on this thread: the one that
   * takes a note, and that makes starting another refuse. A recorded session
   * it no longer has — left by a crash, or by a start that never took — looks
   * the same as a live one here, but can take neither a note nor a choice:
   * sending one back to such a lead has to start it afresh. While the thread
   * is held, a note waits its turn there, running or between turns.
   */
  held: Schema.Boolean,
  /**
   * A switch or a fresh session is taking the thread over, until it holds it, even after the one going out has let it go
   * (`held` false then): a model or effort picked now is the incoming session's, sent as on a held thread, never as a start.
   * `nextLead` is what that session leads as then.
   */
  handover: Schema.optional(Schema.Boolean),
  /** Who leads the thread from its next turn, where that was changed while it worked or waited; absent or null otherwise. */
  nextLead: Schema.optional(
    Schema.NullOr(Schema.Struct({ agentId: Schema.String, model: Schema.NullOr(Schema.String), effort: Schema.NullOr(Schema.String) })),
  ),
  /**
   * The lead it stands in for, where Althar handed the thread to it: who the task was given, why (its usage ran out, it was
   * nearly out, or it ended a step without its report), and when that one is back and takes over again (null: once the step
   * is done). Absent or null where it leads as chosen.
   */
  standsIn: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        agentId: Schema.String,
        model: Schema.NullOr(Schema.String),
        effort: Schema.NullOr(Schema.String),
        until: Schema.NullOr(Schema.String),
        why: Schema.optional(Schema.Literals(['limit', 'low', 'stall'])),
      }),
    ),
  ),
  /** How full its context is, in tokens, as the agent last said while it runs; null until it says, or where it doesn't. */
  context: Schema.NullOr(ContextUse),
  /** What it left running in the background, while it runs, in the order it started them. */
  background: Schema.Array(BackgroundCommand),
})
export type SessionSummary = typeof SessionSummary.Type

/** What a step a usage limit stopped asks with: whose account, when it resets (null where it didn't say), and who could take it over. */
export const LimitCall = Schema.Struct({
  accountId: Schema.NullOr(Schema.String),
  resetsAt: Schema.NullOr(Schema.String),
  choices: Schema.Array(LimitChoice),
  /** Asked before it ran out, as a new step on an agent nearly out: the share of its tightest limit left, 0 to 100. */
  left: Schema.optional(Schema.Number),
})
export type LimitCall = typeof LimitCall.Type

/**
 * A step of a task's plan that needs the person (docs/architecture/05): its
 * agent didn't report after a reminder, went, couldn't start, or a restart
 * stopped it; or review ran out of rounds with changes it hasn't seen.
 */
export const StuckStep = Schema.Struct({
  step: Schema.Literals(['implement', 'review', 'settle', 'publish']),
  why: Schema.Literals([
    'no_report',
    'session_ended',
    'failed_to_start',
    'restarted',
    'round_limit',
    'not_connected',
    'usage_limit',
    'stalled',
    'looping',
    'over_budget',
    'refused',
    // Its agent's service kept failing while the computer was online (ADR-060).
    'transient',
    // Its agent's account is signed out: signing it in again in Settings, then trying again, is the way on.
    'signed_out',
    // Its agent's sign-in was there and has ended: the same way on (DEV-196).
    'sign_in_ended',
    // Its agent isn't installed, or isn't where Althar runs it from: installing it in Settings, then trying again.
    'not_installed',
    // The lead stopped to wait for the person's answer: its detail is the question, and the answer starts it again.
    'waiting_on_person',
  ]),
  /** What went wrong, in the agent's or Althar's words; for the last round, the lead's summary. */
  detail: Schema.NullOr(Schema.String),
  /** The agent on the step. */
  agentId: Schema.NullOr(Schema.String),
  /** How hard it thought, where it said. */
  effort: Schema.optional(Schema.String),
  /** The review round, from 0. */
  round: Schema.Number,
  /** Review findings the lead hasn't settled. */
  open: Schema.Number,
  /** What Althar did before asking: told the agent to carry on, started it afresh, told it to try another way, or handed the step to another model. */
  tried: Schema.optional(Schema.Array(Schema.Literals(['carried_on', 'restarted', 'redirected', 'handed_on']))),
  /** For a usage limit: the account that reached it, and when it resets, where it said, and who could take the step over. */
  limit: Schema.optional(LimitCall),
  /** For a service that kept failing: its name. */
  service: Schema.optional(Schema.String),
  /** The model it last ran on, where it had one: the one that failed, so handing on can leave it out; for a sign-in refused, the provider within the agent that refused it (OpenCode Go). */
  model: Schema.optional(Schema.String),
  provider: Schema.optional(Schema.String),
})
export type StuckStep = typeof StuckStep.Type

/**
 * The kinds of what can't be undone, as a project's Rules list them
 * (ADR-097): lost work and history, publishing and merging, speaking for
 * the person, and secrets.
 */
export const IrreversibleKind = Schema.Literals(['history', 'publish', 'speak', 'secrets'])
export type IrreversibleKind = typeof IrreversibleKind.Type

/** Where a call that can't be undone goes: one of the person's MCP servers and its tool, or a command. */
export const IrreversibleThrough = Schema.Union([
  Schema.Struct({ server: Schema.String, tool: Schema.String }),
  Schema.Struct({ command: Schema.String }),
])

/** What a permission that can't be undone says on its card: the kind, the action, what can't be taken back, what it would post. */
export const Irreversible = Schema.Struct({
  kind: IrreversibleKind,
  /** The action, as its button says it: Merge #635. */
  verb: Schema.String,
  /** What it did, once allowed: Merged #635. */
  done: Schema.String,
  /** What can't be taken back, in one line. */
  stays: Schema.String,
  /** The words it would post, for one that speaks for the person. */
  words: Schema.optional(Schema.String),
  through: IrreversibleThrough,
})
export type Irreversible = typeof Irreversible.Type

/** A call waiting on the person: a permission the rules keep for them, a step that needs them, or an agent's question. */
export const AttentionRequest = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(['permission', 'stuck', 'question', 'checkout']),
  /** What the agent wants to do, as it put it. */
  title: Schema.String,
  /** Why it waits for the person: the rule that keeps it for them. */
  reason: Schema.String,
  command: Schema.NullOr(Schema.String),
  /** The command as it reads at a glance (see BackgroundCommand); absent where it is not shortened or there is no command. */
  label: Schema.optional(Schema.String),
  /** For a permission: a kind or a command the project always asks about keeps it, so no "always allow" can answer it. */
  held: Schema.optional(Schema.Boolean),
  /** For a permission the rules read as what can't be undone: what its card says (ADR-097). */
  irreversible: Schema.optional(Irreversible),
  /**
   * For a call that waits while the person is away: where else it reached them, and when. The turn isn't held by it: the
   * lead goes on with what doesn't need the answer, and the call is kept until answered.
   */
  reached: Schema.optional(Schema.Struct({ device: Schema.String, at: Schema.String })),
  /** For a call set aside so its lead could go on: it is told when the person answers. */
  setAside: Schema.optional(Schema.Boolean),
  /** For a step that needs the person: which, and why. */
  stuck: Schema.NullOr(StuckStep),
  /** For a Local task's checkout: what Althar asks before it takes it (ADR-091). */
  checkout: Schema.optional(CheckoutAsk),
  /** For an agent's question: what it asks, field by field; it is answered in the thread, where it was asked. */
  question: Schema.optional(
    Schema.Struct({
      message: Schema.String,
      fields: Schema.Array(QuestionField),
      /** Why it asks, in a line: what the agent said just before. */
      why: Schema.optional(Schema.String),
      /** Who asks: the agent and model of the session that asked. */
      askedBy: Schema.optional(Schema.Struct({ agentId: Schema.String, model: Schema.NullOr(Schema.String) })),
    }),
  ),
  /**
   * For a permission: what an "always" answer would keep in the project's
   * rules (ADR-018), and the scopes Allow always and Deny always each hold
   * for; none offered for an answer whose rule wouldn't hold, as Allow
   * always for what always asks. Absent where it can't be kept as a rule.
   */
  always: Schema.optional(
    Schema.Struct({
      /** This exact command; null where it runs none. */
      command: Schema.NullOr(Schema.String),
      /** How its command starts, as a rule keeps it: `git status`. */
      prefix: Schema.NullOr(Schema.String),
      kind: Schema.NullOr(RuleKind),
      allow: Schema.Array(AlwaysScope),
      deny: Schema.Array(AlwaysScope),
    }),
  ),
  createdAt: Schema.String,
})
export type AttentionRequest = typeof AttentionRequest.Type

/**
 * A file a task changed, from its base to its worktree as it stands: how,
 * how much, and whether some of that isn't committed yet, so isn't in what
 * Althar pushes.
 */
export const ChangedFile = Schema.Struct({
  path: Schema.String,
  /** Where it was, for a file that moved. */
  from: Schema.NullOr(Schema.String),
  status: Schema.Literals(['added', 'modified', 'deleted', 'renamed']),
  add: Schema.Number,
  del: Schema.Number,
  binary: Schema.Boolean,
  uncommitted: Schema.Boolean,
})
export type ChangedFile = typeof ChangedFile.Type

/** One of a task's repositories that merges on this Mac, with no pull request: the default branch it goes into, and the head of its branch as last read. */
export const TaskRepositoryHere = Schema.Struct({
  /** Its slug, which merging names it by. */
  repository: Schema.String,
  name: Schema.String,
  branch: Schema.String,
  head: Schema.NullOr(Schema.String),
  /**
   * Where the task's own branch stands on the repository's remote, for
   * pushing it without a connection: the remote it goes to, whether the
   * remote has it, how many commits of it the remote doesn't have, and the
   * host's page for a new pull request from it, where that can be told.
   * None for a repository without a remote. How many it doesn't have is
   * null until the remote says, as the task is looked at, unless this
   * computer knows it has them all.
   */
  remote: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        name: Schema.String,
        /** The task's branch, as it is named there. */
        branch: Schema.String,
        pushed: Schema.Boolean,
        ahead: Schema.NullOr(Schema.Number),
        newPullRequest: Schema.NullOr(Schema.String),
      }),
    ),
  ),
})
export type TaskRepositoryHere = typeof TaskRepositoryHere.Type

/** A task on the board: its card, how it ended, and, ready without a pull request, how big its change is. */
export const BoardTask = Schema.Struct({
  ...TaskCard.fields,
  state: Schema.String,
  createdAt: Schema.String,
  settledAt: Schema.NullOr(Schema.String),
  /** What a ready task, or a change at work, changed when it has no pull request to say so: its files, and lines added and removed. */
  changed: Schema.NullOr(Schema.Struct({ files: Schema.Number, add: Schema.Number, del: Schema.Number })),
  /** A ready task's repositories with no pull request, not merged yet, which merge here. */
  here: Schema.Array(TaskRepositoryHere),
})
export type BoardTask = typeof BoardTask.Type

/** A call that waits on the person, with the task it holds. */
export const BoardCall = Schema.Struct({
  ...AttentionRequest.fields,
  /** The task it waits in; null for a question the coordinator asks, which waits in its conversation. */
  taskId: Schema.NullOr(Schema.String),
  threadId: Schema.String,
  taskTitle: Schema.NullOr(Schema.String),
  taskSlug: Schema.NullOr(Schema.String),
})
export type BoardCall = typeof BoardCall.Type

/**
 * A terminal the person opened in a project: a shell of their own in a
 * pseudo-terminal, in the task's worktree, the project's repository, or the
 * folder a run ran in. It lives while Althar runs; none outlives it.
 */
export const ShownTerminal = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  /** The task whose worktree it opened in; null on the project. */
  taskId: Schema.NullOr(Schema.String),
  /** The run it was opened from, in that run's folder; null for none. */
  launchId: Schema.NullOr(Schema.String),
  /** The folder it opened in. */
  folder: Schema.String,
  /** Where that is, in words: the run's, the task's title, or the repository's name. */
  where: Schema.String,
  /** What runs in it in front now: the shell, or the program the person started from it (`vim`, `bun`). */
  title: Schema.String,
  /** Something besides the shell runs in it now: closing it stops that too. */
  busy: Schema.Boolean,
  startedAt: Schema.String,
  /** How its shell ended, where it did by itself and not well; one that ended well is gone. */
  exited: Schema.NullOr(Schema.Struct({ code: Schema.Number })),
})
export type ShownTerminal = typeof ShownTerminal.Type

/** What a command printed, as kept: its end, and how many lines before it weren't kept. */
export const OutputText = Schema.Struct({ text: Schema.String, dropped: Schema.Number })
export type OutputText = typeof OutputText.Type
