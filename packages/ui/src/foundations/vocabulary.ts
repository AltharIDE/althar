/*
 * The domain's vocabularies: the fixed sets of kinds and states that data
 * arrives in and components branch on. String enums, so values read the
 * same in data, stories and the DOM. Branch on them with an exhaustive
 * switch (see `unreachable`), so adding a member is a compile error
 * wherever it is not yet handled.
 */

/** Where something the agent listens to lives. */
export enum SourceKind {
  GitHub = 'github',
  GitLab = 'gitlab',
  Bitbucket = 'bitbucket',
  Linear = 'linear',
  Jira = 'jira',
  Confluence = 'confluence',
  Trello = 'trello',
  Opsgenie = 'opsgenie',
  Statuspage = 'statuspage',
  Loom = 'loom',
  /** Checks on a change, from whatever runs them. */
  Ci = 'ci',
}

/** A line of a diff. */
export enum DiffLineKind {
  /** The `@@` line that starts a run of changes. */
  Hunk = 'hunk',
  /** Unchanged, shown around the change. */
  Context = 'context',
  Added = 'added',
  Removed = 'removed',
}

/** Who made a model; decides its mark. A model from a lab not listed here shows no mark. */
export enum Lab {
  Anthropic = 'anthropic',
  OpenAI = 'openai',
  Google = 'google',
  Meta = 'meta',
  Mistral = 'mistral',
  DeepSeek = 'deepseek',
  XAI = 'xai',
  Alibaba = 'alibaba',
  Moonshot = 'moonshot',
  Zai = 'zai',
  MiniMax = 'minimax',
  Cohere = 'cohere',
  Microsoft = 'microsoft',
  Amazon = 'amazon',
  Nvidia = 'nvidia',
  IBM = 'ibm',
  Perplexity = 'perplexity',
  AI21 = 'ai21',
  Baidu = 'baidu',
  ByteDance = 'bytedance',
  Tencent = 'tencent',
  StepFun = 'stepfun',
  HuggingFace = 'huggingface',
  Ai2 = 'ai2',
  Liquid = 'liquid',
  Reka = 'reka',
  NousResearch = 'nousresearch',
  Inflection = 'inflection',
}

/**
 * What a tool call did. ACP's kinds, one for one (its execute is Run), and
 * finer kinds a consumer may pick from the tool's name where ACP has only one:
 * List and Create are reads and edits, Mcp, Agent, PullRequest, Comment and
 * Push are calls out. Anything else is Other, never a guess.
 */
export enum ToolKind {
  Read = 'read',
  List = 'list',
  Search = 'search',
  Edit = 'edit',
  Create = 'create',
  Delete = 'delete',
  Move = 'move',
  Run = 'run',
  Think = 'think',
  Fetch = 'fetch',
  Mcp = 'mcp',
  Agent = 'agent',
  PullRequest = 'pr',
  Comment = 'comment',
  Push = 'push',
  Other = 'other',
}

/** A tool call's progress. ACP's pending and in progress are both Running. */
export enum ToolState {
  Running = 'running',
  Done = 'done',
  /** It ran and did not succeed. The only state drawn in red. */
  Failed = 'failed',
  /** It never ran: you, a rule or the lead said no. */
  Declined = 'declined',
  /** It was stopped part way, with the turn. */
  Cancelled = 'cancelled',
}

/** What you told a task that couldn't finish to do. */
export enum StuckAnswer {
  /** Told the lead what to do instead. */
  Told = 'told',
  /** Handed the step to another agent. */
  Retried = 'retried',
  Abandoned = 'abandoned',
}

/** A step of a task's graph. */
export enum StepState {
  Started = 'started',
  Running = 'running',
  Done = 'done',
  Stopped = 'stopped',
}

/** How much a review finding matters. */
export enum Severity {
  High = 'high',
  Medium = 'medium',
  Low = 'low',
}

/** What a review step concluded. */
export enum Verdict {
  Pass = 'pass',
  Changes = 'changes',
  Blocked = 'blocked',
}

/**
 * Where a review finding stands. The lead settles findings by default: it
 * fixes what holds and sets aside what does not. A finding reaches you when
 * the lead cannot settle it, or when the project says every one should.
 */
export enum FindingState {
  /** Raised and not settled. */
  Open = 'open',
  /** The lead cannot settle it: it waits on you. */
  Yours = 'yours',
  /** You asked the lead to fix it. */
  ToFix = 'tofix',
  /** You told the lead what to do instead. */
  Told = 'told',
  /** You left it to the lead. */
  Lead = 'lead',
  Fixed = 'fixed',
  /** The lead set it aside, with a reason. */
  Aside = 'aside',
  /** You dismissed it. */
  Dismissed = 'dismissed',
}

/** How review findings reach you: a project setting. */
export enum FindingsReach {
  /** Only when the lead cannot settle one. */
  Stuck = 'stuck',
  /** Every finding, before the lead acts. */
  All = 'all',
  /** Every finding at first, then fewer as you agree with the lead. */
  Learn = 'learn',
}

/** A node of a task's graph, as a graph change shows it. */
export enum GraphNodeState {
  Done = 'done',
  Now = 'now',
  Next = 'next',
  /** Added by the change; dashed until it runs. */
  Added = 'added',
  /** A stopped attempt, which stays, hollow. */
  Stopped = 'stopped',
}

/** Your answer to a graph change that needs more than the run was given. */
export enum GraphAnswer {
  Apply = 'apply',
  Keep = 'keep',
}

/** Where a running task stands, on its card. */
export enum TaskStatus {
  Running = 'running',
  /** Something in it waits on you. */
  Yours = 'you',
  Done = 'done',
  /** Held for a usage limit. */
  Paused = 'paused',
  /** Stopped by you. */
  Stopped = 'stopped',
}

/** What a task does with its work when it is done. */
export enum TaskEnd {
  DraftPr = 'draft',
  ReadyPr = 'ready',
  /** Push the branch; no PR. */
  PushOnly = 'none',
}

/** Who answers a step's permission requests in a project. */
export enum PermissionPolicy {
  /** The lead allows what the task needs and passes the rest to you. */
  Lead = 'lead',
  /** Nothing asks; every request is still recorded. */
  AllowAll = 'all',
  /** Anything no rule covers waits for you. */
  Ask = 'ask',
}

/** What happens to a task when its runtime's account runs out. */
export enum LimitPolicy {
  /** Move the work to the next agent free. */
  Move = 'move',
  /** Keep its place and resume after the reset. */
  Wait = 'wait',
  Ask = 'ask',
}

/** An issue's workflow state, as issue trackers name them. */
export enum IssueStatus {
  Backlog = 'backlog',
  Todo = 'todo',
  InProgress = 'in_progress',
  Done = 'done',
  Cancelled = 'cancelled',
}

/** An issue's priority. */
export enum IssuePriority {
  None = 'none',
  Urgent = 'urgent',
  High = 'high',
  Medium = 'medium',
  Low = 'low',
}

/** An entry of the agent's plan. */
export enum PlanState {
  Done = 'done',
  Running = 'running',
  Queued = 'queued',
}

/** What you attached to a message. */
export enum AttachmentKind {
  Image = 'image',
  File = 'file',
  Paste = 'paste',
}

/** Where a message you sent stands with the agent. */
export enum Delivery {
  /** Read, or the agent was free when it arrived. */
  Delivered = 'delivered',
  /** Sent while the agent works: it waits until the agent is done with what it is doing. */
  Queued = 'queued',
  /** Sent now, while the agent works: it is stopping at a safe point to read it. */
  Interrupting = 'interrupting',
}

/** How far a permission reaches when you allow it always. */
export enum PermissionScope {
  /** Commands that start the same way: `bun test *`. */
  Prefix = 'prefix',
  /** This exact command. */
  Exact = 'exact',
  /** Everything of the request's kind, as the request describes it: anything that reaches staging. */
  Kind = 'kind',
}

/** An answer to a permission: ACP's four option kinds. */
export enum Decision {
  AllowOnce = 'allow_once',
  AllowAlways = 'allow_always',
  /** ACP's reject once. */
  Deny = 'deny',
  /** ACP's reject always: saved as a rule, like an always-allow. */
  DenyAlways = 'deny_always',
}

/** Who allowed a request without asking you. */
export enum AllowedBy {
  Rule = 'rule',
  Lead = 'lead',
}

/** For the default branch of an exhaustive switch: TypeScript fails the build if a member is unhandled. */
export function unreachable(value: never): never {
  throw new Error(`Unhandled value: ${String(value)}`)
}

/** One step on a task's track. */
export enum TrackStep {
  Done = 'done',
  /** The step it is on. */
  Now = 'now',
  /** Reached before, then sent back. */
  Seen = 'seen',
  Next = 'next',
}

/** The board's lanes, in the order work moves through them. */
export enum BoardLane {
  /** Handed out, not started. */
  Next = 'next',
  Running = 'running',
  /** A call only you can make. */
  Yours = 'you',
  Settled = 'settled',
}

/** Why a planned task has not started. */
export enum Wait {
  /** It starts after another task. */
  After = 'after',
  /** The project's workers are all busy. */
  Workers = 'workers',
  /** It is held on a call of yours. */
  You = 'you',
}

/** What a piece of settled work came to. */
export enum Outcome {
  Merged = 'merged',
  /** A question, answered; nothing built. */
  Answered = 'answered',
  /** A document, no code. */
  Artifact = 'artifact',
  /** Something the project now knows. */
  Knowledge = 'knowledge',
  /** Given up on; the reasoning kept. */
  Abandoned = 'abandoned',
}

/** Where a task's change stands. */
export enum ChangeState {
  /** A draft pull request: still being checked. */
  Draft = 'draft',
  /** Every check passed; waiting for you to accept it. */
  Ready = 'ready',
  Merged = 'merged',
}

/** One check on a change. */
export enum CheckState {
  Passed = 'passed',
  Running = 'running',
  /** Held on a call of yours. */
  Held = 'held',
  Queued = 'queued',
  Failed = 'failed',
}

/** The project window's views of its work. */
export enum Room {
  /** The conversation with the coordinator. */
  Talk = 'talk',
  Board = 'board',
  /** The conversation and the board side by side. */
  Both = 'both',
}

/** Where an agent runtime on this machine stands, as Charrette last found it. */
export enum RuntimeState {
  Ready = 'ready',
  /** Asking the runtime who it is signed in as, and what version it is. */
  Checking = 'checking',
  /** Its own login is open, in the browser or a terminal. */
  SigningIn = 'signing-in',
  SignedOut = 'signed-out',
  /** Its account has used its allowance until a reset. */
  OutOfUsage = 'out-of-usage',
  /** Not installed here. */
  Missing = 'missing',
  /** Older than the versions Charrette works with. */
  Outdated = 'outdated',
}

/** How this device gets at a project's source. */
export enum SourceOrigin {
  /** A folder already on this device, used as it is. */
  Existing = 'existing',
  /** Cloned into Charrette's own folder on this device. */
  Clone = 'clone',
  /** Part of the project, not yet on this device. */
  Later = 'later',
}

/** How another agent would be connected. */
export enum ConnectKind {
  /** Installed as its own app or command line, signed in through it. */
  App = 'app',
  /** An API, with a key kept in the system keychain. */
  Key = 'key',
  /** A model server running on this machine. */
  Local = 'local',
}
