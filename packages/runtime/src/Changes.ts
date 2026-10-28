import { contained } from './Failures'
import { REPORT_FOR } from './leftRunning'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'

import {
  type Account,
  ChangeRequest,
  type CodeHost,
  Comment,
  ConnectorFailed,
  type Person,
  type Product,
  products,
  type Repository,
} from '@althar/connectors'
import { PushRequestItem } from '@althar/contracts'
import type { PermissionRequest } from '@althar/provider-adapters'
import { type ActorId, type CommandEnvelope, Ids, newId, type ProjectId } from '@althar/domain'
import { bumpRevision, type Ledger } from '@althar/persistence-sqlite'
import {
  Cause,
  Clock,
  Context,
  type Crypto,
  Deferred,
  Duration,
  Effect,
  Layer,
  Option,
  Queue,
  Ref,
  Schema,
  Scope,
  Semaphore,
  Stream,
} from 'effect'
import { SqlClient } from 'effect/sql'

import { Busy } from './Busy'
import { touchCard, touchTask } from './cards'
import { logForLead, logPage, readLog } from './checkLogs'
import { Agents, RuntimeConfig } from './Config'
import { Connections, NotConnected } from './Connections'
import {
  ATTEMPTS,
  BUSY_UP_TO,
  changeOf,
  type Conflict,
  Conflicts,
  Ended,
  fixNoteFor,
  NO_CHECKS_AFTER,
  noteFor,
  onlyTheFix,
  onlyTheResolution,
  type Place,
  unresolved,
  shortWhereLine,
  whereLine,
} from './conflicts'
import { coAuthorOn, creditBranch, type Memory, recallMade, rememberMade, withoutAgentCredit } from './credit'
import { envelope } from './envelope'
import { evidencePaths, taskShown } from './evidence'
import { AttachRefused, CantMerge, ChangedSinceSeen, GitFailed, NoChangeToOpen, NotFound, PushRefused } from './errors'
import { conventionsAt, ruleOf, titleFor } from './conventions'
import { forkOf } from './forks'
import { makeKeyedLock } from './keyedLock'
import {
  branchExists,
  commitOf,
  commitsAhead,
  commitsOf,
  git,
  fetchInto,
  gitOutcome,
  gitWithin,
  namedRemotes,
  onHead,
  pushTo,
  remoteOf,
  remoteTip,
  uncommittedFiles,
} from './git'
import { Instance } from './Instance'
import { Live, type LiveEvent } from './Live'
import { applyMerges, conflictsOf, planMerge } from './localMerge'
import { outward, reconcileOutward } from './outward'
import {
  answerHint,
  baseChecksForLead,
  bodyOf,
  checksForLead,
  checksForLeadAlone,
  checksGoneForLead,
  checksLine,
  checksOf,
  checksSpentForLead,
  checksUnsettledForLead,
  commentForLead,
  commentLine,
  fromAlthar,
  nameOf,
  outsidersLine,
  reviewForLead,
  reviewLine,
  signed,
  spentLine,
  standing,
  unsettledLine,
} from './pullRequestWords'
import { change, fact, timestamp } from './records'
import { indexTask } from './Search'
import { IssueChanges } from './IssueChanges'
import { Policies, resolvesConflictsFor, ruleSetOf } from './Policies'
import { Sessions } from './Sessions'
import { spanOf } from './stallWatch'
import { addItem, updateItem } from './threads'
import { readReviewed, reviewOf } from './reviewing'
import { ToolRefused, ToolServer, type ToolAccess } from './ToolServer'
import { summarize, words } from './words'

/*
 * A task's change on its code host (docs/architecture/06; docs/plans/
 * integrations.md): the pull request it ends with, and listening to it.
 *
 * Publishing pushes what the lead committed on the task's branch, with the
 * connection's token, and opens a draft pull request, or adopts the one
 * already open from the branch. What the lead left uncommitted stays in the
 * worktree, and the step says so. The issue's key leads its title; its body
 * is what the steps reported. Each outward action is recorded as intent
 * first, with its receipt after.
 *
 * Listening asks the code host, while the app runs, what changed: the pull
 * request's state, its checks once they finish, and what people said on it.
 * Each arrives in the task's thread once. Failed checks, and what the person
 * and the repository's own people say, also go to the lead, when one is
 * running, to answer on the pull request or fix. Anyone else on a public
 * repository arrives in the thread only, for the person to pass on. Bots,
 * and Althar's own replies (known by their receipts), aren't passed on. A
 * pull request is asked every 30 seconds while something is happening on
 * it, and every few minutes once it has been quiet a while.
 */

/** What Althar last saw of a change, as its external link keeps it. */
const Snapshot = Schema.Struct({
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
})
type Snapshot = typeof Snapshot.Type

/** The branch a pull request's commits go to on its host: its own, as last seen, else the task's, as one Althar opened has. */
const sourceOf = (snapshot: Snapshot, branch: string) => snapshot.source ?? branch

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
interface PublishInput {
  readonly projectId: ProjectId
  readonly taskId: string
  readonly runId: string
  readonly end: 'draft' | 'ready' | 'none'
  readonly again?: boolean | undefined
}

/** One of the task's repositories, as publishing reads it. */
interface PublishRow {
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
  /** For a fork: where its pull requests open, the repository it was forked from or the fork itself. */
  readonly changeTarget: 'upstream' | 'fork' | null
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
  /** When that pull request opened: its next is described from what came after. */
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
const QUIET_AFTER = Duration.minutes(10)
const QUIET_SLOWER = 10

/**
 * Every how many listening turns each open task is looked at for a conflict
 * with its default branch, which is fetched for it at most as often: a
 * branch that moved is found within minutes, whether or not its pull
 * request changed (ADR-030).
 */
const BASE_TURNS = 4

/** How many turns running a pull request whose host hasn't worked out whether it conflicts is asked again each turn. */
const UNKNOWN_TURNS = 5

/** Why a round an earlier launch left under way ended, where it couldn't be asked again. */
const STOPPED_MIDWAY = 'Althar stopped while the lead was resolving it.'

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

/** How many failing checks' logs the lead gets, and how many comments a reading of the pull request shows. */
const LOGS_TO_LEAD = 2

/** How many times a change's lead may try to fix its failing checks alone; the next failure makes the change the person's (ADR-040). */
export const FIX_ROUNDS = 3

/** How long a change's checks may run, while Althar sees them through, before the change is the person's (ADR-041). */
export const STUCK_AFTER = Duration.minutes(45)

/** How long a check run again may take to show it runs before a failure is taken as its result (ADR-041). */
const RERUN_SHOWS = Duration.minutes(3)

/** How often, and how many times, a merge its host took but hasn't landed yet is asked about: for a minute. */
const LANDING_EVERY = Duration.seconds(2)
const LANDING_TURNS = 30

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
 * or not the person has looked (ADR-068), as `fixesOf` reads them: a run of
 * failures its lead sees through, the checks on its fix running, and why the
 * failing checks are the person's where they are.
 */
export interface Fixing {
  /** A run of failures is its lead's to see through: tries left, not brought to the person, nor stopped by them since. */
  readonly open: boolean
  /** While so, the checks on its fix run, or haven't shown yet: it is under way. */
  readonly running: boolean
  /** Why the checks that fail on its head are the person's, as its card says: its lead's words, or that its tries are spent. */
  readonly why: string | null
}
const COMMENTS_SHOWN = 30
/** How many of the commits a push would send its request lists; it says how many there are in all. */
const COMMITS_SHOWN = 20

/** A push the lead asked the person for, as its item in the task's thread keeps it. */
type Asked = typeof PushRequestItem.fields.content.Type
const decodeAsked = Schema.decodeUnknownOption(Schema.fromJsonString(PushRequestItem.fields.content))

/** Commits, counted, as the lead and the person read them. */
const commitsWord = (n: number) => (n === 1 ? '1 commit' : `${n} commits`)

/** Files named in a sentence, the first few. */
const filesWord = (files: ReadonlyArray<string>) =>
  files.length <= 5 ? files.join(', ') : `${files.slice(0, 5).join(', ')} and ${files.length - 5} more`

const snapshotOf = (
  change: ChangeRequest,
  repository: ReadonlyArray<string>,
  words: Snapshot['words'],
  checks: Snapshot['checks'],
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
})

type Store =
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

/** Where a task's conflict round stands, as its card says it (`Changes.conflictStanding`). */
export type ConflictStanding =
  | { readonly state: 'resolving'; readonly checks: boolean }
  | { readonly state: 'handed_back'; readonly why: string }
  /** It conflicts, and its lead wasn't asked to resolve it: why, for its card, with Resolve now beside it. */
  | { readonly state: 'unsent'; readonly why: string }
  /** Althar couldn't look here for whether it conflicts, and its host doesn't say it does: why, with Look again beside it. */
  | { readonly state: 'unchecked'; readonly why: string }

/**
 * Whether a task's conflict is its lead's to resolve now (`askable`): yes;
 * a round under way; nothing to say, as the rules leave it to the person,
 * or a round the lead couldn't resolve is theirs already (`handed`); or why
 * not, said on its card where `shown`, and logged either way.
 */
type Askable = 'yes' | 'resolving' | 'off' | 'handed' | { readonly why: string; readonly shown: boolean }

interface RoundRow {
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
const RoundWaiting = Schema.Struct({
  attempt: Schema.Int,
  body: Schema.String,
  why: Schema.Record(Schema.String, Schema.Unknown),
  since: Schema.String,
})
type RoundWaiting = typeof RoundWaiting.Type

/** Why reading a repository failed, in a sentence: git's first line, before any usage it adds, or what went wrong otherwise. */
const gitSaid = (cause: Cause.Cause<unknown>) => {
  const failed = Option.getOrUndefined(Cause.findErrorOption(cause))
  if (!(failed instanceof GitFailed)) return summarize(cause)
  const said = failed.stderr.trim().split('\n')[0]?.trim() ?? ''
  return /[.!?]$/.test(said) ? said : `${said}.`
}

/** One of a task's repositories here: its worktree and branch, the default branch it merges into, and whether it has a pull request. */
interface HereRow {
  readonly slug: string
  readonly name: string
  readonly base: string
  readonly root: string
  readonly worktree: string
  readonly branch: string
  readonly opened: number
}

interface LinkRow {
  readonly id: string
  readonly projectId: ProjectId
  readonly taskId: string
  readonly connectionId: string | null
  readonly product: Product
  readonly snapshot: string
  readonly cursor: string | null
  readonly listening: number
}

export class Changes extends Context.Service<
  Changes,
  {
    /**
     * Pushes the task's branch and, unless its ending is to push only, opens
     * its pull request (a draft, or for review); nothing, when the branch has
     * no commits to propose. `again`, it opens the task's next pull request
     * in each repository whose last merged or closed with commits after it,
     * each on a new branch (ADR-034), and refuses where there is none.
     */
    publish(input: PublishInput): Effect.Effect<Published, unknown>
    /** The task's repositories whose last pull request merged or closed with commits after it: what a next pull request would have. */
    unshipped(taskId: string): Effect.Effect<ReadonlyArray<Unshipped>, unknown>
    /**
     * Whether the task's change is in Althar's hands (ADR-040), as `handsOf`
     * says: null where it isn't; else how often its checks failed, whether
     * they run now, and whether Althar gave it to the person once they failed
     * again after `FIX_ROUNDS` fixes.
     */
    inHands(taskId: string): Effect.Effect<Hands | null, unknown>
    /**
     * Where the checks that failed on the task's open pull requests stand,
     * whoever has looked (ADR-068): null for a settled task, or one with none
     * open.
     */
    fixing(taskId: string): Effect.Effect<Fixing | null, unknown>
    /**
     * Settles a task with pull requests as done where every repository of it
     * is merged and no commit is left after its pull requests, as a merge
     * seen on its host does: for a round of work that ended (ADR-034). One
     * with none stays as it is.
     */
    settleIfMerged(taskId: string): Effect.Effect<void, unknown>
    /**
     * Whether the task had pull requests and every repository of it is
     * merged, as settling it asks: each one's latest pull request merged,
     * and one with none has its branch's head in its default branch here.
     */
    merged(taskId: string): Effect.Effect<boolean, unknown>
    /**
     * Leaves out the commits after a merged task's last pull requests that
     * are in none yet, as the person abandoning it says (ADR-034): they stay
     * on its branch, and it settles without them, done. Nothing for an open
     * task with a pull request that didn't merge, or one abandoned.
     */
    leaveOut(input: { readonly envelope: CommandEnvelope; readonly taskId: string }): Effect.Effect<void, unknown>
    /**
     * Pushes the task's branch to its open pull request, up to the commit the
     * person saw: theirs to do, after looking at what the lead committed. One
     * that isn't on the branch any more isn't pushed.
     */
    push(taskId: string, head: string, url?: string): Effect.Effect<{ readonly change: ChangeSummary }, unknown>
    /**
     * Replaces the commits on the task's pull request with its branch here, up
     * to the commit the person saw, after its published commits were rewritten:
     * a force push, theirs to confirm, and only while the pull request is still
     * at `replaces`, the head they saw it at.
     */
    replace(taskId: string, head: string, replaces: string, url?: string): Effect.Effect<{ readonly change: ChangeSummary }, unknown>
    /**
     * What to tell the lead so its branch takes the pull request's commits in
     * by merging, and a plain push works again: the pull request's head is
     * fetched here first.
     */
    mergeNote(taskId: string, url?: string): Effect.Effect<{ readonly note: string; readonly head: string }, unknown>
    /**
     * Closes the task's pull request at this address without merging it,
     * because the person said to: never on an agent's word. Read back at
     * once, closed, it is listened to no more; with `deleteBranch`, its branch
     * on the host goes too, once it is closed. What the host refused to close
     * fails, and it stays as it was seen; a branch it refused to delete is
     * said in `branch`, the pull request closed all the same.
     */
    close(
      taskId: string,
      url: string,
      options: { readonly deleteBranch: boolean },
    ): Effect.Effect<{ readonly change: ChangeSummary; readonly branch: string | null }, unknown>
    /** Marks the task's draft pull request ready for review: the person's to do. */
    markReady(taskId: string, url?: string): Effect.Effect<void, unknown>
    /**
     * Merges the task's pull request at the head the person saw, because
     * they said to, marking a draft ready first; one that moved on since
     * isn't merged. Agents never merge.
     */
    merge(taskId: string, head: string, url?: string): Effect.Effect<void, unknown>
    /**
     * Merges the task's branch into each of its repositories' default
     * branches on this Mac, up to the commit the person saw in each, where it
     * has no pull request: all of them or none, and nothing pushed. Its task
     * settles.
     */
    mergeHere(
      taskId: string,
      heads: ReadonlyArray<{ readonly repository: string; readonly head: string }>,
    ): Effect.Effect<ReadonlyArray<{ readonly repository: string; readonly branch: string; readonly already: boolean }>, unknown>
    /**
     * Pushes each default branch the task merged into here to the remote it
     * follows, with the person's own git sign-in (their keychain or SSH
     * agent), not a code host's: what they would run themselves.
     */
    pushHere(taskId: string): Effect.Effect<ReadonlyArray<{ readonly branch: string; readonly remote: string }>, unknown>
    /** Pushes a task's branch to each of its repositories' remotes, with the person's own git, up to the commits they saw. */
    pushBranch(
      taskId: string,
      heads: ReadonlyArray<{ readonly repository: string; readonly head: string }>,
    ): Effect.Effect<ReadonlyArray<{ readonly branch: string; readonly remote: string }>, unknown>
    /** Replies on the task's pull request, in a comment's thread or its conversation, signed as from Althar and the agent that wrote it. */
    reply(
      taskId: string,
      reply: { readonly body: string; readonly threadId: string | null; readonly by: string | null },
    ): Effect.Effect<ChangeSummary, unknown>
    /** The pull request as it stands, in words for an agent: its state, checks (a failure's log), and what was said. */
    read(taskId: string): Effect.Effect<string, unknown>
    /** The task's changes, as last seen. */
    ofTask(taskId: string): Effect.Effect<ReadonlyArray<ChangeSummary>, unknown>
    /**
     * Attaches the task to an open pull request it didn't open, by its link
     * or number, and follows it from then on (ADR-052); or says what starting
     * its branch from that pull request's head would keep, where it isn't
     * based on it and the person hasn't said to.
     */
    attach(input: AttachInput): Effect.Effect<Attached, unknown>
    /**
     * Reads each settled task's pull request that was left open and isn't
     * listened to, once, so its card says how it stands on its host now: at
     * launch, by itself.
     */
    readSettled: Effect.Effect<void>
    /** Asks the code host now, rather than at the next turn of listening. */
    refresh(taskId: string): Effect.Effect<void>
    /**
     * Stops listening to the task's pull request at this address, as the
     * person says: nothing said there after arrives, and a conflict Althar was
     * following there is the person's.
     */
    stopListening(taskId: string, url: string): Effect.Effect<void, unknown>
    /**
     * The person stopped or interrupted a task's lead, or stopped the task: a
     * conflict its lead was resolving, or whose checks Althar was waiting for,
     * is theirs from here. Nothing more is pushed for it, and the lead isn't
     * asked again for it.
     */
    leadStopped(
      where: { readonly taskId: string } | { readonly threadId: string },
      how?: 'stopped' | 'interrupted',
    ): Effect.Effect<void, unknown>
    /**
     * Where a project's leads, or a task's, are newly to resolve conflicts on
     * their own (ADR-030): each of its open tasks is looked at now, rather
     * than at its next conflict, and one that already conflicts starts a
     * round, as any conflict found would. Done apart: this returns before
     * any is looked at. Each default branch is fetched again first, and a
     * pull request is merged with it here, whatever its host says. Forced,
     * as the person's Resolve now on one task is, its lead is asked though
     * the rules leave it to the person, they stopped it, or its last round
     * was handed back to them.
     */
    resolveNow(where: { readonly projectId: string } | { readonly taskId: string }, force?: boolean): Effect.Effect<void>
    /**
     * Whether a task's lead resolves a conflict on its own otherwise than its
     * project's rules say, as the person says; null goes back to them. The
     * next conflict found goes by it; turned on, what already conflicts is
     * resolved now (`resolveNow`).
     */
    setResolveConflicts(input: {
      readonly envelope: CommandEnvelope
      readonly taskId: string
      readonly resolveConflicts: boolean | null
    }): Effect.Effect<void, unknown>
    /**
     * Where a task's latest conflict round stands, for its card: the lead at
     * work on one (`resolving`; `checks` where it is fixing the checks that
     * failed on what Althar pushed rather than the conflict), or handed back
     * to the person, saying why, for as long as the task's branches are as
     * the lead left them; or conflicting, and not asked of its lead, saying
     * why (`unsent`). Null otherwise, such as while Althar waits for the
     * checks on what it pushed.
     */
    conflictStanding(taskId: string): Effect.Effect<ConflictStanding | null>
    /** Does something with a task's pull request as one action: one at a time with replying, pushing, marking ready and merging. */
    exclusive<A, E, R>(taskId: string, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R>
    /**
     * How a task of the project ends when its plan doesn't say, worked out
     * once, when the plan is made: as the project's rules say, else a draft
     * pull request where its repository's host is connected, else on its
     * branch. A project that wants a pull request where no host Althar
     * knows is named ends on its branch, as it always has.
     */
    endFor(projectId: string, taskId?: string): Effect.Effect<'draft' | 'ready' | 'none' | null, unknown>
    /**
     * The code host the project's repositories are on, and whether Althar is
     * connected to it: the first connected, else the first Althar knows; null
     * where their remotes name none it knows.
     */
    hostFor(projectId: string): Effect.Effect<Host | null>
    /** Each host of a project's repositories, or of those a task changes: null for one on none Althar knows. */
    hostsFor(projectId: string, taskId?: string): Effect.Effect<ReadonlyArray<Host | null>>
  }
>()('@althar/runtime/Changes') {
  static readonly layer: Layer.Layer<Changes, never, Store> = Layer.effect(
    Changes,
    Effect.gen(function* () {
      const context = yield* Effect.context<Store>()
      const instance = yield* Instance
      const connections = yield* Connections
      const sessions = yield* Sessions
      const busy = yield* Busy
      const toolServer = yield* ToolServer
      const agents = yield* Agents
      const live = yield* Live
      const scope = yield* Scope.Scope
      const issueChanges = yield* IssueChanges
      /** Offers to move a task's issue along with its pull request, in the background: nothing it meets holds the pull request up. */
      const follow = (taskId: string, event: 'opened' | 'merged', change: Parameters<typeof nameOf>[0]) =>
        Effect.asVoid(Effect.forkIn(issueChanges.followPullRequest(taskId, event, { key: nameOf(change) }), scope))
      const every = (yield* RuntimeConfig).listenEvery ?? Duration.seconds(30)
      const checksAppear = Duration.toMillis((yield* RuntimeConfig).checksAppear ?? Duration.minutes(1))
      const stuckAfter = (yield* RuntimeConfig).checksStuck ?? STUCK_AFTER
      /* One thing at a time on a task's pull request: a reply's receipt is kept before listening reads the reply back. */
      const locks = makeKeyedLock()
      const locked =
        (taskId: string) =>
        <A, E, R>(effect: Effect.Effect<A, E, R>) =>
          locks.withLock(taskId, effect)
      /*
       * Default branches move here, by a local merge, and go to their remotes,
       * by a push, one at a time across every task: a push never sends what a
       * merge of several repositories moved and is about to put back.
       */
      const branches = Semaphore.makeUnsafe(1)
      /*
       * Pull requests are attached one at a time across every task: whether
       * another task follows one, or sends its work there, is read and the
       * attachment written with no other attaching in between.
       */
      const attaching = Semaphore.makeUnsafe(1)
      /* What Althar made again of agents' commits, kept in the profile (credit.ts). */
      const memory: Memory = {
        recall: (commits) => recallMade(commits).pipe(Effect.provideContext(context)),
        remember: (made) => rememberMade(made).pipe(Effect.provideContext(context)),
      }
      /* What the agents Althar runs call themselves, so their credit lines are known by name too. */
      const agentNames = agents.list.map((entry) => entry.definition.name)

      /**
       * A worktree's branch with the commits not sent yet credited as the
       * person set it (credit.ts): the agents' lines out, Althar's in. `known`
       * were sent before and stay. What `head` became, and `settle`, which
       * moves the branch onto it once it is sent. `head` may be one from
       * before the branch was credited, which the person saw: it becomes the
       * same commit the branch did.
       */
      const credited = (cwd: string, branch: string, head: string, known: ReadonlyArray<string | null>) =>
        Effect.gen(function* () {
          const coAuthor = yield* coAuthorOn
          const credited = yield* creditBranch(cwd, branch, { head, known, coAuthor, agents: agentNames, memory })
          return { head: credited.head, settle: credited.settle }
        })
      /* When each task's pull request last had news, and when each was last asked: quiet ones are asked less often. */
      const newsAt = new Map<string, number>()
      const polledAt = new Map<string, number>()
      const news = (taskId: string) => Effect.map(Clock.currentTimeMillis, (now) => void newsAt.set(taskId, now))
      /*
       * Why each task whose branch conflicts wasn't asked of its lead, or couldn't be looked at for one (`checked` false): its card
       * says so until it is, or conflicts no more.
       */
      const unsent = new Map<string, { readonly why: string; readonly checked: boolean }>()
      /* Where each repository's default branch was when last fetched to look for conflicts, and when, by binding and ref. */
      const fetchedAt = new Map<string, { readonly at: number; readonly tip: string }>()
      /* How often a default branch is fetched at most to look for conflicts with what goes into it: a few listening turns. */
      const baseEvery = Duration.toMillis(every) * BASE_TURNS
      /* Pull requests whose host hasn't worked out yet whether they conflict, by how many turns running: asked again next turn. */
      const unknownFor = new Map<string, number>()
      /* Wakes the look for conflicts before its time: a default branch moved, as Althar saw. */
      const sweepWake = yield* Queue.sliding<boolean>(1)
      /** A default branch moved, as Althar saw: each is fetched again, and every open task looked at for a conflict with it now. */
      const baseMoved = Effect.sync(() => {
        fetchedAt.clear()
        Queue.offerUnsafe(sweepWake, true)
      })
      /* The last reason logged for each task's conflict not sent to its lead: each is logged once. */
      const logged = new Map<string, string>()
      /* Tasks the person pressed Resolve now on: why it went nowhere stays, though the rules leave it to them, until it is answered. */
      const pressed = new Set<string>()
      const provide = <A, E>(effect: Effect.Effect<A, E, Store>) => Effect.provideContext(effect, context)
      const decodeSnapshot = Schema.decodeUnknownEffect(Schema.fromJsonString(Snapshot))

      const linksOf = (taskId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          return yield* sql<LinkRow>`
            SELECT id, project_id, task_id, connection_id, product, snapshot, cursor, listening FROM external_links
            WHERE task_id = ${taskId} AND kind = 'change' ORDER BY created_at`
        })

      const summaryOf = (link: LinkRow) =>
        Effect.map(decodeSnapshot(link.snapshot), (snapshot): ChangeSummary => ({
          ...snapshot,
          linkId: link.id,
          product: link.product,
          listening: link.listening === 1,
        }))

      /**
       * The task's open change, and its host: what the person's actions and the
       * lead's tools act on. In a task of several repositories, the one at `url`;
       * without it, the first open one, else its latest: a task whose pull
       * request merged may have another since (ADR-034).
       */
      const current = (taskId: string, url?: string) =>
        Effect.gen(function* () {
          const all = yield* Effect.forEach(yield* linksOf(taskId), (link) =>
            Effect.map(Effect.option(decodeSnapshot(link.snapshot)), (seen) => ({ link, seen: Option.getOrUndefined(seen) })),
          )
          const links = url === undefined ? all : all.filter((candidate) => candidate.seen?.url === url)
          const reachable = links.filter((candidate) => candidate.link.connectionId !== null)
          // The one it follows first: one attached since takes over from one still open before it (ADR-052).
          const link = (
            reachable.find((candidate) => candidate.seen?.state === 'open' && candidate.link.listening === 1) ??
            reachable.find((candidate) => candidate.seen?.state === 'open') ??
            reachable.at(-1) ??
            links.find((candidate) => candidate.seen?.state === 'open') ??
            links.at(-1)
          )?.link
          if (link === undefined) return yield* new NotFound({ kind: 'pull request', id: taskId })
          if (link.connectionId === null) return yield* new NotConnected({ product: link.product, what: 'the task’s pull request' })
          const adapters = yield* connections.adapters(link.connectionId)
          if (adapters.host === undefined) return yield* new NotConnected({ product: link.product, what: 'the task’s pull request' })
          const snapshot = yield* decodeSnapshot(link.snapshot)
          const repository = yield* adapters.host.repository(snapshot.repository)
          return { link, snapshot, host: adapters.host, repository, account: adapters.info.account }
        })

      /**
       * The pull request's description, as the lead wrote it for the
       * repository, in its template where it has one; where it wrote none,
       * what the task built. A task's next pull request, after one merged or
       * closed, is described from what came `since` that one opened: its own
       * work, not the last one's again (ADR-034).
       */
      const bodyFor = (
        threadId: string,
        issue: { readonly key: string; readonly url: string; readonly sameHost: boolean } | null,
        repository: { readonly slug: string; readonly template: string | null },
        since: string | null = null,
      ) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const after = sql`(${since} IS NULL OR created_at > ${since})`
          const [lead] = yield* sql<{ summary: string }>`
            SELECT json_extract(content, '$.summary') AS summary FROM thread_items WHERE thread_id = ${threadId} AND kind = 'step_result'
              AND json_extract(content, '$.step') IN ('implement', 'settle') AND ${after} ORDER BY sequence DESC LIMIT 1`
          // The lead's latest description, for this repository: settling that changed the work may have written it again.
          const [written] = yield* sql<{ text: string | null }>`
            SELECT json_extract(content, '$.descriptions.' || json_quote(${repository.slug})) AS text FROM thread_items
            WHERE thread_id = ${threadId} AND kind = 'step_result'
              AND json_extract(content, '$.descriptions.' || json_quote(${repository.slug})) IS NOT NULL AND ${after}
            ORDER BY sequence DESC LIMIT 1`
          // What the task built, where the lead wrote no description: since the last pull request, for a next one (ADR-034).
          const { built } = yield* taskShown(threadId, since)
          // An automation's run is signed with its name.
          const [automated] = yield* sql<{ name: string }>`
            SELECT d.name FROM threads h JOIN automation_occurrences o ON o.task_id = h.task_id
            JOIN automations a ON a.id = o.automation_id JOIN automation_definitions d ON d.automation_id = a.id AND d.number = a.definition
            WHERE h.id = ${threadId} LIMIT 1`
          // An agent may sign what it writes as it signs a commit; that stays here too.
          return bodyOf({
            built: built === null ? null : withoutAgentCredit(built, agentNames),
            lead: lead === undefined ? null : withoutAgentCredit(lead.summary, agentNames),
            issue,
            template: repository.template,
            written: written === undefined || written.text === null ? null : withoutAgentCredit(written.text, agentNames),
            credit: yield* coAuthorOn,
            automation: automated?.name ?? null,
          })
        })

      /** The hosts of a project's repositories, or of those a task changes, the first first: null for each on none Althar knows. */
      const hostsFor = (projectId: string, taskId?: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const bindings =
            taskId === undefined
              ? yield* sql<{ remotes: string }>`
                  SELECT remote_fingerprints AS remotes FROM repository_bindings WHERE project_id = ${projectId} AND detached_at IS NULL
                  ORDER BY created_at, rowid`
              : yield* sql<{ remotes: string }>`
                  SELECT b.remote_fingerprints AS remotes FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id
                  WHERE w.task_id = ${taskId} AND w.device_id = ${instance.deviceId} ORDER BY b.created_at, b.rowid`
          return yield* Effect.forEach(bindings, (binding) =>
            hostOfRemotes(
              Option.getOrElse(Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(Schema.String)))(binding.remotes), () => []),
            ),
          )
        })

      const hostFor = (projectId: string): Effect.Effect<Host | null, never, Store> =>
        Effect.map(
          hostsFor(projectId),
          (hosts) => hosts.find((host) => host?.connected === true) ?? hosts.find((host) => host !== null) ?? null,
        ).pipe(Effect.orElseSucceed(() => null))

      /** The host a repository's remotes are on, and whether Althar is connected to it; null where they name none it knows. */
      const hostOfRemotes = (remotes: ReadonlyArray<string>): Effect.Effect<Host | null, never, Store> =>
        Effect.gen(function* () {
          const places = yield* Effect.forEach(remotes, (remote) => connections.placeOf(remote))
          for (const place of places)
            if (place?.code != null && place.connection?.state === 'ready')
              return { product: place.code.product, name: place.code.name, webUrl: place.connection.webUrl, connected: true }
          for (const place of places)
            if (place?.code != null)
              return { product: place.code.product, name: place.code.name, webUrl: `https://${place.host}`, connected: false }
          return null
        }).pipe(Effect.orElseSucceed(() => null))

      /** The product of a connection at one of the remotes' hosts that needs signing in again, if there is one. */
      const signInLostAt = (remotes: ReadonlyArray<string>): Effect.Effect<string | null, never, Store> =>
        Effect.gen(function* () {
          for (const remote of remotes) {
            const place = yield* connections.placeOf(remote)
            if (place?.connection?.state === 'reauth_required') return place.connection.product
          }
          return null
        }).pipe(Effect.orElseSucceed(() => null))

      const publish = (input: PublishInput): Effect.Effect<Published, unknown, Store> =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const tasks = yield* sql<PublishRow>`
            SELECT k.title, b.display_name AS name, b.slug, t.id AS thread_id, w.id AS workspace_id, w.path, w.branch, w.base_commit, w.base_ref, b.id AS binding_id,
              w.branched_at IS NOT NULL AS branched, b.remote_fingerprints AS remotes, b.default_base_ref AS default_base, b.change_target
            FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task'
            JOIN workspaces w ON w.task_id = k.id AND w.device_id = ${instance.deviceId} AND w.access = 'write'
            JOIN repository_bindings b ON b.id = w.binding_id
            WHERE k.id = ${input.taskId} ORDER BY b.created_at, b.rowid`
          if (tasks.length === 0) return yield* new NotFound({ kind: 'task', id: input.taskId })
          const [bound] = yield* sql<{ n: number }>`
            SELECT count(*) AS n FROM repository_bindings WHERE project_id = ${input.projectId} AND detached_at IS NULL`
          // Its next pull request goes only where the last one merged or closed with commits after it; the rest stand as they are.
          const after = input.again === true ? yield* unshippedOf(input.taskId) : []
          if (input.again === true && after.length === 0) return yield* new NoChangeToOpen({ taskId: input.taskId, why: 'nothing' })
          // Each repository on its own: one whose host isn't connected is said once the rest are done, for the person to connect and try again.
          const done: Array<PublishedOne> = []
          let unconnected: NotConnected | undefined
          for (const task of tasks) {
            const next = after.find((one) => one.workspaceId === task.workspaceId)
            if (input.again === true && next === undefined) continue
            const one = yield* Effect.exit(publishOne(input, task, { several: tasks.length > 1, ofSeveral: (bound?.n ?? 0) > 1 }, next))
            if (one._tag === 'Success') done.push({ ...one.value, repository: task.name })
            else {
              const error = Cause.findErrorOption(one.cause)
              if (Option.isSome(error) && error.value instanceof NotConnected) unconnected ??= error.value
              else return yield* Effect.failCause(one.cause)
            }
          }
          if (unconnected !== undefined) return yield* unconnected
          return done
        })

      /** The name a repository's next pull request's branch takes: the task's first branch's, with `-2` (`-3` and on), the first free here and on the host. */
      const nextBranch = (task: PublishRow, pushTarget: { readonly url: string; readonly header: string | null }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [first] = yield* sql<{ branch: string; n: number }>`
            SELECT (SELECT branch FROM repository_changes WHERE workspace_id = ${task.workspaceId} ORDER BY created_at, rowid LIMIT 1) AS branch,
              (SELECT count(DISTINCT branch) FROM repository_changes WHERE workspace_id = ${task.workspaceId}) AS n`
          const named = first?.branch ?? task.branch
          for (let n = Math.max(2, (first?.n ?? 1) + 1); ; n += 1) {
            const candidate = `${named}-${n}`
            if (!(yield* branchExists(task.path, candidate)) && (yield* remoteTip(task.path, pushTarget, candidate)) === null)
              return candidate
          }
        })

      /**
       * Cherry-picks commits onto the worktree's branch, one by one: one whose
       * change is there already is left out. The files they conflict in, with
       * nothing picked left half done, or null once all are on it.
       */
      const pickOnto = (path: string, commits: ReadonlyArray<string>) =>
        Effect.gen(function* () {
          // As the person's own git commits, or as Althar where this Mac names no one.
          const named = (yield* gitOutcome(path, 'config', 'user.email')).stdout !== '' || process.env.GIT_COMMITTER_EMAIL !== undefined
          const as = named ? [] : ['-c', 'user.name=Althar', '-c', 'user.email=althar@localhost']
          for (const commit of commits) {
            if ((yield* gitOutcome(path, ...as, 'cherry-pick', commit)).code === 0) continue
            const conflicted = (yield* gitOutcome(path, 'diff', '--name-only', '--diff-filter=U')).stdout
              .split('\n')
              .filter((file) => file !== '')
            if (conflicted.length === 0 && (yield* gitOutcome(path, ...as, 'cherry-pick', '--skip')).code === 0) continue
            yield* gitOutcome(path, 'cherry-pick', '--abort')
            return conflicted
          }
          return null
        })

      /**
       * Moves a repository's worktree onto a new branch for its next pull
       * request, the last one merged or closed with commits after it
       * (ADR-034). After a merge, the branch starts from the default branch as
       * the host has it now, and takes the commits after the merged head,
       * cherry-picked, merges left out; where the lead brought that default
       * branch in already, it is the task's branch as it is. After a pull
       * request closed unmerged, nothing of it is in, so it is the task's
       * branch as it is. The merged or closed branch isn't touched, here or on
       * the host. What the lead changed and didn't commit would go with
       * neither, so it refuses; and where the commits conflict with the
       * default branch, the worktree goes back to its branch, and it says
       * which files. Where the person left out commits after it, the new
       * branch never has them: it starts from the default branch after a
       * merge, else from that pull request's head, and takes only the commits
       * after where they left them out, cherry-picked.
       */
      const rebranch = (
        projectId: ProjectId,
        taskId: string,
        task: PublishRow,
        next: Unshipped & { readonly change: ChangeSummary },
        /** Where the branch goes: the fork, for a pull request from one. */
        pushTarget: { readonly url: string; readonly header: string | null },
        /** Where the pull request opens, whose default branch it starts from: the repository a fork came from, for one into it. */
        baseTarget: { readonly url: string; readonly header: string | null },
        target: string,
      ) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          // What the person left out goes in none: a branch that has it isn't the one, nor is the task's branch as it is.
          const leftOut = next.head !== next.shipped
          // Made for it already, by a try that didn't open it, the branch is the one.
          if (next.moved && !leftOut) return task
          const changed = (yield* git(task.path, '-c', 'core.quotePath=false', 'diff', '--name-only', 'HEAD'))
            .split('\n')
            .filter((file) => file !== '')
          if (changed.length > 0) return yield* new NoChangeToOpen({ taskId, why: 'uncommitted', detail: filesWord(changed) })
          const fresh = yield* nextBranch(task, pushTarget)
          let base = task.baseCommit
          // Where the new branch starts, the commits after `head` cherry-picked onto it; null where it is the task's branch as it is.
          let start: string | null = leftOut ? next.shipped : null
          if (next.change.state === 'merged') {
            // The default branch as its host has it now, with what merged: as this Mac last saw it, it may not have that yet.
            const tip = yield* fetchInto(task.path, baseTarget, target, `refs/althar/base/${target}`)
            if (tip === null)
              return yield* new GitFailed({ args: ['fetch', target], cwd: task.path, stderr: `Couldn't fetch ${target} from the host.` })
            base = tip
            start = leftOut || !(yield* onHead(task.path, tip)) ? tip : null
          }
          if (start === null) yield* git(task.path, 'checkout', '-q', '-b', fresh)
          else {
            // The commits as the branch has them now, after the fetch: what the lead committed meanwhile goes too.
            const from = yield* commitOf(task.path, 'HEAD')
            const commits = (yield* git(task.path, 'rev-list', '--reverse', '--no-merges', `${next.head}..${from}`))
              .split('\n')
              .filter((line) => line !== '')
            yield* git(task.path, 'checkout', '-q', '-b', fresh, start)
            const conflicted = yield* pickOnto(task.path, commits)
            // One committed as it switched would be left on the old branch alone: it goes back to it, and says the lead is at work.
            const moved = (yield* commitOf(task.path, `refs/heads/${task.branch}`).pipe(Effect.orElseSucceed(() => ''))) !== from
            if (conflicted !== null || moved) {
              yield* Effect.ignore(git(task.path, 'checkout', '-q', task.branch))
              yield* Effect.ignore(git(task.path, 'branch', '-D', fresh))
              return yield* new NoChangeToOpen(
                conflicted === null ? { taskId, why: 'working' } : { taskId, why: 'conflicts', detail: filesWord(conflicted) },
              )
            }
          }
          yield* sql.withTransaction(
            Effect.gen(function* () {
              const revision = yield* change('workspaces', task.workspaceId, { branch: fresh, baseCommit: base })
              yield* fact({
                projectId,
                aggregateType: 'workspace',
                aggregateId: task.workspaceId,
                revision,
                type: 'workspace.branched',
                payload: { from: task.branch, to: fresh, base, after: next.change.url, commits: next.commits.length },
                actorId: instance.personId,
              })
              yield* indexTask(taskId)
            }),
          )
          return { ...task, branch: fresh, baseCommit: base }
        })

      /**
       * Publishes one of the task's repositories: pushes its branch, and opens or adopts its pull request where the ending says to.
       * With `next`, its next pull request, after its last merged or closed: on a new branch, described from what came since.
       */
      const publishOne = (
        input: PublishInput,
        given: PublishRow,
        /** Whether the task changes several repositories, and whether its project has several. */
        { several, ofSeveral }: { readonly several: boolean; readonly ofSeveral: boolean },
        next?: Unshipped,
      ) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          // A plain task's worktree with no branch yet holds nothing of its own: there is no branch to push (DEV-96).
          if (given.branched === 0) return { kind: 'nothing', left: [] } as const
          let task = given
          // A fork's branch goes to the fork, whatever else its clone's remotes name; its pull request, where the project says.
          const fork = yield* namedRemotes(task.path).pipe(
            Effect.map(forkOf),
            Effect.orElseSucceed(() => null),
          )
          const remotes =
            fork === null ? Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.String)))(task.remotes) : [fork.fork.url]
          // A connection there that needs signing in again, made with gh's or glab's sign-in, takes the tool's again where it can:
          // publishing, and trying again after it couldn't, need no more of the person than that.
          const found = yield* connections.hostOf(remotes, { fromCli: true })
          // In a project of several, one on no host Althar knows ends on its branch. A project of one needs its host, which may be
          // one Althar can't tell by its address until it's connected; so does one on a host it knows but isn't connected to.
          if (found === null) {
            const known = yield* hostOfRemotes(remotes)
            if (known === null && ofSeveral) return { kind: 'branch', left: [] } as const
            // Connected there, but the sign-in stopped working (or the keychain lost it): that is signing in again, not connecting.
            const lost = yield* signInLostAt(remotes)
            if (lost !== null)
              return yield* new ConnectorFailed({ product: lost, reason: 'unauthorized', message: 'The sign-in needs signing in again' })
            return yield* new NotConnected({ product: known?.product ?? 'github', what: remotes[0] ?? 'the repository' })
          }
          const { host } = found
          const own = yield* host.repository(found.path)
          // Into the repository it was forked from, on the same host, from the fork's branch.
          const repository = fork !== null && task.changeTarget === 'upstream' ? yield* host.repository(fork.upstream.path) : own
          const from = repository === own ? undefined : own
          // The repository as its host names it, not as the remote spells it: Bitbucket Data Center's has `scm/` in front.
          const path = repository.path
          const pushTarget = yield* host.pushTarget(own)
          // The branch it started from, on the repository it opens on; into the one a fork came from, from a task made before it
          // was chosen, that repository's default.
          const target =
            from === undefined
              ? (task.baseRef ?? '').replace(/^origin\//, '') || task.defaultBase || repository.defaultBranch
              : task.baseRef?.startsWith('upstream/') === true
                ? task.baseRef.slice('upstream/'.length)
                : repository.defaultBranch
          // Attached to an open pull request it didn't open, its branch goes there, and nothing else opens (ADR-052).
          const attached = next === undefined ? yield* attachedOf(input.taskId, task.workspaceId) : undefined
          if (attached !== undefined) return yield* publishAttached(input, task, attached, pushTarget)
          // Its next pull request goes on a branch of its own, the merged or closed one left as it is: from the default branch of the
          // repository it opens on, which for one from a fork into the repository it came from isn't the fork's, behind what merged.
          if (next?.change != null)
            task = yield* rebranch(
              input.projectId,
              input.taskId,
              task,
              { ...next, change: next.change },
              pushTarget,
              from === undefined ? pushTarget : yield* host.pushTarget(repository),
              target,
            )
          // Althar pushes what the lead committed, never what it left lying in the worktree; a screenshot it handed as evidence isn't left.
          const pictures = yield* evidencePaths(input.taskId)
          const left = (yield* uncommittedFiles(task.path)).filter((file) => !pictures(task.path, file))
          const base = task.baseCommit ?? task.baseRef ?? own.defaultBranch
          if ((yield* commitsAhead(task.path, base)) === 0) return { kind: 'nothing', left } as const
          const [sent] = yield* sql<{ head: string | null }>`
            SELECT head_commit AS head FROM repository_changes WHERE workspace_id = ${task.workspaceId} ORDER BY updated_at DESC LIMIT 1`
          const { head, settle } = yield* credited(task.path, task.branch, yield* commitOf(task.path, 'HEAD'), [
            task.baseCommit,
            sent?.head ?? null,
            yield* remoteTip(task.path, pushTarget, task.branch),
          ])
          yield* pushTo(task.path, pushTarget, task.branch, head)
          yield* settle
          if (input.end === 'none') return { kind: 'pushed', branch: task.branch, left } as const
          const draft = input.end === 'draft' && host.capabilities.drafts
          const [issueLink] = yield* sql<{
            id: string
            product: Product
            key: string
            url: string
            ref: string
            connectionId: string | null
          }>`
            SELECT id, product, key, url, ref, connection_id FROM external_links WHERE task_id = ${input.taskId} AND kind = 'issue' LIMIT 1`
          // A link's spelling of the repository may differ in case from the host's, which GitHub and GitLab don't mind.
          const sameHost =
            issueLink !== undefined &&
            issueLink.product === host.product &&
            issueLink.ref.toLowerCase().startsWith(`${path.join('/').toLowerCase()}#`)
          // The team's conventions, as the task's worktree has them now, under the person's own rule for titles.
          const conventions = yield* conventionsAt(task.path, 'HEAD')
          const rule = ruleOf('title', (yield* (yield* Policies).current(input.projectId)).rules.titlePattern)
          const title = titleFor(rule ?? conventions.title?.pattern ?? null, {
            title: task.title,
            issue: issueLink === undefined ? null : { key: issueLink.key, sameHost },
          })
          const body = yield* bodyFor(
            task.threadId,
            issueLink === undefined ? null : { key: issueLink.key, url: issueLink.url, sameHost },
            { slug: task.slug, template: conventions.template?.text ?? null },
            next?.openedAt ?? null,
          )
          const opened = yield* outward({
            projectId: input.projectId,
            subject: { type: 'task', id: input.taskId },
            target: `${host.product}:${path.join('/')}`,
            operation: 'open_change',
            // One per repository: in a task of several, each opens its own; alone, the key it always had.
            key: `open_change:${input.taskId}:${task.branch}${several ? `:${task.bindingId}` : ''}`,
            request: { title, source: task.branch, target, draft },
            retryable: true,
            perform: host.openChange(repository, {
              title,
              body,
              source: task.branch,
              target,
              draft,
              ...(from === undefined ? {} : { from }),
            }),
            encode: (answer) => answer,
            decode: (kept) => Option.getOrUndefined(Schema.decodeUnknownOption(ChangeRequest)(kept)),
          })
          const snapshot = snapshotOf(opened, path, host.words, null)
          const linkId = yield* sql.withTransaction(
            Effect.gen(function* () {
              const at = yield* timestamp
              // The run's record of this repository's pull request, on this branch: adopted again, as publishing again does. A
              // next pull request, on a branch of its own, is another, in a change set of the run's without this repository's, else a new one.
              const [repositoryChange] = yield* sql<{ id: string; changeSetId: string }>`
                SELECT c.id, c.change_set_id FROM repository_changes c JOIN change_sets s ON s.id = c.change_set_id
                WHERE s.run_id = ${input.runId} AND c.binding_id = ${task.bindingId} AND c.branch = ${task.branch}`
              const [set] =
                repositoryChange === undefined
                  ? yield* sql<{ id: string }>`
                      SELECT s.id FROM change_sets s WHERE s.run_id = ${input.runId}
                        AND NOT EXISTS (SELECT 1 FROM repository_changes c WHERE c.change_set_id = s.id AND c.binding_id = ${task.bindingId})
                      ORDER BY s.created_at LIMIT 1`
                  : [{ id: repositoryChange.changeSetId }]
              const changeSetId = set?.id ?? (yield* newId(Ids.changeSet))
              if (set === undefined) {
                yield* sql`INSERT INTO change_sets ${sql.insert({ id: changeSetId, projectId: input.projectId, taskId: input.taskId, runId: input.runId, state: 'published', createdAt: at })}`
                yield* fact({
                  projectId: input.projectId,
                  aggregateType: 'change_set',
                  aggregateId: changeSetId,
                  revision: 1,
                  type: 'change_set.published',
                  actorId: instance.systemId,
                })
              }
              const pullRequestState = opened.state === 'open' ? (opened.draft ? 'draft' : 'ready') : opened.state
              if (repositoryChange === undefined)
                yield* sql`INSERT INTO repository_changes ${sql.insert({
                  id: yield* newId(Ids.repositoryChange),
                  projectId: input.projectId,
                  changeSetId,
                  bindingId: task.bindingId,
                  workspaceId: task.workspaceId,
                  baseCommit: task.baseCommit,
                  headCommit: head,
                  branch: task.branch,
                  pullRequestUrl: opened.url,
                  pullRequestState,
                  createdAt: at,
                  updatedAt: at,
                })}`
              else
                yield* change('repository_changes', repositoryChange.id, {
                  headCommit: head,
                  pullRequestUrl: opened.url,
                  pullRequestState,
                  updatedAt: at,
                })
              const [existing] = yield* sql<{ id: string }>`
                SELECT id FROM external_links WHERE task_id = ${input.taskId} AND kind = 'change' AND product = ${host.product} AND external_id = ${opened.id}`
              const id = existing?.id ?? (yield* newId(Ids.externalLink))
              if (existing === undefined)
                yield* sql`INSERT INTO external_links ${sql.insert({
                  id,
                  projectId: input.projectId,
                  taskId: input.taskId,
                  connectionId: found.connectionId,
                  product: host.product,
                  kind: 'change',
                  externalId: opened.id,
                  ref: `${path.join('/')}${host.words.prefix}${opened.number}`,
                  key: `${host.words.prefix}${opened.number}`,
                  url: opened.url,
                  snapshot: JSON.stringify(snapshot),
                  listening: 1,
                  createdAt: at,
                  updatedAt: at,
                })}`
              else yield* change('external_links', id, { snapshot: JSON.stringify(snapshot), listening: 1, updatedAt: at })
              yield* fact({
                projectId: input.projectId,
                aggregateType: 'external_link',
                aggregateId: id,
                revision: 1,
                type: 'external_link.change_opened',
                payload: { url: opened.url, number: opened.number, draft: opened.draft },
                actorId: instance.systemId,
              })
              yield* indexTask(input.taskId)
              return id
            }),
          )
          // The issue it came from gets a link to it, where its tracker has links.
          if (issueLink !== undefined && issueLink.connectionId !== null && !sameHost)
            yield* Effect.gen(function* () {
              const adapters = yield* connections.adapters(issueLink.connectionId ?? '')
              const tracker = adapters.tracker
              if (tracker === undefined || !tracker.capabilities.links) return
              const issue = yield* tracker.issue(issueLink.ref)
              yield* outward({
                projectId: input.projectId,
                subject: { type: 'external_link', id: issueLink.id },
                target: `${tracker.product}:${issueLink.key}`,
                operation: 'link_issue',
                key: `link_issue:${issueLink.id}:${opened.url}`,
                request: { url: opened.url },
                retryable: true,
                perform: Effect.as(tracker.link(issue, { url: opened.url, title: `${nameOf(snapshot)}: ${opened.title}` }), true),
                encode: () => true,
                // Linked once, by this or its lead's link_pull_request, which shares its key: its receipt answers.
                decode: () => true,
              })
            }).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not link the pull request to its issue', cause)))
          // Its issue, moved on to review, where the person applies it.
          if (issueLink !== undefined) yield* follow(input.taskId, 'opened', snapshot)
          yield* touchCard(input.taskId)
          yield* news(input.taskId)
          wakeNow(input.taskId)
          const [row] = yield* linksOf(input.taskId)
          return {
            kind: 'opened',
            change: { ...snapshot, linkId, product: host.product, listening: row?.listening === 1 },
            left,
          } as const
        })

      /** The open pull request a repository of the task was attached to, as its record and link keep it: the one its work goes to now. */
      const attachedOf = (taskId: string, workspaceId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [latest] = yield* sql<{ id: string; head: string | null; link: string }>`
            SELECT c.id, c.head_commit AS head, l.id AS link FROM repository_changes c
            JOIN external_links l ON l.task_id = ${taskId} AND l.kind = 'change' AND l.url = c.pull_request_url
            WHERE c.workspace_id = ${workspaceId} ORDER BY c.created_at DESC, c.rowid DESC LIMIT 1`
          if (latest === undefined) return undefined
          const [link] = (yield* linksOf(taskId)).filter((one) => one.id === latest.link)
          if (link === undefined) return undefined
          const snapshot = yield* decodeSnapshot(link.snapshot)
          return snapshot.attached === true && snapshot.state === 'open'
            ? { record: latest.id, sent: latest.head, link, snapshot }
            : undefined
        })

      /**
       * Publishes a repository of the task to the open pull request it was
       * attached to (ADR-052): its branch goes onto that pull request's own
       * branch, whatever each is called, as a plain push, so only where it
       * adds to what is there; where it wouldn't, it says so, and nothing is
       * forced. That pull request is read again, and is what the task shows.
       */
      const publishAttached = (
        input: PublishInput,
        task: PublishRow,
        attached: { readonly record: string; readonly sent: string | null; readonly link: LinkRow; readonly snapshot: Snapshot },
        pushTarget: { readonly url: string; readonly header: string | null },
      ) =>
        Effect.gen(function* () {
          const { link, snapshot } = attached
          const pictures = yield* evidencePaths(input.taskId)
          const left = (yield* uncommittedFiles(task.path)).filter((file) => !pictures(task.path, file))
          const onto = sourceOf(snapshot, task.branch)
          const tip = yield* remoteTip(task.path, pushTarget, onto)
          const { head, settle } = yield* credited(task.path, task.branch, yield* commitOf(task.path, 'HEAD'), [
            task.baseCommit,
            attached.sent,
            snapshot.headSha,
            tip,
          ])
          // Already there, nothing goes up; else only as a fast-forward, in a sentence where it isn't one.
          if (tip !== head)
            yield* pushTo(task.path, pushTarget, task.branch, head, undefined, onto).pipe(
              Effect.catchTag('GitFailed', (failed) => refusal(input.taskId, nameOf(snapshot), failed)),
            )
          yield* settle
          const { host, repository } = yield* current(input.taskId, snapshot.url)
          const read = yield* host.change(repository, snapshot.number)
          const seen: Snapshot = {
            ...snapshotOf(read, snapshot.repository, snapshot.words, snapshot.checks),
            headSha: head,
            attached: true,
          }
          const sql = yield* SqlClient.SqlClient
          yield* sql`UPDATE repository_changes SET head_commit = ${head}, updated_at = ${yield* timestamp}, revision = revision + 1
            WHERE id = ${attached.record}`
          yield* saveSnapshot(link, seen, { listening: read.state === 'open' ? 1 : 0 })
          yield* news(input.taskId)
          wakeNow(input.taskId)
          const change = { ...seen, linkId: link.id, product: link.product, listening: read.state === 'open' }
          return { kind: 'opened', change, attached: true, left } as const
        })

      /**
       * Attaches one of the task's repositories to an open pull request it
       * didn't open, by its link or its number (ADR-052): one opened by hand,
       * or from a fork into the repository it came from, whose branch is on
       * the fork this clone pushes to. Its branch must be one the task pushes
       * to; another task following it keeps it. The task's branch, where it
       * isn't based on that pull request's head, starts from it only with
       * `start`, the person's word: its own commits that aren't in the head
       * go on top, one by one, and where they conflict, or the worktree has
       * what isn't committed, or its lead is at work in it, it stays as it
       * was. Then the task follows it, as one Althar opened: its reviews,
       * comments, checks and conflicts are heard, the lead's tools act on it,
       * and publishing pushes there. Any it followed before in that
       * repository isn't listened to any more.
       */
      const attach = (input: AttachInput) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const refuse = (message: string) => new AttachRefused({ taskId: input.taskId, message })
          const [task] = yield* sql<{ projectId: ProjectId; state: string; slug: string; threadId: string }>`
            SELECT k.project_id, k.state, k.slug, t.id AS thread_id FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task'
            WHERE k.id = ${input.taskId}`
          if (task === undefined) return yield* new NotFound({ kind: 'task', id: input.taskId })
          if (task.state !== 'open' && task.state !== 'draft')
            return yield* refuse(`The task is ${task.state === 'done' ? 'done' : task.state}: only an open one follows a pull request.`)
          const rows = yield* sql<{
            workspaceId: string
            path: string
            branch: string
            baseCommit: string | null
            branched: number
            bindingId: string
            name: string
            remotes: string
            changeTarget: 'upstream' | 'fork' | null
          }>`
            SELECT w.id AS workspace_id, w.path, w.branch, w.base_commit, w.branched_at IS NOT NULL AS branched, b.id AS binding_id,
              b.display_name AS name, b.remote_fingerprints AS remotes, b.change_target
            FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id
            WHERE w.task_id = ${input.taskId} AND w.device_id = ${instance.deviceId} AND w.access = 'write'
            ORDER BY b.created_at, b.rowid`
          // Each repository, where its pull requests are: its own on its host, and the one a fork came from.
          const places = (yield* Effect.forEach(rows, (row) =>
            Effect.gen(function* () {
              if (!existsSync(row.path)) return []
              const fork = yield* namedRemotes(row.path).pipe(
                Effect.map(forkOf),
                Effect.orElseSucceed(() => null),
              )
              const remotes =
                fork === null ? Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.String)))(row.remotes) : [fork.fork.url]
              const found = yield* connections.hostOf(remotes, { fromCli: true })
              return found === null ? [] : [{ row, fork, found }]
            }),
          )).flat()
          const same = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) => a.join('/').toLowerCase() === b.join('/').toLowerCase()
          const asked = input.pullRequest.trim()
          const chosen = yield* Effect.gen(function* () {
            if (/^https?:\/\//i.test(asked)) {
              const resolved = yield* connections.resolve(asked)
              if (resolved === null)
                return yield* refuse('Althar isn’t connected to where that link points. Connect its host in Settings, then attach it.')
              if (resolved.ref.kind !== 'change') return yield* refuse('That link isn’t to a pull request.')
              const ref = resolved.ref
              // On the host the repository is on, not one of the same path on another host Althar is connected to.
              const place = places.find(
                (one) =>
                  one.found.connectionId === resolved.connectionId &&
                  (same(one.found.path, ref.path) || (one.fork !== null && same(one.fork.upstream.path, ref.path))),
              )
              if (place === undefined)
                return yield* refuse(`That pull request is on ${ref.path.join('/')}, which isn’t one of the task’s repositories.`)
              return { ...place, path: ref.path, number: ref.number }
            }
            const number = /^#?(\d+)$/.exec(asked)?.[1]
            if (number === undefined) return yield* refuse('Give the pull request’s link, or its number: #123.')
            const [only] = places
            if (only === undefined)
              return yield* refuse('The task’s repository isn’t on a code host Althar is connected to. Connect it in Settings.')
            if (places.length > 1)
              return yield* refuse(
                `The task changes several repositories (${places.map((one) => one.row.name).join(', ')}): give the pull request’s link.`,
              )
            // By its number, where the repository's pull requests open: the one a fork came from, where the project sends them there.
            const path = only.fork !== null && only.row.changeTarget === 'upstream' ? only.fork.upstream.path : only.found.path
            return { ...only, path, number: Number(number) }
          })
          const { row, fork, found } = chosen
          const { host } = found
          const said = (error: ConnectorFailed) =>
            refuse(
              error.reason === 'not_found'
                ? 'That pull request isn’t there, or Althar’s sign-in can’t see it.'
                : `The host said: ${error.message}`,
            )
          const fromHost = <A>(effect: Effect.Effect<A, ConnectorFailed>) => Effect.mapError(effect, said)
          const repository = yield* fromHost(host.repository(chosen.path))
          const pull = yield* fromHost(host.change(repository, chosen.number))
          const path = repository.path
          const name = `${host.words.short} ${host.words.prefix}${pull.number}`
          if (pull.state !== 'open') return yield* refuse(`${name} is ${pull.state}: only an open one can be attached.`)
          // Its branch is on the repository this clone pushes to, or nowhere Althar can push: the fork, else the repository itself.
          // Where the host doesn't say which repository it is on, a branch of the same name here may be another's: none is pushed to.
          const own = fork?.fork.path ?? found.path
          const headOn = pull.headRepository
          if (headOn === undefined)
            return yield* refuse(`The host doesn’t say where ${name}’s branch is, so Althar can’t tell it’s one this task pushes to.`)
          if (headOn !== null && headOn.length === 0) return yield* refuse(`${name}’s branch was on a fork that is gone.`)
          const headPath = headOn ?? path
          if (!same(headPath, own))
            return yield* refuse(
              `${name}’s branch, ${pull.source}, is on ${headPath.join('/')}, which this task doesn’t push to: it pushes to ${own.join('/')}.`,
            )
          const [other] = yield* sql<{ slug: string }>`
            SELECT k.slug FROM external_links x JOIN tasks k ON k.id = x.task_id
            WHERE x.project_id = ${task.projectId} AND x.kind = 'change' AND x.url = ${pull.url} AND x.listening = 1
              AND x.task_id <> ${input.taskId} AND k.state IN ('open', 'draft') LIMIT 1`
          if (other !== undefined)
            return yield* refuse(`Task ${other.slug} follows ${name} already. Abandon it first, or leave ${name} to it.`)
          // One another open task's work still goes to, listened to or not: its pushes would land on the same branch. One it
          // was attached to goes there only while it last saw it open; closed since, it publishes elsewhere, reopened or not.
          const [sending] = yield* sql<{ slug: string }>`
            SELECT k.slug FROM repository_changes c JOIN workspaces w ON w.id = c.workspace_id JOIN tasks k ON k.id = w.task_id
            WHERE c.project_id = ${task.projectId} AND c.pull_request_url = ${pull.url} AND w.task_id <> ${input.taskId}
              AND k.state IN ('open', 'draft')
              AND c.id = (SELECT l.id FROM repository_changes l WHERE l.workspace_id = c.workspace_id ORDER BY l.created_at DESC, l.rowid DESC LIMIT 1)
              AND NOT EXISTS (SELECT 1 FROM external_links x WHERE x.task_id = w.task_id AND x.kind = 'change' AND x.url = c.pull_request_url
                AND json_extract(x.snapshot, '$.attached') = 1 AND json_extract(x.snapshot, '$.state') <> 'open')
            LIMIT 1`
          if (sending !== undefined)
            return yield* refuse(`Task ${sending.slug}’s work goes to ${name}. Abandon it first, or leave ${name} to it.`)
          const pushTarget = yield* fromHost(host.pushTarget(same(own, path) ? repository : yield* fromHost(host.repository(own))))
          // Its head as its branch has it now, fetched here: what the task's branch must be on for its pushes to add to it.
          const tip = yield* fetchInto(row.path, pushTarget, pull.source, `refs/althar/pull-request/${pull.source}`)
          if (tip === null) return yield* refuse(`Althar couldn’t fetch ${name}’s branch, ${pull.source}, from ${own.join('/')}.`)
          let base = row.baseCommit
          let started = false
          // A worktree with no branch yet gets the task's; one of that name left from before isn't taken over, nor moved.
          const leftover =
            row.branched === 0 && (yield* gitOutcome(row.path, 'rev-parse', '--verify', '--quiet', `refs/heads/${row.branch}`)).code === 0
          const refuseLeftover = () =>
            refuse(`A branch called ${row.branch} is in its repository already, from before. Delete or rename it, then attach ${name}.`)
          if (!(yield* onHead(row.path, tip))) {
            // The task's own commits, not in the head: after where it started, merges left out.
            const mine = (yield* git(
              row.path,
              'rev-list',
              '--reverse',
              '--no-merges',
              'HEAD',
              `^${tip}`,
              ...(base === null ? [] : [`^${base}`]),
            ))
              .split('\n')
              .filter((line) => line !== '')
            if (input.start !== true) return { kind: 'start', name, source: pull.source, head: tip, own: mine.length } satisfies Attached
            if (leftover) return yield* refuseLeftover()
            if (Option.isSome(yield* sessions.running(task.threadId)))
              return yield* refuse(`Its lead is at work in its worktree. Stop it, or wait for its turn to end, then attach ${name}.`)
            const left = yield* uncommittedFiles(row.path)
            if (left.length > 0)
              return yield* refuse(
                `What isn’t committed in its worktree would be lost: ${filesWord(left)}. Commit it or drop it, then attach ${name}.`,
              )
            const before = yield* commitOf(row.path, 'HEAD')
            // Kept, so what it was on is never lost.
            yield* git(row.path, 'update-ref', `refs/althar/before-attach/${row.branch}`, before)
            yield* git(row.path, 'checkout', '-q', '-B', row.branch, tip)
            const conflicted = yield* pickOnto(row.path, mine)
            if (conflicted !== null) {
              yield* git(row.path, 'reset', '-q', '--hard', before)
              if (row.branched === 0) {
                yield* git(row.path, 'checkout', '-q', '--detach', before)
                yield* git(row.path, 'branch', '-q', '-D', row.branch)
              }
              return yield* refuse(
                `The task’s own commits conflict with ${name}’s head in ${filesWord(conflicted)}, so its branch stays as it was.`,
              )
            }
            // Where its change starts: where what it started from meets the head.
            const met = yield* gitOutcome(row.path, 'merge-base', base ?? tip, tip)
            base = met.code === 0 ? met.stdout : tip
            started = true
          } else if (row.branched === 0) {
            if (leftover) return yield* refuseLeftover()
            yield* git(row.path, 'checkout', '-q', '-b', row.branch)
          }
          const kept = yield* commitsAhead(row.path, tip, 'HEAD').pipe(Effect.orElseSucceed(() => 0))
          const snapshot: Snapshot = { ...snapshotOf(pull, path, host.words, null), headSha: tip, attached: true }
          const followed = yield* sql<{ id: string; projectId: ProjectId; taskId: string }>`
            SELECT DISTINCT l.id, l.project_id, l.task_id FROM external_links l JOIN repository_changes c ON c.pull_request_url = l.url
            WHERE l.task_id = ${input.taskId} AND l.kind = 'change' AND l.listening = 1 AND l.url <> ${pull.url}
              AND c.workspace_id = ${row.workspaceId}`
          const linkId = yield* sql.withTransaction(
            Effect.gen(function* () {
              const at = yield* timestamp
              const changeSetId = yield* newId(Ids.changeSet)
              // From no run: the person, or the coordinator, attached it.
              yield* sql`INSERT INTO change_sets ${sql.insert({ id: changeSetId, projectId: task.projectId, taskId: input.taskId, runId: null, state: 'published', createdAt: at })}`
              yield* fact({
                projectId: task.projectId,
                aggregateType: 'change_set',
                aggregateId: changeSetId,
                revision: 1,
                type: 'change_set.attached',
                payload: { url: pull.url },
                actorId: input.actorId,
              })
              yield* sql`INSERT INTO repository_changes ${sql.insert({
                id: yield* newId(Ids.repositoryChange),
                projectId: task.projectId,
                changeSetId,
                bindingId: row.bindingId,
                workspaceId: row.workspaceId,
                baseCommit: base,
                headCommit: tip,
                branch: row.branch,
                pullRequestUrl: pull.url,
                pullRequestState: pull.draft ? 'draft' : 'ready',
                createdAt: at,
                updatedAt: at,
              })}`
              const [existing] = yield* sql<{ id: string }>`
                SELECT id FROM external_links WHERE task_id = ${input.taskId} AND kind = 'change' AND product = ${host.product} AND external_id = ${pull.id}`
              const id = existing?.id ?? (yield* newId(Ids.externalLink))
              const revision =
                existing === undefined
                  ? 1
                  : yield* change('external_links', id, {
                      connectionId: found.connectionId,
                      snapshot: JSON.stringify(snapshot),
                      listening: 1,
                      cursor: null,
                      updatedAt: at,
                    })
              if (existing === undefined)
                yield* sql`INSERT INTO external_links ${sql.insert({
                  id,
                  projectId: task.projectId,
                  taskId: input.taskId,
                  connectionId: found.connectionId,
                  product: host.product,
                  kind: 'change',
                  externalId: pull.id,
                  ref: `${path.join('/')}${host.words.prefix}${pull.number}`,
                  key: `${host.words.prefix}${pull.number}`,
                  url: pull.url,
                  snapshot: JSON.stringify(snapshot),
                  listening: 1,
                  createdAt: at,
                  updatedAt: at,
                })}`
              yield* fact({
                projectId: task.projectId,
                aggregateType: 'external_link',
                aggregateId: id,
                revision,
                type: 'external_link.change_attached',
                payload: { url: pull.url, number: pull.number, source: pull.source, branch: row.branch, started },
                actorId: input.actorId,
              })
              // It follows this one in that repository now: what it followed before there isn't listened to.
              for (const one of followed) {
                const stopped = yield* change('external_links', one.id, { listening: 0, updatedAt: at })
                yield* fact({
                  projectId: one.projectId,
                  aggregateType: 'external_link',
                  aggregateId: one.id,
                  revision: stopped,
                  type: 'external_link.stopped_listening',
                  payload: { attached: pull.url },
                  actorId: input.actorId,
                })
              }
              if (started || row.branched === 0) {
                const branched = yield* change('workspaces', row.workspaceId, {
                  baseCommit: base,
                  ...(row.branched === 0 ? { branchedAt: at } : {}),
                })
                yield* fact({
                  projectId: task.projectId,
                  aggregateType: 'workspace',
                  aggregateId: row.workspaceId,
                  revision: branched,
                  type: 'workspace.branched',
                  payload: { from: row.branch, to: row.branch, base, onto: tip, attached: pull.url },
                  actorId: input.actorId,
                })
              }
              yield* indexTask(input.taskId)
              return id
            }),
          )
          const where = places.length > 1 ? ` in ${row.name}` : ''
          yield* addItem({ projectId: task.projectId, threadId: task.threadId }, 'notice', {
            source: 'runtime',
            severity: 'info',
            title: `The task follows ${name}${where} now: ${pull.title}`,
            description: `${
              started
                ? `Its branch ${row.branch} starts from ${name}’s head now${kept > 0 ? `, with its ${commitsWord(kept)} on top` : ''}. `
                : ''
            }Its work goes to ${name}’s branch, ${pull.source}, on ${own.join('/')}, as a plain push: nothing opens another.`,
          })
          const [link] = (yield* linksOf(input.taskId)).filter((one) => one.id === linkId)
          if (link !== undefined)
            yield* tellLead(link, [
              `This task follows ${name} on ${path.join('/')} now, "${pull.title}": ${pull.url}. ${started ? `Your branch ${row.branch} starts from its head now, with your own commits on top. ` : ''}read_pull_request reads it, reply_on_pull_request answers on it, and push_to_pull_request asks the person to push your commits to its branch, ${pull.source}.`,
            ])
          yield* touchCard(input.taskId)
          yield* news(input.taskId)
          wakeNow(input.taskId)
          return {
            kind: 'attached',
            change: { ...snapshot, linkId, product: host.product, listening: true },
            started,
            kept,
          } satisfies Attached
        })

      const stopListening = (taskId: string, url: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          for (const link of yield* linksOf(taskId)) {
            if (link.listening !== 1 || (yield* decodeSnapshot(link.snapshot)).url !== url) continue
            yield* sql.withTransaction(
              Effect.gen(function* () {
                const revision = yield* change('external_links', link.id, { listening: 0, updatedAt: yield* timestamp })
                yield* fact({
                  projectId: link.projectId,
                  aggregateType: 'external_link',
                  aggregateId: link.id,
                  revision,
                  type: 'external_link.stopped_listening',
                  actorId: instance.personId,
                })
              }),
            )
            yield* touchCard(taskId)
          }
          const under = yield* sql<{ id: string }>`
            SELECT id FROM conflict_resolutions WHERE task_id = ${taskId} AND pull_request_url = ${url} AND state IN ('resolving', 'checking')`
          for (const one of under) yield* unfollowed(one.id)
        })

      /** Saves what was seen of a change, and tells the card. */
      const saveSnapshot = (link: LinkRow, snapshot: Snapshot, set: Readonly<Record<string, unknown>> = {}) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          yield* sql.withTransaction(
            Effect.gen(function* () {
              const at = yield* timestamp
              const revision = yield* change('external_links', link.id, { snapshot: JSON.stringify(snapshot), updatedAt: at, ...set })
              yield* fact({
                projectId: link.projectId,
                aggregateType: 'external_link',
                aggregateId: link.id,
                revision,
                type: 'external_link.seen',
                payload: { state: snapshot.state, draft: snapshot.draft, checks: snapshot.checks?.outcome ?? null },
                actorId: instance.systemId,
              })
              const pullRequestState = snapshot.state === 'open' ? (snapshot.draft ? 'draft' : 'ready') : snapshot.state
              yield* sql`UPDATE repository_changes SET pull_request_state = ${pullRequestState}, updated_at = ${at}, revision = revision + 1
                WHERE pull_request_url = ${snapshot.url} AND project_id = ${link.projectId}`
            }),
          )
          yield* touchCard(link.taskId)
        })

      /** The worktree of the repository a pull request is from, with its default branch and the task's thread; the task's first, where the record doesn't say. */
      const worktreeOf = (taskId: string, url: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [workspace] = yield* sql<{ path: string; branch: string; base: string; threadId: string }>`
            SELECT w.path, w.branch, coalesce(b.default_base_ref, w.base_ref) AS base,
              (SELECT t.id FROM threads t WHERE t.task_id = w.task_id AND t.kind = 'task') AS thread_id
            FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id
            WHERE w.task_id = ${taskId} AND w.device_id = ${instance.deviceId} AND w.access = 'write'
            ORDER BY w.id = (SELECT c.workspace_id FROM repository_changes c WHERE c.pull_request_url = ${url} LIMIT 1) DESC,
              b.created_at, b.rowid
            LIMIT 1`
          return workspace
        })

      /** The commit Althar last pushed to a pull request, as the record of its push keeps it. */
      const sentTo = (projectId: string, url: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [sent] = yield* sql<{ head: string | null }>`
            SELECT head_commit AS head FROM repository_changes WHERE pull_request_url = ${url} AND project_id = ${projectId} LIMIT 1`
          return sent?.head ?? null
        })

      /* ---- Pushes the lead asks the person for, as items in the task's thread ---- */

      /**
       * Where a pull request's commits are pushed: its own repository, or, for
       * one from a fork into the repository it was forked from, the fork.
       */
      const pushTargetOf = (host: CodeHost, repository: Repository, path: string) =>
        Effect.gen(function* () {
          const fork = yield* namedRemotes(path).pipe(
            Effect.map(forkOf),
            Effect.orElseSucceed(() => null),
          )
          const into = fork !== null && repository.path.join('/').toLowerCase() === fork.upstream.path.join('/').toLowerCase()
          return yield* host.pushTarget(into ? yield* host.repository(fork.fork.path) : repository)
        })

      /** A commit, and what crediting made it from (credit.ts): the branch stays on that until it moves onto what was sent. */
      const madeFrom = (commit: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const rows = yield* sql<{ original: string }>`SELECT original FROM credited_commits WHERE credited = ${commit}`
          return [commit, ...rows.map((row) => row.original).filter((original) => original !== commit)]
        }).pipe(Effect.orElseSucceed(() => [commit]))

      /** The first of `commits` the branch has. */
      const firstOnHead = (path: string, commits: ReadonlyArray<string>) =>
        Effect.gen(function* () {
          for (const commit of commits) if (yield* onHead(path, commit)) return commit
          return undefined
        })

      /**
       * What a task's branch has that its pull request doesn't, as a push the
       * lead asks for shows it: from what the pull request has to the branch's
       * head, the first few oldest first. What it has is the latest of what
       * is known of it that the worktree knows, never an older commit behind
       * it: the remote's branch as the remote says now (`tip`), else, in
       * `known`, the pull request's head as its host says, the commit Althar
       * last pushed, and its head as last seen, in that order. `behind` where
       * the remote's branch is on a commit the worktree doesn't know, pushed
       * from elsewhere; `rewritten` where the branch no longer has what the
       * pull request has, so a push would need forcing; `unknown` where the
       * worktree knows none of them.
       */
      const aheadOf = (path: string, tip: string | null, known: ReadonlyArray<string | null>) =>
        Effect.gen(function* () {
          const head = yield* commitOf(path, 'HEAD')
          const [latest] = (yield* commitsOf(
            path,
            [tip, ...known].filter((commit) => commit !== null),
          )).filter((commit) => commit !== null)
          if (tip !== null && latest !== tip) return { kind: 'behind', head } as const
          if (latest === undefined) return { kind: 'unknown', head } as const
          const from = yield* firstOnHead(path, yield* madeFrom(latest))
          if (from === undefined) return { kind: 'rewritten', from: latest, head } as const
          const count = yield* commitsAhead(path, from, head)
          const listed = count === 0 ? '' : yield* git(path, 'log', '--reverse', '--format=%h%x1f%s', `${from}..${head}`)
          const commits = listed
            .split('\n')
            .filter((line) => line !== '')
            .slice(0, COMMITS_SHOWN)
            .map((line) => ({ sha: line.slice(0, line.indexOf('\x1f')), subject: line.slice(line.indexOf('\x1f') + 1) }))
          return { kind: 'ahead', from, head, count, commits } as const
        })

      /** The pushes the lead asked for on a pull request that still wait for the person, oldest first. */
      const askedOf = (taskId: string, url: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const rows = yield* sql<{ id: string; projectId: ProjectId; content: string }>`
            SELECT i.id, i.project_id, i.content FROM thread_items i JOIN threads t ON t.id = i.thread_id
            WHERE t.task_id = ${taskId} AND t.kind = 'task' AND i.kind = 'push_request'
              AND json_extract(i.content, '$.url') = ${url} AND json_extract(i.content, '$.state') = 'open'
            ORDER BY i.sequence`
          return rows.flatMap((row) => {
            const content = decodeAsked(row.content)
            return Option.isSome(content) ? [{ id: row.id, projectId: row.projectId, content: content.value }] : []
          })
        })

      /** A push the lead asked for, settled: pushed, asked for again, or its pull request closed. */
      const settleAsked = (
        asked: { readonly id: string; readonly projectId: ProjectId; readonly content: Asked },
        state: 'pushed' | 'replaced' | 'closed',
      ) =>
        Effect.flatMap(timestamp, (at) => updateItem(asked.projectId, asked.id, { ...asked.content, state, settledAt: at } satisfies Asked))

      /** A commit, and what crediting made of it where it made it again (credit.ts): either may be what the branch has now. */
      const asCredited = (commit: string) =>
        Effect.map(memory.recall([commit]), (made) => {
          const credited = made.get(commit)
          return credited === undefined || credited === commit ? [commit] : [commit, credited]
        })

      /** Whether any of `commits` is one of `tips`, or behind one. */
      const behindAny = (path: string, commits: ReadonlyArray<string>, tips: ReadonlyArray<string>) =>
        Effect.gen(function* () {
          for (const commit of commits)
            for (const tip of tips)
              if (commit === tip || (yield* gitOutcome(path, 'merge-base', '--is-ancestor', commit, tip)).code === 0) return true
          return false
        })

      /**
       * The branch moved since the person saw a push the lead asked for, so
       * what it showed isn't on it any more: it shows what is on it now, for
       * the person to look at again, and pushes that; or why that can't go up.
       */
      const movedAsked = (taskId: string, url: string, path: string, tip: string | null, known: ReadonlyArray<string | null>) =>
        Effect.gen(function* () {
          for (const asked of yield* askedOf(taskId, url)) {
            if (yield* behindAny(path, yield* asCredited(asked.content.head), ['HEAD'])) continue
            const ahead = yield* aheadOf(path, tip, known)
            yield* updateItem(asked.projectId, asked.id, {
              ...asked.content,
              moved: true,
              head: ahead.head,
              commits: ahead.kind === 'ahead' ? ahead.commits : [],
              count: ahead.kind === 'ahead' ? ahead.count : 0,
              blocked: ahead.kind === 'ahead' ? null : ahead.kind,
            } satisfies Asked)
          }
        })

      /**
       * Once the person pushed a pull request up to `pushed` (the commit they
       * saw, and what crediting made of it), each push the lead asked for
       * that is on it now says so, and the lead hears it.
       */
      const pushedAsked = (link: LinkRow, url: string, path: string, pushed: ReadonlyArray<string>) =>
        Effect.gen(function* () {
          const told: Array<string> = []
          for (const asked of yield* askedOf(link.taskId, url)) {
            if (!(yield* behindAny(path, yield* asCredited(asked.content.head), pushed))) continue
            yield* settleAsked(asked, 'pushed')
            told.push(
              asked.content.count === 1
                ? `The person pushed your commit to ${asked.content.where}, as you asked: the pull request has it now.`
                : `The person pushed your ${asked.content.count} commits to ${asked.content.where}, as you asked: the pull request has them now.`,
            )
          }
          yield* tellLead(link, told)
        })

      /**
       * Where the task's pull request takes its commits from and goes to: its
       * repository's worktree here, where a push of it goes on the host, and
       * the commit Althar last pushed there.
       */
      const pushingTo = (taskId: string, url?: string) =>
        Effect.gen(function* () {
          const { link, snapshot, host, repository } = yield* current(taskId, url)
          const workspace = yield* worktreeOf(taskId, snapshot.url)
          if (workspace === undefined) return yield* new NotFound({ kind: 'task’s worktree', id: taskId })
          // A pull request from a fork into the repository it was forked from takes its commits on the fork.
          const pushTarget = yield* pushTargetOf(host, repository, workspace.path)
          return { link, snapshot, workspace, pushTarget, sent: yield* sentTo(link.projectId, snapshot.url) }
        })

      /**
       * What the person saw, or what crediting made of it, still on the branch:
       * one rewritten away since isn't pushed. A push the lead asked for that
       * showed it shows what is on it now.
       */
      const stillOnHead = (
        taskId: string,
        url: string,
        path: string,
        seen: string,
        head: string,
        tip: string | null,
        known: ReadonlyArray<string | null>,
      ) =>
        Effect.gen(function* () {
          if ((yield* onHead(path, seen)) || (yield* onHead(path, head))) return
          yield* movedAsked(taskId, url, path, tip, known).pipe(
            Effect.catchCause((cause) => Effect.logWarning('Could not show the branch as it is now', cause)),
          )
          return yield* new ChangedSinceSeen({ taskId, what: 'branch' })
        })

      /** Pushed: the record and the pull request's head say so, for the card to count from; the host's next look has the last word. */
      const pushedTo = (taskId: string, link: LinkRow, snapshot: Snapshot, path: string, seen: string, head: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          yield* sql`UPDATE repository_changes SET head_commit = ${head}, updated_at = ${yield* timestamp}, revision = revision + 1
            WHERE pull_request_url = ${snapshot.url} AND project_id = ${link.projectId}`
          // When it went up, for its checks to show within `checksAppear` of: the record's own time moves with every look.
          yield* heard(link, 'pushed', `pushed:${head}`, { sha: head })
          yield* saveSnapshot(link, { ...snapshot, headSha: head })
          // What the lead asked the person to push that went up: its request says so, and the lead hears it.
          yield* pushedAsked(link, snapshot.url, path, [seen, head]).pipe(
            Effect.catchCause((cause) => Effect.logWarning('Could not tell the lead what was pushed', cause)),
          )
          yield* news(taskId)
          wakeNow(taskId)
          return { change: yield* summaryOf({ ...link, snapshot: JSON.stringify({ ...snapshot, headSha: head }) }) }
        })

      const push = (taskId: string, seen: string, url?: string) =>
        Effect.gen(function* () {
          const { link, snapshot, workspace, pushTarget, sent } = yield* pushingTo(taskId, url)
          // Onto the pull request's own branch, which for one attached to the task may be called otherwise (ADR-052).
          const onto = sourceOf(snapshot, workspace.branch)
          const tip = yield* remoteTip(workspace.path, pushTarget, onto)
          const { head, settle } = yield* credited(workspace.path, workspace.branch, seen, [snapshot.headSha, sent, tip])
          // What Althar last pushed before what it last saw: a pull request read before that push is behind it.
          yield* stillOnHead(taskId, snapshot.url, workspace.path, seen, head, tip, [sent, snapshot.headSha])
          // Refused, it says why in a sentence, not git's hint: the pull request has commits the branch doesn't.
          yield* pushTo(workspace.path, pushTarget, workspace.branch, head, undefined, onto).pipe(
            Effect.catchTag('GitFailed', (failed) => refusal(taskId, nameOf(snapshot), failed)),
          )
          yield* settle
          return yield* pushedTo(taskId, link, snapshot, workspace.path, seen, head)
        })

      /**
       * Replaces the commits on the task's pull request with its branch here,
       * up to the commit the person saw, once its published commits were
       * rewritten. A force push, which the project's rules keep for the
       * person: their press, confirmed on the card, is their answer, and the
       * record says so. Only while the pull request is still at `replaces`,
       * the head they saw it at (`--force-with-lease`), so what anyone else
       * pushed meanwhile is never lost. Where the rules never allow a force
       * push, nothing is pushed.
       */
      const replace = (taskId: string, seen: string, replaces: string, url?: string) =>
        Effect.gen(function* () {
          if (!/^[0-9a-f]{40,64}$/.test(replaces)) return yield* new ChangedSinceSeen({ taskId })
          const sql = yield* SqlClient.SqlClient
          const { link, snapshot, workspace, pushTarget, sent } = yield* pushingTo(taskId, url)
          const where = nameOf(snapshot)
          const { rules } = yield* (yield* Policies).current(link.projectId)
          if (ruleSetOf(rules).never.includes('force-push')) return yield* new PushRefused({ taskId, why: 'never', remote: where })
          const { head, settle } = yield* credited(workspace.path, workspace.branch, seen, [replaces, sent])
          yield* stillOnHead(taskId, snapshot.url, workspace.path, seen, head, null, [replaces, sent])
          yield* pushTo(workspace.path, pushTarget, workspace.branch, head, replaces, sourceOf(snapshot, workspace.branch)).pipe(
            Effect.catchTag('GitFailed', (failed) =>
              /\(stale info\)/i.test(failed.stderr)
                ? Effect.fail(new PushRefused({ taskId, why: 'moved', remote: where }))
                : refusal(taskId, where, failed),
            ),
          )
          yield* settle
          yield* sql.withTransaction(
            Effect.gen(function* () {
              const revision = yield* change('external_links', link.id, { updatedAt: yield* timestamp })
              yield* fact({
                projectId: link.projectId,
                aggregateType: 'external_link',
                aggregateId: link.id,
                revision,
                type: 'external_link.force_pushed',
                // The person's own press answers the force push the rules keep for them.
                payload: { url: snapshot.url, replaced: replaces, head, rule: 'force-push', answeredBy: 'person' },
                actorId: instance.personId,
              })
            }),
          )
          yield* addItem({ projectId: link.projectId, threadId: workspace.threadId }, 'notice', {
            source: 'runtime',
            severity: 'info',
            title: `Replaced the commits on ${where} with the branch here.`,
            description: `As you confirmed: a force push, only from ${replaces.slice(0, 12)}, where you saw it.`,
          })
          return yield* pushedTo(taskId, link, snapshot, workspace.path, seen, head)
        })

      /**
       * What the lead is told so its branch takes the pull request's commits
       * in by merging, and a plain push works again. The pull request's head
       * is fetched here first, since the lead can't reach the host. Where the
       * lead rewrote what Althar pushed, it starts again from that and keeps
       * its fixes; where someone else pushed, it merges what they pushed.
       */
      const mergeNote = (taskId: string, url?: string) =>
        Effect.gen(function* () {
          const { snapshot, workspace, pushTarget, sent } = yield* pushingTo(taskId, url)
          const onto = sourceOf(snapshot, workspace.branch)
          const ref = `refs/althar/pull-request/${onto}`
          const head = yield* fetchInto(workspace.path, pushTarget, onto, ref)
          if (head === null)
            return yield* new GitFailed({
              args: ['fetch', onto],
              cwd: workspace.path,
              stderr: `Couldn't fetch ${onto} from the host.`,
            })
          const where = nameOf(snapshot)
          const short = head.slice(0, 12)
          const rewritten = head === sent && !(yield* onHead(workspace.path, head))
          // A hard reset loses what isn't committed: the note has it committed, and the backup checked, before any reset.
          const left = rewritten ? yield* uncommittedFiles(workspace.path).pipe(Effect.orElseSucceed(() => [])) : []
          const saved = `${workspace.branch}-rewritten`
          const note = rewritten
            ? [
                `Your branch ${workspace.branch} was rewritten after it was pushed, so ${where} won't take a plain push of it: its commits are no longer under yours. ${where} is at ${short}. Put your work back on top of it, keeping your fixes, in this order:`,
                `1. Commit everything not committed yet, so the reset below can't lose it${left.length === 0 ? '' : ` (not committed now: ${left.join(', ')})`}. \`git status --short\` must then print nothing.`,
                `2. Save where you are with \`git branch ${saved}\` (another name, if that one is taken, used below in its place), and check \`git rev-parse ${saved} HEAD\` prints the same commit twice.`,
                `3. Only once both hold: reset to the pull request's head with \`git reset --hard ${head}\`, and merge ${workspace.base} into it with \`git merge ${workspace.base}\`.`,
                `4. Bring in each change of ${saved} that isn't there yet as new commits: \`git diff HEAD ${saved}\` shows what differs.`,
                `Merge, never rebase, amend or squash commits that are pushed. Run the checks, commit, and say so: Althar pushes it as a plain push. Keep ${saved} until it has.`,
              ].join('\n')
            : `${where} has commits your branch ${workspace.branch} doesn't: someone pushed to it, such as with the host's "Update branch". Althar fetched them here as ${ref}, at ${short}. Merge them into your branch with \`git merge ${head}\`, settle any conflict so both sides' changes hold, run the checks, and commit the merge. Merge, never rebase. Then say so: Althar pushes it as a plain push.`
          return { note, head }
        })

      const markReady = (taskId: string, url?: string) =>
        Effect.gen(function* () {
          const { link, snapshot, host, repository } = yield* current(taskId, url)
          if (!snapshot.draft || snapshot.state !== 'open') return
          const read = yield* host.change(repository, snapshot.number)
          const ready = yield* outward({
            projectId: link.projectId,
            subject: { type: 'external_link', id: link.id },
            target: `${host.product}:${snapshot.repository.join('/')}`,
            operation: 'mark_ready',
            key: `mark_ready:${link.id}`,
            request: { number: snapshot.number },
            retryable: true,
            perform: host.markReady(repository, read),
            encode: (answer) => answer,
            decode: (kept) => Option.getOrUndefined(Schema.decodeUnknownOption(ChangeRequest)(kept)),
          })
          yield* saveSnapshot(link, { ...snapshot, draft: ready.draft, state: ready.state })
        })

      /**
       * Merges the task's pull request at the head the person saw, as they
       * asked: a draft is marked ready first. If it has moved on since, by a
       * push now or while the host merges, it isn't merged, and the person
       * looks again. Merged, as the host's answer to the merge says, its task
       * settles then: reading it back can still say open for a moment, and
       * what was said on it last is listened to after, not before.
       */
      const merge = (taskId: string, head: string, url?: string) =>
        Effect.gen(function* () {
          const { link, snapshot, host, repository } = yield* current(taskId, url)
          if (snapshot.state !== 'open') return
          const read = yield* host.change(repository, snapshot.number)
          if (read.state === 'open') {
            if (read.headSha !== head) return yield* new ChangedSinceSeen({ taskId })
            if (read.draft) yield* markReady(taskId)
            const merged = yield* outward({
              projectId: link.projectId,
              subject: { type: 'external_link', id: link.id },
              target: `${host.product}:${snapshot.repository.join('/')}`,
              operation: 'merge',
              // A merge at another head is another merge.
              key: `merge:${link.id}:${head}`,
              request: { number: snapshot.number, head },
              retryable: false,
              perform: host.merge(repository, { ...read, headSha: head }).pipe(
                // GitHub says 409 when the head moved while it merged.
                Effect.catchIf(
                  (error) => error instanceof ConnectorFailed && error.status === 409,
                  () => Effect.fail(new ChangedSinceSeen({ taskId })),
                ),
              ),
              encode: (answer) => answer,
              decode: (kept) => Option.getOrUndefined(Schema.decodeUnknownOption(ChangeRequest)(kept)),
            })
            if (merged.state === 'merged') {
              yield* seenNow(link, snapshot, merged)
              const [now] = (yield* linksOf(taskId)).filter((candidate) => candidate.id === link.id)
              if (now !== undefined)
                yield* Effect.forkIn(
                  locked(taskId)(poll(now)).pipe(
                    Effect.catchCause((cause) => Effect.logWarning('Could not listen to a merged pull request', cause)),
                  ),
                  scope,
                )
              return
            }
            // Taken but not landed yet (Bitbucket answers 202 to one that takes long): asked about again soon, until it has.
            if (merged.state === 'open') yield* Effect.forkIn(landing(taskId, link.id), scope)
          }
          const [now] = (yield* linksOf(taskId)).filter((candidate) => candidate.id === link.id)
          if (now !== undefined) yield* poll(now)
        })

      /**
       * A merge its host took but hasn't landed yet, asked about every few
       * seconds for a while, so its task settles once it has. A read that
       * fails is asked again next turn; past the minute, listening as ever
       * hears it land.
       */
      const landing = (taskId: string, linkId: string) =>
        Effect.gen(function* () {
          for (let turn = 0; turn < LANDING_TURNS; turn++) {
            yield* Effect.sleep(LANDING_EVERY)
            const [now] = (yield* linksOf(taskId)).filter((candidate) => candidate.id === linkId)
            if (now === undefined || (yield* decodeSnapshot(now.snapshot)).state !== 'open') return
            yield* locked(taskId)(poll(now)).pipe(
              Effect.catchCause((cause) => Effect.logWarning('Could not hear whether a merge landed', cause)),
            )
          }
        }).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not hear whether a merge landed', cause)))

      /**
       * A change as its host has it now, kept: said in the task's thread where
       * it merged or closed since it was seen, and listened to no more; what
       * the lead asked to push to it is closed, and a merge may settle its task.
       */
      const seenNow = (link: LinkRow, before: Snapshot, read: ChangeRequest) =>
        Effect.gen(function* () {
          const after: Snapshot = {
            ...before,
            state: read.state,
            draft: read.draft,
            title: read.title,
            headSha: read.headSha ?? before.headSha,
          }
          const settled = after.state !== 'open'
          yield* saveSnapshot(link, after, settled ? { listening: 0 } : {})
          if (after.state !== before.state && settled)
            yield* arrive(link, { kind: after.state, from: null, where: nameOf(before), url: before.url })
          if (settled) for (const asked of yield* askedOf(link.taskId, before.url)) yield* settleAsked(asked, 'closed')
          if (after.state === 'merged' && before.state !== 'merged') yield* Effect.andThen(follow(link.taskId, 'merged', before), baseMoved)
          if (after.state === 'merged') yield* settleIfDone(link.taskId)
          if (settled) yield* forgetUnsent(link.taskId)
          return after
        })

      /**
       * Closes the task's pull request at `url` unmerged, as the person asked,
       * through its host, and keeps what the host says after: one merged
       * meanwhile stays merged. Its branch on the host goes too where they
       * asked, once it is closed; what the host said to that is returned.
       */
      const close = (taskId: string, url: string, deleteBranch: boolean) =>
        Effect.gen(function* () {
          const { link, snapshot, host, repository } = yield* current(taskId, url)
          const read = yield* host.change(repository, snapshot.number)
          const closed =
            read.state !== 'open'
              ? read
              : yield* outward({
                  projectId: link.projectId,
                  subject: { type: 'external_link', id: link.id },
                  target: `${host.product}:${snapshot.repository.join('/')}`,
                  operation: 'close',
                  // Reopened on the host since, closing it again is another close.
                  key: `close:${link.id}:${read.updatedAt}`,
                  request: { number: snapshot.number },
                  // Closing reads it first, so asking again closes it once.
                  retryable: true,
                  perform: host.closeChange(repository, read),
                  encode: (answer) => answer,
                  decode: (kept) => Option.getOrUndefined(Schema.decodeUnknownOption(ChangeRequest)(kept)),
                })
          const after = yield* seenNow(link, snapshot, closed)
          const summary: ChangeSummary = { ...after, linkId: link.id, product: link.product, listening: after.state === 'open' }
          if (!deleteBranch || after.state !== 'closed') return { change: summary, branch: null }
          const branch = yield* outward({
            projectId: link.projectId,
            subject: { type: 'external_link', id: link.id },
            target: `${host.product}:${snapshot.repository.join('/')}`,
            operation: 'delete_branch',
            key: `delete_branch:${link.id}:${closed.updatedAt}`,
            request: { number: snapshot.number, branch: closed.source },
            retryable: true,
            perform: Effect.as(host.deleteBranch(repository, closed), true),
            encode: (answer) => answer,
            decode: (kept) => (kept === true ? true : undefined),
          }).pipe(
            Effect.as(null),
            Effect.catch((error) => Effect.succeed(error instanceof ConnectorFailed ? error.message : String(error))),
          )
          return { change: summary, branch }
        })

      /**
       * The task's repositories here, each with its worktree and the default branch it merges into, in the order the project has them:
       * those on a branch, as a plain task's with none yet has nothing to merge or conflict (DEV-96).
       */
      const repositoriesHere = (taskId: string) =>
        Effect.flatMap(
          SqlClient.SqlClient,
          (sql) => sql<HereRow>`
            SELECT b.slug, b.display_name AS name, coalesce(b.default_base_ref, w.base_ref) AS base, l.path AS root, w.path AS worktree, w.branch,
              EXISTS (SELECT 1 FROM repository_changes c WHERE c.workspace_id = w.id AND c.pull_request_url IS NOT NULL) AS opened
            FROM workspaces w
            JOIN repository_bindings b ON b.id = w.binding_id
            JOIN repository_locations l ON l.binding_id = b.id AND l.device_id = ${instance.deviceId}
            WHERE w.task_id = ${taskId} AND w.device_id = ${instance.deviceId} AND w.access = 'write' AND w.branched_at IS NOT NULL
            ORDER BY b.created_at, b.rowid`,
        )

      /** A conflict merging a repository's branch here, for the lead to resolve: its default branch into its branch, each where it is now. */
      const conflictHere = (repository: HereRow, files: ReadonlyArray<string>) =>
        Effect.gen(function* () {
          const target = yield* commitOf(repository.root, `refs/heads/${repository.base}`)
          const from = yield* commitOf(repository.worktree, 'HEAD')
          return {
            repository: repository.slug,
            name: repository.name,
            branch: repository.base,
            ref: repository.base,
            target,
            from,
            files,
          } satisfies Conflict
        })

      /**
       * Merges here the task's repositories that have no pull request, into
       * each one's default branch: all of them or none. Those with one merge
       * through it; the task is done once every one is merged, either way.
       */
      const mergeHere = (taskId: string, heads: ReadonlyArray<{ readonly repository: string; readonly head: string }>) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [task] = yield* sql<{ state: string; title: string; projectId: ProjectId; threadId: string }>`
            SELECT k.state, k.title, k.project_id, t.id AS thread_id FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task'
            WHERE k.id = ${taskId}`
          if (task === undefined) return yield* new NotFound({ kind: 'task', id: taskId })
          const cant = (why: CantMerge['why'], detail = '') => new CantMerge({ taskId, why, detail })
          if (task.state !== 'open') return yield* cant('settled')
          const all = yield* repositoriesHere(taskId)
          // A plain task with no branch yet has nothing the person could have seen to merge.
          if (all.length === 0) return yield* cant('changed')
          const repositories = all.filter((repository) => repository.opened === 0)
          if (repositories.length === 0) return yield* cant('pull_request')
          const several = all.length > 1
          const named = (repository: (typeof repositories)[number], what: string) => (several ? `${repository.name}: ${what}` : what)
          // Worked out for every repository first: one that can't be merged stops them all.
          const plans = yield* Effect.forEach(repositories, (repository) =>
            Effect.gen(function* () {
              const seen = heads.find((one) => one.repository === repository.slug)?.head
              if (seen === undefined) return yield* cant('changed')
              // What lands on the person's own branch is credited as what is pushed is.
              const { head, settle } = yield* credited(repository.worktree, repository.branch, seen, [])
              if (!(yield* onHead(repository.worktree, seen)) && !(yield* onHead(repository.worktree, head))) return yield* cant('changed')
              const plan = yield* planMerge(repository.root, repository.base, head, `Merge ${repository.branch}\n\n${task.title}`)
              return { repository, plan, settle }
            }),
          )
          // A checkout, or a submodule the merge moves, that can't be read stops the merge, with its path and git's own words, before anything else.
          for (const { repository, plan } of plans)
            if (plan.kind === 'unreadable') return yield* cant('unreadable', named(repository, `${plan.checkout}\n${plan.detail}`))
          const conflicting = plans.flatMap(({ repository, plan }) =>
            plan.kind === 'conflicts' ? [{ repository, files: plan.files }] : [],
          )
          const conflicts = conflicting.map(({ repository, files }) => named(repository, files.join(', ')))
          if (conflicts.length > 0) {
            // Where the project says so, the lead resolves it unasked, and the person merges again after.
            const asked = yield* askable(taskId, null)
            if (asked === 'resolving') return yield* cant('resolving', conflicts.join('; '))
            if (asked === 'yes') {
              const found = yield* Effect.forEach(conflicting, ({ repository, files }) => conflictHere(repository, files))
              yield* beginRound({ projectId: task.projectId, taskId, threadId: task.threadId }, null, found)
              return yield* cant('resolving', conflicts.join('; '))
            }
            return yield* cant('conflicts', conflicts.join('; '))
          }
          const missing = plans.find(({ plan }) => plan.kind === 'missing')
          if (missing !== undefined) return yield* cant('missing', missing.repository.base)
          for (const { plan } of plans)
            if (plan.kind === 'busy')
              return yield* plan.untracked.length > 0
                ? cant('untracked', `${plan.untracked.join(', ')} in ${plan.checkout}`)
                : cant('busy', plan.checkout)
          for (const { repository, plan } of plans)
            if (plan.kind === 'submodule') return yield* cant('submodule', named(repository, plan.submodule))
          const refused = yield* applyMerges(
            plans.flatMap(({ repository, plan }) =>
              plan.kind === 'move' ? [{ root: repository.root, branch: repository.base, plan, repository }] : [],
            ),
          )
          if (refused?.problem?.kind === 'unreadable')
            return yield* cant('unreadable', named(refused.repository, `${refused.problem.checkout}\n${refused.problem.detail}`))
          if (refused?.problem?.kind === 'submodule') return yield* cant('submodule', named(refused.repository, refused.problem.submodule))
          if (refused !== null)
            return yield* refused.plan.checkout === null || refused.problem?.kind === 'moved'
              ? cant('moved', several ? `${refused.repository.name}’s ${refused.branch}` : refused.branch)
              : cant('busy', refused.plan.checkout)
          for (const { settle } of plans) yield* settle
          const merged = plans.map(({ repository, plan }) => ({
            repository: repository.name,
            branch: repository.base,
            already: plan.kind === 'already',
          }))
          yield* addItem({ projectId: task.projectId, threadId: task.threadId }, 'notice', {
            source: 'runtime',
            severity: 'info',
            title: several
              ? `Merged here: ${merged.map((one) => `${one.repository} into ${one.branch}`).join(', ')}.`
              : `Merged into ${merged[0]?.branch ?? 'its default branch'} here.`,
            description: 'On this computer only: nothing was pushed.',
          })
          // Merged, its task is done, as a merged pull request's is, once any others it has are merged too.
          yield* settleIfDone(taskId, { actorId: instance.personId, here: merged })
          return merged
        })

      /** Why a push the person's git made failed, in its words where the remote gave some: else git's own failure. */
      const refusal = (taskId: string, remote: string, failed: GitFailed): Effect.Effect<never, GitFailed | PushRefused> => {
        // The remote said no on its own terms, such as a protected branch: what it said, not a guess.
        const refused = /\[remote rejected\][^(]*\(([^)]*)\)/i.exec(failed.stderr)
        if (refused !== null) return Effect.fail(new PushRefused({ taskId, why: 'refused', remote, said: refused[1] ?? '' }))
        if (/! \[rejected\].*\((fetch first|non-fast-forward)\)/i.test(failed.stderr))
          return Effect.fail(new PushRefused({ taskId, why: 'behind', remote }))
        if (/authentication|permission denied|could not read (username|password)|terminal prompts disabled/i.test(failed.stderr))
          return Effect.fail(new PushRefused({ taskId, why: 'denied', remote }))
        return Effect.fail(failed)
      }

      /**
       * Pushes a task's branch, in each repository without a pull request, to
       * the remote that repository's work goes to, as the person would from a
       * terminal: up to the commit they saw, their remote, the branch's own
       * name there, their sign-in, never forced. Nothing is opened there; the
       * task says where a pull request can be, and stays as it was.
       */
      const pushBranch = (taskId: string, heads: ReadonlyArray<{ readonly repository: string; readonly head: string }>) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [task] = yield* sql<{ projectId: ProjectId; threadId: string }>`
            SELECT k.project_id, t.id AS thread_id FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task' WHERE k.id = ${taskId}`
          if (task === undefined) return yield* new NotFound({ kind: 'task', id: taskId })
          const repositories = yield* sql<{
            slug: string
            base: string
            root: string
            worktree: string
            branch: string
            baseCommit: string | null
          }>`
            SELECT b.slug, coalesce(b.default_base_ref, w.base_ref) AS base, l.path AS root, w.path AS worktree, w.branch, w.base_commit
            FROM workspaces w
            JOIN repository_bindings b ON b.id = w.binding_id
            JOIN repository_locations l ON l.binding_id = b.id AND l.device_id = ${instance.deviceId}
            WHERE w.task_id = ${taskId} AND w.device_id = ${instance.deviceId} AND w.access = 'write' AND w.branched_at IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM repository_changes c WHERE c.workspace_id = w.id AND c.pull_request_url IS NOT NULL)
            ORDER BY b.created_at, b.rowid`
          const pushed: Array<{ branch: string; remote: string }> = []
          for (const repository of repositories) {
            const head = heads.find((seen) => seen.repository === repository.slug)?.head
            if (head === undefined) continue
            if (!/^[0-9a-f]{7,64}$/.test(head)) return yield* new CantMerge({ taskId, why: 'changed', detail: '' })
            const remote = yield* remoteOf(repository.root, repository.base)
            if (remote === null) continue
            // Credited as every push is (credit.ts): what the remote has already stays as it is.
            const [there = null] = yield* commitsOf(repository.root, [`refs/remotes/${remote}/${repository.branch}`])
            const { head: sent, settle } = yield* credited(repository.worktree, repository.branch, head, [repository.baseCommit, there])
            // What the person saw, or what crediting made of it, still on the branch: a commit the lead made since isn't theirs to have seen.
            if (!(yield* onHead(repository.worktree, head)) && !(yield* onHead(repository.worktree, sent)))
              return yield* new CantMerge({ taskId, why: 'changed', detail: '' })
            yield* gitWithin(60_000, repository.worktree, 'push', '--', remote, `${sent}:refs/heads/${repository.branch}`).pipe(
              Effect.catchTag('GitFailed', (failed) => refusal(taskId, `${remote}/${repository.branch}`, failed)),
            )
            yield* settle
            // What the remote has now, as a fetch would say: git notes it itself only where the remote's fetch takes every branch.
            yield* gitWithin(10_000, repository.root, 'update-ref', `refs/remotes/${remote}/${repository.branch}`, sent).pipe(Effect.ignore)
            pushed.push({ branch: repository.branch, remote })
          }
          if (pushed.length === 0) return yield* new NotFound({ kind: 'remote', id: taskId })
          yield* addItem({ projectId: task.projectId, threadId: task.threadId }, 'notice', {
            source: 'runtime',
            severity: 'info',
            title: `Pushed ${[...new Set(pushed.map((one) => one.branch))].join(', ')} to ${[...new Set(pushed.map((one) => one.remote))].join(', ')}.`,
          })
          return pushed
        })

      const pushHere = (taskId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [task] = yield* sql<{ projectId: ProjectId; threadId: string }>`
            SELECT k.project_id, t.id AS thread_id FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task' WHERE k.id = ${taskId}`
          if (task === undefined) return yield* new NotFound({ kind: 'task', id: taskId })
          const repositories = yield* sql<{ base: string; root: string; worktree: string; baseCommit: string | null }>`
            SELECT coalesce(b.default_base_ref, w.base_ref) AS base, l.path AS root, w.path AS worktree, w.base_commit
            FROM workspaces w
            JOIN repository_bindings b ON b.id = w.binding_id
            JOIN repository_locations l ON l.binding_id = b.id AND l.device_id = ${instance.deviceId}
            WHERE w.task_id = ${taskId} AND w.device_id = ${instance.deviceId} AND w.access = 'write' AND w.branched_at IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM repository_changes c WHERE c.workspace_id = w.id AND c.pull_request_url IS NOT NULL)`
          const pushed: Array<{ branch: string; remote: string }> = []
          for (const repository of repositories) {
            // Only where the task's own work merged: a repository it left alone isn't its to push, whatever its branch holds.
            const [head = null] = yield* commitsOf(repository.worktree, ['HEAD'])
            if (head === null || head === repository.baseCommit) continue
            const merged = yield* gitOutcome(repository.root, 'merge-base', '--is-ancestor', head, `refs/heads/${repository.base}`)
            if (merged.code !== 0) continue
            const followed = yield* gitOutcome(
              repository.root,
              'for-each-ref',
              '--format=%(upstream:short)',
              `refs/heads/${repository.base}`,
            )
            if (followed.code !== 0 || followed.stdout === '') continue
            const remote = followed.stdout
            const at = remote.indexOf('/')
            // As the person would push it: their remote, their branch there, their sign-in. A prompt for a password fails rather than waits.
            yield* gitWithin(
              60_000,
              repository.root,
              'push',
              '--',
              remote.slice(0, at),
              `refs/heads/${repository.base}:refs/heads/${remote.slice(at + 1)}`,
            ).pipe(Effect.catchTag('GitFailed', (failed) => refusal(taskId, remote, failed)))
            pushed.push({ branch: repository.base, remote })
          }
          if (pushed.length > 0)
            yield* addItem({ projectId: task.projectId, threadId: task.threadId }, 'notice', {
              source: 'runtime',
              severity: 'info',
              title: `Pushed ${pushed.map((one) => `${one.branch} to ${one.remote.slice(0, one.remote.indexOf('/'))}`).join(', ')}.`,
            })
          return pushed
        })

      /**
       * Pushes a tag the lead made to the remote its repository's work goes
       * to, with the person's own git, as they would from a terminal: never
       * forced, so a tag the remote has already stays as it is there. Agents
       * have no sign-in to the code host, so Althar pushes for them, once the
       * request is allowed as the lead's own `git push` of it would be: a tag
       * often starts a release, so the rules hold it for the person
       * (ADR-013), short of a project that allows everything or never this.
       */
      const pushTag = (taskId: string, input: unknown, access: ToolAccess) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const asked = yield* Schema.decodeUnknownEffect(TagAsked)(input).pipe(
            Effect.mapError((error) => new ToolRefused({ message: `Althar couldn't read that: ${error.message}` })),
          )
          const tag = asked.tag.trim().replace(/^refs\/tags\//, '')
          const repositories = yield* sql<{ slug: string; base: string; root: string; worktree: string }>`
            SELECT b.slug, coalesce(b.default_base_ref, w.base_ref) AS base, l.path AS root, w.path AS worktree
            FROM workspaces w
            JOIN repository_bindings b ON b.id = w.binding_id
            JOIN repository_locations l ON l.binding_id = b.id AND l.device_id = ${instance.deviceId}
            WHERE w.task_id = ${taskId} AND w.device_id = ${instance.deviceId} AND w.access = 'write'
            ORDER BY b.created_at, b.rowid`
          const named = asked.repository == null ? null : String(asked.repository).trim()
          const candidates = named === null ? repositories : repositories.filter((one) => one.slug === named)
          const [repository] = candidates
          if (repository === undefined || candidates.length > 1)
            return yield* new ToolRefused({
              message:
                repositories.length === 0
                  ? 'This task has no repository of its own to push a tag from.'
                  : `Say which repository with repository, as one of: ${repositories.map((one) => one.slug).join(', ')}.`,
            })
          // A name git takes for a tag, and never one read as an option.
          const valid = yield* gitOutcome(repository.root, 'check-ref-format', `refs/tags/${tag}`)
          if (tag === '' || tag.startsWith('-') || valid.code !== 0)
            return yield* new ToolRefused({ message: `\`${tag}\` isn't a name git takes for a tag.` })
          const [commit = null] = yield* commitsOf(repository.worktree, [`refs/tags/${tag}`])
          if (commit === null)
            return yield* new ToolRefused({
              message: `There's no tag ${tag} here. Make it first, with \`git tag ${tag}\` on the commit it's for, then call push_tag.`,
            })
          const remote = yield* remoteOf(repository.root, repository.base)
          if (remote === null) return yield* new ToolRefused({ message: `${repository.slug} has no remote to push ${tag} to.` })
          if (Option.isNone(yield* sessions.running(access.threadId)))
            return yield* new ToolRefused({ message: 'Only a running lead can push a tag.' })
          const command = `git push ${remote} refs/tags/${tag}`
          const request: PermissionRequest = {
            sessionId: access.sessionId,
            toolCallId: `push_tag:${yield* newId(Ids.permissionRequest)}`,
            title: command,
            kind: 'execute',
            rawInput: { command },
            paths: [],
            options: [
              { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
              { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
            ],
          }
          // What became of it, in words for the lead: pushed, or why not.
          const settled = Effect.gen(function* () {
            const decision = yield* sessions.askPermission(access.threadId, request)
            if (decision.decision !== 'allow')
              return `${tag} wasn't pushed: ${decision.reason ?? "the person didn't allow it"}. Don't push it another way.`
            yield* gitWithin(60_000, repository.root, 'push', '--', remote, `refs/tags/${tag}:refs/tags/${tag}`)
            yield* addItem({ projectId: access.projectId as ProjectId, threadId: access.threadId }, 'notice', {
              source: 'runtime',
              severity: 'info',
              title: `Pushed tag ${tag} to ${remote}.`,
            })
            return `Pushed ${tag}, on ${commit.slice(0, 8)}, to ${remote}.`
          }).pipe(
            Effect.catchTag('GitFailed', (failed) =>
              /! \[rejected\].*\(already exists\)/i.test(failed.stderr)
                ? Effect.succeed(`${remote} has a tag ${tag} already, on another commit, so ${tag} wasn't pushed. Althar doesn't move it.`)
                : refusal(taskId, remote, failed).pipe(
                    Effect.catchTag('PushRefused', (refused) =>
                      Effect.succeed(
                        refused.why === 'denied'
                          ? `${remote} didn't take the person's sign-in, so ${tag} wasn't pushed. Tell the person.`
                          : `${remote} refused ${tag}${refused.said === undefined || refused.said === '' ? '' : `: ${refused.said}`}. Tell the person.`,
                      ),
                    ),
                    Effect.catchTag('GitFailed', (other) =>
                      Effect.succeed(`Pushing ${tag} failed: ${other.stderr.trim().split('\n').at(-1) ?? ''}`),
                    ),
                  ),
            ),
            Effect.catchTag('NoSession', () => Effect.succeed(`${tag} wasn't pushed: the session that asked has ended.`)),
          )
          // Answered soon, as by the rules or a person looking, the call says what happened; else the lead is told once it is, so a
          // call isn't held past what an agent waits for a tool.
          const said = yield* Deferred.make<string>()
          const state = yield* Ref.make<'waiting' | 'late' | 'done'>('waiting')
          yield* Effect.forkIn(
            provide(
              Effect.gen(function* () {
                const words = yield* settled
                yield* Deferred.succeed(said, words)
                const late = yield* Ref.modify(state, (now) => [now === 'late', 'done' as const])
                if (!late || Option.isNone(yield* sessions.running(access.threadId))) return
                yield* sessions.send({
                  envelope: yield* envelope('thread.send', { threadId: access.threadId }, undefined, instance.systemId),
                  threadId: access.threadId,
                  body: words,
                  quiet: true,
                })
              }),
            ),
            scope,
          )
          const soon = yield* Deferred.await(said).pipe(Effect.timeoutOption(TAG_ANSWERED_WITHIN))
          if (Option.isSome(soon)) return soon.value
          const late = yield* Ref.modify(state, (now) => (now === 'done' ? [false, now] : [true, 'late' as const]))
          if (!late) return yield* Deferred.await(said)
          return `Asked the person to allow pushing ${tag} to ${remote}. Nothing goes up until they do; you'll be told when it's pushed, or if it isn't.`
        })

      const reply = (
        taskId: string,
        input: { readonly body: string; readonly threadId: string | null; readonly by: string | null; readonly url?: string },
      ) =>
        Effect.gen(function* () {
          const { link, snapshot, host, repository } = yield* current(taskId, input.url)
          const digest = createHash('sha256')
            .update(`${input.threadId ?? ''}\0${input.body}`)
            .digest('hex')
            .slice(0, 32)
          yield* outward({
            projectId: link.projectId,
            subject: { type: 'external_link', id: link.id },
            target: `${host.product}:${snapshot.repository.join('/')}`,
            operation: 'reply',
            key: `reply:${link.id}:${digest}`,
            request: { number: snapshot.number, threadId: input.threadId },
            retryable: false,
            // Posted as the person's account, so it says who wrote it.
            perform: host.reply(repository, snapshot.number, { body: signed(input.body, input.by), threadId: input.threadId }),
            encode: (answer) => answer,
            decode: (kept) => Option.getOrUndefined(Schema.decodeUnknownOption(Comment)(kept)),
          })
          yield* news(taskId)
          return yield* summaryOf(link)
        })

      /** The ids of the replies Althar posted on a change, from their receipts. */
      const repliesOf = (linkId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const rows = yield* sql<{ id: string | number | null }>`
            SELECT json_extract(m.response, '$.id') AS id FROM mutation_receipts m JOIN work_items w ON w.id = m.work_item_id
            WHERE w.subject_type = 'external_link' AND w.subject_id = ${linkId} AND m.operation = 'reply' AND m.response IS NOT NULL`
          return new Set(rows.flatMap((row) => (row.id === null ? [] : [String(row.id)])))
        })

      /**
       * Who said something on a change, for who hears it: Althar, in a
       * reply it posted (by its receipt, or, when that was lost, its
       * signature on the account's own comment); a bot; the person, whose
       * account the connection is; one of the repository's people; or anyone
       * else, as on a public repository.
       */
      const voiceOf = (
        said: { readonly id: string; readonly author: Person; readonly member: boolean; readonly body: string },
        account: Account,
        replies: ReadonlySet<string>,
      ): 'althar' | 'bot' | 'person' | 'member' | 'outsider' => {
        const mine = said.author.id === account.id
        if (replies.has(said.id) || (mine && fromAlthar(said.body))) return 'althar'
        if (said.author.bot) return 'bot'
        if (mine) return 'person'
        return said.member ? 'member' : 'outsider'
      }

      /** A pull request by its repository and number, as the lead names one among several: web#3. */
      const shortNameOf = (snapshot: Snapshot) => `${snapshot.repository.at(-1) ?? ''}${snapshot.words.prefix}${snapshot.number}`

      /**
       * Each of the task's pull requests, read as `readOne` reads one, one
       * after another: one that can't be read says why on its own, in the
       * words the tool would have for it, and the rest are read.
       */
      const read = (taskId: string) =>
        Effect.gen(function* () {
          const urls = yield* urlsOf(taskId)
          if (urls.length <= 1) return yield* readOne(taskId)
          return (yield* Effect.forEach(urls, (seen) =>
            readOne(taskId, seen.url).pipe(
              Effect.catch((error) => {
                const refused = refusalOf(error)
                return refused === undefined ? Effect.fail(error) : Effect.succeed(unread(refused))
              }),
              contained('Changes.read', (cause) => unread(summarize(cause))),
              Effect.map((read) => `${shortNameOf(seen)}: ${read}`),
            ),
          )).join('\n\n')
        })

      /** A pull request the lead's read couldn't, with why. */
      const unread = (why: string) => `Althar couldn’t read it (${why.replace(/\.$/, '')}).`

      /** The task's pull requests as last seen, oldest first. */
      const urlsOf = (taskId: string) =>
        Effect.flatMap(linksOf(taskId), (links) =>
          Effect.forEach(links, (link) =>
            Effect.map(Effect.option(decodeSnapshot(link.snapshot)), (seen) => (Option.isSome(seen) ? [seen.value] : [])),
          ),
        ).pipe(Effect.map((seen) => seen.flat()))

      const readOne = (taskId: string, url?: string) =>
        Effect.gen(function* () {
          const { link, snapshot, host, repository, account } = yield* current(taskId, url)
          const now = yield* host.change(repository, snapshot.number)
          const lines: Array<string> = [`${nameOf(snapshot)}, "${now.title}" (${standing(now)}): ${now.url}`]
          if (now.headSha !== null) {
            const checks = yield* host.checks(repository, now.headSha)
            const sum = checksOf(now.headSha, checks)
            lines.push(checksLine(sum))
            for (const check of checks.filter((candidate) => candidate.state === 'failed').slice(0, LOGS_TO_LEAD))
              lines.push(logForLead(yield* readLog(host, repository, check)))
          }
          const activity = yield* host.activity(repository, snapshot.number, null)
          const replies = yield* repliesOf(link.id)
          // What anyone else said isn't read to the lead: on a public repository, anyone can comment.
          const reviews = activity.reviews.filter((review) => voiceOf(review, account, replies) !== 'outsider')
          const comments = activity.comments.flatMap((comment) => {
            const voice = voiceOf(comment, account, replies)
            if (voice === 'outsider') return []
            return [{ at: comment.at, text: commentLine(comment, voice === 'althar' ? 'you, through Althar' : undefined) }]
          })
          const outsiders = activity.reviews.length - reviews.length + activity.comments.length - comments.length
          const said = [...reviews.map((review) => ({ at: review.at, text: reviewLine(review) })), ...comments]
            .toSorted((a, b) => (a.at < b.at ? -1 : 1))
            .slice(-COMMENTS_SHOWN)
          lines.push(
            said.length === 0
              ? 'Nobody has said anything on it.'
              : `What people said, oldest first:\n${said.map((entry) => entry.text).join('\n')}`,
          )
          if (outsiders > 0) lines.push(outsidersLine(outsiders))
          return lines.join('\n\n')
        })

      /** Records something heard once; whether it was new. */
      const heard = (link: LinkRow, kind: string, id: string, payload: Readonly<Record<string, unknown>>) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          yield* sql`INSERT OR IGNORE INTO observations ${sql.insert({
            id: yield* newId(Ids.observation),
            projectId: link.projectId,
            subjectType: 'external_link',
            subjectId: link.id,
            kind,
            payload: JSON.stringify({ ...payload, id }),
            source: link.product,
            observedAt: yield* timestamp,
          })}`
          const [inserted] = yield* sql<{ n: number }>`SELECT changes() AS n`
          return (inserted?.n ?? 0) > 0
        })

      /** An arrival in the task's thread. */
      const arrive = (link: LinkRow, content: Readonly<Record<string, unknown>>) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [thread] = yield* sql<{ id: string }>`SELECT id FROM threads WHERE task_id = ${link.taskId} AND kind = 'task'`
          if (thread !== undefined)
            yield* addItem({ projectId: link.projectId, threadId: thread.id }, 'arrival', { source: link.product, ...content })
        })

      /** Tells the task's lead, if one is running, what it should hear. */
      /**
       * Whether the task's change is in Althar's hands (ADR-040): its plan's
       * run ended well and opened its pull requests, one is open, and the
       * person hasn't opened the task since. Then Althar sees its checks
       * through: the change is under way while they run, a failure goes to its
       * lead, started again where it must be, and the lead's fix goes up
       * without asking, for `FIX_ROUNDS` fixes. Checks a
       * pull request hasn't shown yet, within `checksAppear` of the work
       * coming back, count as running where the repository's pull requests
       * have had checks before: a host registers them after a push.
       */
      const handsOf = (taskId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const rows = yield* sql<{ outcome: string | null; endedAt: string; pushedAt: string | null; failed: number; hasChecks: number }>`
            SELECT
              -- What the checks of its head say: those of a head before it, which a push has left behind, say nothing.
              CASE WHEN json_extract(l.snapshot, '$.checks.sha') = json_extract(l.snapshot, '$.headSha')
                THEN json_extract(l.snapshot, '$.checks.outcome') END AS outcome,
              r.ended_at,
              -- When Althar last pushed to it: its checks may take a moment to show after that too.
              (SELECT max(p.observed_at) FROM observations p WHERE p.subject_type = 'external_link' AND p.subject_id = l.id
                AND p.kind = 'pushed') AS pushed_at,
              -- Whether the repository's pull requests, this one included, have had checks before: one with none never will, and isn't
              -- kept waiting.
              EXISTS (SELECT 1 FROM external_links e JOIN observations c ON c.subject_type = 'external_link' AND c.subject_id = e.id
                AND c.kind = 'checks' WHERE e.project_id = l.project_id AND e.kind = 'change'
                AND json_extract(e.snapshot, '$.repository') = json_extract(l.snapshot, '$.repository')) AS has_checks,
              -- By commit: one run again after it failed is still one failure. A fix that brought them green starts the count again,
              -- as fixesOf counts it.
              (SELECT count(DISTINCT json_extract(o.payload, '$.sha')) FROM observations o WHERE o.subject_type = 'external_link'
                AND o.subject_id = l.id AND o.kind = 'checks' AND json_extract(o.payload, '$.outcome') = 'failed'
                AND o.observed_at >= max(r.ended_at, coalesce((SELECT max(p.observed_at) FROM observations p
                  WHERE p.subject_type = 'external_link' AND p.subject_id = l.id AND p.kind = 'checks'
                  AND json_extract(p.payload, '$.outcome') = 'passed'), ''))) AS failed
            FROM tasks k JOIN runs r ON r.id = (SELECT id FROM runs WHERE task_id = k.id AND plan_id IS NOT NULL ORDER BY created_at DESC LIMIT 1)
            JOIN external_links l ON l.task_id = k.id AND l.kind = 'change'
            WHERE k.id = ${taskId} AND k.state = 'open' AND r.state = 'succeeded'
              AND r.ended_at IS NOT NULL AND (k.seen_at IS NULL OR k.seen_at < r.ended_at)
              AND json_extract(l.snapshot, '$.state') = 'open' AND l.listening = 1
              -- Nor once the person has said anything on the task since, or stopped its lead: it is theirs.
              AND NOT EXISTS (SELECT 1 FROM user_inputs i JOIN actors a ON a.id = i.author_actor_id JOIN threads h ON h.id = i.thread_id
                WHERE h.task_id = k.id AND a.kind = 'person' AND i.accepted_at >= r.ended_at)
              AND NOT EXISTS (SELECT 1 FROM observations o WHERE o.subject_type = 'external_link' AND o.subject_id = l.id
                AND o.kind = 'taken' AND o.observed_at >= r.ended_at)`
          if (rows.length === 0) return null
          const now = yield* Clock.currentTimeMillis
          const failed = Math.max(...rows.map((row) => row.failed))
          const running = rows.some(
            (row) =>
              row.outcome === 'running' ||
              ((row.outcome === null || row.outcome === 'none') &&
                row.hasChecks === 1 &&
                now - Math.max(Date.parse(row.endedAt), row.pushedAt === null ? 0 : Date.parse(row.pushedAt)) < checksAppear),
          )
          return { failed, running, given: failed > FIX_ROUNDS } satisfies Hands
        })

      /**
       * Where the checks that failed on each of a task's open pull requests
       * stand, whether or not the person has looked (ADR-068), read from the
       * record each time. A run of failures counts, by commit, from the end of
       * its plan's run, the person's last push, or the checks last passing,
       * whichever came last. It is its lead's to see through (`open`) while it
       * has tries left, unless its lead brought the latest failure to the
       * person, or the person stopped or interrupted it since that commit's
       * checks were first seen (or they ran too long, or couldn't be read):
       * that failure doesn't wake it again, one on a new commit does. A
       * settled task's are no one's, nor those of a pull request Althar no
       * longer follows, as one an attached pull request replaced.
       */
      const fixesOf = (taskId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const links = yield* sql<{
            id: string
            snapshot: string
            endedAt: string | null
            pushedAt: string | null
            hasChecks: number
            spokenAt: string | null
          }>`
            SELECT l.id, l.snapshot,
              (SELECT ended_at FROM runs WHERE task_id = k.id AND plan_id IS NOT NULL ORDER BY created_at DESC LIMIT 1) AS ended_at,
              (SELECT max(p.observed_at) FROM observations p WHERE p.subject_type = 'external_link' AND p.subject_id = l.id
                AND p.kind = 'pushed') AS pushed_at,
              EXISTS (SELECT 1 FROM external_links e JOIN observations c ON c.subject_type = 'external_link' AND c.subject_id = e.id
                AND c.kind = 'checks' WHERE e.project_id = l.project_id AND e.kind = 'change'
                AND json_extract(e.snapshot, '$.repository') = json_extract(l.snapshot, '$.repository')) AS has_checks,
              (SELECT max(i.accepted_at) FROM user_inputs i JOIN actors a ON a.id = i.author_actor_id JOIN threads h ON h.id = i.thread_id
                WHERE h.task_id = k.id AND a.kind = 'person') AS spoken_at
            FROM tasks k JOIN external_links l ON l.task_id = k.id AND l.kind = 'change'
            WHERE k.id = ${taskId} AND k.state = 'open' AND json_extract(l.snapshot, '$.state') = 'open' AND l.listening = 1`
          const now = yield* Clock.currentTimeMillis
          return yield* Effect.forEach(links, (link) =>
            Effect.gen(function* () {
              const snapshot = yield* decodeSnapshot(link.snapshot)
              const said = yield* sql<{
                kind: string
                at: string
                sha: string | null
                outcome: string | null
                how: string | null
                why: string | null
              }>`
                SELECT kind, observed_at AS at, json_extract(payload, '$.sha') AS sha, json_extract(payload, '$.outcome') AS outcome,
                  json_extract(payload, '$.how') AS how, json_extract(payload, '$.why') AS why
                FROM observations WHERE subject_type = 'external_link' AND subject_id = ${link.id}
                  AND kind IN ('checks', 'checks_running', 'taken', 'checks_handed')
                ORDER BY observed_at, rowid`
              const head = snapshot.headSha
              const outcome = snapshot.checks !== null && snapshot.checks.sha === head ? snapshot.checks.outcome : null
              const start = said
                .filter((one) => (one.kind === 'taken' && one.how === 'pushed') || (one.kind === 'checks' && one.outcome === 'passed'))
                .reduce((latest, one) => (one.at > latest ? one.at : latest), link.endedAt ?? '')
              // Each commit's checks, when they first failed; those that failed since the count started.
              const first = new Map<string, string>()
              const counted = new Set<string>()
              for (const one of said)
                if (one.kind === 'checks' && one.outcome === 'failed' && one.sha !== null) {
                  if (!first.has(one.sha)) first.set(one.sha, one.at)
                  if (one.at >= start) counted.add(one.sha)
                }
              const latest = [...counted].reduce<string | null>(
                (last, sha) => (last === null || (first.get(sha) ?? '') > (first.get(last) ?? '') ? sha : last),
                null,
              )
              // Stopped by the person once its checks were under way, as while a conflict round's ran: that commit's failure is theirs.
              const since =
                latest === null ? null : (said.find((one) => one.kind !== 'taken' && one.sha === latest)?.at ?? first.get(latest) ?? null)
              const stopped = since !== null && said.some((one) => one.kind === 'taken' && one.how !== 'pushed' && one.at >= since)
              const handedOf = (sha: string | null) => said.findLast((one) => one.kind === 'checks_handed' && one.sha === sha)
              const failed = counted.size
              const given = failed > FIX_ROUNDS
              const open = latest !== null && !given && !stopped && handedOf(latest) === undefined
              const appearing =
                (outcome === null || outcome === 'none') &&
                link.hasChecks === 1 &&
                now -
                  Math.max(link.endedAt === null ? 0 : Date.parse(link.endedAt), link.pushedAt === null ? 0 : Date.parse(link.pushedAt)) <
                  checksAppear
              const failing = outcome === 'failed'
              // Whether the person said anything on the task since its head's checks were first seen: what the lead commits may be for
              // that, and waits for their push.
              const seenAt = head === null ? undefined : said.find((one) => one.sha === head)?.at
              const spoken = link.spokenAt !== null && (seenAt === undefined || link.spokenAt >= seenAt)
              const handed = handedOf(head)
              return {
                linkId: link.id,
                failed,
                given,
                open,
                stopped,
                failing,
                spoken,
                running: open && (outcome === 'running' || appearing),
                why: !failing
                  ? null
                  : handed !== undefined
                    ? handed.why
                    : given && latest === head
                      ? spentLine(snapshot.checks?.failing ?? [], FIX_ROUNDS)
                      : null,
              }
            }),
          )
        })

      /** Where the checks that failed on one of a task's pull requests stand (`fixesOf`): null where it isn't open, or its task settled. */
      const fixingOn = (link: LinkRow) => Effect.map(fixesOf(link.taskId), (all) => all.find((one) => one.linkId === link.id) ?? null)

      /** A quiet line in the task's thread. */
      const sayOn = (link: LinkRow, title: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [thread] = yield* sql<{ id: string }>`SELECT id FROM threads WHERE task_id = ${link.taskId} AND kind = 'task'`
          if (thread !== undefined)
            yield* addItem({ projectId: link.projectId, threadId: thread.id }, 'notice', { source: 'runtime', severity: 'info', title })
        })

      /** Whether a conflict round is under way on the task: resolving, or seeing the checks on what it pushed through. */
      const roundUnderWay = (taskId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [row] = yield* sql<{ one: number }>`
            SELECT 1 AS one FROM conflict_resolutions WHERE task_id = ${taskId} AND state IN ('resolving', 'checking') LIMIT 1`
          return row !== undefined
        })

      /**
       * Whether the checks on this commit ran again after they failed (ADR-041),
       * the latest time: Althar's own once, `rerun:<sha>`, and each the lead
       * asked for after, `rerun:<sha>:<n>`.
       */
      const ranAgain = (link: LinkRow, sha: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [row] = yield* sql<{ at: string; id: string }>`
            SELECT observed_at AS at, json_extract(payload, '$.id') AS id FROM observations
            WHERE subject_type = 'external_link' AND subject_id = ${link.id}
              AND kind = 'checks_rerun' AND json_extract(payload, '$.sha') = ${sha}
            ORDER BY observed_at DESC, rowid DESC LIMIT 1`
          if (row === undefined) return null
          // Its run again is under way once the host has shown it running; a failure before that is the old one, still showing.
          const startedId = row.id.replace(/^rerun:/, 'rerun-started:')
          const [started] = yield* sql<{ one: number }>`
            SELECT 1 AS one FROM observations WHERE subject_type = 'external_link' AND subject_id = ${link.id}
              AND kind = 'checks_rerun_started' AND json_extract(payload, '$.id') = ${startedId} LIMIT 1`
          // How its outcome is heard: Althar's own as it always was, each of the lead's apart.
          return { at: row.at, started: started !== undefined, startedId, again: row.id === `rerun:${sha}` ? ':again' : `:${row.id}` }
        })

      /** Keeps that the lead ran checks on this commit again: its outcome is heard afresh, as Althar's own rerun's is. */
      const leadRanAgain = (link: LinkRow, sha: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [count] = yield* sql<{ n: number }>`
            SELECT count(*) AS n FROM observations WHERE subject_type = 'external_link' AND subject_id = ${link.id}
              AND kind = 'checks_rerun' AND json_extract(payload, '$.sha') = ${sha}`
          yield* heard(link, 'checks_rerun', `rerun:${sha}:${(count?.n ?? 0) + 1}`, { sha, by: 'lead' })
        })

      /**
       * Checks that have run on a commit longer than STUCK_AFTER, while the
       * change is in Althar's hands, make it the person's: the thread says
       * how long, once (ADR-041).
       */
      const stuckOn = (link: LinkRow, name: string, sha: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [since] = yield* sql<{ at: string }>`
            SELECT observed_at AS at FROM observations WHERE subject_type = 'external_link' AND subject_id = ${link.id}
              AND kind = 'checks_running' AND json_extract(payload, '$.id') = ${`running:${sha}`} LIMIT 1`
          if (since === undefined) return
          const ran = (yield* Clock.currentTimeMillis) - Date.parse(since.at)
          if (ran < Duration.toMillis(stuckAfter)) return
          const hands = yield* handsOf(link.taskId)
          // The checks on a lead's fix too, after the person has looked (ADR-068).
          const fixing = yield* fixingOn(link)
          if ((hands === null || hands.given) && fixing?.running !== true) return
          if (!(yield* heard(link, 'checks_stuck', `stuck:${sha}`, { sha }))) return
          yield* taken(link.taskId, 'stuck')
          yield* sayOn(link, `The checks on ${name} have run for ${spanOf(ran)}, so the change is yours now.`)
        })

      /** Whether the task's plan is still under way, as while it publishes, its pull request open already. */
      const publishing = (taskId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [run] = yield* sql<{ state: string }>`
            SELECT state FROM runs WHERE task_id = ${taskId} AND plan_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`
          return run?.state === 'running'
        })

      /** Says in the task's thread that its checks still failed after FIX_ROUNDS fixes while Althar saw them through: the change is the person's now. */
      const gaveUp = (link: LinkRow, name: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [thread] = yield* sql<{ id: string }>`SELECT id FROM threads WHERE task_id = ${link.taskId} AND kind = 'task'`
          if (thread === undefined) return
          yield* addItem({ projectId: link.projectId, threadId: thread.id }, 'notice', {
            source: 'runtime',
            severity: 'warning',
            title: `The checks on ${name} still fail after ${FIX_ROUNDS} fixes by its lead, so the change is yours now.`,
          })
        })

      /**
       * Tells the task's lead, quietly, when it has a session; with `wake`,
       * one that has none is started again for it, on the agent it was last
       * on (ADR-040).
       */
      const tellLead = (link: LinkRow, parts: ReadonlyArray<string>, wake = false) =>
        Effect.gen(function* () {
          if (parts.length === 0) return
          const sql = yield* SqlClient.SqlClient
          const [thread] = yield* sql<{ id: string; state: string }>`
            SELECT t.id, k.state FROM threads t JOIN tasks k ON k.id = t.task_id WHERE t.task_id = ${link.taskId} AND t.kind = 'task'`
          if (thread === undefined || thread.state !== 'open') return
          const running = Option.isSome(yield* sessions.running(thread.id))
          if (!running && !wake) return
          yield* sessions.send({
            envelope: yield* envelope('thread.send', { threadId: thread.id, heard: link.id }, undefined, instance.systemId),
            threadId: thread.id,
            body: parts.join('\n\n'),
            quiet: true,
          })
          if (!running) yield* sessions.startLast(thread.id)
        })

      /**
       * A pull request's head as its host says, unless the host hasn't read
       * Althar's last push to it yet: for a moment after a push, GitHub still
       * answers with the head before, behind what was pushed. Where the
       * remote's branch is on what was pushed, that is its head; where it
       * isn't, someone moved it back, and the host is right.
       */
      const caughtUp = (link: LinkRow, read: ChangeRequest, host: CodeHost, repository: Repository) =>
        Effect.gen(function* () {
          const said = read.headSha
          const onto = read.source
          if (said === null || read.state !== 'open') return said
          const sent = yield* sentTo(link.projectId, read.url)
          if (sent === null || sent === said) return said
          const workspace = yield* worktreeOf(link.taskId, read.url)
          if (workspace === undefined || !(yield* behindAny(workspace.path, [said], [sent]))) return said
          const target = yield* pushTargetOf(host, repository, workspace.path)
          return (yield* remoteTip(workspace.path, target, onto)) === sent ? sent : said
        }).pipe(Effect.orElseSucceed(() => read.headSha))

      /**
       * One turn of listening to a change: its state, its finished checks, and
       * what was said since the cursor. Whether anything happened on it, so
       * a quiet one is asked less often.
       */
      const poll = (link: LinkRow, how: { readonly force: boolean; readonly fresh: boolean } = { force: false, fresh: false }) =>
        Effect.gen(function* () {
          if (link.connectionId === null) return false
          const adapters = yield* connections.adapters(link.connectionId)
          const host = adapters.host
          if (host === undefined) return false
          const account = adapters.info.account
          const before = yield* decodeSnapshot(link.snapshot)
          const repository: Repository = yield* host.repository(before.repository)
          const answer = yield* host.change(repository, before.number)
          // Merged, it stays so: for a moment after a merge, a host can still answer it as it was.
          const read: ChangeRequest = before.state === 'merged' ? { ...answer, state: 'merged' } : answer
          const now = { ...read, headSha: yield* caughtUp(link, read, host, repository) }
          const name = nameOf(before)
          const forLead: Array<string> = []
          let alone = false
          let rerunning = false
          let happened = false
          let checks = before.checks
          // While its plan still publishes, how its checks end waits: once the run has ended, they are heard as the change's,
          // and a failure goes where it should (ADR-040).
          const held = now.headSha !== null && (yield* publishing(link.taskId))
          if (held) happened = true
          // Checks the host won't show Althar don't stop it hearing the rest: the thread says so, once a commit, and a change in
          // Althar's hands is the person's, since Althar can't see its checks through (ADR-041).
          const ran =
            now.headSha === null || held
              ? null
              : yield* host.checks(repository, now.headSha).pipe(
                  Effect.catchIf(
                    (error) => error.reason === 'forbidden' || error.reason === 'not_found',
                    (error) =>
                      Effect.gen(function* () {
                        if (yield* heard(link, 'checks_unreadable', `unreadable:${now.headSha}`, { message: error.message })) {
                          const hands = yield* handsOf(link.taskId)
                          const theirs = (hands !== null && !hands.given) || (yield* fixingOn(link))?.open === true
                          if (theirs) yield* taken(link.taskId, 'unreadable')
                          yield* sayOn(
                            link,
                            `Althar can't read the checks on ${name}: its host refused them (${error.message}). It still listens for what people say on it${theirs ? ', and the change is yours now' : ''}.`,
                          )
                        }
                        return null
                      }),
                  ),
                )
          if (now.headSha !== null && ran !== null) {
            const sum = checksOf(now.headSha, ran)
            const finished = sum.outcome === 'passed' || sum.outcome === 'failed'
            // A check run again after it failed is heard again when it ends: once the host has shown it running again, or, one too
            // quick to be seen so, after RERUN_SHOWS. Until then a failure is the old one.
            const reran = yield* ranAgain(link, sum.sha)
            // Checks still running keep the pull request worth asking about; too long, while Althar sees them through, and the change is
            // the person's. Running again after a rerun, from when they show so.
            if (sum.outcome === 'running') {
              happened = true
              yield* heard(link, 'checks_running', `running:${sum.sha}`, { sha: sum.sha })
              if (reran !== null && !reran.started) yield* heard(link, 'checks_rerun_started', reran.startedId, { sha: sum.sha })
              yield* stuckOn(link, name, sum.sha)
            }
            const settled =
              reran === null || reran.started || (yield* Clock.currentTimeMillis) - Date.parse(reran.at) > Duration.toMillis(RERUN_SHOWS)
            if (
              finished &&
              settled &&
              (before.checks?.sha !== sum.sha || before.checks.outcome !== sum.outcome) &&
              (yield* heard(link, 'checks', `checks:${sum.sha}:${sum.outcome}${reran?.again ?? ''}`, { ...sum }))
            ) {
              happened = true
              // The failed checks' logs, read once: the card shows their ends, or why there are none, and the lead is told the same.
              const reads =
                sum.outcome === 'failed'
                  ? yield* Effect.forEach(ran.filter((candidate) => candidate.state === 'failed').slice(0, LOGS_TO_LEAD), (check) =>
                      readLog(host, repository, check),
                    )
                  : []
              yield* arrive(link, {
                kind: 'checks',
                from: null,
                where: name,
                passed: sum.passed,
                failed: sum.failed,
                failing: sum.failing,
                logs: reads.map((read) => ({ name: read.name, url: read.url, log: read.log, missing: read.missing })),
                url: now.url,
              })
              // A failure its lead is to see through, whether or not the person has looked (ADR-068), is run again once before the
              // lead is told: it may have failed by chance. Not the checks on a merge a conflict round pushed: the round sees those
              // through itself.
              const fixing = sum.outcome === 'failed' ? yield* fixingOn(link) : null
              const failedChecks = ran.filter((candidate) => candidate.state === 'failed')
              const again =
                fixing?.open === true && !reran && !(yield* roundUnderWay(link.taskId))
                  ? (yield* Effect.forEach(failedChecks, (check) =>
                      host.rerun(repository, check).pipe(Effect.orElseSucceed(() => false)),
                    )).some(Boolean)
                  : false
              if (again) {
                yield* heard(link, 'checks_rerun', `rerun:${sum.sha}`, { sha: sum.sha })
                yield* sayOn(
                  link,
                  `Running ${sum.failing.join(', ')} on ${name} again, once, in case ${sum.failing.length === 1 ? 'it' : 'they'} failed by chance.`,
                )
                rerunning = true
              } else if (sum.outcome === 'failed') {
                const logs = reads.map(logForLead)
                // Its lead sees them through alone, whether or not the person has looked, started again if it must be, and its fix
                // goes up as it pushes (ADR-040, ADR-068). After FIX_ROUNDS fixes the change is the person's: its lead says once what
                // it tried. Stopped by the person since the failure came, it isn't told it again; else it is told, if it runs.
                if (fixing?.open === true) {
                  alone = true
                  // Where its branch was then: commits on it not pushed yet are the person's to push, a fix or not.
                  const workspace = yield* worktreeOf(link.taskId, now.url).pipe(Effect.orElseSucceed(() => undefined))
                  const branch =
                    workspace === undefined ? null : yield* commitOf(workspace.path, 'HEAD').pipe(Effect.orElseSucceed(() => null))
                  yield* heard(link, 'checks_told', `told:${sum.sha}${reran?.again ?? ''}`, { sha: sum.sha, branch })
                  forLead.push(checksForLeadAlone(sum, name, logs, FIX_ROUNDS - fixing.failed + 1, repository.defaultBranch))
                } else if (
                  fixing !== null &&
                  fixing.given &&
                  !fixing.stopped &&
                  fixing.failed === FIX_ROUNDS + 1 &&
                  (yield* heard(link, 'checks_spent', `spent:${sum.sha}`, { sha: sum.sha }))
                ) {
                  yield* gaveUp(link, name)
                  alone = true
                  forLead.push(checksSpentForLead(sum, name, logs, FIX_ROUNDS))
                } else if (fixing?.stopped !== true) forLead.push(checksForLead(sum, name, logs))
              }
            }
            // Run again, they are running as far as Althar knows: how they end next is heard, however soon.
            checks = rerunning || !settled ? { ...sum, outcome: 'running' } : sum
          }
          const activity = yield* host.activity(repository, before.number, link.cursor)
          const replies = activity.comments.length === 0 ? new Set<string>() : yield* repliesOf(link.id)
          for (const review of activity.reviews) {
            const voice = voiceOf(review, account, replies)
            if (voice === 'althar' || !(yield* heard(link, 'review', `review:${review.id}`, { author: review.author.login }))) continue
            happened = true
            yield* arrive(link, {
              kind: 'review',
              from: review.author.login,
              verdict: review.verdict,
              where: name,
              text: review.body,
              url: review.url,
              outsider: voice === 'outsider',
            })
            if ((voice === 'person' || voice === 'member') && review.verdict !== 'approved') forLead.push(reviewForLead(review, name))
          }
          for (const comment of activity.comments) {
            const voice = voiceOf(comment, account, replies)
            if (voice === 'althar' || voice === 'bot') continue
            if (!(yield* heard(link, 'comment', `comment:${comment.id}`, { author: comment.author.login }))) continue
            happened = true
            yield* arrive(link, {
              kind: 'comment',
              from: comment.author.login,
              where: name,
              text: comment.body,
              path: comment.path,
              line: comment.line,
              url: comment.url,
              outsider: voice === 'outsider',
            })
            if (voice === 'person' || voice === 'member') forLead.push(commentForLead(comment, name))
          }
          if (forLead.some((part) => !part.startsWith('Checks failed'))) forLead.push(answerHint)
          // Attached to the task, it stays so (ADR-052).
          const after = {
            ...snapshotOf(now, before.repository, before.words, checks),
            ...(before.attached === true ? { attached: true } : {}),
          }
          if (after.state !== before.state) {
            happened = true
            if (after.state === 'merged') yield* arrive(link, { kind: 'merged', from: null, where: name, url: now.url })
            if (after.state === 'closed') yield* arrive(link, { kind: 'closed', from: null, where: name, url: now.url })
          } else if (before.draft && !after.draft) {
            happened = true
            yield* arrive(link, { kind: 'ready', from: null, where: name, url: now.url })
          }
          const settled = after.state !== 'open'
          yield* saveSnapshot(link, after, {
            cursor: activity.cursor === '' ? link.cursor : activity.cursor,
            polledAt: yield* timestamp,
            ...(settled ? { listening: 0 } : {}),
          })
          // Merged or closed, it takes no more pushes: what the lead asked to push to it is closed.
          if (settled) for (const asked of yield* askedOf(link.taskId, before.url)) yield* settleAsked(asked, 'closed')
          if (after.state === 'merged' && before.state !== 'merged') yield* Effect.andThen(follow(link.taskId, 'merged', before), baseMoved)
          if (after.state === 'merged') yield* settleIfDone(link.taskId)
          // Checks on what Althar pushed to resolve a conflict are the round's; what fails there isn't told the lead twice.
          const theRounds = yield* checked(link, before.url, now, host, repository).pipe(
            Effect.catchCause((cause) => Effect.as(Effect.logWarning('Could not hear the checks on a resolved conflict', cause), false)),
          )
          yield* tellLead(link, theRounds ? forLead.filter((part) => !part.startsWith('Checks failed')) : forLead, alone && !theRounds)
          // Not worked out yet by its host, whether it conflicts is asked again next turn, a few turns running, not taken for a no.
          const unknown = now.state === 'open' && now.conflicts === undefined ? (unknownFor.get(link.id) ?? 0) + 1 : 0
          if (unknown === 0) unknownFor.delete(link.id)
          else unknownFor.set(link.id, unknown)
          if (now.state === 'open')
            yield* lookAt(link, before, now, host, repository, how).pipe(
              Effect.catchCause((cause) => Effect.logWarning('Could not look for a conflict to resolve', cause)),
            )
          else yield* forgetUnsent(link.taskId)
          return happened
        })

      /** Where Althar keeps, by worktree, the commit the person left out what came before (ADR-034): only what comes after counts. */
      const LEFT_OUT = 'refs/althar/left-out/'

      /**
       * Of commits on a worktree's branch after `head`, those its default
       * branch doesn't have: neither the commits themselves, as a merge of the
       * default branch into the task's brings them, nor their change, as one
       * cherry-picked into another pull request that merged has it under
       * another hash (by patch, as `git cherry` tells). The default branch as
       * this Mac has it: as Althar last fetched it for a next pull request, as
       * the worktree started from it, and its own branch, each read on its
       * own, since any may be behind the rest. All of them, where git can't
       * say.
       */
      const notOnDefault = (
        repository: { readonly path: string; readonly baseRef: string | null; readonly defaultBase: string | null },
        head: string,
        commits: ReadonlyArray<string>,
      ) =>
        Effect.gen(function* () {
          const target = (repository.baseRef ?? '').replace(/^origin\//, '') || repository.defaultBase
          const named = [
            target === null || target === '' ? null : `refs/althar/base/${target}`,
            repository.baseRef,
            repository.defaultBase === null ? null : `refs/heads/${repository.defaultBase}`,
          ]
          const tips: Array<string> = []
          for (const ref of named) {
            if (ref === null || ref === '') continue
            const tip = (yield* gitOutcome(repository.path, 'rev-parse', '--verify', '-q', `${ref}^{commit}`)).stdout
            if (tip !== '' && !tips.includes(tip)) tips.push(tip)
          }
          // Each on its own, as each may be fresher than the rest: a commit counts only where none has it, by hash or by patch.
          let kept = new Set(commits)
          for (const tip of tips) {
            const listed = yield* gitOutcome(
              repository.path,
              'rev-list',
              '--no-merges',
              '--right-only',
              '--cherry-pick',
              `${tip}...HEAD`,
              `^${head}`,
            )
            if (listed.code !== 0) continue
            const lacks = new Set(listed.stdout.split('\n').filter((line) => line !== ''))
            kept = new Set([...kept].filter((commit) => lacks.has(commit)))
          }
          return commits.filter((commit) => kept.has(commit))
        })

      /**
       * Each of the task's repositories here whose last pull request merged
       * or closed, with commits on its branch after that pull request's head:
       * what a new pull request would have (ADR-034). Merges are left out of
       * them, since what a merge brought in is the default branch's, and so
       * are commits the default branch has already, by their change too;
       * commits that change nothing together have nothing to ship, and those
       * the person left out are history. One whose worktree doesn't have its
       * pull request's head can't tell, and has none.
       */
      const unshippedOf = (taskId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const repositories = yield* sql<{
            workspaceId: string
            path: string
            branch: string
            baseCommit: string | null
            baseRef: string | null
            name: string
            slug: string
            remotes: string
            defaultBase: string | null
            sent: string | null
            changeBranch: string | null
            linkId: string | null
            product: Product | null
            snapshot: string | null
            listening: number | null
            openedAt: string | null
          }>`
            SELECT w.id AS workspace_id, w.path, w.branch, w.base_commit, w.base_ref, b.display_name AS name, b.slug,
              b.remote_fingerprints AS remotes, b.default_base_ref AS default_base, c.head_commit AS sent, c.branch AS change_branch, l.id AS link_id, l.product,
              l.snapshot, l.listening, l.created_at AS opened_at
            FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id
            LEFT JOIN repository_changes c ON c.id = (SELECT id FROM repository_changes WHERE workspace_id = w.id
              AND pull_request_url IS NOT NULL ORDER BY created_at DESC, rowid DESC LIMIT 1)
            LEFT JOIN external_links l ON l.task_id = w.task_id AND l.kind = 'change' AND l.url = c.pull_request_url
            WHERE w.task_id = ${taskId} AND w.device_id = ${instance.deviceId} AND w.access = 'write' AND w.state = 'ready'
            ORDER BY b.created_at, b.rowid`
          const found: Array<Unshipped> = []
          for (const repository of repositories) {
            if (!existsSync(repository.path)) continue
            const seen =
              repository.snapshot === null ? undefined : Option.getOrUndefined(yield* Effect.option(decodeSnapshot(repository.snapshot)))
            if (seen?.state === 'open') continue
            let head: string | undefined
            let moved = false
            if (seen === undefined) {
              // None yet: from where its branch started, where it is on a code host Althar knows; one on none merges here.
              const remotes = Option.getOrElse(
                Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(Schema.String)))(repository.remotes),
                () => [],
              )
              if ((yield* hostOfRemotes(remotes)) === null) continue
              head = repository.baseCommit ?? repository.baseRef ?? undefined
            } else {
              // Its head as the host has it, else as Althar pushed it: the first the branch has. A worktree on a branch of its own
              // since, made for its next pull request that didn't open, counts from where that branch started.
              moved = repository.branch !== repository.changeBranch
              head = moved && repository.baseCommit !== null ? repository.baseCommit : undefined
              for (const candidate of moved ? [] : [seen.headSha, repository.sent])
                if (candidate !== null && head === undefined && (yield* onHead(repository.path, candidate))) head = candidate
            }
            if (head === undefined) continue
            const shipped = head
            // What the person left out after it stays out: the count starts where they did, while the branch still has it.
            const left = (yield* gitOutcome(
              repository.path,
              'rev-parse',
              '--verify',
              '-q',
              `${LEFT_OUT}${repository.workspaceId}^{commit}`,
            )).stdout
            if (
              left !== '' &&
              left !== head &&
              (yield* onHead(repository.path, left)) &&
              (yield* gitOutcome(repository.path, 'merge-base', '--is-ancestor', head, left)).code === 0
            )
              head = left
            const listed = yield* git(repository.path, 'rev-list', '--reverse', '--no-merges', `${head}..HEAD`).pipe(
              Effect.orElseSucceed(() => ''),
            )
            const all = listed.split('\n').filter((line) => line !== '')
            if (all.length === 0) continue
            const commits = yield* notOnDefault(repository, head, all)
            // Some of them in the default branch already, the diff from that head has its changes too: theirs are counted alone.
            const whole = commits.length === all.length
            // Commits that change nothing, all together, have nothing to ship.
            if (commits.length === 0 || (whole && (yield* gitOutcome(repository.path, 'diff', '--quiet', head, 'HEAD')).code === 0))
              continue
            // How big they are together, as a diff from that head says: a binary file counts no lines.
            const counted = yield* (
              whole
                ? git(repository.path, 'diff', '--numstat', head, 'HEAD')
                : git(repository.path, 'show', '--numstat', '--format=', ...commits)
            ).pipe(Effect.orElseSucceed(() => ''))
            const lines = counted
              .split('\n')
              .map((line) => line.split('\t'))
              .reduce((sum, [add = '', del = '']) => ({ add: sum.add + (Number(add) || 0), del: sum.del + (Number(del) || 0) }), {
                add: 0,
                del: 0,
              })
            found.push({
              workspaceId: repository.workspaceId,
              path: repository.path,
              branch: repository.branch,
              name: repository.name,
              slug: repository.slug,
              openedAt: repository.openedAt,
              change:
                seen === undefined || repository.linkId === null || repository.product === null
                  ? null
                  : { ...seen, linkId: repository.linkId, product: repository.product, listening: repository.listening === 1 },
              head,
              shipped,
              commits,
              moved,
              ...lines,
            })
          }
          return found
        })

      /**
       * A task is done once each of its repositories is merged: its pull
       * request merged, or, where it has none, its branch in its default branch
       * here. A pull request closed without merging keeps it open, for the
       * person, and so do commits after a merged one, which a new pull request
       * takes (ADR-034). Not done yet, what is still open is said in the
       * thread.
       */
      /**
       * Where a task's change stands, by repository, as settling it reads it:
       * the pull requests still open or closed, each repository's latest,
       * and the repositories with none whose branch's head isn't in their
       * default branch here.
       */
      const mergeOf = (taskId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const repositories = yield* sql<{ name: string; path: string; base: string; root: string; opened: number }>`
            SELECT b.display_name AS name, w.path, coalesce(b.default_base_ref, w.base_ref) AS base, l.path AS root,
              EXISTS (SELECT 1 FROM repository_changes c WHERE c.workspace_id = w.id AND c.pull_request_url IS NOT NULL) AS opened
            FROM workspaces w
            JOIN repository_bindings b ON b.id = w.binding_id
            JOIN repository_locations l ON l.binding_id = b.id AND l.device_id = ${instance.deviceId}
            WHERE w.task_id = ${taskId} AND w.device_id = ${instance.deviceId}
            ORDER BY b.created_at, b.rowid`
          // Each repository by its latest pull request, the open one else its newest: one closed before its next merged is history
          // (ADR-034). Among several, each is said with its repository.
          const seen = (yield* Effect.forEach(yield* linksOf(taskId), (link) => Effect.option(decodeSnapshot(link.snapshot)))).flatMap(
            (one) => (Option.isSome(one) ? [one.value] : []),
          )
          const latest = latestOf(seen)
          const open = latest.flatMap((one) =>
            one.state !== 'merged' ? [repositories.length > 1 ? `${nameOf(one)} in ${one.repository.at(-1) ?? ''}` : nameOf(one)] : [],
          )
          // A repository with no pull request is merged where its branch's head is in its default branch here.
          const unmerged: Array<string> = []
          for (const repository of repositories) {
            if (repository.opened === 1) continue
            const head = yield* commitOf(repository.path, 'HEAD').pipe(Effect.orElseSucceed(() => ''))
            const merged = yield* gitOutcome(repository.root, 'merge-base', '--is-ancestor', head, `refs/heads/${repository.base}`)
            if (head === '' || merged.code !== 0) unmerged.push(repository.name)
          }
          return { repositories, open, unmerged, merged: latest.length > 0 && open.length === 0 && unmerged.length === 0 }
        })

      const settleIfDone = (
        taskId: string,
        by: {
          readonly actorId: ActorId
          readonly here?: ReadonlyArray<{ readonly repository: string; readonly branch: string; readonly already: boolean }>
        } = { actorId: instance.systemId },
      ) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [task] = yield* sql<{ state: string; projectId: ProjectId; threadId: string }>`
            SELECT k.state, k.project_id, t.id AS thread_id FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task'
            WHERE k.id = ${taskId}`
          // An abandoned task whose change merged on its host after all is done too: what it made is in, so it isn't reopened.
          if (task?.state !== 'open' && task?.state !== 'abandoned') return
          // A round of work under way settles it when it ends, by what it left (ADR-034).
          const [working] = yield* sql<{ id: string }>`SELECT id FROM runs WHERE task_id = ${taskId} AND state = 'running' LIMIT 1`
          if (working !== undefined) return yield* touchCard(taskId)
          const { repositories, open, unmerged } = yield* mergeOf(taskId)
          // Commits after a merged pull request are in none yet: a new one takes them.
          const after =
            open.length > 0
              ? []
              : (yield* unshippedOf(taskId)).flatMap((one) => (one.change === null ? [] : [{ ...one, change: one.change }]))
          if (open.length > 0 || unmerged.length > 0 || after.length > 0) {
            // Abandoned, it is nobody's to finish: nothing is said.
            if (task.state === 'abandoned') return
            yield* addItem({ projectId: task.projectId, threadId: task.threadId }, 'notice', {
              source: 'runtime',
              severity: 'info',
              title: `Not done yet: ${[
                ...open.map((name) => `${name} is still open`),
                ...unmerged.map((name) => `${name} isn't merged`),
                ...after.map(
                  (one) =>
                    `${commitsWord(one.commits.length)} after ${nameOf(one.change)}${repositories.length > 1 ? ` in ${one.name}` : ''} ${one.commits.length === 1 ? "isn't" : "aren't"} in a pull request`,
                ),
              ].join(', ')}.`,
              ...(after.length === 0 ? {} : { description: 'Open a new pull request for them from the task.' }),
            })
            return yield* touchCard(taskId)
          }
          yield* sql.withTransaction(
            Effect.gen(function* () {
              const at = yield* timestamp
              const revision = yield* change('tasks', taskId, { state: 'done', settledAt: at })
              yield* fact({
                projectId: task.projectId,
                aggregateType: 'task',
                aggregateId: taskId,
                revision,
                type: 'task.done',
                payload: { merged: true, ...(by.here === undefined ? {} : { here: by.here }) },
                actorId: by.actorId,
              })
            }),
          )
          yield* touchCard(taskId)
        })

      /**
       * The person abandons a merged task, and so leaves out the commits
       * after its last pull requests that are in none yet (ADR-034): where
       * each worktree is now is kept, so they are history and only what is
       * committed after counts again. They stay on its branch, in its
       * worktree, as abandoning keeps them. Then it settles as a merge does:
       * done, its settled time kept where it was done already.
       */
      const leaveOut = (input: { readonly envelope: CommandEnvelope; readonly taskId: string }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const after = yield* unshippedOf(input.taskId)
          if (after.length === 0) return
          const [task] = yield* sql<{ projectId: ProjectId; threadId: string; state: string; revision: number }>`
            SELECT k.project_id, t.id AS thread_id, k.state, k.revision FROM tasks k
            JOIN threads t ON t.task_id = k.id AND t.kind = 'task' WHERE k.id = ${input.taskId}`
          if (task === undefined) return yield* new NotFound({ kind: 'task', id: input.taskId })
          // Open, it is merged only where every repository of it is, as settling it asks: else abandoning it is abandoning, not this.
          if (task.state === 'open') {
            if (!(yield* mergeOf(input.taskId)).merged) return
          } else if (task.state !== 'done') return
          const left: Array<{ readonly repository: string; readonly branch: string; readonly at: string; readonly commits: number }> = []
          for (const one of after) {
            const at = yield* commitOf(one.path, 'HEAD')
            yield* git(one.path, 'update-ref', `${LEFT_OUT}${one.workspaceId}`, at)
            left.push({ repository: one.name, branch: one.branch, at, commits: one.commits.length })
          }
          yield* sql.withTransaction(
            Effect.gen(function* () {
              const revision = yield* bumpRevision('tasks', input.taskId, task.revision)
              yield* fact({
                projectId: task.projectId,
                aggregateType: 'task',
                aggregateId: input.taskId,
                revision,
                type: 'task.left_out',
                payload: { left },
                actorId: input.envelope.actorId,
                commandId: input.envelope.commandId,
              })
            }),
          )
          const several = after.length > 1
          const commits = after.reduce((sum, one) => sum + one.commits.length, 0)
          yield* addItem({ projectId: task.projectId, threadId: task.threadId }, 'notice', {
            source: 'runtime',
            severity: 'info',
            title: `Abandoned ${after
              .map(
                (one) =>
                  `${commitsWord(one.commits.length)} after ${one.change === null ? 'where its branch started' : nameOf(one.change)}${several ? ` in ${one.name}` : ''}`,
              )
              .join(', ')}.`,
            description: `The task stays merged. ${commits === 1 ? 'The commit stays' : 'They stay'} on ${after.map((one) => one.branch).join(' and ')}, in the task's worktree; what's committed after counts again.`,
          })
          if (task.state === 'open') yield* settleIfDone(input.taskId, { actorId: input.envelope.actorId })
          yield* touchCard(input.taskId)
        })

      /* ---- A lead resolving a conflict on its own, where the project says to (conflicts.ts) ---- */

      const decodeConflicts = Schema.decodeUnknownEffect(Schema.fromJsonString(Conflicts))
      const decodeWaiting = Schema.decodeUnknownEffect(Schema.fromJsonString(RoundWaiting))
      const decodeEnded = Schema.decodeUnknownEffect(Schema.fromJsonString(Ended))

      const roundColumns = (sql: SqlClient.SqlClient) =>
        sql`c.id, c.project_id, c.task_id, t.id AS thread_id, c.pull_request_url AS url, c.conflicts, c.attempt, c.state,
            c.failure, c.ended, c.pushed_head, c.asked_sequence, c.updated_at, c.waiting`

      /** The task's round under way, resolving or waiting for its checks: one at most. */
      const underWay = (taskId: string) =>
        Effect.flatMap(
          SqlClient.SqlClient,
          (sql) => sql<RoundRow>`
            SELECT ${roundColumns(sql)} FROM conflict_resolutions c JOIN threads t ON t.task_id = c.task_id AND t.kind = 'task'
            WHERE c.task_id = ${taskId} AND c.state IN ('resolving', 'checking')`,
        )

      const roundOf = (where: { readonly id: string } | { readonly threadId: string }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const columns = roundColumns(sql)
          const [round] =
            'id' in where
              ? yield* sql<RoundRow>`
                  SELECT ${columns} FROM conflict_resolutions c JOIN threads t ON t.task_id = c.task_id AND t.kind = 'task' WHERE c.id = ${where.id}`
              : yield* sql<RoundRow>`
                  SELECT ${columns} FROM conflict_resolutions c JOIN threads t ON t.task_id = c.task_id AND t.kind = 'task'
                  WHERE t.id = ${where.threadId} AND c.state = 'resolving' AND c.waiting IS NULL`
          return round
        })

      /** The task's worktrees here, by their repository's slug. */
      const worktreesOf = (taskId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const rows = yield* sql<{ slug: string; path: string }>`
            SELECT b.slug, w.path FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id
            WHERE w.task_id = ${taskId} AND w.device_id = ${instance.deviceId} AND w.access = 'write'`
          return new Map(rows.map((row) => [row.slug, row.path]))
        })

      /** Where each of the round's branches is now. */
      const endedOf = (taskId: string, conflicts: ReadonlyArray<Conflict>) =>
        Effect.gen(function* () {
          const worktrees = yield* worktreesOf(taskId)
          return yield* Effect.forEach(conflicts, (conflict) =>
            Effect.map(commitOf(worktrees.get(conflict.repository) ?? '', 'HEAD').pipe(Effect.orElseSucceed(() => '')), (head) => ({
              repository: conflict.repository,
              head,
            })),
          )
        })

      /**
       * Whether a conflict is the lead's to resolve now, unasked: the task
       * says so, or its project does where the task says nothing; the task is
       * open, its lead idle, and no round is under way. A run that ended
       * otherwise than succeeded, failed or cancelled, leaves its lead idle
       * all the same. Not while its run still goes, nor where the person
       * stopped it, where starting its lead would go against them. One the
       * lead couldn't resolve stays the person's while its branches are as it
       * left them and what they conflicted with is where it was (`targets`,
       * where it is now). Forced, as the person's Resolve now is, neither the
       * rules, a stop nor a round handed back holds it.
       */
      const askable = (
        taskId: string,
        url: string | null,
        how: { readonly force?: boolean; readonly targets?: ReadonlyArray<string> } = {},
      ): Effect.Effect<Askable, unknown, Store> =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [task] = yield* sql<{ projectId: ProjectId; state: string; resolveConflicts: number | null; run: string | null }>`
            SELECT k.project_id, k.state, k.resolve_conflicts,
              (SELECT state FROM runs WHERE task_id = k.id ORDER BY created_at DESC, rowid DESC LIMIT 1) AS run
            FROM tasks k WHERE k.id = ${taskId}`
          if (task === undefined || task.state !== 'open') return 'off'
          const force = how.force === true
          if (!force && !resolvesConflictsFor((yield* (yield* Policies).current(task.projectId)).rules, task.resolveConflicts)) return 'off'
          const [latest] = yield* sql<{
            id: string
            url: string | null
            state: string
            conflicts: string
            ended: string | null
            failure: string | null
          }>`
            SELECT id, pull_request_url AS url, state, conflicts, ended, failure FROM conflict_resolutions WHERE task_id = ${taskId}
            ORDER BY created_at DESC, rowid DESC LIMIT 1`
          if (latest?.state === 'resolving' || latest?.state === 'checking') return 'resolving'
          // Its run still going, its lead is at work: looked at again once it ends.
          if (task.run === 'admitted' || task.run === 'running')
            return { why: 'Its run is still going, so Althar asks its lead once it ends.', shown: false }
          if (task.run === null) return { why: 'It has no lead yet to ask.', shown: true }
          if (force) return 'yes'
          if (task.run === 'suspended') return { why: 'You stopped it, so Althar doesn’t start its lead for a conflict.', shown: true }
          // One that ended as Althar stopped, as an earlier launch settled it, wasn't the lead's to fail.
          if (latest?.state === 'failed' && latest.url === url && latest.ended !== null && !latest.failure?.startsWith(STOPPED_MIDWAY)) {
            const left = yield* decodeEnded(latest.ended)
            const conflicts = yield* decodeConflicts(latest.conflicts)
            const now = yield* endedOf(taskId, conflicts)
            const still = left.every((one) => now.some((head) => head.repository === one.repository && head.head === one.head))
            // What it conflicted with moved on since: a conflict of its own, the lead's to try again.
            const moved = how.targets !== undefined && conflicts.some((one) => !(how.targets ?? []).includes(one.target))
            if (still && !moved) return 'handed'
          }
          return 'yes'
        })

      /**
       * A task that conflicts wasn't asked of its lead, or one Althar couldn't
       * look at for a conflict (`checked` false), whatever its host says: why,
       * logged, and on its card where the person is to see it.
       */
      const notSent = (taskId: string, why: string, shown = true, checked = true) =>
        Effect.gen(function* () {
          if (logged.get(taskId) !== why) {
            logged.set(taskId, why)
            yield* Effect.logInfo(
              checked ? `A conflict wasn’t sent to its lead: ${why}` : `A task couldn’t be looked at for a conflict: ${why}`,
            ).pipe(Effect.annotateLogs({ taskId }))
          }
          const was = unsent.get(taskId)
          if (shown ? was?.why === why && was.checked === checked : was === undefined) return
          if (shown) unsent.set(taskId, { why, checked })
          else unsent.delete(taskId)
          // Its board card and its task say it too, not only its card in the conversation.
          yield* touchTask(taskId)
        })

      /** Nothing to say of a task's conflict any more: asked of its lead, or it conflicts no more. */
      const forgetUnsent = (taskId: string) =>
        Effect.gen(function* () {
          logged.delete(taskId)
          pressed.delete(taskId)
          if (unsent.delete(taskId)) yield* touchTask(taskId)
        })

      /** What `askable` said, done: the lead asked, or why not kept; whether to ask it. */
      const sayingWhy = (taskId: string, asked: Askable) =>
        Effect.gen(function* () {
          if (asked === 'yes') return true
          // Off, the rules leave it to the person, unless they pressed Resolve now: why that went nowhere stays.
          if (asked === 'off') {
            if (!pressed.has(taskId)) yield* forgetUnsent(taskId)
            return false
          }
          if (asked === 'handed') yield* forgetUnsent(taskId)
          else if (asked !== 'resolving') yield* notSent(taskId, asked.why, asked.shown)
          return false
        })

      /** Where a task's latest round stands, for its card (`Changes.conflictStanding`). */
      const standingOfRound = (taskId: string): Effect.Effect<ConflictStanding | null, unknown, Store> =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [latest] = yield* sql<{ id: string }>`
            SELECT id FROM conflict_resolutions WHERE task_id = ${taskId} ORDER BY created_at DESC, rowid DESC LIMIT 1`
          const round = latest === undefined ? undefined : yield* roundOf({ id: latest.id })
          if (round?.state === 'resolving') return { state: 'resolving', checks: round.pushedHead !== null }
          const said = unsent.get(taskId)
          if (said !== undefined) return { state: said.checked ? 'unsent' : 'unchecked', why: said.why }
          if (round === undefined) return null
          if (round.state !== 'failed' || round.ended === null || round.failure === null) return null
          // Still the person's while the branches are as the lead left them, as `askable` reads it.
          const conflicts = yield* decodeConflicts(round.conflicts)
          const left = yield* decodeEnded(round.ended)
          const now = yield* endedOf(taskId, conflicts)
          if (!left.every((one) => now.some((head) => head.repository === one.repository && head.head === one.head))) return null
          const couldnt =
            round.pushedHead === null ? `resolve the conflict with ${shortWhereLine(conflicts)}` : 'fix the checks on the merge'
          return { state: 'handed_back', why: `The lead couldn’t ${couldnt}. ${round.failure}` }
        })

      /** Where a round is, in its words: its pull request (`PR #1`), or none for merging here. */
      const placeOf = (taskId: string, url: string | null): Effect.Effect<Place, unknown, Store> =>
        Effect.gen(function* () {
          if (url === null) return { change: null }
          const seen = (yield* urlsOf(taskId)).find((one) => one.url === url)
          return { change: seen === undefined ? 'the pull request' : nameOf(seen) }
        })

      /**
       * Whether anything but the round asked the lead since it last did: the
       * person, or what the pull request passes on. What the lead committed
       * may then be for that, and isn't Althar's to push.
       */
      const askedSince = (round: RoundRow) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [other] = yield* sql<{ id: string }>`
            SELECT id FROM user_inputs WHERE thread_id = ${round.threadId} AND sequence > ${round.askedSequence} LIMIT 1`
          return other !== undefined
        })

      /**
       * Asks the lead: quietly, as Althar does, since the thread says it in a
       * notice; a lead that isn't running is started for it, on the agent last
       * on the thread, as an answer starts one (Runs.answered). The round keeps
       * which of the thread's inputs asked it.
       */
      const askLead = (
        round: { readonly id: string; readonly projectId: ProjectId; readonly taskId: string; readonly threadId: string },
        attempt: number,
        body: string,
        why: Readonly<Record<string, unknown>> = {},
      ): Effect.Effect<void, unknown, Store> =>
        Effect.gen(function* () {
          const accepted = yield* sessions.send({
            envelope: yield* envelope('thread.send', { threadId: round.threadId, resolving: round.id, attempt }),
            threadId: round.threadId,
            body,
            quiet: true,
          })
          yield* reviseRound(
            round,
            'conflict_resolution.asked',
            { attempt, askedSequence: accepted.sequence, waiting: null },
            { attempt, ...why },
          )
          if (Option.isSome(yield* sessions.running(round.threadId))) return
          // Started apart, so what holds the task's pull request isn't held while an agent starts.
          yield* Effect.forkIn(
            sessions.startLast(round.threadId).pipe(
              Effect.flatMap((started) =>
                started ? Effect.void : locked(round.taskId)(settleRound(round.id, { why: 'There was no lead to ask.' })),
              ),
              Effect.catchCause((cause) =>
                locked(round.taskId)(settleRound(round.id, { why: `The lead couldn't start. ${summarize(cause)}`.trim() })),
              ),
              provide,
            ),
            scope,
          )
        })

      /**
       * A conflict the lead is to resolve: recorded, said in the thread, and
       * asked of it, once the lead has a place among the agents at work on
       * this machine; until then the round keeps its ask, and waits.
       */
      const beginRound = (
        task: { readonly projectId: ProjectId; readonly taskId: string; readonly threadId: string },
        url: string | null,
        conflicts: ReadonlyArray<Conflict>,
      ) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          unsent.delete(task.taskId)
          pressed.delete(task.taskId)
          const id = yield* newId(Ids.conflictResolution)
          const place = yield* placeOf(task.taskId, url)
          const body = noteFor(conflicts, place, null)
          const room = yield* busy.enter(
            task.taskId,
            (room) =>
              sql.withTransaction(
                Effect.gen(function* () {
                  const at = yield* timestamp
                  yield* sql`INSERT INTO conflict_resolutions ${sql.insert({
                    id,
                    projectId: task.projectId,
                    taskId: task.taskId,
                    pullRequestUrl: url,
                    conflicts: JSON.stringify(conflicts),
                    attempt: 1,
                    state: 'resolving',
                    waiting: room ? null : JSON.stringify({ attempt: 1, body, why: {}, since: at } satisfies RoundWaiting),
                    createdAt: at,
                    updatedAt: at,
                  })}`
                  yield* fact({
                    projectId: task.projectId,
                    aggregateType: 'conflict_resolution',
                    aggregateId: id,
                    revision: 1,
                    type: 'conflict_resolution.started',
                    payload: {
                      url,
                      conflicts: conflicts.map((one) => ({ repository: one.repository, branch: one.branch, files: one.files })),
                      ...(room ? {} : { waiting: true }),
                    },
                    actorId: instance.systemId,
                  })
                  return room
                }),
              ),
            // A conflict put to the lead: the work of a task under way.
            { order: 'underway' },
          )
          const [own] = yield* sql<{ resolveConflicts: number | null }>`SELECT resolve_conflicts FROM tasks WHERE id = ${task.taskId}`
          const as = own?.resolveConflicts === 1 ? 'as you said for this task' : 'as the project’s rules say'
          yield* addItem({ projectId: task.projectId, threadId: task.threadId }, 'notice', {
            source: 'runtime',
            severity: 'info',
            title: `${place.change ?? 'It'} conflicts with ${whereLine(conflicts)}.`,
            description: room
              ? `Althar asked the lead to resolve it, ${as}.`
              : `Althar asks the lead to resolve it, ${as}, once an agent is free on this computer.`,
          })
          yield* touchCard(task.taskId)
          if (room) yield* askLead({ id, ...task }, 1, body)
        })

      /**
       * Every round that waits for a place to ask its lead, with since when,
       * and what asks it once it has one. One whose ask can't be read is left
       * out, and the rest still wait.
       */
      const roundsWaiting = Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<RoundRow>`
          SELECT ${roundColumns(sql)} FROM conflict_resolutions c JOIN threads t ON t.task_id = c.task_id AND t.kind = 'task'
          JOIN tasks k ON k.id = c.task_id JOIN projects p ON p.id = c.project_id
          WHERE c.state = 'resolving' AND c.waiting IS NOT NULL AND k.state = 'open' AND p.archived_at IS NULL`
        const waiting = yield* Effect.forEach(rows, (round) =>
          decodeWaiting(round.waiting ?? '').pipe(
            Effect.map((waited) => [
              {
                taskId: round.taskId,
                order: 'underway' as const,
                since: waited.since,
                start: provide(locked(round.taskId)(askWaiting(round.id))),
              },
            ]),
            contained('Changes.roundsWaiting', () => []),
          ),
        )
        return waiting.flat()
      })

      /** A round that waited for a place, asked of its lead now it has one; nothing where it no longer waits, as one the person stopped. */
      const askWaiting = (id: string) =>
        Effect.gen(function* () {
          const round = yield* roundOf({ id })
          if (round === undefined || round.state !== 'resolving' || round.waiting === null) return
          const waited = yield* decodeWaiting(round.waiting)
          yield* askLead(round, waited.attempt, waited.body, waited.why)
        })

      /** Changes a round's record, with its fact. */
      const reviseRound = (
        round: { readonly id: string; readonly projectId: ProjectId; readonly taskId: string },
        type: string,
        set: Readonly<Record<string, unknown>>,
        payload: Readonly<Record<string, unknown>> = {},
      ) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          yield* sql.withTransaction(
            Effect.gen(function* () {
              const revision = yield* change('conflict_resolutions', round.id, { ...set, updatedAt: yield* timestamp })
              yield* fact({
                projectId: round.projectId,
                aggregateType: 'conflict_resolution',
                aggregateId: round.id,
                revision,
                type,
                payload,
                actorId: instance.systemId,
              })
            }),
          )
          yield* touchCard(round.taskId)
        })

      /** A round over: resolved, with where its branches are, and what the thread says of it. */
      const endRound = (
        round: RoundRow,
        ended: Ended | null,
        notice: { readonly severity?: 'info' | 'warning'; readonly title: string; readonly description: string } | null,
        payload: Readonly<Record<string, unknown>> = {},
      ) =>
        Effect.gen(function* () {
          yield* reviseRound(
            round,
            'conflict_resolution.resolved',
            { state: 'resolved', ...(ended === null ? {} : { ended: JSON.stringify(ended) }), settledAt: yield* timestamp },
            payload,
          )
          if (notice !== null)
            yield* addItem({ projectId: round.projectId, threadId: round.threadId }, 'notice', {
              source: 'runtime',
              severity: notice.severity ?? 'info',
              title: notice.title,
              description: notice.description,
            })
        })

      /**
       * Looks at a round once the lead's turn on it is over. Resolving the
       * conflict, it is resolved or not; fixing the checks that failed on what
       * Althar pushed, a fix is committed on top of it or not. Done, it goes
       * on (`resolved`, `fixed`), unless its lead was stopped, when it waits
       * for the person; not, the lead is asked once more with why, unless it
       * was stopped or has been asked enough, and then it is the person's.
       */
      const settleRound = (
        id: string,
        how: { readonly why?: string; readonly stopped?: boolean } = {},
      ): Effect.Effect<void, unknown, Store> =>
        Effect.gen(function* () {
          const round = yield* roundOf({ id })
          if (round === undefined || round.state !== 'resolving') return
          const conflicts = yield* decodeConflicts(round.conflicts)
          const worktrees = yield* worktreesOf(round.taskId)
          const several = conflicts.length > 1
          const failures: Array<string> = []
          // Where all that is left is to commit the merge.
          const uncommitted: Array<Conflict> = []
          for (const conflict of conflicts) {
            const worktree = worktrees.get(conflict.repository)
            // Git failing in one repository is why that one isn't resolved: the round is still settled.
            const left =
              worktree === undefined || !existsSync(worktree)
                ? { why: 'Its worktree is gone.', uncommitted: false }
                : yield* unresolved(worktree, conflict).pipe(
                    contained('Changes.settleRound', (cause) => ({
                      why: `Althar couldn’t read its worktree: ${gitSaid(cause)}`,
                      uncommitted: false,
                    })),
                  )
            if (left === null) continue
            failures.push(several ? `${conflict.name}: ${left.why}` : left.why)
            if (left.uncommitted) uncommitted.push(conflict)
          }
          const ended = yield* endedOf(round.taskId, conflicts)
          // Asked to fix the checks on what Althar pushed: what it pushed is where a fix goes on top.
          const fixing = round.pushedHead
          if (fixing !== null && failures.length === 0 && ended.every((one) => one.head === fixing))
            failures.push('Nothing was committed to fix them.')
          const place = yield* placeOf(round.taskId, round.url)
          const thread = { projectId: round.projectId, threadId: round.threadId }
          if (failures.length === 0) {
            // Its lead stopped, what it did is the person's to look at: nothing is pushed for it.
            if (how.stopped === true && round.url !== null)
              return yield* endRound(round, ended, {
                title:
                  fixing === null
                    ? `The lead resolved the conflict with ${whereLine(conflicts)}.`
                    : 'The lead fixed the checks on the merge.',
                description: `The lead was stopped, so it waits for you to look at it and push it to ${changeOf(place)}.`,
              })
            return yield* fixing === null ? resolved(round, conflicts, ended, place) : fixed(round, fixing, ended, place)
          }
          const failure = [...(how.why === undefined ? [] : [how.why]), ...failures].join(' ')
          const what = fixing === null ? `the conflict with ${whereLine(conflicts)}` : `the checks on the merge`
          // A fix for the checks is the lead's one more try already: only resolving the conflict is asked again.
          if (fixing === null && how.why === undefined && round.attempt < ATTEMPTS) {
            yield* addItem(thread, 'notice', {
              source: 'runtime',
              severity: 'info',
              title: `The conflict with ${whereLine(conflicts)} isn’t resolved yet: ${failure}`,
              description: 'Althar asked the lead once more.',
            })
            // Asked to commit it where that is all that was left, not to resolve it again.
            const note = noteFor(conflicts, place, failure, uncommitted.length === failures.length ? uncommitted : [])
            return yield* askLead(round, round.attempt + 1, note, { failure })
          }
          yield* reviseRound(
            round,
            'conflict_resolution.failed',
            { state: 'failed', failure, ended: JSON.stringify(ended), settledAt: yield* timestamp },
            { failure },
          )
          yield* addItem(thread, 'notice', {
            source: 'runtime',
            severity: 'warning',
            title: `The lead couldn’t ${fixing === null ? 'resolve' : 'fix'} ${what}.`,
            description: `${failure} It’s yours to settle, or to ask the lead again.`,
          })
        })

      /**
       * Pushes what a round has, up to `head`, to its pull request: then the
       * round waits for the checks on it. Where it can't, the round is over,
       * and the person pushes it from the card.
       */
      const pushRound = (
        round: RoundRow,
        url: string,
        head: string,
        ended: Ended,
        said: string,
        what: 'the merge' | 'the merge and its fix' | 'the fix',
        place: Place,
      ) =>
        Effect.gen(function* () {
          const pushed = yield* Effect.exit(push(round.taskId, head, url))
          if (pushed._tag === 'Failure') {
            // In the words the task's Push card would have for it.
            const failed = Option.getOrUndefined(Cause.findErrorOption(pushed.cause))
            const why = failed === undefined ? 'The push failed.' : words(failed, (agentId) => agentId).message
            return yield* endRound(round, ended, {
              severity: 'warning',
              title: `${said}, but Althar couldn’t push ${what}.`,
              description: `${why} Push it from ${changeOf(place)}’s card.`,
            })
          }
          const headSha = pushed.value.change.headSha
          yield* reviseRound(
            round,
            'conflict_resolution.pushed',
            { state: 'checking', pushedHead: headSha, ended: JSON.stringify(ended) },
            { head: headSha },
          )
          yield* addItem({ projectId: round.projectId, threadId: round.threadId }, 'notice', {
            source: 'runtime',
            severity: 'info',
            title: `${said}, and Althar pushed ${what} to ${changeOf(place)}.`,
            description: 'Althar waits for its checks.',
          })
        })

      /** Where a round on a pull request left its one repository's branch here: its worktree, and the commit it is at; none where it is gone. */
      const branchHere = (taskId: string, ended: Ended) =>
        Effect.gen(function* () {
          const worktrees = yield* worktreesOf(taskId)
          const [here] = ended.flatMap((one) => {
            const worktree = worktrees.get(one.repository)
            return worktree === undefined ? [] : [{ worktree, head: one.head }]
          })
          return here
        })

      /**
       * A conflict resolved. Merging here, the person merges again. On a pull
       * request, Althar pushes the merge itself: the one push of a lead's
       * commits that isn't the person's (ADR-030). Only where the pull request
       * had the branch as it was when the lead was asked, the commits since are
       * the merge alone, up to the head it settled at, and nothing else asked
       * the lead meanwhile; otherwise the merge waits for the person to push
       * it with the rest.
       */
      const resolved = (round: RoundRow, conflicts: ReadonlyArray<Conflict>, ended: Ended, place: Place) =>
        Effect.gen(function* () {
          const said = `The lead resolved the conflict with ${whereLine(conflicts)}`
          const [conflict] = conflicts
          const branch = yield* branchHere(round.taskId, ended)
          if (round.url === null || conflict === undefined || branch === undefined)
            return yield* endRound(round, ended, { title: `${said}.`, description: 'Merge it again.' })
          const { worktree, head } = branch
          const others = yield* askedSince(round)
          const made =
            !others && conflict.pushed != null && conflict.pushed === conflict.from
              ? yield* onlyTheResolution(worktree, conflict, head).pipe(Effect.orElseSucceed(() => null))
              : null
          const alone = made !== null && (yield* commitOf(worktree, 'HEAD').pipe(Effect.orElseSucceed(() => ''))) === head
          if (!alone)
            return yield* endRound(round, ended, {
              title: `${said}.`,
              description: others
                ? `The lead was asked something else meanwhile, so the merge waits for you to look at it and push it to ${changeOf(place)}.`
                : `Its branch has commits besides the merge that ${changeOf(place)} doesn’t have yet, so the merge waits for you to push it with them.`,
            })
          yield* pushRound(round, round.url, head, ended, said, made === 'merge and fix' ? 'the merge and its fix' : 'the merge', place)
        })

      /**
       * The checks that failed on what Althar pushed, fixed: pushed in turn,
       * where the branch has one commit on top of it, the fix, and nothing
       * else asked the lead meanwhile; otherwise the round is over, and the
       * fix waits for the person's push, as any does.
       */
      const fixed = (round: RoundRow, base: string, ended: Ended, place: Place) =>
        Effect.gen(function* () {
          const said = 'The lead fixed the checks on the merge'
          const branch = yield* branchHere(round.taskId, ended)
          const others = yield* askedSince(round)
          const fixes =
            !others &&
            branch !== undefined &&
            (yield* onlyTheFix(branch.worktree, base, branch.head).pipe(Effect.orElseSucceed(() => false)))
          if (!fixes || branch === undefined || round.url === null)
            return yield* endRound(round, ended, {
              title: `${said}.`,
              description: others
                ? `The lead was asked something else meanwhile, so the fix waits for you to look at it and push it to ${changeOf(place)}.`
                : `Its branch has commits besides the fix that ${changeOf(place)} doesn’t have yet, so the fix waits for you to push it with them.`,
            })
          yield* pushRound(round, round.url, branch.head, ended, said, 'the fix', place)
        })

      /**
       * Where a pull request's target branch is, fetched into the task's
       * workspace at most every few turns, unless `fresh`: the worktrees of a
       * repository share what one fetched. Null where it couldn't be fetched.
       */
      const baseOf = (
        workspace: { readonly path: string; readonly binding: string },
        host: CodeHost,
        repository: Repository,
        branch: string,
        ref: string,
        fresh: boolean,
      ) =>
        Effect.gen(function* () {
          const key = `${workspace.binding}:${ref}`
          const at = yield* Clock.currentTimeMillis
          const known = fetchedAt.get(key)
          if (!fresh && known !== undefined && at - known.at < baseEvery) return known.tip
          const tip = yield* fetchInto(workspace.path, yield* host.pushTarget(repository), branch, `refs/remotes/${ref}`)
          if (tip !== null) fetchedAt.set(key, { at, tip })
          return tip
        })

      /**
       * Whether an open pull request conflicts with the branch it goes into,
       * worked out here rather than taken from its host, which works it out
       * lazily, says nothing until it has, and needn't say again when only
       * that branch moved: the branch is fetched, at most every few turns
       * unless `fresh` or the host says it conflicts, and merged with the
       * task's branch here without anything moving. Where it conflicts and
       * the lead is to resolve it, the lead is asked; where not, why not is
       * logged and kept for its card. One that merges cleanly here is from
       * before the branch moved, or merged here already and waiting for the
       * person to push.
       */
      const lookAt = (
        link: LinkRow,
        seen: Snapshot,
        now: { readonly target: string; readonly conflicts?: boolean | null | undefined; readonly headSha: string | null },
        host: CodeHost,
        repository: Repository,
        how: { readonly force: boolean; readonly fresh: boolean },
      ) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const first = yield* askable(link.taskId, seen.url, { force: how.force })
          if (first === 'off') return pressed.has(link.taskId) ? undefined : yield* forgetUnsent(link.taskId)
          if (first === 'resolving') return
          const says = now.conflicts === true
          // Where it can't be looked at here, that is said whatever its host says: a host saying it merges cleanly may be out of date.
          const couldnt = (why: string) => notSent(link.taskId, why, true, says)
          const [workspace] = yield* sql<{ path: string; binding: string; slug: string; name: string; threadId: string }>`
            SELECT w.path, b.id AS binding, b.slug, b.display_name AS name, t.id AS thread_id FROM workspaces w
            JOIN repository_bindings b ON b.id = w.binding_id JOIN threads t ON t.task_id = w.task_id AND t.kind = 'task'
            WHERE w.task_id = ${link.taskId} AND w.device_id = ${instance.deviceId} AND w.access = 'write' AND w.state <> 'cleaned'
            ORDER BY w.id = (SELECT c.workspace_id FROM repository_changes c WHERE c.pull_request_url = ${seen.url} LIMIT 1) DESC,
              b.created_at, b.rowid
            LIMIT 1`
          // Without its folder here, nothing can be merged: the card says why nothing happens.
          if (workspace === undefined)
            return yield* couldnt(`Its folder isn’t on this computer, so Althar can’t merge ${now.target} into it here.`)
          // Into the repository a fork came from, its branch is upstream's; otherwise origin's, as `git fetch` names them.
          const fork = yield* namedRemotes(workspace.path).pipe(
            Effect.map(forkOf),
            Effect.orElseSucceed(() => null),
          )
          const remote =
            fork !== null && repository.path.join('/').toLowerCase() === fork.upstream.path.join('/').toLowerCase() ? 'upstream' : 'origin'
          const ref = `${remote}/${now.target}`
          const target = yield* baseOf(workspace, host, repository, now.target, ref, how.fresh || says)
          const from = yield* commitOf(workspace.path, 'HEAD').pipe(Effect.orElseSucceed(() => null))
          if (target === null || from === null)
            return yield* couldnt(
              target === null
                ? `Althar couldn’t fetch ${now.target} to merge it with the branch here.`
                : 'Althar couldn’t read the branch here.',
            )
          const merged = yield* gitOutcome(workspace.path, 'merge-tree', '--write-tree', '--name-only', '--no-messages', target, from)
          if (merged.code === 0) return yield* forgetUnsent(link.taskId)
          // 1 is git's word for a merge that conflicts; anything else, one it couldn't work out.
          if (merged.code !== 1) return yield* couldnt(`Git couldn’t merge ${now.target} with the branch here.`)
          if (!(yield* sayingWhy(link.taskId, yield* askable(link.taskId, seen.url, { force: how.force, targets: [target] })))) return
          const [sent] = yield* sql<{ head: string | null }>`
            SELECT head_commit AS head FROM repository_changes WHERE pull_request_url = ${seen.url} AND project_id = ${link.projectId} LIMIT 1`
          yield* beginRound({ projectId: link.projectId, taskId: link.taskId, threadId: workspace.threadId }, seen.url, [
            {
              repository: workspace.slug,
              name: workspace.name,
              branch: now.target,
              ref,
              target,
              from,
              pushed: now.headSha ?? sent?.head ?? null,
              files: merged.stdout
                .split('\n')
                .slice(1)
                .filter((line) => line !== ''),
            },
          ])
        })

      /**
       * What the pull request's checks say of what Althar pushed for a round.
       * Passed, or none once they have had time to start, the round is
       * resolved. Failed, the lead is asked to fix them within the round,
       * rather than as failed checks always reach it, and its fix is pushed
       * in turn; once it has been asked enough, the round is the person's.
       * The pull request settled, or moved on past what Althar pushed, ends
       * the round, and what comes after is as ever. Whether the round took
       * the failure, so it isn't told the lead twice.
       */
      const checked = (link: LinkRow, url: string, now: ChangeRequest, host: CodeHost, repository: Repository) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [waiting] = yield* sql<{ id: string }>`
            SELECT id FROM conflict_resolutions WHERE task_id = ${link.taskId} AND pull_request_url = ${url} AND state = 'checking' LIMIT 1`
          const round = waiting === undefined ? undefined : yield* roundOf({ id: waiting.id })
          if (round === undefined || round.pushedHead === null) return false
          const pushedHead = round.pushedHead
          const conflicts = yield* decodeConflicts(round.conflicts)
          const worktrees = yield* worktreesOf(round.taskId)
          const worktree = conflicts.map((conflict) => worktrees.get(conflict.repository)).find((path) => path !== undefined)
          if (now.state !== 'open' || now.headSha === null) return yield* Effect.as(endRound(round, null, null), false)
          if (now.headSha !== pushedHead) {
            // The host may not have read the push yet: what it had before is behind what was pushed.
            const behind =
              worktree !== undefined && (yield* gitOutcome(worktree, 'merge-base', '--is-ancestor', now.headSha, pushedHead)).code === 0
            return behind ? false : yield* Effect.as(endRound(round, null, null), false)
          }
          const place = yield* placeOf(round.taskId, url)
          const where = changeOf(place)
          const all = yield* host.checks(repository, now.headSha)
          const sum = checksOf(now.headSha, all)
          if (sum.outcome === 'running') return false
          if (sum.outcome === 'none') {
            const since = (yield* Clock.currentTimeMillis) - Date.parse(round.updatedAt)
            if (since < Duration.toMillis(NO_CHECKS_AFTER)) return false
            return yield* Effect.as(
              endRound(round, null, { title: `No checks ran on what Althar pushed to ${where}.`, description: 'It’s ready to merge.' }),
              false,
            )
          }
          if (sum.outcome === 'passed')
            return yield* Effect.as(
              endRound(round, null, { title: `The checks passed on what Althar pushed to ${where}.`, description: 'It’s ready to merge.' }),
              false,
            )
          // Failed. The lead committed something else since: the fix goes with it, for the person to push, as failed checks always do.
          const head = worktree === undefined ? '' : yield* commitOf(worktree, 'HEAD').pipe(Effect.orElseSucceed(() => ''))
          if (head !== pushedHead) return yield* Effect.as(endRound(round, null, null, { failing: sum.failing }), false)
          const ended = yield* endedOf(round.taskId, conflicts)
          const thread = { projectId: round.projectId, threadId: round.threadId }
          if (round.attempt >= ATTEMPTS) {
            const failure = `The checks failed on it: ${sum.failing.join(', ')}.`
            yield* reviseRound(
              round,
              'conflict_resolution.failed',
              { state: 'failed', failure, ended: JSON.stringify(ended), settledAt: yield* timestamp },
              { failure },
            )
            yield* addItem(thread, 'notice', {
              source: 'runtime',
              severity: 'warning',
              title: `The checks failed on what Althar pushed to ${where}: ${sum.failing.join(', ')}.`,
              description: 'The lead had its one more try. It’s yours to settle, or to ask the lead again.',
            })
            return true
          }
          // A task stopped or settled meanwhile isn't its lead's to go on with: the failure goes as failed checks always do.
          const [task] = yield* sql<{ state: string; run: string | null }>`
            SELECT k.state, (SELECT state FROM runs WHERE task_id = k.id ORDER BY created_at DESC, rowid DESC LIMIT 1) AS run
            FROM tasks k WHERE k.id = ${round.taskId}`
          if (task?.state !== 'open' || task.run !== 'succeeded')
            return yield* Effect.as(endRound(round, null, null, { failing: sum.failing }), false)
          const logs = yield* Effect.forEach(all.filter((candidate) => candidate.state === 'failed').slice(0, LOGS_TO_LEAD), (check) =>
            Effect.map(readLog(host, repository, check), logForLead),
          )
          // The lead takes a place among the agents at work on this machine to fix them, or the round keeps its ask and waits for one.
          const body = fixNoteFor(place, { failing: sum.failing, logs })
          const why = { failing: sum.failing }
          const room = yield* busy.enter(
            round.taskId,
            (room) =>
              Effect.gen(function* () {
                const since = yield* timestamp
                const waiting = room
                  ? {}
                  : { waiting: JSON.stringify({ attempt: round.attempt + 1, body, why, since } satisfies RoundWaiting) }
                yield* reviseRound(round, 'conflict_resolution.checks_failed', { state: 'resolving', ...waiting }, why)
                return room
              }),
            // Checks to fix: the work of a task under way.
            { order: 'underway' },
          )
          yield* addItem(thread, 'notice', {
            source: 'runtime',
            severity: 'info',
            title: `The checks failed on what Althar pushed to ${where}: ${sum.failing.join(', ')}.`,
            description: room
              ? 'Althar asked the lead to fix them.'
              : 'Althar asks the lead to fix them once an agent is free on this computer.',
          })
          if (room) yield* askLead(round, round.attempt + 1, body, why)
          return true
        })

      /**
       * A round on a pull request Althar no longer listens to: the person's,
       * since nothing it does there is heard. Resolving, what the lead does
       * waits for them; waiting for checks, the checks do.
       */
      const unfollowed = (id: string) =>
        Effect.gen(function* () {
          const round = yield* roundOf({ id })
          if (round === undefined || (round.state !== 'resolving' && round.state !== 'checking')) return
          const where = changeOf(yield* placeOf(round.taskId, round.url))
          const description = `Althar no longer listens to ${where}, so it doesn’t push for the lead there or hear the checks: that’s yours.`
          if (round.state === 'checking')
            return yield* endRound(round, null, {
              title: `Althar no longer follows the checks on what it pushed to ${where}.`,
              description,
            })
          const conflicts = yield* decodeConflicts(round.conflicts)
          const failure = `Althar stopped listening to ${where}.`
          yield* reviseRound(
            round,
            'conflict_resolution.failed',
            { state: 'failed', failure, ended: JSON.stringify(yield* endedOf(round.taskId, conflicts)), settledAt: yield* timestamp },
            { failure },
          )
          yield* addItem({ projectId: round.projectId, threadId: round.threadId }, 'notice', {
            source: 'runtime',
            severity: 'info',
            title: `Althar no longer follows the conflict on ${where}.`,
            description,
          })
        })

      /**
       * The person took the task's change into their own hands: they stopped
       * its lead, or pushed to it. It is no longer in Althar's (ADR-040): each
       * of its pull requests says so, for `handsOf` to read.
       */
      const taken = (taskId: string, how: 'stopped' | 'interrupted' | 'pushed' | 'stuck' | 'unreadable') =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const at = yield* timestamp
          for (const link of yield* sql<{ id: string; projectId: string }>`
            SELECT id, project_id FROM external_links WHERE task_id = ${taskId} AND kind = 'change'`)
            yield* sql`INSERT OR IGNORE INTO observations ${sql.insert({
              id: yield* newId(Ids.observation),
              projectId: link.projectId,
              subjectType: 'external_link',
              subjectId: link.id,
              kind: 'taken',
              payload: JSON.stringify({ id: `taken:${at}`, how }),
              source: 'althar',
              observedAt: at,
            })}`
        })

      /** The person stopped or interrupted a task's lead: what it was resolving waits for them, and checks that fail don't ask it again. */
      const leadStopped = (taskId: string, how: 'stopped' | 'interrupted') =>
        Effect.gen(function* () {
          yield* taken(taskId, how)
          for (const round of yield* underWay(taskId)) {
            if (round.state === 'resolving') {
              yield* settleRound(round.id, { why: `You ${how} the lead.`, stopped: true })
              continue
            }
            const place = changeOf(yield* placeOf(round.taskId, round.url))
            yield* endRound(round, null, {
              title: `You ${how} the lead, so the checks on what Althar pushed to ${place} are yours.`,
              description: 'Althar won’t ask the lead to fix them.',
            })
          }
        })

      /*
       * Rounds waiting for a lead that ended its turn but is still at work,
       * by id: so one is waited for once, though its thread says more meanwhile.
       */
      const holding = new Set<string>()
      const busyUpTo = (yield* RuntimeConfig).idle?.within ?? BUSY_UP_TO
      const reportsWithin = (yield* RuntimeConfig).idle?.reports ?? REPORT_FOR

      /**
       * When the lead's turn ends on a round, or its session goes, the round
       * is looked at: not while more waits for it on the thread, which comes
       * in the next turn, nor while it asks the person something. A turn the
       * person interrupted is theirs to carry on. Nor while the lead is still
       * at work: it left a command running, such as the full tests, and is
       * woken when it ends, or is in a turn of its own after (`Sessions.busy`).
       * The round is looked at once it is done, or after BUSY_UP_TO, as it
       * is: a lead that doesn't finish isn't waited for for ever.
       */
      const look = (event: LiveEvent, waited: boolean): Effect.Effect<void, unknown, Store> =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          if (event._tag !== 'TurnEnded' && event._tag !== 'SessionEnded') return
          if (event._tag === 'TurnEnded' && (event.state === 'interrupted' || event.errorClass === 'usage_limit')) return
          if (event._tag === 'SessionEnded' && event.state === 'superseded') return
          const round = yield* roundOf({ threadId: event.threadId })
          if (round === undefined) return
          const running = yield* sessions.running(event.threadId)
          if (event._tag === 'SessionEnded' && Option.isSome(running)) return
          if (event._tag === 'TurnEnded') {
            const [queued] = yield* sql<{ id: string }>`
              SELECT id FROM user_inputs WHERE thread_id = ${event.threadId} AND state = 'queued' LIMIT 1`
            if (queued !== undefined) return
            // A turn of a session another agent has taken over from is that session's last.
            const [turn] = yield* sql<{ sessionId: string | null }>`
              SELECT provider_session_id AS session_id FROM turn_deliveries WHERE id = ${event.turnId}`
            if (Option.isSome(running) && turn?.sessionId != null && running.value.sessionId !== turn.sessionId) return
          }
          const [asking] = yield* sql<{ id: string }>`
            SELECT id FROM attention_requests WHERE task_id = ${round.taskId} AND kind = 'question' AND state = 'open' LIMIT 1`
          if (asking !== undefined) return
          // Not at once: a lead may report what it left running just after its turn (`REPORT_FOR`).
          if (event._tag === 'TurnEnded' && !waited) return yield* hold(round.id, event)
          // Stopped by the person, it is theirs: it isn't started again to try once more.
          const stopped = event._tag === 'SessionEnded' && event.state === 'completed'
          yield* locked(round.taskId)(
            settleRound(round.id, stopped ? { why: 'The lead was stopped before it resolved it.', stopped: true } : {}),
          )
        })

      /**
       * A round an earlier launch left with its lead at work. Resolved by
       * then, it is settled so; still conflicting, its lead is asked again
       * once it has a place, rather than the round handed to the person for
       * Althar's own stop. One fixing the checks on what Althar pushed, or
       * whose worktree is gone, is settled as it stands.
       */
      const resumeRound = (id: string) =>
        Effect.gen(function* () {
          const round = yield* roundOf({ id })
          if (round === undefined || round.state !== 'resolving') return
          const stopped = STOPPED_MIDWAY
          if (round.pushedHead !== null) return yield* settleRound(id, { why: stopped })
          const conflicts = yield* decodeConflicts(round.conflicts)
          const worktrees = yield* worktreesOf(round.taskId)
          const left = yield* Effect.forEach(conflicts, (conflict) => {
            const worktree = worktrees.get(conflict.repository)
            return worktree === undefined || !existsSync(worktree)
              ? Effect.succeed('gone' as const)
              : unresolved(worktree, conflict).pipe(Effect.orElseSucceed(() => 'gone' as const))
          })
          if (left.includes('gone')) return yield* settleRound(id, { why: stopped })
          if (left.every((one) => one === null)) return yield* settleRound(id)
          const place = yield* placeOf(round.taskId, round.url)
          const waiting: RoundWaiting = {
            attempt: round.attempt,
            body: noteFor(conflicts, place, null),
            why: { restarted: true },
            since: yield* timestamp,
          }
          yield* reviseRound(round, 'conflict_resolution.waiting', { waiting: JSON.stringify(waiting) }, { restarted: true })
          yield* addItem({ projectId: round.projectId, threadId: round.threadId }, 'notice', {
            source: 'runtime',
            severity: 'info',
            title: `Althar stopped while the lead was resolving the conflict with ${whereLine(conflicts)}.`,
            description: 'Althar asks the lead again once an agent is free on this computer.',
          })
        })

      /**
       * Waits for the lead to be done, apart from the stream of events so
       * that the rounds of other tasks aren't held up, then looks at the
       * round as its turn ending would have: what the thread holds by then
       * is what counts. Its session going meanwhile is looked at when it is.
       */
      const hold = (id: string, event: LiveEvent & { readonly _tag: 'TurnEnded' }) => {
        if (holding.has(id)) return Effect.void
        holding.add(id)
        return Effect.forkIn(
          Effect.sleep(reportsWithin).pipe(
            Effect.andThen(sessions.untilIdle(event.threadId, busyUpTo)),
            Effect.flatMap((done) => (done === 'gone' ? Effect.void : look(event, true))),
            Effect.catchCause((cause) => Effect.logWarning('Could not look at a conflict after the lead was done', cause)),
            Effect.ensuring(Effect.sync(() => holding.delete(id))),
            provide,
          ),
          scope,
        )
      }

      /**
       * The failing checks on a task's open pull requests its lead was told
       * to see through (ADR-068) and did nothing with that shows: no fix
       * pushed or asked to be, no rerun since, no line for the person. Not
       * where the person spoke since, when they are at it together.
       */
      const unsettledChecks = (taskId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const left: Array<{
            readonly link: LinkRow
            readonly snapshot: Snapshot
            readonly told: { readonly at: string; readonly id: string }
          }> = []
          for (const link of yield* linksOf(taskId)) {
            if (link.listening !== 1) continue
            const fixing = yield* fixingOn(link)
            if (fixing === null || !fixing.open || !fixing.failing || fixing.running || fixing.spoken) continue
            const snapshot = yield* decodeSnapshot(link.snapshot)
            if (snapshot.headSha === null) continue
            const told = yield* toldOf(link, snapshot.headSha)
            if (told === undefined) continue
            const [reran] = yield* sql<{ one: number }>`
              SELECT 1 AS one FROM observations WHERE subject_type = 'external_link' AND subject_id = ${link.id}
                AND kind = 'checks_rerun' AND json_extract(payload, '$.sha') = ${snapshot.headSha} AND observed_at >= ${told.at} LIMIT 1`
            if (reran !== undefined || (yield* askedOf(taskId, snapshot.url)).length > 0) continue
            left.push({ link, snapshot, told })
          }
          return left
        })

      /*
       * Tasks whose failing checks wait for a lead that ended its turn but is
       * still at work, by thread: so they are waited for once.
       */
      const holdingChecks = new Set<string>()

      /**
       * When the lead's turn ends with the checks it was to see through still
       * failing and nothing done with them (`unsettledChecks`), once it is
       * done, as a conflict round's lead is waited for (`look`): not while
       * more waits for it on the thread, nor while it asks the person
       * something, nor where the person interrupted it. It is asked once to
       * fix them, run them again or say why they are the person's; ending so
       * again, they are the person's, and the card says so, never only that
       * they fail. Its agent going on its own meanwhile, before or after its
       * turn ended, is looked at at once, the same: it is started again to
       * be asked, once. One the person stopped was theirs to stop (`taken`),
       * and one another agent took over from carries on in that one.
       */
      const lookAtChecks = (event: LiveEvent, waited: boolean): Effect.Effect<void, unknown, Store> =>
        Effect.gen(function* () {
          const gone = event._tag === 'SessionEnded' && event.state === 'lost'
          if (!gone && (event._tag !== 'TurnEnded' || event.state === 'interrupted' || event.errorClass === 'usage_limit')) return
          // Started again already, it is that session's turn ending that counts.
          if (gone && Option.isSome(yield* sessions.running(event.threadId))) return
          const sql = yield* SqlClient.SqlClient
          const [thread] = yield* sql<{ taskId: string }>`
            SELECT t.task_id FROM threads t JOIN tasks k ON k.id = t.task_id WHERE t.id = ${event.threadId} AND t.kind = 'task'
              AND k.state = 'open'`
          if (thread === undefined) return
          const taskId = thread.taskId
          // What waits on the thread comes in its next turn; with its agent gone, there is none until it is started again.
          const [queued] = yield* sql<{ id: string }>`
            SELECT id FROM user_inputs WHERE thread_id = ${event.threadId} AND state = 'queued' LIMIT 1`
          if (queued !== undefined && !gone) return
          const [asking] = yield* sql<{ id: string }>`
            SELECT id FROM attention_requests WHERE task_id = ${taskId} AND kind = 'question' AND state = 'open' LIMIT 1`
          if (asking !== undefined || (yield* roundUnderWay(taskId))) return
          if ((yield* unsettledChecks(taskId)).length === 0) return
          // Not at once: a lead may say what it did just after its turn, and one at work still is waited for. Its agent going
          // meanwhile is looked at as it goes.
          if (!waited && !gone) {
            if (holdingChecks.has(event.threadId)) return
            holdingChecks.add(event.threadId)
            return yield* Effect.forkIn(
              Effect.sleep(reportsWithin).pipe(
                Effect.andThen(sessions.untilIdle(event.threadId, busyUpTo)),
                Effect.ensuring(Effect.sync(() => holdingChecks.delete(event.threadId))),
                Effect.flatMap((done) => (done === 'gone' ? Effect.void : lookAtChecks(event, true))),
                Effect.catchCause((cause) => Effect.logWarning('Could not look at the checks after the lead was done', cause)),
                provide,
              ),
              scope,
            )
          }
          yield* locked(taskId)(
            Effect.gen(function* () {
              for (const { link, snapshot, told } of yield* unsettledChecks(taskId)) {
                const failing = snapshot.checks?.failing ?? []
                // Asked once for each time it was told, it is asked to finish, started again where its agent went; asked, and
                // ending so again, or not started again, they are the person's.
                if (yield* heard(link, 'checks_nudged', `nudged:${told.id}`, { sha: snapshot.headSha })) {
                  const name = nameOf(snapshot)
                  const asked = yield* tellLead(
                    link,
                    [gone ? checksGoneForLead(name, failing) : checksUnsettledForLead(name, failing)],
                    true,
                  ).pipe(
                    Effect.as(true),
                    Effect.catchCause((cause) =>
                      Effect.as(Effect.logWarning('Could not start the lead again to see its checks through', cause), false),
                    ),
                  )
                  if (asked) continue
                }
                const why = unsettledLine(failing, gone ? 'gone' : 'ended')
                yield* heard(link, 'checks_handed', `handed:${snapshot.headSha}:${yield* timestamp}`, { sha: snapshot.headSha, why })
                yield* sayOn(link, why)
                yield* touchCard(taskId)
              }
            }),
          )
        })

      const onLive = (event: LiveEvent) =>
        Effect.andThen(
          look(event, false).pipe(
            Effect.catchCause((cause) => Effect.logWarning('Could not look at a conflict the lead was resolving', cause)),
          ),
          lookAtChecks(event, false).pipe(
            Effect.catchCause((cause) => Effect.logWarning('Could not look at the checks the lead was to fix', cause)),
          ),
        )

      yield* Effect.forkScoped(provide(Stream.runForEach(yield* live.subscribe, onLive)))

      // A round an earlier launch left under way has no lead on it now: what the branch holds says how it ended. One that waited
      // for a place to ask its lead still waits, and is asked once it has one.
      yield* Effect.forkScoped(
        provide(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient
            const open = yield* sql<{ id: string; taskId: string }>`
              SELECT id, task_id FROM conflict_resolutions WHERE state = 'resolving' AND waiting IS NULL`
            // Each round on its own: one that can't be settled waits for the next launch, and the rest are settled.
            for (const round of open) yield* locked(round.taskId)(resumeRound(round.id)).pipe(contained('Changes.sweep', () => undefined))
            if (open.length > 0) yield* busy.wake
            // Waiting for checks on a pull request no longer listened to, nothing would end it.
            const unheard = yield* sql<{ id: string; taskId: string }>`
              SELECT c.id, c.task_id FROM conflict_resolutions c WHERE c.state = 'checking' AND NOT EXISTS (
                SELECT 1 FROM external_links l WHERE l.task_id = c.task_id AND l.kind = 'change' AND l.listening = 1
                  AND json_extract(l.snapshot, '$.url') = c.pull_request_url)`
            for (const round of unheard) yield* locked(round.taskId)(unfollowed(round.id)).pipe(contained('Changes.sweep', () => undefined))
          }),
        ).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not look at the conflicts leads were resolving', cause))),
      )

      yield* busy.queue(provide(roundsWaiting))

      /*
       * A settled task's pull request that Althar stopped listening to while
       * it was open, such as an abandoned task's left open, is read once a
       * launch: its card says how it stands on its host now, not how it stood.
       */
      const readSettled = Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const left = yield* sql<LinkRow>`
          SELECT l.id, l.project_id, l.task_id, l.connection_id, l.product, l.snapshot, l.cursor, l.listening FROM external_links l
          JOIN tasks k ON k.id = l.task_id
          WHERE l.kind = 'change' AND l.listening = 0 AND l.connection_id IS NOT NULL AND k.state IN ('done', 'abandoned')
            AND json_extract(l.snapshot, '$.state') = 'open'
            AND l.project_id IN (SELECT id FROM projects WHERE archived_at IS NULL)`
        for (const link of left)
          yield* locked(link.taskId)(
            Effect.gen(function* () {
              const adapters = yield* connections.adapters(link.connectionId ?? '')
              if (adapters.host === undefined) return
              const before = yield* decodeSnapshot(link.snapshot)
              const repository = yield* adapters.host.repository(before.repository)
              yield* seenNow(link, before, yield* adapters.host.change(repository, before.number))
            }),
          ).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not read a settled task’s pull request', cause)))
      }).pipe(
        (effect) => provide(effect),
        Effect.catchCause((cause) => Effect.logWarning('Could not read settled pull requests', cause)),
      )
      yield* Effect.forkScoped(readSettled)

      // What an earlier launch was doing outside when it stopped is uncertain until read back or asked for again.
      yield* provide(reconcileOutward).pipe(
        Effect.catchCause((cause) => Effect.logWarning('Could not reconcile what was being done outside', cause)),
      )

      /* Listening: each listened change is asked about when its time comes, sooner when its task asks, later when its service says to wait. */
      const waitUntil = new Map<string, number>()
      const wake = yield* Queue.sliding<string | null>(16)
      const wakeNow = (taskId: string | null) => void Queue.offerUnsafe(wake, taskId)

      const listenOnce = (only: string | null) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const due = yield* sql<LinkRow>`
            SELECT id, project_id, task_id, connection_id, product, snapshot, cursor, listening FROM external_links
            WHERE kind = 'change' AND listening = 1 AND project_id IN (SELECT id FROM projects WHERE archived_at IS NULL)
              ${only === null ? sql`` : sql`AND task_id = ${only}`}`
          const now = yield* Clock.currentTimeMillis
          for (const link of due) {
            if (only === null) {
              if ((waitUntil.get(link.id) ?? 0) > now) continue
              // A pull request first seen this launch counts as busy until it has been quiet a while.
              if (!newsAt.has(link.taskId)) newsAt.set(link.taskId, now)
              const unknown = unknownFor.get(link.id) ?? 0
              const due = listenDue({ now, polledAt: polledAt.get(link.id), newsAt: newsAt.get(link.taskId) ?? now, every })
              if (!due && (unknown === 0 || unknown > UNKNOWN_TURNS)) continue
            }
            polledAt.set(link.id, now)
            yield* listenTo(link, now)
          }
          // A change no longer listened to, merged, closed, its task or project gone, is forgotten: these would keep one for each forever.
          if (only === null) {
            const links = new Set(due.map((link) => link.id))
            const tasks = new Set(due.map((link) => link.taskId))
            for (const id of polledAt.keys()) if (!links.has(id)) polledAt.delete(id)
            for (const id of waitUntil.keys()) if (!links.has(id)) waitUntil.delete(id)
            for (const id of newsAt.keys()) if (!tasks.has(id)) newsAt.delete(id)
          }
        })

      /** Asks the host about one listened change now; one that can't be asked waits, as long as its service says or a while. */
      const listenTo = (link: LinkRow, now: number, how?: { readonly force: boolean; readonly fresh: boolean }) =>
        locked(link.taskId)(poll(link, how)).pipe(
          Effect.flatMap((happened) => (happened ? news(link.taskId) : Effect.void)),
          Effect.catchCause((cause) =>
            Effect.gen(function* () {
              const error = Option.getOrUndefined(Cause.findErrorOption(cause))
              if (error instanceof ConnectorFailed && error.reason === 'rate_limited' && error.retryAt !== undefined)
                waitUntil.set(link.id, Date.parse(error.retryAt))
              else waitUntil.set(link.id, now + Duration.toMillis(every) * 4)
              if (!(error instanceof ConnectorFailed) || error.reason === 'invalid_response')
                yield* Effect.logWarning('Could not listen to a pull request', cause)
            }),
          ),
        )

      /**
       * A task's conflicts here, looked for where its lead is to resolve them
       * (`askable`): its repositories without a pull request are merged with
       * their default branches here without anything moving, and those that
       * conflict start a round, as pressing Merge would. Where the lead isn't
       * asked, or a branch can't be looked at here, why not is kept for its
       * card.
       */
      const lookHere = (task: { readonly taskId: string; readonly projectId: ProjectId; readonly threadId: string }, force: boolean) =>
        locked(task.taskId)(
          Effect.gen(function* () {
            const first = yield* askable(task.taskId, null, { force })
            if (first === 'off' || first === 'resolving') return
            const found: Array<Conflict> = []
            // Why a branch couldn't be looked at here: no conflict found isn't none there.
            let couldnt: string | null = null
            for (const repository of yield* repositoriesHere(task.taskId)) {
              if (repository.opened !== 0) continue
              const head = yield* commitOf(repository.worktree, 'HEAD').pipe(Effect.orElseSucceed(() => null))
              if (head === null) {
                couldnt ??= existsSync(repository.worktree)
                  ? 'Althar couldn’t read the branch here.'
                  : `Its folder isn’t on this computer, so Althar can’t merge ${repository.base} into it here.`
                continue
              }
              const files = yield* conflictsOf(repository.root, repository.base, head)
              if (files === null) couldnt ??= `Git couldn’t merge ${repository.base} with the branch here.`
              else if (files.length > 0) found.push(yield* conflictHere(repository, files))
            }
            if (found.length === 0) {
              // A task with a pull request too is said of as that is looked at, unless a branch here couldn't be: that, where it says no conflict.
              const listened = (yield* linksOf(task.taskId)).some((link) => link.listening === 1)
              if (couldnt !== null && !(listened && unsent.get(task.taskId)?.checked === true))
                yield* notSent(task.taskId, couldnt, true, false)
              else if (couldnt === null && !listened) yield* forgetUnsent(task.taskId)
              return
            }
            const asked = yield* askable(task.taskId, null, { force, targets: found.map((one) => one.target) })
            if (yield* sayingWhy(task.taskId, asked)) yield* beginRound(task, null, found)
          }),
        )

      /**
       * A task's conflicts, looked for now: here, then on its listened pull
       * requests, asked about now, each merged here with its target fetched
       * again. One round at a time, so a task conflicting both ways starts
       * with what conflicts here.
       */
      const conflictsNow = (task: { readonly taskId: string; readonly projectId: ProjectId; readonly threadId: string }, force: boolean) =>
        Effect.gen(function* () {
          yield* lookHere(task, force)
          const now = yield* Clock.currentTimeMillis
          for (const link of yield* linksOf(task.taskId)) if (link.listening === 1) yield* listenTo(link, now, { force, fresh: true })
        })

      /**
       * The open tasks of the project, of the one task, or of every project
       * not archived: those without a folder here too, whose pull requests
       * are looked at all the same, to say why nothing can be merged here.
       */
      const openHere = (where: { readonly projectId: string } | { readonly taskId: string } | null) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          return yield* sql<{ taskId: string; projectId: ProjectId; threadId: string }>`
            SELECT k.id AS task_id, k.project_id, t.id AS thread_id FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task'
            WHERE k.state = 'open'
              AND ${
                where === null
                  ? sql`k.project_id IN (SELECT id FROM projects WHERE archived_at IS NULL)`
                  : 'taskId' in where
                    ? sql`k.id = ${where.taskId}`
                    : sql`k.project_id = ${where.projectId}`
              }
            ORDER BY k.created_at, k.rowid`
        })

      /** Each open task, of the project or the one task, looked at now for what already conflicts. */
      const resolveNow = (where: { readonly projectId: string } | { readonly taskId: string }, force = false) =>
        Effect.gen(function* () {
          if (force && 'taskId' in where) pressed.add(where.taskId)
          for (const task of yield* openHere(where))
            yield* conflictsNow(task, force && 'taskId' in where).pipe(
              Effect.catchCause((cause) => Effect.logWarning('Could not look for a conflict to resolve', cause)),
            )
        })

      /**
       * Every open task looked at for a conflict with its default branch,
       * every few turns, and once one moves as Althar sees (`baseMoved`):
       * a listened pull request is merged here with its target as last
       * fetched, fetched again where that was a while ago, without asking its
       * host; a branch with none, with its default branch here.
       */
      const sweep = Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const links = yield* sql<LinkRow>`
          SELECT id, project_id, task_id, connection_id, product, snapshot, cursor, listening FROM external_links
          WHERE kind = 'change' AND listening = 1 AND json_extract(snapshot, '$.state') = 'open'
            AND project_id IN (SELECT id FROM projects WHERE archived_at IS NULL)
          ORDER BY created_at`
        for (const link of links)
          yield* locked(link.taskId)(
            Effect.gen(function* () {
              const adapters = yield* connections.adapters(link.connectionId ?? '')
              if (adapters.host === undefined) return
              const before = yield* decodeSnapshot(link.snapshot)
              if (before.target === undefined) return
              const repository = yield* adapters.host.repository(before.repository)
              yield* lookAt(
                link,
                before,
                { target: before.target, conflicts: before.conflicts, headSha: before.headSha },
                adapters.host,
                repository,
                {
                  force: false,
                  fresh: false,
                },
              )
            }),
          ).pipe(contained('Changes.sweep', () => undefined))
        for (const task of yield* openHere(null)) yield* lookHere(task, false).pipe(contained('Changes.sweep', () => undefined))
      })

      /** The task's own say on its lead resolving conflicts, kept with its fact; turned on, as it was not, what conflicts now is resolved. */
      const setResolveConflicts = (input: {
        readonly envelope: CommandEnvelope
        readonly taskId: string
        readonly resolveConflicts: boolean | null
      }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [task] = yield* sql<{ projectId: ProjectId; resolveConflicts: number | null }>`
            SELECT project_id, resolve_conflicts FROM tasks WHERE id = ${input.taskId}`
          if (task === undefined) return yield* new NotFound({ kind: 'task', id: input.taskId })
          const own = input.resolveConflicts === null ? null : input.resolveConflicts ? 1 : 0
          if (own === task.resolveConflicts) return
          const { rules } = yield* (yield* Policies).current(task.projectId)
          yield* sql.withTransaction(
            Effect.gen(function* () {
              const revision = yield* change('tasks', input.taskId, { resolveConflicts: own })
              yield* fact({
                projectId: task.projectId,
                aggregateType: 'task',
                aggregateId: input.taskId,
                revision,
                type: 'task.conflicts_set',
                payload: { resolveConflicts: input.resolveConflicts },
                actorId: input.envelope.actorId,
                commandId: input.envelope.commandId,
              })
            }),
          )
          yield* touchCard(input.taskId)
          if (!resolvesConflictsFor(rules, task.resolveConflicts) && resolvesConflictsFor(rules, own))
            yield* Effect.forkIn(provide(resolveNow({ taskId: input.taskId })), scope)
        })

      yield* Effect.forkScoped(
        provide(
          Effect.forever(
            Effect.gen(function* () {
              const only = yield* Effect.raceFirst(Queue.take(wake), Effect.as(Effect.sleep(every), null))
              // A round that failed is kept to that round: the next one listens again.
              yield* listenOnce(only).pipe(contained('Changes.listen', () => undefined))
            }),
          ),
        ),
      )

      yield* Effect.forkScoped(
        provide(
          Effect.forever(
            Effect.andThen(
              Effect.raceFirst(Queue.take(sweepWake), Effect.as(Effect.sleep(Duration.millis(baseEvery)), false)),
              sweep.pipe(contained('Changes.sweep', () => undefined)),
            ),
          ),
        ),
      )

      /* ---- The lead's tools for its pull request ---- */

      const Replied = Schema.Struct({
        body: Schema.String,
        thread_id: Schema.optional(Schema.NullOr(Schema.String)),
        pull_request: Schema.optional(Schema.NullOr(Schema.Union([Schema.Number, Schema.String]))),
      })

      const PushAsked = Schema.Struct({
        pull_request: Schema.optional(Schema.NullOr(Schema.Union([Schema.Number, Schema.String]))),
      })
      const TagAsked = Schema.Struct({ tag: Schema.String, repository: Schema.optional(Schema.NullOr(Schema.String)) })
      const LogAsked = Schema.Struct({
        check: Schema.String,
        from_line: Schema.optional(Schema.NullOr(Schema.Number)),
        pull_request: Schema.optional(Schema.NullOr(Schema.Union([Schema.Number, Schema.String]))),
      })

      /**
       * A check's whole log on the task's pull request, a page at a time
       * (ADR-041): the lead reads from where it asks, the last page without,
       * and is told where the pages before and after start. Never more than a
       * page into its context at once.
       */
      const readCheckLog = (taskId: string, input: unknown) =>
        Effect.gen(function* () {
          const asked = yield* Schema.decodeUnknownEffect(LogAsked)(input).pipe(
            Effect.mapError((error) => new ToolRefused({ message: `Althar couldn't read that: ${error.message}` })),
          )
          const named = asked.pull_request == null ? null : String(asked.pull_request).trim().toLowerCase()
          const seen = yield* urlsOf(taskId)
          const chosen = named === null ? undefined : seen.find((candidate) => isNamed(candidate, named))
          if (named !== null && chosen === undefined)
            return yield* new ToolRefused({
              message: `This task's pull requests are ${seen.map(shortNameOf).join(', ')}. Name one of those.`,
            })
          const { snapshot, host, repository } = yield* current(taskId, chosen?.url)
          const now = yield* host.change(repository, snapshot.number)
          if (now.headSha === null) return `${nameOf(snapshot)} has no commits, so no checks.`
          const all = yield* host.checks(repository, now.headSha)
          const check = all.find((candidate) => candidate.name.toLowerCase() === asked.check.trim().toLowerCase())
          if (check === undefined)
            return yield* new ToolRefused({
              message: `${nameOf(snapshot)} has no check called "${asked.check}". Its checks: ${all.length === 0 ? 'none' : all.map((one) => one.name).join(', ')}.`,
            })
          const read = yield* readLog(host, repository, check, true)
          // A log its host keeps but wouldn't give is refused, with why; a check it keeps none of is said, with what it reported.
          if (read.log === null)
            return read.kept ? yield* new ToolRefused({ message: logForLead(read) }) : `${nameOf(snapshot)}: ${logForLead(read)}`
          return logPage(read.log, asked.from_line, check.name, nameOf(snapshot))
        })

      /** One of the task's pull requests, as the lead names it, or its only one; refused where the name is none of them. */
      const namedIn = (taskId: string, pullRequest: string | number | null | undefined) =>
        Effect.gen(function* () {
          const named = pullRequest == null ? null : String(pullRequest).trim().toLowerCase()
          const seen = yield* urlsOf(taskId)
          const chosen = named === null ? undefined : seen.find((candidate) => isNamed(candidate, named))
          if (named !== null && chosen === undefined)
            return yield* new ToolRefused({
              message: `This task's pull requests are ${seen.map(shortNameOf).join(', ')}. Name one of those.`,
            })
          return yield* current(taskId, chosen?.url)
        })

      const BaseAsked = Schema.Struct({
        pull_request: Schema.optional(Schema.NullOr(Schema.Union([Schema.Number, Schema.String]))),
      })

      /**
       * The checks on the latest commit of the default branch the task's pull
       * request goes into (ADR-068), with the ends of the failed ones' logs:
       * for the lead to tell a failure of its change's from one that is broken
       * there already.
       */
      const readBaseChecks = (taskId: string, input: unknown) =>
        Effect.gen(function* () {
          const asked = yield* Schema.decodeUnknownEffect(BaseAsked)(input).pipe(
            Effect.mapError((error) => new ToolRefused({ message: `Althar couldn't read that: ${error.message}` })),
          )
          const { snapshot, host, repository } = yield* namedIn(taskId, asked.pull_request)
          const base = repository.defaultBranch
          const workspace = yield* worktreeOf(taskId, snapshot.url)
          const tip = workspace === undefined ? null : yield* remoteTip(workspace.path, yield* host.pushTarget(repository), base)
          if (tip === null) return `Althar couldn't find which commit ${base} is on in ${repository.path.join('/')}.`
          const all = yield* host.checks(repository, tip)
          const reads = yield* Effect.forEach(all.filter((check) => check.state === 'failed').slice(0, LOGS_TO_LEAD), (check) =>
            readLog(host, repository, check),
          )
          return baseChecksForLead(checksOf(tip, all), base, reads.map(logForLead))
        })

      const HandAsked = Schema.Struct({
        why: Schema.String,
        fix: Schema.optional(Schema.NullOr(Schema.String)),
        pull_request: Schema.optional(Schema.NullOr(Schema.Union([Schema.Number, Schema.String]))),
      })

      /**
       * The lead brings the checks that fail on its pull request's head to the
       * person (ADR-068): broken on the default branch, or failing for nothing
       * of the change's, or spent, or for them to decide. Its line is the
       * task's card's, and the thread's; the same failure doesn't go to the
       * lead again, and its card is the person's.
       */
      /** The latest time the lead was told the checks on this commit failed, as its to see through, and where its branch was then. */
      const toldOf = (link: LinkRow, sha: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [told] = yield* sql<{ at: string; id: string; branch: string | null }>`
            SELECT observed_at AS at, json_extract(payload, '$.id') AS id, json_extract(payload, '$.branch') AS branch FROM observations
            WHERE subject_type = 'external_link' AND subject_id = ${link.id} AND kind = 'checks_told'
              AND json_extract(payload, '$.sha') = ${sha}
            ORDER BY observed_at DESC, rowid DESC LIMIT 1`
          return told
        })

      /**
       * Whether the branch had commits the pull request didn't, from `from`,
       * when the lead was told its checks failed: a push of its fix would take
       * them up too, and they are the person's to push. Not known, they are
       * taken to be there.
       */
      const pendingAtFailure = (link: LinkRow, head: string | null, path: string, from: string) =>
        Effect.gen(function* () {
          const told = head === null ? undefined : yield* toldOf(link, head)
          if (told?.branch == null) return true
          return (yield* commitsAhead(path, from, told.branch)) > 0
        }).pipe(Effect.orElseSucceed(() => true))

      const handChecks = (taskId: string, input: unknown) =>
        Effect.gen(function* () {
          const asked = yield* Schema.decodeUnknownEffect(HandAsked)(input).pipe(
            Effect.mapError((error) => new ToolRefused({ message: `Althar couldn't read that: ${error.message}` })),
          )
          // In plain words, as the card and the thread show them: code marks would show as they are.
          const why = asked.why.replaceAll('`', '').trim()
          const fix = asked.fix?.replaceAll('`', '').trim() ?? ''
          if (why === '') return yield* new ToolRefused({ message: 'Say why in why: one short line the person reads on the card.' })
          const { link, snapshot } = yield* namedIn(taskId, asked.pull_request)
          const name = nameOf(snapshot)
          const head = snapshot.headSha
          if (head === null || snapshot.checks?.sha !== head || snapshot.checks.outcome !== 'failed')
            return yield* new ToolRefused({
              message: `The checks on ${name} aren't failing now, so there's nothing to bring to the person.`,
            })
          const said = fix === '' ? why : `${why.replace(/[.!]?$/, '.')} ${fix}`
          yield* heard(link, 'checks_handed', `handed:${head}:${yield* timestamp}`, { sha: head, why: said })
          const sql = yield* SqlClient.SqlClient
          const [thread] = yield* sql<{ id: string }>`SELECT id FROM threads WHERE task_id = ${taskId} AND kind = 'task'`
          if (thread !== undefined)
            yield* addItem({ projectId: link.projectId, threadId: thread.id }, 'notice', {
              source: 'runtime',
              severity: 'warning',
              title: why,
              ...(fix === '' ? {} : { description: fix }),
            })
          yield* touchCard(taskId)
          return `The person sees it on the task's card: "${said}" Leave the branch as it is for these checks: they'll tell you what to do.`
        })

      const RerunAsked = Schema.Struct({
        check: Schema.optional(Schema.NullOr(Schema.String)),
        pull_request: Schema.optional(Schema.NullOr(Schema.Union([Schema.Number, Schema.String]))),
      })

      /**
       * Runs checks on the task's pull request again, as one that may have
       * failed by chance: the one named, or each that failed. Its new outcome
       * is heard as a rerun's is (ADR-041), and the lead told. A check the
       * host can't run again from here, as one another CI service reported, is
       * said so, with its page, where the person can.
       */
      const rerunCheck = (taskId: string, input: unknown) =>
        Effect.gen(function* () {
          const asked = yield* Schema.decodeUnknownEffect(RerunAsked)(input).pipe(
            Effect.mapError((error) => new ToolRefused({ message: `Althar couldn't read that: ${error.message}` })),
          )
          const named = asked.pull_request == null ? null : String(asked.pull_request).trim().toLowerCase()
          const seen = yield* urlsOf(taskId)
          const chosen = named === null ? undefined : seen.find((candidate) => isNamed(candidate, named))
          if (named !== null && chosen === undefined)
            return yield* new ToolRefused({
              message: `This task's pull requests are ${seen.map(shortNameOf).join(', ')}. Name one of those.`,
            })
          const { link, snapshot, host, repository } = yield* current(taskId, chosen?.url)
          const now = yield* host.change(repository, snapshot.number)
          const name = nameOf(snapshot)
          if (now.state !== 'open') return yield* new ToolRefused({ message: `${name} is ${now.state}, so its checks don't run again.` })
          if (now.headSha === null) return `${name} has no commits, so no checks.`
          const sha = now.headSha
          const all = yield* host.checks(repository, sha)
          const wanted = asked.check?.trim().toLowerCase()
          const one = wanted === undefined || wanted === '' ? undefined : all.find((candidate) => candidate.name.toLowerCase() === wanted)
          if (wanted !== undefined && wanted !== '' && one === undefined)
            return yield* new ToolRefused({
              message: `${name} has no check called "${asked.check}". Its checks: ${all.length === 0 ? 'none' : all.map((check) => check.name).join(', ')}.`,
            })
          if (one !== undefined && (one.state === 'queued' || one.state === 'running'))
            return `${one.name} on ${name} is still ${one.state === 'queued' ? 'waiting to run' : 'running'}, so there's nothing to run again yet.`
          const failed = all.filter((check) => check.state === 'failed')
          const targets = one === undefined ? failed : [one]
          if (targets.length === 0)
            return `None of ${name}'s checks failed${all.some((check) => check.state === 'queued' || check.state === 'running') ? ', and some still run' : ''}, so there's nothing to run again. Name one with check to run it again all the same.`
          const tried = yield* Effect.forEach(targets, (check) =>
            host.rerun(repository, check).pipe(
              Effect.map((again) => ({ check, again, refused: null as string | null })),
              Effect.catch((error: ConnectorFailed) => Effect.succeed({ check, again: false, refused: error.message })),
            ),
          )
          const again = tried.filter((one) => one.again).map((one) => one.check.name)
          const elsewhere = tried.filter((one) => !one.again && one.refused === null)
          const refused = tried.filter((one) => one.refused !== null)
          // Heard as a rerun's, so its new outcome is the lead's once it ends, and Althar doesn't run it again by itself.
          if (again.length > 0) {
            yield* leadRanAgain(link, sha)
            yield* sayOn(link, `Running ${again.join(', ')} on ${name} again, as its lead asked.`)
            wakeNow(taskId)
          }
          const hostName = products[link.product].name
          const why =
            link.product === 'github'
              ? 'only a GitHub Actions job runs again from Althar, and it comes from another service'
              : link.product === 'gitlab'
                ? "only a pipeline's job runs again from Althar, and it isn't one"
                : `${hostName}'s checks don't run again from Althar`
          return [
            ...(again.length === 0
              ? []
              : [
                  `Running ${again.join(', ')} on ${name} again. If ${again.length === 1 ? 'it fails' : 'they fail'} again, you'll be told, as for any checks; read_pull_request shows how ${again.length === 1 ? 'it goes' : 'they go'} meanwhile.`,
                ]),
            ...elsewhere.map(
              ({ check }) =>
                `${check.name} can't be run again here: ${why}. ${check.url === null ? 'Ask the person to run it again where it ran.' : `The person can run it again from its page: ${check.url}`}`,
            ),
            ...refused.map(({ check, refused: said }) => `${hostName} refused to run ${check.name} again: ${said}`),
          ].join('\n\n')
        })

      /** Whether the lead names this pull request: by its repository and number, as read_pull_request does (web#3), its whole path, or its number. */
      const isNamed = (candidate: Snapshot, asked: string) =>
        asked === `${candidate.repository.at(-1) ?? ''}${candidate.words.prefix}${candidate.number}`.toLowerCase() ||
        asked === `${candidate.repository.join('/')}${candidate.words.prefix}${candidate.number}`.toLowerCase() ||
        asked === String(candidate.number) ||
        asked === `${candidate.words.prefix}${candidate.number}`

      /**
       * What a push the lead asks for would send to one of the task's pull
       * requests, which it calls `where`; refused, in words it can act on,
       * where the pull request isn't open, the branch has nothing new for it,
       * or a push would need forcing.
       */
      const toPush = (taskId: string, url: string, where: string) =>
        Effect.gen(function* () {
          const { link, snapshot, host, repository } = yield* current(taskId, url)
          // As its host has it now: one merged since Althar last asked has nothing to push to.
          const now = yield* host.change(repository, snapshot.number)
          // Merged or closed, its commits after it go in the task's next pull request, which the person opens (ADR-034).
          if (now.state !== 'open')
            return yield* new ToolRefused({
              message: `${where} is ${now.state}, so there's nothing to push to. What you committed after it goes in a new pull request, which the person opens from the task: if you haven't, call finish_step with your summary, and tell them it's ready.`,
            })
          const workspace = yield* worktreeOf(taskId, snapshot.url)
          if (workspace === undefined || !existsSync(workspace.path))
            return yield* new ToolRefused({
              message: "The task's worktree isn't on this computer, so Althar can't see what is on its branch. Tell the person.",
            })
          // What the pull request has: its branch as the remote says now, else as its host says, else as Althar last pushed it, else as last seen.
          const tip = yield* remoteTip(workspace.path, yield* pushTargetOf(host, repository, workspace.path), now.source)
          const ahead = yield* aheadOf(workspace.path, tip, [now.headSha, yield* sentTo(link.projectId, snapshot.url), snapshot.headSha])
          const left = yield* uncommittedFiles(workspace.path).pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []))
          if (ahead.kind === 'behind')
            return yield* new ToolRefused({
              message: `${where} has commits your branch doesn't: someone pushed to it from elsewhere, so nothing can go up until they're in your branch. Tell the person.`,
            })
          if (ahead.kind === 'unknown')
            return yield* new ToolRefused({
              message: `Althar can't tell which of the branch's commits ${where} has: your worktree has none of the commits it was pushed with. Tell the person.`,
            })
          if (ahead.kind === 'rewritten')
            return yield* new ToolRefused({
              message: `Your branch no longer has ${where}'s head, ${ahead.from.slice(0, 7)}: it was rewritten since the pull request last got commits, so pushing it would need forcing, which isn't done from a task. Put your new commits back on top of ${ahead.from.slice(0, 7)}, then ask again; or tell the person.`,
            })
          if (ahead.count === 0)
            return yield* new ToolRefused({
              message: `${where} already has every commit on the branch, so there's nothing new to push.${left.length === 0 ? '' : ` What you changed isn't committed yet (${filesWord(left)}): commit it, then ask again.`}`,
            })
          return { link, snapshot, where, ahead, left, path: workspace.path }
        })

      /** Why a lead's pull request tool can't, in words for it, where that is the host's or the person's to put right; else nothing. */
      const refusalOf = (error: unknown) => {
        // A review's lead, reading someone else's pull request, never gets here: its tools are a review's (Reviews.ts).
        if (error instanceof NotFound && error.kind === 'pull request')
          return 'This task has no pull request yet. Althar opens one when the plan’s steps are done.'
        if (error instanceof NotConnected || (error instanceof NotFound && error.kind === 'connection'))
          return 'Althar isn’t connected to this repository’s host, so it can’t reach the pull request. Tell the person.'
        if (error instanceof ConnectorFailed) return `The code host said: ${error.message}`
        return undefined
      }

      /** A lead's tool: refusals reach it in words; anything else says to try again, and goes to the log. */
      const leadTool = (
        name: string,
        description: string,
        input: Readonly<Record<string, unknown>>,
        call: (taskId: string, input: unknown, access: ToolAccess) => Effect.Effect<string, unknown, Store>,
      ) => ({
        name,
        description,
        input,
        call: (value: unknown, access: ToolAccess) => {
          const taskId = access.taskId
          return taskId === null
            ? Effect.fail(new ToolRefused({ message: 'This tool is for a task’s lead.' }))
            : provide(call(taskId, value, access)).pipe(
                Effect.catch((error) => {
                  if (error instanceof ToolRefused) return Effect.fail(error)
                  const refused = refusalOf(error)
                  if (refused !== undefined) return Effect.fail(new ToolRefused({ message: refused }))
                  return Effect.andThen(
                    Effect.logWarning('A pull request tool did not succeed', error),
                    Effect.fail(new ToolRefused({ message: 'Althar could not do that. Try again, or tell the person.' })),
                  )
                }),
              )
        },
      })

      yield* toolServer.serve('lead', [
        {
          ...leadTool(
            'read_pull_request',
            "The task's pull request as it stands, or each of them in a task of several repositories: its state, its checks (with the end of a failed check's log), and what people said on it, with each line comment's thread id. In a review, the pull request it reviews: its description too, and what everyone said on it.",
            { type: 'object', properties: {} },
            (taskId) =>
              Effect.gen(function* () {
                // A review reads the pull request it reviews, someone else's, as its host has it now.
                const review = (yield* urlsOf(taskId)).length === 0 ? yield* reviewOf(taskId) : null
                return review === null ? yield* read(taskId) : yield* readReviewed(review)
              }),
          ),
          // It only reads, so a review's lead has it too.
          inReview: true,
        },
        leadTool(
          'read_check_log',
          "Reads a check's whole log on the task's pull request, a page of lines at a time: by the check's name, as read_pull_request gives it, from from_line, or its last page without one. In a task of several repositories, pull_request names the one, as read_pull_request names it: web#3. For a failure whose cause isn't in the end of the log you were given. Where its host refuses the log or no longer keeps it, it says why; for a check another CI service ran, it gives the check's page and what it reported instead.",
          {
            type: 'object',
            properties: { check: { type: 'string' }, from_line: { type: 'integer', minimum: 1 }, pull_request: { type: 'string' } },
            required: ['check'],
          },
          (taskId, input) => readCheckLog(taskId, input),
        ),
        leadTool(
          'rerun_check',
          "Runs checks on the task's pull request again, as for one that may have failed by chance (a flaky test, a runner that went away): with check, the one by that name, as read_pull_request gives it; without, each that failed. Should they fail again, you'll be told, as for any checks. A check its host can't run again from Althar, such as one another CI service reports to GitHub (Cloudflare's builds, Vercel, CircleCI's app), or any on Bitbucket, is said so, with its page, where the person can. Fix a failure that is the change's rather than running it again. In a task of several repositories, pull_request names the one, as read_pull_request names it: web#3.",
          {
            type: 'object',
            properties: { check: { type: 'string' }, pull_request: { type: 'string' } },
          },
          (taskId, input) => rerunCheck(taskId, input),
        ),
        leadTool(
          'read_default_branch_checks',
          "The checks on the latest commit of the default branch the task's pull request goes into (main, often), with the end of each failed one's log: to tell whether a check failing on the pull request fails there too, broken already rather than by this change. In a task of several repositories, pull_request names the one, as read_pull_request names it: web#3.",
          { type: 'object', properties: { pull_request: { type: 'string' } } },
          (taskId, input) => readBaseChecks(taskId, input),
        ),
        leadTool(
          'hand_checks_to_person',
          "Brings the checks failing on the task's pull request to the person, rather than fixing them: where they are broken on the default branch too, or fail for a reason that has nothing to do with this change, where you are out of tries, or where the person must decide something. why is one short line they read on the task's card, the problem first, such as \"Fails on main too: runtime (windows) times out in busy.test.ts\", in plain words, since the card shows no formatting; fix, a sentence on what would fix it or what they are to decide. Change nothing on the branch to work around a failure that isn't the change's. In a task of several repositories, pull_request names the one, as read_pull_request names it: web#3.",
          {
            type: 'object',
            properties: { why: { type: 'string' }, fix: { type: 'string' }, pull_request: { type: 'string' } },
            required: ['why'],
          },
          (taskId, input) => locked(taskId)(handChecks(taskId, input)),
        ),
        leadTool(
          'reply_on_pull_request',
          "Replies on the task's pull request: in a line comment's thread, by its thread id, or in its conversation without one. In a task of several repositories, pull_request names the one to reply on, by its repository and number, as read_pull_request names it: web#3. For answering what people said; a change to the code is a commit, which the person pushes: ask them to with push_to_pull_request.",
          {
            type: 'object',
            properties: { body: { type: 'string' }, thread_id: { type: 'string' }, pull_request: { type: 'string' } },
            required: ['body'],
          },
          (taskId, input, access) =>
            Effect.gen(function* () {
              const replied = yield* Schema.decodeUnknownEffect(Replied)(input).pipe(
                Effect.mapError((error) => new ToolRefused({ message: `Althar couldn't read that: ${error.message}` })),
              )
              // The reply is signed with the lead's name, as the person's colleagues read it under the person's account.
              const lead = yield* sessions.running(access.threadId)
              const by = Option.isNone(lead)
                ? null
                : yield* agents.get(lead.value.agentId).pipe(
                    Effect.map((entry) => entry.definition.name),
                    Effect.orElseSucceed(() => null),
                  )
              // Among several pull requests, the one it names, by repository and number: numbers repeat across repositories.
              const seen = yield* urlsOf(taskId)
              const asked = replied.pull_request == null ? null : String(replied.pull_request).trim().toLowerCase()
              const matching = seen.filter((candidate) => asked !== null && isNamed(candidate, asked))
              const [named] = matching
              if (seen.length > 1 && (named === undefined || matching.length > 1))
                return yield* new ToolRefused({
                  message: `This task has several pull requests: ${seen.map(shortNameOf).join(', ')}. Say which with pull_request, as one of those.`,
                })
              const change = yield* locked(taskId)(
                reply(taskId, {
                  body: replied.body,
                  threadId: replied.thread_id ?? null,
                  by,
                  ...(named === undefined ? {} : { url: named.url }),
                }),
              )
              return `Replied on ${nameOf(change)}.`
            }),
        ),
        leadTool(
          'push_to_pull_request',
          "Asks the person to push what you've committed on the task's branch to its pull request, once it's open. Althar shows them the commits that would go up, from the pull request's head to your branch's, with a Push button, and tells you once they've pushed. Use it when the person asks you to push, or when what you've committed should go up to the pull request. Commit first: only commits go up. Nothing is pushed until the person presses Push, so don't say it's up, or that Althar will push it by itself. In a task of several repositories, pull_request names the one, as read_pull_request names it: web#3.",
          { type: 'object', properties: { pull_request: { type: 'string' } } },
          (taskId, input) =>
            locked(taskId)(
              Effect.gen(function* () {
                const sql = yield* SqlClient.SqlClient
                const asked = yield* Schema.decodeUnknownEffect(PushAsked)(input).pipe(
                  Effect.mapError((error) => new ToolRefused({ message: `Althar couldn't read that: ${error.message}` })),
                )
                const seen = yield* urlsOf(taskId)
                if (seen.length === 0) return yield* new NotFound({ kind: 'pull request', id: taskId })
                const several = seen.length > 1
                const named = asked.pull_request == null ? null : String(asked.pull_request).trim().toLowerCase()
                const candidates = named === null ? seen : seen.filter((candidate) => isNamed(candidate, named))
                if (named !== null && candidates.length !== 1)
                  return yield* new ToolRefused({
                    message: several
                      ? `This task has several pull requests: ${seen.map(shortNameOf).join(', ')}. Say which with pull_request, as one of those.`
                      : `This task's pull request is ${seen.map(nameOf).join('')}. Leave pull_request out, or name it so.`,
                  })
                // Without a name, among several, the open one whose branch has something new for it.
                const tried = yield* Effect.forEach(
                  candidates.length === 1 ? candidates : candidates.filter((candidate) => candidate.state === 'open'),
                  (candidate) => Effect.exit(toPush(taskId, candidate.url, several ? shortNameOf(candidate) : nameOf(candidate))),
                )
                const ready = tried.flatMap((one) => (one._tag === 'Success' ? [one.value] : []))
                if (ready.length > 1)
                  return yield* new ToolRefused({
                    message: `Several of this task's pull requests have new commits: ${ready.map((one) => one.where).join(', ')}. Ask once for each, naming it with pull_request.`,
                  })
                const [chosen] = ready
                if (chosen === undefined) {
                  // Why none can take a push: each one's refusal, or else what went wrong, for the lead's tool to say.
                  const failures = tried.flatMap((one) => (one._tag === 'Failure' ? [one.cause] : []))
                  const refusals = failures.flatMap((cause) => {
                    const error = Cause.findErrorOption(cause)
                    return Option.isSome(error) && error.value instanceof ToolRefused ? [error.value.message] : []
                  })
                  const [first] = failures
                  if (first !== undefined && refusals.length < failures.length) return yield* Effect.failCause(first)
                  return yield* new ToolRefused({
                    message:
                      refusals.length > 0
                        ? refusals.join(' ')
                        : "None of this task's pull requests is open, so there's nothing to push to. What you committed goes in a new pull request, which the person opens from the task: if you haven't, call finish_step with your summary, and tell them it's ready.",
                  })
                }
                const { link, snapshot, where, ahead, left, path } = chosen
                const unpushed = left.length === 0 ? [] : [`Not included, since they aren't committed: ${filesWord(left)}.`]
                // Checks that failed are the lead's to see through, whether or not the person has looked: its fix goes up at once
                // (ADR-040, ADR-068), unless the person said something on the task since those checks came, when what it committed may
                // be for that, or the branch had commits not pushed yet when the lead was told, which the fix would take up with it.
                // Anything else waits for the person, as ever.
                const fixing = yield* fixingOn(link)
                const earlier =
                  fixing !== null && fixing.open && fixing.failing && !fixing.spoken
                    ? yield* pendingAtFailure(link, snapshot.headSha, path, ahead.from)
                    : null
                if (earlier === false) {
                  const pushed = yield* Effect.exit(push(taskId, ahead.head, snapshot.url))
                  if (pushed._tag === 'Success')
                    return [
                      `Pushed ${commitsWord(ahead.count)} to ${where}: a fix for failing checks goes up as you make it. Its checks run again, and you'll be told if they fail.`,
                      ...unpushed,
                    ].join(' ')
                  yield* Effect.logWarning('Could not push the fix by itself: the person is asked instead', pushed.cause)
                }
                const waiting = yield* askedOf(taskId, snapshot.url)
                const already = waiting.find((one) => one.content.head === ahead.head)
                if (already !== undefined)
                  return `Already asked the person to push ${commitsWord(already.content.count)} to ${where}: it waits for them in the task's thread, and you'll be told when they've pushed.`
                // Asked again, with more on the branch, what was asked before gives way to it.
                for (const one of waiting) yield* settleAsked(one, 'replaced')
                const [thread] = yield* sql<{ id: string }>`SELECT id FROM threads WHERE task_id = ${taskId} AND kind = 'task'`
                if (thread === undefined) return yield* new NotFound({ kind: 'task', id: taskId })
                yield* addItem({ projectId: link.projectId, threadId: thread.id }, 'push_request', {
                  url: snapshot.url,
                  where,
                  product: link.product,
                  head: ahead.head,
                  commits: ahead.commits,
                  count: ahead.count,
                  moved: false,
                  blocked: null,
                  state: 'open',
                  settledAt: null,
                } satisfies Asked)
                return [
                  `Asked the person to push ${commitsWord(ahead.count)} to ${where}. They see them in the task's thread with a Push button; nothing goes up until they press it, and you'll be told when they have.`,
                  ...(earlier === true
                    ? ["The branch had commits that weren't pushed yet when its checks failed, so the fix waits for the person with them."]
                    : []),
                  ...unpushed,
                ].join(' ')
              }),
            ),
        ),
        leadTool(
          'push_tag',
          "Pushes a tag you've made to the remote the repository's work goes to, as `git push <remote> refs/tags/<tag>` would; you can't push it yourself, since you have no sign-in to the code host. Make the tag first with `git tag` on the commit it's for, such as v1.2.0 on the release's commit on the default branch. A tag often starts a release, so it waits for the person to allow it, as such a push of yours would, and returns once it's pushed or they've said no. It never moves a tag the remote has already. In a task of several repositories, repository names the one.",
          { type: 'object', properties: { tag: { type: 'string' }, repository: { type: 'string' } }, required: ['tag'] },
          (taskId, input, access) => pushTag(taskId, input, access),
        ),
      ])

      return Changes.of({
        publish: (input) => provide(publish(input)),
        unshipped: (taskId) => provide(unshippedOf(taskId)),
        inHands: (taskId) => provide(handsOf(taskId)),
        fixing: (taskId) =>
          provide(
            Effect.map(fixesOf(taskId), (all) =>
              all.length === 0
                ? null
                : {
                    open: all.some((one) => one.open),
                    running: all.some((one) => one.running),
                    why: all.find((one) => one.why !== null)?.why ?? null,
                  },
            ),
          ),
        // Only a task with pull requests: one with none is settled by merging it here, as the person says.
        settleIfMerged: (taskId) =>
          provide(
            locked(taskId)(
              Effect.gen(function* () {
                if ((yield* linksOf(taskId)).length > 0) yield* settleIfDone(taskId)
              }),
            ),
          ),
        merged: (taskId) => provide(Effect.map(mergeOf(taskId), (one) => one.merged)),
        leaveOut: (input) => provide(locked(input.taskId)(leaveOut(input))),
        // The person pushing takes the change into their hands: from here, its lead's fixes wait for them (ADR-040).
        push: (taskId, head, url) => provide(locked(taskId)(Effect.andThen(taken(taskId, 'pushed'), push(taskId, head, url)))),
        replace: (taskId, head, replaces, url) =>
          provide(locked(taskId)(Effect.andThen(taken(taskId, 'pushed'), replace(taskId, head, replaces, url)))),
        mergeNote: (taskId, url) => provide(locked(taskId)(mergeNote(taskId, url))),
        markReady: (taskId, url) => provide(locked(taskId)(markReady(taskId, url))),
        readSettled,
        close: (taskId, url, options) => provide(locked(taskId)(close(taskId, url, options.deleteBranch))),
        exclusive: (taskId, effect) => locked(taskId)(effect),
        merge: (taskId, head, url) => provide(locked(taskId)(merge(taskId, head, url))),
        mergeHere: (taskId, heads) => provide(locked(taskId)(branches.withPermits(1)(mergeHere(taskId, heads)))),
        pushHere: (taskId) => provide(locked(taskId)(branches.withPermits(1)(pushHere(taskId)))),
        pushBranch: (taskId, heads) => provide(locked(taskId)(pushBranch(taskId, heads))),
        reply: (taskId, input) => provide(locked(taskId)(reply(taskId, input))),
        read: (taskId) => provide(read(taskId)),
        ofTask: (taskId) => provide(Effect.flatMap(linksOf(taskId), (links) => Effect.forEach(links, summaryOf))),
        stopListening: (taskId, url) => provide(locked(taskId)(stopListening(taskId, url))),
        attach: (input) => provide(locked(input.taskId)(attaching.withPermits(1)(attach(input)))),
        leadStopped: (where, how = 'stopped') =>
          provide(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient
              const [task] =
                'taskId' in where
                  ? [{ taskId: where.taskId }]
                  : yield* sql<{ taskId: string }>`SELECT task_id FROM threads WHERE id = ${where.threadId} AND task_id IS NOT NULL`
              if (task !== undefined) yield* locked(task.taskId)(leadStopped(task.taskId, how))
            }),
          ),
        resolveNow: (where, force) => Effect.asVoid(Effect.forkIn(provide(resolveNow(where, force)), scope)),
        setResolveConflicts: (input) => provide(setResolveConflicts(input)),
        // The person looking at the task counts as something happening on it.
        refresh: (taskId) =>
          Effect.andThen(
            news(taskId),
            Effect.sync(() => wakeNow(taskId)),
          ),
        // Worked out from the repositories the task changes, where it says which: one on a connected host opens a draft.
        endFor: (projectId, taskId) =>
          provide(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient
              const [project] = yield* sql<{ id: ProjectId }>`SELECT id FROM projects WHERE id = ${projectId}`
              if (project === undefined) return null
              const hosts = yield* hostsFor(projectId, taskId)
              const wanted = (yield* (yield* Policies).current(project.id)).rules.end
              if (wanted === 'none') return wanted
              if (wanted !== undefined) return hosts.some((host) => host !== null) ? wanted : null
              return hosts.some((host) => host?.connected === true) ? ('draft' as const) : null
            }),
          ),
        hostFor: (projectId) => provide(hostFor(projectId)),
        hostsFor: (projectId, taskId) => provide(hostsFor(projectId, taskId)).pipe(Effect.orElseSucceed(() => [])),
        conflictStanding: (taskId) => provide(standingOfRound(taskId)).pipe(Effect.orElseSucceed(() => null)),
      })
    }),
  )
}
