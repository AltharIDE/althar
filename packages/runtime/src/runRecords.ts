import { ConnectorFailed } from '@althar/connectors'
import { type CheckoutWait, GalleryUpdate, type LimitCall, LimitChoice, type MessageSender, ShipRoute, WorksIn } from '@althar/contracts'
import type { ProjectId } from '@althar/domain'
import type { Ledger } from '@althar/persistence-sqlite'
import { Cause, type Crypto, type Deferred, Duration, Effect, Option, Schema } from 'effect'
import { SqlClient } from 'effect/sql'
import type { Artifacts } from './Artifacts'
import type { Busy, Order } from './Busy'
import type { Published } from './changeRecords'
import type { Changes } from './Changes'
import type { Agents, RuntimeConfig } from './Config'
import type { Connections } from './Connections'
import type { Connectivity } from './Connectivity'
import { GitFailed, PushRefused } from './errors'
import { EvidenceGiven, PictureGiven } from './evidence'
import { treeOf } from './git'
import type { Instance } from './Instance'
import type { Issues } from './Issues'
import type { LeftBehind } from './LeftBehind'
import type { Limits } from './Limits'
import type { Live } from './Live'
import type { CheckoutConsent } from './local'
import type { MergeReviews } from './MergeReviews'
import type { AutoModels } from './modelMoves'
import type { Policies } from './Policies'
import type { Questions } from './Questions'
import type { Sessions } from './Sessions'
import type { Setups } from './Setups'
import { ShipBranchMove } from './shipBranchMove'
import type { Tried } from './stallWatch'
import { ToolRefused } from './toolErrors'
import type { ToolServer } from './ToolServer'

/*
 * A task's run (docs/architecture/05; docs/plans/mvp.md, "The plan"): its
 * plan's steps, one after the other, on the real kernel. A run and its first
 * attempt, an execution with its first graph revision, a node per step, and an
 * attempt each time a node runs. For now the steps are Implement and Review,
 * and Review loops with the lead settling what it found, for up to three
 * rounds.
 *
 * A step ends when its agent says so through Althar's tools: the lead's
 * finish_step, the reviewer's report_review. What each reported goes into the
 * task's thread as a step result, which the person reads instead of the work.
 */

/**
 * How long a step carried on after Althar crashed must have been at work for
 * the next crash to carry it on again; stopped sooner, it needs the person.
 * Quitting, updating or restarting Althar never counts: only a launch that
 * stopped without closing (Instance's `afterCrash`).
 */
export const RESTART_GRACE = Duration.minutes(5)

/** How often a step's agent cut off by its own limit on a turn carries on before it is reminded to report. */
export const CONTINUES = 3

/** What it is told when it was cut off so. */
export const CONTINUING = "Your last turn stopped at the agent's own limit on a turn's output or steps. Carry on from where you were."

/** What it is told, as quietly, when its turn is sent again once its connection, or its service, is back (ADR-060). */
export const RECONNECTED =
  "Your last turn stopped because the connection to your model's service failed. It's back: carry on from where you were."

/** A pause before a step tries its service again, as a thread says it. */
export const pauseWords = (pause: Duration.Duration) => {
  const seconds = Math.round(Duration.toSeconds(pause))
  if (seconds < 60) return `${seconds} seconds`
  const minutes = Math.round(seconds / 60)
  return minutes === 1 ? 'a minute' : `${minutes} minutes`
}

/**
 * How often a step's agent whose turn ended having done nothing at all is
 * told to carry on before the step needs the person, and how long it is
 * given first: a minute, as Claude Code asks while another of its processes
 * renews the sign-in they share, which an agent started as Althar starts,
 * after a gap longer than the sign-in lasts, may find.
 */
export const BLANKS = 3

export const BLANK_PAUSE = Duration.minutes(1)

/** What it is told when its turn ended so: a quick task's round, which may only have been asked something, asks for no report (ADR-034). */
export const blankAgain = (step: StuckInfo['step'], round: boolean) =>
  step === 'review'
    ? "Your last turn ended before you could do anything. Carry on with the review; when it's done, call Althar's report_review tool with your verdict, a summary and your findings."
    : round
      ? 'Your last turn ended before you could do anything. Carry on with what you were last asked.'
      : "Your last turn ended before you could do anything. Carry on with the task from where it stands. When it's done, call Althar's finish_step tool with your summary. If it waits on the person, call wait_for_person with your question and end your turn."

export const PlanStep = Schema.Struct({
  key: Schema.Literals(['implement', 'review']),
  agentId: Schema.String,
  model: Schema.NullOr(Schema.String),
  /** How hard its agent thinks; the agent's own default without one. */
  effort: Schema.optional(Schema.NullOr(Schema.String)),
  skipped: Schema.Boolean,
})

export type PlanStep = typeof PlanStep.Type

/**
 * What changing a team changed: its lead, and its review (null with none), and when each takes effect: a reviewer from a review
 * round under way's next round, or, once a review of it ran to its end or it merged, from what ships next.
 */
export interface TeamChanged {
  readonly lead?: { readonly step: PlanStep; readonly was: PlanStep; readonly when: 'next_turn' | 'now' }
  readonly review?: { readonly step: PlanStep | null; readonly was: PlanStep | null; readonly when: ReviewerChange }
}

/** When a task's reviewer changes: at once, from the next round of a review under way, or from what ships next. */
export type ReviewerChange = 'now' | 'next_round' | 'next_ship'

/** How a task ends, as its parts say it: `here`, nothing leaving this computer until it ships; else as `TaskEnd`. */
export type TaskEnding = 'here' | TaskEnd

/** How a plan's parameters end, as `TaskEnding` says it: null where they say nothing, which the project's rule settles. */
export const endingOf = (parameters: { readonly end?: TaskEnd | null | undefined; readonly here?: boolean | undefined }) =>
  parameters.end != null ? parameters.end : parameters.here === true ? ('here' as const) : null

/**
 * What a task does when its steps are done (the kit's "When the work is
 * done"): open a draft pull request, open one for review, or push its branch
 * only. Null where nothing reaches the repository's host: the task ends ready
 * on its branch.
 */
export const TaskEnd = Schema.Literals(['draft', 'ready', 'none'])

export type TaskEnd = typeof TaskEnd.Type

/** What a plan holds: its steps, why the lead was chosen, and what happens when the work is done. */
export const PlanParameters = Schema.Struct({
  steps: Schema.Array(PlanStep),
  reason: Schema.NullOr(Schema.String),
  end: Schema.optional(Schema.NullOr(TaskEnd)),
  /** Its ending was the person's choice (or a preset of theirs with one), not the project's setting taken as it stood. */
  endChosen: Schema.optional(Schema.Boolean),
  /**
   * Nothing of it leaves this Mac when it is done, whatever the project's
   * host: a task the coordinator starts at once (`start_task`), which it told
   * the person so. Without it, a plan with no end opens its pull request once
   * its host is connected.
   */
  here: Schema.optional(Schema.Boolean),
  /**
   * An aside the person started (`StartTask` with `chat`, docs/decisions/tasks.md, "Asides"): its first step ends with its
   * lead's turn, its reply the answer, as a turn after a plan does, and the coordinator hears nothing of it. Not once it is
   * work: its lead changed the repository and it left Scratch for the board.
   */
  aside: Schema.optional(Schema.Boolean),
  /**
   * A round of work's run only: it ends as its plan's run does, publishing
   * as its ending says, where a round never publishes by itself (ADR-034).
   * The round under way as its quick task was made a change
   * (make_it_a_change), which the person asked to end in a pull request.
   */
  publishes: Schema.optional(Schema.Boolean),
  /**
   * A Ship's run only (a task is a conversation plus parts, "A tweak waits
   * for Ship"): the person shipped what waited on the task's branch. It has
   * no Implement step: its review, where the plan has one before it ships,
   * reads only what came after `from`, each worktree's head as the last
   * review read it, by path; then its ending sends the commits up, past the
   * hold. Absent from every other run, so a store written before reads the
   * same.
   */
  ships: Schema.optional(
    Schema.Struct({
      from: Schema.Record(Schema.String, Schema.String),
      /** Explicit Open draft PR applies to this Ship only, including later groups, without changing the task's ending. */
      openDraft: Schema.optional(Schema.Boolean),
      /** The accepted committed boundary, persisted before publication, by workspace. Later work waits for another Ship. */
      heads: Schema.optional(Schema.Record(Schema.String, Schema.String)),
      /** The immutable copy the latest review reads, until its tree is resolved to an actual committed boundary. */
      snapshots: Schema.optional(Schema.Record(Schema.String, Schema.String)),
      /** An unfinished branch move is reconciled before retrying publication; the original branch always keeps its work. */
      rebranching: Schema.optional(Schema.Record(Schema.String, ShipBranchMove)),
      /**
       * Review and merge (a task is a conversation plus parts, "Merge, with commits not shipped"): once what waited is up, its
       * pull requests merge, unless the lead set a finding of its review aside, which brings the task back to the person
       * first. Absent from a plain Ship. Kept for a Ship admitted before routes: one admitted since says it with `route`.
       */
      merges: Schema.optional(Schema.Boolean),
      /**
       * Its route, as the person chose it or the task's own (`TaskView.shipRoute`), as changed since (RouteShip): whether its
       * review runs (off, its review steps are skipped from the start), and how far it goes: `push`, a new pull request a
       * draft and a draft left one; `ready`, a new one ready and an open draft marked ready; `merge`, as ready, then merged
       * once the checks its target requires pass. Absent from a Ship admitted before routes, which goes as it always did.
       */
      route: Schema.optional(ShipRoute),
      /**
       * The stop past its push it has reached, for its card and for RouteShip: marking ready, then merging (or waiting to,
       * on its required checks). Absent before, while it reviews or pushes.
       */
      at: Schema.optional(Schema.Literals(['ready', 'merge'])),
      /**
       * The change this Ship sends, by workspace, where its task has several (a task is a conversation plus parts, "Each
       * change ships and is followed on its own"): its review reads it alone, and only it goes up. Absent where the task has
       * one, which ships whole as before.
       */
      only: Schema.optional(Schema.Array(Schema.String)),
      /**
       * The changes that ship after it, each in a Ship of its own with its own review, in order: the bottom of a stack first.
       * Each is its workspaces' ids, joined by commas: a change in several repositories ships as one.
       */
      next: Schema.optional(Schema.Array(Schema.String)),
      /**
       * A review added after the work went up (a skipped review can be added back until merge): the run only reviews what is
       * on the branch now, from the last review or, with none, from where the task started, and sends nothing: the commits
       * are up already.
       */
      reviewOnly: Schema.optional(Schema.Boolean),
      /**
       * Its task came to stay here while it shipped (its ending changed to here, as a change made a chat): nothing goes up,
       * nothing merges, and what waited still waits for the next Ship. Absent from every other Ship.
       */
      stays: Schema.optional(Schema.Boolean),
    }),
  ),
  /** A small change starts without a countdown; its size never determines when its reviewer reads it. */
  smallChange: Schema.optional(Schema.Boolean),
  /** The preset it was planned from, by name: its card names it while its parts still have that preset's shape. */
  preset: Schema.optional(Schema.String),
  /** Explicitly chosen after-merge timing. Kept for older configured tasks; size no longer sets it. */
  reviewAfterMerge: Schema.optional(Schema.Boolean),
  /**
   * A review of someone else's pull request (`review_pull_request`): its one
   * step is the review's lead, which reads a read-only copy, so only an
   * agent its session holds to reading may take it. It has no run: started,
   * its lead starts in the task's thread (Reviews.lead).
   */
  reads: Schema.optional(Schema.Boolean),
  /**
   * Where it works (ADR-091): a worktree of its own, or Local, in its
   * repositories' own checkouts here, taken as its first step begins. A
   * worktree without it, as before.
   */
  worksIn: Schema.optional(WorksIn),
  /** Why it works there, in the coordinator's words, where that isn't the project's default. */
  worksInWhy: Schema.optional(Schema.NullOr(Schema.String)),
  /**
   * When its lead was last changed after its steps began (`changeTeam`): who leads it is the plan's from then, until a session
   * of the lead starts after, as the thread's lead reads.
   */
  leadChanged: Schema.optional(Schema.String),
})

export type PlanParameters = typeof PlanParameters.Type

/** How far a Ship's route goes, as its run keeps it: a Ship admitted before routes says merging alone, and nothing else. */
export const farOf = (ships: PlanParameters['ships']): ShipRoute['far'] | undefined =>
  ships?.route?.far ?? (ships?.merges === true ? 'merge' : undefined)

/** A Ship's merge, not sent: its route goes no further than ready now, or the Ship is over (`stillMerges`). */
export class NotMergingNow extends Schema.TaggedError<NotMergingNow>()('NotMergingNow', {}) {}

/** How a Ship goes, beside its task (`ship`). */
export interface ShipOptions {
  /** Its route, as the person chose it for this Ship; without it, the task's own (`taskShipRoute`). */
  readonly route?: ShipRoute | undefined
  /** One of the task's changes, by name: it ships alone, with what waits beneath it in its stack. */
  readonly onlyChange?: string | undefined
  /** The changes still to ship after the Ship before it, each its workspaces' ids joined by commas: the next is shipped now. */
  readonly queued?: ReadonlyArray<string> | undefined
  /** A review added after the work went up: it reviews what is on the branch now, and sends nothing. */
  readonly reviewOnly?: boolean | undefined
  /** Said as soon as its run is admitted, for the person's press. */
  readonly admitted?: Deferred.Deferred<void, unknown> | undefined
  /** Open draft PR, for this Ship only: a new pull request opens as a draft, whatever the task's ending. */
  readonly openDraft?: boolean | undefined
  /** A fresh press may take the committed work of a stopped run, without resuming its Implement. */
  readonly acceptStopped?: boolean | undefined
}

/** What a Ship that went up says as it ends: its step's result, unless that was said already (`sayResult` false). */
export interface ShipOver {
  readonly said: Readonly<Record<string, unknown>>
  readonly went: ReadonlyArray<{ readonly where: string; readonly count: number; readonly url: string; readonly change: string | null }>
  readonly published: Published | undefined
  readonly sayResult?: boolean
}

export const Finding = Schema.Struct({
  severity: Schema.Literals(['blocking', 'major', 'minor', 'nit']),
  // Asked for, but a reviewer that leaves it out still reports: its findings show by their claims.
  title: Schema.optional(Schema.String),
  file: Schema.optional(Schema.String),
  line: Schema.optional(Schema.Int),
  claim: Schema.String,
})

export type Finding = typeof Finding.Type

export const Finished = Schema.Struct({
  summary: Schema.String,
  /** What the task built, as it stands now: the task's own summary, which the person reads at its end. */
  built: Schema.optional(Schema.String),
  /** What a pull request that follows one merged or closed does, in a few words: its title, after `After #12:`. */
  title: Schema.optional(Schema.String),
  /** The pull request's description, for its reviewer, in the repository's template where it has one: by repository, which a task of one needn't name. */
  descriptions: Schema.optional(Schema.Array(Schema.Struct({ repository: Schema.optional(Schema.String), text: Schema.String }))),
  /** What shows the change does what it should; and what couldn't be shown. */
  evidence: Schema.optional(Schema.Array(EvidenceGiven)),
  unverified: Schema.optional(Schema.Array(Schema.String)),
  /** The views an earlier step pictured that still show the work as it is, beside this step's pictures. */
  kept_views: Schema.optional(Schema.Array(Schema.String)),
  gallery: Schema.optional(GalleryUpdate),
  expected_gallery_revision: Schema.optional(Schema.Int),
  /** A round of work where the person only asked something, and what the lead committed came with answering: it opens no pull request. */
  answered: Schema.optional(Schema.Boolean),
  /** When settling a review: what became of each finding, by its id. */
  findings: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        outcome: Schema.Literals(['fixed', 'set_aside']),
        reason: Schema.optional(Schema.String),
        /** For one fixed, the commit that fixed it: the pull request names it. */
        commit: Schema.optional(Schema.String),
      }),
    ),
  ),
})

/** A lead stopping to wait for the person: the question it needs answered before it can go on. */
export const WaitingForPerson = Schema.Struct({ question: Schema.String })

export const Shown = Schema.Struct({ pictures: Schema.Array(PictureGiven) })

/** The longest a finding's title is kept: past it, a reviewer wrote its claim there, cut at a word with an ellipsis. */
export const TITLE_LONGEST = 120

/**
 * A fix after a review this small isn't read again (a task is a conversation
 * plus parts, "Fixes are checked by the same reviewer, only where they need
 * it"): this many lines changed or fewer, every one in a file a finding named.
 */
export const TINY_LINES = 10

/** How many commits a Ship's reviewer is told by subject; more, and it reads them in its copy. */
export const SHIPPED_LISTED = 12

/** How long a Ship its lead asked for in its turn waits for that turn, and what it left at work, to end, at most. */
export const AFTER_TURN_WAIT = Duration.minutes(30)

/** A finding's title as kept: on one line, trimmed, null where the reviewer gave none. */
export const titleOf = (title: string | null | undefined): string | null => {
  const line = (title ?? '').replace(/\s+/g, ' ').trim()
  if (line === '') return null
  if (line.length <= TITLE_LONGEST) return line
  const cut = line.slice(0, TITLE_LONGEST - 1)
  const word = cut.lastIndexOf(' ')
  return `${(word > TITLE_LONGEST / 2 ? cut.slice(0, word) : cut).trimEnd()}…`
}

export const Reviewed = Schema.Struct({
  verdict: Schema.Literals(['pass', 'changes_requested']),
  summary: Schema.String,
  findings: Schema.optional(Schema.Array(Finding)),
})

/**
 * What a step held for a usage limit keeps (`node_attempts.output`): the
 * agent out, until when, and the account and model it carries on with;
 * held before Althar kept those, it carries on as the agent picks. And, for
 * the window, why it waits rather than moving on, and who could take it over
 * meanwhile, as they stood when it was held (`HeldForLimit`).
 */
export const Hold = Schema.Struct({
  heldFor: Schema.String,
  until: Schema.String,
  account: Schema.optional(Schema.NullOr(Schema.String)),
  model: Schema.optional(Schema.NullOr(Schema.String)),
  why: Schema.optional(Schema.Literals(['waits', 'nothing_free', 'asked'])),
  choices: Schema.optional(Schema.Array(LimitChoice)),
  /** Held before it ran out, a new step on an agent nearly out: the share of its tightest limit left. */
  left: Schema.optional(Schema.Number),
  /**
   * Held for the connection (`agent_unavailable`, ADR-060): offline, until
   * the computer is back and its service answers; else until `until`, when
   * its service, which failed `tries` times in a row, is tried again. The
   * service, by name, and what it said last.
   */
  offline: Schema.optional(Schema.Boolean),
  tries: Schema.optional(Schema.Int),
  service: Schema.optional(Schema.String),
  failure: Schema.optional(Schema.NullOr(Schema.String)),
})

/** Why a step held for a usage limit waits: its project waits for resets, nothing else was free to move it to, or the person said to. */
export type HoldWhy = NonNullable<typeof Hold.Type.why>

export const decodeHold = Schema.decodeUnknownEffect(Schema.fromJsonString(Hold))

/** Reads a tool's input, or refuses it with what was wrong, for the agent to try again. */
export const read = <A>(schema: Schema.Codec<A, unknown>, input: unknown) =>
  Schema.decodeUnknownEffect(schema)(input).pipe(
    Effect.mapError((error) => new ToolRefused({ message: `Althar couldn't read that: ${error.message}` })),
  )

/** What the worktree holds now: whether settling changed anything. */
export const digestOf = (worktree: string) => treeOf(worktree).pipe(Effect.orElseSucceed(() => ''))

export const findingsText = (findings: ReadonlyArray<Finding & { readonly id: string }>) =>
  findings
    .map((finding) => {
      const where = finding.file === undefined ? '' : ` ${finding.file}${finding.line === undefined ? '' : `:${finding.line}`}`
      return `- ${finding.id} [${finding.severity}]${where}: ${finding.claim}`
    })
    .join('\n')

export interface RunRow {
  readonly runId: string
  readonly runAttemptId: string
  readonly executionId: string
  readonly projectId: ProjectId
  readonly taskId: string
  readonly threadId: string
  readonly parameters: string
  /** The plan it runs; null for a round of work after it (ADR-034). */
  readonly planId: string | null
}

/** Where a round of work started (ADR-034): each worktree's head, what it held, and what it hadn't committed, by its path. */
export interface RoundStart {
  readonly heads: Readonly<Record<string, string>>
  readonly digest: string
  readonly uncommitted: Readonly<Record<string, ReadonlyArray<string>>>
}

/** Where a task stood before a round of work: what it goes back to where the round makes nothing new. */
export interface RoundBack {
  readonly state: 'open' | 'done'
  readonly settledAt: string | null
  /** How the run before it ended. */
  readonly ended: 'succeeded' | 'failed' | 'cancelled'
}

/** What a round's Implement attempt keeps as its input. */
export interface RoundInput {
  readonly round: RoundBack
  readonly start: RoundStart
}

/** A round's Implement attempt's input, read; undefined for any other attempt's. */
export const roundOf = (input: string | null | undefined): RoundInput | undefined => {
  try {
    const read = JSON.parse(input ?? '') as Partial<RoundInput>
    if (typeof read.round === 'object' && read.round !== null && typeof read.start === 'object' && read.start !== null)
      return read as RoundInput
  } catch {
    // Not a round's: as below.
  }
  return undefined
}

export type Store =
  | SqlClient.SqlClient
  | Instance
  | Sessions
  | ToolServer
  | Crypto.Crypto
  | Ledger
  | Live
  | Changes
  | Issues
  | Limits
  | Policies
  | AutoModels
  | Agents
  | RuntimeConfig
  | Busy
  | Questions
  | Artifacts
  | Connectivity
  | LeftBehind
  | MergeReviews
  | Setups
  | Connections

/**
 * Whether a publish step's failure may pass if tried again (DEV-173): the
 * code host failing or not answering (a 5xx, a rate limit, the network), a
 * push that couldn't reach it, or git running past its time. Not one that
 * won't: not connected, signed out, refused, or a request the host turned
 * down as it stands.
 */
export const mayPass = (cause: Cause.Cause<unknown>): boolean => {
  const error = Cause.findErrorOption(cause)
  if (Option.isNone(error)) return false
  const failed = error.value
  if (failed instanceof ConnectorFailed) return failed.reason === 'unreachable' || failed.reason === 'rate_limited'
  if (failed instanceof PushRefused) return failed.why === 'unreachable'
  return failed instanceof GitFailed && failed.timedOut === true
}

/**
 * Why a step needs the person (docs/architecture/05): its agent didn't report
 * after a reminder, went, couldn't start, a restart stopped it, it stalled,
 * went round in circles, ran past its budget, or refused; or review ran out
 * of rounds.
 */
export type StuckWhy =
  | 'no_report'
  | 'session_ended'
  | 'failed_to_start'
  | 'restarted'
  | 'round_limit'
  | 'not_connected'
  | 'usage_limit'
  | 'stalled'
  | 'looping'
  | 'over_budget'
  | 'refused'
  /** Its agent's service kept failing while the computer was online, however long Althar waited between tries (ADR-060). */
  | 'transient'
  /** Its agent's account is signed out: reminding it can't help; signing it in again can. */
  | 'signed_out'
  /** Its agent's sign-in was there and has ended (DEV-196): signing it in again is the way on, as for signed out. */
  | 'sign_in_ended'
  /** Its agent isn't installed, or isn't where Althar runs it from: installing it is the way on. */
  | 'not_installed'
  /** The lead stopped to wait for the person's answer, which starts it again. */
  | 'waiting_on_person'

/** What a stuck step's call says: the step, why, what went wrong in words, who was on it, the round, and the findings still open. */
export interface StuckInfo {
  readonly step: 'implement' | 'review' | 'settle' | 'publish'
  readonly why: StuckWhy
  readonly detail: string | null
  readonly agentId: string | null
  /** How hard the step last thought, where it had a session: put there as the call is raised. */
  readonly effort?: string
  readonly round: number
  readonly open: number
  /** What Althar did about it before asking, where it did something. */
  readonly tried?: ReadonlyArray<Tried>
  /** For a usage limit: whose account, when it resets where it said, and who could take the step over. */
  readonly limit?: LimitCall
  /** For a service that kept failing: its name, where the registry names one (`Anthropic`); else the call says the agent's. */
  readonly service?: string
  /** The model the step last ran on, where it had a session (the one that failed, so handing on can leave it out), and for a sign-in refused, the provider within the agent whose sign-in it was (`opencode-go`). */
  readonly model?: string
  readonly provider?: string
}

/**
 * The person's answer: tell the step's agent what to do, hand the step to an
 * agent (on the account and model they picked, where they did), or abandon
 * it (a review is gone on without). A step a usage limit stopped can wait for
 * the reset, where it is known.
 */
export type StuckAnswer =
  /** `quiet` where Althar tells it, not the person, as an external wait resolving: the agent reads it, the thread shows its own line. */
  | { readonly kind: 'tell'; readonly note: string; readonly quiet?: boolean }
  | {
      readonly kind: 'retry'
      readonly agentId: string
      readonly accountId?: string | undefined
      readonly model?: string | undefined
      readonly effort?: string | undefined
    }
  | { readonly kind: 'wait' }
  | { readonly kind: 'abandon' }

/** The run was stopped or abandoned as a step was on its way: nothing more starts on it until it is resumed. */
export class RunStopped extends Schema.TaggedError<RunStopped>()('RunStopped', { runId: Schema.String }) {}

/** Nothing, where the run was stopped as a step was on its way. */
/** How often, and how many times, the next change's Ship is tried again while the task is still at work. */
export const NEXT_SHIP_EVERY = Duration.millis(500)

export const NEXT_SHIP_TRIES = 240

export const unlessStopped = <A, E, R>(effect: Effect.Effect<A, E | RunStopped, R>) =>
  effect.pipe(
    Effect.catchIf(
      (error): error is RunStopped => error instanceof RunStopped,
      () => Effect.succeed(undefined),
    ),
  )

/** Who leads a task's thread: an agent, on a model and effort, or its own where null. */
export interface Lead {
  readonly agentId: string
  readonly model: string | null
  readonly effort: string | null
}

/**
 * How a step waiting for a place among the agents at work on this machine
 * starts once it has one (Busy.ts): a plan's first, on its lead as the plan
 * says; one a restart stopped, carried on as after any restart; one the
 * person resumed, on the lead they gave, or a review on its reviewer; one
 * back from a usage limit, on the agent, account and model it was held for.
 */
export type Place =
  | { readonly how: 'start' }
  | { readonly how: 'restart' }
  | { readonly how: 'resume'; readonly lead: Lead; readonly reviewer?: PlanStep }
  /** The step after the one before it, as a review after the lead's, or the lead settling after a review. */
  | { readonly how: 'next'; readonly reviewer?: PlanStep }
  /** A lead's step that needed the person, carried on as they answered once it has a place. */
  | {
      readonly how: 'answered'
      readonly info: StuckInfo
      readonly answer: Exclude<StuckAnswer, { readonly kind: 'wait' }>
      readonly sender?: MessageSender | undefined
    }
  /** A lead's step held for a usage limit that the person handed to another agent: the work of a task under way, so it waits its turn. */
  | { readonly how: 'handed'; readonly info: StuckInfo; readonly answer: Extract<StuckAnswer, { readonly kind: 'retry' }> }
  /** Back from a usage limit, or, `connection`, from waiting for its service (ADR-060), with how often that had failed in a row. */
  | {
      readonly how: 'reset'
      readonly agentId: string
      readonly accountId: string | null
      readonly model: string | null
      readonly connection?: { readonly tries: number }
    }

/** What a step waiting for a place keeps in its output: how it starts, and since when it waits. */
export interface Waiting {
  readonly place: Place
  readonly since: string
}

/**
 * What a Local task's first step held for its checkout keeps (ADR-091): as
 * one waiting for a place, since when it waits; the person's answers to what
 * Althar asked, each for the one checkout it was about, as it was then
 * (local.ts), which hold until it starts; and what it waits for now.
 */
export interface CheckoutHold extends Waiting {
  readonly consents?: ReadonlyArray<CheckoutConsent>
  readonly waits?: CheckoutWait
}

/** What a step held for its checkout waits for, from its output; null where it waits on the person's answer. */
export const checkoutWaitOf = (output: string | null): CheckoutWait | null => {
  try {
    return (JSON.parse(output ?? '') as Partial<CheckoutHold>).waits ?? null
  } catch {
    return null
  }
}

/**
 * Where a waiting step stands (ADR-037): one the person resumed or answered starts at once; a plan's first step is new
 * work; the rest (the step after another, one carried on after a restart or back from a usage limit) is a task's work
 * under way.
 */
export const orderOf = (place: Place): Order =>
  place.how === 'start' ? 'new' : place.how === 'resume' || place.how === 'answered' ? 'person' : 'underway'

/** A waiting step's output, read; one Althar can't read carries on as after a restart, from when it is read. */
export const waitingOf = (output: string | null, now: string): Waiting => {
  try {
    const read = JSON.parse(output ?? '') as Partial<Waiting>
    if (typeof read.since === 'string' && typeof read.place === 'object' && read.place !== null) return read as Waiting
  } catch {
    // Not the runtime's own JSON: as below.
  }
  return { place: { how: 'restart' }, since: now }
}

/**
 * Whether the task's run waits before its first step: its one attempt,
 * Implement, held for a place among the agents at work here, to start, or,
 * Local, for its checkout (ADR-091).
 */
export const planWaits = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ nodeKey: string; state: string; holdReason: string | null; output: string | null }>`
      SELECT n.node_key, a.state, a.hold_reason, a.output FROM runs r JOIN workflow_executions e ON e.run_id = r.id
      JOIN nodes n ON n.execution_id = e.id JOIN node_attempts a ON a.node_id = n.id
      WHERE r.id = (SELECT id FROM runs WHERE task_id = ${taskId} ORDER BY created_at DESC LIMIT 1) AND r.state = 'running'`
    const [only] = rows
    if (rows.length !== 1 || only === undefined) return false
    if (only.nodeKey !== 'implement' || only.state !== 'held') return false
    if (only.holdReason !== 'machine_busy' && only.holdReason !== 'checkout') return false
    return waitingOf(only.output, '').place.how === 'start'
  })

/**
 * Whether the task's run has begun nothing: its one attempt, Implement, held before any agent was on it, for a place among
 * the agents at work here or for its checkout (ADR-091). Until then the person can take it back to a held plan, which waits
 * until they start it. One held for a usage limit or its agent's service has its agent's session up already, and is stopped,
 * not held.
 */
export const beforeFirstStep = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ nodeKey: string; state: string; holdReason: string | null; output: string | null; session: string | null }>`
      SELECT n.node_key, a.state, a.hold_reason, a.output, a.provider_session_id AS session FROM runs r
      JOIN workflow_executions e ON e.run_id = r.id JOIN nodes n ON n.execution_id = e.id JOIN node_attempts a ON a.node_id = n.id
      WHERE r.id = (SELECT id FROM runs WHERE task_id = ${taskId} ORDER BY created_at DESC LIMIT 1) AND r.state = 'running'`
    const [only] = rows
    if (rows.length !== 1 || only === undefined) return false
    if (only.nodeKey !== 'implement' || only.state !== 'held' || only.session !== null) return false
    return (only.holdReason === 'machine_busy' || only.holdReason === 'checkout') && waitingOf(only.output, '').place.how === 'start'
  })

/**
 * Where a task's reviewer stands to change (a task is a conversation plus parts: every part changes at any time, either way):
 * `now`, before its review round starts or between rounds; `next_round`, in a round under way, which the change waits for;
 * `next_ship`, once a review of it ran to its end (its run over, or its review passed or went on to the run's ending, though that
 * still publishes or waits): the reviewer named reads what ships next. A review that was skipped, or never planned, is not a done
 * one, nor one planned for after the merge that hasn't merged: its reviewer can be added, and where its work is up already, it
 * starts a round on its head.
 */
export const reviewerChange = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [latest] = yield* sql<{ state: string; executionId: string }>`
      SELECT r.state, e.id AS execution_id FROM runs r JOIN workflow_executions e ON e.run_id = r.id
      WHERE r.task_id = ${taskId} ORDER BY r.created_at DESC, r.rowid DESC LIMIT 1`
    // Its first step not begun: nothing of its review has.
    if (latest === undefined) return 'now' as ReviewerChange
    // A review that really ran, or is under way: not one skipped by the person (its attempt cancelled as skipped) or never planned.
    const [ran] = yield* sql<{ one: number }>`
      SELECT 1 AS one FROM node_attempts a JOIN nodes n ON n.id = a.node_id
      WHERE n.execution_id = ${latest.executionId} AND n.node_key = 'review'
        AND NOT (a.state = 'cancelled' AND coalesce(json_extract(a.output, '$.skipped'), 0) = 1)
        AND a.state NOT IN ('ready', 'superseded') LIMIT 1`
    if (latest.state !== 'running' && latest.state !== 'suspended')
      // Its run over: its review is done where one ran, and another reads what ships next; a skipped one, never planned, or the
      // fast lane's that waits for the merge, is still to add.
      return ran !== undefined ? ('next_ship' as const) : ('now' as const)
    // Its review passed, or its run went on to its ending without another round: done, though the run still publishes or waits.
    const [finished] = yield* sql<{ one: number }>`
      SELECT 1 AS one FROM node_attempts a JOIN nodes n ON n.id = a.node_id
      WHERE n.execution_id = ${latest.executionId} AND n.node_key = 'review' AND a.state = 'succeeded'
        AND (json_extract(a.output, '$.verdict') = 'pass' OR json_extract(a.output, '$.findings') = 0)
      UNION ALL
      SELECT 1 AS one FROM nodes n WHERE n.execution_id = ${latest.executionId} AND n.node_key = 'publish' AND ${ran === undefined ? 0 : 1} = 1
      LIMIT 1`
    if (finished !== undefined) return 'next_ship' as const
    const [under] = yield* sql<{ one: number }>`
      SELECT 1 AS one FROM node_attempts a JOIN nodes n ON n.id = a.node_id
      WHERE n.execution_id = ${latest.executionId} AND n.node_key = 'review'
        AND a.state IN ('admitted', 'running', 'waiting_attention', 'held') LIMIT 1`
    return under === undefined ? ('now' as const) : ('next_round' as const)
  })
