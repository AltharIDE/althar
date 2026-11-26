import { existsSync } from 'node:fs'
import { type Account, ChangeRequest, type CodeHost, ConnectorFailed, type Product, type Repository } from '@althar/connectors'
import { type ActorId, type ChangeTarget, Ids, type ProjectId, newId } from '@althar/domain'
import type { CommandIdReused, Ledger, RevisionConflict, RowNotFound } from '@althar/persistence-sqlite'
import { Cause, Clock, type Crypto, Effect, Option, Schema } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'
import { withFolder } from './bringBack'
import { offScratch, touchCard } from './cards'
import { withContributorGit } from './changeHost'
import {
  type AttachInput,
  type Attached,
  type ChangeSummary,
  type Host,
  type IssueLinkRow,
  type LinkRow,
  type PublishInput,
  type PublishRow,
  type Published,
  type PublishedOne,
  Snapshot,
  type Store,
  type Unshipped,
  filesWord,
  samePath,
  severalFailed,
  snapshotOf,
  sourceOf,
} from './changeRecords'
import { type Connections, NotConnected } from './Connections'
import { conventionsAt, ruleOf, titleFor } from './conventions'
import { withoutAgentCredit } from './credit'
import { envelope } from './envelope'
import {
  AttachRefused,
  BranchNotFound,
  type ChangedSinceSeen,
  type GitFailed,
  NoChangeToOpen,
  NotFound,
  type OutwardUncertain,
  PushRefused,
  type SessionFailed,
  type SessionRunning,
  ShipRefused,
  type TaskRefused,
  type UnknownAgent,
} from './errors'
import { evidencePaths } from './evidence'
import { type Answers, answersOf, followUpBody, followUpWords } from './followUpWords'
import { baseBranch, forkOf, fromParent, tellOf, workRemotes } from './forks'
import {
  branchExists,
  committerIn,
  commitOf,
  commitsAhead,
  fetchInto,
  fetchedInto,
  git,
  gitOutcome,
  namedRemotes,
  onHead,
  patchIdsOf,
  pushTo,
  remoteTip,
  uncommittedFiles,
} from './git'
import type { Instance, InstanceInfo } from './Instance'
import { outward } from './outward'
import { Policies, linksIssues } from './Policies'
import { hasBranch, startCommitOf, startOf, towardIn } from './Projects'
import { type PullRequestIssue, commitsWord, nameOf, sameDescription, withIssues } from './pullRequestWords'
import { pushDetailOf, pushFailureOf } from './pushFailure'
import { refreshRemotes } from './recordedRemotes'
import { change, fact, timestamp } from './records'
import { guardPush } from './repositoryGuard'
import { indexTask } from './Search'
import type { Sessions } from './Sessions'
import { ShipBranchMove } from './shipBranchMove'
import { TITLE_LENGTH } from './taskTitle'
import { addItem } from './threads'
import { ToolRefused } from './ToolServer'
import { removeWorktree } from './worktreeRemoval'

export interface ChangePublishingDependencies {
  readonly acceptedHead: (taskId: string, path: string, pinned: string) => Effect.Effect<string, ChangedSinceSeen, never>
  readonly agentNames: string[]
  readonly bodyFor: (
    threadId: string,
    issue: ReadonlyArray<PullRequestIssue>,
    repository: { readonly slug: string; readonly template: string | null },
    since?: string | null,
    review?: { readonly seal: string | null; readonly details: string | null; readonly note?: string | null } | null,
    fallback?: { readonly text: string; readonly answers: boolean } | null,
  ) => Effect.Effect<string, SqlError.SqlError, SqlClient.SqlClient>
  readonly branchRepositoryOf: (
    taskId: string,
    host: CodeHost,
    repository: Repository,
    path: string,
    pull: { readonly number: number; readonly source: string; readonly head?: ReadonlyArray<string> | null | undefined },
  ) => Effect.Effect<Repository, ConnectorFailed | PushRefused, never>
  readonly connections: Connections['Service']
  readonly credited: (
    cwd: string,
    branch: string,
    head: string,
    known: ReadonlyArray<string | null>,
  ) => Effect.Effect<{ head: string; settle: Effect.Effect<void> }, SqlError.SqlError | GitFailed, SqlClient.SqlClient>
  readonly current: (
    taskId: string,
    url?: string,
  ) => Effect.Effect<
    {
      readonly link: LinkRow
      readonly snapshot: Snapshot
      readonly host: CodeHost
      readonly repository: Repository
      readonly account: Account
    },
    unknown,
    SqlClient.SqlClient
  >
  readonly decodeSnapshot: (input: unknown) => Effect.Effect<Snapshot, Schema.SchemaError>
  readonly editOnHost: (
    link: LinkRow,
    on: { readonly snapshot: Snapshot; readonly host: CodeHost; readonly repository: Repository; readonly now: ChangeRequest },
    edit: { readonly title?: string; readonly body?: string },
  ) => Effect.Effect<
    ChangeRequest,
    ConnectorFailed | SqlError.SqlError | Schema.SchemaError | RowNotFound | RevisionConflict | OutwardUncertain,
    SqlClient.SqlClient | Instance | Ledger | Crypto.Crypto
  >
  readonly follow: (
    taskId: string,
    event: 'opened' | 'merged',
    change: Parameters<typeof nameOf>[0] & { readonly url: string },
  ) => Effect.Effect<void>
  readonly hostOfRemotes: (remotes: ReadonlyArray<string>) => Effect.Effect<Host | null, never, Store>
  readonly instance: InstanceInfo
  readonly issueKeyOf: (taskId: string) => Effect.Effect<string | null, SqlError.SqlError, SqlClient.SqlClient>
  readonly lastSetBody: (link: LinkRow, url: string) => Effect.Effect<string | null, SqlError.SqlError, SqlClient.SqlClient>
  readonly linksOf: (taskId: string) => Effect.Effect<readonly LinkRow[], SqlError.SqlError, SqlClient.SqlClient>
  readonly news: (taskId: string) => Effect.Effect<undefined>
  readonly refusal: (taskId: string, remote: string, failed: GitFailed, host?: string) => Effect.Effect<never, PushRefused>
  readonly reviewFor: (input: {
    readonly runId: string
    readonly workspaceId: string
    readonly cwd: string
    readonly end: string
    readonly github: boolean
  }) => Effect.Effect<
    { seal: null; details: null; note: string } | { seal: string | null; details: string; note: string | null } | null,
    never,
    SqlClient.SqlClient
  >
  readonly sentTo: (projectId: string, url: string) => Effect.Effect<string | null, SqlError.SqlError, SqlClient.SqlClient>
  readonly sessions: Sessions['Service']
  readonly signInLostAt: (remotes: ReadonlyArray<string>) => Effect.Effect<string | null, never, Store>
  readonly tellLead: (
    link: LinkRow,
    parts: ReadonlyArray<string>,
    wake?: boolean,
    how?: 'turn' | 'note',
  ) => Effect.Effect<
    boolean,
    | UnknownAgent
    | GitFailed
    | NotFound
    | SessionRunning
    | SessionFailed
    | TaskRefused
    | SqlError.SqlError
    | Schema.SchemaError
    | CommandIdReused
    | RowNotFound
    | RevisionConflict,
    SqlClient.SqlClient | Instance | Ledger | Crypto.Crypto
  >
  readonly tipBeforePush: (
    taskId: string,
    snapshot: Snapshot,
    path: string,
    target: { readonly url: string; readonly header: string | null },
    onto: string,
    destination: { readonly host: CodeHost; readonly repository: Repository; readonly own: Repository },
  ) => Effect.Effect<string | null, ChangedSinceSeen | ConnectorFailed | PushRefused>
  readonly unfollowed: (id: string) => Effect.Effect<void, unknown, Store>
  readonly unshippedOf: (taskId: string, kept?: boolean) => Effect.Effect<Unshipped[], unknown, Store>
  readonly wakeNow: (taskId: string | null) => void
}

export const makeChangePublishing = (dependencies: ChangePublishingDependencies) => {
  const {
    acceptedHead,
    agentNames,
    bodyFor,
    connections,
    credited,
    current,
    decodeSnapshot,
    follow,
    hostOfRemotes,
    instance,
    linksOf,
    news,
    reviewFor,
    sessions,
    signInLostAt,
  } = dependencies

  /** A crash can leave the live worktree on a branch made before its database transaction committed. */
  const recoverShipBranches = (input: PublishInput) =>
    Effect.gen(function* () {
      if (input.heads === undefined) return
      const sql = yield* SqlClient.SqlClient
      const [stored] = yield* sql<{
        rebranching: string | null
      }>`SELECT json_extract(parameters, '$.ships.rebranching') AS rebranching FROM runs WHERE id = ${input.runId}`
      if (stored?.rebranching == null) return
      const intents = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Record(Schema.String, ShipBranchMove)))(
        stored.rebranching,
      )
      for (const [id, intent] of Object.entries(intents)) {
        const [workspace] = yield* sql<{
          path: string
          branch: string
        }>`SELECT path, branch FROM workspaces WHERE id = ${id} AND task_id = ${input.taskId}`
        if (workspace === undefined) continue
        const on = yield* git(workspace.path, 'symbolic-ref', '--short', 'HEAD')
        if (workspace.branch === intent.fromBranch) {
          let recoveryBranch = intent.recoveryBranch
          const carried = intent.carry ?? []
          const lastCarried = carried.at(-1)
          if (lastCarried !== undefined) {
            if (
              recoveryBranch === undefined ||
              (yield* gitOutcome(workspace.path, 'merge-base', '--is-ancestor', lastCarried, recoveryBranch)).code !== 0
            ) {
              // An older replacement intent may name a branch whose checkout never happened. Find the existing complete
              // source before creating that destination; otherwise failure could "restore" the partial branch just made.
              const complete = (yield* git(
                workspace.path,
                'for-each-ref',
                '--format=%(refname:short)',
                `--contains=${lastCarried}`,
                'refs/heads',
              ))
                .split('\n')
                .filter((branch) => branch !== '' && branch !== intent.fromBranch)
              recoveryBranch = complete.includes(on) ? on : complete[0]
            }
            if (recoveryBranch === undefined) return yield* new NoChangeToOpen({ taskId: input.taskId, why: 'working' })
            yield* sql`UPDATE runs SET parameters = json_set(parameters, ${`$.ships.rebranching."${id}".recoveryBranch`}, ${recoveryBranch}), revision = revision + 1 WHERE id = ${input.runId}`
          }
          // Nothing uncommitted, conflicted or deliberately moved elsewhere is discarded to return to the source branch.
          if (
            (on !== intent.branch && on !== intent.fromBranch && on !== recoveryBranch) ||
            (yield* uncommittedFiles(workspace.path)).length > 0
          )
            return yield* new NoChangeToOpen({ taskId: input.taskId, why: 'working' })
          for (const under of ['CHERRY_PICK_HEAD', 'MERGE_HEAD', 'REVERT_HEAD'])
            if ((yield* gitOutcome(workspace.path, 'rev-parse', '--verify', '-q', under)).code === 0)
              return yield* new NoChangeToOpen({ taskId: input.taskId, why: 'working' })
          if ((yield* gitOutcome(workspace.path, 'rev-parse', '--verify', `refs/heads/${intent.branch}`)).code === 0) {
            // Older journals did not save the new base. The creation entry is exact, unlike a common ancestor that
            // might include the host's squash or unrelated main commits. Without proof, keep the current work in place.
            const creation =
              intent.onto === undefined
                ? (yield* git(workspace.path, 'reflog', 'show', '--format=%H%x00%gs', intent.branch)).split('\n').at(-1)
                : undefined
            const onto =
              intent.onto ?? (creation?.slice(41).startsWith('branch: Created from ') === true ? creation.slice(0, 40) : undefined)
            if (
              onto === undefined ||
              (yield* gitOutcome(workspace.path, 'merge-base', '--is-ancestor', onto, intent.branch)).code !== 0 ||
              (yield* git(workspace.path, 'rev-list', '--merges', `${onto}..${intent.branch}`)) !== ''
            )
              return yield* new NoChangeToOpen({ taskId: input.taskId, why: 'working' })
            const copied = (yield* git(workspace.path, 'rev-list', '--reverse', `${onto}..${intent.branch}`))
              .split('\n')
              .filter((line) => line !== '')
            const last = carried.at(-1) ?? intent.fromHead
            const patches = yield* patchIdsOf(workspace.path, [...(intent.copies ?? [last]), ...copied])
            let more: ReadonlyArray<string>
            if (intent.copies !== undefined) {
              const expected = intent.copies.filter((commit) => patches.has(commit))
              const later: string[] = []
              let at = 0
              for (const commit of copied) {
                if (at < expected.length && patches.get(commit) === patches.get(expected[at]!)) at += 1
                else later.push(commit)
              }
              more = later
            } else if ((yield* gitOutcome(workspace.path, 'merge-base', '--is-ancestor', last, intent.branch)).code === 0)
              more = (yield* git(workspace.path, 'rev-list', '--reverse', `${last}..${intent.branch}`))
                .split('\n')
                .filter((line) => line !== '')
            else {
              // Legacy journals can locate the copied source tip, then retain every following commit in order. A later
              // reapplication of an old patch is still work: set subtraction by patch identity would silently drop it.
              const boundary = patches.get(last)
              const at = boundary === undefined ? -1 : copied.findIndex((commit) => patches.get(commit) === boundary)
              if (at < 0) return yield* new NoChangeToOpen({ taskId: input.taskId, why: 'working' })
              more = copied.slice(at + 1)
            }
            // Persist before checkout: another interruption must not strand work solely on an abandoned recovery ref.
            yield* sql`UPDATE runs SET parameters = json_set(parameters, ${`$.ships.rebranching."${id}"`}, json(${JSON.stringify({ ...intent, onto, recoveryBranch: more.length > 0 ? intent.branch : recoveryBranch, carry: [...new Set([...carried, ...more])] })})), revision = revision + 1 WHERE id = ${input.runId}`
          }
          if (on !== intent.fromBranch) yield* git(workspace.path, 'checkout', '-q', intent.fromBranch)
          // Retain the journal until the replacement branch and its accepted endpoint commit together below.
          continue
        }
        yield* sql`UPDATE runs SET parameters = json_remove(parameters, ${`$.ships.rebranching."${id}"`}), revision = revision + 1 WHERE id = ${input.runId}`
      }
    })

  const publish = (input: PublishInput): Effect.Effect<Published, unknown, Store> =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* recoverShipBranches(input)
      // Its repositories' remotes as their clones have them now: one added since the repository was, too.
      yield* refreshRemotes(instance.deviceId, { taskId: input.taskId })
      const tasks = yield* sql<PublishRow>`
            SELECT k.title, b.display_name AS name, b.slug, t.id AS thread_id, w.id AS workspace_id, w.path, w.branch, w.base_commit, w.base_ref, b.id AS binding_id,
              w.branched_at IS NOT NULL AS branched, b.remote_fingerprints AS remotes, coalesce(w.toward, b.default_base_ref) AS default_base, b.change_target,
              w.toward, w.held_at
            FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task'
            JOIN workspaces w ON w.task_id = k.id AND w.device_id = ${instance.deviceId} AND w.access = 'write'
            JOIN repository_bindings b ON b.id = w.binding_id
            WHERE k.id = ${input.taskId} ORDER BY b.created_at, b.rowid`
      if (tasks.length === 0) return yield* new NotFound({ kind: 'task', id: input.taskId })
      // Held for Ship, a worktree goes up only with Ship, after its review: nothing else publishes past the person's commits.
      // A change stacked on one held is held too, where it carries what waits there.
      if (input.ships !== true)
        for (const task of tasks)
          if (task.heldAt !== null || (yield* heldBelow(input.taskId, { id: task.workspaceId, path: task.path })) !== null)
            return yield* new ShipRefused({ taskId: input.taskId, why: 'held' })
      const [bound] = yield* sql<{ n: number }>`
            SELECT count(*) AS n FROM repository_bindings WHERE project_id = ${input.projectId} AND detached_at IS NULL`
      // Its next pull request goes only where the last one merged or closed with commits after it; the rest stand as they are.
      const after = input.again === true ? yield* dependencies.unshippedOf(input.taskId) : []
      if (input.again === true && after.length === 0) return yield* new NoChangeToOpen({ taskId: input.taskId, why: 'nothing' })
      // Each repository on its own: one whose host isn't connected is said once the rest are done, for the person to connect and try again.
      const done: Array<PublishedOne> = []
      let unconnected: NotConnected | undefined
      for (const task of tasks) {
        if (input.only !== undefined && !input.only.includes(task.workspaceId)) continue
        if (input.heads !== undefined && input.heads[task.workspaceId] === undefined) continue
        const next = after.find((one) => one.workspaceId === task.workspaceId)
        if (input.again === true && next === undefined) continue
        const one = yield* Effect.exit(publishOne(input, task, { several: tasks.length > 1, ofSeveral: (bound?.n ?? 0) > 1 }, next))
        if (one._tag === 'Success') done.push({ ...one.value, repository: task.name })
        else {
          const error = Cause.findErrorOption(one.cause)
          if (Option.isSome(error) && error.value instanceof NotConnected) unconnected ??= error.value
          // A host's no to one of several, after others opened theirs: which repository it was, and where the rest are.
          else if (Option.isSome(error) && error.value instanceof ConnectorFailed && tasks.length > 1)
            return yield* severalFailed(task.name, error.value, done)
          else return yield* Effect.failCause(one.cause)
        }
      }
      if (unconnected !== undefined) return yield* unconnected
      // A chat on Scratch with a pull request now moves to the board.
      if (done.length > 0) yield* offScratch(input.taskId)
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
        if (!(yield* branchExists(task.path, candidate)) && (yield* remoteTip(task.path, pushTarget, candidate)) === null) return candidate
      }
    })

  /**
   * Cherry-picks commits onto the worktree's branch, one by one: one whose
   * change is there already is left out. The files they conflict in, with
   * nothing picked left half done, or null once all are on it.
   */
  const pickOnto = (path: string, commits: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      const as = yield* committerIn(path)
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
    runId: string,
  ) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      let accepted = task.acceptedHead
      const [saved] = yield* sql<{ intent: string | null }>`
            SELECT json_extract(parameters, ${`$.ships.rebranching."${task.workspaceId}"`}) AS intent FROM runs WHERE id = ${runId}`
      const recovery =
        saved?.intent == null ? undefined : yield* Schema.decodeUnknownEffect(Schema.fromJsonString(ShipBranchMove))(saved.intent)
      const carry = recovery?.carry ?? []
      const restore = Effect.gen(function* () {
        // If carried work conflicts with a newer base, keep the task on the complete interrupted branch. Its later work
        // must remain visible while the person settles that conflict; retaining a ref alone is not enough.
        const back = recovery !== undefined && carry.length > 0 ? (recovery.recoveryBranch ?? recovery.branch) : task.branch
        yield* git(task.path, 'checkout', '-q', back)
        if (back !== task.branch)
          yield* sql`UPDATE runs SET parameters = json_set(parameters, ${`$.ships.rebranching."${task.workspaceId}"`}, json(${JSON.stringify({ fromBranch: recovery!.fromBranch, fromHead: recovery!.fromHead, branch: back, recoveryBranch: back, carry })})), revision = revision + 1 WHERE id = ${runId}`
      })
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
        // Where it can't be fetched, git's own words say why.
        const tip = yield* fetchedInto(task.path, baseTarget, target, `refs/althar/base/${target}`)
        base = tip
        start = leftOut || !(yield* onHead(task.path, tip)) ? tip : null
      }
      const source = yield* commitOf(task.path, 'HEAD')
      const commits = (through: string, after: string) =>
        Effect.map(git(task.path, 'rev-list', '--reverse', '--no-merges', `${after}..${through}`), (listed) =>
          listed.split('\n').filter((line) => line !== ''),
        )
      const prefix = start === null ? [] : yield* commits(accepted ?? source, next.head)
      const tail = start === null || accepted === undefined ? [] : yield* commits(source, accepted)
      if (task.acceptedHead !== undefined)
        yield* sql`UPDATE runs SET parameters = json_set(parameters, ${`$.ships.rebranching."${task.workspaceId}"`}, json(${JSON.stringify({ fromBranch: task.branch, fromHead: source, branch: fresh, recoveryBranch: recovery?.recoveryBranch, onto: start ?? source, copies: [...prefix, ...tail, ...carry], carry })})), revision = revision + 1 WHERE id = ${runId}`
      if (start === null) yield* git(task.path, 'checkout', '-q', '-b', fresh)
      else {
        // The commits as the branch has them now, after the fetch: what the lead committed meanwhile goes too.
        const from = source
        // Keep later local commits on the task's new branch, but map the accepted prefix before carrying that tail on.
        yield* git(task.path, 'checkout', '-q', '-b', fresh, start)
        let conflicted = yield* pickOnto(task.path, prefix)
        if (accepted !== undefined && conflicted === null) accepted = yield* commitOf(task.path, 'HEAD')
        if (conflicted === null) conflicted = yield* pickOnto(task.path, tail)
        // One committed as it switched would be left on the old branch alone: it goes back to it, and says the lead is at work.
        const moved = (yield* commitOf(task.path, `refs/heads/${task.branch}`).pipe(Effect.orElseSucceed(() => ''))) !== from
        if (conflicted !== null || moved) {
          yield* restore
          // A bounded Ship retains its recovery branch, including anything committed there while it switched.
          if (task.acceptedHead === undefined) yield* Effect.ignore(git(task.path, 'branch', '-D', fresh))
          return yield* new NoChangeToOpen(
            conflicted === null ? { taskId, why: 'working' } : { taskId, why: 'conflicts', detail: filesWord(conflicted) },
          )
        }
      }
      const carriedConflict = yield* pickOnto(task.path, carry)
      if (carriedConflict !== null) {
        yield* restore
        return yield* new NoChangeToOpen({ taskId, why: 'conflicts', detail: filesWord(carriedConflict) })
      }
      if (start === null && (yield* commitOf(task.path, `refs/heads/${task.branch}`)) !== source) {
        yield* restore
        return yield* new NoChangeToOpen({ taskId, why: 'working' })
      }
      yield* sql.withTransaction(
        Effect.gen(function* () {
          const revision = yield* change('workspaces', task.workspaceId, { branch: fresh, baseCommit: base })
          // Save the remapped prefix with the branch: a retry or restart uses exactly the same accepted code.
          if (accepted !== undefined)
            yield* sql`UPDATE runs SET parameters = json_remove(json_set(parameters, ${`$.ships.heads."${task.workspaceId}"`}, ${accepted}), ${`$.ships.rebranching."${task.workspaceId}"`}), revision = revision + 1 WHERE id = ${runId}`
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
      return { ...task, branch: fresh, baseCommit: base, ...(accepted === undefined ? {} : { acceptedHead: accepted }) }
    })

  /**
   * What a next pull request says of itself, after the one it follows (ADR-034): the words of its title (the lead's, given with its
   * fix; for a fix of what a review found, else its first commit's subject, else the finding it answers; none for other work, which
   * keeps the task's own title), and a description for where the lead wrote none: the
   * finding a review after the merge made, and the commits since. The finding is the one the person had the lead fix, if it was
   * asked for one; none otherwise.
   */
  const followUpOf = (
    taskId: string,
    threadId: string,
    path: string,
    next: Unshipped & { readonly change: NonNullable<Unshipped['change']> },
  ) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const [review] = yield* sql<{ findings: string | null }>`
            SELECT json_extract(content, '$.fixing.findings') AS findings FROM thread_items
            WHERE thread_id = ${threadId} AND kind = 'notice' AND json_extract(content, '$.fixing.url') = ${next.change.url}
              AND (${next.openedAt} IS NULL OR created_at > ${next.openedAt})
            ORDER BY sequence DESC LIMIT 1`
      const findings: ReadonlyArray<Answers> = answersOf(review?.findings)
      const [titled] = yield* sql<{ text: string | null }>`
            SELECT json_extract(content, '$.title') AS text FROM thread_items WHERE thread_id = ${threadId} AND kind = 'step_result'
              AND json_extract(content, '$.title') IS NOT NULL AND (${next.openedAt} IS NULL OR created_at > ${next.openedAt})
            ORDER BY sequence DESC LIMIT 1`
      const listed =
        next.commits.length === 0
          ? ''
          : yield* git(path, 'log', '--no-walk=unsorted', '--format=%s%x1f%b%x1e', ...next.commits).pipe(Effect.orElseSucceed(() => ''))
      const commits = listed
        .split('\x1e')
        .map((entry) => entry.trim())
        .filter((entry) => entry !== '')
        .map((entry) => {
          const at = entry.indexOf('\x1f')
          return { subject: at === -1 ? entry : entry.slice(0, at), body: at === -1 ? '' : entry.slice(at + 1) }
        })
      return {
        words: followUpWords(
          {
            written: titled?.text === undefined ? null : withoutAgentCredit(titled.text ?? '', agentNames),
            // A fix of what a review found is named for its commit or its finding; other work after a merge keeps the task's own title.
            commits: findings.length === 0 ? [] : commits,
            findings,
          },
          agentNames,
          yield* dependencies.issueKeyOf(taskId),
          TITLE_LENGTH - `After ${next.change.words.prefix}${next.change.number}: `.length,
        ),
        body: {
          text: followUpBody({
            follows: `${next.change.words.prefix}${next.change.number}`,
            state: next.change.state === 'closed' ? 'closed' : 'merged',
            findings,
            commits,
          }),
          answers: findings.length > 0,
        },
      }
    })

  /**
   * Publishes one of the task's repositories: pushes its branch, and opens or adopts its pull request where the ending says to.
   * With `next`, its next pull request, after its last merged or closed: on a new branch, described from what came since.
   */
  /** See `keptOpen`: the task's plan says so, as changing its ending to its branch from a pull request marks it. */
  const keptOpenOf = (taskId: string) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const [plan] = yield* sql<{ kept: number | null }>`
            SELECT json_extract(parameters, '$.keptOpen') AS kept FROM task_plans
            WHERE task_id = ${taskId} AND state IN ('proposed', 'accepted') ORDER BY proposed_at DESC LIMIT 1`
      return plan?.kept === 1
    })

  /**
   * A push with a connection's sign-in that the host refused: where git says the sign-in wasn't taken, or was but may not
   * write there, said as whose sign-in it was, for which repository, so the card says what puts it right, never git's own
   * line (kept for Details). Any other failure stands as git's.
   */
  const refusedWith = (taskId: string, failed: GitFailed, connectionId: string, repository: Repository, branch: string) =>
    Effect.gen(function* () {
      const known = pushFailureOf(failed)
      if (known === null || (known.why !== 'forbidden' && known.why !== 'denied')) return yield* Effect.fail(failed)
      const info = (yield* connections.list.pipe(Effect.orElseSucceed(() => []))).find((one) => one.id === connectionId)
      return yield* new PushRefused({
        taskId,
        why: known.why,
        remote: `${repository.path.join('/')}/${branch}`,
        ...(info === undefined ? {} : { host: info.name }),
        detail: pushDetailOf(failed),
        ...(info === undefined
          ? {}
          : {
              signIn: {
                account: info.account.login,
                kind: info.auth === 'device_flow' ? ('app' as const) : ('token' as const),
                product: info.product,
                repository: repository.path.join('/'),
              },
            }),
      })
    })

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
      if (input.heads !== undefined && input.heads[given.workspaceId] === undefined) return { kind: 'nothing', left: [] } as const
      const pinned = input.heads?.[given.workspaceId]
      let task = pinned === undefined ? given : { ...given, acceptedHead: yield* acceptedHead(input.taskId, given.path, pinned) }
      // A fork's branch goes to the fork, whatever else its clone's remotes name, unless the project sends it to the repository
      // it was forked from; its pull request, where the project says.
      const named = yield* namedRemotes(task.path).pipe(Effect.orElseSucceed(() => []))
      const told = forkOf(named)
      const remotes =
        told === null
          ? workRemotes(named, Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.String)))(task.remotes))
          : [told.fork.url]
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
      const forked = yield* host.repository(found.path)
      // What the host says of it now, whether it is a fork and of what, is kept, and goes for where its work goes from now: only
      // where that host is origin's, reached through its address, as another remote's (a mirror's at the same path) says
      // nothing of origin.
      const origin = named.find((remote) => remote.name === 'origin')
      if (origin !== undefined && found.remote === origin.url) tellOf(origin.url, forked, yield* Clock.currentTimeMillis, host.product)
      const fork = forkOf(named)
      const upstream =
        fork !== null && (task.changeTarget === 'upstream' || task.changeTarget === 'upstream_branch')
          ? yield* host.repository(fork.upstream.path)
          : null
      // Into the repository it was forked from, on the same host: from the fork's branch, or, where the project sends its
      // branches there too and its host says the person can push there, from a branch of its own.
      let repository = upstream ?? forked
      let own = upstream !== null && task.changeTarget === 'upstream_branch' && upstream.canPush ? upstream : forked
      // A pull request already open from the branch stays where it is, its commits going where its branch is, whatever the
      // project says now: switching where a fork's work goes moves only its next ones (ADR-085). So does one opened from a
      // fork before its clone's remotes were renamed for the repository it came from.
      const standing = next === undefined ? yield* openFrom(input.taskId, task.workspaceId, task.branch) : undefined
      // Ending with its branch while its pull request stands open (a change stepped back to prototyping): pushing the branch
      // would send its work to that pull request, so nothing goes up; the work waits on its branch here until it ends in one again.
      if (input.end === 'none' && standing !== undefined && standing.state === 'open' && (yield* keptOpenOf(input.taskId)))
        return { kind: 'kept', pullRequest: `${standing.words.short} ${standing.words.prefix}${standing.number}`, left: [] } as const
      if (standing !== undefined) {
        repository = samePath(standing.repository, repository.path) ? repository : yield* host.repository(standing.repository)
        own = yield* dependencies.branchRepositoryOf(input.taskId, host, repository, task.path, {
          ...standing,
          source: sourceOf(standing, task.branch),
        })
      }
      const from = samePath(repository.path, own.path) ? undefined : own
      // The repository as its host names it, not as the remote spells it: Bitbucket Data Center's has `scm/` in front.
      const path = repository.path
      const pushTarget = yield* host.pushTarget(own)
      // The branch it works toward (ADR-093), else the branch it started from, on the repository it opens on; into the one a
      // fork came from, from a task made before it was chosen, that repository's default.
      const target =
        task.toward ??
        (fork === null || !samePath(repository.path, fork.upstream.path)
          ? baseBranch(
              task.baseRef ?? '',
              task.baseRef != null && (yield* branchExists(task.path, task.baseRef)),
              named.map((remote) => remote.name),
            ) ||
            task.defaultBase ||
            repository.defaultBranch
          : (fromParent(task.baseRef ?? null, fork) ?? repository.defaultBranch))
      // Never onto a default branch, wherever the branch goes (ADR-071): a task's branch is its own.
      if (task.branch === own.defaultBranch || (from === undefined && task.branch === target))
        return yield* new PushRefused({ taskId: input.taskId, why: 'protected', remote: `${own.path.join('/')}/${task.branch}` })
      // Attached to an open pull request it didn't open, its branch goes there, and nothing else opens (ADR-052).
      const attached = next === undefined ? yield* attachedOf(input.taskId, task.workspaceId) : undefined
      if (attached !== undefined) return yield* publishAttached(input, task, attached, pushTarget, { host, repository, own })
      // The next pull request describes only accepted commits, before a rebranch gives them new identities.
      const described =
        next === undefined || task.acceptedHead === undefined
          ? next
          : {
              ...next,
              commits: yield* Effect.filter(next.commits, (commit) =>
                Effect.map(
                  gitOutcome(task.path, 'merge-base', '--is-ancestor', commit, task.acceptedHead ?? ''),
                  (answer) => answer.code === 0,
                ),
              ),
            }
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
          input.runId,
        )
      // Althar pushes what the lead committed, never what it left lying in the worktree; a screenshot it handed as evidence isn't left.
      const pictures = yield* evidencePaths(input.taskId)
      const left = (yield* uncommittedFiles(task.path)).filter((file) => !pictures(task.path, file))
      const base = task.baseCommit ?? task.baseRef ?? own.defaultBranch
      // Nothing of its own to propose: not ahead of where it started, or wholly in the branch it goes into already (a branch
      // that took main in without a commit of its own is behind it, not ahead of it).
      const headNow = task.acceptedHead ?? (yield* commitOf(task.path, 'HEAD').pipe(Effect.orElseSucceed(() => '')))
      const inTarget =
        headNow !== '' && (yield* gitOutcome(task.path, 'merge-base', '--is-ancestor', headNow, `refs/heads/${target}`)).code === 0
      if (inTarget || (yield* commitsAhead(task.path, base, headNow)) === 0) return { kind: 'nothing', left } as const
      const [sent] = yield* sql<{ head: string | null }>`
            SELECT head_commit AS head FROM repository_changes WHERE workspace_id = ${task.workspaceId} ORDER BY updated_at DESC LIMIT 1`
      const end = task.acceptedHead ?? (yield* commitOf(task.path, 'HEAD'))
      const { head, settle } = yield* credited(task.path, task.branch, end, [
        task.baseCommit,
        sent?.head ?? null,
        yield* remoteTip(task.path, pushTarget, task.branch),
      ])
      yield* guardPush({
        projectId: input.projectId,
        taskId: input.taskId,
        remote: task.branch,
        cwd: task.path,
        base: task.baseCommit,
        ref: task.baseRef ?? own.defaultBranch,
        head,
      })
      yield* pushTo(task.path, pushTarget, task.branch, head).pipe(
        Effect.catchTag('GitFailed', (failed) => refusedWith(input.taskId, failed, found.connectionId, own, task.branch)),
      )
      yield* settle
      if (input.end === 'none') return { kind: 'pushed', branch: task.branch, left } as const
      const draft = input.end === 'draft' && host.capabilities.drafts
      const issueLinks = yield* issueLinksOf(input.taskId)
      const sameHostOf = sameHostAs(host.product, path)
      // Its title carries the first one's key, as its branch does; its description names each.
      const [issueLink] = issueLinks
      const sameHost = issueLink !== undefined && sameHostOf(issueLink)
      // The team's conventions, as the task's worktree has them now, under the person's own rule for titles.
      const conventions = yield* conventionsAt(task.path, end)
      const rule = ruleOf('title', (yield* (yield* Policies).current(input.projectId)).rules.titlePattern)
      // A task's next pull request, after its last merged or closed, says which it follows (ADR-034), and then what it does:
      // its own words, not the task's, which say what the first one did.
      const following =
        described?.change == null
          ? null
          : yield* followUpOf(input.taskId, task.threadId, task.path, { ...described, change: described.change })
      const title = titleFor(rule ?? conventions.title?.pattern ?? null, {
        title:
          next?.change == null ? task.title : `After ${next.change.words.prefix}${next.change.number}: ${following?.words ?? task.title}`,
        issue: issueLink === undefined ? null : { key: issueLink.key, sameHost },
      })
      const body = yield* bodyFor(
        task.threadId,
        issueLinks.map((link) => ({ key: link.key, url: link.url, sameHost: sameHostOf(link), partOf: link.partOf === 1 })),
        { slug: task.slug, template: conventions.template?.text ?? null },
        next?.openedAt ?? null,
        yield* reviewFor({ runId: input.runId, workspaceId: task.workspaceId, cwd: task.path, end, github: host.product === 'github' }),
        following?.body ?? null,
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
      yield* linkIssues(input.projectId, issueLinks, sameHostOf, { url: opened.url, title: `${nameOf(snapshot)}: ${opened.title}` })
      // Its issues, moved on to review.
      if (issueLinks.length > 0) yield* follow(input.taskId, 'opened', snapshot)
      yield* touchCard(input.taskId)
      yield* news(input.taskId)
      dependencies.wakeNow(input.taskId)
      // This pull request's own link: the task's first is an earlier one's, merged or closed, where this is a next.
      const row = (yield* linksOf(input.taskId)).find((one) => one.id === linkId)
      return {
        kind: 'opened',
        change: { ...snapshot, linkId, product: host.product, listening: row?.listening === 1 },
        left,
      } as const
    })

  /**
   * Each issue a task came from gets a link to its pull request, where
   * its tracker has links: one on the pull request's own host links
   * itself. Each once, by this or its lead's link_pull_request, which
   * shares its key; one tracker that can't leaves the others linked.
   */
  const linkIssues = (
    projectId: ProjectId,
    issueLinks: ReadonlyArray<IssueLinkRow>,
    sameHostOf: (link: IssueLinkRow) => boolean,
    change: { readonly url: string; readonly title: string },
  ) =>
    Effect.gen(function* () {
      // Not where the project's rules say not to link issues (on unless the person turned it off).
      if (!linksIssues((yield* (yield* Policies).current(projectId)).rules)) return
      yield* linkEach(issueLinks, sameHostOf, change, projectId)
    })

  const linkEach = (
    issueLinks: ReadonlyArray<IssueLinkRow>,
    sameHostOf: (link: IssueLinkRow) => boolean,
    change: { readonly url: string; readonly title: string },
    projectId: ProjectId,
  ) =>
    Effect.forEach(
      issueLinks.filter((linked) => linked.connectionId !== null && !sameHostOf(linked)),
      (linked) =>
        Effect.gen(function* () {
          const adapters = yield* connections.adapters(linked.connectionId ?? '')
          const tracker = adapters.tracker
          if (tracker === undefined || !tracker.capabilities.links) return
          const issue = yield* tracker.issue(linked.ref)
          yield* outward({
            projectId,
            subject: { type: 'external_link', id: linked.id },
            target: `${tracker.product}:${linked.key}`,
            operation: 'link_issue',
            key: `link_issue:${linked.id}:${change.url}`,
            request: { url: change.url },
            retryable: true,
            perform: Effect.as(tracker.link(issue, change), true),
            encode: () => true,
            // Linked once, by this or its lead's link_pull_request, which shares its key: its receipt answers.
            decode: () => true,
          })
        }).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not link the pull request to its issue', cause))),
      { discard: true },
    )

  /** Each issue a task came from, as a pull request names and links it, in the order they were tied to it. */
  const issueLinksOf = (taskId: string) =>
    Effect.flatMap(
      SqlClient.SqlClient,
      (sql) => sql<IssueLinkRow>`
            SELECT id, product, key, url, ref, connection_id, part_of FROM external_links WHERE task_id = ${taskId} AND kind = 'issue'
            ORDER BY created_at, rowid`,
    )

  /** Whether an issue lives on a pull request's own host and repository, which links its key by itself; case aside, as hosts don't mind it. */
  const sameHostAs = (product: Product, repository: ReadonlyArray<string>) => (link: { readonly product: Product; readonly ref: string }) =>
    link.product === product && link.ref.toLowerCase().startsWith(`${repository.join('/').toLowerCase()}#`)

  const issuesChanged = (taskId: string) =>
    Effect.gen(function* () {
      const issueLinks = yield* issueLinksOf(taskId)
      for (const link of yield* linksOf(taskId)) {
        if (link.connectionId === null) continue
        const seen = Option.getOrUndefined(yield* Effect.option(decodeSnapshot(link.snapshot)))
        if (seen === undefined || seen.state !== 'open') continue
        yield* Effect.gen(function* () {
          const host = (yield* connections.adapters(link.connectionId ?? '')).host
          if (host === undefined) return
          const repository = yield* host.repository(seen.repository)
          const now = yield* host.change(repository, seen.number)
          if (now.state !== 'open') return
          const sameHostOf = sameHostAs(link.product, seen.repository)
          // Only a description Althar wrote: someone's own, on one the task was attached to, stays theirs.
          if ((yield* dependencies.lastSetBody(link, seen.url)) !== null) {
            const body = withIssues(
              now.body,
              issueLinks.map((one) => ({ key: one.key, url: one.url, sameHost: sameHostOf(one), partOf: one.partOf === 1 })),
            )
            if (!sameDescription(body, now.body)) yield* dependencies.editOnHost(link, { snapshot: seen, host, repository, now }, { body })
          }
          yield* linkIssues(link.projectId, issueLinks, sameHostOf, { url: seen.url, title: `${nameOf(seen)}: ${now.title}` })
        }).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not bring a pull request in line with its issues', cause)))
      }
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
      return snapshot.attached === true && snapshot.state === 'open' ? { record: latest.id, sent: latest.head, link, snapshot } : undefined
    })

  /** The pull request open from a repository's branch in the task, as last seen, if there is one. */
  const openFrom = (taskId: string, workspaceId: string, branch: string) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const [open] = yield* sql<{ snapshot: string }>`
            SELECT l.snapshot FROM repository_changes c
            JOIN external_links l ON l.task_id = ${taskId} AND l.kind = 'change' AND l.url = c.pull_request_url
            WHERE c.workspace_id = ${workspaceId} AND c.branch = ${branch} AND json_extract(l.snapshot, '$.state') = 'open'
            ORDER BY c.created_at DESC, c.rowid DESC LIMIT 1`
      return open === undefined ? undefined : yield* decodeSnapshot(open.snapshot)
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
    destination: { readonly host: CodeHost; readonly repository: Repository; readonly own: Repository },
  ) =>
    Effect.gen(function* () {
      const { link, snapshot } = attached
      const pictures = yield* evidencePaths(input.taskId)
      const left = (yield* uncommittedFiles(task.path)).filter((file) => !pictures(task.path, file))
      const onto = sourceOf(snapshot, task.branch)
      const tip = yield* dependencies.tipBeforePush(input.taskId, snapshot, task.path, pushTarget, onto, destination)
      const { head, settle } = yield* credited(task.path, task.branch, task.acceptedHead ?? (yield* commitOf(task.path, 'HEAD')), [
        task.baseCommit,
        attached.sent,
        snapshot.headSha,
        tip,
      ])
      // Already there, nothing goes up; else only as a fast-forward, in a sentence where it isn't one.
      if (tip !== head)
        yield* withContributorGit(snapshot.maintainerEdit === true, pushTarget, (target) =>
          pushTo(task.path, target, task.branch, head, undefined, onto),
        ).pipe(Effect.catchTag('GitFailed', (failed) => dependencies.refusal(input.taskId, nameOf(snapshot), failed)))
      yield* settle
      const { host, repository } = yield* current(input.taskId, snapshot.url)
      const read = yield* host.change(repository, snapshot.number)
      const seen: Snapshot = {
        ...snapshotOf(read, snapshot.repository, snapshot.words, snapshot.checks, snapshot),
        headSha: head,
        attached: true,
      }
      const sql = yield* SqlClient.SqlClient
      yield* sql`UPDATE repository_changes SET head_commit = ${head}, updated_at = ${yield* timestamp}, revision = revision + 1
            WHERE id = ${attached.record}`
      yield* saveSnapshot(link, seen, { listening: read.state === 'open' ? 1 : 0 })
      yield* news(input.taskId)
      dependencies.wakeNow(input.taskId)
      const change = { ...seen, linkId: link.id, product: link.product, listening: read.state === 'open' }
      return { kind: 'opened', change, attached: true, left } as const
    })

  /**
   * Attaches one of the task's repositories to an open pull request it
   * didn't open, by its link or its number (ADR-052): one opened by hand,
   * or from a fork into the repository it came from. A contributor's
   * fork requires maintainer edits. Another task following it keeps it. The task's branch, where it
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
        changeTarget: ChangeTarget | null
      }>`
            SELECT w.id AS workspace_id, w.path, w.branch, w.base_commit, w.branched_at IS NOT NULL AS branched, b.id AS binding_id,
              b.display_name AS name, b.remote_fingerprints AS remotes, b.change_target
            FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id
            WHERE w.task_id = ${input.taskId} AND w.device_id = ${instance.deviceId} AND w.access = 'write' AND w.state = 'ready'
              AND w.reviewing IS NULL
            ORDER BY b.created_at, b.rowid, w.created_at, w.rowid`
      // Each repository, where its pull requests are: its own on its host, and the one a fork came from.
      const places = (yield* Effect.forEach(rows, (row) =>
        Effect.gen(function* () {
          if (!existsSync(row.path)) return []
          const named = yield* namedRemotes(row.path).pipe(Effect.orElseSucceed(() => []))
          const fork = forkOf(named)
          const remotes =
            fork === null
              ? workRemotes(named, Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.String)))(row.remotes))
              : [fork.fork.url]
          const found = yield* connections.hostOf(remotes, { fromCli: true })
          return found === null ? [] : [{ row, fork, found }]
        }),
      )).flat()
      const same = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) => a.join('/').toLowerCase() === b.join('/').toLowerCase()
      // A repository's first change stands for it; which change takes the pull request is worked out once it is read.
      const repositories = places.filter((one, index) => places.findIndex((other) => other.row.bindingId === one.row.bindingId) === index)
      const asked = input.pullRequest.trim()
      const chosen = yield* Effect.gen(function* () {
        if (/^https?:\/\//i.test(asked)) {
          const resolved = yield* connections.resolve(asked)
          if (resolved === null)
            return yield* refuse('Althar isn’t connected to where that link points. Connect its host in Settings, then attach it.')
          if (resolved.ref.kind !== 'change') return yield* refuse('That link isn’t to a pull request.')
          const ref = resolved.ref
          // On the host the repository is on, not one of the same path on another host Althar is connected to.
          const place = repositories.find(
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
        const [only] = repositories
        if (only === undefined)
          return yield* refuse('The task’s repository isn’t on a code host Althar is connected to. Connect it in Settings.')
        if (repositories.length > 1)
          return yield* refuse(
            `The task changes several repositories (${repositories.map((one) => one.row.name).join(', ')}): give the pull request’s link.`,
          )
        // By its number, where the repository's pull requests open: the one a fork came from, where the project sends them there.
        const path =
          only.fork !== null && (only.row.changeTarget === 'upstream' || only.row.changeTarget === 'upstream_branch')
            ? only.fork.upstream.path
            : only.found.path
        return { ...only, path, number: Number(number) }
      })
      const { fork, found } = chosen
      let row = chosen.row
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
      // One whose branch is a change's own is that change's: recorded on it, in place of any open one it had, and the task
      // follows the rest as before (a task is a conversation plus parts).
      row = rows.find((one) => one.bindingId === row.bindingId && one.branch === pull.source && existsSync(one.path)) ?? row
      // Its branch is on the repository this clone pushes to, or on a contributor's fork that lets maintainers edit.
      // Where the project sends branches upstream (ADR-085), the upstream repository can have its own branches too.
      // Where the host doesn't say which repository it is on, a branch of the same name here may be another's: none is pushed to.
      const pushes = fork?.fork.path ?? found.path
      const headOn = pull.headRepository
      if (headOn === undefined)
        return yield* refuse(`The host doesn’t say where ${name}’s branch is, so Althar can’t tell it’s one this task pushes to.`)
      if (headOn !== null && headOn.length === 0) return yield* refuse(`${name}’s branch was on a fork that is gone.`)
      const headPath = headOn ?? path
      const upstreamBranches = fork !== null && row.changeTarget === 'upstream_branch' && same(headPath, fork.upstream.path)
      const outside = !same(headPath, pushes) && !(upstreamBranches && repository.canPush)
      const maintainerEdit = outside && !same(headPath, path)
      if (maintainerEdit) {
        if (pull.maintainerEdits !== true)
          return yield* refuse(
            `${name} is from ${headPath.join('/')} and maintainer edits are disabled. Ask the author to allow maintainer edits, then attach it.`,
          )
        if (!repository.canPush)
          return yield* refuse(`Your account can’t push to ${path.join('/')}. Sign in with an account that can edit ${name}’s branch.`)
      } else if (outside) {
        return yield* refuse(
          `${name}’s branch, ${pull.source}, is on ${headPath.join('/')}, which this task doesn’t push to: it pushes to ${pushes.join('/')}.`,
        )
      }
      const own = same(headPath, pushes) ? pushes : headPath
      const [other] = yield* sql<{ slug: string }>`
            SELECT k.slug FROM external_links x JOIN tasks k ON k.id = x.task_id
            WHERE x.project_id = ${task.projectId} AND x.kind = 'change' AND x.url = ${pull.url} AND x.listening = 1
              AND x.task_id <> ${input.taskId} AND k.state IN ('open', 'draft') LIMIT 1`
      if (other !== undefined) return yield* refuse(`Task ${other.slug} follows ${name} already. Abandon it first, or leave ${name} to it.`)
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
      const ref = `refs/althar/pull-request/${pull.source}`
      const tip = yield* maintainerEdit
        ? withContributorGit(true, pushTarget, (target) => fetchedInto(row.path, target, pull.source, ref)).pipe(
            Effect.orElseSucceed(() => null),
          )
        : fetchInto(row.path, pushTarget, pull.source, ref)
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
      const snapshot: Snapshot = {
        ...snapshotOf(pull, path, host.words, null),
        headSha: tip,
        attached: true,
        ...(maintainerEdit ? { maintainerEdit: true } : {}),
      }
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
        title: `Following ${name}${where}: ${pull.title}`,
      })
      const [link] = (yield* linksOf(input.taskId)).filter((one) => one.id === linkId)
      // News for its lead, read with its next turn: it needs nothing done now.
      if (link !== undefined)
        yield* dependencies.tellLead(
          link,
          [
            `This task follows ${name} on ${path.join('/')} now, "${pull.title}": ${pull.url}. ${started ? `Your branch ${row.branch} starts from its head now, with your own commits on top. ` : ''}read_pull_request reads it, reply_on_pull_request answers on it, and push_to_pull_request pushes your commits to its branch, or asks the person to, ${pull.source}.`,
          ],
          false,
          'note',
        )
      // A chat on Scratch that follows a pull request now moves to the board.
      yield* offScratch(input.taskId)
      yield* touchCard(input.taskId)
      yield* news(input.taskId)
      dependencies.wakeNow(input.taskId)
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
      for (const one of under) yield* dependencies.unfollowed(one.id)
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

  /**
   * Whether a change is held by the one it is stacked on (a task is a
   * conversation plus parts, "A hold reaches up a stack"): a push sends a
   * branch's whole history, so one whose branch carries commits that wait
   * for Ship on a change below it is held as if they were its own. Worked
   * out from git each time, rather than kept: what the change below has
   * that its pull request doesn't, as far as this branch has taken it in.
   * When the one below was held, or null.
   */
  const heldBelow = (
    taskId: string,
    above: { readonly id: string; readonly path: string },
    depth = 0,
  ): Effect.Effect<string | null, unknown, Store> =>
    Effect.gen(function* () {
      if (depth > 8) return null
      const sql = yield* SqlClient.SqlClient
      const [below] = yield* sql<{ id: string; path: string; branch: string; heldAt: string | null; projectId: string }>`
            SELECT w.id, w.path, w.branch, w.held_at, w.project_id FROM workspaces w JOIN workspaces a ON a.id = ${above.id}
            WHERE w.task_id = ${taskId} AND w.binding_id = a.binding_id AND w.branch = a.toward AND w.id <> a.id
              AND w.reviewing IS NULL AND w.state <> 'cleaned'
            LIMIT 1`
      if (below === undefined) return null
      const held = below.heldAt ?? (yield* heldBelow(taskId, below, depth + 1))
      if (held === null || !existsSync(above.path)) return null
      const [open] = yield* sql<{ url: string; head: string | null }>`
            SELECT l.url, json_extract(l.snapshot, '$.headSha') AS head FROM repository_changes c
            JOIN external_links l ON l.url = c.pull_request_url AND l.kind = 'change'
            WHERE c.workspace_id = ${below.id} ORDER BY l.created_at DESC LIMIT 1`
      // Never sent, all the branch below has waits with it.
      if (open === undefined) return held
      const sent = (yield* dependencies.sentTo(below.projectId, open.url)) ?? open.head
      if (sent === null) return held
      const met = yield* git(above.path, 'merge-base', 'HEAD', `refs/heads/${below.branch}`).pipe(Effect.orElseSucceed(() => ''))
      if (met === '') return null
      return (yield* commitsAhead(above.path, sent, met).pipe(Effect.orElseSucceed(() => 0))) > 0 ? held : null
    })

  /*
   * Changes the lead split, put back together or dropped (a task is a conversation plus parts, "Starting and splitting"),
   * and a task's only worktree moved down to a copy. Nothing is lost: what a folder hadn't committed is committed before it
   * goes, and every branch stays.
   */
  interface ChangeRow {
    readonly id: string
    readonly projectId: ProjectId
    readonly threadId: string | null
    readonly bindingId: string
    readonly name: string | null
    readonly path: string
    readonly branch: string
    readonly baseCommit: string | null
    readonly toward: string | null
    readonly state: string
    readonly kind: string | null
    /** The tool that made its folder, where Althar didn't (Elsewhere.ts): never removed, committed in or switched by Althar. */
    readonly madeBy: string | null
  }

  const changesOf = (taskId: string) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      return yield* sql<ChangeRow>`
            SELECT w.id, w.project_id, (SELECT t.id FROM threads t WHERE t.task_id = w.task_id AND t.kind = 'task') AS thread_id,
              w.binding_id, w.name, w.path, w.branch, w.base_commit, w.toward, w.state, w.kind, w.made_by
            FROM workspaces w WHERE w.task_id = ${taskId} AND w.device_id = ${instance.deviceId} AND w.access = 'write'
              AND w.reviewing IS NULL AND w.state IN ('ready', 'away')
            ORDER BY w.created_at, w.rowid`
    })

  const findChange = (all: ReadonlyArray<ChangeRow>, asked: string) => {
    const wanted = asked.trim().toLowerCase()
    return all.find((one) => (one.name ?? '').toLowerCase() === wanted || one.branch.toLowerCase() === wanted)
  }

  const changeWords = (one: Pick<ChangeRow, 'name' | 'branch'>) => (one.name === null ? 'the task’s first change' : `“${one.name}”`)

  const madeElsewhere = (one: Pick<ChangeRow, 'name' | 'branch'>) =>
    new ToolRefused({
      message: `${changeWords(one)} is in a folder another tool made, which Althar leaves where it is: its branch stays the task's, and the folder is that tool's to remove.`,
    })

  const commitLeftIn = (path: string, message: string) =>
    Effect.gen(function* () {
      if ((yield* uncommittedFiles(path)).length === 0) return false
      yield* git(path, 'add', '-A')
      yield* git(path, ...(yield* committerIn(path)), 'commit', '-q', '-m', message)
      return true
    })

  const lineIn = (row: Pick<ChangeRow, 'projectId' | 'threadId'>, title: string, step?: Record<string, unknown>) =>
    row.threadId === null
      ? Effect.void
      : addItem({ projectId: row.projectId, threadId: row.threadId }, 'notice', {
          source: 'runtime',
          severity: 'info',
          title,
          description: null,
          ...(step === undefined ? {} : { step }),
        })

  // What became of a change of its task, which needs nothing of the lead now: read with its next turn, never starting one.
  const leadHears = (row: Pick<ChangeRow, 'threadId'>, body: string) =>
    Effect.gen(function* () {
      if (row.threadId === null) return
      yield* sessions
        .send({
          envelope: yield* envelope('thread.send', { threadId: row.threadId }),
          threadId: row.threadId,
          body,
          origin: 'system',
          quiet: true,
          note: true,
        })
        .pipe(Effect.ignore)
    })

  const pulledOf = (workspaceId: string) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      return yield* sql<{ url: string; state: string | null }>`
            SELECT c.pull_request_url AS url, json_extract(l.snapshot, '$.state') AS state FROM repository_changes c
            LEFT JOIN external_links l ON l.url = c.pull_request_url AND l.kind = 'change'
            WHERE c.workspace_id = ${workspaceId} AND c.pull_request_url IS NOT NULL`
    })

  const goneRow = (row: ChangeRow, type: string, payload: Readonly<Record<string, unknown>>, actorId: ActorId) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql.withTransaction(
        Effect.gen(function* () {
          const revision = yield* change('workspaces', row.id, { state: 'cleaned', cleanedAt: yield* timestamp, waitsFor: null })
          yield* fact({ projectId: row.projectId, aggregateType: 'workspace', aggregateId: row.id, revision, type, payload, actorId })
        }),
      )
    })

  /**
   * Keep them together: one change's commits carried onto another of the task's, before either ships, cherry-picked onto
   * its branch in its folder; then the joined one's folder goes, and its branch stays. Refused where either has a pull
   * request, where either folder has what it hasn't committed, or where the commits conflict, saying which files.
   */
  const joinChanges = (taskId: string, asked: string, intoAsked: string | null, actorId: ActorId) =>
    Effect.gen(function* () {
      const all = yield* changesOf(taskId)
      const from = findChange(all, asked)
      if (from === undefined || from.state !== 'ready')
        return yield* new ToolRefused({ message: `The task has no change “${asked}” here to keep together with another.` })
      // Into the change named; else the task's first, or, where that one has shipped, another that hasn't.
      const candidates = all.filter((one) => one.id !== from.id && one.bindingId === from.bindingId && one.state === 'ready')
      let into = intoAsked === null ? undefined : findChange(all, intoAsked)
      if (intoAsked === null)
        for (const one of [...candidates.filter((c) => c.name === null), ...candidates.filter((c) => c.name !== null)])
          if ((yield* pulledOf(one.id)).length === 0) {
            into = one
            break
          }
      if (into === undefined || into.id === from.id || into.bindingId !== from.bindingId || into.state !== 'ready')
        return yield* new ToolRefused({
          message: `Name the change of the task's to keep ${changeWords(from)} together with: one in the same repository.`,
        })
      // Joining takes the folder of the change joined away.
      if (from.madeBy !== null) return yield* madeElsewhere(from)
      for (const one of [from, into])
        if ((yield* pulledOf(one.id)).length > 0)
          return yield* new ToolRefused({
            message: `${changeWords(one)} has a pull request already: changes go together only before either ships.`,
          })
      for (const one of [from, into]) {
        const left = yield* uncommittedFiles(one.path)
        if (left.length > 0)
          return yield* new ToolRefused({ message: `Commit what's changed in ${changeWords(one)} first (${filesWord(left)}).` })
      }
      const head = yield* commitOf(from.path, 'HEAD')
      const start = from.baseCommit ?? (yield* git(from.path, 'merge-base', 'HEAD', into.branch))
      const own = (yield* git(from.path, 'rev-list', '--reverse', '--no-merges', `${start}..${head}`))
        .split('\n')
        .filter((line) => line !== '')
      const conflicted = yield* pickOnto(into.path, own)
      if (conflicted !== null)
        return yield* new ToolRefused({
          message: `${changeWords(from)}'s commits conflict with ${changeWords(into)} in ${filesWord(conflicted)}: both stay as they were.`,
        })
      // Its folder goes and its row says so with nothing bringing the folder back between (`withFolder`).
      yield* withFolder(
        taskId,
        Effect.gen(function* () {
          if (from.path !== into.path) {
            const root = (yield* git(from.path, 'rev-parse', '--git-common-dir').pipe(Effect.orElseSucceed(() => ''))).replace(
              /\/\.git$/,
              '',
            )
            yield* removeWorktree(root === '' ? into.path : root, from.path)
          }
          yield* goneRow(from, 'workspace.joined', { into: into.id, commits: own.length }, actorId)
        }),
      )
      const named = from.name ?? from.branch
      yield* lineIn(
        from,
        `Kept together: ${named}'s ${commitsWord(own.length)} ${own.length === 1 ? 'is' : 'are'} on ${into.branch} now.`,
        {
          kind: 'joined',
          name: named,
          branch: into.branch,
          toward: null,
        },
      )
      yield* leadHears(
        from,
        `${changeWords(from)} is kept together with ${changeWords(into)}: its ${commitsWord(own.length)} ${own.length === 1 ? 'is' : 'are'} on ${into.branch}, in ${into.path}. Its folder went; its branch, ${from.branch}, stays. Work on it there from now on.`,
      )
      yield* touchCard(taskId)
    })

  /**
   * Drop it: a change's folder goes, what it hadn't committed committed first; its branch, and any pull request, stay, the
   * pull request followed no more. A branch the lead made in another change's folder gives that folder back to that change.
   */
  const dropChange = (taskId: string, asked: string, actorId: ActorId) =>
    Effect.gen(function* () {
      const all = yield* changesOf(taskId)
      const row = findChange(all, asked)
      if (row === undefined || row.state !== 'ready') return yield* new ToolRefused({ message: `The task has no change “${asked}” here.` })
      if (row.kind === 'checkout')
        return yield* new ToolRefused({ message: `${changeWords(row)} works Local: move it to a worktree first.` })
      if (row.madeBy !== null) return yield* madeElsewhere(row)
      const others = all.filter((one) => one.id !== row.id && one.state === 'ready')
      // The folder another change left, as the lead made this branch there: it goes back to that change, clean or not at all.
      const left = all.find((one) => one.id !== row.id && one.state === 'away' && one.path === row.path)
      if (others.length === 0 && left === undefined)
        return yield* new ToolRefused({
          message: `${changeWords(row)} is the task's only change: its lead needs a folder. Remove the task's worktree instead, which keeps its branch.`,
        })
      const committed = yield* commitLeftIn(row.path, 'Work in progress, as its change was dropped')
      // Its folder goes, or back to the change that left it, and its row says so with nothing bringing the folder back
      // between (`withFolder`).
      yield* withFolder(
        taskId,
        Effect.gen(function* () {
          if (left !== undefined) {
            yield* git(row.path, 'switch', '--quiet', left.branch)
            const sql = yield* SqlClient.SqlClient
            yield* sql.withTransaction(
              Effect.gen(function* () {
                const revision = yield* change('workspaces', left.id, { state: 'ready' })
                yield* fact({
                  projectId: left.projectId,
                  aggregateType: 'workspace',
                  aggregateId: left.id,
                  revision,
                  type: 'workspace.back',
                  payload: { from: row.id },
                  actorId,
                })
              }),
            )
          } else {
            const root = (yield* git(row.path, 'rev-parse', '--git-common-dir').pipe(Effect.orElseSucceed(() => ''))).replace(
              /\/\.git$/,
              '',
            )
            yield* removeWorktree(root, row.path)
          }
          yield* goneRow(row, 'workspace.dropped', { committed }, actorId)
        }),
      )
      for (const pulled of yield* pulledOf(row.id))
        if (pulled.state === 'open') yield* stopListening(taskId, pulled.url).pipe(Effect.ignore)
      const named = row.name ?? row.branch
      yield* lineIn(row, `Dropped ${named}: its folder went, ${row.branch} stays.`, {
        kind: 'dropped',
        name: named,
        branch: row.branch,
        toward: null,
      })
      yield* leadHears(
        row,
        `${changeWords(row)} was dropped: its folder went${committed ? ', what it hadn’t committed committed first' : ''}, and its branch, ${row.branch}, stays. Its work isn't the task's any more; start it again with start_change if it is needed.`,
      )
      yield* touchCard(taskId)
    })

  /**
   * A task's only worktree removed, as its workspace part's Remove says while it runs: it moves down to a copy, detached
   * where its work starts from, what it hadn't committed committed on its branch first, which stays. Its lead carries on in
   * the same folder, told so, and takes a branch again where it writes.
   */
  const leaveWorktree = (taskId: string, actorId: ActorId) =>
    Effect.gen(function* () {
      const all = (yield* changesOf(taskId)).filter((one) => one.state === 'ready')
      const [row] = all
      if (row === undefined) return yield* new ToolRefused({ message: 'The task has no worktree here to remove.' })
      if (all.length > 1) return yield* new ToolRefused({ message: 'The task has several changes: name the one to drop.' })
      if (row.kind === 'checkout') return yield* new ToolRefused({ message: 'The task works Local: move it to a worktree first.' })
      if (row.madeBy !== null) return yield* madeElsewhere(row)
      const committed = yield* commitLeftIn(row.path, 'Work in progress, as the task’s worktree was removed')
      const base = row.baseCommit ?? (yield* commitOf(row.path, 'HEAD'))
      yield* git(row.path, 'switch', '--quiet', '--detach', base)
      const sql = yield* SqlClient.SqlClient
      yield* sql.withTransaction(
        Effect.gen(function* () {
          const revision = yield* change('workspaces', row.id, { branchedAt: null })
          yield* fact({
            projectId: row.projectId,
            aggregateType: 'workspace',
            aggregateId: row.id,
            revision,
            type: 'workspace.to_copy',
            payload: { branch: row.branch, committed },
            actorId,
          })
        }),
      )
      yield* lineIn(row, `The worktree is a copy now: ${row.branch} stays, with all its work.`)
      yield* leadHears(
        row,
        `The task's worktree was removed: ${row.path} is a copy now, detached where the work started, and ${row.branch} keeps all of it${committed ? ', what you hadn’t committed committed first' : ''}. Where you write again, Althar makes the task a branch where it stands.`,
      )
      yield* touchCard(taskId)
    })

  /*
   * A running task's change pointed at another branch to work toward (a task is a conversation plus parts). Its own
   * commits are what it has past where it started; each it rewrites is kept beside its copy (`rewritten`), so the mark of
   * what its last review read moves with it, and the next review reads only what came since.
   */
  const retarget = (taskId: string, asked: string | null, changeName: string | null) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<{
        id: string
        projectId: ProjectId
        threadId: string
        path: string
        branch: string
        toward: string | null
        baseCommit: string | null
        heldAt: string | null
        repository: string
        base: string | null
        changeTarget: string | null
        name: string
      }>`
            SELECT w.id, w.project_id, (SELECT t.id FROM threads t WHERE t.task_id = w.task_id AND t.kind = 'task') AS thread_id,
              w.path, w.branch, w.toward, w.base_commit, w.held_at, l.path AS repository, b.default_base_ref AS base, b.change_target,
              b.display_name AS name
            FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id
            JOIN repository_locations l ON l.binding_id = b.id AND l.device_id = w.device_id
            WHERE w.task_id = ${taskId} AND w.device_id = ${instance.deviceId} AND w.access = 'write' AND w.reviewing IS NULL
              AND w.state = 'ready' AND w.branched_at IS NOT NULL AND w.name IS ${changeName}
            ORDER BY b.created_at, b.rowid`
      const said: Array<string> = []
      const conflicts: Array<string> = []
      const opens: Array<string> = []
      for (const row of rows) {
        const toward = yield* towardIn({ ...row, workToward: null }, asked)
        if (toward === row.toward) continue
        const { remote, base } = yield* startOf({ ...row, toward })
        if (!(yield* hasBranch(row.repository, base, remote))) return yield* new BranchNotFound({ branch: base, repository: row.name })
        const left = yield* uncommittedFiles(row.path)
        if (left.length > 0)
          return yield* new ToolRefused({ message: `Commit what's changed in ${row.name} first (${filesWord(left)}): then it moves.` })
        const { baseRef, baseCommit } = yield* startCommitOf(row.repository, base, remote)
        const head = yield* commitOf(row.path, 'HEAD')
        const from = row.baseCommit ?? head
        const own = (yield* git(row.path, 'rev-list', '--reverse', '--no-merges', `${from}..${head}`))
          .split('\n')
          .filter((line) => line !== '')
        const [open] = yield* sql<{ id: string; url: string; number: number }>`
              SELECT l.id, l.url, json_extract(l.snapshot, '$.number') AS number FROM external_links l
              JOIN repository_changes c ON c.pull_request_url = l.url
              WHERE c.workspace_id = ${row.id} AND l.kind = 'change' AND l.listening = 1
                AND json_extract(l.snapshot, '$.state') = 'open'
                AND coalesce(json_extract(l.snapshot, '$.source'), ${row.branch}) = ${row.branch}
              ORDER BY l.created_at DESC LIMIT 1`
        let branch = row.branch
        let stopped: Array<string> = []
        if (open === undefined) {
          // Nothing pushed: the branch is rebased onto the new one, its commits written as the person's or Althar's. A conflict
          // stops it there, for the lead to finish; anything else puts it back as it was.
          const rebased = yield* gitOutcome(row.path, ...(yield* committerIn(row.path)), 'rebase', '--onto', baseCommit, from)
          if (rebased.code !== 0) {
            stopped = (yield* gitOutcome(row.path, 'diff', '--name-only', '--diff-filter=U')).stdout
              .split('\n')
              .filter((file) => file !== '')
            if (stopped.length === 0) {
              yield* gitOutcome(row.path, 'rebase', '--abort')
              return yield* new ToolRefused({
                message: `${row.name} couldn’t be rebased onto ${base}, so it still works toward ${row.toward ?? row.base ?? 'its default branch'}, as it was.`,
              })
            }
            conflicts.push(...stopped)
          }
        } else {
          // Pushed: its pull request can't change its history, so its own commits go onto a fresh branch from the new one.
          let fresh = `${row.branch}-2`
          for (let n = 3; yield* branchExists(row.path, fresh); n += 1) fresh = `${row.branch}-${n}`
          yield* git(row.path, 'checkout', '-q', '-b', fresh, baseCommit)
          const conflicted = yield* pickOnto(row.path, own)
          if (conflicted !== null) {
            yield* Effect.ignore(git(row.path, 'checkout', '-q', row.branch))
            yield* Effect.ignore(git(row.path, 'branch', '-D', fresh))
            // Put back as it was: nothing is left for its lead to resolve, which `conflicts` is for, and `said` says why.
            said.push(
              `${row.name} still works toward ${row.toward ?? row.base ?? 'its default branch'}: its commits conflict with ${base} in ${filesWord(conflicted)}.`,
            )
            continue
          }
          branch = fresh
        }
        const now = yield* commitOf(row.path, 'HEAD')
        const copies =
          stopped.length > 0
            ? []
            : (yield* git(row.path, 'rev-list', '--reverse', '--no-merges', `${baseCommit}..${now}`))
                .split('\n')
                .filter((line) => line !== '')
        const rewritten = copies.length === own.length ? Object.fromEntries(own.map((old, index) => [old, copies[index] ?? ''])) : {}
        yield* sql.withTransaction(
          Effect.gen(function* () {
            const revision = yield* change('workspaces', row.id, { toward, baseRef, baseCommit, branch })
            yield* fact({
              projectId: row.projectId,
              aggregateType: 'workspace',
              aggregateId: row.id,
              revision,
              type: 'workspace.toward_set',
              payload: { toward, from: row.branch, branch, rewritten, ...(open === undefined ? {} : { left: open.url }) },
              actorId: instance.systemId,
            })
            // The old pull request stays open on its host, for the person to close: Althar follows it no more.
            if (open !== undefined) yield* change('external_links', open.id, { listening: 0, updatedAt: yield* timestamp })
          }),
        )
        if (open !== undefined) {
          if (row.heldAt === null) opens.push(row.id)
          said.push(
            `${row.name} works toward ${base} now, on ${branch}: its ${commitsWord(own.length)} cherry-picked from ${row.branch}. PR #${open.number} still goes into ${row.toward ?? row.base ?? 'its default branch'}: close it once the new one is open.`,
          )
        } else
          said.push(
            stopped.length === 0
              ? `${row.name} works toward ${base} now: its ${commitsWord(own.length)} rebased onto it.`
              : `${row.name} works toward ${base} now, but rebasing onto it stopped on conflicts in ${filesWord(stopped)}.`,
          )
        if (row.threadId !== null)
          yield* addItem({ projectId: row.projectId, threadId: row.threadId }, 'notice', {
            source: 'runtime',
            severity: stopped.length === 0 ? 'info' : 'warning',
            title: said.at(-1) ?? '',
          })
      }
      yield* touchCard(taskId)
      return { said, opens, conflicts }
    })

  return {
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
  }
}
