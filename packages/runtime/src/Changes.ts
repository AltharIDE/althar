import { existsSync } from 'node:fs'
import { type CodeHost, ConnectorFailed, type Repository } from '@althar/connectors'
import { knownModelName, standsFor } from '@althar/contracts'
import type { ActorId, CommandEnvelope, ProjectId } from '@althar/domain'
import { Cause, Clock, Context, Duration, Effect, Layer, Option, Queue, Result, Schema, Scope, Semaphore, Stream } from 'effect'
import { SqlClient } from 'effect/sql'
import { Busy } from './Busy'
import { touchCard } from './cards'
import { type ChangeConflictsDependencies, makeChangeConflicts } from './changeConflicts'
import { type ChangeHostDependencies, makeChangeHost } from './changeHost'
import { makeChangeLeadTools } from './changeLeadTools'
import { type ChangeListeningDependencies, makeChangeListening, toldOf } from './changeListening'
import { type ChangePublishingDependencies, makeChangePublishing } from './changePublishing'
import {
  type AttachInput,
  type Attached,
  BASE_TURNS,
  type ChangeSummary,
  type ConflictStanding,
  FIX_ROUNDS,
  type Fixing,
  type Hands,
  type Held,
  type Host,
  type LinkRow,
  type OnHost,
  type PublishInput,
  type Published,
  STUCK_AFTER,
  Snapshot,
  type Store,
  UNKNOWN_TURNS,
  type Unshipped,
  couldntRead,
  listenDue,
} from './changeRecords'
import { type ChangeShippingDependencies, makeChangeShipping } from './changeShipping'
import { Agents, RuntimeConfig } from './Config'
import type { Conflict } from './conflicts'
import { Connections, NotConnected } from './Connections'
import { type Memory, coAuthorOn, creditBranch, recallMade, rememberMade, withoutAgentCredit } from './credit'
import { Errands } from './Errands'
import { ChangedSinceSeen, NotFound, ShipRefused } from './errors'
import { taskShown } from './evidence'
import { contained } from './Failures'
import { FastLane } from './fastLane'
import { makeFollowing } from './Follow'
import { commitOf, onHead } from './git'
import { Instance } from './Instance'
import { IssueChanges } from './IssueChanges'
import { makeKeyedLock } from './keyedLock'
import { LeftBehind } from './LeftBehind'
import { Live, type LiveEvent } from './Live'
import { conflictsOf } from './localMerge'
import { Models } from './Models'
import { BETWEEN_AGENTS_MS } from './needsYou'
import { reconcileOutward } from './outward'
import { Policies, resolvesConflictsFor } from './Policies'
import { type SessionNamer, detailsOf, reviewRecordOf, reviewSeal, sealOf, unreviewedNote, unreviewedOf } from './pullRequestReview'
import {
  type PullRequestIssue,
  bodyOf,
  checksForLeadAlone,
  checksGoneForLead,
  checksUnsettledForLead,
  nameOf,
  unreachedLine,
  unsettledLine,
} from './pullRequestWords'
import { RECENT, refreshRemotes } from './recordedRemotes'
import { change, fact, timestamp } from './records'
import { Sessions } from './Sessions'
import { afterOpen, startup } from './startup'
import { ToolRefused } from './toolErrors'
import { ToolServer } from './ToolServer'

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

export class Changes extends Context.Service<
  Changes,
  {
    /**
     * Pushes the task's branch and, unless its ending is to push only, opens
     * its pull request (a draft, or for review); nothing, when the branch has
     * no commits to propose. `again`, it opens the task's next pull request
     * in each repository whose last merged or closed with commits after it,
     * each on a new branch (ADR-034), and refuses where there is none.
     * Call within exclusive(taskId): git checkout and its workspace update must stay together before branch discovery reads them.
     */
    publish(input: PublishInput): Effect.Effect<Published, unknown>
    /**
     * Brings the task's open pull requests in line with the issues it comes
     * from now, as one added or switched to only part of: each description
     * Althar wrote names them in its issue lines, the rest of it as it was,
     * and each tracker links its issue back. In the background; what can't
     * be done is logged, and nothing fails.
     */
    issuesChanged(taskId: string): Effect.Effect<void>
    /**
     * Whether its lead built nothing: it has a branch, with no commits on it, nothing uncommitted but evidence, and no pull
     * request open or merged (one closed with nothing left counts); false where a branch can't be read. Such a change has
     * nothing to open or merge, so it settles as Done, and no pull request is opened for it.
     */
    nothingBuilt(taskId: string): Effect.Effect<boolean, unknown>
    /** The task's repositories whose last pull request merged or closed with commits after it: what a next pull request would have. */
    unshipped(taskId: string, options?: { readonly kept?: boolean }): Effect.Effect<ReadonlyArray<Unshipped>, unknown>
    /**
     * Whether the task's change is in Althar's hands (ADR-040), as `handsOf`
     * says: null where it isn't; else how often its checks failed, whether
     * they run now, and whether Althar gave it to the person once they failed
     * again after `FIX_ROUNDS` fixes.
     */
    inHands(taskId: string): Effect.Effect<Hands | null, unknown>
    /**
     * Where the checks that failed on the task's open pull requests stand,
     * whoever has looked (ADR-070): null for a settled task, or one with none
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
     * The task's worktrees here held for Ship (a task is a conversation plus
     * parts, "A tweak waits for Ship"): what the person's turns with its lead
     * committed after its plan waits on the branch, and only Ship pushes it.
     */
    holds(taskId: string): Effect.Effect<ReadonlyArray<Held>, unknown>
    /**
     * Ship's push, after its review: each of the task's open pull requests
     * takes its branch up to its head here, past the hold. What went where.
     */
    shipToOpen(
      taskId: string,
      only?: ReadonlyArray<string>,
      heads?: Readonly<Record<string, string>>,
    ): Effect.Effect<
      ReadonlyArray<{ readonly where: string; readonly count: number; readonly url: string; readonly change: string | null }>,
      unknown
    >
    /**
     * The task's changes with something for Ship (a task is a conversation plus parts, "Each change ships and is followed on
     * its own"): held, ahead of their pull request, or with work in none yet; by workspace, the bottom of each stack first.
     * Of one change, by name: it and what waits beneath it in its stack.
     */
    waitingChanges(
      taskId: string,
      change?: string,
    ): Effect.Effect<ReadonlyArray<{ readonly id: string; readonly name: string | null }>, unknown>
    /** What Ship would send to the task's open pull requests now, by pull request, sending nothing. */
    aheadOfOpen(taskId: string): Effect.Effect<ReadonlyArray<{ readonly where: string; readonly count: number }>, unknown>
    /**
     * Whether what waits for the task's open pull requests only brings their
     * base branch in, as a merge of main that settled no conflict does: none of
     * it is the task's work (`onlyBase`), and something waits. False where any
     * of it is the task's own, or a hold waits on a worktree with no open pull
     * request to measure it against.
     */
    onlyBaseWaits(taskId: string): Effect.Effect<boolean, unknown>
    /**
     * Whether the task stepped back from its pull request to end on its branch (a change made a prototype or a chat), leaving
     * the one it has open as it is: then nothing pushes to it, not a lead's commits, a turn's end or Ship, until it ends in a
     * pull request again.
     */
    keptOpen(taskId: string): Effect.Effect<boolean, unknown>
    /**
     * Sends what only brings the base branch in up to the task's open pull
     * requests, with no review, past the hold, and says so in the task's
     * thread: the task stays where it was. What went where.
     */
    sendBaseOnly(taskId: string): Effect.Effect<ReadonlyArray<{ readonly where: string; readonly count: number }>, unknown>
    /** Lets go of the task's holds for Ship: what waited went up (`shipped`), or the person left it on the branch (`left`). */
    releaseHolds(
      taskId: string,
      why: 'shipped' | 'left',
      only?: ReadonlyArray<string>,
      heads?: Readonly<Record<string, string>>,
    ): Effect.Effect<void, unknown>
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
     * isn't merged. Agents never merge. Refused (ShipRefused) while commits
     * on its branch wait for Ship: the person's word for them is Ship,
     * Review and merge, or Merge now, never a plain merge without them.
     */
    merge(taskId: string, head: string, url?: string, bypassQueue?: boolean): Effect.Effect<void, unknown>
    /** Whether this pull request leaves commits held for Ship behind if merged as it stands. Read under exclusive when acting. */
    waitsForShip(taskId: string, url?: string): Effect.Effect<boolean, unknown>
    /**
     * Merges the task's pull request at the head its host has now, where the
     * person's word covered what waited and has just gone up: Review and merge
     * once its review passed, or Merge now (a task is a conversation plus
     * parts, "Merge, with commits not shipped"). `stands`, where given, is
     * read in the transaction that records the merge's intent, after the lock
     * and the host's reads, as the last thing before the merge request: its
     * failure sends none, and is mergeAsItStands' (a Ship's route, changed by
     * RouteShip while its merge stop read the host).
     */
    mergeAsItStands(taskId: string, url: string, stands?: Effect.Effect<void, unknown>): Effect.Effect<void, unknown>
    /**
     * Points a running task's change at another branch to work toward, or back at its repository's default with null (a
     * task is a conversation plus parts, "Changing the branch a task works toward"), between its lead's turns. Nothing pushed
     * yet, its branch is rebased onto the new one; a conflict stops the rebase, which is its lead's to finish. Pushed, its
     * own commits are cherry-picked onto a fresh branch from the new one, and the old pull request is no longer followed:
     * the caller opens the new one where nothing holds it for Ship. What it did, for each repository, in words; the
     * workspaces whose new pull request is to open; and the files a rebase or the cherry-picks stopped on.
     */
    /** Keep them together: one change's commits carried onto another of the task's, before either ships; its folder goes. */
    joinChanges(taskId: string, change: string, into: string | null, actorId: ActorId): Effect.Effect<void, unknown>
    /** Drop it: a change's folder goes, what it hadn't committed committed first; its branch and pull request stay. */
    dropChange(taskId: string, change: string, actorId: ActorId): Effect.Effect<void, unknown>
    /** A task's only worktree removed: it moves down to a copy, its branch keeping all its work. */
    leaveWorktree(taskId: string, actorId: ActorId): Effect.Effect<void, unknown>
    retarget(
      taskId: string,
      toward: string | null,
      change?: string | null,
    ): Effect.Effect<
      { readonly said: ReadonlyArray<string>; readonly opens: ReadonlyArray<string>; readonly conflicts: ReadonlyArray<string> },
      unknown
    >
    /**
     * Merges the task's branch into each of its repositories' default
     * branches on this Mac, up to the commit the person saw in each, where it
     * has no pull request: all of them or none, and nothing pushed. Its task
     * settles. `stands`, where given, runs once the merge holds the task's and
     * the branches' locks, before it reads or writes anything: the word it was
     * asked on, which a wait for those locks may have outlived, checked again.
     */
    mergeHere(
      taskId: string,
      heads: ReadonlyArray<{ readonly repository: string; readonly head: string }>,
      stands?: Effect.Effect<unknown, unknown>,
    ): Effect.Effect<ReadonlyArray<{ readonly repository: string; readonly branch: string; readonly already: boolean }>, unknown>
    /**
     * Pushes each default branch the task merged into here to the remote it
     * follows, with the person's own git sign-in (their keychain or SSH
     * agent), not a code host's: what they would run themselves. `stands`, as
     * mergeHere's, once it holds the locks.
     */
    pushHere(
      taskId: string,
      stands?: Effect.Effect<unknown, unknown>,
    ): Effect.Effect<ReadonlyArray<{ readonly branch: string; readonly remote: string }>, unknown>
    /**
     * Asks the remote of each of a task's branches with no pull request
     * where that branch is, as the person looks at it, in the background:
     * the task's screens read it again once it says (`askedAt`).
     */
    askRemotes(taskId: string): Effect.Effect<void>
    /** The commit a task's worktree was at when its branch's remote last said where that branch is, this launch; null before. */
    askedAt(worktree: string, branch: string): Effect.Effect<string | null>
    /**
     * Whether Althar is opening a task's next pull request by itself, a round of work ended after its last merged or closed
     * (ADR-034): under way, not the person's, until it opens or can't. This launch only, as the opening is.
     */
    openingNext(taskId: string): Effect.Effect<boolean>
    /** Says Althar is opening a task's next pull request by itself, from before its round ends (`opening`), or is done with it. */
    opensNext(taskId: string, opening: boolean): Effect.Effect<void>
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
    /**
     * Gives the task's open pull request at `url` (else its current one)
     * another title, description, or both, and the task's title follows its
     * pull request's: `title` is the words alone, which the project's naming
     * puts the issue's key and the like around, and the task is called by;
     * `body` is the description's own part, which what Althar put around it
     * (the review, the issue, its credit) stays around. The agents' credit
     * goes from both. Says, in words for an agent, what it set; refused, in
     * those words, where it can't, a host's own words included.
     */
    edit(
      taskId: string,
      edit: { readonly title?: string; readonly body?: string; readonly url?: string },
      by: ActorId,
    ): Effect.Effect<string, unknown>
    /**
     * Gives each open pull request Althar opened for the task the title the
     * task has now, by the project's naming, where it has another: after
     * the person or the coordinator renamed the task. What it did, or
     * couldn't, a line each; nothing where no pull request needed it.
     */
    followTitle(taskId: string): Effect.Effect<ReadonlyArray<string>>
    /** As `followTitle`, in the background: what the host refused is said in the task's thread. */
    followTitleLater(taskId: string): Effect.Effect<void>
    /**
     * Sets the descriptions the lead just gave, by repository slug, on the
     * task's pull requests open already, which were described when they
     * opened: the lead's part, what Althar put around it staying. One changed
     * on its host since Althar last set it is left as it is. A line each for
     * the lead, where there is something to say.
     */
    redescribe(taskId: string, given: Readonly<Record<string, string>>, built: string | null): Effect.Effect<ReadonlyArray<string>>
    /** The pull request as it stands, in words for an agent: its state, checks (a failure's log), and what was said. */
    read(taskId: string): Effect.Effect<string, unknown>
    /** The task's changes, as last seen. */
    ofTask(taskId: string): Effect.Effect<ReadonlyArray<ChangeSummary>, unknown>
    /**
     * The task's pull request at `url`, with its host and repository, as the
     * person's actions on it reach them: fails where Althar isn't connected
     * to its host.
     */
    pullRequest(taskId: string, url: string): Effect.Effect<OnHost, unknown>
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
     * why (`unsent`); waiting on the checks of the merge it pushed
     * (`checking`); or conflicting, as its host last said, and about to be
     * asked of its lead (`due`). Null otherwise.
     */
    conflictStanding(taskId: string): Effect.Effect<ConflictStanding | null>
    /**
     * Where the project's rules push its leads' commits on their own
     * (ADR-072), how each of the task's pull requests stands, by its address:
     * `held` null while what its lead committed goes up as its turn ends, else
     * why it waits for the person's push. `ship` where it waits on a branch
     * held for Ship, whatever the rules: Ship alone sends it up. Null where
     * every push is the person's, or the task is settled.
     */
    pushing(taskId: string): Effect.Effect<ReadonlyMap<string, { readonly held: string | null; readonly ship?: boolean }> | null>
    /**
     * Pushes what each open task's lead committed and left waiting, of one
     * project, or of all, where their rules push it on its own (ADR-072): as
     * the rules are newly turned so, and at launch, for what a turn that
     * ended meanwhile left. Done apart: this returns before any is pushed.
     */
    pushNow(where: { readonly projectId?: string }): Effect.Effect<void>
    /** Does something with a task's pull request as one action: one at a time with replying, pushing, marking ready and merging. */
    exclusive<A, E, R>(taskId: string, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R>
    /**
     * How a task of the project ends when its plan doesn't say, worked out
     * once, when the plan is made: as the project's rules say, else a draft
     * pull request where its repository's host is connected, else on its
     * branch. A project that wants a pull request where no host Althar
     * knows is named ends on its branch, as it always has. `fresh` reads
     * the repositories' remotes from git first, and waits for them: where a
     * run's ending is decided, never where a screen reads it.
     */
    endFor(projectId: string, taskId?: string, fresh?: boolean): Effect.Effect<'draft' | 'ready' | 'none' | null, unknown>
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
      const leftBehind = yield* LeftBehind
      const busy = yield* Busy
      const toolServer = yield* ToolServer
      const agents = yield* Agents
      const models = yield* Models
      const live = yield* Live
      const scope = yield* Scope.Scope
      const issueChanges = yield* IssueChanges
      const fastLane = yield* FastLane
      /** Offers to move a task's issue along with its pull request, in the background: nothing it meets holds the pull request up. */
      const follow = (taskId: string, event: 'opened' | 'merged', change: Parameters<typeof nameOf>[0] & { readonly url: string }) =>
        Effect.asVoid(Effect.forkIn(issueChanges.followPullRequest(taskId, event, { key: nameOf(change), url: change.url }), scope))
      const every = (yield* RuntimeConfig).listenEvery ?? Duration.seconds(30)
      // How long after its lead's turn ended its commits are still going up (DEV-173).
      const goingFor = Duration.toMillis((yield* RuntimeConfig).betweenAgents ?? Duration.millis(BETWEEN_AGENTS_MS))
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
      /** Names a session's model as people know it ("GPT-6.1 Sol"), its agent's own default as the model it stands for; else its id, or its agent. */
      const sessionNamer = Effect.map(
        Effect.orElseSucceed(models.catalog, () => []),
        (catalog): SessionNamer =>
          (session) => {
            const agent = {
              id: session.agentId,
              name: agents.list.find((one) => one.definition.id === session.agentId)?.definition.name ?? session.agentId,
            }
            const offered = catalog.find((one) => one.agentId === session.agentId)?.models ?? []
            const model = offered.find((one) => one.id === standsFor(offered, session.model))
            return model === undefined ? (session.model ?? agent.name) : knownModelName(agent, model)
          },
      )

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
      /** A saved accepted endpoint, allowing only the rewrite Althar itself credited, still on this branch. */
      const acceptedHead = (taskId: string, path: string, pinned: string) =>
        Effect.gen(function* () {
          const made = (yield* memory.recall([pinned])).get(pinned)
          for (const head of made === undefined ? [pinned] : [made, pinned]) if (yield* onHead(path, head)) return head
          return yield* new ChangedSinceSeen({ taskId, what: 'branch' })
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
      /*
       * Pull requests, by their link, whose branch here merged cleanly with what they go into, last Althar looked: at which head,
       * and whether the host said then that they conflict. Said so, and merging cleanly all the same, nothing goes to the lead
       * while the head is the same, so the task's card isn't on its way back to work (`dueOf`).
       */
      const cleanHere = new Map<string, { readonly head: string | null; readonly hostSaid: boolean }>()
      /* Where each repository's default branch was when last fetched to look for conflicts, and when, by binding and ref. */
      const fetchedAt = new Map<string, { readonly at: number; readonly tip: string }>()
      /* How often a default branch is fetched at most to look for conflicts with what goes into it: a few listening turns. */
      const baseEvery = Duration.toMillis(every) * BASE_TURNS
      /* Pull requests whose host hasn't worked out yet whether they conflict, by how many turns running: asked again next turn. */
      const unknownFor = new Map<string, number>()
      /*
       * Conflicts the sweep found, by their pull request's link: what it would merge, and from what. Handed to a poll of the pull
       * request first, which hears its checks with it; still there at the next sweep, the sweep asks the lead itself.
       */
      const sweptConflicts = new Map<string, string>()
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
        issue: ReadonlyArray<PullRequestIssue>,
        repository: { readonly slug: string; readonly template: string | null },
        since: string | null = null,
        review: { readonly seal: string | null; readonly details: string | null; readonly note?: string | null } | null = null,
        /** What a next pull request says where the lead wrote nothing since the last: its finding and its commits (`followUpOf`). */
        fallback: { readonly text: string; readonly answers: boolean } | null = null,
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
            // Its finding and commits come first where it answers one: the lead's summary of the task doesn't say why this exists.
            ...(fallback === null ? {} : fallback.answers ? { ahead: fallback.text } : { fallback: fallback.text }),
            issue,
            template: repository.template,
            written: written === undefined || written.text === null ? null : withoutAgentCredit(written.text, agentNames),
            credit: yield* coAuthorOn,
            automation: automated?.name ?? null,
            review,
          })
        })

      /**
       * What the pull request says of the review its change had, where the
       * person has it on and the run had one: the folded section, and the
       * seal where the host shows one (pullRequestReview.ts); and, whatever
       * the person has on, a note where the task went on with fixes no review
       * read. Nothing it can't read holds the pull request up: it opens without it.
       */
      const reviewFor = (input: {
        readonly runId: string
        readonly workspaceId: string
        readonly cwd: string
        readonly end: string
        readonly github: boolean
      }) =>
        Effect.gen(function* () {
          const setting = yield* reviewSeal
          // A task that went on with fixes no review read says so, whatever the person chose to show of the review.
          const unreviewed = yield* unreviewedOf(input.runId)
          // The fold and seal are optional: a failure to read them leaves the note, which is not.
          const record = !setting.on
            ? null
            : yield* reviewRecordOf({ ...input, named: yield* sessionNamer, sent: memory.recall }).pipe(
                Effect.catchCause((cause) => Effect.as(Effect.logWarning('The pull request opens without its review record', cause), null)),
              )
          const note = unreviewed ? unreviewedNote(record?.passes ?? null) : null
          if (record === null) return note === null ? null : { seal: null, details: null, note }
          return { seal: input.github ? sealOf(setting.style, record) : null, details: detailsOf(record), note }
        }).pipe(Effect.catchCause((cause) => Effect.as(Effect.logWarning('The pull request opens without its review', cause), null)))

      /** The hosts of a project's repositories, or of those a task changes, the first first: null for each on none Althar knows. */
      const hostsFor = (projectId: string, taskId?: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          // Its repositories' remotes read again from their clones, apart: one added while Althar runs is found on the next read, and a card
          // read never waits on git. Publishing and a run's ending read them first, and wait.
          yield* Effect.forkIn(provide(refreshRemotes(instance.deviceId, taskId === undefined ? { projectId } : { taskId }, RECENT)), scope)
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
      // Callbacks across change operations are read when the operation runs, after the layer has initialized.
      const {
        attach,
        dropChange,
        heldBelow,
        issuesChanged,
        joinChanges,
        keptOpenOf,
        leaveWorktree,
        lineIn,
        publish,
        retarget,
        saveSnapshot,
        stopListening,
      } = makeChangePublishing({
        acceptedHead,
        agentNames,
        bodyFor,
        get branchRepositoryOf(): ChangePublishingDependencies['branchRepositoryOf'] {
          return branchRepositoryOf
        },
        connections,
        credited,
        current,
        decodeSnapshot,
        get editOnHost(): ChangePublishingDependencies['editOnHost'] {
          return editOnHost
        },
        follow,
        hostOfRemotes,
        instance,
        get issueKeyOf(): ChangePublishingDependencies['issueKeyOf'] {
          return issueKeyOf
        },
        get lastSetBody(): ChangePublishingDependencies['lastSetBody'] {
          return lastSetBody
        },
        linksOf,
        news,
        get refusal(): ChangePublishingDependencies['refusal'] {
          return refusal
        },
        reviewFor,
        get sentTo(): ChangePublishingDependencies['sentTo'] {
          return sentTo
        },
        sessions,
        signInLostAt,
        get tellLead(): ChangePublishingDependencies['tellLead'] {
          return tellLead
        },
        get tipBeforePush(): ChangePublishingDependencies['tipBeforePush'] {
          return tipBeforePush
        },
        get unfollowed(): ChangePublishingDependencies['unfollowed'] {
          return unfollowed
        },
        get unshippedOf(): ChangePublishingDependencies['unshippedOf'] {
          return unshippedOf
        },
        get wakeNow(): ChangePublishingDependencies['wakeNow'] {
          return wakeNow
        },
      })
      const {
        aheadOf,
        asCredited,
        askRemotes,
        askedOf,
        asking,
        behindAny,
        bottomUp,
        branchRepositoryOf,
        bringInWaiting,
        close,
        conflictHere,
        edit,
        editOnHost,
        followTitle,
        followTitleLater,
        issueKeyOf,
        lastSetBody,
        markReady,
        merge,
        mergeHere,
        mergeNote,
        nextOpening,
        push,
        pushBranch,
        pushHere,
        pushTag,
        pushTagOnWord,
        pushTargetOf,
        redescribe,
        refusal,
        remotesAsked,
        replace,
        reply,
        repositoriesHere,
        retargetAbove,
        seenNow,
        sentTo,
        settleAsked,
        stampMerged,
        tipBeforePush,
        waitingOn,
        worktreeOf,
      } = makeChangeHost({
        agentNames,
        get arrive(): ChangeHostDependencies['arrive'] {
          return arrive
        },
        get askable(): ChangeHostDependencies['askable'] {
          return askable
        },
        baseMoved,
        get beginRound(): ChangeHostDependencies['beginRound'] {
          return beginRound
        },
        connections,
        credited,
        current,
        decodeSnapshot,
        fastLane,
        follow,
        get forgetUnsent(): ChangeHostDependencies['forgetUnsent'] {
          return forgetUnsent
        },
        get heard(): ChangeHostDependencies['heard'] {
          return heard
        },
        heldBelow,
        get holdBeforePush(): ChangeHostDependencies['holdBeforePush'] {
          return holdBeforePush
        },
        hostOfRemotes,
        instance,
        lineIn,
        linksOf,
        locked,
        memory,
        news,
        get poll(): ChangeHostDependencies['poll'] {
          return poll
        },
        provide,
        get pushLeft(): ChangeHostDependencies['pushLeft'] {
          return pushLeft
        },
        get remotesOf(): ChangeHostDependencies['remotesOf'] {
          return remotesOf
        },
        saveSnapshot,
        get sayOn(): ChangeHostDependencies['sayOn'] {
          return sayOn
        },
        scope,
        sessions,
        get settleIfDone(): ChangeHostDependencies['settleIfDone'] {
          return settleIfDone
        },
        summaryOf,
        get tellLead(): ChangeHostDependencies['tellLead'] {
          return tellLead
        },
        get urlsOf(): ChangeHostDependencies['urlsOf'] {
          return urlsOf
        },
        get wakeNow(): ChangeHostDependencies['wakeNow'] {
          return wakeNow
        },
      })
      const {
        arrive,
        checksSent,
        fixesOf,
        fixingOn,
        handsOf,
        heard,
        leadRanAgain,
        poll,
        publishing,
        ranAgain,
        read,
        roundUnderWay,
        sayOn,
        shortNameOf,
        tellLead,
        urlsOf,
        withdrawChecks,
      } = yield* makeChangeListening({
        askedOf,
        baseMoved,
        behindAny,
        bringInWaiting,
        get checked(): ChangeListeningDependencies['checked'] {
          return checked
        },
        checksAppear,
        connections,
        current,
        decodeSnapshot,
        fastLane,
        follow,
        get forgetUnsent(): ChangeListeningDependencies['forgetUnsent'] {
          return forgetUnsent
        },
        instance,
        linksOf,
        get lookAt(): ChangeListeningDependencies['lookAt'] {
          return lookAt
        },
        mergeNote,
        pushTargetOf,
        retargetAbove,
        saveSnapshot,
        scope,
        sentTo,
        sessions,
        settleAsked,
        get settleIfDone(): ChangeListeningDependencies['settleIfDone'] {
          return settleIfDone
        },
        stampMerged,
        stuckAfter,
        get taken(): ChangeListeningDependencies['taken'] {
          return taken
        },
        get tellUntold(): ChangeListeningDependencies['tellUntold'] {
          return tellUntold
        },
        unknownFor,
        waitingOn,
        worktreeOf,
      })
      const {
        followTurns,
        heldOf,
        holdAfterRestart,
        holdBeforePush,
        holdHands,
        holdPush,
        holdsOf,
        leaveOut,
        lookAtCommits,
        mergeOf,
        nothingBuiltOf,
        onlyBaseWaitsOf,
        pushFailed,
        pushLeft,
        pushNow,
        pushesFor,
        pushingOf,
        releaseHolds,
        remotesOf,
        sendBaseOnly,
        settleIfDone,
        shipToOpen,
        unshippedOf,
        waitingChanges,
        waitsForShip,
      } = makeChangeShipping({
        acceptedHead,
        aheadOf,
        asCredited,
        attach,
        bottomUp,
        get busyUpTo(): ChangeShippingDependencies['busyUpTo'] {
          return busyUpTo
        },
        connections,
        current,
        decodeSnapshot,
        goingFor,
        heard,
        hostOfRemotes,
        instance,
        keptOpenOf,
        leftBehind,
        linksOf,
        locked,
        provide,
        publishing,
        push,
        pushTargetOf,
        get reportsWithin(): ChangeShippingDependencies['reportsWithin'] {
          return reportsWithin
        },
        roundUnderWay,
        sayOn,
        scope,
        sentTo,
        sessions,
        worktreeOf,
      })
      const {
        askable,
        beginRound,
        busyUpTo,
        checked,
        failedOn,
        forgetUnsent,
        look,
        lookAt,
        notSent,
        reportsWithin,
        resumeRound,
        roundsWaiting,
        sayingWhy,
        standingOfRound,
        stoppedRounds,
        taken,
        unfollowed,
      } = yield* makeChangeConflicts({
        baseEvery,
        busy,
        cleanHere,
        decodeSnapshot,
        fetchedAt,
        fixingOn,
        heard,
        instance,
        locked,
        logged,
        pressed,
        provide,
        push,
        ranAgain,
        sayOn,
        scope,
        sessions,
        stuckAfter,
        sweptConflicts,
        unsent,
        urlsOf,
        get wakeNow(): ChangeConflictsDependencies['wakeNow'] {
          return wakeNow
        },
        worktreeOf,
      })

      /**
       * The failing checks on a task's open pull requests its lead was told
       * to see through (ADR-070) and did nothing with that shows: no fix
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

      /**
       * Failing checks on a pull request's head that are its lead's to see
       * through (ADR-070), with nothing on its thread since they failed
       * (`untold`): a look at the pull request heard them, kept that it told
       * the lead, and ended before it did, so the next look heard nothing new
       * and the lead was never told, nor the person. Its lead is told now,
       * started again if it must be; where that fails, they are the
       * person's, with a line saying so. Never neither.
       */
      const tellUntold = (link: LinkRow, name: string, host: CodeHost, repository: Repository, base: string) =>
        Effect.gen(function* () {
          const fixing = yield* fixingOn(link)
          if (fixing === null || !fixing.unreached || fixing.running) return
          const sql = yield* SqlClient.SqlClient
          const [row] = yield* sql<{ snapshot: string; url: string }>`
            SELECT snapshot, json_extract(snapshot, '$.url') AS url FROM external_links WHERE id = ${link.id}`
          if (row === undefined) return
          const snapshot = yield* decodeSnapshot(row.snapshot)
          const sum = snapshot.checks
          if (sum == null || sum.sha !== snapshot.headSha || sum.outcome !== 'failed') return
          const told = yield* Effect.gen(function* () {
            // Told already, its message waiting for a lead whose session never started, or went: started again for it, not told twice.
            const waiting = (yield* checksSent(link.id)).find((one) => one.state === 'queued')
            if (waiting !== undefined) {
              return Option.isSome(yield* sessions.running(waiting.threadId)) || (yield* sessions.startLast(waiting.threadId))
            }
            const failed = yield* failedOn(link, host, repository)
            const logs = failed?.logs ?? []
            const reran = yield* ranAgain(link, sum.sha)
            const workspace = yield* worktreeOf(link.taskId, row.url).pipe(Effect.orElseSucceed(() => undefined))
            const branch = workspace === undefined ? null : yield* commitOf(workspace.path, 'HEAD').pipe(Effect.orElseSucceed(() => null))
            yield* heard(link, 'checks_told', `told:${sum.sha}${reran?.again ?? ''}`, { sha: sum.sha, branch })
            return yield* tellLead(
              link,
              [checksForLeadAlone({ ...sum, list: sum.list ?? [] }, name, logs, FIX_ROUNDS - fixing.failed + 1, base)],
              true,
            )
          }).pipe(Effect.catchCause((cause) => Effect.as(Effect.logWarning('Could not tell the lead its checks failed', cause), false)))
          if (told) return
          // The person's, with the line saying so, or neither: kept together, so a hand-off is never left without its line.
          const why = unreachedLine(sum.failing)
          const at = yield* timestamp
          yield* sql.withTransaction(
            Effect.all([
              heard(link, 'checks_handed', `handed:${sum.sha}:${at}`, { sha: sum.sha, why }),
              withdrawChecks(link.id),
              sayOn(link, why),
            ]),
          )
          yield* touchCard(link.taskId)
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
          Effect.andThen(
            look(event, false).pipe(
              Effect.catchCause((cause) => Effect.logWarning('Could not look at a conflict the lead was resolving', cause)),
            ),
            lookAtChecks(event, false).pipe(
              Effect.catchCause((cause) => Effect.logWarning('Could not look at the checks the lead was to fix', cause)),
            ),
          ),
          Effect.andThen(
            lookAtCommits(event).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not look at what the lead committed', cause))),
            followTurns(event).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not follow what the lead did with git', cause))),
          ),
        )

      yield* Effect.forkScoped(provide(Stream.runForEach(yield* live.subscribe, onLive)))
      // As a lead's turn begins, before it reads anything, what the person committed by hand since its last is held first.
      yield* sessions.onLeadTurn((lead) => provide(holdHands(lead.taskId)).pipe(Effect.ignore))

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

      // What a lead committed as an earlier launch ended goes up now, where its project's rules push it on its own (ADR-072).
      // What a turn the person began committed before Althar stopped is held for Ship first, as its end would have: a turn cut
      // short by the stop ends with no event to hold it by, and nothing it committed may go up before Ship.
      yield* Effect.forkScoped(afterOpen(provide(Effect.andThen(holdAfterRestart, pushNow({})))))

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
      yield* Effect.forkScoped(afterOpen(startup('settled-pull-requests', readSettled)))

      // Each repository's remotes as its clone has them, once a launch: a remote added since is known.
      yield* Effect.forkScoped(afterOpen(startup('repository-remotes', provide(refreshRemotes(instance.deviceId, 'all')))))

      // A review after a merge that didn't start is tried again, at once and with each listening turn, until it does.
      yield* Effect.forkScoped(afterOpen(startup('reviews-after-merge', fastLane.retryPendingReviews())))

      // What an earlier launch was doing outside when it stopped is uncertain until read back or asked for again.
      yield* provide(reconcileOutward).pipe(
        Effect.catchCause((cause) => Effect.logWarning('Could not reconcile what was being done outside', cause)),
      )

      /* Listening: each listened change is asked about when its time comes, sooner when its task asks, later when its service says to wait. */
      const waitUntil = new Map<string, number>()
      const wake = yield* Queue.sliding<string | null>(16)
      const wakeNow = (taskId: string | null) => void Queue.offerUnsafe(wake, taskId)

      /** Every open pull request in the project's repositories, for news: asked in these same turns, as much as the hosts' allowances let. */
      const following = makeFollowing({ every, due: listenDue })
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
            for (const id of sweptConflicts.keys()) if (!links.has(id)) sweptConflicts.delete(id)
            for (const id of newsAt.keys()) if (!tasks.has(id)) newsAt.delete(id)
            yield* following.tick.pipe(contained('Changes.follow', () => undefined))
          }
        })

      /** Asks the host about one listened change now; one that can't be asked waits, as long as its service says or a while. */
      const listenTo = (link: LinkRow, now: number, how?: { readonly force: boolean; readonly fresh: boolean }) =>
        locked(link.taskId)(
          Effect.gen(function* () {
            // A stop may have held the lock while this turn chose its links. Honour it before asking the host.
            const current = (yield* linksOf(link.taskId)).find((one) => one.id === link.id)
            return current?.listening === 1 ? yield* poll(current, how) : false
          }),
        ).pipe(
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
            // Turned off, a branch merging here is the person's: Merge says it conflicts, as ever.
            if (first === 'off' || first === 'resolving' || first === 'checking' || (typeof first === 'object' && first.off === true))
              return
            const found: Array<Conflict> = []
            // Why a branch couldn't be looked at here: no conflict found isn't none there.
            let couldnt: string | null = null
            for (const repository of yield* repositoriesHere(task.taskId)) {
              if (repository.opened !== 0) continue
              const read = yield* commitOf(repository.worktree, 'HEAD').pipe(Effect.result)
              if (Result.isFailure(read)) {
                if (existsSync(repository.worktree))
                  yield* Effect.logWarning('Could not read the branch a task works on', Cause.fail(read.failure))
                couldnt ??= existsSync(repository.worktree)
                  ? couldntRead(read.failure)
                  : `Its folder isn’t on this computer, so Althar can’t merge ${repository.base} into it here.`
                continue
              }
              const head = read.success
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
      const errands = yield* Errands
      const sweep = Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        for (const project of yield* sql<{ id: string }>`SELECT id FROM projects WHERE archived_at IS NULL`)
          yield* errands.remind(project.id).pipe(contained('Errands.remind', () => undefined))
        const links = yield* sql<{ id: string; taskId: string }>`
          SELECT id, task_id FROM external_links
          WHERE kind = 'change' AND listening = 1 AND json_extract(snapshot, '$.state') = 'open'
            AND project_id IN (SELECT id FROM projects WHERE archived_at IS NULL)
          ORDER BY created_at`
        for (const listed of links)
          yield* locked(listed.taskId)(
            Effect.gen(function* () {
              // Read again once it has the task's lock: a look that held it meanwhile may have heard more of it, such as its
              // host saying now that it conflicts, and what the sweep read before it waited would undo that.
              const link = (yield* linksOf(listed.taskId)).find((one) => one.id === listed.id)
              if (link === undefined || link.listening !== 1) return
              const adapters = yield* connections.adapters(link.connectionId ?? '')
              if (adapters.host === undefined) return
              const before = yield* decodeSnapshot(link.snapshot)
              if (before.state !== 'open' || before.target === undefined) return
              const repository = yield* adapters.host.repository(before.repository)
              yield* lookAt(
                link,
                before,
                { target: before.target, conflicts: before.conflicts, headSha: before.headSha },
                adapters.host,
                repository,
                { force: false, fresh: false, sweep: true },
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
              // A review after a merge that didn't start goes again, before the news of the turn.
              yield* fastLane.retryPendingReviews().pipe(contained('Changes.reviewsAfterMerge', () => undefined))
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
      yield* makeChangeLeadTools({
        agents,
        aheadOf,
        askedOf,
        connections,
        current,
        edit,
        errands,
        fixingOn,
        heard,
        heldOf,
        holdBeforePush,
        holdPush,
        holdsOf,
        instance,
        keptOpenOf,
        leadRanAgain,
        locked,
        provide,
        push,
        pushesFor,
        pushFailed,
        pushTag,
        pushTagOnWord,
        pushTargetOf,
        read,
        reply,
        sayOn,
        sentTo,
        sessions,
        settleAsked,
        shortNameOf,
        toolServer,
        urlsOf,
        wakeNow,
        worktreeOf,
      })

      return Changes.of({
        publish: (input) => provide(publish(input)),
        issuesChanged: (taskId) =>
          Effect.asVoid(
            Effect.forkIn(
              provide(locked(taskId)(issuesChanged(taskId))).pipe(
                Effect.catchCause((cause) => Effect.logWarning('Could not bring a task’s pull requests in line with its issues', cause)),
              ),
              scope,
            ),
          ),
        nothingBuilt: (taskId) => provide(nothingBuiltOf(taskId)),
        unshipped: (taskId, options) => provide(unshippedOf(taskId, options?.kept === true)),
        inHands: (taskId) => provide(handsOf(taskId)),
        fixing: (taskId) =>
          provide(
            Effect.map(fixesOf(taskId), (all) =>
              all.length === 0
                ? null
                : {
                    open: all.some((one) => one.open),
                    running: all.some((one) => one.running),
                    withLead: all.some((one) => one.open && one.failing && !one.untold),
                    untold: all.some((one) => one.untold),
                    onIt: all.some((one) => one.open && !one.untold),
                    why: all.find((one) => one.why !== null)?.why ?? null,
                    spent: all.some((one) => one.given),
                    failuresGo: all.some((one) => one.goes),
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
        // Held for Ship, the person's Push isn't theirs to take: Ship sends what waits, after its review.
        push: (taskId, head, url) =>
          provide(
            locked(taskId)(
              Effect.gen(function* () {
                // Stepped back into prototyping: its pull request stays as it is, whoever asks, until it is a change again.
                if (yield* keptOpenOf(taskId))
                  return yield* new ToolRefused({
                    message:
                      'Nothing pushed: this task ends on its branch now, stepped back from its pull request (as for prototyping), so its pull request stays as it is. Make it a change again (change_part with preset Change, or ending draft or ready) and Ship sends what waits there, after its review.',
                  })
                if ((yield* holdsOf(taskId)).length > 0) return yield* new ShipRefused({ taskId, why: 'held' })
                yield* taken(taskId, 'pushed')
                return yield* push(taskId, head, url)
              }),
            ),
          ),
        holds: (taskId) => provide(holdsOf(taskId)),
        shipToOpen: (taskId, only, heads) => provide(locked(taskId)(shipToOpen(taskId, true, only, heads))),
        waitingChanges: (taskId, change) => provide(waitingChanges(taskId, change)),
        aheadOfOpen: (taskId) => provide(shipToOpen(taskId, false)),
        onlyBaseWaits: (taskId) => provide(onlyBaseWaitsOf(taskId)),
        keptOpen: (taskId) => provide(keptOpenOf(taskId)),
        sendBaseOnly: (taskId) => provide(locked(taskId)(sendBaseOnly(taskId))),
        releaseHolds: (taskId, why, only, heads) => provide(locked(taskId)(releaseHolds(taskId, why, only, heads))),
        replace: (taskId, head, replaces, url) =>
          provide(locked(taskId)(Effect.andThen(taken(taskId, 'pushed'), replace(taskId, head, replaces, url)))),
        mergeNote: (taskId, url) => provide(locked(taskId)(mergeNote(taskId, url))),
        markReady: (taskId, url) => provide(locked(taskId)(markReady(taskId, url))),
        readSettled,
        close: (taskId, url, options) => provide(locked(taskId)(close(taskId, url, options.deleteBranch))),
        exclusive: (taskId, effect) => locked(taskId)(effect),
        waitsForShip: (taskId, url) =>
          provide(
            Effect.gen(function* () {
              for (const link of yield* linksOf(taskId)) {
                const snapshot = yield* Schema.decodeUnknownEffect(
                  Schema.fromJsonString(
                    Schema.Struct({
                      state: Schema.Literals(['open', 'merged', 'closed']),
                      url: Schema.String,
                      headSha: Schema.optional(Schema.NullOr(Schema.String)),
                    }),
                  ),
                )(link.snapshot)
                if (
                  (url === undefined || snapshot.url === url) &&
                  (yield* waitsForShip(taskId, link, { ...snapshot, headSha: snapshot.headSha ?? null }))
                )
                  return true
              }
              return false
            }),
          ),
        merge: (taskId, head, url, bypassQueue) =>
          provide(
            locked(taskId)(
              Effect.gen(function* () {
                const { link, snapshot } = yield* current(taskId, url)
                // Merged as it stands, the pull request would leave out what waits for Ship, unreviewed: Ship, Review and merge, or
                // Merge now, each the person's word for them, take it.
                if (yield* waitsForShip(taskId, link, snapshot)) return yield* new ShipRefused({ taskId, why: 'held' })
                yield* merge(taskId, head, url, bypassQueue)
              }),
            ),
          ),
        retarget: (taskId, toward, change) => provide(locked(taskId)(retarget(taskId, toward, change ?? null))),
        joinChanges: (taskId, change, into, actorId) => provide(locked(taskId)(joinChanges(taskId, change, into, actorId))),
        dropChange: (taskId, change, actorId) => provide(locked(taskId)(dropChange(taskId, change, actorId))),
        leaveWorktree: (taskId, actorId) => provide(locked(taskId)(leaveWorktree(taskId, actorId))),
        mergeAsItStands: (taskId, url, stands) =>
          provide(
            locked(taskId)(
              Effect.gen(function* () {
                const { snapshot, host, repository } = yield* current(taskId, url)
                if (snapshot.state !== 'open') return
                const read = yield* host.change(repository, snapshot.number)
                yield* merge(taskId, read.headSha ?? snapshot.headSha ?? '', url, false, stands)
              }),
            ),
          ),
        mergeHere: (taskId, heads, stands = Effect.void) =>
          provide(locked(taskId)(branches.withPermits(1)(Effect.andThen(stands, mergeHere(taskId, heads))))),
        pushHere: (taskId, stands = Effect.void) =>
          provide(locked(taskId)(branches.withPermits(1)(Effect.andThen(stands, pushHere(taskId))))),
        // Once at a time for a task, whoever looks.
        askRemotes: (taskId) =>
          Effect.suspend(() => {
            if (asking.has(taskId)) return Effect.void
            asking.add(taskId)
            return Effect.asVoid(Effect.forkIn(provide(askRemotes(taskId)), scope))
          }),
        askedAt: (worktree, branch) => Effect.sync(() => remotesAsked.get(`${worktree} ${branch}`) ?? null),
        openingNext: (taskId) => Effect.sync(() => nextOpening.has(taskId)),
        opensNext: (taskId, opening) => Effect.sync(() => void (opening ? nextOpening.add(taskId) : nextOpening.delete(taskId))),
        pushBranch: (taskId, heads) => provide(locked(taskId)(pushBranch(taskId, heads))),
        reply: (taskId, input) => provide(locked(taskId)(reply(taskId, input))),
        edit: (taskId, asked, by) => provide(locked(taskId)(edit(taskId, asked, by))),
        followTitle: (taskId) => provide(locked(taskId)(followTitle(taskId))),
        followTitleLater,
        redescribe: (taskId, given, built) => provide(locked(taskId)(redescribe(taskId, given, built))),
        read: (taskId) => provide(read(taskId)),
        ofTask: (taskId) => provide(Effect.flatMap(linksOf(taskId), (links) => Effect.forEach(links, summaryOf))),
        pullRequest: (taskId, url) =>
          provide(
            Effect.gen(function* () {
              const { link, host, repository, account } = yield* current(taskId, url)
              return {
                linkId: link.id,
                projectId: link.projectId,
                change: yield* summaryOf(link),
                host,
                repository,
                account,
              } satisfies OnHost
            }),
          ),
        stopListening: (taskId, url) => provide(locked(taskId)(stopListening(taskId, url))),
        attach: (input) => provide(locked(input.taskId)(attaching.withPermits(1)(attach(input)))),
        // That the person took the task is recorded as they press, taking no lock: a look at its pull request under way, which
        // holds the task's lock for seconds while agents are at work, then finds its checks theirs (`fixesOf`), rather than
        // telling the lead they failed. Its rounds are settled behind the press, behind that lock, and Stop and Interrupt
        // answer once their lead is told.
        leadStopped: (where, how = 'stopped') =>
          provide(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient
              const [task] =
                'taskId' in where
                  ? [{ taskId: where.taskId }]
                  : yield* sql<{ taskId: string }>`SELECT task_id FROM threads WHERE id = ${where.threadId} AND task_id IS NOT NULL`
              if (task === undefined) return
              yield* taken(task.taskId, how)
              yield* Effect.forkIn(
                provide(locked(task.taskId)(stoppedRounds(task.taskId, how))).pipe(
                  Effect.catchCause((cause) => Effect.logWarning('Could not settle what the stopped lead was resolving', cause)),
                ),
                scope,
              )
            }),
          ).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not record the lead stopped', cause))),
        resolveNow: (where, force) => Effect.asVoid(Effect.forkIn(provide(resolveNow(where, force)), scope)),
        setResolveConflicts: (input) => provide(setResolveConflicts(input)),
        // The person looking at the task counts as something happening on it.
        refresh: (taskId) =>
          Effect.andThen(
            news(taskId),
            Effect.sync(() => wakeNow(taskId)),
          ),
        // Worked out from the repositories the task changes, where it says which: one on a connected host opens a draft.
        endFor: (projectId, taskId, fresh) =>
          provide(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient
              const [project] = yield* sql<{ id: ProjectId }>`SELECT id FROM projects WHERE id = ${projectId}`
              if (project === undefined) return null
              if (fresh === true) yield* refreshRemotes(instance.deviceId, taskId === undefined ? { projectId } : { taskId })
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
        pushing: (taskId) => provide(pushingOf(taskId)).pipe(Effect.orElseSucceed(() => null)),
        pushNow: (where) => Effect.asVoid(Effect.forkIn(provide(pushNow(where)), scope)),
      })
    }),
  )
}
