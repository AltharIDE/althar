import { existsSync } from 'node:fs'
import type { Account, CodeHost, ConnectorFailed, Product, PushTarget, Repository } from '@althar/connectors'
import { type ActorId, type CommandEnvelope, Ids, type ProjectId, newId } from '@althar/domain'
import { type Ledger, type RevisionConflict, type RowNotFound, bumpRevision } from '@althar/persistence-sqlite'
import { Cause, Clock, type Crypto, Deferred, type Duration, Effect, Option, Schema, type Scope } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'
import { onlyBase, ownCommits } from './baseOnly'
import { leftByAlthar } from './branchUpdates'
import { touchCard, touchTask } from './cards'
import {
  type AttachInput,
  type Attached,
  type ChangeSummary,
  type Held,
  type Host,
  type LinkRow,
  type Snapshot,
  type Store,
  type Unshipped,
  countOf,
  gitSaidOf,
  sourceOf,
} from './changeRecords'
import type { Connections } from './Connections'
import { ChangedSinceSeen, type GitFailed, NotFound, PushRefused, ShipRefused } from './errors'
import { evidencePaths } from './evidence'
import { forkOf, workRemotes } from './forks'
import { commitOf, commitsAhead, commitsOf, countBetween, git, gitOutcome, isUnder, namedRemotes, remoteTip, uncommittedFiles } from './git'
import type { InstanceInfo } from './Instance'
import { quickIn } from './kinds'
import type { LeftBehind } from './LeftBehind'
import type { LiveEvent } from './Live'
import { betweenAgents } from './needsYou'
import { Policies, pushesCommits } from './Policies'
import { latestOf } from './pullRequestStanding'
import { commitsWord, nameOf } from './pullRequestWords'
import { change, fact, timestamp } from './records'
import type { Sessions } from './Sessions'
import { noteUnsure, nowFor, there, unnoted } from './standsOn'
import { addItem } from './threads'
import { ToolRefused } from './toolErrors'
import { words } from './words'

export interface ChangeShippingDependencies {
  readonly acceptedHead: (taskId: string, path: string, pinned: string) => Effect.Effect<string, ChangedSinceSeen, never>
  readonly aheadOf: (
    path: string,
    tip: string | null,
    known: ReadonlyArray<string | null>,
  ) => Effect.Effect<
    | { readonly kind: 'behind'; readonly head: string; readonly from?: never; readonly count?: never; readonly commits?: never }
    | { readonly kind: 'unknown'; readonly head: string; readonly from?: never; readonly count?: never; readonly commits?: never }
    | { readonly kind: 'rewritten'; readonly from: string; readonly head: string; readonly count?: never; readonly commits?: never }
    | {
        readonly kind: 'ahead'
        readonly from: string
        readonly head: string
        readonly count: number
        readonly commits: { sha: string; subject: string }[]
      },
    GitFailed,
    SqlClient.SqlClient
  >
  readonly asCredited: (commit: string) => Effect.Effect<string[]>
  readonly attach: (input: AttachInput) => Effect.Effect<Attached, unknown, Store>
  readonly bottomUp: (taskId: string, links: ReadonlyArray<LinkRow>) => Effect.Effect<LinkRow[], SqlError.SqlError, SqlClient.SqlClient>
  readonly busyUpTo: Duration.Duration
  readonly connections: Connections['Service']
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
  readonly goingFor: number
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
  readonly hostOfRemotes: (remotes: ReadonlyArray<string>) => Effect.Effect<Host | null, never, Store>
  readonly instance: InstanceInfo
  readonly keptOpenOf: (taskId: string) => Effect.Effect<boolean, SqlError.SqlError, SqlClient.SqlClient>
  readonly leftBehind: LeftBehind['Service']
  readonly linksOf: (taskId: string) => Effect.Effect<readonly LinkRow[], SqlError.SqlError, SqlClient.SqlClient>
  readonly locked: (taskId: string) => <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  readonly provide: <A, E>(effect: Effect.Effect<A, E, Store>) => Effect.Effect<A, E, never>
  readonly publishing: (taskId: string) => Effect.Effect<boolean, SqlError.SqlError, SqlClient.SqlClient>
  readonly push: (
    taskId: string,
    seen: string,
    url?: string,
    by?: 'person' | 'althar' | 'ship',
  ) => Effect.Effect<{ change: ChangeSummary }, unknown, Store>
  readonly pushTargetOf: (
    taskId: string,
    host: CodeHost,
    repository: Repository,
    path: string,
    pull: { readonly number: number; readonly source: string; readonly head?: ReadonlyArray<string> | null | undefined },
  ) => Effect.Effect<PushTarget, ConnectorFailed | PushRefused, never>
  readonly reportsWithin: Duration.Duration
  readonly roundUnderWay: (taskId: string, url?: string) => Effect.Effect<boolean, SqlError.SqlError, SqlClient.SqlClient>
  readonly sayOn: (
    link: LinkRow,
    title: string,
    description?: string,
  ) => Effect.Effect<void, SqlError.SqlError | Schema.SchemaError, SqlClient.SqlClient | Ledger | Crypto.Crypto>
  readonly scope: Scope.Scope
  readonly sentTo: (projectId: string, url: string) => Effect.Effect<string | null, SqlError.SqlError, SqlClient.SqlClient>
  readonly sessions: Sessions['Service']
  readonly worktreeOf: (
    taskId: string,
    url: string,
  ) => Effect.Effect<
    | { id: string; path: string; branch: string; base: string; baseCommit: string | null; threadId: string; heldAt: string | null }
    | undefined,
    unknown,
    Store
  >
}

export const makeChangeShipping = (dependencies: ChangeShippingDependencies) => {
  const {
    acceptedHead,
    aheadOf,
    asCredited,
    attach,
    bottomUp,
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
    roundUnderWay,
    sayOn,
    scope,
    sentTo,
    sessions,
    worktreeOf,
  } = dependencies

  /** Where Althar keeps, by worktree, the commit the person left out what came before (ADR-034): only what comes after counts. */
  const LEFT_OUT = 'refs/althar/left-out/'

  /** The default branch's refs a worktree is read against (`notOnDefault`): as Althar fetched it, as the worktree started, and its own. */
  const defaultsOf = (repository: { readonly baseRef: string | null; readonly defaultBase: string | null }) => {
    const target = (repository.baseRef ?? '').replace(/^origin\//, '') || repository.defaultBase
    return [
      target === null || target === '' ? null : `refs/althar/base/${target}`,
      repository.baseRef,
      repository.defaultBase === null ? null : `refs/heads/${repository.defaultBase}`,
    ].filter((ref): ref is string => ref !== null && ref !== '')
  }

  /**
   * A worktree's base branch's refs (`defaultsOf`), by its workspace, and each remote's branch of its name, as a lead
   * fetches and merges `origin/main`: what a merge of its base brings in is read against them.
   */
  const baseRefsOf = (workspaceId: string) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const [row] = yield* sql<{ path: string; baseRef: string | null; defaultBase: string | null }>`
            SELECT w.path, w.base_ref, coalesce(w.toward, b.default_base_ref) AS default_base
            FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id WHERE w.id = ${workspaceId}`
      if (row === undefined) return []
      const refs = defaultsOf(row)
      const target = (row.baseRef ?? '').replace(/^origin\//, '') || row.defaultBase
      if (target === null || target === '') return refs
      const remotes = yield* gitOutcome(row.path, 'for-each-ref', '--format=%(refname)', 'refs/remotes/')
      const named = remotes.stdout.split('\n').filter((ref) => ref.split('/').slice(3).join('/') === target && !refs.includes(ref))
      return [...refs, ...named]
    })

  /**
   * Of commits on a worktree's branch after `head`, those its default
   * branch doesn't have: neither the commits themselves, as a merge of the
   * default branch into the task's brings them, nor their change, as one
   * cherry-picked into another pull request that merged has it under
   * another hash (by patch, as `git cherry` tells). The default branch as
   * this Mac has it: as Althar last fetched it for a next pull request, as
   * the worktree started from it, and its own branch, each read on its
   * own, since any may be behind the rest. All of them, where git can't
   * say, and `sure` false.
   */
  const notOnDefault = (
    repository: { readonly path: string; readonly baseRef: string | null; readonly defaultBase: string | null },
    head: string,
    commits: ReadonlyArray<string>,
  ) =>
    Effect.gen(function* () {
      let sure = true
      const tips: Array<string> = []
      for (const ref of defaultsOf(repository)) {
        // One git doesn't have says so by 1; more is git failing.
        const found = yield* gitOutcome(repository.path, 'rev-parse', '--verify', '-q', `${ref}^{commit}`)
        if (found.code > 1) sure = false
        const tip = found.stdout
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
        if (listed.code !== 0) {
          sure = false
          continue
        }
        const lacks = new Set(listed.stdout.split('\n').filter((line) => line !== ''))
        kept = new Set([...kept].filter((commit) => lacks.has(commit)))
      }
      return { commits: commits.filter((commit) => kept.has(commit)), sure }
    })

  /** A worktree of a task, as `unshippedOf` reads it from the store. */
  type ShippingRow = {
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
  }

  const remotesOf = (repository: { readonly remotes: string }) =>
    Option.getOrElse(Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(Schema.String)))(repository.remotes), () => [])

  /**
   * One repository's commits after its last pull request (`unshippedOf`);
   * none where it has none. `answered.sure` turns false where git failed
   * a read it needed, as it does timed out or out of processes: what it
   * gives then may say less than there is, so it isn't kept (`keptIn`).
   */
  const unshippedIn = (repository: ShippingRow, answered: { sure: boolean } = { sure: true }) =>
    Effect.gen(function* () {
      // A command whose exit says no by 1 (a ref or commit git doesn't have, a commit not behind another, a diff), and fails by more.
      const outcome = (...args: ReadonlyArray<string>) =>
        Effect.map(gitOutcome(repository.path, ...args), (outcome) => {
          if (outcome.code > 1) answered.sure = false
          return outcome
        })
      const read = (...args: ReadonlyArray<string>) =>
        git(repository.path, ...args).pipe(
          Effect.orElseSucceed(() => {
            answered.sure = false
            return ''
          }),
        )
      // Whether a commit is here and on the worktree's head; one git doesn't have isn't, `merge-base` failing on it.
      const onHeadHere = (commit: string) =>
        Effect.gen(function* () {
          const found = yield* outcome('rev-parse', '--verify', '-q', `${commit}^{commit}`)
          return found.code === 0 && (yield* outcome('merge-base', '--is-ancestor', found.stdout, 'HEAD')).code === 0
        })
      const seen =
        repository.snapshot === null ? undefined : Option.getOrUndefined(yield* Effect.option(decodeSnapshot(repository.snapshot)))
      // Open, it takes the branch's pushes: unless the change moved to a branch of its own since, pointed at another to work
      // toward, and Althar follows it no more (a task is a conversation plus parts), whose work goes in a new one.
      const leftOpen = seen?.state === 'open' && repository.listening === 0 && repository.branch !== repository.changeBranch
      if (seen?.state === 'open' && !leftOpen) return undefined
      let head: string | undefined
      let moved = false
      if (seen === undefined) {
        // None yet: from where its branch started, where it is on a code host Althar knows; one on none merges here.
        if ((yield* hostOfRemotes(remotesOf(repository))) === null) return undefined
        head = repository.baseCommit ?? repository.baseRef ?? undefined
      } else {
        // Its head as the host has it, else as Althar pushed it: the first the branch has. A worktree on a branch of its own
        // since, made for its next pull request that didn't open, counts from where that branch started.
        moved = repository.branch !== repository.changeBranch
        head = moved && repository.baseCommit !== null ? repository.baseCommit : undefined
        for (const candidate of moved ? [] : [seen.headSha, repository.sent])
          if (candidate !== null && head === undefined && (yield* onHeadHere(candidate))) head = candidate
      }
      if (head === undefined) return undefined
      const shipped = head
      // What the person left out after it stays out: the count starts where they did, while the branch still has it.
      const left = (yield* outcome('rev-parse', '--verify', '-q', `${LEFT_OUT}${repository.workspaceId}^{commit}`)).stdout
      if (
        left !== '' &&
        left !== head &&
        (yield* onHeadHere(left)) &&
        (yield* outcome('merge-base', '--is-ancestor', head, left)).code === 0
      )
        head = left
      const listed = yield* read('rev-list', '--reverse', '--no-merges', `${head}..HEAD`)
      const all = listed.split('\n').filter((line) => line !== '')
      if (all.length === 0) return undefined
      const against = yield* notOnDefault(repository, head, all)
      if (!against.sure) answered.sure = false
      const commits = against.commits
      // Some of them in the default branch already, the diff from that head has its changes too: theirs are counted alone.
      const whole = commits.length === all.length
      // Commits that change nothing, all together, have nothing to ship.
      if (commits.length === 0 || (whole && (yield* outcome('diff', '--quiet', head, 'HEAD')).code === 0)) return undefined
      // How big they are together, as a diff from that head says: a binary file counts no lines.
      const counted = yield* whole ? read('diff', '--numstat', head, 'HEAD') : read('show', '--numstat', '--format=', ...commits)
      const lines = counted
        .split('\n')
        .map((line) => line.split('\t'))
        .reduce((sum, [add = '', del = '']) => ({ add: sum.add + (Number(add) || 0), del: sum.del + (Number(del) || 0) }), {
          add: 0,
          del: 0,
        })
      return {
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
      } satisfies Unshipped
    })

  /**
   * Each repository's `unshippedIn` as screens read it, by its worktree,
   * kept with all it follows from: the store's row, whether Althar knows
   * a code host for it, and the commits its head, what the person left
   * out and its default branch's refs name, which one git process reads.
   * While those are the same, it is not worked out again: a coordinator's
   * thread, a board and the home read every task's card, each time any
   * task changes. What git couldn't answer in full is worked out again
   * the next time, as is any read where `commitsOf` failed: a worktree
   * always has a HEAD.
   */
  const unshippedKept = new Map<string, { readonly key: string; readonly value: Unshipped | undefined }>()

  /** Those being answered now, by their worktree: the board and a window asking at once start git once. */
  const unshippedGoing = new Map<string, { readonly key: string; readonly answer: Deferred.Deferred<Unshipped | undefined, unknown> }>()

  const keptIn = (repository: ShippingRow) =>
    Effect.gen(function* () {
      const host = repository.snapshot === null ? (yield* hostOfRemotes(remotesOf(repository))) !== null : null
      const commits = yield* commitsOf(repository.path, ['HEAD', `${LEFT_OUT}${repository.workspaceId}`, ...defaultsOf(repository)])
      const key = JSON.stringify([repository, host, commits])
      const found = unshippedKept.get(repository.workspaceId)
      if (found?.key === key) return found.value
      const under = unshippedGoing.get(repository.workspaceId)
      // Asked again while it is being answered: that answer; a read of another key, as its refs moved, is its own.
      if (under !== undefined && under.key === key)
        return yield* Deferred.await(under.answer).pipe(
          // What its asker couldn't keep, a card made of it doesn't keep either.
          Effect.tapCause(() => noteUnsure('what is unshipped')),
          Effect.tap(() => (unshippedKept.get(repository.workspaceId)?.key === key ? Effect.void : noteUnsure('what is unshipped'))),
        )
      const answer = Deferred.makeUnsafe<Unshipped | undefined, unknown>()
      unshippedGoing.set(repository.workspaceId, { key, answer })
      const answered = { sure: true }
      // Its answer stands on its key, which is noted as it is read (standsOn.ts): what git says as it works it out isn't,
      // but where git couldn't answer in full, a card made of it isn't kept either.
      return yield* unnoted(unshippedIn(repository, answered)).pipe(
        Effect.tapCause(() => noteUnsure('what is unshipped')),
        Effect.tap((value) =>
          Effect.gen(function* () {
            if (answered.sure && commits[0] !== null) unshippedKept.set(repository.workspaceId, { key, value })
            else {
              unshippedKept.delete(repository.workspaceId)
              yield* noteUnsure('what is unshipped')
            }
          }),
        ),
        Effect.onExit((exit) =>
          Effect.andThen(
            Effect.sync(() => {
              if (unshippedGoing.get(repository.workspaceId)?.answer === answer) unshippedGoing.delete(repository.workspaceId)
            }),
            Deferred.done(answer, exit),
          ),
        ),
      )
    })

  /**
   * Each of the task's repositories here whose last pull request merged
   * or closed, with commits on its branch after that pull request's head:
   * what a new pull request would have (ADR-034). Merges are left out of
   * them, since what a merge brought in is the default branch's, and so
   * are commits the default branch has already, by their change too;
   * commits that change nothing together have nothing to ship, and those
   * the person left out are history. One whose worktree doesn't have its
   * pull request's head can't tell, and has none. Screens read it `kept`
   * (`keptIn`); what acts on it reads it afresh.
   */
  const unshippedOf = (taskId: string, kept = false) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const repositories = yield* sql<ShippingRow>`
            SELECT w.id AS workspace_id, w.path, w.branch, w.base_commit, w.base_ref, b.display_name AS name, b.slug,
              b.remote_fingerprints AS remotes, coalesce(w.toward, b.default_base_ref) AS default_base, c.head_commit AS sent, c.branch AS change_branch, l.id AS link_id, l.product,
              l.snapshot, l.listening,
              coalesce((SELECT max(o.observed_at) FROM observations o WHERE o.subject_type = 'external_link' AND o.subject_id = l.id
                AND o.kind = 'pushed'), l.created_at) AS opened_at
            FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id
            LEFT JOIN repository_changes c ON c.id = (SELECT id FROM repository_changes WHERE workspace_id = w.id
              AND pull_request_url IS NOT NULL ORDER BY created_at DESC, rowid DESC LIMIT 1)
            LEFT JOIN external_links l ON l.task_id = w.task_id AND l.kind = 'change' AND l.url = c.pull_request_url
            WHERE w.task_id = ${taskId} AND w.device_id = ${instance.deviceId} AND w.access = 'write' AND w.state = 'ready'
            ORDER BY b.created_at, b.rowid`
      const found: Array<Unshipped> = []
      for (const repository of repositories) {
        if (!(yield* there(repository.path))) continue
        const one = yield* kept ? keptIn(repository) : unshippedIn(repository)
        if (one !== undefined) found.push(one)
      }
      return found
    })

  const nothingBuiltOf = (taskId: string) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const links = yield* sql<{ state: string | null }>`
            SELECT json_extract(snapshot, '$.state') AS state FROM external_links WHERE task_id = ${taskId} AND kind = 'change'`
      if (links.some((link) => link.state !== 'closed')) return false
      const worktrees = yield* sql<{
        path: string
        baseCommit: string | null
        baseRef: string | null
        root: string | null
        defaultBase: string | null
      }>`
            SELECT w.path, w.base_commit, w.base_ref, l.path AS root, coalesce(w.toward, b.default_base_ref, w.base_ref) AS default_base
            FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id
            LEFT JOIN repository_locations l ON l.binding_id = b.id AND l.device_id = ${instance.deviceId}
            WHERE w.task_id = ${taskId} AND w.device_id = ${instance.deviceId} AND w.access = 'write' AND w.state = 'ready'`
      // No branch of its own to read, or one whose folder is gone (deleted, or on a volume not mounted): not known to be empty.
      if (worktrees.length === 0) return false
      const pictures = yield* evidencePaths(taskId)
      for (const worktree of worktrees) {
        if (!(yield* there(worktree.path))) return false
        const base = worktree.baseCommit ?? worktree.baseRef
        // Where git can't say what it started from, it isn't known to be empty.
        if (base === null) return false
        // Anything it changed and didn't commit is work, whatever its branch holds.
        if ((yield* uncommittedFiles(worktree.path)).some((file) => !pictures(worktree.path, file))) return false
        // Its branch is in the default branch already, so it has nothing of its own, whatever it started from.
        const head = yield* commitOf(worktree.path, 'HEAD').pipe(Effect.orElseSucceed(() => ''))
        if (head !== '' && worktree.root !== null && worktree.defaultBase !== null) {
          const inDefault = yield* gitOutcome(worktree.root, 'merge-base', '--is-ancestor', head, `refs/heads/${worktree.defaultBase}`)
          if (inDefault.code === 0) continue
        }
        if ((yield* commitsAhead(worktree.path, base)) > 0) return false
      }
      return true
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
            SELECT b.display_name AS name, w.path, coalesce(w.toward, b.default_base_ref, w.base_ref) AS base, l.path AS root,
              EXISTS (SELECT 1 FROM repository_changes c WHERE c.workspace_id = w.id AND c.pull_request_url IS NOT NULL) AS opened
            FROM workspaces w
            JOIN repository_bindings b ON b.id = w.binding_id
            JOIN repository_locations l ON l.binding_id = b.id AND l.device_id = ${instance.deviceId}
            WHERE w.task_id = ${taskId} AND w.device_id = ${instance.deviceId}
            ORDER BY b.created_at, b.rowid`
      // Each repository by its latest pull request, the open one else its newest: one closed before its next merged is history
      // (ADR-034). Among several, each is said with its repository.
      const seen = (yield* Effect.forEach(yield* linksOf(taskId), (link) => Effect.option(decodeSnapshot(link.snapshot)))).flatMap((one) =>
        Option.isSome(one) ? [one.value] : [],
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
      return {
        repositories,
        open,
        unmerged,
        merged: latest.length > 0 && open.length === 0 && unmerged.length === 0,
        someMerged: seen.some((one) => one.state === 'merged'),
      }
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
      const { open, unmerged, someMerged } = yield* mergeOf(taskId)
      // Commits after a merged pull request are in none yet: a new one takes them.
      const after =
        open.length > 0 ? [] : (yield* unshippedOf(taskId)).flatMap((one) => (one.change === null ? [] : [{ ...one, change: one.change }]))
      if (open.length > 0 || unmerged.length > 0 || after.length > 0) {
        // Abandoned, it is nobody's to finish: nothing is said. Nor where nothing of it merged yet, as when Ship opened another
        // of its changes' pull requests: what is open is said where one merged and the rest are still to go.
        if (task.state === 'abandoned') return
        if (!someMerged && by.here === undefined) return yield* touchCard(taskId)
        yield* addItem({ projectId: task.projectId, threadId: task.threadId }, 'notice', {
          source: 'runtime',
          severity: 'info',
          title: `Not done yet: ${[
            ...(open.length === 0 ? [] : [open.length === 1 ? `${open[0]} is still open` : `${open.length} pull requests are still open`]),
            ...(unmerged.length === 0
              ? []
              : [unmerged.length === 1 ? `${unmerged[0]} isn't merged` : `${countOf(unmerged.length, 'pull request')} aren't merged`]),
            ...(after.length === 0 ? [] : [`${commitsWord(after.reduce((sum, one) => sum + one.commits.length, 0))} in no pull request`]),
          ].join(', ')}.`,
        })
        return yield* touchCard(taskId)
      }
      // Its agents, what they left running and its runs stop, in the background: the merge never waits on them.
      // Counted as stopping from before it is done, so a checkout it holds stays its own until they have (ADR-091).
      yield* leftBehind.stoppingWhile(
        taskId,
        Effect.andThen(
          sql.withTransaction(
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
          ),
          leftBehind.settled(taskId),
        ),
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
      // What waited for Ship is left out with the rest: it stays on the branch, and nothing holds it.
      yield* releaseHolds(input.taskId, 'left')
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
      const commits = after.reduce((sum, one) => sum + one.commits.length, 0)
      yield* addItem({ projectId: task.projectId, threadId: task.threadId }, 'notice', {
        source: 'runtime',
        severity: 'info',
        title: `Abandoned ${commitsWord(commits)}.`,
      })
      if (task.state === 'open') yield* settleIfDone(input.taskId, { actorId: input.envelope.actorId })
      // Done already, it settles again without them: what its lead did since stops.
      else yield* leftBehind.settled(input.taskId)
      yield* touchCard(input.taskId)
    })

  /** Whether the project's rules push a task's lead's commits on their own (ADR-072): an open task's, of a project that says so. */
  const pushesFor = (taskId: string) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const [task] = yield* sql<{ projectId: ProjectId }>`SELECT project_id FROM tasks WHERE id = ${taskId} AND state = 'open'`
      return task !== undefined && pushesCommits((yield* (yield* Policies).current(task.projectId)).rules)
    })

  /**
   * Why what the lead committed waits for the person's push to one of its
   * task's pull requests, though the project's rules push it on its own
   * (ADR-072), in a few words for its card; null where it can go up. Never
   * over commits someone else pushed: the pull request's branch anywhere
   * but where Althar last pushed it or its own update of it left it
   * (`leftByAlthar`), they are on it, and the person sees
   * the lead's go on top of them. Never where it would need forcing, nor
   * onto the default branch. Nor once the person stopped or interrupted
   * the lead, until anything goes up or the lead is spoken to again.
   */
  const heldOf = (
    taskId: string,
    link: LinkRow,
    snapshot: Snapshot,
    path: string,
    branch: string,
    ahead: Effect.Success<ReturnType<typeof aheadOf>>,
  ) =>
    Effect.gen(function* () {
      const name = nameOf(snapshot)
      if (ahead.kind === 'behind') return `Someone else pushed to ${name}`
      if (ahead.kind === 'rewritten') return `Pushing to ${name} would need forcing`
      if (ahead.kind === 'unknown') return `Althar can't tell what ${name} has`
      if (snapshot.maintainerEdit === true) return 'Changes to a contributor’s fork wait for your push'
      const { host, repository } = yield* current(taskId, snapshot.url)
      const onto = sourceOf(snapshot, branch)
      if (onto === repository.defaultBranch || onto === snapshot.target) return `${name} is from ${onto}`
      const tip = yield* remoteTip(path, yield* pushTargetOf(taskId, host, repository, path, { ...snapshot, source: onto }), onto)
      const sent = yield* sentTo(link.projectId, snapshot.url)
      const there = tip ?? snapshot.headSha
      const ours =
        there !== null && (yield* leftByAlthar({ link, host, repository, read: host.change(repository, snapshot.number), there, sent }))
      if (!ours) return `Someone else pushed to ${name}`
      const sql = yield* SqlClient.SqlClient
      const [stopped] = yield* sql<{ how: string }>`
            SELECT json_extract(o.payload, '$.how') AS how FROM observations o
            WHERE o.subject_type = 'external_link' AND o.subject_id = ${link.id} AND o.kind = 'taken'
              AND json_extract(o.payload, '$.how') IN ('stopped', 'interrupted')
              AND o.observed_at >= coalesce((SELECT max(p.observed_at) FROM observations p WHERE p.subject_type = 'external_link'
                AND p.subject_id = ${link.id} AND p.kind = 'pushed'), '')
              AND o.observed_at >= coalesce((SELECT max(i.accepted_at) FROM user_inputs i JOIN threads t ON t.id = i.thread_id
                WHERE t.task_id = ${taskId} AND t.kind = 'task'), '')
            ORDER BY o.observed_at DESC LIMIT 1`
      if (stopped !== undefined) return `You ${stopped.how} the lead before it pushed`
      return null
    })

  /** Keeps why what the lead committed waits for the person (ADR-072), for its card, until anything next goes up. */
  const holdPush = (link: LinkRow, head: string | null, why: string) =>
    Effect.gen(function* () {
      yield* heard(link, 'push_held', `held:${head ?? ''}:${yield* timestamp}`, { head, why })
      yield* touchCard(link.taskId)
    })

  /**
   * Pushes what the lead committed to one of its task's open pull
   * requests, as the project's rules have it (ADR-072), saying so in the
   * thread; or keeps why it waits for the person. What the branch has
   * here is looked at first, so a pull request with nothing new asks
   * nothing of its host.
   */
  const pushLeftOn = (taskId: string, link: LinkRow, late: boolean) =>
    Effect.gen(function* () {
      const seen = yield* decodeSnapshot(link.snapshot)
      if (seen.state !== 'open') return
      const workspace = yield* worktreeOf(taskId, seen.url)
      if (workspace === undefined || !existsSync(workspace.path)) return
      const sent = yield* sentTo(link.projectId, seen.url)
      const here = yield* aheadOf(workspace.path, null, [sent, seen.headSha])
      // Held for Ship, what the person's turns committed goes up with Ship alone, after its review: its card offers Ship. Held
      // with nothing left to send, as where the person pushed it themselves, nothing waits: the hold goes.
      if (workspace.heldAt !== null) {
        if (here.kind === 'ahead' && here.count === 0 && (yield* unshippedOf(taskId)).length === 0) yield* releaseHolds(taskId, 'left')
        return
      }
      if (here.kind === 'ahead' && here.count === 0) return
      // Its host gone from the project, nothing can ask it; where asking it fails, as when offline, the person's Push waits
      // with why, not a card that says they're on their way, until the next turn ends, the person pushes, or Althar starts.
      if (link.connectionId === null) return yield* holdPush(link, here.head, `${nameOf(seen)}'s host isn't connected`)
      // Still at work long after its turn ended, as on tests it left running, it may yet commit: what it has waits for the person.
      if (late) return yield* holdPush(link, here.head, 'The lead was still at work after its turn')
      yield* pushLeftTo(taskId, link, workspace, sent).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause)
            : Effect.andThen(
                Effect.logWarning('Could not push what the lead committed: it waits for the person', cause),
                // Nowhere to push it says why; anything else, that it couldn't get there.
                holdPush(
                  link,
                  here.head,
                  Option.getOrUndefined(Cause.findErrorOption(cause)) instanceof PushRefused
                    ? pushFailed(cause)
                    : `Althar couldn't reach ${nameOf(seen)}`,
                ),
              ),
        ),
      )
    })

  /** What `pushLeftOn` does once it knows there is something to push: asks the host, then pushes or holds. */
  const pushLeftTo = (taskId: string, link: LinkRow, workspace: { readonly path: string; readonly branch: string }, sent: string | null) =>
    Effect.gen(function* () {
      const seen = yield* decodeSnapshot(link.snapshot)
      const { snapshot, host, repository } = yield* current(taskId, seen.url)
      // As its host has it now: one merged since Althar last asked takes nothing more (ADR-034).
      if ((yield* host.change(repository, snapshot.number)).state !== 'open') return
      const onto = sourceOf(snapshot, workspace.branch)
      const tip = yield* remoteTip(
        workspace.path,
        yield* pushTargetOf(taskId, host, repository, workspace.path, { ...snapshot, source: onto }),
        onto,
      )
      const ahead = yield* aheadOf(workspace.path, tip, [sent, snapshot.headSha])
      if (ahead.kind === 'ahead' && ahead.count === 0) return
      const why = yield* heldOf(taskId, link, snapshot, workspace.path, workspace.branch, ahead)
      if (why !== null) return yield* holdPush(link, ahead.head, why)
      if (ahead.kind !== 'ahead') return
      const pushed = yield* Effect.exit(push(taskId, ahead.head, snapshot.url, 'althar'))
      if (pushed._tag === 'Success')
        return yield* sayOn(link, `Pushed ${commitsWord(ahead.count)} to ${nameOf(snapshot)} as the lead's turn ended.`)
      yield* Effect.logWarning('Could not push what the lead committed: it waits for the person', pushed.cause)
      yield* holdPush(link, ahead.head, pushFailed(pushed.cause))
    })

  /** Why a push Althar made on its own didn't go through, for the card beside the person's Push (ADR-072). */
  const pushFailed = (cause: Cause.Cause<unknown>) => {
    const failed = Option.getOrUndefined(Cause.findErrorOption(cause))
    if (failed instanceof ChangedSinceSeen) return 'The branch moved as Althar pushed'
    // A push git refused says why in its own sentence; one it can't name, by git's first line, as the card has no Details.
    if (failed instanceof PushRefused)
      return failed.why === 'failed'
        ? `Althar couldn't push: ${(failed.detail ?? '').trim().split('\n')[0]?.replace(/\.$/, '') ?? ''}`
        : words(failed, String).message.replace(/\.$/, '')
    return `Althar couldn't push: ${gitSaidOf(cause).replace(/\.$/, '')}`
  }

  /**
   * Each of the task's worktrees' head, by workspace, as the first turn
   * the person's words began after its last run ended found it, or since
   * its last hold was let go, whichever is later: what such turns
   * committed since is theirs, held for Ship. One under way still counts
   * only with `underWay`, as a push does. Undefined while a run is under
   * way, whose steps push as they did, or where no such turn is.
   */
  const turnHeadsOf = (taskId: string, threadId: string, underWay = false) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const [first] = yield* sql<{ heads: string }>`
            SELECT d.heads FROM turn_deliveries d
            WHERE d.thread_id = ${threadId} AND d.heads IS NOT NULL AND d.state <> 'pending'
              AND (${underWay ? 1 : 0} = 1 OR d.state <> 'delivered')
              AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.task_id = ${taskId} AND r.state = 'running' AND json_type(r.parameters, '$.ships') IS NULL)
              AND ((${underWay ? 1 : 0} = 1 AND d.state = 'delivered') OR coalesce(d.ended_at, d.delivered_at) >= max(
                coalesce((SELECT max(r.ended_at) FROM runs r WHERE r.task_id = ${taskId}), ''),
                coalesce((SELECT max(e.occurred_at) FROM record_events e JOIN workspaces w ON w.id = e.aggregate_id
                  WHERE e.aggregate_type = 'workspace' AND w.task_id = ${taskId}
                    AND e.type IN ('workspace.shipped', 'workspace.hold_left')), '')))
            ORDER BY d.delivered_at, d.rowid LIMIT 1`
      if (first === undefined) return undefined
      return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Record(Schema.String, Schema.String)))(first.heads).pipe(
        Effect.orElseSucceed(() => undefined),
      )
    })

  /**
   * Holds for Ship what turns the person's words began committed, for
   * each task whose turn ended before this launch but wasn't held yet:
   * one cut short by a stop, or whose end Althar didn't hear. Each on its
   * own, so one that can't be read leaves the rest.
   */
  const holdAfterRestart = Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const talked = yield* sql<{ taskId: string; threadId: string }>`
          SELECT DISTINCT t.task_id, t.id AS thread_id FROM threads t JOIN tasks k ON k.id = t.task_id
          JOIN turn_deliveries d ON d.thread_id = t.id
          WHERE t.kind = 'task' AND k.state IN ('open', 'done') AND d.heads IS NOT NULL
            AND k.project_id IN (SELECT id FROM projects WHERE archived_at IS NULL)`
    for (const one of talked)
      yield* locked(one.taskId)(
        Effect.gen(function* () {
          const heads = yield* turnHeadsOf(one.taskId, one.threadId)
          if (heads !== undefined) yield* holdAfterTurn(one.taskId, heads)
        }),
      ).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not hold what a turn committed before Althar restarted', cause)))
  })

  /**
   * Holds for Ship what the person's turns committed so far, the one under
   * way included: what a turn commits is held from the start, not only once
   * it ends, so nothing pushes it first, the lead's own push included.
   */
  const holdBeforePush = (taskId: string): Effect.Effect<void, unknown, Store> =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const [thread] = yield* sql<{ id: string }>`SELECT id FROM threads WHERE task_id = ${taskId} AND kind = 'task'`
      if (thread === undefined) return
      const heads = yield* turnHeadsOf(taskId, thread.id, true)
      if (heads !== undefined) yield* holdAfterTurn(taskId, heads)
    })

  /** The task's worktrees here held for Ship, the first held first. */
  const holdsOf = (taskId: string) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      return yield* sql<Held>`
            SELECT id AS workspace_id, path, branch, held_at FROM workspaces
            WHERE task_id = ${taskId} AND device_id = ${instance.deviceId} AND held_at IS NOT NULL ORDER BY held_at, rowid`
    })

  /**
   * Holds for Ship each of the task's worktrees whose branch a turn the
   * person's words began moved: `heads`, each worktree's head as that
   * turn began, by workspace. What the turn committed stays on the
   * branch, and nothing pushes it but Ship (a task is a conversation plus
   * parts, "A tweak waits for Ship"). A worktree held already, gone, or
   * with no branch yet is left as it is. How many it held.
   */
  const holdAfterTurn = (taskId: string, heads: Readonly<Record<string, string>>) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      // A quick task's work stays on this Mac until the person makes it a change: nothing of it ships, so nothing is held.
      const rows = yield* sql<{ id: string; projectId: ProjectId; path: string }>`
            SELECT w.id, w.project_id, w.path FROM workspaces w JOIN tasks k ON k.id = w.task_id
            WHERE w.task_id = ${taskId} AND w.device_id = ${instance.deviceId} AND w.access = 'write' AND w.state <> 'cleaned'
              AND w.branched_at IS NOT NULL AND w.held_at IS NULL AND NOT ${sql.unsafe(quickIn('k'))}`
      // Only where something waits to go up: a turn that pushed what it made already holds nothing.
      const waiting = rows.length > 0 && ((yield* shipToOpen(taskId, false)).length > 0 || (yield* unshippedOf(taskId)).length > 0)
      let held = 0
      for (const row of rows) {
        if (!waiting) break
        const before = heads[row.id]
        if (before === undefined || !existsSync(row.path)) continue
        const now = yield* commitOf(row.path, 'HEAD').pipe(Effect.orElseSucceed(() => null))
        if (now === null || now === before) continue
        // A merge of its base that settled no conflict is none of the task's work: it goes up as it is, with no Ship to wait for.
        if (yield* onlyBase(row.path, before, now, yield* baseRefsOf(row.id))) continue
        yield* sql.withTransaction(
          Effect.gen(function* () {
            const revision = yield* change('workspaces', row.id, { heldAt: yield* timestamp })
            yield* fact({
              projectId: row.projectId,
              aggregateType: 'workspace',
              aggregateId: row.id,
              revision,
              type: 'workspace.held_for_ship',
              payload: { from: before, head: now },
              actorId: instance.systemId,
            })
          }),
        )
        held += 1
      }
      if (held > 0) yield* touchCard(taskId)
      return held
    })

  /**
   * Lets go of the task's holds for Ship: what waited went up with Ship,
   * or the person left it on the branch. Its commits go up as Althar's
   * course has them from here.
   */
  const releaseHolds = (taskId: string, why: 'shipped' | 'left', only?: ReadonlyArray<string>, heads?: Readonly<Record<string, string>>) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = (yield* sql<{ id: string; projectId: ProjectId; path: string; heldAt: string | null }>`
              SELECT id, project_id, path, held_at FROM workspaces WHERE task_id = ${taskId}
                AND device_id = ${instance.deviceId} AND access = 'write'
                AND (${heads === undefined ? 1 : 0} = 1 OR (state = 'ready' AND reviewing IS NULL))`).filter(
        (row) => (only === undefined || only.includes(row.id)) && (heads === undefined || heads[row.id] !== undefined),
      )
      for (const row of rows) {
        const pinned = heads?.[row.id]
        const current = pinned === undefined ? undefined : yield* commitOf(row.path, 'HEAD')
        const sent = pinned === undefined ? [] : yield* asCredited(pinned)
        const waits = current !== undefined && !sent.includes(current)
        if ((waits && row.heldAt !== null) || (!waits && row.heldAt === null)) continue
        yield* sql.withTransaction(
          Effect.gen(function* () {
            const revision = yield* change('workspaces', row.id, { heldAt: waits ? yield* timestamp : null })
            yield* fact({
              projectId: row.projectId,
              aggregateType: 'workspace',
              aggregateId: row.id,
              revision,
              type: waits ? 'workspace.held_for_ship' : why === 'shipped' ? 'workspace.shipped' : 'workspace.hold_left',
              ...(waits ? { payload: { from: pinned, head: current } } : {}),
              actorId: instance.systemId,
            })
          }),
        )
      }
      if (rows.length > 0) yield* touchCard(taskId)
    })

  /**
   * What Ship sends to the task's open pull requests, after its review:
   * each one's branch up to its head here, past the hold, as a person's
   * push. What went where, by pull request; with `send` false, what would,
   * and nothing goes up.
   */
  const shipToOpen = (taskId: string, send = true, only?: ReadonlyArray<string>, heads?: Readonly<Record<string, string>>) =>
    Effect.gen(function* () {
      const went: Array<{ readonly where: string; readonly count: number; readonly url: string; readonly change: string | null }> = []
      // The bottom of a stack first: each change goes up before what is stacked on it.
      for (const link of yield* bottomUp(taskId, yield* linksOf(taskId))) {
        if (link.listening !== 1) continue
        const seen = yield* decodeSnapshot(link.snapshot)
        if (seen.state !== 'open') continue
        const workspace = yield* worktreeOf(taskId, seen.url)
        if (workspace === undefined || !existsSync(workspace.path)) continue
        // A change's own Ship sends it alone (and what waits beneath it, which ships first, as its own).
        if (only !== undefined && !only.includes(workspace.id)) continue
        if (heads !== undefined && heads[workspace.id] === undefined) continue
        const sent = yield* sentTo(link.projectId, seen.url)
        const here = yield* aheadOf(workspace.path, null, [sent, seen.headSha])
        if (here.kind !== 'ahead') continue
        const pinned = heads?.[workspace.id]
        const head = pinned === undefined ? here.head : yield* acceptedHead(taskId, workspace.path, pinned)
        // Already sent by an earlier try, or from elsewhere: a retry never replaces it with a later local head.
        if (yield* isUnder(workspace.path, head, here.from)) continue
        if (!(yield* isUnder(workspace.path, here.from, head))) return yield* new ChangedSinceSeen({ taskId, what: 'branch' })
        const count = yield* countBetween(workspace.path, here.from, head)
        if (count === 0) continue
        if (send) yield* push(taskId, head, seen.url, 'ship')
        const sql = yield* SqlClient.SqlClient
        const [named] = yield* sql<{ name: string | null }>`SELECT name FROM workspaces WHERE id = ${workspace.id}`
        went.push({ where: nameOf(seen), count, url: seen.url, change: named?.name ?? null })
      }
      return went
    })

  /** `onlyBaseWaits`: each open pull request's waiting commits bring its base in alone, and a hold has nothing else. */
  const onlyBaseWaitsOf = (taskId: string) =>
    Effect.gen(function* () {
      const measured = new Set<string>()
      let waits = false
      for (const link of yield* linksOf(taskId)) {
        if (link.listening !== 1) continue
        const seen = yield* decodeSnapshot(link.snapshot)
        if (seen.state !== 'open') continue
        const workspace = yield* worktreeOf(taskId, seen.url)
        if (workspace === undefined || !existsSync(workspace.path)) continue
        const here = yield* aheadOf(workspace.path, null, [yield* sentTo(link.projectId, seen.url), seen.headSha])
        if (here.kind !== 'ahead') return false
        measured.add(workspace.id)
        if (here.count === 0) continue
        if (!(yield* onlyBase(workspace.path, here.from, here.head, yield* baseRefsOf(workspace.id)))) return false
        waits = true
      }
      // A hold on a worktree with no open pull request waits for a new one: that is the task's, as it always was.
      if ((yield* holdsOf(taskId)).some((held) => !measured.has(held.workspaceId))) return false
      return waits
    })

  const sendBaseOnly = (taskId: string) =>
    Effect.gen(function* () {
      const heads: Record<string, string> = {}
      const links = yield* linksOf(taskId)
      for (const link of links) {
        if (link.listening !== 1) continue
        const seen = yield* decodeSnapshot(link.snapshot)
        if (seen.state !== 'open') continue
        const workspace = yield* worktreeOf(taskId, seen.url)
        if (workspace === undefined || !existsSync(workspace.path)) continue
        const here = yield* aheadOf(workspace.path, null, [yield* sentTo(link.projectId, seen.url), seen.headSha])
        if (here.kind !== 'ahead' || !(yield* onlyBase(workspace.path, here.from, here.head, yield* baseRefsOf(workspace.id))))
          return yield* new ShipRefused({ taskId, why: 'working' })
        heads[workspace.id] = here.head
      }
      const went = yield* shipToOpen(taskId, true, undefined, heads)
      yield* releaseHolds(taskId, 'shipped', undefined, heads)
      for (const one of went) {
        for (const link of links) {
          const seen = yield* decodeSnapshot(link.snapshot)
          if (seen.url !== one.url) continue
          yield* sayOn(
            link,
            `Pushed ${commitsWord(one.count)} to ${one.where}. They only bring its base branch in, so they start no review.`,
          )
          break
        }
      }
      return went.map(({ where, count }) => ({ where, count }))
    })

  const waitingChanges = (taskId: string, asked?: string) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<{
        id: string
        name: string | null
        path: string
        branch: string
        toward: string | null
        bindingId: string
        heldAt: string | null
        baseCommit: string | null
        branched: number
      }>`
            SELECT id, name, path, branch, toward, binding_id, held_at, base_commit, branched_at IS NOT NULL AS branched FROM workspaces
            WHERE task_id = ${taskId} AND device_id = ${instance.deviceId} AND access = 'write' AND reviewing IS NULL AND state = 'ready'
            ORDER BY created_at, rowid`
      const unshipped = new Set((yield* unshippedOf(taskId)).map((one) => one.workspaceId))
      const waits = (row: (typeof rows)[number]) =>
        Effect.gen(function* () {
          if (row.heldAt !== null || unshipped.has(row.id)) return true
          const [open] = yield* sql<{ url: string; head: string | null; projectId: string }>`
                SELECT l.url, json_extract(l.snapshot, '$.headSha') AS head, l.project_id FROM repository_changes c
                JOIN external_links l ON l.url = c.pull_request_url AND l.kind = 'change' AND l.listening = 1
                WHERE c.workspace_id = ${row.id} AND json_extract(l.snapshot, '$.state') = 'open' LIMIT 1`
          if (open === undefined || !existsSync(row.path)) return false
          const here = yield* aheadOf(row.path, null, [yield* sentTo(open.projectId, open.url), open.head])
          return here.kind === 'ahead' && here.count > 0
        }).pipe(Effect.orElseSucceed(() => false))
      // Bottom of each stack first.
      const depthOf = (row: (typeof rows)[number]) => {
        let depth = 0
        let at: (typeof rows)[number] | undefined = row
        const seen = new Set<string>()
        while (at !== undefined && at.toward !== null && !seen.has(at.id)) {
          seen.add(at.id)
          const toward: string = at.toward
          const binding: string = at.bindingId
          at = rows.find((one) => one.bindingId === binding && one.branch === toward)
          if (at !== undefined) depth += 1
        }
        return depth
      }
      const ordered = rows
        .map((row, index) => ({ row, index, depth: depthOf(row) }))
        .toSorted((a, b) => a.depth - b.depth || a.index - b.index)
      // Of one change: it, and what waits beneath it in its stack.
      let wanted = ordered
      if (asked !== undefined) {
        const named = rows.find((one) => (one.name ?? '').toLowerCase() === asked.trim().toLowerCase() || one.branch === asked.trim())
        if (named === undefined) return yield* new ToolRefused({ message: `The task has no change “${asked}” here.` })
        const chain = new Set<string>([named.id])
        let at: (typeof rows)[number] | undefined = named
        while (at !== undefined && at.toward !== null) {
          const toward: string = at.toward
          const binding: string = at.bindingId
          at = rows.find((one) => one.bindingId === binding && one.branch === toward)
          if (at !== undefined && !chain.has(at.id)) chain.add(at.id)
          else break
        }
        wanted = ordered.filter((one) => chain.has(one.row.id))
      }
      const out: Array<{ readonly id: string; readonly name: string | null }> = []
      for (const one of wanted) if (yield* waits(one.row)) out.push({ id: one.row.id, name: one.row.name })
      return out
    })

  /**
   * Pushes what a task's lead committed to each of its open pull
   * requests, where the project's rules push it on its own (ADR-072),
   * once its turn has ended: not while it is in one, nor while its plan
   * publishes or a conflict round is under way, which push themselves.
   */
  const pushLeft = (taskId: string, late = false) =>
    Effect.gen(function* () {
      if (!(yield* pushesFor(taskId))) return
      // Stepped back into prototyping: its pull request stays as it is, whatever its lead commits.
      if (yield* keptOpenOf(taskId)) return
      if ((yield* publishing(taskId)) || (yield* roundUnderWay(taskId))) return
      const sql = yield* SqlClient.SqlClient
      const [thread] = yield* sql<{ id: string }>`SELECT id FROM threads WHERE task_id = ${taskId} AND kind = 'task'`
      if (thread === undefined) return
      const lead = yield* sessions.running(thread.id)
      if (Option.isSome(lead) && lead.value.turnRunning) return
      // What the person committed by hand meanwhile is held first: Althar's own push would carry it up.
      yield* holdHands(taskId)
      for (const link of yield* linksOf(taskId)) {
        if (link.listening !== 1) continue
        yield* pushLeftOn(taskId, link, late).pipe(
          Effect.catchCause((cause) => Effect.logWarning('Could not push what the lead committed', cause)),
        )
      }
    })

  /* Leads whose commits wait for them to be done before they go up, by thread: so each is waited for once. */
  const holdingCommits = new Set<string>()

  /**
   * When a lead's turn ends, or its session goes, what it committed goes
   * up (`pushLeft`) once it is done, as a conflict round's lead is waited
   * for: a lead may commit just after its turn, and one still at work,
   * such as on tests it left running, is pushed for when that ends.
   */
  const lookAtCommits = (event: LiveEvent): Effect.Effect<void, unknown, Store> =>
    Effect.gen(function* () {
      if (event._tag !== 'TurnEnded' && event._tag !== 'SessionEnded') return
      if (holdingCommits.has(event.threadId)) return
      const sql = yield* SqlClient.SqlClient
      const [thread] = yield* sql<{ taskId: string; state: string; listening: number }>`
            SELECT t.task_id, k.state,
              EXISTS (SELECT 1 FROM external_links l WHERE l.task_id = k.id AND l.kind = 'change' AND l.listening = 1) AS listening
            FROM threads t JOIN tasks k ON k.id = t.task_id WHERE t.id = ${event.threadId} AND t.kind = 'task'
              AND k.state IN ('open', 'done')`
      if (thread === undefined) return
      const pushes = thread.state === 'open' && thread.listening === 1 && (yield* pushesFor(thread.taskId))
      // A turn the person's words began after the plan, which may have committed: what it did is held for Ship first.
      const talked = (yield* turnHeadsOf(thread.taskId, event.threadId)) !== undefined
      if (!pushes && !talked) return
      holdingCommits.add(event.threadId)
      yield* Effect.forkIn(
        Effect.sleep(dependencies.reportsWithin).pipe(
          Effect.andThen(sessions.untilIdle(event.threadId, dependencies.busyUpTo)),
          Effect.ensuring(Effect.sync(() => holdingCommits.delete(event.threadId))),
          Effect.flatMap((done) =>
            locked(thread.taskId)(
              Effect.gen(function* () {
                // Read again once the lead is done: what it committed just after its turn counts, and a hold comes before any push.
                const heads = yield* turnHeadsOf(thread.taskId, event.threadId)
                if (heads !== undefined) yield* holdAfterTurn(thread.taskId, heads)
                if (pushes) yield* pushLeft(thread.taskId, done === 'late')
              }),
            ),
          ),
          Effect.catchCause((cause) => Effect.logWarning('Could not push what the lead committed after its turn', cause)),
          provide,
        ),
        scope,
      )
    })

  /*
   * Commits the person makes by hand in a task's folder hold it for Ship, as their turns' do (a task is a conversation plus
   * parts, "A tweak waits for Ship"): of what isn't sent yet, a commit written outside every turn of the task's agents (from
   * a moment before each began to a while after it ended, as a lead may commit just after) is the person's. Told by when it
   * was written, which crediting what Althar sends keeps. Looked at as each turn of its lead begins, before it reads
   * anything, and before Althar pushes on its own.
   */
  const HAND_GRACE_MS = 2 * 60_000

  const holdHands = (taskId: string) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<{ id: string; path: string; projectId: string }>`
            SELECT w.id, w.path, w.project_id FROM workspaces w JOIN tasks k ON k.id = w.task_id
            WHERE w.task_id = ${taskId} AND w.device_id = ${instance.deviceId} AND w.access = 'write' AND w.state = 'ready'
              AND w.branched_at IS NOT NULL AND w.held_at IS NULL AND NOT ${sql.unsafe(quickIn('k'))}`
      if (rows.length === 0) return
      const turns = yield* sql<{ from: string | null; to: string | null }>`
            SELECT d.delivered_at AS "from", d.ended_at AS "to" FROM turn_deliveries d JOIN threads t ON t.id = d.thread_id
            WHERE t.task_id = ${taskId} AND d.delivered_at IS NOT NULL`
      const now = yield* Clock.currentTimeMillis
      const windows = turns.flatMap((turn) =>
        turn.from === null
          ? []
          : [{ from: Date.parse(turn.from) - 5_000, to: (turn.to === null ? now : Date.parse(turn.to)) + HAND_GRACE_MS }],
      )
      const inATurn = (at: number) => windows.some((window) => at >= window.from && at <= window.to)
      const moved: Record<string, string> = {}
      for (const row of rows) {
        if (!existsSync(row.path)) continue
        // What isn't sent yet: past what its open pull request has, or what Althar last pushed of it.
        const [link] = yield* sql<{ url: string; snapshot: string }>`
              SELECT l.url, l.snapshot FROM external_links l JOIN repository_changes c ON c.pull_request_url = l.url
              WHERE c.workspace_id = ${row.id} AND l.kind = 'change' AND json_extract(l.snapshot, '$.state') = 'open'
              ORDER BY l.created_at DESC LIMIT 1`
        if (link === undefined) continue
        const seen = yield* decodeSnapshot(link.snapshot)
        const sent = yield* sentTo(row.projectId, seen.url)
        // As it mostly is: the folder is where it was sent, and nothing in it waits.
        const tip = yield* commitOf(row.path, 'HEAD').pipe(Effect.orElseSucceed(() => ''))
        if (tip === seen.headSha || tip === sent) continue
        const here = yield* aheadOf(row.path, null, [sent, seen.headSha])
        if (here.kind !== 'ahead' || here.count === 0) continue
        // Only the task's own commits can be the person's: what a merge of its base brought was written elsewhere, by others.
        const refs = yield* baseRefsOf(row.id)
        if (yield* onlyBase(row.path, here.from, here.head, refs)) continue
        const own = yield* ownCommits(row.path, here.from, here.head, refs)
        if (own.length === 0) continue
        const written = yield* git(row.path, 'log', '--no-walk=unsorted', '--format=%H %at', ...own).pipe(Effect.orElseSucceed(() => ''))
        const byHand = written
          .split('\n')
          .filter((line) => line !== '')
          .some((line) => !inATurn(Number(line.split(' ')[1] ?? '0') * 1000))
        if (byHand) moved[row.id] = here.from
      }
      if (Object.keys(moved).length > 0) yield* holdAfterTurn(taskId, moved)
    })

  /*
   * Althar follows what the lead does with git, rather than forbid it (a task is a conversation plus parts): as each turn of
   * its lead ends, once it is done, each of the task's folders is read for its branch. A folder now on another branch makes
   * that branch a change of the task's, working toward what the change it left did; the change it left keeps its branch and
   * pull request, with no folder (`away`) until it is worked on again. One left detached, or on the branch its change works
   * toward, gets a line, once, and the lead puts it right. Then a change with no open pull request recorded takes one its
   * host has from its own branch into what it works toward, opened by `gh pr create`, an MCP server or on the website.
   */
  const followed = new Set<string>()

  const saidOf = new Set<string>()

  const followTurns = (event: LiveEvent): Effect.Effect<void, unknown, Store> =>
    Effect.gen(function* () {
      if (event._tag !== 'TurnEnded' || followed.has(event.threadId)) return
      const sql = yield* SqlClient.SqlClient
      const [thread] = yield* sql<{ taskId: string }>`
            SELECT t.task_id FROM threads t JOIN tasks k ON k.id = t.task_id
            WHERE t.id = ${event.threadId} AND t.kind = 'task' AND k.state IN ('open', 'done')`
      if (thread === undefined) return
      followed.add(event.threadId)
      yield* Effect.forkIn(
        Effect.sleep(dependencies.reportsWithin).pipe(
          Effect.andThen(sessions.untilIdle(event.threadId, dependencies.busyUpTo)),
          Effect.ensuring(Effect.sync(() => followed.delete(event.threadId))),
          Effect.andThen(locked(thread.taskId)(followBranches(thread.taskId))),
          Effect.andThen(adoptOpen(thread.taskId)),
          Effect.catchCause((cause) => Effect.logWarning('Could not follow what the lead did with git', cause)),
          provide,
        ),
        scope,
      )
    })

  const followBranches = (taskId: string) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<{
        id: string
        projectId: ProjectId
        bindingId: string
        path: string
        branch: string
        name: string | null
        toward: string | null
        baseRef: string
        baseCommit: string | null
        setup: string | null
        target: string
        threadId: string
      }>`
            SELECT w.id, w.project_id, w.binding_id, w.path, w.branch, w.name, w.toward, w.base_ref, w.base_commit, w.setup,
              coalesce(w.toward, b.default_base_ref, 'main') AS target,
              (SELECT t.id FROM threads t WHERE t.task_id = w.task_id AND t.kind = 'task') AS thread_id
            FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id
            WHERE w.task_id = ${taskId} AND w.device_id = ${instance.deviceId} AND w.access = 'write' AND w.state = 'ready'
              AND w.reviewing IS NULL AND w.branched_at IS NOT NULL AND w.kind IS NOT 'checkout'
            ORDER BY w.created_at, w.rowid`
      for (const row of rows) {
        if (!existsSync(row.path)) continue
        const now = (yield* gitOutcome(row.path, 'symbolic-ref', '--short', '-q', 'HEAD')).stdout.trim()
        if (now === row.branch) continue
        const changeName = row.name ?? row.branch
        if (now === '' || now === row.target) {
          const key = `${row.id}:${now}`
          if (saidOf.has(key)) continue
          saidOf.add(key)
          yield* addItem({ projectId: row.projectId, threadId: row.threadId }, 'notice', {
            source: 'runtime',
            severity: 'warning',
            title:
              now === ''
                ? `The folder of ${changeName} is on no branch: its lead puts it back on ${row.branch}.`
                : `The folder of ${changeName} is on ${now}, the branch its change works toward: its lead puts it back on ${row.branch}.`,
            description: null,
          })
          continue
        }
        // Another change of the task's on that branch takes the folder back; else the branch is a new change.
        const [other] = yield* sql<{ id: string; name: string | null }>`
              SELECT id, name FROM workspaces WHERE task_id = ${taskId} AND device_id = ${instance.deviceId} AND binding_id = ${row.bindingId}
                AND branch = ${now} AND reviewing IS NULL AND id <> ${row.id} LIMIT 1`
        const met = (yield* gitOutcome(row.path, 'merge-base', 'HEAD', row.target)).stdout.trim()
        const at = yield* timestamp
        const made = other === undefined ? yield* newId(Ids.workspace) : null
        yield* sql.withTransaction(
          Effect.gen(function* () {
            const away = yield* change('workspaces', row.id, { state: 'away' })
            yield* fact({
              projectId: row.projectId,
              aggregateType: 'workspace',
              aggregateId: row.id,
              revision: away,
              type: 'workspace.folder_left',
              payload: { to: now },
              actorId: instance.systemId,
            })
            if (other !== undefined) {
              const back = yield* change('workspaces', other.id, { state: 'ready', path: row.path })
              yield* fact({
                projectId: row.projectId,
                aggregateType: 'workspace',
                aggregateId: other.id,
                revision: back,
                type: 'workspace.folder_back',
                payload: { from: row.branch },
                actorId: instance.systemId,
              })
              return
            }
            if (made === null) return
            yield* sql`INSERT INTO workspaces ${sql.insert({
              id: made,
              projectId: row.projectId,
              taskId,
              bindingId: row.bindingId,
              deviceId: instance.deviceId,
              access: 'write',
              path: row.path,
              baseRef: row.baseRef,
              ...(/^[0-9a-f]{40,64}$/.test(met) ? { baseCommit: met } : row.baseCommit === null ? {} : { baseCommit: row.baseCommit }),
              branch: now,
              state: 'ready',
              createdAt: at,
              branchedAt: at,
              // A worktree as the task's first is (kind null), in the folder the change it left was set up in: set up already.
              ...(row.setup === null ? {} : { setup: row.setup }),
              name: now,
              ...(row.toward === null ? {} : { toward: row.toward }),
            })}`
            yield* fact({
              projectId: row.projectId,
              aggregateType: 'workspace',
              aggregateId: made,
              revision: 1,
              type: 'workspace.change_started',
              payload: { name: now, branch: now, toward: row.toward, followed: row.id },
              actorId: instance.systemId,
            })
          }),
        )
        if (other === undefined)
          yield* addItem({ projectId: row.projectId, threadId: row.threadId }, 'notice', {
            source: 'runtime',
            severity: 'info',
            title: `New change · ${now}, on ${now}.`,
            description: `Its lead switched ${changeName}'s folder to it. ${changeName} keeps its branch and pull request.`,
            step: { kind: 'new_change', name: now, branch: now, toward: null, by: 'git' },
          })
        yield* touchTask(taskId)
      }
    })

  /** A change with no open pull request recorded takes the one its host has from its own branch into what it works toward. */
  const adoptOpen = (taskId: string): Effect.Effect<void, unknown, Store> =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<{
        path: string
        branch: string
        target: string
        remotes: string
        threadId: string
        projectId: ProjectId
      }>`
            SELECT w.path, w.branch, coalesce(w.toward, b.default_base_ref, 'main') AS target, b.remote_fingerprints AS remotes,
              (SELECT t.id FROM threads t WHERE t.task_id = w.task_id AND t.kind = 'task') AS thread_id, w.project_id
            FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id
            WHERE w.task_id = ${taskId} AND w.device_id = ${instance.deviceId} AND w.access = 'write' AND w.state = 'ready'
              AND w.reviewing IS NULL AND w.branched_at IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM repository_changes c JOIN external_links l ON l.url = c.pull_request_url AND l.kind = 'change'
                WHERE c.workspace_id = w.id AND json_extract(l.snapshot, '$.state') = 'open')
              AND EXISTS (SELECT 1 FROM tasks k WHERE k.id = w.task_id AND k.state IN ('open', 'draft'))`
      for (const row of rows) {
        if (!existsSync(row.path)) continue
        const named = yield* namedRemotes(row.path).pipe(Effect.orElseSucceed(() => []))
        const fork = forkOf(named)
        const remotes =
          fork === null
            ? workRemotes(named, Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.String)))(row.remotes))
            : [fork.fork.url]
        const found = yield* connections.hostOf(remotes, { fromCli: false }).pipe(Effect.orElseSucceed(() => null))
        if (found === null) continue
        const open = yield* Effect.option(
          Effect.flatMap(found.host.repository(found.path), (repository) => found.host.findChange(repository, row.branch)),
        )
        if (Option.isNone(open) || open.value === null || open.value.state !== 'open') continue
        const pull = open.value
        // One from the change's branch into another base, such as a backport, isn't the change's: named in a line, not taken.
        if ((pull.target ?? row.target) !== row.target) {
          const key = `${pull.url}:other`
          if (saidOf.has(key)) continue
          saidOf.add(key)
          yield* addItem({ projectId: row.projectId, threadId: row.threadId }, 'notice', {
            source: 'runtime',
            severity: 'info',
            title: `${found.host.words.short} ${found.host.words.prefix}${pull.number}, from ${row.branch} into ${pull.target ?? ''}, isn't taken as its change's: attach it if it is.`,
            description: null,
          })
          continue
        }
        // By its number where the task has one repository, as it is that repository's; else by its link.
        const [several] = yield* sql<{ n: number }>`
              SELECT count(DISTINCT binding_id) AS n FROM workspaces WHERE task_id = ${taskId} AND access = 'write' AND reviewing IS NULL`
        yield* attach({ taskId, pullRequest: (several?.n ?? 1) > 1 ? pull.url : `#${pull.number}`, actorId: instance.systemId }).pipe(
          Effect.catchCause((cause) => Effect.logWarning('Could not take a pull request opened from a change’s branch', cause)),
        )
      }
    })

  /** What each open task's lead left waiting, of a project or of all, goes up where their rules push it on its own (ADR-072). */
  const pushNow = (where: { readonly projectId?: string }) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const open = yield* sql<{ taskId: string }>`
            SELECT DISTINCT k.id AS task_id FROM tasks k JOIN external_links l ON l.task_id = k.id AND l.kind = 'change' AND l.listening = 1
            WHERE k.state = 'open' AND (${where.projectId ?? null} IS NULL OR k.project_id = ${where.projectId ?? null})
              AND k.project_id IN (SELECT id FROM projects WHERE archived_at IS NULL)`
      for (const task of open)
        yield* locked(task.taskId)(pushLeft(task.taskId)).pipe(
          Effect.catchCause((cause) => Effect.logWarning('Could not push what a lead left waiting', cause)),
        )
    })

  /**
   * Whether what is on an open pull request's branch here waits for Ship
   * (a task is a conversation plus parts, "A tweak waits for Ship"): its
   * worktree is held for it, and the branch has commits the pull request
   * doesn't, or Althar can't tell. Ship alone sends them up, after its
   * review, and nothing merges the pull request without them unseen:
   * Review and merge, or Merge now, take them.
   */
  const waitsForShip = (taskId: string, link: LinkRow, snapshot: Pick<Snapshot, 'state' | 'url' | 'headSha'>) =>
    Effect.gen(function* () {
      if (snapshot.state !== 'open') return false
      const workspace = yield* worktreeOf(taskId, snapshot.url)
      if (workspace?.heldAt == null || !existsSync(workspace.path)) return false
      const here = yield* aheadOf(workspace.path, null, [yield* sentTo(link.projectId, snapshot.url), snapshot.headSha])
      return here.kind !== 'ahead' || here.count > 0
    })

  /**
   * How each of a task's pull requests stands for its lead's commits
   * (ADR-072), read from the record: going up as its turn ends while its
   * lead is in one, else held where Althar kept why since anything last
   * went up. Null where the rules leave every push to the person; and
   * none for one held for no reason a moment after its lead's last turn
   * ended, as commits made outside a turn, which nothing pushes, the
   * person's to push as where the rules leave it to them (DEV-173).
   * Held for Ship, whatever the rules say and whether its lead is at work
   * or not, Ship alone sends it up, after its review (`pushLeftOn`).
   */
  const pushingOf = (taskId: string) =>
    Effect.gen(function* () {
      const forShip = new Map<string, { readonly held: string; readonly ship: true }>()
      if ((yield* holdsOf(taskId)).length > 0)
        for (const link of yield* linksOf(taskId)) {
          const snapshot = yield* decodeSnapshot(link.snapshot)
          if (yield* waitsForShip(taskId, link, snapshot)) forShip.set(snapshot.url, { held: 'Held for Ship', ship: true })
        }
      if (!(yield* pushesFor(taskId))) return forShip.size === 0 ? null : forShip
      const sql = yield* SqlClient.SqlClient
      const [thread] = yield* sql<{ id: string }>`SELECT id FROM threads WHERE task_id = ${taskId} AND kind = 'task'`
      const lead = thread === undefined ? Option.none() : yield* sessions.running(thread.id)
      const atWork = Option.isSome(lead) && lead.value.turnRunning
      const [turn] =
        atWork || thread === undefined
          ? []
          : yield* sql<{ ended: string | null }>`SELECT max(ended_at) AS ended FROM turn_deliveries WHERE thread_id = ${thread.id}`
      // A card kept from this is worked out again once that moment is over (standsOn.ts).
      const going = atWork || betweenAgents(turn?.ended ?? null, yield* nowFor(turn?.ended ?? null, goingFor), goingFor)
      const shown = new Map<string, { readonly held: string | null; readonly ship?: boolean }>(forShip)
      for (const link of yield* linksOf(taskId)) {
        const snapshot = yield* decodeSnapshot(link.snapshot)
        if (forShip.has(snapshot.url)) continue
        const [held] = atWork
          ? []
          : yield* sql<{ why: string }>`
                  SELECT json_extract(h.payload, '$.why') AS why FROM observations h
                  WHERE h.subject_type = 'external_link' AND h.subject_id = ${link.id} AND h.kind = 'push_held'
                    AND h.observed_at >= coalesce((SELECT max(p.observed_at) FROM observations p WHERE p.subject_type = 'external_link'
                      AND p.subject_id = ${link.id} AND p.kind = 'pushed'), '')
                  ORDER BY h.observed_at DESC, h.rowid DESC LIMIT 1`
        if (held !== undefined) shown.set(snapshot.url, { held: held.why })
        else if (going) shown.set(snapshot.url, { held: null })
      }
      return shown
    })

  return {
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
  }
}
