import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'
import { FeedPosition } from '../identities'
import { KnownArray, OpenLiterals, OpenUnion } from '../open'
import { call, ClientAuthority, command, SocketAllowed } from './rpc'
import {
  AccountStatus,
  ApiError,
  BackgroundCommand,
  BoardCall,
  BoardTask,
  ContextUse,
  Cursor,
  Launch,
  PlacesWhy,
  PlanUsage,
  ProjectSummary,
  ShownTerminal,
  SignIn,
  StepResultItem,
} from './shared'

/**
 * How often a model ended a step without its report in the last week, even
 * once reminded, by agent and model: Althar handed each to another model, or
 * it needed the person. Pickers say it beside the model.
 */
export const MissedReports = Schema.Struct({
  agentId: Schema.String,
  /** The model's id at the agent; null for the agent's own default. */
  model: Schema.NullOr(Schema.String),
  count: Schema.Number,
})
export type MissedReports = typeof MissedReports.Type

export const AgentStatus = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  /** Signed in where any of its accounts is. */
  signIn: SignIn,
  /** The agent's own command for signing in, when it isn't. */
  login: Schema.String,
  /** Its own version, as its CLI says it; null where it doesn't. */
  version: Schema.NullOr(Schema.String),
  /** The ways Althar signs it in itself, without a terminal: in the browser, with a one-time code. */
  ways: Schema.Array(Schema.Literals(['browser', 'device'])),
  /** Its accounts, in the person's order. */
  accounts: Schema.Array(AccountStatus),
  /** More accounts can be added: its sign-in is kept in each account's own folder (ADR-012). */
  addsAccounts: Schema.Boolean,
  /** Its own command signs an account out, so each can be signed out from Althar, its usual folder's included. */
  signsOut: Schema.optional(Schema.Boolean),
  /** Its command is on this device, the person's or the copy Althar downloaded; an agent that ships with Althar always is. */
  installed: Schema.Boolean,
  /** It runs from the copy Althar downloaded, as the person has none of their own. */
  kept: Schema.Boolean,
  /**
   * Althar can download it for the person, about this big; null where it can't. `installing` while it does.
   * `pinned`, the one version it fetches from its maker (Antigravity's server); null for its latest release on GitHub.
   */
  download: Schema.NullOr(Schema.Struct({ size: Schema.String, installing: Schema.Boolean, pinned: Schema.NullOr(Schema.String) })),
  /** Its maker's page on installing it, for a person who installs it themselves; null where Althar names none. */
  guide: Schema.NullOr(Schema.String),
  /** It comes only from Althar's download, and its maker publishes none for this device's system and processor. */
  noBuild: Schema.optional(Schema.Boolean),
  /** Why Althar couldn't check it, in words for the person; null where it could. The other agents are checked all the same. */
  problem: Schema.NullOr(Schema.String),
})
export type AgentStatus = typeof AgentStatus.Type

export const Status = Schema.Struct({
  apiVersion: Schema.Number,
  appVersion: Schema.String,
  agents: Schema.Array(AgentStatus),
})
export type Status = typeof Status.Type

/** What a home's computer is, as it says when asked: for the window to say what it's on. */
export const Machine = Schema.Struct({
  /** As the system names itself: Ubuntu 24.04.1 LTS, macOS 26.1. */
  system: Schema.String,
  cores: Schema.Int,
  /** In bytes. */
  memory: Schema.Number,
  /** The room on the disk projects go on, in bytes; null where it can't be read. */
  disk: Schema.NullOr(Schema.Struct({ free: Schema.Number, size: Schema.Number })),
  /** git's version (2.43.0), or null where it isn't installed. */
  git: Schema.NullOr(Schema.String),
})
export type Machine = typeof Machine.Type

/**
 * The agents the home runs at once (ADR-032) as they stand, for the window's
 * load popover and the Agents at once slider: how many are at work, the
 * person's number (or the default), how many may work for now, fewer while
 * the home's computer is under load, and why, and how many tasks wait for
 * one. The number counts every agent the home starts, wherever it runs:
 * `onWorkers` says how many of those at work run on its workers.
 */
export const Places = Schema.Struct({
  busy: Schema.Int,
  configured: Schema.Int,
  atOnce: Schema.Int,
  /** Null while as many may work as the number says. */
  why: Schema.NullOr(PlacesWhy),
  waiting: Schema.Int,
  /** Of `busy`, those on the home's workers rather than its own computer; none where an older home doesn't say. */
  onWorkers: Schema.optionalKey(Schema.Int),
})
export type Places = typeof Places.Type

/** A task on the home, from any project: running, stopped, waiting on a call, or ready to accept. */
export const HomeTask = Schema.Struct({ ...BoardTask.fields, projectId: Schema.String })
export type HomeTask = typeof HomeTask.Type

/** A call on the home, from any project. */
export const HomeCall = Schema.Struct({ ...BoardCall.fields, projectId: Schema.String })
export type HomeCall = typeof HomeCall.Type

/** The task something the loop did happened to. */
const HomeEventTask = Schema.Struct({ id: Schema.String, threadId: Schema.String, slug: Schema.String, title: Schema.String })

/**
 * Something the loop did while the person was away, never something they
 * did: a step ending, with its result; a usage limit or a step gone quiet
 * that it dealt with; or permission asks answered within the projects'
 * rules, counted across every project.
 */
export const HomeEvent = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('step'),
    id: Schema.String,
    at: Schema.String,
    projectId: Schema.String,
    task: HomeEventTask,
    result: StepResultItem.fields.content,
  }),
  Schema.Struct({
    kind: Schema.Literal('dealt'),
    id: Schema.String,
    at: Schema.String,
    projectId: Schema.String,
    task: HomeEventTask,
    /** What it dealt with: an agent out of usage, or a step gone quiet. */
    about: Schema.Literals(['limit', 'stall']),
    title: Schema.String,
    description: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal('answered'),
    id: Schema.String,
    /** Omitted by older runtimes, whose answers all came from the rules. */
    by: Schema.optional(Schema.Literals(['rules', 'coordinator'])),
    /** The first of them. */
    at: Schema.String,
    count: Schema.Number,
  }),
])
export type HomeEvent = typeof HomeEvent.Type

/**
 * The home: every project, and across them, what waits on the person, what
 * runs, and what the loop did since they last left the home here, newest
 * first. Which section each goes in is the window's to say.
 */
export const HomeSnapshot = Schema.Struct({
  cursor: Cursor,
  position: Schema.optional(FeedPosition),
  /** When the person last left the home on this Mac; null before they ever did. */
  looked: Schema.NullOr(Schema.String),
  /** What the loop did is read from: when they last left the home, unless the window says. */
  since: Schema.String,
  tasks: Schema.Array(HomeTask),
  calls: KnownArray('kind', [HomeCall]),
  events: KnownArray('kind', HomeEvent.members),
  projects: Schema.Array(ProjectSummary),
})
export type HomeSnapshot = typeof HomeSnapshot.Type

/**
 * What changes, as it happens. `Changed` says a record changed, from the
 * store's change feed, with its cursor and, when it belongs to one, its
 * thread: a client reads again what shows it. `Streaming` is an agent's
 * message or thought as far as it has come, whole each time, before the store
 * has all of it: a client shows it in place of the item's text. `Context` is
 * how full the context of the agent on a thread is, as it last said. Neither
 * is in the feed, so they have no cursor.
 */
/** Who does a step of a plan being drafted, once the coordinator has written it and Althar knows the model. */
export const DraftStep = Schema.Struct({
  agentId: Schema.String,
  model: Schema.NullOr(Schema.String),
  effort: Schema.NullOr(Schema.String),
})
export type DraftStep = typeof DraftStep.Type

/**
 * A task the coordinator is drafting now, as far as it has written it, so its
 * card shows from the moment the draft begins: its title, whether its
 * description is written, the task it became once drafted, and its plan as
 * that is written. It lasts the coordinator's turn; once planned, its card is
 * in the thread.
 */
export const Draft = Schema.Struct({
  key: Schema.String,
  title: Schema.NullOr(Schema.String),
  brief: Schema.Boolean,
  taskId: Schema.NullOr(Schema.String),
  slug: Schema.NullOr(Schema.String),
  planning: Schema.Boolean,
  lead: Schema.NullOr(DraftStep),
  review: Schema.NullOr(DraftStep),
  noReview: Schema.Boolean,
  preset: Schema.NullOr(Schema.String),
  planned: Schema.Boolean,
  /** The person held it while it was drafted: its plan comes held. */
  held: Schema.Boolean,
  /** Its plan's call failed and no other has begun: it says it has no plan, rather than sizing it for ever. */
  unplanned: Schema.optional(Schema.Boolean),
  /** Its task was discarded while it was drafted. */
  discarded: Schema.optional(Schema.Boolean),
})
export type Draft = typeof Draft.Type

export const WatchEvent = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal('Changed'),
    cursor: Cursor,
    /** Present on WatchFrom. Carry this into the next saved FeedPosition. */
    checkpoint: Schema.optional(Schema.String),
    aggregateType: Schema.String,
    aggregateId: Schema.String,
    projectId: Schema.NullOr(Schema.String),
    threadId: Schema.NullOr(Schema.String),
    /** On a task's change that was a rename: the title it was given, and whether an agent (a lead or the coordinator) gave it, not the person. */
    renamedTo: Schema.optional(Schema.String),
    renamedByAgent: Schema.optional(Schema.Boolean),
  }),
  Schema.Struct({
    _tag: Schema.Literal('Streaming'),
    threadId: Schema.String,
    itemId: Schema.String,
    /** Where the thread places the item, so a window with a cleared view can tell whether it is in it. */
    sequence: Schema.Int,
    /** What it is and who is saying it, so a client can show it before it has read the item; one it doesn't know, it reads when it lands. */
    kind: OpenLiterals(['agent_message', 'agent_thought'], 'unknown'),
    agentId: Schema.String,
    /** Its text as far as it has come; to a watch that asked for `deltas`, what came after `offset`. */
    text: Schema.String,
    /**
     * To a watch that asked for `deltas`: how much of the item's text came
     * before `text`, which the same watch sent already. 0 sends it whole,
     * as the first time an item streams on that watch.
     */
    offset: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  }),
  Schema.Struct({ _tag: Schema.Literal('Context'), threadId: Schema.String, ...ContextUse.fields }),
  /** What the session on a thread has left running, whole each time it changes. */
  Schema.Struct({ _tag: Schema.Literal('Background'), threadId: Schema.String, background: Schema.Array(BackgroundCommand) }),
  /** What Althar runs of a project itself, whole each time it changes. */
  Schema.Struct({ _tag: Schema.Literal('Launches'), projectId: Schema.String, launches: Schema.Array(Launch) }),
  /** A project's terminals, whole each time one opens, closes, ends or starts or ends a program in front. */
  Schema.Struct({ _tag: Schema.Literal('Terminals'), projectId: Schema.String, terminals: Schema.Array(ShownTerminal) }),
  /** Every account's plan usage, whole each time it changes. */
  Schema.Struct({ _tag: Schema.Literal('PlanUsage'), usage: PlanUsage }),
  /** The tasks a coordinator thread is drafting now, as far as written, whole each time they change. */
  Schema.Struct({ _tag: Schema.Literal('Drafting'), threadId: Schema.String, drafts: Schema.Array(Draft) }),
  /** A command's output as far as it has come, while it runs: its last lines, whole each time, and how many came before them. */
  Schema.Struct({
    _tag: Schema.Literal('Output'),
    threadId: Schema.String,
    itemId: Schema.String,
    text: Schema.String,
    dropped: Schema.Number,
  }),
])
export type WatchEvent = typeof WatchEvent.Type

/**
 * An event of a watch as a client hears it: one of a type a newer home sends
 * and this client doesn't know is `Unknown`, which it passes over. A runtime
 * sends a `WatchEvent`, never `Unknown`.
 */
export const HeardEvent = OpenUnion('_tag', WatchEvent.members, 'Unknown')
export type HeardEvent = typeof HeardEvent.Type

/** Whether a client knows the event it heard. */
export const isKnownEvent = (event: HeardEvent): event is WatchEvent => event._tag !== 'Unknown'

/** A part of the whole, 0 to 1. */
const Part = Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 }))
/** A number of bytes. */
const Bytes = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0))

/** How hard macOS works to find memory, in its own three levels: the honest sign memory is short, as a Mac keeps it full of cache on purpose. */
export const MemoryPressure = Schema.Literals(['normal', 'warning', 'critical'])
export type MemoryPressure = typeof MemoryPressure.Type

/**
 * Work Althar runs, and its part of this computer, with everything it
 * started: a task's (its lead's agent, its steps' agents and its runs), a
 * project's coordinator, or the project run on its default branch.
 */
export const LoadShare = Schema.Struct({
  kind: Schema.Literals(['task', 'coordinator', 'run']),
  projectId: Schema.String,
  /** The project's name. */
  project: Schema.String,
  /** The task's id, its own thread, which opens it, and its title; null for a coordinator or the default branch. */
  taskId: Schema.NullOr(Schema.String),
  threadId: Schema.NullOr(Schema.String),
  title: Schema.NullOr(Schema.String),
  /** The agent leading it; null for a run of the default branch, which has none. */
  agent: Schema.NullOr(Schema.Struct({ id: Schema.String, name: Schema.String })),
  /** Its part of all the CPU since the reading before. */
  cpu: Part,
  /** The memory its processes hold: what each has resident, added up. */
  memory: Bytes,
  processes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
})
export type LoadShare = typeof LoadShare.Type

/** Althar itself and its part of this computer: the app, its windows and the runtime, without the work they started. */
export const LoadOwn = Schema.Struct({
  cpu: Part,
  memory: Bytes,
  processes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
})
export type LoadOwn = typeof LoadOwn.Type

/** A reading of how hard this computer works: the whole of it, and Althar's work's part. */
export const LoadPoint = Schema.Struct({ cpu: Part, work: Part })
export type LoadPoint = typeof LoadPoint.Type

/**
 * How hard this computer works, as the runtime read it a moment ago, for the
 * window's bar: read when a window asks and, while the meter is on, on its
 * own, at most every few seconds however many windows ask.
 */
export const Load = Schema.Struct({
  /** All the CPU in use since the reading before, across every core. */
  cpu: Part,
  /** Memory in use and all of it. In use is as Activity Monitor counts it on a Mac: without what the system keeps as cache. */
  memoryUsed: Bytes,
  memoryTotal: Bytes,
  /** Null where the system doesn't say: anywhere but a Mac. */
  pressure: Schema.NullOr(MemoryPressure),
  /** Althar's work, most CPU first; null where its processes can't be read, as on Windows. */
  shares: Schema.NullOr(Schema.Array(LoadShare)),
  /** Althar itself, part of Althar's work as the bar counts it; null where its processes can't be read. */
  althar: Schema.NullOr(LoadOwn),
  /** The readings of the last two minutes, oldest first, one every few seconds. A gap of more than a few readings starts them afresh, so there may be fewer; none is made up. */
  history: Schema.Array(LoadPoint),
})
export type Load = typeof Load.Type

/**
 * The home as a whole: its status, the change feed (Watch, WatchFrom), the home screen, and this computer.
 * Machine, load, places and missed reports; leaving the home screen.
 */
export const HomeApi = RpcGroup.make(
  Rpc.make('WatchFrom', { payload: { position: FeedPosition }, success: HeardEvent, error: ApiError, stream: true }).annotate(
    SocketAllowed,
    true,
  ),
  /** The runtime's version and the agents on this machine. Sign-in is checked at most once a minute, unless `recheck`. */
  call('Status', { recheck: Schema.optional(Schema.Boolean) }, Status),
  /** What the home's computer is: its system, cores, memory, room and git. */
  call('GetMachine', {}, Machine),
  /** The home, across every project; what the loop did, from `since` where the window says, else from when the person last left the home. */
  call('GetHome', { since: Schema.optional(Schema.String), cached: Schema.optional(Schema.Boolean) }, HomeSnapshot),
  /** The person left the home: what the loop does from now on is new to them. */
  command('LeftHome', {}, Schema.Void),
  /** How hard this computer works now, and Althar's work's part, for the window's bar while it shows it. */
  call('GetLoad', {}, Load),
  /** The agents this computer runs at once as they stand: at work, the number, fewer for now and why, what waits. */
  call('GetPlaces', {}, Places),
  /** Each model that ended steps without its report in the last week, once reminded, with how often. */
  call('GetMissedReports', {}, Schema.Array(MissedReports)),
  /**
   * What changes after `since`, or from now without it. With `deltas`, an
   * agent's message as it streams comes as what was added since this watch
   * last sent it (`Streaming`'s `offset`), not whole each time.
   */
  Rpc.make('Watch', {
    payload: { since: Schema.optional(Cursor), deltas: Schema.optional(Schema.Boolean) },
    success: HeardEvent,
    error: ApiError,
    stream: true,
  }).annotate(SocketAllowed, true),
).middleware(ClientAuthority)
