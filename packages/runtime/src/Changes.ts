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
  type Repository,
} from '@althar/connectors'
import { PushRequestItem } from '@althar/contracts'
import { type ActorId, type CommandEnvelope, Ids, newId, type ProjectId } from '@althar/domain'
import type { Ledger } from '@althar/persistence-sqlite'
import { Cause, Clock, Context, type Crypto, Duration, Effect, Layer, Option, Queue, Schema, Scope, Semaphore, Stream } from 'effect'
import { SqlClient } from 'effect/sql'

import { Busy } from './Busy'
import { touchCard } from './cards'
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
  whereLine,
} from './conflicts'
import { coAuthorOn, creditBranch, type Memory, recallMade, rememberMade, withoutAgentCredit } from './credit'
import { envelope } from './envelope'
import { evidencePaths, taskShown } from './evidence'
import { CantMerge, ChangedSinceSeen, GitFailed, NoChangeToOpen, NotFound, PushRefused } from './errors'
import { conventionsAt, ruleOf, titleFor } from './conventions'
import { forkOf } from './forks'
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
  bodyOf,
  checksForLead,
  checksLine,
  checksOf,
  commentForLead,
  commentLine,
  fromAlthar,
  logOf,
  nameOf,
  outsidersLine,
  signed,
  reviewForLead,
  reviewLine,
  standing,
} from './pullRequestWords'
import { change, fact, timestamp } from './records'
import { indexTask } from './Search'
import { Policies, resolvesConflictsFor, ruleSetOf } from './Policies'
import { Sessions } from './Sessions'
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
})
type Snapshot = typeof Snapshot.Type

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
export type PublishedOne = (
  | { readonly kind: 'opened'; readonly change: ChangeSummary }
  | { readonly kind: 'pushed'; readonly branch: string }
  | { readonly kind: 'nothing' }
  /** Left on its branch: in a task of several repositories, one on no code host Althar knows. */
  | { readonly kind: 'branch' }
) & { readonly left: ReadonlyArray<string>; readonly repository: string }

/** What publishing did in each of the task's repositories, the project's first first. */
export type Published = ReadonlyArray<PublishedOne>

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
  /** That pull request's head, as the branch has it; or, `moved` or with none, where its branch started. */
  readonly head: string
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

/** Where a task's conflict round stands, as its card says it (`Changes.conflictStanding`). */
export type ConflictStanding =
  | { readonly state: 'resolving'; readonly checks: boolean }
  | { readonly state: 'handed_back'; readonly why: string }

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
     * Settles a task with pull requests as done where every repository of it
     * is merged and no commit is left after its pull requests, as a merge
     * seen on its host does: for a round of work that ended (ADR-034). One
     * with none stays as it is.
     */
    settleIfMerged(taskId: string): Effect.Effect<void, unknown>
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
     * any is looked at.
     */
    resolveNow(where: { readonly projectId: string } | { readonly taskId: string }): Effect.Effect<void>
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
     * the lead left them. Null otherwise, such as while Althar waits for the
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
      const every = (yield* RuntimeConfig).listenEvery ?? Duration.seconds(30)
      /* One thing at a time on a task's pull request: a reply's receipt is kept before listening reads the reply back. */
      const locks = new Map<string, Semaphore.Semaphore>()
      const locked = (taskId: string) => {
        const known = locks.get(taskId)
        if (known !== undefined) return known.withPermits(1)
        const made = Semaphore.makeUnsafe(1)
        locks.set(taskId, made)
        return made.withPermits(1)
      }
      /*
       * Default branches move here, by a local merge, and go to their remotes,
       * by a push, one at a time across every task: a push never sends what a
       * merge of several repositories moved and is about to put back.
       */
      const branches = Semaphore.makeUnsafe(1)
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
          const link = (
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
       * What the steps reported, as the pull request's description: in the
       * repository's template, where it has one. A task's next pull request,
       * after one merged or closed, is described from what came `since` that
       * one opened: its own work, not the last one's again (ADR-034).
       */
      const bodyFor = (
        taskId: string,
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
          // The lead's latest description in the template, for this repository.
          const [written] =
            repository.template === null
              ? []
              : yield* sql<{ text: string | null }>`
                  SELECT json_extract(content, '$.descriptions.' || json_quote(${repository.slug})) AS text FROM thread_items
                  WHERE thread_id = ${threadId} AND kind = 'step_result'
                    AND json_extract(content, '$.descriptions.' || json_quote(${repository.slug})) IS NOT NULL AND ${after}
                  ORDER BY sequence DESC LIMIT 1`
          const findings = yield* sql<{ severity: string; location: string; claim: string; state: string; response: string | null }>`
            SELECT f.severity, f.location, f.claim, f.state, f.response FROM findings f
            JOIN node_attempts a ON a.id = f.review_attempt_id JOIN nodes n ON n.id = a.node_id
            JOIN workflow_executions e ON e.id = n.execution_id JOIN runs r ON r.id = e.run_id
            WHERE r.task_id = ${taskId} AND (${since} IS NULL OR f.created_at > ${since}) ORDER BY f.created_at`
          const [reviewed] = yield* sql<{ verdict: string | null; rounds: number }>`
            SELECT (SELECT json_extract(content, '$.verdict') FROM thread_items WHERE thread_id = ${threadId} AND kind = 'step_result'
                AND json_extract(content, '$.step') = 'review' AND ${after} ORDER BY sequence DESC LIMIT 1) AS verdict,
              (SELECT count(*) FROM thread_items WHERE thread_id = ${threadId} AND kind = 'step_result'
                AND json_extract(content, '$.step') = 'review' AND ${after}) AS rounds`
          // What the task built, at the top; then what the lead showed across its steps, and what it last said it couldn't: since
          // the last pull request, for a next one (ADR-034).
          const { built, evidence, unverified } = yield* taskShown(threadId, since)
          // An agent may sign its summary as it signs a commit; that stays here too.
          return bodyOf({
            built: built === null ? null : withoutAgentCredit(built, agentNames),
            lead: lead === undefined ? null : withoutAgentCredit(lead.summary, agentNames),
            review: reviewed === undefined ? null : reviewed,
            findings: findings.map((finding) => {
              const location = JSON.parse(finding.location) as { file?: string | null; line?: number | null }
              return { ...finding, file: location.file ?? null, line: location.line ?? null }
            }),
            evidence,
            unverified,
            issue,
            template: repository.template,
            written: written === undefined || written.text === null ? null : withoutAgentCredit(written.text, agentNames),
            credit: yield* coAuthorOn,
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
       * which files.
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
          // Made for it already, by a try that didn't open it, the branch is the one.
          if (next.moved) return task
          const changed = (yield* git(task.path, '-c', 'core.quotePath=false', 'diff', '--name-only', 'HEAD'))
            .split('\n')
            .filter((file) => file !== '')
          if (changed.length > 0) return yield* new NoChangeToOpen({ taskId, why: 'uncommitted', detail: filesWord(changed) })
          const fresh = yield* nextBranch(task, pushTarget)
          let base = task.baseCommit
          if (next.change.state === 'merged') {
            // The default branch as its host has it now, with what merged: as this Mac last saw it, it may not have that yet.
            const tip = yield* fetchInto(task.path, baseTarget, target, `refs/althar/base/${target}`)
            if (tip === null)
              return yield* new GitFailed({ args: ['fetch', target], cwd: task.path, stderr: `Couldn't fetch ${target} from the host.` })
            base = tip
            if (yield* onHead(task.path, tip)) yield* git(task.path, 'checkout', '-q', '-b', fresh)
            else {
              // The commits as the branch has them now, after the fetch: what the lead committed meanwhile goes too.
              const from = yield* commitOf(task.path, 'HEAD')
              const commits = (yield* git(task.path, 'rev-list', '--reverse', '--no-merges', `${next.head}..${from}`))
                .split('\n')
                .filter((line) => line !== '')
              yield* git(task.path, 'checkout', '-q', '-b', fresh, tip)
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
          } else yield* git(task.path, 'checkout', '-q', '-b', fresh)
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
            input.taskId,
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
                perform: tracker.link(issue, { url: opened.url, title: `${nameOf(snapshot)}: ${opened.title}` }),
                encode: () => true,
                decode: () => undefined,
              })
            }).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not link the pull request to its issue', cause)))
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
          const tip = yield* remoteTip(workspace.path, pushTarget, workspace.branch)
          const { head, settle } = yield* credited(workspace.path, workspace.branch, seen, [snapshot.headSha, sent, tip])
          // What Althar last pushed before what it last saw: a pull request read before that push is behind it.
          yield* stillOnHead(taskId, snapshot.url, workspace.path, seen, head, tip, [sent, snapshot.headSha])
          // Refused, it says why in a sentence, not git's hint: the pull request has commits the branch doesn't.
          yield* pushTo(workspace.path, pushTarget, workspace.branch, head).pipe(
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
          yield* pushTo(workspace.path, pushTarget, workspace.branch, head, replaces).pipe(
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
          const ref = `refs/althar/pull-request/${workspace.branch}`
          const head = yield* fetchInto(workspace.path, pushTarget, workspace.branch, ref)
          if (head === null)
            return yield* new GitFailed({
              args: ['fetch', workspace.branch],
              cwd: workspace.path,
              stderr: `Couldn't fetch ${workspace.branch} from the host.`,
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
       * looks again. Read back at once, merged, its task settles.
       */
      const merge = (taskId: string, head: string, url?: string) =>
        Effect.gen(function* () {
          const { link, snapshot, host, repository } = yield* current(taskId, url)
          if (snapshot.state !== 'open') return
          const read = yield* host.change(repository, snapshot.number)
          if (read.state === 'open') {
            if (read.headSha !== head) return yield* new ChangedSinceSeen({ taskId })
            if (read.draft) yield* markReady(taskId)
            yield* outward({
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
          }
          const [now] = (yield* linksOf(taskId)).filter((candidate) => candidate.id === link.id)
          if (now !== undefined) yield* poll(now)
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
          const refused = yield* applyMerges(
            plans.flatMap(({ repository, plan }) =>
              plan.kind === 'move' ? [{ root: repository.root, branch: repository.base, plan, repository }] : [],
            ),
          )
          if (refused !== null)
            return yield* refused.plan.checkout === null
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
            description: 'On this Mac only: nothing was pushed.',
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

      /** Each of the task's pull requests, read as `readOne` reads one, one after another. */
      const read = (taskId: string) =>
        Effect.gen(function* () {
          const urls = yield* urlsOf(taskId)
          if (urls.length <= 1) return yield* readOne(taskId)
          return (yield* Effect.forEach(urls, (seen) =>
            Effect.map(readOne(taskId, seen.url), (read) => `${shortNameOf(seen)}: ${read}`),
          )).join('\n\n')
        })

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
            for (const check of checks.filter((candidate) => candidate.state === 'failed').slice(0, LOGS_TO_LEAD)) {
              const log = yield* host.checkLog(repository, check).pipe(Effect.orElseSucceed(() => null))
              if (log !== null) lines.push(logOf(check.name, log))
            }
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
      const tellLead = (link: LinkRow, parts: ReadonlyArray<string>) =>
        Effect.gen(function* () {
          if (parts.length === 0) return
          const sql = yield* SqlClient.SqlClient
          const [thread] = yield* sql<{ id: string; state: string }>`
            SELECT t.id, k.state FROM threads t JOIN tasks k ON k.id = t.task_id WHERE t.task_id = ${link.taskId} AND t.kind = 'task'`
          if (thread === undefined || thread.state !== 'open' || Option.isNone(yield* sessions.running(thread.id))) return
          yield* sessions.send({
            envelope: yield* envelope('thread.send', { threadId: thread.id, heard: link.id }),
            threadId: thread.id,
            body: parts.join('\n\n'),
            quiet: true,
          })
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
          if (said === null || read.state !== 'open') return said
          const sent = yield* sentTo(link.projectId, read.url)
          if (sent === null || sent === said) return said
          const workspace = yield* worktreeOf(link.taskId, read.url)
          if (workspace === undefined || !(yield* behindAny(workspace.path, [said], [sent]))) return said
          const target = yield* pushTargetOf(host, repository, workspace.path)
          return (yield* remoteTip(workspace.path, target, workspace.branch)) === sent ? sent : said
        }).pipe(Effect.orElseSucceed(() => read.headSha))

      /**
       * One turn of listening to a change: its state, its finished checks, and
       * what was said since the cursor. Whether anything happened on it, so
       * a quiet one is asked less often.
       */
      const poll = (link: LinkRow) =>
        Effect.gen(function* () {
          if (link.connectionId === null) return false
          const adapters = yield* connections.adapters(link.connectionId)
          const host = adapters.host
          if (host === undefined) return false
          const account = adapters.info.account
          const before = yield* decodeSnapshot(link.snapshot)
          const repository: Repository = yield* host.repository(before.repository)
          const read = yield* host.change(repository, before.number)
          const now = { ...read, headSha: yield* caughtUp(link, read, host, repository) }
          const name = nameOf(before)
          const forLead: Array<string> = []
          let happened = false
          let checks = before.checks
          if (now.headSha !== null) {
            const sum = checksOf(now.headSha, yield* host.checks(repository, now.headSha))
            const finished = sum.outcome === 'passed' || sum.outcome === 'failed'
            // Checks still running keep the pull request worth asking about.
            if (sum.outcome === 'running') happened = true
            if (
              finished &&
              (before.checks?.sha !== sum.sha || before.checks.outcome !== sum.outcome) &&
              (yield* heard(link, 'checks', `checks:${sum.sha}:${sum.outcome}`, { ...sum }))
            ) {
              happened = true
              yield* arrive(link, {
                kind: 'checks',
                from: null,
                where: name,
                passed: sum.passed,
                failed: sum.failed,
                failing: sum.failing,
                url: now.url,
              })
              if (sum.outcome === 'failed') {
                const logs: Array<string> = []
                const all = yield* host.checks(repository, now.headSha)
                for (const check of all.filter((candidate) => candidate.state === 'failed').slice(0, LOGS_TO_LEAD)) {
                  const log = yield* host.checkLog(repository, check).pipe(Effect.orElseSucceed(() => null))
                  if (log !== null) logs.push(logOf(check.name, log))
                }
                forLead.push(checksForLead(sum, name, logs))
              }
            }
            checks = sum
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
          const after = snapshotOf(now, before.repository, before.words, checks)
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
          if (after.state === 'merged') yield* settleIfDone(link.taskId)
          // Checks on what Althar pushed to resolve a conflict are the round's; what fails there isn't told the lead twice.
          const theRounds = yield* checked(link, before.url, now, host, repository).pipe(
            Effect.catchCause((cause) => Effect.as(Effect.logWarning('Could not hear the checks on a resolved conflict', cause), false)),
          )
          yield* tellLead(link, theRounds ? forLead.filter((part) => !part.startsWith('Checks failed')) : forLead)
          if (now.state === 'open' && now.conflicts === true)
            yield* conflicted(link, before, now, host, repository).pipe(
              Effect.catchCause((cause) => Effect.logWarning('Could not ask the lead to resolve a conflict', cause)),
            )
          return happened
        })

      /**
       * Each of the task's repositories here whose last pull request merged
       * or closed, with commits on its branch after that pull request's head:
       * what a new pull request would have (ADR-034). Merges are left out of
       * them, since what a merge brought in is the default branch's, and
       * commits that change nothing together have nothing to ship. One whose
       * worktree doesn't have its pull request's head can't tell, and has
       * none.
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
            sent: string | null
            changeBranch: string | null
            linkId: string | null
            product: Product | null
            snapshot: string | null
            listening: number | null
            openedAt: string | null
          }>`
            SELECT w.id AS workspace_id, w.path, w.branch, w.base_commit, w.base_ref, b.display_name AS name, b.slug,
              b.remote_fingerprints AS remotes, c.head_commit AS sent, c.branch AS change_branch, l.id AS link_id, l.product,
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
            const listed = yield* git(repository.path, 'rev-list', '--reverse', '--no-merges', `${head}..HEAD`).pipe(
              Effect.orElseSucceed(() => ''),
            )
            const commits = listed.split('\n').filter((line) => line !== '')
            // Commits that change nothing, all together, have nothing to ship.
            if (commits.length === 0 || (yield* gitOutcome(repository.path, 'diff', '--quiet', head, 'HEAD')).code === 0) continue
            // How big they are together, as a diff from that head says: a binary file counts no lines.
            const counted = yield* git(repository.path, 'diff', '--numstat', head, 'HEAD').pipe(Effect.orElseSucceed(() => ''))
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
          const open = latestOf(seen).flatMap((latest) =>
            latest.state !== 'merged'
              ? [repositories.length > 1 ? `${nameOf(latest)} in ${latest.repository.at(-1) ?? ''}` : nameOf(latest)]
              : [],
          )
          // A repository with no pull request is merged where its branch's head is in its default branch here.
          const unmerged: Array<string> = []
          for (const repository of repositories) {
            if (repository.opened === 1) continue
            const head = yield* commitOf(repository.path, 'HEAD').pipe(Effect.orElseSucceed(() => ''))
            const merged = yield* gitOutcome(repository.root, 'merge-base', '--is-ancestor', head, `refs/heads/${repository.base}`)
            if (head === '' || merged.code !== 0) unmerged.push(repository.name)
          }
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
       * open with its run done (not running, nor stopped, where starting its
       * lead would go against the person); and no round is under way. One the
       * lead couldn't resolve stays the person's while its branches are as it
       * left them.
       */
      const askable = (taskId: string, url: string | null) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [task] = yield* sql<{ projectId: ProjectId; state: string; resolveConflicts: number | null; run: string | null }>`
            SELECT k.project_id, k.state, k.resolve_conflicts,
              (SELECT state FROM runs WHERE task_id = k.id ORDER BY created_at DESC, rowid DESC LIMIT 1) AS run
            FROM tasks k WHERE k.id = ${taskId}`
          if (task === undefined || task.state !== 'open' || task.run !== 'succeeded') return 'no' as const
          if (!resolvesConflictsFor((yield* (yield* Policies).current(task.projectId)).rules, task.resolveConflicts)) return 'no' as const
          const [latest] = yield* sql<{ id: string; url: string | null; state: string; conflicts: string; ended: string | null }>`
            SELECT id, pull_request_url AS url, state, conflicts, ended FROM conflict_resolutions WHERE task_id = ${taskId}
            ORDER BY created_at DESC, rowid DESC LIMIT 1`
          if (latest?.state === 'resolving' || latest?.state === 'checking') return 'resolving' as const
          if (latest?.state === 'failed' && latest.url === url && latest.ended !== null) {
            const left = yield* decodeEnded(latest.ended)
            const now = yield* endedOf(taskId, yield* decodeConflicts(latest.conflicts))
            if (left.every((one) => now.some((head) => head.repository === one.repository && head.head === one.head))) return 'no' as const
          }
          return 'yes' as const
        })

      /** Where a task's latest round stands, for its card (`Changes.conflictStanding`). */
      const standingOfRound = (taskId: string): Effect.Effect<ConflictStanding | null, unknown, Store> =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [latest] = yield* sql<{ id: string }>`
            SELECT id FROM conflict_resolutions WHERE task_id = ${taskId} ORDER BY created_at DESC, rowid DESC LIMIT 1`
          const round = latest === undefined ? undefined : yield* roundOf({ id: latest.id })
          if (round === undefined) return null
          if (round.state === 'resolving') return { state: 'resolving', checks: round.pushedHead !== null }
          if (round.state !== 'failed' || round.ended === null || round.failure === null) return null
          // Still the person's while the branches are as the lead left them, as `askable` reads it.
          const conflicts = yield* decodeConflicts(round.conflicts)
          const left = yield* decodeEnded(round.ended)
          const now = yield* endedOf(taskId, conflicts)
          if (!left.every((one) => now.some((head) => head.repository === one.repository && head.head === one.head))) return null
          const couldnt = round.pushedHead === null ? `resolve the conflict with ${whereLine(conflicts)}` : 'fix the checks on the merge'
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
          const id = yield* newId(Ids.conflictResolution)
          const place = yield* placeOf(task.taskId, url)
          const body = noteFor(conflicts, place, null)
          const room = yield* busy.enter(task.taskId, (room) =>
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

      /** Every round that waits for a place to ask its lead, with since when, and what asks it once it has one. */
      const roundsWaiting = Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<RoundRow>`
          SELECT ${roundColumns(sql)} FROM conflict_resolutions c JOIN threads t ON t.task_id = c.task_id AND t.kind = 'task'
          JOIN tasks k ON k.id = c.task_id JOIN projects p ON p.id = c.project_id
          WHERE c.state = 'resolving' AND c.waiting IS NOT NULL AND k.state = 'open' AND p.archived_at IS NULL`
        return yield* Effect.forEach(rows, (round) =>
          Effect.map(decodeWaiting(round.waiting ?? ''), (waited) => ({
            taskId: round.taskId,
            since: waited.since,
            start: provide(locked(round.taskId)(askWaiting(round.id))),
          })),
        )
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
            const left =
              worktree === undefined ? { why: 'Its worktree is gone.', uncommitted: false } : yield* unresolved(worktree, conflict)
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
       * What the host says of an open pull request that conflicts: where the
       * project has the lead resolve it, Althar fetches the branch it goes
       * into, and asks the lead where its branch here conflicts with it too.
       * One that merges cleanly here is from before the branch moved, or
       * merged here already and waiting for the person to push.
       */
      const conflicted = (link: LinkRow, seen: Snapshot, now: ChangeRequest, host: CodeHost, repository: Repository) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          if ((yield* askable(link.taskId, seen.url)) !== 'yes') return
          const [workspace] = yield* sql<{ path: string; slug: string; name: string; threadId: string }>`
            SELECT w.path, b.slug, b.display_name AS name, t.id AS thread_id FROM workspaces w
            JOIN repository_bindings b ON b.id = w.binding_id JOIN threads t ON t.task_id = w.task_id AND t.kind = 'task'
            WHERE w.task_id = ${link.taskId} AND w.device_id = ${instance.deviceId} AND w.access = 'write'
            ORDER BY w.id = (SELECT c.workspace_id FROM repository_changes c WHERE c.pull_request_url = ${seen.url} LIMIT 1) DESC,
              b.created_at, b.rowid
            LIMIT 1`
          if (workspace === undefined) return
          // Into the repository a fork came from, its branch is upstream's; otherwise origin's, as `git fetch` names them.
          const fork = yield* namedRemotes(workspace.path).pipe(
            Effect.map(forkOf),
            Effect.orElseSucceed(() => null),
          )
          const remote =
            fork !== null && repository.path.join('/').toLowerCase() === fork.upstream.path.join('/').toLowerCase() ? 'upstream' : 'origin'
          const ref = `${remote}/${now.target}`
          const target = yield* fetchInto(workspace.path, yield* host.pushTarget(repository), now.target, `refs/remotes/${ref}`)
          const from = yield* commitOf(workspace.path, 'HEAD').pipe(Effect.orElseSucceed(() => null))
          if (target === null || from === null) return
          const merged = yield* gitOutcome(workspace.path, 'merge-tree', '--write-tree', '--name-only', '--no-messages', target, from)
          if (merged.code === 0) return
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
          const logs: Array<string> = []
          for (const check of all.filter((candidate) => candidate.state === 'failed').slice(0, LOGS_TO_LEAD)) {
            const log = yield* host.checkLog(repository, check).pipe(Effect.orElseSucceed(() => null))
            if (log !== null) logs.push(logOf(check.name, log))
          }
          // The lead takes a place among the agents at work on this machine to fix them, or the round keeps its ask and waits for one.
          const body = fixNoteFor(place, { failing: sum.failing, logs })
          const why = { failing: sum.failing }
          const room = yield* busy.enter(round.taskId, (room) =>
            Effect.gen(function* () {
              const since = yield* timestamp
              const waiting = room
                ? {}
                : { waiting: JSON.stringify({ attempt: round.attempt + 1, body, why, since } satisfies RoundWaiting) }
              yield* reviseRound(round, 'conflict_resolution.checks_failed', { state: 'resolving', ...waiting }, why)
              return room
            }),
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

      /** The person stopped or interrupted a task's lead: what it was resolving waits for them, and checks that fail don't ask it again. */
      const leadStopped = (taskId: string, how: 'stopped' | 'interrupted') =>
        Effect.gen(function* () {
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

      const onLive = (event: LiveEvent) =>
        look(event, false).pipe(
          Effect.catchCause((cause) => Effect.logWarning('Could not look at a conflict the lead was resolving', cause)),
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
            for (const round of open)
              yield* locked(round.taskId)(settleRound(round.id, { why: 'Althar stopped while the lead was resolving it.' }))
            // Waiting for checks on a pull request no longer listened to, nothing would end it.
            const unheard = yield* sql<{ id: string; taskId: string }>`
              SELECT c.id, c.task_id FROM conflict_resolutions c WHERE c.state = 'checking' AND NOT EXISTS (
                SELECT 1 FROM external_links l WHERE l.task_id = c.task_id AND l.kind = 'change' AND l.listening = 1
                  AND json_extract(l.snapshot, '$.url') = c.pull_request_url)`
            for (const round of unheard) yield* locked(round.taskId)(unfollowed(round.id))
          }),
        ).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not look at the conflicts leads were resolving', cause))),
      )

      yield* busy.queue(provide(roundsWaiting))

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
              if (!listenDue({ now, polledAt: polledAt.get(link.id), newsAt: newsAt.get(link.taskId) ?? now, every })) continue
            }
            polledAt.set(link.id, now)
            yield* listenTo(link, now)
          }
        })

      /** Asks the host about one listened change now; one that can't be asked waits, as long as its service says or a while. */
      const listenTo = (link: LinkRow, now: number) =>
        locked(link.taskId)(poll(link)).pipe(
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
       * A task's conflicts, looked for now where its lead is to resolve them
       * (`askable`): its repositories here are merged with their default
       * branches without anything moving, and those that conflict start a
       * round, as pressing Merge would; then its listened pull requests are
       * asked about, and one whose host says it conflicts starts one as ever.
       * One round at a time, so a task conflicting both ways starts with what
       * conflicts here.
       */
      const conflictsNow = (task: { readonly taskId: string; readonly projectId: ProjectId; readonly threadId: string }) =>
        Effect.gen(function* () {
          const { taskId } = task
          yield* locked(taskId)(
            Effect.gen(function* () {
              if ((yield* askable(taskId, null)) !== 'yes') return
              const found: Array<Conflict> = []
              for (const repository of yield* repositoriesHere(taskId)) {
                if (repository.opened !== 0) continue
                // A branch git can't read says nothing conflicts.
                const head = yield* commitOf(repository.worktree, 'HEAD').pipe(Effect.orElseSucceed(() => ''))
                const files = yield* conflictsOf(repository.root, repository.base, head)
                if (files.length > 0) found.push(yield* conflictHere(repository, files))
              }
              if (found.length > 0) yield* beginRound(task, null, found)
            }),
          )
          const now = yield* Clock.currentTimeMillis
          for (const link of yield* linksOf(taskId)) if (link.listening === 1) yield* listenTo(link, now)
        })

      /** Each open task with a branch here, of the project or the one task, looked at now for what already conflicts. */
      const resolveNow = (where: { readonly projectId: string } | { readonly taskId: string }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const open = yield* sql<{ taskId: string; projectId: ProjectId; threadId: string }>`
            SELECT k.id AS task_id, k.project_id, t.id AS thread_id FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task'
            WHERE k.state = 'open'
              AND ${'taskId' in where ? sql`k.id = ${where.taskId}` : sql`k.project_id = ${where.projectId}`}
              AND EXISTS (SELECT 1 FROM workspaces w WHERE w.task_id = k.id AND w.device_id = ${instance.deviceId} AND w.access = 'write')
            ORDER BY k.created_at, k.rowid`
          for (const task of open)
            yield* conflictsNow(task).pipe(
              Effect.catchCause((cause) => Effect.logWarning('Could not look for a conflict to resolve', cause)),
            )
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
              yield* listenOnce(only)
            }),
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
              message: "The task's worktree isn't on this Mac, so Althar can't see what is on its branch. Tell the person.",
            })
          // What the pull request has: its branch as the remote says now, else as its host says, else as Althar last pushed it, else as last seen.
          const tip = yield* remoteTip(workspace.path, yield* pushTargetOf(host, repository, workspace.path), workspace.branch)
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
          return { link, snapshot, where, ahead, left }
        })

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
                  // A review's lead, reading someone else's pull request, never gets here: its tools are a review's (Reviews.ts).
                  if (error instanceof NotFound && error.kind === 'pull request')
                    return Effect.fail(
                      new ToolRefused({ message: 'This task has no pull request yet. Althar opens one when the plan’s steps are done.' }),
                    )
                  if (error instanceof NotConnected || (error instanceof NotFound && error.kind === 'connection'))
                    return Effect.fail(
                      new ToolRefused({
                        message: 'Althar isn’t connected to this repository’s host, so it can’t reach the pull request. Tell the person.',
                      }),
                    )
                  if (error instanceof ConnectorFailed)
                    return Effect.fail(new ToolRefused({ message: `The code host said: ${error.message}` }))
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
                const { link, snapshot, where, ahead, left } = chosen
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
                  ...(left.length === 0 ? [] : [`Not included, since they aren't committed: ${filesWord(left)}.`]),
                ].join(' ')
              }),
            ),
        ),
      ])

      return Changes.of({
        publish: (input) => provide(publish(input)),
        unshipped: (taskId) => provide(unshippedOf(taskId)),
        // Only a task with pull requests: one with none is settled by merging it here, as the person says.
        settleIfMerged: (taskId) =>
          provide(
            locked(taskId)(
              Effect.gen(function* () {
                if ((yield* linksOf(taskId)).length > 0) yield* settleIfDone(taskId)
              }),
            ),
          ),
        push: (taskId, head, url) => provide(locked(taskId)(push(taskId, head, url))),
        replace: (taskId, head, replaces, url) => provide(locked(taskId)(replace(taskId, head, replaces, url))),
        mergeNote: (taskId, url) => provide(locked(taskId)(mergeNote(taskId, url))),
        markReady: (taskId, url) => provide(locked(taskId)(markReady(taskId, url))),
        exclusive: (taskId, effect) => locked(taskId)(effect),
        merge: (taskId, head, url) => provide(locked(taskId)(merge(taskId, head, url))),
        mergeHere: (taskId, heads) => provide(locked(taskId)(branches.withPermits(1)(mergeHere(taskId, heads)))),
        pushHere: (taskId) => provide(locked(taskId)(branches.withPermits(1)(pushHere(taskId)))),
        pushBranch: (taskId, heads) => provide(locked(taskId)(pushBranch(taskId, heads))),
        reply: (taskId, input) => provide(locked(taskId)(reply(taskId, input))),
        read: (taskId) => provide(read(taskId)),
        ofTask: (taskId) => provide(Effect.flatMap(linksOf(taskId), (links) => Effect.forEach(links, summaryOf))),
        stopListening: (taskId, url) => provide(locked(taskId)(stopListening(taskId, url))),
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
        resolveNow: (where) => Effect.asVoid(Effect.forkIn(provide(resolveNow(where)), scope)),
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
