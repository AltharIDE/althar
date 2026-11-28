import { createHash } from 'node:crypto'
import { relative, sep } from 'node:path'
import {
  type Account,
  ChangeRequest,
  type CodeHost,
  Comment,
  ConnectorFailed,
  type Product,
  type PushTarget,
  type Repository,
  parseRemote,
} from '@althar/connectors'
import { type ActorId, type ChangeTarget, Ids, type ProjectId, newId } from '@althar/domain'
import type { CommandIdReused, Ledger, RevisionConflict, RowNotFound } from '@althar/persistence-sqlite'
import type { PermissionRequest } from '@althar/provider-adapters'
import { Clock, type Crypto, Deferred, Effect, Option, Ref, Schema, type Scope } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'
import { touchCard, touchTask } from './cards'
import {
  type Askable,
  type Asked,
  COMMITS_SHOWN,
  type ChangeSummary,
  type HereRow,
  type Host,
  LANDING_EVERY,
  LANDING_TURNS,
  type LinkRow,
  Snapshot,
  type Store,
  TAG_ANSWERED_WITHIN,
  decodeAsked,
  pushedWords,
  samePath,
  sourceOf,
  refusalOf,
} from './changeRecords'
import { hostName } from './checkLogs'
import type { Conflict, FailedChecks } from './conflicts'
import type { Connections } from './Connections'
import { conventionsAt, ruleOf, titleFor } from './conventions'
import { type Memory, withoutAgentCredit } from './credit'
import { envelope } from './envelope'
import {
  CantMerge,
  ChangedSinceSeen,
  GitFailed,
  NotFound,
  OutwardUncertain,
  PushRefused,
  type SessionFailed,
  type SessionRunning,
  ShipRefused,
  type TaskRefused,
  type UnknownAgent,
} from './errors'
import { contained } from './Failures'
import type { FastLane } from './fastLane'
import {
  askedRemoteTip,
  branchOn,
  branchRemoteIn,
  commitOf,
  commitsOf,
  countBetween,
  fetchInto,
  fetchedInto,
  git,
  gitOutcome,
  gitWithin,
  isUnder,
  logBetween,
  namedRemotes,
  onHead,
  pushTo,
  remoteOf,
  remoteTip,
  uncommittedFiles,
} from './git'
import { redacted } from './gitSaid'
import type { Instance, InstanceInfo } from './Instance'
import { applyMerges, planMerge } from './localMerge'
import type { AskedAction, FreshAction } from './Errands'
import { outward } from './outward'
import { Policies, ruleSetOf } from './Policies'
import { describedAs, describedOf, nameOf, queuedNote, sameDescription, signed, titleWords, withDescribed } from './pullRequestWords'
import { pushDetailOf, pushFailureOf } from './pushFailure'
import { change, fact, timestamp } from './records'
import { guardPush } from './repositoryGuard'
import type { Sessions } from './Sessions'
import { TITLE_LENGTH, retitleTask } from './taskTitle'
import { addItem, updateItem } from './threads'
import { ActionNotPerformed } from './toolErrors'
import { type ToolAccess, ToolRefused } from './ToolServer'
import { words } from './words'

// A connected token can be scoped to the target repository. The person's configured Git can also sign in to the fork.
export const withContributorGit = <A>(contributor: boolean, target: PushTarget, run: (target: PushTarget) => Effect.Effect<A, GitFailed>) =>
  run(target).pipe(
    Effect.catchIf(
      (failed) => {
        if (!contributor || target.header === null) return false
        const why = pushFailureOf(failed)?.why
        return why === 'denied' || why === 'forbidden' || /repository not found|returned error: 404/i.test(failed.stderr)
      },
      () => run({ ...target, header: null }),
    ),
  )

const TagAsked = Schema.Struct({ tag: Schema.String, repository: Schema.optional(Schema.NullOr(Schema.String)) })

export interface ChangeHostDependencies {
  readonly agentNames: string[]
  readonly arrive: (
    link: LinkRow,
    content: Readonly<Record<string, unknown>>,
  ) => Effect.Effect<void, SqlError.SqlError | Schema.SchemaError, SqlClient.SqlClient | Ledger | Crypto.Crypto>
  readonly askable: (
    taskId: string,
    url: string | null,
    how?: { readonly force?: boolean; readonly targets?: ReadonlyArray<string> },
  ) => Effect.Effect<Askable, unknown, Store>
  readonly baseMoved: Effect.Effect<void>
  readonly beginRound: (
    task: { readonly projectId: ProjectId; readonly taskId: string; readonly threadId: string },
    url: string | null,
    conflicts: ReadonlyArray<Conflict>,
    failed?: FailedChecks | null,
  ) => Effect.Effect<void, unknown, Store>
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
  readonly fastLane: FastLane['Service']
  readonly follow: (
    taskId: string,
    event: 'opened' | 'merged',
    change: Parameters<typeof nameOf>[0] & { readonly url: string },
  ) => Effect.Effect<void>
  readonly forgetUnsent: (
    taskId: string,
  ) => Effect.Effect<void, SqlError.SqlError | Schema.SchemaError | RowNotFound | RevisionConflict, SqlClient.SqlClient | Ledger>
  readonly heard: (
    link: LinkRow,
    kind: string,
    id: string,
    payload: Readonly<Record<string, unknown>>,
  ) => Effect.Effect<
    boolean,
    SqlError.SqlError | Schema.SchemaError | RowNotFound | RevisionConflict,
    SqlClient.SqlClient | Ledger | Crypto.Crypto
  >
  readonly heldBelow: (
    taskId: string,
    above: { readonly id: string; readonly path: string },
    depth?: number,
  ) => Effect.Effect<string | null, unknown, Store>
  readonly holdBeforePush: (taskId: string) => Effect.Effect<void, unknown, Store>
  readonly hostOfRemotes: (remotes: ReadonlyArray<string>) => Effect.Effect<Host | null, never, Store>
  readonly instance: InstanceInfo
  readonly lineIn: (
    row: { readonly projectId: ProjectId; readonly threadId: string | null },
    title: string,
    step?: Record<string, unknown>,
  ) => Effect.Effect<void> | Effect.Effect<string, SqlError.SqlError | Schema.SchemaError, SqlClient.SqlClient | Ledger | Crypto.Crypto>
  readonly linksOf: (taskId: string) => Effect.Effect<readonly LinkRow[], SqlError.SqlError, SqlClient.SqlClient>
  readonly locked: (taskId: string) => <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  readonly memory: Memory
  readonly news: (taskId: string) => Effect.Effect<undefined>
  readonly poll: (asked: LinkRow, how?: { readonly force: boolean; readonly fresh: boolean }) => Effect.Effect<boolean, unknown, Store>
  readonly provide: <A, E>(effect: Effect.Effect<A, E, Store>) => Effect.Effect<A, E, never>
  readonly pushLeft: (taskId: string, late?: boolean) => Effect.Effect<void, unknown, Store>
  readonly remotesOf: (repository: { readonly remotes: string }) => readonly string[] | never[]
  readonly saveSnapshot: (
    link: LinkRow,
    snapshot: Snapshot,
    set?: Readonly<Record<string, unknown>>,
  ) => Effect.Effect<void, SqlError.SqlError | Schema.SchemaError | RowNotFound | RevisionConflict, SqlClient.SqlClient | Ledger>
  readonly sayOn: (
    link: LinkRow,
    title: string,
    description?: string,
  ) => Effect.Effect<void, SqlError.SqlError | Schema.SchemaError, SqlClient.SqlClient | Ledger | Crypto.Crypto>
  readonly scope: Scope.Scope
  readonly sessions: Sessions['Service']
  readonly settleIfDone: (
    taskId: string,
    by?: {
      readonly actorId: ActorId
      readonly here?: ReadonlyArray<{ readonly repository: string; readonly branch: string; readonly already: boolean }>
    },
  ) => Effect.Effect<void, unknown, Store>
  readonly summaryOf: (link: LinkRow) => Effect.Effect<ChangeSummary, Schema.SchemaError>
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
  readonly urlsOf: (taskId: string) => Effect.Effect<Snapshot[], SqlError.SqlError, SqlClient.SqlClient>
  readonly wakeNow: (taskId: string | null) => void
}

export const makeChangeHost = (dependencies: ChangeHostDependencies) => {
  const {
    agentNames,
    baseMoved,
    connections,
    credited,
    current,
    decodeSnapshot,
    fastLane,
    follow,
    heldBelow,
    hostOfRemotes,
    instance,
    lineIn,
    linksOf,
    locked,
    memory,
    news,
    provide,
    saveSnapshot,
    scope,
    sessions,
    summaryOf,
  } = dependencies

  /**
   * A task's pull requests, the bottom of each stack before what is
   * stacked on it, as Ship and Merge go through them; otherwise in the
   * order they came.
   */
  const bottomUp = (taskId: string, links: ReadonlyArray<LinkRow>) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<{ url: string; id: string; bindingId: string; branch: string; toward: string | null }>`
            SELECT c.pull_request_url AS url, w.id, w.binding_id, w.branch, w.toward FROM repository_changes c
            JOIN workspaces w ON w.id = c.workspace_id WHERE w.task_id = ${taskId} AND c.pull_request_url IS NOT NULL`
      const depthOf = (url: string) => {
        let depth = 0
        let at = rows.find((row) => row.url === url)
        const seen = new Set<string>()
        while (at !== undefined && at.toward !== null && !seen.has(at.id)) {
          seen.add(at.id)
          const { bindingId, toward } = at
          at = rows.find((row) => row.bindingId === bindingId && row.branch === toward)
          if (at !== undefined) depth += 1
        }
        return depth
      }
      const urls = yield* Effect.forEach(links, (link) =>
        Effect.map(Effect.option(decodeSnapshot(link.snapshot)), (seen) => (Option.isSome(seen) ? seen.value.url : '')),
      )
      return links
        .map((link, index) => ({ link, depth: depthOf(urls[index] ?? ''), index }))
        .toSorted((a, b) => a.depth - b.depth || a.index - b.index)
        .map((one) => one.link)
    })

  /** The worktree of the repository a pull request is from, with its default branch and the task's thread; the task's first, where the record doesn't say. */
  const worktreeOf = (taskId: string, url: string) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const [workspace] = yield* sql<{
        id: string
        path: string
        branch: string
        base: string
        baseCommit: string | null
        threadId: string
        heldAt: string | null
        stacked: number
      }>`
            SELECT w.id, w.path, w.branch, coalesce(w.toward, b.default_base_ref, w.base_ref) AS base, w.base_commit,
              (SELECT t.id FROM threads t WHERE t.task_id = w.task_id AND t.kind = 'task') AS thread_id, w.held_at,
              EXISTS (SELECT 1 FROM workspaces s WHERE s.task_id = w.task_id AND s.binding_id = w.binding_id AND s.branch = w.toward
                AND s.id <> w.id AND s.reviewing IS NULL) AS stacked
            FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id
            WHERE w.task_id = ${taskId} AND w.device_id = ${instance.deviceId} AND w.access = 'write'
            ORDER BY w.id = (SELECT c.workspace_id FROM repository_changes c WHERE c.pull_request_url = ${url} LIMIT 1) DESC,
              b.created_at, b.rowid
            LIMIT 1`
      if (workspace === undefined) return undefined
      const { stacked, ...rest } = workspace
      // Held by what waits beneath it, it goes up only with the Ship that ships that too.
      if (rest.heldAt !== null || stacked !== 1) return rest
      return { ...rest, heldAt: yield* heldBelow(taskId, rest) }
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
   * The repository a pull request's branch is on, where its commits are
   * pushed, whatever the project says of the task's next ones (ADR-085):
   * where its host last said, else where it says now. Where it says the
   * fork is gone, nowhere. Where it doesn't say, the one repository of the
   * clone's remotes whose branch of that name stands at the head the host
   * gives now: a branch's name or a saved head doesn't make it the pull
   * request's, and a push for an open pull request never makes a new one.
   * The host unread or a remote unanswered settles nothing, so nothing goes.
   */
  const branchRepositoryOf = (
    taskId: string,
    host: CodeHost,
    repository: Repository,
    path: string,
    pull: { readonly number: number; readonly source: string; readonly head?: ReadonlyArray<string> | null | undefined },
  ) =>
    Effect.gen(function* () {
      const remote = `${host.words.short} ${host.words.prefix}${pull.number}`
      const read = pull.head !== undefined ? null : yield* host.change(repository, pull.number)
      const head = pull.head !== undefined ? pull.head : read?.headRepository
      if (head === null) return repository
      if (head !== undefined && head.length > 0) return samePath(head, repository.path) ? repository : yield* host.repository(head)
      if (head !== undefined) return yield* new PushRefused({ taskId, why: 'fork_gone', remote })
      const unplaced = new PushRefused({ taskId, why: 'unplaced', remote })
      const at = read?.headSha
      if (at === undefined || at === null) return yield* unplaced
      const remotes = yield* namedRemotes(path).pipe(Effect.mapError(() => unplaced))
      const places = remotes.flatMap(({ url }) => parseRemote(url) ?? [])
      // Its own remote says the name the clone knows this host by, which its web address may not.
      const here = places.find((place) => samePath(place.path, repository.path))?.host ?? parseRemote(repository.webUrl)?.host
      const paths = places.filter((place) => place.host === here && !samePath(place.path, repository.path)).map((place) => place.path)
      const others = yield* Effect.forEach(
        paths.filter((one, index) => paths.findIndex((other) => samePath(one, other)) === index),
        (other) =>
          host.repository(other).pipe(
            Effect.catchIf(
              (error) => error.reason === 'not_found',
              () => Effect.succeed(null),
            ),
          ),
      )
      // A remote that doesn't answer may be the one with the branch, so none settles it then.
      const holding = yield* Effect.filter([repository, ...others.filter((other) => other !== null)], (candidate) =>
        Effect.gen(function* () {
          const tip = yield* askedRemoteTip(path, yield* host.pushTarget(candidate), pull.source).pipe(Effect.mapError(() => unplaced))
          return tip === at
        }),
      )
      const [on] = holding
      if (on === undefined || holding.length > 1) return yield* unplaced
      return on
    })

  /** Where a pull request's commits are pushed: the repository its branch is on. */
  const pushTargetOf = (
    taskId: string,
    host: CodeHost,
    repository: Repository,
    path: string,
    pull: { readonly number: number; readonly source: string; readonly head?: ReadonlyArray<string> | null | undefined },
  ) => Effect.flatMap(branchRepositoryOf(taskId, host, repository, path, pull), (on) => host.pushTarget(on))

  /** A contributor can revoke maintainer edits, close the pull request or delete its branch after a task attaches. */
  const tipBeforePush = (
    taskId: string,
    snapshot: Snapshot,
    path: string,
    target: { readonly url: string; readonly header: string | null },
    onto: string,
    { host, repository, own }: { readonly host: CodeHost; readonly repository: Repository; readonly own: Repository },
  ) =>
    Effect.gen(function* () {
      if (snapshot.maintainerEdit !== true) return yield* remoteTip(path, target, onto)
      const remote = nameOf(snapshot)
      const now = yield* host.change(repository, snapshot.number)
      if (now.state !== 'open' || now.source !== onto) return yield* new ChangedSinceSeen({ taskId })
      if (now.maintainerEdits !== true) return yield* new PushRefused({ taskId, why: 'maintainer_edits_disabled', remote })
      if (!repository.canPush) return yield* new PushRefused({ taskId, why: 'forbidden', remote })
      const head = now.headRepository
      if (head?.length === 0) return yield* new PushRefused({ taskId, why: 'fork_gone', remote })
      if (head == null || !samePath(head, own.path)) return yield* new PushRefused({ taskId, why: 'unplaced', remote })
      if (onto === own.defaultBranch) return yield* new PushRefused({ taskId, why: 'protected', remote })
      const tip = yield* withContributorGit(true, target, (gitTarget) => askedRemoteTip(path, gitTarget, onto)).pipe(
        Effect.catchTag('GitFailed', (failed) => refusal(taskId, remote, failed)),
      )
      if (tip === null) return yield* new PushRefused({ taskId, why: 'refused', remote, said: 'the contributor’s branch is gone' })
      return tip
    })

  /** A commit, and what crediting made it from (credit.ts): the branch stays on that until it moves onto what was sent. */
  const madeFrom = (commit: string) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<{ original: string }>`SELECT original FROM credited_commits WHERE credited = ${commit}`
      return [commit, ...rows.map((row) => row.original).filter((original) => original !== commit)]
    }).pipe(Effect.orElseSucceed(() => [commit]))

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
      // Its head as the refs stamp it, so a card standing on it is kept while they don't move; asked of git where they can't say.
      const [stamped] = yield* commitsOf(path, ['HEAD'])
      const head = stamped ?? (yield* commitOf(path, 'HEAD'))
      const [latest] = (yield* commitsOf(
        path,
        [tip, ...known].filter((commit) => commit !== null),
      )).filter((commit) => commit !== null)
      if (tip !== null && latest !== tip) return { kind: 'behind', head } as const
      if (latest === undefined) return { kind: 'unknown', head } as const
      // From here every question is of commits by their ids, whose answers never change and are kept (git.ts `isUnder`).
      let from: string | undefined
      for (const commit of yield* madeFrom(latest))
        if (yield* isUnder(path, commit, head)) {
          from = commit
          break
        }
      if (from === undefined) return { kind: 'rewritten', from: latest, head } as const
      const count = yield* countBetween(path, from, head)
      const listed = count === 0 ? '' : yield* logBetween(path, from, head, '%h%x1f%s')
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
  ) => Effect.flatMap(timestamp, (at) => updateItem(asked.projectId, asked.id, { ...asked.content, state, settledAt: at } satisfies Asked))

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
  const pushedAsked = (link: LinkRow, url: string, path: string, pushed: ReadonlyArray<string>, by: 'person' | 'althar') =>
    Effect.gen(function* () {
      const told: Array<string> = []
      for (const asked of yield* askedOf(link.taskId, url)) {
        if (!(yield* behindAny(path, yield* asCredited(asked.content.head), pushed))) continue
        yield* settleAsked(asked, 'pushed')
        // Pushed as the lead's turn ended (ADR-072): it isn't woken to hear it, and reads it on the pull request.
        if (by === 'althar') continue
        told.push(
          asked.content.count === 1
            ? `The person pushed your commit to ${asked.content.where}, as you asked: the pull request has it now.`
            : `The person pushed your ${asked.content.count} commits to ${asked.content.where}, as you asked: the pull request has them now.`,
        )
      }
      // News that needs nothing of the lead: read with its next turn.
      yield* dependencies.tellLead(link, told, false, 'note')
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
      const own = yield* branchRepositoryOf(taskId, host, repository, workspace.path, {
        ...snapshot,
        source: sourceOf(snapshot, workspace.branch),
      })
      const pushTarget = yield* host.pushTarget(own)
      return {
        link,
        snapshot,
        workspace,
        pushTarget,
        sent: yield* sentTo(link.projectId, snapshot.url),
        destination: { host, repository, own },
      }
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
  const pushedTo = (
    taskId: string,
    link: LinkRow,
    snapshot: Snapshot,
    path: string,
    seen: string,
    head: string,
    by: 'person' | 'althar' = 'person',
  ) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`UPDATE repository_changes SET head_commit = ${head}, updated_at = ${yield* timestamp}, revision = revision + 1
            WHERE pull_request_url = ${snapshot.url} AND project_id = ${link.projectId}`
      // When it went up, for its checks to show within `checksAppear` of: the record's own time moves with every look.
      yield* dependencies.heard(link, 'pushed', `pushed:${head}`, { sha: head })
      yield* saveSnapshot(link, { ...snapshot, headSha: head })
      // What the lead asked the person to push that went up: its request says so, and the lead hears it.
      yield* pushedAsked(link, snapshot.url, path, [seen, head], by).pipe(
        Effect.catchCause((cause) => Effect.logWarning('Could not tell the lead what was pushed', cause)),
      )
      yield* news(taskId)
      dependencies.wakeNow(taskId)
      return { change: yield* summaryOf({ ...link, snapshot: JSON.stringify({ ...snapshot, headSha: head }) }) }
    })

  /**
   * Pushes the task's branch to its open pull request, up to `seen`: the
   * person's Push, Althar's own course, or Ship (`ship`). A worktree held
   * for Ship goes up only with Ship, which reviewed it first: nothing else
   * pushes past the person's commits (a task is a conversation plus
   * parts, "A tweak waits for Ship").
   */
  const push = (taskId: string, seen: string, url?: string, by: 'person' | 'althar' | 'ship' = 'person') =>
    Effect.gen(function* () {
      if (by !== 'ship') yield* dependencies.holdBeforePush(taskId)
      const { link, snapshot, workspace, pushTarget, sent, destination } = yield* pushingTo(taskId, url)
      if (workspace.heldAt !== null && by !== 'ship') return yield* new ShipRefused({ taskId, why: 'held' })
      // Onto the pull request's own branch, which for one attached to the task may be called otherwise (ADR-052).
      const onto = sourceOf(snapshot, workspace.branch)
      const tip = yield* tipBeforePush(taskId, snapshot, workspace.path, pushTarget, onto, destination)
      const { head, settle } = yield* credited(workspace.path, workspace.branch, seen, [snapshot.headSha, sent, tip])
      // What Althar last pushed before what it last saw: a pull request read before that push is behind it.
      yield* stillOnHead(taskId, snapshot.url, workspace.path, seen, head, tip, [sent, snapshot.headSha])
      yield* guardPush({
        projectId: link.projectId,
        taskId,
        remote: nameOf(snapshot),
        cwd: workspace.path,
        base: workspace.baseCommit,
        ref: workspace.base,
        head,
      })
      // Refused, it says why in a sentence, not git's hint: the pull request has commits the branch doesn't.
      yield* withContributorGit(snapshot.maintainerEdit === true, pushTarget, (target) =>
        pushTo(workspace.path, target, workspace.branch, head, undefined, onto),
      ).pipe(Effect.catchTag('GitFailed', (failed) => refusal(taskId, nameOf(snapshot), failed)))
      yield* settle
      return yield* pushedTo(taskId, link, snapshot, workspace.path, seen, head, by === 'althar' ? 'althar' : 'person')
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
      if (snapshot.maintainerEdit === true) return yield* new PushRefused({ taskId, why: 'contributor_force_push', remote: where })
      const { rules } = yield* (yield* Policies).current(link.projectId)
      if (ruleSetOf(rules).never.includes('force-push')) return yield* new PushRefused({ taskId, why: 'never', remote: where })
      const { head, settle } = yield* credited(workspace.path, workspace.branch, seen, [replaces, sent])
      yield* stillOnHead(taskId, snapshot.url, workspace.path, seen, head, null, [replaces, sent])
      yield* guardPush({
        projectId: link.projectId,
        taskId,
        remote: where,
        cwd: workspace.path,
        base: workspace.baseCommit,
        ref: workspace.base,
        head,
      })
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
        title: `Force-pushed to ${where}.`,
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
      // Where it can't be fetched, git's own words say why.
      const head = yield* withContributorGit(snapshot.maintainerEdit === true, pushTarget, (target) =>
        fetchedInto(workspace.path, target, onto, ref),
      )
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
  const merge = (
    taskId: string,
    head: string,
    url?: string,
    bypassQueue = false,
    stands?: Effect.Effect<void, unknown>,
  ): Effect.Effect<void, unknown, Store> =>
    Effect.gen(function* () {
      const { link, snapshot, host, repository } = yield* current(taskId, url)
      if (snapshot.state !== 'open') return
      const sql = yield* SqlClient.SqlClient
      // Stacked on another of the task's changes, the one below merges first, as it stands, and this goes into what it went
      // into once it has (a task is a conversation plus parts, "Merge on a stacked change offers the whole stack").
      const [below] = yield* sql<{ url: string }>`
            SELECT l.url FROM repository_changes c JOIN workspaces w ON w.id = c.workspace_id
            JOIN workspaces a ON a.task_id = w.task_id AND a.binding_id = w.binding_id AND a.toward = w.branch AND a.id <> w.id
            JOIN repository_changes ac ON ac.workspace_id = a.id AND ac.pull_request_url = ${snapshot.url}
            JOIN external_links l ON l.url = c.pull_request_url AND l.kind = 'change' AND l.task_id = ${taskId}
            WHERE w.task_id = ${taskId} AND json_extract(l.snapshot, '$.state') = 'open'
            ORDER BY l.created_at DESC LIMIT 1`
      if (below !== undefined) {
        const under = yield* current(taskId, below.url)
        const now = yield* under.host.change(under.repository, under.snapshot.number)
        yield* merge(taskId, now.headSha ?? under.snapshot.headSha ?? '', below.url, false, stands)
        const after = yield* current(taskId, below.url)
        if (after.snapshot.state !== 'merged')
          return yield* dependencies.sayOn(
            link,
            `${nameOf(snapshot)} merges once ${nameOf(under.snapshot)} below it has: press Merge again then.`,
          )
        return yield* merge(taskId, head, snapshot.url, bypassQueue, stands)
      }
      const read = yield* host.change(repository, snapshot.number, { queue: true })
      // In its merge queue already, put there from outside Althar before a turn heard it, it isn't merged again: it is kept
      // in it, and its thread says so where it hasn't.
      if (read.state === 'open' && read.queued === true && !bypassQueue) {
        yield* seenNow(link, snapshot, read)
        if (snapshot.queued !== true) yield* dependencies.sayOn(link, queuedNote(nameOf(snapshot), snapshot.target))
      } else if (read.state === 'open') {
        if (read.headSha !== head) return yield* new ChangedSinceSeen({ taskId })
        if (read.draft) yield* markReady(taskId)
        const merged = yield* outward({
          projectId: link.projectId,
          subject: { type: 'external_link', id: link.id },
          target: `${host.product}:${snapshot.repository.join('/')}`,
          operation: 'merge',
          // A merge at another head is another merge, as is one after the merge queue took it out.
          key: `merge:${link.id}:${head}${snapshot.leftQueue === undefined ? '' : `:${snapshot.leftQueue}`}${bypassQueue ? ':without_queue' : ''}`,
          request: { number: snapshot.number, head, ...(bypassQueue ? { bypassQueue: true } : {}) },
          retryable: false,
          ...(stands === undefined ? {} : { stands }),
          perform: (bypassQueue
            ? host.mergeWithoutQueue === undefined
              ? Effect.fail(
                  new ConnectorFailed({
                    product: host.product,
                    reason: 'rejected',
                    message: 'This host does not support merging without its queue.',
                  }),
                )
              : host.mergeWithoutQueue(repository, { ...read, headSha: head })
            : host.merge(repository, { ...read, headSha: head })
          ).pipe(
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
              locked(taskId)(dependencies.poll(now)).pipe(
                Effect.catchCause((cause) => Effect.logWarning('Could not listen to a merged pull request', cause)),
              ),
              scope,
            )
          return
        }
        // In its target branch's merge queue, it merges once the queue's checks pass, which takes as long as they do: kept so,
        // said in its thread, and asked about the queue on each listening turn until it lands or the queue takes it out.
        if (merged.queued === true) {
          yield* seenNow(link, snapshot, merged)
          if (snapshot.queued !== true) yield* dependencies.sayOn(link, queuedNote(nameOf(snapshot), snapshot.target))
        }
        // Taken but not landed yet (Bitbucket answers 202 to one that takes long): asked about again soon, until it has.
        else if (merged.state === 'open') yield* Effect.forkIn(landing(taskId, link.id), scope)
      }
      const [now] = (yield* linksOf(taskId)).filter((candidate) => candidate.id === link.id)
      if (now !== undefined) yield* dependencies.poll(now)
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
        yield* locked(taskId)(dependencies.poll(now)).pipe(
          Effect.catchCause((cause) => Effect.logWarning('Could not hear whether a merge landed', cause)),
        )
      }
    }).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not hear whether a merge landed', cause)))

  /** The change a pull request's change waits for to merge, by name, while that one's pull request is open; else null. */
  const waitingOn = (taskId: string, url: string) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const [waits] = yield* sql<{ name: string | null; branch: string }>`
            SELECT o.name, o.branch FROM repository_changes c JOIN workspaces w ON w.id = c.workspace_id
            JOIN workspaces o ON o.id = w.waits_for
            WHERE c.pull_request_url = ${url} AND w.task_id = ${taskId} AND w.waits_for IS NOT NULL LIMIT 1`
      return waits === undefined ? null : (waits.name ?? waits.branch)
    })

  /**
   * Once a change merges, each change of the task that waited for it waits no more: what it goes into, with what merged,
   * is brought into its branch, as keeping a branch current does, and goes up as Althar's course has it, held where it is
   * held. A conflict is its lead's, as any is.
   */
  /**
   * A merged change of several, a stamped row of the thread's: "Merged ·
   * Lane heights into main." With one change, the thread's line on the
   * pull request says it.
   */
  const stampMerged = (link: LinkRow, merged: Snapshot) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const [one] = yield* sql<{ projectId: ProjectId; threadId: string | null; name: string | null; branch: string; changes: number }>`
            SELECT w.project_id, t.id AS thread_id, w.name, w.branch,
              (SELECT count(DISTINCT coalesce(o.name, '')) FROM workspaces o WHERE o.task_id = w.task_id AND o.access = 'write'
                AND o.reviewing IS NULL AND o.state IN ('ready', 'away')) AS changes
            FROM repository_changes c JOIN workspaces w ON w.id = c.workspace_id
            LEFT JOIN threads t ON t.task_id = w.task_id AND t.kind = 'task'
            WHERE c.pull_request_url = ${merged.url} AND w.task_id = ${link.taskId} LIMIT 1`
      if (one === undefined || one.changes < 2) return
      const name = one.name ?? one.branch
      const into = merged.target ?? 'main'
      yield* lineIn(one, `Merged · ${name} into ${into}.`, { kind: 'merged', name, branch: into, toward: null })
    }).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not stamp a merged change', cause)))

  const bringInWaiting = (link: LinkRow, merged: Snapshot) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const waiting = yield* sql<{
        id: string
        projectId: ProjectId
        path: string
        name: string | null
        branch: string
        toward: string | null
      }>`
            SELECT w.id, w.project_id, w.path, w.name, w.branch, w.toward FROM workspaces w
            WHERE w.task_id = ${link.taskId} AND w.waits_for IN (
              SELECT c.workspace_id FROM repository_changes c WHERE c.pull_request_url = ${merged.url})`
      for (const one of waiting) {
        yield* sql.withTransaction(
          Effect.gen(function* () {
            const revision = yield* change('workspaces', one.id, { waitsFor: null })
            yield* fact({
              projectId: one.projectId,
              aggregateType: 'workspace',
              aggregateId: one.id,
              revision,
              type: 'workspace.wait_over',
              payload: { merged: merged.url },
              actorId: instance.systemId,
            })
          }),
        )
        const into = merged.target ?? one.toward ?? 'main'
        const brought = yield* Effect.exit(
          Effect.gen(function* () {
            yield* git(one.path, 'fetch', '--quiet', 'origin', into).pipe(Effect.ignore)
            const tip = (yield* gitOutcome(one.path, 'rev-parse', '--verify', '-q', `refs/remotes/origin/${into}`)).stdout
            if (tip === '') return 'none' as const
            const done = yield* gitOutcome(
              one.path,
              '-c',
              'user.name=Althar',
              '-c',
              'user.email=althar@localhost',
              'merge',
              '--no-edit',
              tip,
            )
            if (done.code === 0) return 'merged' as const
            yield* gitOutcome(one.path, 'merge', '--abort')
            return 'conflicts' as const
          }),
        )
        const named = one.name ?? one.branch
        const said =
          brought._tag === 'Success' && brought.value === 'merged'
            ? `${nameOf(merged)} merged: ${named} has ${into} in now, and waits no more.`
            : `${nameOf(merged)} merged: ${named} waits no more, but bringing ${into} in ${brought._tag === 'Success' && brought.value === 'conflicts' ? 'conflicts' : 'didn’t work'}; its lead brings it in.`
        yield* dependencies.sayOn(link, said)
      }
      if (waiting.length > 0) {
        yield* touchCard(link.taskId)
        yield* dependencies.pushLeft(link.taskId).pipe(Effect.ignore)
      }
    })

  /**
   * Once a change's pull request merges, each change of the task stacked
   * on it goes into what the merged one went into (a task is a
   * conversation plus parts, "Starting and splitting"): its workspace
   * works toward that from here, and its open pull request, which went
   * into the merged one's branch, is pointed there on its host, said in
   * the thread. One its host won't point elsewhere is said too, and the
   * person points it.
   */
  const retargetAbove = (link: LinkRow, merged: Snapshot) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const [below] = yield* sql<{ id: string; bindingId: string; branch: string; toward: string | null }>`
            SELECT w.id, w.binding_id, w.branch, w.toward FROM repository_changes c JOIN workspaces w ON w.id = c.workspace_id
            WHERE c.pull_request_url = ${merged.url} AND w.task_id = ${link.taskId} ORDER BY c.created_at DESC LIMIT 1`
      if (below === undefined) return
      const into = merged.target ?? below.toward
      const above = yield* sql<{ id: string; projectId: ProjectId }>`
            SELECT id, project_id FROM workspaces
            WHERE task_id = ${link.taskId} AND binding_id = ${below.bindingId} AND toward = ${below.branch} AND reviewing IS NULL
              AND state <> 'cleaned' AND id <> ${below.id}`
      for (const one of above) {
        yield* sql.withTransaction(
          Effect.gen(function* () {
            const revision = yield* change('workspaces', one.id, { toward: below.toward })
            yield* fact({
              projectId: one.projectId,
              aggregateType: 'workspace',
              aggregateId: one.id,
              revision,
              type: 'workspace.toward_set',
              payload: { toward: below.toward, below: merged.url },
              actorId: instance.systemId,
            })
          }),
        )
        if (into == null) continue
        const [open] = yield* sql<{ url: string }>`
              SELECT l.url FROM repository_changes c JOIN external_links l ON l.url = c.pull_request_url AND l.kind = 'change'
              WHERE c.workspace_id = ${one.id} AND json_extract(l.snapshot, '$.state') = 'open'
                AND json_extract(l.snapshot, '$.target') = ${below.branch}
              ORDER BY l.created_at DESC LIMIT 1`
        if (open === undefined) continue
        const pointed = yield* Effect.exit(
          Effect.gen(function* () {
            const on = yield* current(link.taskId, open.url)
            const now = yield* on.host.change(on.repository, on.snapshot.number)
            const edited = yield* outward({
              projectId: on.link.projectId,
              subject: { type: 'external_link', id: on.link.id },
              target: `${on.host.product}:${on.snapshot.repository.join('/')}`,
              operation: 'edit_change',
              key: `retarget:${on.link.id}:${merged.url}`,
              request: { number: on.snapshot.number, base: into },
              retryable: true,
              perform: on.host.editChange(on.repository, now, { base: into }),
              encode: (answer) => answer,
              decode: (kept) => Option.getOrUndefined(Schema.decodeUnknownOption(ChangeRequest)(kept)),
            })
            yield* saveSnapshot(on.link, { ...on.snapshot, target: edited.target })
            return nameOf(on.snapshot)
          }),
        )
        if (pointed._tag === 'Success')
          yield* dependencies.sayOn(link, `${pointed.value} goes into ${into} now, as ${nameOf(merged)} merged.`)
        else {
          yield* Effect.logWarning('Could not point a stacked pull request elsewhere', pointed.cause)
          yield* dependencies.sayOn(
            link,
            `${nameOf(merged)} merged, but the pull request stacked on it still goes into ${below.branch}: point it at ${into} on its host.`,
          )
        }
      }
      if (above.length > 0) yield* touchCard(link.taskId)
    })

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
        ...(read.queued === true ? { queued: true } : {}),
      }
      const settled = after.state !== 'open'
      yield* saveSnapshot(link, after, settled ? { listening: 0 } : {})
      if (after.state !== before.state && settled)
        yield* dependencies.arrive(link, { kind: after.state, from: null, where: nameOf(before), url: before.url })
      if (settled) for (const asked of yield* askedOf(link.taskId, before.url)) yield* settleAsked(asked, 'closed')
      if (after.state === 'merged' && before.state !== 'merged') {
        yield* Effect.andThen(
          Effect.andThen(
            Effect.andThen(Effect.andThen(stampMerged(link, before), follow(link.taskId, 'merged', before)), baseMoved),
            Effect.andThen(retargetAbove(link, before), bringInWaiting(link, before)).pipe(
              Effect.catchCause((cause) => Effect.logWarning('Could not point what was stacked on a merged change elsewhere', cause)),
            ),
          ),
          // Its review after the merge, where it is owed, reads the change now that it merged, in the task itself.
          Effect.forkIn(fastLane.reviewMerged(link.taskId, before.url), scope).pipe(Effect.asVoid),
        )
      }
      if (after.state === 'merged') yield* dependencies.settleIfDone(link.taskId)
      if (settled) yield* dependencies.forgetUnsent(link.taskId)
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
        Effect.catch((error) =>
          Effect.gen(function* () {
            if (error instanceof ConnectorFailed) return error.message
            yield* Effect.logWarning('Deleting branch failed', error)
            return 'Althar couldn’t delete the branch. Its log has the details.'
          }),
        ),
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
            SELECT b.slug, b.display_name AS name, coalesce(w.toward, b.default_base_ref, w.base_ref) AS base, l.path AS root, w.path AS worktree, w.branch,
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
      const cant = (why: CantMerge['why'], detail = '', said: { into?: string; files?: ReadonlyArray<string> } = {}) =>
        new CantMerge({ taskId, why, detail, ...said })
      if (task.state !== 'open') return yield* cant('settled')
      const all = yield* repositoriesHere(taskId)
      // A plain task with no branch yet has nothing the person could have seen to merge.
      if (all.length === 0) return yield* cant('changed')
      const repositories = all.filter((repository) => repository.opened === 0)
      if (repositories.length === 0) return yield* cant('pull_request')
      const several = all.length > 1
      const named = (repository: (typeof repositories)[number], what: string) => (several ? `${repository.name}: ${what}` : what)
      // The branch it merges into, in a few words: by its repository's name in a task of several.
      const into = (repository: (typeof repositories)[number]) => (several ? `${repository.name}’s ${repository.base}` : repository.base)
      // A submodule by its path in the repository, not where it is on this computer.
      const submoduleIn = (checkout: string, submodule: string) => relative(checkout, submodule).split(sep).join('/')
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
      // Nothing of the task's own is ahead of its default branch: its work is in already, so nothing is merged and nothing says it was.
      if (plans.every(({ plan }) => plan.kind === 'already'))
        return yield* cant('nothing', '', { into: [...new Set(repositories.map(into))].join(' and ') })
      // A checkout, or a submodule the merge moves, that can't be read stops the merge, with its path and git's own words, before anything else.
      for (const { repository, plan } of plans)
        if (plan.kind === 'unreadable') return yield* cant('unreadable', named(repository, `${plan.checkout}\n${plan.detail}`))
      const conflicting = plans.flatMap(({ repository, plan }) => (plan.kind === 'conflicts' ? [{ repository, files: plan.files }] : []))
      const conflicts = conflicting.map(({ repository, files }) => named(repository, files.join(', ')))
      if (conflicts.length > 0) {
        const said = {
          into: conflicting.length === 1 && conflicting[0] !== undefined ? into(conflicting[0].repository) : 'their default branches',
          files: conflicting.flatMap(({ files }) => files),
        }
        // Where the project says so, the lead resolves it unasked, and the person merges again after.
        const asked = yield* dependencies.askable(taskId, null)
        if (asked === 'resolving' || asked === 'checking') return yield* cant('resolving', conflicts.join('; '), said)
        if (asked === 'yes') {
          const found = yield* Effect.forEach(conflicting, ({ repository, files }) => conflictHere(repository, files))
          yield* dependencies.beginRound({ projectId: task.projectId, taskId, threadId: task.threadId }, null, found)
          return yield* cant('resolving', conflicts.join('; '), said)
        }
        return yield* cant('conflicts', conflicts.join('; '), said)
      }
      const missing = plans.find(({ plan }) => plan.kind === 'missing')
      if (missing !== undefined) return yield* cant('missing', missing.repository.base)
      for (const { repository, plan } of plans)
        if (plan.kind === 'busy')
          return yield* plan.untracked.length > 0
            ? cant('untracked', plan.checkout, { into: into(repository), files: plan.untracked })
            : cant('busy', plan.checkout, { into: into(repository), files: plan.files })
      for (const { repository, plan } of plans)
        if (plan.kind === 'submodule')
          return yield* cant('submodule', named(repository, plan.submodule), {
            into: into(repository),
            files: [submoduleIn(plan.checkout, plan.submodule)],
          })
      const refused = yield* applyMerges(
        plans.flatMap(({ repository, plan }) =>
          plan.kind === 'move' ? [{ root: repository.root, branch: repository.base, plan, repository }] : [],
        ),
      )
      if (refused?.problem?.kind === 'unreadable')
        return yield* cant('unreadable', named(refused.repository, `${refused.problem.checkout}\n${refused.problem.detail}`))
      if (refused?.problem?.kind === 'submodule')
        return yield* cant('submodule', named(refused.repository, refused.problem.submodule), {
          into: into(refused.repository),
          files: [submoduleIn(refused.problem.checkout, refused.problem.submodule)],
        })
      if (refused !== null)
        return yield* refused.plan.checkout === null || refused.problem?.kind === 'moved'
          ? cant('moved', several ? `${refused.repository.name}’s ${refused.branch}` : refused.branch)
          : cant('busy', refused.plan.checkout, {
              into: into(refused.repository),
              files: refused.problem?.kind === 'busy' ? refused.problem.files : [],
            })
      const moved = plans.filter(({ plan }) => plan.kind === 'move')
      for (const { settle } of moved) yield* settle
      // A merge commit git would have written as a test's identity was written as Althar's: said, with where it came from.
      const warnings = new Set(plans.flatMap(({ plan }) => (plan.kind === 'move' && plan.warning !== null ? [plan.warning] : [])))
      for (const warning of warnings)
        yield* addItem({ projectId: task.projectId, threadId: task.threadId }, 'notice', {
          source: 'runtime',
          severity: 'warning',
          title: warning,
          description: null,
        })
      const merged = moved.map(({ repository }) => ({
        repository: repository.name,
        branch: repository.base,
        already: false,
      }))
      yield* addItem({ projectId: task.projectId, threadId: task.threadId }, 'notice', {
        source: 'runtime',
        severity: 'info',
        title:
          merged.length > 1
            ? `Merged ${merged.length} repositories here.`
            : `Merged into ${merged[0]?.branch ?? 'its default branch'} here.`,
      })
      // Merged, its task is done, as a merged pull request's is, once any others it has are merged too.
      yield* dependencies.settleIfDone(taskId, { actorId: instance.personId, here: merged })
      return merged
    })

  /**
   * Why a push failed, in its words where git's output says (pushFailure.ts), with all it said kept
   * for Details. `host` names the code host the remote is on, where known.
   */
  const refusal = (taskId: string, remote: string, failed: GitFailed, host?: string): Effect.Effect<never, PushRefused> => {
    // One none of these names still says it in a sentence of its own, and keeps all git said, and how it ended, for Details.
    const known = pushFailureOf(failed) ?? { why: 'failed' as const }
    return Effect.fail(
      new PushRefused({
        taskId,
        why: known.why,
        remote,
        ...(known.said === undefined ? {} : { said: known.said }),
        ...(host === undefined ? {} : { host }),
        detail: pushDetailOf(failed),
      }),
    )
  }

  /* Where each worktree was, by its branch, when its remote last said where that branch is; and the tasks being asked now. */
  const remotesAsked = new Map<string, string>()

  const nextOpening = new Set<string>()

  const asking = new Set<string>()

  /**
   * Asks the remote of each of a task's branches with no pull request
   * where that branch is: through its host where Althar is connected,
   * else with the person's own git. The branch's ref for that remote here
   * then says what it said, fetched where the remote has commits this
   * computer doesn't, gone where it has no such branch; what isn't
   * pushed is counted from that, not from a ref that never saw a push
   * made elsewhere. What it says holds while the worktree stays where it
   * was asked at. Where none answers, nothing changes.
   */
  const askRemotes = (taskId: string) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const repositories = yield* sql<{
        base: string
        root: string
        worktree: string
        branch: string
        changeTarget: ChangeTarget | null
      }>`
            SELECT coalesce(w.toward, b.default_base_ref, w.base_ref) AS base, l.path AS root, w.path AS worktree, w.branch, b.change_target
            FROM workspaces w
            JOIN repository_bindings b ON b.id = w.binding_id
            JOIN repository_locations l ON l.binding_id = b.id AND l.device_id = ${instance.deviceId}
            WHERE w.task_id = ${taskId} AND w.device_id = ${instance.deviceId} AND w.access = 'write' AND w.branched_at IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM repository_changes c WHERE c.workspace_id = w.id AND c.pull_request_url IS NOT NULL)`
      const asked = yield* Effect.forEach(
        repositories,
        (repository) =>
          Effect.gen(function* () {
            const { root, branch } = repository
            const remote = yield* branchRemoteIn(root, repository.base, repository.changeTarget)
            const [head = null] = yield* commitsOf(repository.worktree, ['HEAD'])
            if (remote === null || head === null) return false
            const url = (yield* namedRemotes(root)).find((one) => one.name === remote)?.url
            const found = url === undefined ? null : yield* connections.hostOf([url]).pipe(Effect.orElseSucceed(() => null))
            const signed =
              found === null
                ? null
                : yield* Effect.flatMap(found.host.repository(found.path), (repo) => found.host.pushTarget(repo)).pipe(
                    Effect.orElseSucceed(() => null),
                  )
            const ref = `refs/remotes/${remote}/${branch}`
            for (const source of [...(signed === null ? [] : [signed]), { url: remote, header: null }]) {
              const tip = yield* branchOn(root, source, branch)
              if (tip === undefined) continue
              if (tip === null) yield* git(root, 'update-ref', '-d', ref)
              else if ((yield* commitsOf(root, [tip]))[0] == null) {
                if ((yield* fetchInto(root, source, branch, ref)) === null) continue
              } else yield* git(root, 'update-ref', ref, tip)
              remotesAsked.set(`${repository.worktree} ${branch}`, head)
              return true
            }
            return false
          }).pipe(Effect.orElseSucceed(() => false)),
        { concurrency: 'unbounded' },
      )
      if (asked.includes(true)) yield* touchTask(taskId)
    }).pipe(Effect.ignore, Effect.ensuring(Effect.sync(() => asking.delete(taskId))))

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
        remotes: string
        changeTarget: ChangeTarget | null
      }>`
            SELECT b.slug, coalesce(w.toward, b.default_base_ref, w.base_ref) AS base, l.path AS root, w.path AS worktree, w.branch, w.base_commit,
              b.remote_fingerprints AS remotes, b.change_target
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
        const remote = yield* branchRemoteIn(repository.root, repository.base, repository.changeTarget)
        if (remote === null) continue
        // Credited as every push is (credit.ts): what the remote has already stays as it is.
        const [there = null] = yield* commitsOf(repository.root, [`refs/remotes/${remote}/${repository.branch}`])
        const { head: sent, settle } = yield* credited(repository.worktree, repository.branch, head, [repository.baseCommit, there])
        // What the person saw, or what crediting made of it, still on the branch: a commit the lead made since isn't theirs to have seen.
        if (!(yield* onHead(repository.worktree, head)) && !(yield* onHead(repository.worktree, sent)))
          return yield* new CantMerge({ taskId, why: 'changed', detail: '' })
        yield* guardPush({
          projectId: task.projectId,
          taskId,
          remote: `${remote}/${repository.branch}`,
          cwd: repository.worktree,
          base: repository.baseCommit,
          ref: repository.base,
          head: sent,
        })
        yield* gitWithin(60_000, repository.worktree, 'push', '--', remote, `${sent}:refs/heads/${repository.branch}`).pipe(
          Effect.catchTag('GitFailed', (failed) =>
            Effect.flatMap(hostOfRemotes(dependencies.remotesOf(repository)), (host) =>
              refusal(taskId, `${remote}/${repository.branch}`, failed, host?.name),
            ),
          ),
        )
        yield* settle
        // What the remote has now, as a fetch would say: git notes it itself only where the remote's fetch takes every branch.
        // That is as good as asking it, at where the worktree is now.
        yield* gitWithin(10_000, repository.root, 'update-ref', `refs/remotes/${remote}/${repository.branch}`, sent).pipe(Effect.ignore)
        const [now = null] = yield* commitsOf(repository.worktree, ['HEAD'])
        if (now !== null) remotesAsked.set(`${repository.worktree} ${repository.branch}`, now)
        pushed.push({ branch: repository.branch, remote })
      }
      if (pushed.length === 0) return yield* new NotFound({ kind: 'remote', id: taskId })
      yield* addItem({ projectId: task.projectId, threadId: task.threadId }, 'notice', {
        source: 'runtime',
        severity: 'info',
        title: pushedWords(pushed.map((one) => one.branch)),
      })
      return pushed
    })

  const pushHere = (taskId: string) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const [task] = yield* sql<{ projectId: ProjectId; threadId: string }>`
            SELECT k.project_id, t.id AS thread_id FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task' WHERE k.id = ${taskId}`
      if (task === undefined) return yield* new NotFound({ kind: 'task', id: taskId })
      const repositories = yield* sql<{ base: string; root: string; worktree: string; baseCommit: string | null; remotes: string }>`
            SELECT coalesce(w.toward, b.default_base_ref, w.base_ref) AS base, l.path AS root, w.path AS worktree, w.base_commit,
              b.remote_fingerprints AS remotes
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
        const followed = yield* gitOutcome(repository.root, 'for-each-ref', '--format=%(upstream:short)', `refs/heads/${repository.base}`)
        if (followed.code !== 0 || followed.stdout === '') continue
        const remote = followed.stdout
        const at = remote.indexOf('/')
        // What is sent is the branch's tip, which may be ahead of the task's head: guard that, not the head.
        // One it can't read is not pushed at all: the task's head in its place would send what the branch never held.
        const [tip] = yield* commitsOf(repository.root, [`refs/heads/${repository.base}`])
        if (tip === undefined || tip === null)
          return yield* Effect.die(new Error(`${repository.base} could not be read once the task merged into it`))
        yield* guardPush({
          projectId: task.projectId,
          taskId,
          remote,
          cwd: repository.worktree,
          base: repository.baseCommit,
          ref: repository.base,
          head: tip,
        })
        // As the person would push it: their remote, their branch there, their sign-in. A prompt for a password fails rather than waits.
        yield* gitWithin(60_000, repository.root, 'push', '--', remote.slice(0, at), `${tip}:refs/heads/${remote.slice(at + 1)}`).pipe(
          Effect.catchTag('GitFailed', (failed) =>
            Effect.flatMap(hostOfRemotes(dependencies.remotesOf(repository)), (host) => refusal(taskId, remote, failed, host?.name)),
          ),
        )
        pushed.push({ branch: repository.base, remote })
      }
      if (pushed.length > 0)
        yield* addItem({ projectId: task.projectId, threadId: task.threadId }, 'notice', {
          source: 'runtime',
          severity: 'info',
          title: pushedWords(pushed.map((one) => one.branch)),
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
  /** The tag a lead names, in its task's repository: the commit it is on here (null where it made none), and the remote it goes to. */
  const tagHere = (taskId: string, input: unknown, whereNone: 'refuse' | 'host' = 'refuse') =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const asked = yield* Schema.decodeUnknownEffect(TagAsked)(input).pipe(
        Effect.mapError((error) => new ToolRefused({ message: `Althar couldn't read that: ${error.message}` })),
      )
      const tag = asked.tag.trim().replace(/^refs\/tags\//, '')
      const repositories = yield* sql<{ slug: string; base: string; root: string; worktree: string }>`
            SELECT b.slug, coalesce(w.toward, b.default_base_ref, w.base_ref) AS base, l.path AS root, w.path AS worktree
            FROM workspaces w
            JOIN repository_bindings b ON b.id = w.binding_id
            JOIN repository_locations l ON l.binding_id = b.id AND l.device_id = ${instance.deviceId}
            WHERE w.task_id = ${taskId} AND w.device_id = ${instance.deviceId} AND w.access = 'write'
            ORDER BY b.created_at, b.rowid`
      const named = asked.repository == null ? null : String(asked.repository).trim()
      const candidates = named === null ? repositories : repositories.filter((one) => one.slug === named)
      const [repository] = candidates
      // Nothing of the task's here to tag from, none at all or none by that name: on the person's word, Althar tags on the host.
      if (whereNone === 'host' && candidates.length === 0) return null
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
      // The tag read once, as made: an annotated tag's own object, which is what goes up, and the commit it is on, peeled
      // from that same object, so a tag moved meanwhile can't go up under what was read.
      const object = (yield* gitOutcome(repository.worktree, 'rev-parse', '--verify', '--quiet', `refs/tags/${tag}`)).stdout.trim() || null
      const [commit = null] = object === null ? [null] : yield* commitsOf(repository.worktree, [object])
      return { tag, repository, commit, object }
    })

  /** What a push of the lead's tag the remote turned down says, for the lead: why it wasn't pushed. */
  const tagRefused = (taskId: string, remote: string, tag: string, failed: GitFailed) =>
    /! \[rejected\].*\(already exists\)/i.test(failed.stderr)
      ? Effect.succeed(`${remote} has a tag ${tag} already, on another commit, so ${tag} wasn't pushed. Althar doesn't move it.`)
      : refusal(taskId, remote, failed).pipe(
          Effect.catchTag('PushRefused', (refused) =>
            Effect.succeed(
              refused.why === 'denied'
                ? `${remote} didn't take the person's sign-in, so ${tag} wasn't pushed. Tell the person.`
                : refused.why === 'refused'
                  ? `${remote} refused ${tag}${refused.said === undefined || refused.said === '' ? '' : `: ${refused.said}`}. Tell the person.`
                  : refused.why === 'failed'
                    ? `Pushing ${tag} failed: ${redacted(failed.stderr.trim().split('\n').at(-1) ?? '')}`
                    : `${tag} wasn't pushed. ${words(refused, String).message} Tell the person.`,
            ),
          ),
        )

  /**
   * The lead's own tag, pushed on the person's word in its thread (ADR-081, a lead's tag): their message in this turn, which
   * Errands checks, so nothing is asked on a card. It reads where the remote pushes first: a tag there on this commit is
   * done, one on another is refused, never moved; and pushes the very tag object it read. Null where the lead made no tag
   * of that name here, or the task has no repository here by that name: Althar makes it on the host then.
   */
  const pushTagOnWord = (taskId: string, input: unknown) =>
    Effect.gen(function* () {
      const here = yield* tagHere(taskId, input, 'host')
      if (here === null || here.commit === null || here.object === null) return null
      const { tag, repository, commit, object } = here
      const remote = yield* remoteOf(repository.root, repository.base)
      if (remote === null) return yield* new ToolRefused({ message: `${repository.slug} has no remote to push ${tag} to.` })
      const message = (input as { readonly message?: unknown }).message
      const unread = (failed: GitFailed) =>
        new ToolRefused({
          message: `Althar couldn't read ${remote}'s tags, so ${tag} wasn't pushed: ${redacted(failed.stderr.trim().split('\n').at(-1) ?? '')}`,
        })
      const read = Effect.gen(function* () {
        // Where a push goes, which a remote's pushurl may make another place than where it fetches from: each of them.
        const urls = (yield* gitWithin(60_000, repository.root, 'remote', 'get-url', '--push', '--all', remote).pipe(
          Effect.mapError(unread),
        ))
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line !== '')
        const ons: Array<string | undefined> = []
        for (const url of urls) {
          const said = yield* gitWithin(
            60_000,
            repository.root,
            'ls-remote',
            '--tags',
            url,
            `refs/tags/${tag}`,
            `refs/tags/${tag}^{}`,
          ).pipe(Effect.mapError(unread))
          // An annotated tag is named twice: the tag, and the commit it is on (`^{}`), which is what is compared.
          const there = new Map(
            said
              .split('\n')
              .filter((line) => line.includes('\t'))
              .map((line) => [line.slice(line.indexOf('\t') + 1), line.slice(0, line.indexOf('\t'))] as const),
          )
          ons.push(there.get(`refs/tags/${tag}^{}`) ?? there.get(`refs/tags/${tag}`))
        }
        const elsewhere = ons.find((on) => on !== undefined && on !== commit)
        if (elsewhere !== undefined)
          return yield* new ToolRefused({
            message: `${remote} has a tag ${tag} already, on ${elsewhere.slice(0, 8)}, not ${commit.slice(0, 8)}, so ${tag} wasn't pushed. Althar doesn't move it.`,
          })
        if (ons.length > 0 && ons.every((on) => on === commit))
          return { state: 'done', head: commit, answer: `${remote} has ${tag} on ${commit.slice(0, 8)} already.` } satisfies FreshAction
        return { state: 'absent', head: commit } satisfies FreshAction
      })
      const action: AskedAction = {
        ...(typeof message === 'string' ? { messageId: message } : {}),
        target: `${repository.slug} tag ${tag}`,
        request: { tag, commit },
        recurs: true,
        read: provide(read),
        act: () =>
          provide(
            // The very object read when asked, never the name again: one moved since doesn't go up in its place.
            gitWithin(60_000, repository.root, 'push', '--', remote, `${object}:refs/tags/${tag}`).pipe(
              Effect.as(`Pushed ${tag}, on ${commit.slice(0, 8)}, to ${remote}.`),
              Effect.catchTag('GitFailed', (failed) =>
                Effect.flatMap(tagRefused(taskId, remote, tag, failed), (why) => Effect.fail(new ActionNotPerformed({ message: why }))),
              ),
            ),
          ),
      }
      return action
    })

  const pushTag = (taskId: string, input: unknown, access: ToolAccess) =>
    Effect.gen(function* () {
      const here = yield* tagHere(taskId, input)
      if (here === null) return yield* new ToolRefused({ message: 'This task has no repository of its own to push a tag from.' })
      const { tag, repository, commit } = here
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
        Effect.catchTag('GitFailed', (failed) => tagRefused(taskId, remote, tag, failed)),
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

  /**
   * The title the project's naming gives the task's pull request for
   * these words, as it gave it when it opened: by the project's rule, else
   * the worktree's docs, with the issue's key where its host wouldn't link
   * it; and `After #12:` for one after the task's last in that repository
   * merged or closed (ADR-034).
   */
  const titleOn = (link: LinkRow, snapshot: Snapshot, words: string) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const where = yield* worktreeOf(link.taskId, snapshot.url)
      const conventions = where === undefined ? null : yield* conventionsAt(where.path, 'HEAD')
      const rule = ruleOf('title', (yield* (yield* Policies).current(link.projectId)).rules.titlePattern)
      const [issue] = yield* sql<{ product: Product; key: string; ref: string }>`
            SELECT product, key, ref FROM external_links WHERE task_id = ${link.taskId} AND kind = 'issue' ORDER BY created_at, rowid LIMIT 1`
      const sameHost =
        issue !== undefined &&
        issue.product === link.product &&
        issue.ref.toLowerCase().startsWith(`${snapshot.repository.join('/').toLowerCase()}#`)
      const all = yield* dependencies.urlsOf(link.taskId)
      const at = all.findIndex((one) => one.url === snapshot.url)
      const after = all
        .slice(0, Math.max(at, 0))
        .filter((one) => one.state !== 'open' && samePath(one.repository, snapshot.repository))
        .at(-1)
      return titleFor(rule ?? conventions?.title?.pattern ?? null, {
        title: after === undefined ? words : `After ${after.words.prefix}${after.number}: ${words}`,
        issue: issue === undefined ? null : { key: issue.key, sameHost },
      })
    })

  /** The key of the (first) issue the task came from, which the naming puts in a title: null where it came from none. */
  const issueKeyOf = (taskId: string) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const [issue] = yield* sql<{
        key: string
      }>`SELECT key FROM external_links WHERE task_id = ${taskId} AND kind = 'issue' ORDER BY created_at, rowid LIMIT 1`
      return issue?.key ?? null
    })

  /**
   * The description Althar last set on a pull request, as its host gave it
   * back, by the receipts of its opening and of its edits that set one: an
   * edit of the title alone echoes whatever the description was, someone
   * else's words too, so it never counts. Null where it set none, as on
   * one a task was attached to.
   */
  const lastSetBody = (link: LinkRow, url: string) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const [row] = yield* sql<{ body: string | null }>`
            SELECT json_extract(m.response, '$.body') AS body FROM mutation_receipts m JOIN work_items w ON w.id = m.work_item_id
            WHERE m.state = 'confirmed' AND m.response IS NOT NULL AND (
              (m.operation = 'edit_change' AND w.subject_type = 'external_link' AND w.subject_id = ${link.id}
                AND json_extract(m.request, '$.body') IS NOT NULL)
              OR (m.operation = 'open_change' AND w.subject_type = 'task' AND w.subject_id = ${link.taskId}
                AND lower(json_extract(m.response, '$.url')) = ${url.toLowerCase()}))
            ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1`
      return row?.body ?? null
    })

  /**
   * Sets a pull request's title or description on its host, kept with a
   * receipt, which says what Althar last set; its snapshot takes the
   * title as the host gave it back. A refusal is the host's, in its words.
   */
  const editOnHost = (
    link: LinkRow,
    on: { readonly snapshot: Snapshot; readonly host: CodeHost; readonly repository: Repository; readonly now: ChangeRequest },
    edit: { readonly title?: string; readonly body?: string },
  ) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const digest = createHash('sha256')
        .update(`${edit.title ?? ''}\0${edit.body ?? ''}\0${yield* Clock.currentTimeMillis}`)
        .digest('hex')
        .slice(0, 32)
      const edited = yield* outward({
        projectId: link.projectId,
        subject: { type: 'external_link', id: link.id },
        target: `${on.host.product}:${on.snapshot.repository.join('/')}`,
        operation: 'edit_change',
        key: `edit_change:${link.id}:${digest}`,
        request: { number: on.snapshot.number, ...edit },
        retryable: false,
        perform: on.host.editChange(on.repository, on.now, edit),
        encode: (answer) => answer,
        decode: (kept) => Option.getOrUndefined(Schema.decodeUnknownOption(ChangeRequest)(kept)),
      })
      const [row] = yield* sql<{ snapshot: string }>`SELECT snapshot FROM external_links WHERE id = ${link.id}`
      const seen = row === undefined ? Option.none() : yield* Effect.option(decodeSnapshot(row.snapshot))
      if (Option.isSome(seen) && seen.value.title !== edited.title)
        yield* change('external_links', link.id, {
          snapshot: JSON.stringify({ ...seen.value, title: edited.title }),
          updatedAt: yield* timestamp,
        })
      yield* news(link.taskId)
      yield* touchCard(link.taskId)
      return edited
    })

  /**
   * Whether an edit's answer was lost on the way, so the host may have
   * made it: its receipt stays uncertain, and nobody may say it didn't.
   */
  const editUnsure = (error: unknown) =>
    error instanceof OutwardUncertain ||
    (error instanceof ConnectorFailed && (error.reason === 'unreachable' || error.reason === 'invalid_response'))

  /** A host's refusal, in its words, for whoever asked the edit; or, where its answer was lost, that nobody knows yet. */
  const editRefused = (host: CodeHost, name: string, url: string, error: ConnectorFailed | OutwardUncertain) =>
    new ToolRefused({
      message: editUnsure(error)
        ? `Althar couldn't tell whether ${hostName(host)} changed ${name}${error instanceof ConnectorFailed ? `: ${error.message}` : ''}. The task's title stays as it was. Read it with read_pull_request before saying it changed or didn't; edit_pull_request sets it again if it should.`
        : `${hostName(host)} wouldn't change ${name}: ${(error as ConnectorFailed).message}. Its title and description stay as they were, and so does the task's title. Tell the person what you would set; they can set it on ${url}.`,
    })

  const edit = (taskId: string, asked: { readonly title?: string; readonly body?: string; readonly url?: string }, by: ActorId) =>
    Effect.gen(function* () {
      if (asked.title === undefined && asked.body === undefined)
        return yield* new ToolRefused({ message: 'Give a title, a description, or both.' })
      const { link, snapshot, host, repository } = yield* current(taskId, asked.url)
      const name = nameOf(snapshot)
      const now = yield* host.change(repository, snapshot.number)
      if (now.state !== 'open')
        return yield* new ToolRefused({ message: `${name} is ${now.state}, so its title and description stay as they are.` })
      const words = asked.title === undefined ? undefined : titleWords(asked.title, agentNames, yield* issueKeyOf(taskId))
      if (words === '') return yield* new ToolRefused({ message: 'Give it a title: what the change does, in a few words.' })
      if (words !== undefined && words.length > TITLE_LENGTH)
        return yield* new ToolRefused({
          message: `That title is ${words.length} characters, and the task's card takes it too. Keep it to ${TITLE_LENGTH}: what the change does, in a few words.`,
        })
      const title = words === undefined ? undefined : yield* titleOn(link, snapshot, words)
      let body: string | undefined
      if (asked.body !== undefined) {
        const where = yield* worktreeOf(taskId, snapshot.url)
        const template = where === undefined ? null : ((yield* conventionsAt(where.path, 'HEAD')).template?.text ?? null)
        const described = describedAs(withoutAgentCredit(asked.body, agentNames), template)
        if (described === '') return yield* new ToolRefused({ message: 'Say what the description should say.' })
        body = withDescribed(now.body, described)
      }
      const set = {
        ...(title === undefined || title === now.title ? {} : { title }),
        ...(body === undefined || sameDescription(body, now.body) ? {} : { body }),
      }
      if (set.title !== undefined || set.body !== undefined)
        yield* editOnHost(link, { snapshot, host, repository, now }, set).pipe(
          Effect.catchIf(
            (error) => error instanceof ConnectorFailed || error instanceof OutwardUncertain,
            (error) => Effect.fail(editRefused(host, name, now.url, error as ConnectorFailed | OutwardUncertain)),
          ),
        )
      // The task is called what its pull request is, in the words given: its card follows once the host took them.
      const renamed =
        words === undefined
          ? false
          : yield* retitleTask({
              envelope: yield* envelope('task.rename', { taskId, title: words }, undefined, by),
              taskId,
              title: words,
            })
      const said = [
        ...(title === undefined
          ? []
          : [
              set.title === undefined ? `${name} is called “${title}” already.` : `${name} is called “${title}” now.`,
              renamed ? `The task's card says “${words}”.` : '',
            ]),
        ...(body === undefined
          ? []
          : [set.body === undefined ? `${name}'s description says that already.` : `${name} has the new description.`]),
      ]
      return said.filter((line) => line !== '').join(' ')
    })

  /** What following the task's title did on each open pull request Althar opened for it, and what a host refused. */
  const followTitleOf = (taskId: string) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const [task] = yield* sql<{ title: string }>`SELECT title FROM tasks WHERE id = ${taskId}`
      const said: Array<string> = []
      const refused: Array<string> = []
      if (task === undefined) return { said, refused }
      for (const link of yield* linksOf(taskId)) {
        const seen = Option.getOrUndefined(yield* Effect.option(decodeSnapshot(link.snapshot)))
        // One a task follows that someone else opened keeps the title its author gave it: only an edit asked for changes it.
        if (seen === undefined || seen.state !== 'open' || seen.attached === true || link.connectionId === null) continue
        yield* Effect.gen(function* () {
          const { snapshot, host, repository } = yield* current(taskId, seen.url)
          const now = yield* host.change(repository, snapshot.number)
          if (now.state !== 'open') return
          const title = yield* titleOn(link, snapshot, task.title)
          if (title === now.title) return
          yield* editOnHost(link, { snapshot, host, repository, now }, { title })
          said.push(`${nameOf(snapshot)} is called “${title}” now.`)
        }).pipe(
          Effect.catch((error) =>
            Effect.sync(() => {
              refused.push(
                editUnsure(error)
                  ? `Althar couldn’t tell whether ${nameOf(seen)} took the task’s title: its host’s answer was lost. Look at it before saying either way.`
                  : `${nameOf(seen)} kept its title: ${refusalOf(error) ?? 'Althar couldn’t reach it.'}`,
              )
            }),
          ),
          contained('Changes.followTitle', () => {
            refused.push(`${nameOf(seen)} kept its title: Althar couldn’t reach it.`)
          }),
        )
      }
      return { said, refused }
    })

  const followTitle = (taskId: string) =>
    Effect.map(followTitleOf(taskId), ({ said, refused }) => [...said, ...refused]).pipe(
      Effect.catchCause((cause) => Effect.as(Effect.logWarning('A task’s pull request did not follow its title', cause), [])),
    )

  /** As `followTitle`, in the background; what a host refused goes in the task's thread, where the person renamed it. */
  const followTitleLater = (taskId: string) =>
    Effect.asVoid(
      Effect.forkIn(
        provide(
          Effect.gen(function* () {
            const { refused } = yield* followTitleOf(taskId)
            if (refused.length === 0) return
            const sql = yield* SqlClient.SqlClient
            const [thread] = yield* sql<{ id: string; projectId: ProjectId }>`
                  SELECT id, project_id FROM threads WHERE task_id = ${taskId} AND kind = 'task' LIMIT 1`
            if (thread === undefined) return
            for (const line of refused)
              yield* addItem({ projectId: thread.projectId, threadId: thread.id }, 'notice', {
                source: 'runtime',
                severity: 'warning',
                title: line,
              })
          }).pipe(Effect.catchCause((cause) => Effect.logWarning('A task’s pull request did not follow its title', cause))),
        ),
        scope,
      ),
    )

  /**
   * Sets the descriptions a lead just gave on the task's open pull
   * requests, by repository slug: its part of each, as it would open with
   * them, and what Althar put around it as it is. One changed on its host
   * since Althar last set it, or one Althar never described, is left.
   */
  const redescribe = (taskId: string, given: Readonly<Record<string, string>>, built: string | null) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const lines: Array<string> = []
      for (const link of yield* linksOf(taskId)) {
        const seen = Option.getOrUndefined(yield* Effect.option(decodeSnapshot(link.snapshot)))
        if (seen === undefined || seen.state !== 'open' || link.connectionId === null) continue
        const [where] = yield* sql<{ slug: string; path: string }>`
              SELECT b.slug, w.path FROM repository_changes c JOIN workspaces w ON w.id = c.workspace_id
              JOIN repository_bindings b ON b.id = w.binding_id
              WHERE c.pull_request_url = ${seen.url} AND w.task_id = ${taskId} AND w.device_id = ${instance.deviceId} LIMIT 1`
        const text = where === undefined ? undefined : given[where.slug]
        if (where === undefined || text === undefined) continue
        const name = nameOf(seen)
        const line = yield* Effect.gen(function* () {
          const { snapshot, host, repository } = yield* current(taskId, seen.url)
          const now = yield* host.change(repository, snapshot.number)
          if (now.state !== 'open') return null
          const last = yield* lastSetBody(link, now.url)
          if (last === null)
            return `${name} wasn't described by Althar, so its description stays as it is: edit_pull_request sets yours on it, if it should.`
          if (!sameDescription(last, now.body))
            return `${name}'s description was changed on ${hostName(host)} since Althar set it, so it stays as it is: edit_pull_request sets yours over it, if it should.`
          const { template } = yield* conventionsAt(where.path, 'HEAD')
          const described = describedOf({
            built: built === null ? null : withoutAgentCredit(built, agentNames),
            lead: null,
            template: template?.text ?? null,
            written: withoutAgentCredit(text, agentNames),
          })
          const body = withDescribed(now.body, described)
          if (described === '' || sameDescription(body, now.body)) return null
          yield* editOnHost(link, { snapshot, host, repository, now }, { body })
          return `${name} has your new description.`
        }).pipe(
          Effect.catch((error) =>
            Effect.succeed(
              editUnsure(error)
                ? `Althar couldn't tell whether ${name} took your new description: its host's answer was lost. Read it with read_pull_request before saying either way.`
                : `${name} kept its description: ${refusalOf(error) ?? 'Althar couldn’t reach it.'}`,
            ),
          ),
          contained('Changes.redescribe', () => `${name} kept its description: Althar couldn’t reach it.`),
        )
        if (line !== null) lines.push(line)
      }
      return lines
    }).pipe(Effect.catchCause((cause) => Effect.as(Effect.logWarning('A lead’s description did not reach its pull request', cause), [])))

  return {
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
  }
}
