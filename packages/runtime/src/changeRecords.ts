import { type Account, ChangeRequest, type CodeHost, ConnectorFailed, MergeRules, type Product, type Repository } from '@althar/connectors'
import { PushRequestItem } from '@althar/contracts'
import type { ActorId, ChangeTarget, ProjectId } from '@althar/domain'
import type { Ledger } from '@althar/persistence-sqlite'
import { Cause, type Crypto, Duration, Schema } from 'effect'
import { SqlClient } from 'effect/sql'
import { Busy } from './Busy'
import { Agents, RuntimeConfig } from './Config'
import { Connections, NotConnected } from './Connections'
import { Errands } from './Errands'
import { GitFailed, NotFound } from './errors'
import { FastLane } from './fastLane'
import { type GitFailure, gitFailureOf, gitLine, gitSummary } from './gitSaid'
import { Instance } from './Instance'
import { IssueChanges } from './IssueChanges'
import { LeftBehind } from './LeftBehind'
import { Live } from './Live'
import { Models } from './Models'
import { Policies } from './Policies'
import { Sessions } from './Sessions'
import { ToolServer } from './ToolServer'
import { sentence, summarize } from './words'

/** What Althar last saw of a change, as its external link keeps it. */
export const Snapshot = Schema.Struct({
  number: Schema.Number,
  title: Schema.String,
  url: Schema.String,
  state: Schema.Literals(['open', 'merged', 'closed']),
  draft: Schema.Boolean,
  headSha: Schema.NullOr(Schema.String),
  additions: Schema.NullOr(Schema.Number),
  deletions: Schema.NullOr(Schema.Number),
  changedFiles: Schema.NullOr(Schema.Number),
  repository: Schema.Array(Schema.String),
  words: Schema.Struct({ noun: Schema.String, short: Schema.String, prefix: Schema.String }),
  checks: Schema.NullOr(
    Schema.Struct({
      sha: Schema.String,
      outcome: Schema.Literals(['none', 'running', 'passed', 'failed']),
      passed: Schema.Number,
      failed: Schema.Number,
      running: Schema.Number,
      total: Schema.Number,
      failing: Schema.Array(Schema.String),
      list: Schema.optional(
        Schema.Array(
          Schema.Struct({
            name: Schema.String,
            state: Schema.Literals(['queued', 'running', 'passed', 'failed', 'skipped', 'cancelled', 'neutral']),
            summary: Schema.NullOr(Schema.String),
          }),
        ),
      ),
    }),
  ),
  /** Number of finished-check transitions heard, including reruns at the same head. */
  checksRevision: Schema.optional(Schema.Number),
  /** The branch it merges into; absent from a snapshot kept before this was. */
  target: Schema.optional(Schema.String),
  /** Whether the host says it conflicts with that branch; null where it hasn't said, absent from one kept before this was. */
  conflicts: Schema.optional(Schema.NullOr(Schema.Boolean)),
  /** The branch it is from, on the repository its commits go to; absent from one kept before this was, which is the task's own branch's name. */
  source: Schema.optional(Schema.String),
  /**
   * Attached to the task rather than opened for it (ADR-052): publishing
   * pushes to its branch, whatever the task's own is called, and never
   * opens another.
   */
  attached: Schema.optional(Schema.Boolean),
  /**
   * In its target branch's merge queue, as Althar put it there or its host
   * says it is, however it got there: the host merges it once the queue's
   * checks pass. Asked about on each listening turn where the branch has a
   * queue; absent once it isn't in it, or never was.
   */
  queued: Schema.optional(Schema.Boolean),
  /** How many times the merge queue took it out unmerged: a merge after each is another, at the same head too. */
  leftQueue: Schema.optional(Schema.Number),
  /**
   * The repository its branch is on, as its host last said, where its
   * commits are pushed: a fork's path, or null for a branch of its own
   * repository. Absent where the host hasn't said, and from one kept before
   * this was (ADR-085).
   */
  head: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
  /**
   * What merging it needs, as its host last said (DEV-204), at which head
   * and when: read again as something happens on it, else every few
   * minutes. Absent where its host doesn't read it, or hasn't yet.
   */
  rules: Schema.optional(Schema.Struct({ ...MergeRules.fields, sha: Schema.NullOr(Schema.String), at: Schema.String })),
})

export type Snapshot = typeof Snapshot.Type

/** Whether two paths on a host are one repository's: GitHub and GitLab don't mind the case. */
export const samePath = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) => a.join('/').toLowerCase() === b.join('/').toLowerCase()

/** The branch a pull request's commits go to on its host: its own, as last seen, else the task's, as one Althar opened has. */
export const sourceOf = (snapshot: Snapshot, branch: string) => snapshot.source ?? branch

/**
 * A host's no to one repository of a task's several, on one line: which
 * repository, what the host said, and the pull requests the others have open
 * already, so none is opened twice and none is taken for missing.
 */
export const severalFailed = (
  repository: string,
  error: ConnectorFailed,
  done: ReadonlyArray<{ readonly kind: string; readonly change?: Snapshot }>,
) => {
  const open = done.flatMap((one) =>
    one.kind === 'opened' && one.change !== undefined
      ? [`${one.change.repository.join('/')} ${one.change.words.prefix}${one.change.number}`]
      : [],
  )
  const others = open.length === 0 ? '' : `; ${open.join(', ')} ${open.length === 1 ? 'is' : 'are'} open`
  return new ConnectorFailed({
    product: error.product,
    reason: error.reason,
    message: `in ${repository}: ${error.message}${others}`,
    ...(error.status === undefined ? {} : { status: error.status }),
    ...(error.retryAt === undefined ? {} : { retryAt: error.retryAt }),
    ...(error.scope === undefined ? {} : { scope: error.scope }),
    ...(error.sizeLimit === undefined ? {} : { sizeLimit: error.sizeLimit }),
  })
}

/** A task's change, as the card, the header and the accept view show it. */
export interface ChangeSummary extends Snapshot {
  readonly linkId: string
  readonly product: Product
  readonly listening: boolean
}

/** The code host a project's repository is on, as its remotes say, and whether Althar is connected to it there. */
export interface Host {
  readonly product: Product
  readonly name: string
  readonly webUrl: string
  readonly connected: boolean
}

/**
 * What publishing did: opened (or adopted) a pull request, pushed the branch
 * only, or found nothing to propose; and the files the lead left uncommitted,
 * which weren't.
 */
export type PublishedOne =
  /** `attached`: pushed to the pull request the task was attached to, which it didn't open (ADR-052). */
  (
    | { readonly kind: 'opened'; readonly change: ChangeSummary; readonly attached?: boolean }
    | { readonly kind: 'pushed'; readonly branch: string }
    | { readonly kind: 'nothing' }
    /** Left on its branch: in a task of several repositories, one on no code host Althar knows. */
    | { readonly kind: 'branch' }
    /**
     * Kept on its branch here: it ends with its branch while a pull request stands open from it (a change stepped back to a
     * prototype), so nothing went to that pull request, which stays as it is until the task ends in one again.
     */
    | { readonly kind: 'kept'; readonly pullRequest: string }
  ) & { readonly left: ReadonlyArray<string>; readonly repository: string }

/** What publishing did in each of the task's repositories, the project's first first. */
export type Published = ReadonlyArray<PublishedOne>

/** What attaching a pull request to a task is asked to do (ADR-052): by its link or number; `start`, the person's word to start the task's branch from its head. */
export interface AttachInput {
  readonly taskId: string
  readonly pullRequest: string
  readonly start?: boolean | undefined
  readonly actorId: ActorId
}

/**
 * What attaching did: the task follows it now, its branch started from its
 * head or not, with how many of its own commits are on that head; or, where
 * the task's branch isn't based on its head, what starting from it would
 * keep, for the person to say.
 */
export type Attached =
  | { readonly kind: 'attached'; readonly change: ChangeSummary; readonly started: boolean; readonly kept: number }
  | { readonly kind: 'start'; readonly name: string; readonly source: string; readonly head: string; readonly own: number }

/** What publishing is asked to do: the task's ending, in its run; `again`, its next pull request, after its last merged or closed (ADR-034). */
export interface PublishInput {
  readonly projectId: ProjectId
  readonly taskId: string
  readonly runId: string
  readonly end: 'draft' | 'ready' | 'none'
  readonly again?: boolean | undefined
  /**
   * Ship publishes it, on the person's word, after its review: a worktree
   * held for Ship goes up only so (a task is a conversation plus parts, "A
   * tweak waits for Ship"); without it, publishing refuses one.
   */
  readonly ships?: boolean | undefined
  /** Accepted committed endpoints for Ship, by workspace. A missing workspace is outside this Ship. */
  readonly heads?: Readonly<Record<string, string>> | undefined
  /** Only these workspaces: a change pointed at another branch opens its new pull request alone. */
  readonly only?: ReadonlyArray<string> | undefined
}

/** One of the task's repositories, as publishing reads it. */
export interface PublishRow {
  readonly title: string
  readonly name: string
  readonly slug: string
  readonly threadId: string
  readonly workspaceId: string
  readonly path: string
  readonly branch: string
  /** 0 for a plain task's worktree with no branch yet, which has nothing to publish. */
  readonly branched: number
  readonly baseCommit: string | null
  readonly baseRef: string | null
  readonly bindingId: string
  readonly remotes: string
  readonly defaultBase: string | null
  /** The branch its work goes into, where it isn't the default (ADR-093): on the repository it opens on, a fork's upstream too. */
  readonly toward: string | null
  /** For a fork: where its pull requests open, the repository it was forked from or the fork itself. */
  readonly changeTarget: ChangeTarget | null
  /** When it was held for Ship; null while nothing waits for it. */
  readonly heldAt: string | null
  /** A bounded Ship carries its accepted endpoint across a branch made for its next pull request. */
  readonly acceptedHead?: string | undefined
}

/**
 * A task's worktree held for Ship (a task is a conversation plus parts, "A
 * tweak waits for Ship"): what the person's turns with its lead committed
 * after its plan waits on its branch, and nothing pushes it but Ship.
 */
export interface Held {
  readonly workspaceId: string
  readonly path: string
  readonly branch: string
  /** When the hold began: the end of the first turn that left commits on the branch. */
  readonly heldAt: string
}

/**
 * A repository of a task whose last pull request merged or closed, with
 * commits on its branch after that pull request's head, or one with commits
 * that never had one: what its next pull request, or its first, would have
 * (ADR-034).
 */
export interface Unshipped {
  readonly workspaceId: string
  readonly path: string
  readonly branch: string
  readonly name: string
  readonly slug: string
  /** Its last pull request, as last seen; null where it has had none. */
  readonly change: ChangeSummary | null
  /**
   * When the last of what went in that pull request went up to it, else when
   * it opened: its next is titled and described from what came after, never
   * from words given for work that went in it.
   */
  readonly openedAt: string | null
  /**
   * Where its commits are counted from: that pull request's head, as the
   * branch has it, or, `moved` or with none, where its branch started; or,
   * where the person left out what came after that, where they did.
   */
  readonly head: string
  /** That pull request's head, or where its branch started, before what the person left out: `head`, where they left out nothing. */
  readonly shipped: string
  /** The worktree is on a branch made for its next pull request already, which didn't open: it goes on that one. */
  readonly moved: boolean
  /** The commits after it, oldest first, merges left out. */
  readonly commits: ReadonlyArray<string>
  /** Lines they add and remove, all together. */
  readonly add: number
  readonly del: number
}

/**
 * A task's pull requests as they stand now: in each repository the latest,
 * the open one else the newest; earlier ones, closed or merged, are history
 * (ADR-034).
 */
export const latestOf = <A extends { readonly state: string; readonly repository: ReadonlyArray<string> }>(
  changes: ReadonlyArray<A>,
): ReadonlyArray<A> => {
  const byRepository = new Map<string, Array<A>>()
  for (const change of changes) {
    const where = change.repository.join('/').toLowerCase()
    byRepository.set(where, [...(byRepository.get(where) ?? []), change])
  }
  return [...byRepository.values()].flatMap((all) => {
    const latest = all.find((change) => change.state === 'open') ?? all.at(-1)
    return latest === undefined ? [] : [latest]
  })
}

/** How long a pull request with nothing new counts as quiet, and how much less often a quiet one is asked. */
export const QUIET_AFTER = Duration.minutes(10)

export const QUIET_SLOWER = 10

/**
 * Every how many listening turns each open task is looked at for a conflict
 * with its default branch, which is fetched for it at most as often: a
 * branch that moved is found within minutes, whether or not its pull
 * request changed (ADR-030).
 */
export const BASE_TURNS = 4

/**
 * How often what merging an open pull request needs is read again when
 * nothing happened on it (DEV-204): a review, a comment, a push or its checks
 * ending read it at once, so this only catches what says nothing, such as a
 * conversation resolved or a branch's rules changed.
 */
export const RULES_EVERY = Duration.minutes(5)

/** How many turns running a pull request whose host hasn't worked out whether it conflicts is asked again each turn. */
export const UNKNOWN_TURNS = 5

/** Why a round an earlier launch left under way ended, where it couldn't be asked again. */
export const STOPPED_MIDWAY = 'Althar stopped while the lead was resolving it.'

/**
 * Whether a listened change is due to be asked again: every turn while
 * something has happened on it lately, every few turns once it is quiet.
 */
export const listenDue = (input: {
  readonly now: number
  readonly polledAt: number | undefined
  readonly newsAt: number
  readonly every: Duration.Duration
}) => {
  if (input.polledAt === undefined) return true
  const every = Duration.toMillis(input.every)
  const quiet = input.now - input.newsAt >= Duration.toMillis(QUIET_AFTER)
  // Half a turn's slack, so a change asked every turn isn't skipped for a few milliseconds.
  return input.now - input.polledAt >= (quiet ? every * QUIET_SLOWER : every) - every / 2
}

/** How many times a change's lead may try to fix its failing checks alone; the next failure makes the change the person's (ADR-040). */
export const FIX_ROUNDS = 3

/** How long a change's checks may run, while Althar sees them through, before the change is the person's (ADR-041). */
export const STUCK_AFTER = Duration.minutes(45)

/** How long a check run again may take to show it runs before a failure is taken as its result (ADR-041). */
export const RERUN_SHOWS = Duration.minutes(3)

/** How often, and how many times, a merge its host took but hasn't landed yet is asked about: for a minute. */
export const LANDING_EVERY = Duration.seconds(2)

export const LANDING_TURNS = 30

/** How long `push_tag` waits for the person before it returns, and the lead is told later: well within what agents wait for a tool. */
export const TAG_ANSWERED_WITHIN = Duration.seconds(30)

/** A change in Althar's hands: how often its checks failed since its work came back, whether they run now, and whether it gave up. */
export interface Hands {
  readonly failed: number
  readonly running: boolean
  /** Its checks failed again after `FIX_ROUNDS` fixes: it is the person's now. */
  readonly given: boolean
}

/**
 * Where the checks that failed on a task's open pull requests stand, whether
 * or not the person has looked (ADR-070), as `fixesOf` reads them: a run of
 * failures its lead sees through, the checks on its fix running, and why the
 * failing checks are the person's where they are.
 */
export interface Fixing {
  /** A run of failures is its lead's to see through: tries left, not brought to the person, nor stopped by them since. */
  readonly open: boolean
  /** While so, the checks on its fix run, or haven't shown yet: it is under way. */
  readonly running: boolean
  /** While so, the checks on its head fail: its lead is told them, or at them, so it is under way, not the person's (DEV-173). */
  readonly withLead: boolean
  /**
   * The checks on its head fail and are its lead's, but its lead doesn't have the message that they failed: a look that ended
   * before it told the lead, or a message waiting for a lead that never started. Nobody is on them until the next look tells
   * the lead or hands them to the person.
   */
  readonly untold: boolean
  /** A run of failures its lead is really on: open, and told, or the checks on its fix running. */
  readonly onIt: boolean
  /** Why the checks that fail on its head are the person's, as its card says: its lead's words, or that its tries are spent. */
  readonly why: string | null
  /** Its tries spent: a failure now is the person's, not its lead's. */
  readonly spent: boolean
  /** Checks failing on its head now go to its lead once they end: tries left, not brought to the person, nor stopped by them since. */
  readonly failuresGo: boolean
}

export const COMMENTS_SHOWN = 30

/** How many of the commits a push would send its request lists; it says how many there are in all. */
export const COMMITS_SHOWN = 20

/** A push the lead asked the person for, as its item in the task's thread keeps it. */
export type Asked = typeof PushRequestItem.fields.content.Type

export const decodeAsked = Schema.decodeUnknownOption(Schema.fromJsonString(PushRequestItem.fields.content))

/** Checks that failed: by name where one did, or how many. */
export const checksFailed = (failing: ReadonlyArray<string>) =>
  failing.length === 1 ? `${failing[0]} failed` : `${failing.length} checks failed`

/** Some of something, counted: "1 pull request", "2 pull requests". */
export const countOf = (n: number, one: string) => (n === 1 ? `1 ${one}` : `${n} ${one}s`)

/** What was pushed, by its branch where there was one, or how many. */
export const pushedWords = (branches: ReadonlyArray<string>) => {
  const unique = [...new Set(branches)]
  return unique.length === 1 ? `Pushed ${unique[0]}.` : `Pushed ${unique.length} branches.`
}

/** Files named in a sentence, the first few. */
export const filesWord = (files: ReadonlyArray<string>) =>
  files.length <= 5 ? files.join(', ') : `${files.slice(0, 5).join(', ')} and ${files.length - 5} more`

export const snapshotOf = (
  change: ChangeRequest,
  repository: ReadonlyArray<string>,
  words: Snapshot['words'],
  checks: Snapshot['checks'],
  /** As it was seen before: where its branch is stays as last said where the host doesn't say now. */
  before?: Snapshot,
): Snapshot => ({
  number: change.number,
  title: change.title,
  url: change.url,
  state: change.state,
  draft: change.draft,
  headSha: change.headSha,
  additions: change.additions,
  deletions: change.deletions,
  changedFiles: change.changedFiles,
  repository: [...repository],
  words: { noun: words.noun, short: words.short, prefix: words.prefix },
  checks,
  target: change.target,
  conflicts: change.conflicts ?? null,
  source: change.source,
  ...(change.queued === true ? { queued: true } : {}),
  ...(change.headRepository !== undefined ? { head: change.headRepository } : before?.head !== undefined ? { head: before.head } : {}),
  // What merging needs stays as last read until it is read again, on its own turn (DEV-204).
  ...(before?.rules === undefined || change.state !== 'open' ? {} : { rules: before.rules }),
})

export type Store =
  | Errands
  | SqlClient.SqlClient
  | Instance
  | Ledger
  | Crypto.Crypto
  | Connections
  | Sessions
  | RuntimeConfig
  | ToolServer
  | Agents
  | Policies
  | Live
  | Busy
  | IssueChanges
  | FastLane
  | LeftBehind
  | Models

/** A task's pull request on its host, to act on: its link, as last seen, and the host, repository and account it is reached by. */
export interface OnHost {
  readonly linkId: string
  readonly projectId: ProjectId
  readonly change: ChangeSummary
  readonly host: CodeHost
  readonly repository: Repository
  readonly account: Account
}

/** Where a task's conflict round stands, as its card says it (`Changes.conflictStanding`). */
export type ConflictStanding =
  | { readonly state: 'resolving'; readonly checks: boolean }
  /** Waiting on the checks of the merge it pushed: under way, the lead asked again should they fail. */
  | { readonly state: 'checking' }
  /** Its pull request conflicts and goes to its lead as Althar next looks at it: on its way back to work, not the person's. */
  | { readonly state: 'due' }
  | { readonly state: 'handed_back'; readonly why: string }
  /** It conflicts, and its lead wasn't asked to resolve it: why, for its card, with Resolve now beside it. */
  | { readonly state: 'unsent'; readonly why: string }
  /** Althar couldn't look here for whether it conflicts, and its host doesn't say it does: why, with Look again beside it. */
  | { readonly state: 'unchecked'; readonly why: string }

/**
 * Whether a task's conflict is its lead's to resolve now (`askable`): yes;
 * a round under way; one waiting on the checks of the merge it pushed, where
 * what it merged may have moved on since (`checking`); nothing to say, as the
 * task isn't open, or a round the lead couldn't resolve is theirs already
 * (`handed`); or why not, said on its card where `shown`, and logged either
 * way, as where the person turned it off.
 */
export type Askable =
  | 'yes'
  | 'resolving'
  | 'checking'
  | 'off'
  | 'handed'
  | { readonly why: string; readonly shown: boolean; readonly off?: boolean }

/** Why a conflict waits for the person where they turned off the lead resolving it, as its card says beside Resolve now. */
export const OFF_FOR_TASK = '“Resolve conflicts automatically” is off for this task.'

export const OFF_FOR_PROJECT = '“Resolve merge conflicts automatically” is off in the project’s settings.'

export interface RoundRow {
  readonly id: string
  readonly projectId: ProjectId
  readonly taskId: string
  readonly threadId: string
  readonly url: string | null
  readonly conflicts: string
  readonly attempt: number
  readonly state: string
  readonly failure: string | null
  readonly ended: string | null
  readonly pushedHead: string | null
  readonly askedSequence: number | null
  readonly updatedAt: string
  /** The ask it waits to put to the lead until a place among the agents at work on this machine frees; null once asked. */
  readonly waiting: string | null
}

/** What a round keeps while it waits for a place to ask its lead: which attempt, what it asks and why, and since when. */
export const RoundWaiting = Schema.Struct({
  attempt: Schema.Int,
  body: Schema.String,
  why: Schema.Record(Schema.String, Schema.Unknown),
  since: Schema.String,
})

export type RoundWaiting = typeof RoundWaiting.Type

/** Why something failed, after a sentence that already names what was tried: git's most telling line, or what went wrong otherwise. */
export const gitSaidOf = (cause: Cause.Cause<unknown>) => {
  const failed = gitFailureOf(cause)
  return failed === undefined ? summarize(cause) : sentence(gitLineOf(failed))
}

/** A branch that couldn't be fetched to merge with a task's, for its card: with what git said. */
export const couldntFetch = (target: string, failed: GitFailed) =>
  `Althar couldn’t fetch ${target} to merge it with the branch here: ${sentence(gitLineOf(failed))}`

/** A task's branch that couldn't be read here, for its card: with what git said. */
export const couldntRead = (failed: GitFailed) => `Althar couldn’t read the branch here: ${sentence(gitLineOf(failed))}`

/** What git said of a failure, in a line, or how it ended where it said nothing. */
export const gitLineOf = (failed: GitFailure) => gitLine(failed.stderr) || gitSummary(failed)

/** One of a task's repositories here: its worktree and branch, the default branch it merges into, and whether it has a pull request. */
export interface HereRow {
  readonly slug: string
  readonly name: string
  readonly base: string
  readonly root: string
  readonly worktree: string
  readonly branch: string
  readonly opened: number
}

/** An issue a task came from, as its pull requests name and link it. */
export interface IssueLinkRow {
  readonly id: string
  readonly product: Product
  readonly key: string
  readonly url: string
  readonly ref: string
  readonly connectionId: string | null
  readonly partOf: number
}

export interface LinkRow {
  readonly id: string
  readonly projectId: ProjectId
  readonly taskId: string
  readonly connectionId: string | null
  readonly product: Product
  readonly snapshot: string
  readonly cursor: string | null
  readonly listening: number
}

/** Why a lead's pull request tool can't, in words for it, where that is the host's or the person's to put right; else nothing. */
export const refusalOf = (error: unknown) => {
  // A review's lead, reading someone else's pull request, never gets here: its tools are a review's (Reviews.ts).
  if (error instanceof NotFound && error.kind === 'pull request')
    return 'This task has no pull request yet. Althar opens one when the plan’s steps are done.'
  if (error instanceof NotConnected || (error instanceof NotFound && error.kind === 'connection'))
    return 'Althar isn’t connected to this repository’s host, so it can’t reach the pull request. Tell the person.'
  if (error instanceof ConnectorFailed) return `The code host said: ${error.message}`
  return undefined
}
