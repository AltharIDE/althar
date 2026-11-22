import { namedByFindings } from './findingPaths'
import type { ShipRoute } from '@althar/contracts'
import {
  type ActorId,
  type CommandEnvelope,
  Ids,
  type NodeAttemptId,
  type ProjectId,
  newId,
  taskLifecycle,
  transition,
} from '@althar/domain'
import type { Ledger, RevisionConflict, RowNotFound } from '@althar/persistence-sqlite'
import { Cause, type Crypto, Deferred, Duration, Effect, Exit, Option, Queue, Schema, type Scope } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'
import type { Artifacts } from './Artifacts'
import type { Order } from './Busy'
import { touchCard } from './cards'
import type { ChangeSummary, Changes, Published } from './Changes'
import { NotConnected } from './Connections'
import { NoChangeToOpen, NotFound, ShipRefused } from './errors'
import { evidencePaths } from './evidence'
import { unbranched } from './firstWrite'
import { commitOf, commitsAhead, git, gitOutcome, uncommittedFiles } from './git'
import type { Instance, InstanceInfo } from './Instance'
import { makeKeyedLock } from './keyedLock'
import { quickIn } from './kinds'
import type { LeftBehind } from './LeftBehind'
import type { MergeReviews } from './MergeReviews'
import { roundsNow } from './plansAndReviews'
import { reviewedCommit } from './pullRequestReview'
import { nameOf } from './pullRequestWords'
import { change, fact, timestamp } from './records'
import {
  type Lead,
  NEXT_SHIP_EVERY,
  NEXT_SHIP_TRIES,
  NotMergingNow,
  PlanParameters,
  type PlanStep,
  type RoundBack,
  type RoundInput,
  type RoundStart,
  type RunRow,
  type RunStopped,
  SHIPPED_LISTED,
  type ShipOptions,
  type ShipOver,
  type Store,
  type StuckInfo,
  TINY_LINES,
  TaskEnd,
  digestOf,
  farOf,
  roundOf,
  unlessStopped,
} from './runRecords'
import type { Sessions } from './Sessions'
import { type MergeStanding, mergeStandingOf, reviewsBeforeShip, taskShipRoute } from './shipRoute'
import { addItem } from './threads'
import { ToolRefused } from './ToolServer'
import { summarize, words } from './words'

interface RunShippingDependencies {
  readonly admit: (
    run: RunRow,
    key: 'implement' | 'review' | 'settle' | 'publish',
    iteration: number,
    config: unknown,
    input?: unknown,
  ) => Effect.Effect<
    { nodeId: string; attemptId: NodeAttemptId },
    SqlError.SqlError | Schema.SchemaError | RowNotFound | RevisionConflict | RunStopped,
    SqlClient.SqlClient | Crypto.Crypto | Ledger
  >
  readonly asking: (threadId: string) => Effect.Effect<boolean, SqlError.SqlError, SqlClient.SqlClient>
  readonly atWork: (taskId: string) => Effect.Effect<boolean, SqlError.SqlError, SqlClient.SqlClient>
  readonly begin: (
    run: RunRow,
    attemptId: string,
    sessionId: string,
    threadId: string,
    fresh?: boolean,
  ) => Effect.Effect<boolean, SqlError.SqlError | Schema.SchemaError | RowNotFound | RevisionConflict, SqlClient.SqlClient | Ledger>
  readonly changes: Changes['Service']
  readonly conclude: (run: RunRow) => Effect.Effect<void, unknown, SqlClient.SqlClient | Instance | Crypto.Crypto | Ledger>
  readonly currentRun: (taskId: string) => Effect.Effect<RunRow | undefined, SqlError.SqlError, SqlClient.SqlClient>
  readonly ended: (
    run: RunRow,
    attempt: { readonly id: string; readonly nodeId: string },
    state: 'succeeded' | 'failed',
    output: unknown,
  ) => Effect.Effect<void, SqlError.SqlError | Schema.SchemaError | RowNotFound | RevisionConflict, SqlClient.SqlClient | Ledger>
  readonly ends: (
    run: RunRow,
    state: 'succeeded' | 'failed' | 'cancelled',
  ) => Effect.Effect<void, SqlError.SqlError | Schema.SchemaError | RowNotFound | RevisionConflict, SqlClient.SqlClient | Ledger>
  readonly externalEvery: number
  readonly going: (run: RunRow) => Effect.Effect<boolean, SqlError.SqlError, SqlClient.SqlClient>
  readonly instance: InstanceInfo
  readonly keeps: (
    run: RunRow,
    attemptId: string,
    report: unknown,
  ) => Effect.Effect<boolean, SqlError.SqlError | Schema.SchemaError | RowNotFound | RevisionConflict, SqlClient.SqlClient | Ledger>
  readonly leftBehind: LeftBehind['Service']
  readonly mergeReviews: MergeReviews['Service']
  readonly mergeWakes: Map<string, Queue.Queue<void, never>>
  readonly openedOf: (published: Published) => { change: ChangeSummary } | { change?: never }
  readonly pastTurn: (threadId: string, turnId: string, attemptId: string) => Effect.Effect<boolean, SqlError.SqlError, SqlClient.SqlClient>
  readonly policyOf: (projectId: ProjectId) => Effect.Effect<string, SqlError.SqlError | Schema.SchemaError, never>
  readonly provide: <A, E>(effect: Effect.Effect<A, E, Store>) => Effect.Effect<A, E>
  readonly publishedSummary: (published: Published, end: TaskEnd) => string
  readonly publishForStep: (
    run: RunRow,
    attemptId: string,
    input: Parameters<Changes['Service']['publish']>[0],
  ) => Effect.Effect<Published, unknown, SqlClient.SqlClient>
  readonly rest: (taskId: string) => Effect.Effect<void, never, SqlClient.SqlClient>
  readonly RESTED: 'refs/althar/rested/'
  readonly result: (
    run: Pick<RunRow, 'projectId' | 'threadId'>,
    content: Readonly<Record<string, unknown>>,
    id?: string,
  ) => Effect.Effect<string, SqlError.SqlError | Schema.SchemaError, SqlClient.SqlClient | Crypto.Crypto | Ledger>
  readonly review: (
    run: RunRow,
    round: number,
    settled?: string,
    reviewer?: string,
    model?: string | null,
    accountId?: string,
    resumed?: Lead,
    order?: Order,
    effort?: string | null,
  ) => Effect.Effect<
    void | { nodeId: string; attemptId: NodeAttemptId },
    unknown,
    SqlClient.SqlClient | Instance | Crypto.Crypto | Ledger | Artifacts
  >
  readonly scope: Scope.Scope
  readonly sessions: Sessions['Service']
  readonly stepsOf: (run: RunRow) => Effect.Effect<
    {
      implement: PlanStep | undefined
      review: PlanStep | undefined
      end: TaskEnd | null
      here: boolean
      publishes: boolean
      ships: PlanParameters['ships']
    },
    Schema.SchemaError
  >
  readonly stuck: (
    run: RunRow,
    attempt: { readonly id: string } | null,
    asked: StuckInfo,
  ) => Effect.Effect<
    void,
    SqlError.SqlError | Schema.SchemaError | RowNotFound | RevisionConflict,
    SqlClient.SqlClient | Crypto.Crypto | Ledger
  >
  readonly unstuck: (
    run: RunRow,
  ) => Effect.Effect<void, SqlError.SqlError | Schema.SchemaError | RowNotFound | RevisionConflict, SqlClient.SqlClient | Ledger>
}

export const makeRunShipping = (dependencies: RunShippingDependencies) => {
  const {
    admit,
    asking,
    atWork,
    begin,
    changes,
    conclude,
    currentRun,
    ended,
    ends,
    externalEvery,
    going,
    instance,
    keeps,
    leftBehind,
    mergeReviews,
    mergeWakes,
    openedOf,
    pastTurn,
    policyOf,
    provide,
    publishedSummary,
    publishForStep,
    rest,
    RESTED,
    result,
    review,
    scope,
    sessions,
    stepsOf,
    stuck,
    unstuck,
  } = dependencies

  /**
   * The files a fix after the run's last review changed, by repository,
   * where it is tiny (`TINY_LINES` or fewer, each in a file a finding of
   * that review named); null where it isn't, or can't be read: then it is
   * checked. What the fix changed is read against the copy that review
   * read, its uncommitted work and all.
   */
  const tinyFixOf = (run: RunRow) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const [last] = yield* sql<{ id: string }>`
            SELECT a.id FROM node_attempts a JOIN nodes n ON n.id = a.node_id
            WHERE n.execution_id = ${run.executionId} AND n.node_key = 'review' AND a.state = 'succeeded'
            ORDER BY a.ended_at DESC, a.rowid DESC LIMIT 1`
      if (last === undefined) return null
      const named = (yield* sql<{ location: string }>`SELECT location FROM findings WHERE review_attempt_id = ${last.id}`).flatMap(
        (finding) => {
          const file = (JSON.parse(finding.location) as { file?: string | null }).file
          return typeof file === 'string' && file !== '' ? [file.replace(/^\.?\//, '')] : []
        },
      )
      const namedBy = (path: string) => namedByFindings(named, path)
      let lines = 0
      const files: Array<string> = []
      for (const worktree of yield* worktreesOf(run.taskId)) {
        const [read] = yield* sql<{ commitSha: string | null }>`
              SELECT commit_sha FROM workspace_snapshots WHERE workspace_id = ${worktree.id} AND node_attempt_id = ${last.id}
              ORDER BY taken_at DESC, rowid DESC LIMIT 1`
        if (read?.commitSha == null) return null
        // Untracked files do not appear in git diff, so their size and paths are unknown here.
        if ((yield* git(worktree.path, 'ls-files', '--others', '--exclude-standard', '-z')) !== '') return null
        const listed = yield* git(worktree.path, '-c', 'core.quotePath=false', 'diff', '--numstat', read.commitSha)
        for (const line of listed.split('\n').filter((one) => one !== '')) {
          const [added, removed, path] = line.split('\t')
          // A binary file changed says no lines: it isn't tiny.
          if (added === undefined || removed === undefined || path === undefined || added === '-' || removed === '-') return null
          if (!namedBy(path)) return null
          lines += Number(added) + Number(removed)
          files.push(path)
        }
      }
      return files.length > 0 && lines <= TINY_LINES ? { files, lines } : null
    }).pipe(Effect.orElseSucceed(() => null))

  /**
   * What a reviewer is told of a Ship: the person shipped what they and
   * the lead did since the last review, and how to see it in its copy;
   * the commits, by subject, where there are a few.
   */
  const shipToReview = (run: RunRow, from: Readonly<Record<string, string>>) =>
    Effect.gen(function* () {
      // A change's own Ship is reviewed on its own: only its worktree.
      const only = (yield* stepsOf(run)).ships?.only
      const worktrees = (yield* worktreesOf(run.taskId)).filter((one) => only === undefined || only.includes(one.id))
      const parts = yield* Effect.forEach(worktrees, (worktree) =>
        Effect.gen(function* () {
          const head = from[worktree.path] ?? worktree.base ?? ''
          if (head === '') return undefined
          // The task's own commits: what a merge of its base brought along is listed as the merge, not as its work.
          const listed = yield* git(worktree.path, 'log', '--reverse', '--first-parent', '--format=- %s', `${head}..HEAD`).pipe(
            Effect.orElseSucceed(() => ''),
          )
          const lines = listed.split('\n').filter((line) => line !== '')
          const merges = yield* git(worktree.path, 'rev-list', '--merges', '--first-parent', `${head}..HEAD`).pipe(
            Effect.orElseSucceed(() => ''),
          )
          const merged = merges.split('\n').filter((line) => line !== '')
          // Among several changes, each is named, and read on its own: a stacked one from the one below's head.
          return {
            name: worktree.change === null ? worktree.name : `${worktree.change} (${worktree.branch})`,
            head: head.slice(0, 12),
            lines,
            merged,
          }
        }),
      )
      const shown = parts.filter((part) => part !== undefined)
      // A merge of the base branch since: what it brought is the base's, already reviewed there; only how it settled is new.
      const mergedIn = shown.flatMap((one) => one.merged.map((sha) => sha.slice(0, 12)))
      const mergedWords =
        mergedIn.length === 0
          ? ''
          : ` It merged its base branch in since: what that brought isn't the task's work, and \`git diff\` from the last review shows it too. Read how ${mergedIn.length === 1 ? 'the merge' : 'each merge'} settled its conflicts with ${mergedIn.map((sha) => `\`git show --remerge-diff ${sha}\``).join(', ')}.`
      const how =
        shown.length === 1
          ? `with \`git diff ${shown[0]?.head ?? ''}\` in your copy`
          : shown.map((one) => `\n- ${one.name}: \`git diff ${one.head}\``).join('')
      const listed = shown.flatMap((one) => (one.lines.length === 0 || one.lines.length > SHIPPED_LISTED ? [] : one.lines))
      const several = worktrees.length > 1 && worktrees.some((one) => one.change !== null)
      // One change of several, named: the others ship apart, each after its own review.
      const one = only !== undefined && shown.length === 1 ? shown[0]?.name : undefined
      // A review the person added after the work went up: all of the change where none ran before, else what came after.
      if ((yield* stepsOf(run)).ships?.reviewOnly === true) {
        const earlier = worktrees.some((worktree) => from[worktree.path] !== undefined && from[worktree.path] !== worktree.base)
        return earlier
          ? `The person added a review to this change after its work went up. Review what changed since the last review, ${how}. Look at the earlier work only where the new work touches it.${mergedWords}`
          : `The person added a review to this change after its work went up, and none has read it yet. Review all of it, as it stands on its branch now${shown.length === 1 ? `: \`git diff ${shown[0]?.head ?? ''}\` in your copy shows it` : `, change by change:${how}`}.`
      }
      // A change back from prototyping is read whole: no review before it stepped back counts, and none has read it since.
      const sql = yield* SqlClient.SqlClient
      const [plan] = yield* sql<{ since: string | null }>`
            SELECT json_extract(parameters, '$.reviewsFrom') AS since FROM task_plans
            WHERE task_id = ${run.taskId} AND state IN ('proposed', 'accepted') ORDER BY proposed_at DESC LIMIT 1`
      if (plan?.since != null && worktrees.every((worktree) => (from[worktree.path] ?? worktree.base) === worktree.base))
        return `The person ships this change, back from prototyping: they explored designs on its branch and picked a direction, which the lead built. Review all of it, as it stands on its branch now${shown.length === 1 ? `: \`git diff ${shown[0]?.head ?? ''}\` in your copy shows it` : `, change by change:${how}`}. What was only the prototype's (a lab page, a direction switcher, throwaway screens) has no place in it.${several ? ' Each change ships as its own pull request: review each on its own, and say which change each finding is in.' : ''}`
      return `More to review. The person ships ${one === undefined ? 'what they and the lead did since the last review' : `${one}, one of the task’s changes: what they and the lead did on it since its last review`}${listed.length === 0 ? '' : `:\n\n${listed.join('\n')}`}\n\nReview what changed since, ${how}. Look at the earlier work only where the new work touches it.${mergedWords}${several ? ' Each change ships as its own pull request: review each on its own, and say which change each finding is in.' : ''}`
    })

  /**
   * Where each of the task's worktrees stood when its last review read it,
   * by path: the branch's head under the copy that review read. A worktree
   * never reviewed, or whose branch no longer has that commit, from where
   * it started, so all of it is read.
   */
  const reviewMarksOf = (taskId: string) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const marks: Record<string, string> = {}
      // A review stopped before it read anything read nothing; and a change back from prototyping is read whole, from where it
      // started, so no review from before it stepped back counts.
      const [plan] = yield* sql<{ since: string | null }>`
            SELECT json_extract(parameters, '$.reviewsFrom') AS since FROM task_plans
            WHERE task_id = ${taskId} AND state IN ('proposed', 'accepted') ORDER BY proposed_at DESC LIMIT 1`
      const since = plan?.since ?? null
      for (const worktree of yield* worktreesOf(taskId)) {
        const [last] = yield* sql<{ commitSha: string | null }>`
              SELECT s.commit_sha FROM workspace_snapshots s JOIN node_attempts a ON a.id = s.node_attempt_id
              JOIN nodes n ON n.id = a.node_id
              WHERE s.workspace_id = ${worktree.id} AND n.node_key = 'review' AND s.commit_sha IS NOT NULL
                AND a.state NOT IN ('cancelled', 'failed') AND (${since} IS NULL OR s.taken_at > ${since})
              ORDER BY s.taken_at DESC, s.rowid DESC LIMIT 1`
        const read =
          last?.commitSha == null
            ? null
            : ((yield* onBranchAs(worktree.path, last.commitSha, worktree.base)) ??
              (yield* rewrittenAs(worktree.id, worktree.path, last.commitSha)))
        const from = read ?? worktree.base
        if (from !== null) marks[worktree.path] = from
      }
      return marks
    })

  /**
   * Where what a review read went when its branch was moved onto another
   * to work toward (a task is a conversation plus parts): the commit it
   * matched, by its tree, rebased or cherry-picked, as each move kept it,
   * where the branch has that copy. Null where none does.
   */
  const rewrittenAs = (workspaceId: string, path: string, snapshot: string) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const moves = yield* sql<{ rewritten: string | null }>`
            SELECT json_extract(payload, '$.rewritten') AS rewritten FROM record_events
            WHERE aggregate_type = 'workspace' AND aggregate_id = ${workspaceId} AND type = 'workspace.toward_set'
              AND json_extract(payload, '$.rewritten') IS NOT NULL
            ORDER BY rowid`
      if (moves.length === 0) return null
      const tree = yield* git(path, 'rev-parse', `${snapshot}^{tree}`)
      let at: string | null = null
      for (const move of moves) {
        const rewritten = JSON.parse(move.rewritten ?? '{}') as Record<string, string>
        if (at !== null) at = rewritten[at] ?? null
        else
          for (const old of Object.keys(rewritten))
            if ((yield* git(path, 'rev-parse', `${old}^{tree}`).pipe(Effect.orElseSucceed(() => ''))) === tree) at = rewritten[old] ?? null
      }
      if (at === null) return null
      return (yield* gitOutcome(path, 'merge-base', '--is-ancestor', at, 'HEAD')).code === 0 ? at : null
    }).pipe(Effect.orElseSucceed(() => null))

  /**
   * The newest commit on the branch here that holds what a review's
   * snapshot read, by its tree: its own parent where the branch still has
   * it, or the commit with the same tree that pushing it rewrote it as
   * (its credit, a rebase). Null where none does, as where the review
   * read changes not committed since.
   */
  const onBranchAs = (path: string, snapshot: string, base: string | null) =>
    Effect.gen(function* () {
      const tree = yield* git(path, 'rev-parse', `${snapshot}^{tree}`)
      const listed = yield* git(path, 'log', '--format=%H %T', base === null ? 'HEAD' : `${base}..HEAD`)
      return (
        listed
          .split('\n')
          .map((line) => line.split(' '))
          .find(([, other]) => other === tree)?.[0] ?? null
      )
    }).pipe(Effect.orElseSucceed(() => null))

  /** The task's worktrees here, one per repository it changes, the project's first first. */
  const worktreesOf = (taskId: string) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      // Each change's own: a change whose folder another took (away) has none, and a pull request the task reviews isn't its work.
      return yield* sql<{
        id: string
        path: string
        branch: string
        name: string
        slug: string
        base: string | null
        change: string | null
      }>`
            SELECT w.id, w.path, w.branch, b.display_name AS name, b.slug, coalesce(w.base_commit, w.base_ref) AS base, w.name AS change
            FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id
            WHERE w.task_id = ${taskId} AND w.device_id = ${instance.deviceId} AND w.state <> 'away' AND w.reviewing IS NULL
            ORDER BY b.created_at, b.rowid, w.created_at, w.rowid`
    })

  /** The committed endpoints deliberately admitted to this Ship, before any host request. */
  const shipHeads = (taskId: string, only?: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      const heads: Record<string, string> = {}
      for (const workspace of yield* worktreesOf(taskId)) {
        if (only !== undefined && !only.includes(workspace.id)) continue
        heads[workspace.id] = yield* commitOf(workspace.path, 'HEAD')
      }
      return heads
    })

  /** Read the stored parameters: parts and accepted endpoints may have changed since this run was admitted. */
  const parametersNow = (run: RunRow) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const [stored] = yield* sql<{ parameters: string }>`SELECT parameters FROM runs WHERE id = ${run.runId}`
      return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(PlanParameters))(stored?.parameters ?? run.parameters)
    })

  /** Accept deliberate lead fixes without another check. Keep the decision before publication, including across restart. */
  const acceptShipWork = (run: RunRow) =>
    Effect.gen(function* () {
      const ships = (yield* parametersNow(run)).ships
      if (ships === undefined) return
      const heads = yield* shipHeads(run.taskId, ships.heads === undefined ? ships.only : Object.keys(ships.heads))
      const sql = yield* SqlClient.SqlClient
      yield* sql`UPDATE runs SET parameters = json_remove(json_set(parameters, '$.ships.heads', json(${JSON.stringify(heads)})), '$.ships.snapshots'), revision = revision + 1 WHERE id = ${run.runId}`
    })

  /** Resolve exactly what the last review read, then persist that committed boundary once. Never widen a retry to HEAD. */
  const acceptedShip = (run: RunRow) =>
    Effect.gen(function* () {
      const parameters = yield* parametersNow(run)
      const ships = parameters.ships
      if (ships === undefined) return undefined
      const sql = yield* SqlClient.SqlClient
      let snapshots = ships.snapshots
      // Older interrupted Ships have no explicit map. A saved review copy can recover its boundary; no saved decision cannot.
      if (ships.heads === undefined && snapshots === undefined) {
        const saved = yield* sql<{ workspaceId: string; commitSha: string }>`
              SELECT s.workspace_id, s.commit_sha FROM workspace_snapshots s JOIN node_attempts a ON a.id = s.node_attempt_id
              JOIN nodes n ON n.id = a.node_id WHERE n.execution_id = ${run.executionId} AND n.node_key = 'review'
                AND a.state = 'succeeded' ORDER BY s.taken_at, s.rowid`
        if (saved.length > 0) snapshots = Object.fromEntries(saved.map((one) => [one.workspaceId, one.commitSha]))
      }
      if (ships.heads === undefined && snapshots === undefined)
        return yield* new ToolRefused({
          message: 'This interrupted Ship saved no accepted code boundary. Its work stays held; start a fresh Ship to review it.',
        })
      const heads = { ...ships.heads }
      for (const workspace of yield* worktreesOf(run.taskId)) {
        const snapshot = snapshots?.[workspace.id]
        if (snapshot === undefined) continue
        const head = yield* reviewedCommit(workspace.path, snapshot, yield* commitOf(workspace.path, 'HEAD'))
        if (head === null)
          return yield* new ToolRefused({
            message: 'The reviewed files have no matching commit on the task branch. Commit that reviewed work before retrying Ship.',
          })
        heads[workspace.id] = head
      }
      if (snapshots !== undefined)
        yield* sql`UPDATE runs SET parameters = json_remove(json_set(parameters, '$.ships.heads', json(${JSON.stringify(heads)})), '$.ships.snapshots'), revision = revision + 1 WHERE id = ${run.runId}`
      return { ...ships, heads, snapshots: undefined }
    })

  /** What the task's worktrees hold, together: it changes when any of them does. */
  const digestAll = (taskId: string) =>
    Effect.map(
      Effect.flatMap(worktreesOf(taskId), (worktrees) => Effect.forEach(worktrees, (worktree) => digestOf(worktree.path))),
      (digests) => digests.join(' '),
    )

  /* ---- Rounds of work after a task's plan (ADR-034) ---- */

  /** Where a round of work starts: each of the task's worktrees' head, what they hold, and what they haven't committed. */
  const startOf = (taskId: string) =>
    Effect.gen(function* () {
      const heads: Record<string, string> = {}
      const uncommitted: Record<string, ReadonlyArray<string>> = {}
      for (const worktree of yield* worktreesOf(taskId)) {
        heads[worktree.path] = yield* commitOf(worktree.path, 'HEAD').pipe(Effect.orElseSucceed(() => ''))
        uncommitted[worktree.path] = yield* uncommittedFiles(worktree.path).pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []))
      }
      return { heads, uncommitted, digest: yield* digestAll(taskId) } satisfies RoundStart
    })

  /**
   * Where a task stood once its last run of work was over, for a round its
   * lead's report opens after the work is done (ADR-034): in each
   * worktree, the nearest its head of where it was as that run ended
   * (kept by `rest`), what its pull request was last sent, and what its
   * last review read. Where none of them is on its branch, as for a run
   * that ended before Althar kept that, from where its branch started:
   * everything counts as the round's, so nothing goes unreviewed. What it
   * hadn't committed counts as there already.
   */
  const restedOf = (taskId: string) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const now = yield* startOf(taskId)
      const heads: Record<string, string> = {}
      for (const worktree of yield* worktreesOf(taskId)) {
        const [known] = yield* sql<{ sent: string | null; reviewed: string | null }>`
              SELECT (SELECT head_commit FROM repository_changes WHERE workspace_id = ${worktree.id} AND head_commit IS NOT NULL
                  ORDER BY updated_at DESC, rowid DESC LIMIT 1) AS sent,
                (SELECT commit_sha FROM workspace_snapshots WHERE workspace_id = ${worktree.id}
                  ORDER BY taken_at DESC, rowid DESC LIMIT 1) AS reviewed`
        let nearest: { readonly commit: string; readonly after: number } | undefined
        for (const candidate of [`${RESTED}${worktree.id}`, known?.sent ?? null, known?.reviewed == null ? null : `${known.reviewed}^`]) {
          if (candidate === null) continue
          const commit = yield* commitOf(worktree.path, candidate).pipe(Effect.orElseSucceed(() => ''))
          if (commit === '' || !(yield* isOnHead(worktree.path, commit))) continue
          const after = yield* commitsAhead(worktree.path, commit).pipe(Effect.orElseSucceed(() => Number.POSITIVE_INFINITY))
          if (nearest === undefined || after < nearest.after) nearest = { commit, after }
        }
        heads[worktree.path] = nearest?.commit ?? worktree.base ?? ''
      }
      return { heads, uncommitted: now.uncommitted, digest: '' } satisfies RoundStart
    })

  /**
   * Where a quick task made a change counts its round's work from: where
   * each of its worktrees started, with nothing taken as there already, so
   * everything its lead did, committed or not, is the round's, reviewed and
   * in its pull request.
   */
  const fromItsStart = (taskId: string) =>
    Effect.gen(function* () {
      const heads: Record<string, string> = {}
      const uncommitted: Record<string, ReadonlyArray<string>> = {}
      for (const worktree of yield* worktreesOf(taskId)) {
        heads[worktree.path] = yield* commitOf(worktree.path, worktree.base ?? 'HEAD').pipe(Effect.orElseSucceed(() => ''))
        uncommitted[worktree.path] = []
      }
      return { heads, uncommitted, digest: '' } satisfies RoundStart
    })

  /** Whether a commit is the worktree's head or behind it. */
  const isOnHead = (path: string, commit: string) =>
    Effect.match(git(path, 'merge-base', '--is-ancestor', commit, 'HEAD'), { onFailure: () => false, onSuccess: () => true })

  /**
   * Whether a round made new work since it started: new commits in any of
   * the task's repositories, or changes left uncommitted that weren't
   * there then and aren't evidence the lead handed.
   */
  const madeSince = (taskId: string, start: RoundStart) =>
    Effect.gen(function* () {
      const now = yield* startOf(taskId)
      if (Object.entries(now.heads).some(([path, head]) => start.heads[path] !== head)) return true
      if (now.digest === start.digest) return false
      const pictures = yield* evidencePaths(taskId)
      // What each worktree held then and now are trees: the files that differ between them, whether or not they had
      // changes before. Where the start kept none, as a round the lead's report opens, the files changed that weren't then.
      const then = start.digest.split(' ')
      const held = now.digest.split(' ')
      const worktrees = yield* worktreesOf(taskId)
      for (const [index, worktree] of worktrees.entries()) {
        const from = then[index] ?? ''
        const to = held[index] ?? ''
        if (from === to && from !== '') continue
        const differ =
          from === '' || to === '' || then.length !== held.length
            ? undefined
            : yield* git(worktree.path, '-c', 'core.quotePath=false', 'diff', '--name-only', from, to).pipe(
                Effect.map((listed) => listed.split('\n').filter((file) => file !== '')),
                Effect.orElseSucceed(() => undefined),
              )
        const files =
          differ ?? (now.uncommitted[worktree.path] ?? []).filter((file) => !(start.uncommitted[worktree.path] ?? []).includes(file))
        if (files.some((file) => !pictures(worktree.path, file))) return true
      }
      return false
    })

  /* One round opens at a time on a task: the person's turn and its lead's finish_step don't open two. */
  const roundLocks = makeKeyedLock()

  const oneRound = roundLocks.withLock

  /**
   * Opens the round a quick task is made a change in, once its latest run
   * is over (ADR-034), the one round that opens now that talking to a lead
   * is a turn: a run of its own, with no plan, whose steps and ending are
   * the plan's run's, publishing as it would, and its Implement step under
   * way at once on the lead's session, which is at work already in its
   * turn. All the quick task did counts as the round's. A merged task
   * opens again for it. None while a run runs or is stopped, the task is
   * a draft or abandoned, its project removed, or a conflict round is
   * under way, which is its own course. The round's run and its attempt,
   * or undefined where none opened.
   */
  const openRound = (taskId: string, sessionId: string) =>
    oneRound(
      taskId,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const [last] = yield* sql<{ id: string; state: string; workflowVersionId: string; parameters: string; createdAt: string }>`
              SELECT id, state, workflow_version_id, parameters, created_at FROM runs WHERE task_id = ${taskId}
              ORDER BY created_at DESC, rowid DESC LIMIT 1`
        if (last === undefined || (last.state !== 'succeeded' && last.state !== 'failed' && last.state !== 'cancelled')) return undefined
        const ended: RoundBack['ended'] = last.state
        const [task] = yield* sql<{
          state: string
          settledAt: string | null
          projectId: ProjectId
          archived: string | null
          rounds: number
        }>`
              SELECT k.state, k.settled_at, k.project_id, p.archived_at AS archived,
                (SELECT count(*) FROM conflict_resolutions c WHERE c.task_id = k.id AND c.state IN ('resolving', 'checking')) AS rounds
              FROM tasks k JOIN projects p ON p.id = k.project_id WHERE k.id = ${taskId}`
        if (task === undefined || task.archived !== null || task.rounds > 0 || (task.state !== 'open' && task.state !== 'done'))
          return undefined
        const was: RoundBack['state'] = task.state
        // Its steps and ending are the plan's: a reviewed task's round has a review, whatever the last round skipped. It publishes
        // as its plan's run would, as the person asked.
        const [planned] = yield* sql<{ parameters: string }>`
              SELECT p.parameters FROM task_plans p JOIN runs r ON r.plan_id = p.id
              WHERE r.task_id = ${taskId} ORDER BY r.created_at, r.rowid LIMIT 1`
        const parameters = JSON.stringify({ ...(JSON.parse(planned?.parameters ?? last.parameters) as object), publishes: true })
        const implement = (yield* Schema.decodeUnknownEffect(Schema.fromJsonString(PlanParameters))(parameters)).steps.find(
          (step) => step.key === 'implement',
        )
        if (implement === undefined) return undefined
        // Only for its lead, on the task's own thread.
        const [lead] = yield* sql<{ id: string }>`
              SELECT s.id FROM provider_sessions s JOIN threads t ON t.id = s.thread_id
              WHERE s.id = ${sessionId} AND t.task_id = ${taskId} AND t.kind = 'task'`
        if (lead === undefined) return undefined
        const start = yield* fromItsStart(taskId)
        const policyId = yield* policyOf(task.projectId)
        const runId = yield* newId(Ids.run)
        const opened = yield* sql.withTransaction(
          Effect.gen(function* () {
            // Read again where it is written: another run, or the task moving meanwhile, opens none.
            const [still] = yield* sql<{ id: string }>`
                  SELECT id FROM runs WHERE task_id = ${taskId} ORDER BY created_at DESC, rowid DESC LIMIT 1`
            const [now] = yield* sql<{ state: string }>`SELECT state FROM tasks WHERE id = ${taskId}`
            if (still?.id !== last.id || now?.state !== was) return false
            const at = yield* timestamp
            if (was === 'done') {
              const state = yield* transition(taskLifecycle, 'done', 'open')
              const revision = yield* change('tasks', taskId, { state, settledAt: null })
              yield* fact({
                projectId: task.projectId,
                aggregateType: 'task',
                aggregateId: taskId,
                revision,
                type: 'task.reopened',
                payload: { round: runId },
                actorId: instance.systemId,
              })
            }
            const executionId = yield* newId(Ids.workflowExecution)
            yield* sql`INSERT INTO runs ${sql.insert({
              id: runId,
              projectId: task.projectId,
              taskId,
              planId: null,
              workflowVersionId: last.workflowVersionId,
              policyId,
              parameters,
              state: 'running',
              createdAt: at,
            })}`
            yield* sql`INSERT INTO run_attempts ${sql.insert({
              id: yield* newId(Ids.runAttempt),
              projectId: task.projectId,
              runId,
              attemptNumber: 1,
              deviceId: instance.deviceId,
              controllerGeneration: 1,
              controllerInstanceId: instance.id,
              state: 'active',
              startedAt: at,
            })}`
            yield* sql`INSERT INTO workflow_executions ${sql.insert({
              id: executionId,
              projectId: task.projectId,
              runId,
              workflowVersionId: last.workflowVersionId,
              graphRevision: 1,
              state: 'running',
              createdAt: at,
            })}`
            const steps = (yield* Schema.decodeUnknownEffect(Schema.fromJsonString(PlanParameters))(parameters)).steps
            yield* sql`INSERT INTO execution_graph_revisions ${sql.insert({
              projectId: task.projectId,
              executionId,
              revision: 1,
              graph: JSON.stringify({
                steps: steps.filter((step) => !step.skipped),
                review: { rounds: yield* roundsNow },
                round: true,
              }),
              cause: 'materialized',
              createdAt: at,
            })}`
            yield* fact({
              projectId: task.projectId,
              aggregateType: 'run',
              aggregateId: runId,
              revision: 1,
              type: 'run.admitted',
              payload: { round: true, after: last.id },
              actorId: instance.systemId,
            })
            return true
          }),
        )
        if (!opened) return undefined
        const current = yield* currentRun(taskId)
        if (current === undefined) return undefined
        const input: RoundInput = { round: { state: was, settledAt: task.settledAt, ended }, start }
        const admitted = yield* unlessStopped(sql.withTransaction(admit(current, 'implement', 0, implement, input)))
        if (admitted === undefined) return undefined
        yield* begin(current, admitted.attemptId, sessionId, current.threadId)
        yield* touchCard(taskId)
        return { run: current, ...admitted }
      }),
    )

  /**
   * Ships what waits on the task's branch, on the person's word (a task is
   * a conversation plus parts, "A tweak waits for Ship"): a run of its own,
   * with no Implement step. Where the plan has a reviewer before the work
   * ships, its review runs first, one pass over everything since the last
   * review, which the lead settles, as any round of review; then its
   * ending sends the commits up, past the hold (`conclude`). With no
   * reviewer, or one after the merge, it goes up at once. Refused while
   * the task is at work, which ships once that's done, and where nothing
   * waits. The run: once its review has started, or, with none, once what
   * waited is up or couldn't go. Given `admitted`, it says so there as soon
   * as its run is admitted and its card shows it, for the person's press,
   * which waits on nothing after: neither the reviewer starting nor the host.
   * It goes by its route (`ShipOptions.route`), else the task's own.
   */
  const ship = (taskId: string, actorId: ActorId, options: ShipOptions = {}) => {
    const { onlyChange, queued, admitted } = options
    const reviewOnly = options.reviewOnly === true
    const openDraft = options.openDraft === true
    const acceptStopped = options.acceptStopped === true
    return oneRound(
      taskId,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const [task] = yield* sql<{ state: string; projectId: ProjectId; archived: string | null; threadId: string }>`
              SELECT k.state, k.project_id, p.archived_at AS archived, t.id AS thread_id
              FROM tasks k JOIN projects p ON p.id = k.project_id JOIN threads t ON t.task_id = k.id AND t.kind = 'task'
              WHERE k.id = ${taskId}`
        if (task === undefined || task.archived !== null) return yield* new NotFound({ kind: 'task', id: taskId })
        if (task.state !== 'open' && task.state !== 'done') return yield* new ShipRefused({ taskId, why: 'nothing' })
        const [last] = yield* sql<{ id: string; state: string; workflowVersionId: string; parameters: string }>`
              SELECT id, state, workflow_version_id, parameters FROM runs WHERE task_id = ${taskId}
              ORDER BY created_at DESC, rowid DESC LIMIT 1`
        if (last === undefined) return yield* new ShipRefused({ taskId, why: 'nothing' })
        // A fresh explicit press may accept the committed work of a stopped workflow, without resuming Implement.
        // Deferred requests and automatic follow-ons keep Stop intact. A new person message, a claimed turn or a host
        // publication is work still on its way, even before the session's turnRunning flag is set. Once publishing was
        // admitted, cancellation cannot prove its host call ended: the original run must be reconciled or retried.
        const stoppedPredecessor = Effect.gen(function* () {
          if (!acceptStopped) return false
          const [still] = yield* sql<{ state: string; turnState: string | null; errorClass: string | null; endedAt: string | null }>`
                SELECT r.state, d.state AS turn_state, d.error_class, d.ended_at FROM runs r
                LEFT JOIN turn_deliveries d ON d.id = (SELECT id FROM turn_deliveries WHERE thread_id = ${task.threadId}
                  ORDER BY requested_at DESC, rowid DESC LIMIT 1)
                WHERE r.id = ${last.id} AND r.id = (SELECT id FROM runs WHERE task_id = ${taskId} ORDER BY created_at DESC, rowid DESC LIMIT 1)`
          if (still?.state !== last.state) return false
          if (still.state !== 'suspended' && (still.turnState !== 'interrupted' || still.errorClass !== null)) return false
          if (still.turnState !== null && still.endedAt === null) return false
          const [waiting] = yield* sql<{ one: number }>`
                SELECT 1 AS one FROM threads h WHERE h.task_id = ${taskId} AND (
                  EXISTS (SELECT 1 FROM user_inputs i JOIN actors a ON a.id = i.author_actor_id
                    WHERE i.thread_id = h.id AND i.state = 'queued' AND a.kind = 'person')
                  OR EXISTS (SELECT 1 FROM turn_deliveries d WHERE d.thread_id = h.id
                    AND d.state IN ('pending', 'delivered') AND d.ended_at IS NULL))
                UNION ALL SELECT 1 AS one FROM node_attempts a JOIN nodes n ON n.id = a.node_id
                  JOIN workflow_executions e ON e.id = n.execution_id WHERE e.run_id = ${last.id}
                    AND n.node_key = 'publish' LIMIT 1`
          return waiting === undefined
        })
        const replacing = (last.state === 'running' || last.state === 'suspended') && (yield* stoppedPredecessor)
        const busyNow = yield* sessions.busy(task.threadId)
        if (((last.state === 'running' || last.state === 'suspended') && !replacing) || busyNow || (yield* atWork(taskId)))
          return yield* new ShipRefused({ taskId, why: 'working' })
        if (yield* unbranched(taskId)) return yield* new ShipRefused({ taskId, why: 'nothing' })
        const held = yield* changes.holds(taskId)
        const unpushed = (yield* changes.aheadOfOpen(taskId)).length > 0
        const after = yield* changes.unshipped(taskId)
        // A review added after the work went up reads the branch as it stands, whatever still waits for Ship: it is never left
        // unread for want of a push, and what waits is reviewed with the rest.
        if (!reviewOnly && held.length === 0 && !unpushed && after.length === 0) return yield* new ShipRefused({ taskId, why: 'nothing' })
        // Its route: the person's for this Ship, else the task's own, as its card offers it. A review added after the work
        // went up sends nothing, so it has none.
        const route = reviewOnly ? undefined : (options.route ?? (yield* taskShipRoute(changes, taskId)).route)
        // What waits only brings the base branch in, as a merge of main that settled no conflict: none of it is the task's
        // work, so it goes up as it is, with no review and no round, and the task stays where it was. A review the person
        // added still runs. As far as its route goes: an open draft marked ready, then merged.
        // Not while it is kept on its branch with its pull request left as it is (stepped back into prototyping): its Ship
        // sends nothing there, nor marks it ready or merges it.
        if (
          !reviewOnly &&
          after.length === 0 &&
          onlyChange === undefined &&
          queued === undefined &&
          !(yield* changes.keptOpen(taskId)) &&
          (yield* changes.onlyBaseWaits(taskId))
        ) {
          yield* changes.sendBaseOnly(taskId)
          if (route !== undefined && route.far !== 'push')
            for (const one of yield* changes.ofTask(taskId)) {
              if (one.state !== 'open') continue
              if (route.far === 'merge') yield* changes.mergeAsItStands(taskId, one.url)
              else if (one.draft) yield* changes.markReady(taskId, one.url)
            }
          return undefined
        }
        // Several changes: each ships on its own, with its own review, the bottom of a stack first; one named, with what waits
        // beneath it. One change ships whole, as it always did.
        // A change is its workspaces of one name, one in each repository it changes: counted and shipped as one.
        const [several] = yield* sql<{ n: number }>`
              SELECT count(DISTINCT coalesce(name, '')) AS n FROM workspaces
              WHERE task_id = ${taskId} AND access = 'write' AND reviewing IS NULL AND state = 'ready'`
        const apart = !reviewOnly && ((several?.n ?? 0) > 1 || onlyChange !== undefined)
        const groups: ReadonlyArray<ReadonlyArray<string>> =
          queued !== undefined
            ? queued.map((group) => group.split(','))
            : apart
              ? [
                  ...(yield* changes.waitingChanges(taskId, onlyChange))
                    .reduce(
                      (byName, one) => byName.set(one.name ?? '', [...(byName.get(one.name ?? '') ?? []), one.id]),
                      new Map<string, Array<string>>(),
                    )
                    .values(),
                ]
              : []
        if (apart && groups.length === 0) return yield* new ShipRefused({ taskId, why: 'nothing' })
        const [first, ...rest] = groups
        // Its steps and ending are the plan's: Checked by is the plan's reviewer, unless it reads only once the work merged.
        const [planned] = yield* sql<{ parameters: string }>`
              SELECT p.parameters FROM task_plans p JOIN runs r ON r.plan_id = p.id
              WHERE r.task_id = ${taskId} ORDER BY r.created_at, r.rowid LIMIT 1`
        const plan = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(PlanParameters))(planned?.parameters ?? last.parameters)
        const marks = yield* reviewMarksOf(taskId)
        // Its own review reads only the change it ships, from where that change's last review left off.
        const shipping =
          first === undefined
            ? undefined
            : (yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE id IN ${sql.in(first)}`).map((one) => one.path)
        const from = shipping === undefined ? marks : Object.fromEntries(Object.entries(marks).filter(([path]) => shipping.includes(path)))
        // Its review runs where its route says and its plan has one before the work ships: off, its review steps are
        // skipped from the start, as a reviewer after the merge skips them, and it goes up at once, with nothing owed after.
        const kept = route === undefined ? undefined : { review: route.review && reviewsBeforeShip(plan), far: route.far }
        const parameters: PlanParameters = {
          ...plan,
          ...(openDraft ? { end: 'draft' as const } : {}),
          steps: plan.steps.map((step) =>
            step.key === 'implement' || (step.key === 'review' && (plan.reviewAfterMerge === true || (kept !== undefined && !kept.review)))
              ? { ...step, skipped: true }
              : step,
          ),
          ships: {
            from,
            ...(openDraft ? { openDraft: true } : {}),
            heads: yield* shipHeads(taskId, first),
            ...(reviewOnly ? { reviewOnly: true } : {}),
            ...(kept === undefined ? {} : { route: kept }),
            ...(first === undefined ? {} : { only: [...first], next: rest.map((group) => group.join(',')) }),
          },
        }
        const encoded = JSON.stringify(parameters)
        const policyId = yield* policyOf(task.projectId)
        const runId = yield* newId(Ids.run)
        yield* sql.withTransaction(
          Effect.gen(function* () {
            const at = yield* timestamp
            const executionId = yield* newId(Ids.workflowExecution)
            if (replacing) {
              // Recheck after reading git and pinning the boundary. Retiring the predecessor and admitting this Ship are
              // one durable write: restart can resume neither an old implementation nor a half-admitted replacement.
              if (!(yield* stoppedPredecessor) || (yield* sessions.busy(task.threadId)) || (yield* atWork(taskId)))
                return yield* new ShipRefused({ taskId, why: 'working' })
              const attempts = yield* sql<{ id: string; nodeId: string; output: string | null }>`
                    SELECT a.id, a.node_id, a.output FROM node_attempts a JOIN nodes n ON n.id = a.node_id
                    JOIN workflow_executions e ON e.id = n.execution_id WHERE e.run_id = ${last.id}
                      AND a.state NOT IN ('succeeded', 'failed', 'cancelled', 'superseded')`
              for (const attempt of attempts) {
                const revision = yield* change('node_attempts', attempt.id, {
                  state: 'cancelled',
                  holdReason: null,
                  output: JSON.stringify({ ...(JSON.parse(attempt.output ?? '{}') as object), stopped: true, replacedByShip: runId }),
                  endedAt: at,
                })
                yield* change('nodes', attempt.nodeId, { state: 'cancelled' })
                yield* fact({
                  projectId: task.projectId,
                  aggregateType: 'node_attempt',
                  aggregateId: attempt.id,
                  revision,
                  type: 'node_attempt.cancelled',
                  payload: { stopped: true, replacedByShip: runId },
                  actorId,
                })
              }
              const calls = yield* sql<{ id: string }>`SELECT id FROM attention_requests WHERE task_id = ${taskId}
                    AND state = 'open' AND node_attempt_id IN (SELECT a.id FROM node_attempts a JOIN nodes n ON n.id = a.node_id
                      JOIN workflow_executions e ON e.id = n.execution_id WHERE e.run_id = ${last.id})`
              for (const call of calls) {
                const revision = yield* change('attention_requests', call.id, { state: 'withdrawn' })
                yield* fact({
                  projectId: task.projectId,
                  aggregateType: 'attention_request',
                  aggregateId: call.id,
                  revision,
                  type: 'attention_request.withdrawn',
                  payload: { replacedByShip: runId },
                  actorId,
                })
              }
              const active = yield* sql<{ id: string }>`SELECT id FROM run_attempts WHERE run_id = ${last.id} AND state = 'active'`
              for (const attempt of active) yield* change('run_attempts', attempt.id, { state: 'interrupted', endedAt: at })
              const executions = yield* sql<{ id: string }>`SELECT id FROM workflow_executions WHERE run_id = ${last.id}`
              for (const execution of executions) yield* change('workflow_executions', execution.id, { state: 'cancelled', endedAt: at })
              const revision = yield* change('runs', last.id, { state: 'cancelled', endedAt: at })
              yield* fact({
                projectId: task.projectId,
                aggregateType: 'run',
                aggregateId: last.id,
                revision,
                type: 'run.cancelled',
                payload: { replacedByShip: runId },
                actorId,
              })
            }
            yield* sql`INSERT INTO runs ${sql.insert({
              id: runId,
              projectId: task.projectId,
              taskId,
              planId: null,
              workflowVersionId: last.workflowVersionId,
              policyId,
              parameters: encoded,
              state: 'running',
              createdAt: at,
            })}`
            yield* sql`INSERT INTO run_attempts ${sql.insert({
              id: yield* newId(Ids.runAttempt),
              projectId: task.projectId,
              runId,
              attemptNumber: 1,
              deviceId: instance.deviceId,
              controllerGeneration: 1,
              controllerInstanceId: instance.id,
              state: 'active',
              startedAt: at,
            })}`
            yield* sql`INSERT INTO workflow_executions ${sql.insert({
              id: executionId,
              projectId: task.projectId,
              runId,
              workflowVersionId: last.workflowVersionId,
              graphRevision: 1,
              state: 'running',
              createdAt: at,
            })}`
            yield* sql`INSERT INTO execution_graph_revisions ${sql.insert({
              projectId: task.projectId,
              executionId,
              revision: 1,
              graph: JSON.stringify({ steps: parameters.steps.filter((step) => !step.skipped), round: true, ships: true }),
              cause: 'materialized',
              createdAt: at,
            })}`
            yield* fact({
              projectId: task.projectId,
              aggregateType: 'run',
              aggregateId: runId,
              revision: 1,
              type: 'run.admitted',
              payload: { round: true, ships: true, after: last.id },
              actorId,
            })
          }),
        )
        const current = yield* currentRun(taskId)
        if (current === undefined) return undefined
        yield* touchCard(taskId)
        // The press has its answer: what follows shows on the task as it goes.
        if (admitted !== undefined) yield* Deferred.succeed(admitted, undefined)
        const { review: reviewer } = yield* stepsOf(current)
        // Nothing to read, or no one to read it before it ships: it goes up at once.
        if (reviewer === undefined || (yield* changes.nothingBuilt(taskId).pipe(Effect.orElseSucceed(() => false))))
          yield* conclude(current)
        else yield* review(current, 0)
        return current
      }),
    )
  }

  // Once the Ship before it is over and nothing of the task is at work (its reviewer's turn closing, its lead told what went up).
  const shipNext = (taskId: string, route: ShipRoute | undefined, queued: ReadonlyArray<string>, openDraft?: boolean) =>
    Effect.asVoid(
      Effect.forkIn(
        provide(
          Effect.catchCause(
            Effect.gen(function* () {
              for (let tries = 0; ; tries += 1) {
                const sent = yield* Effect.exit(
                  ship(taskId, instance.systemId, {
                    ...(route === undefined ? {} : { route }),
                    queued,
                    ...(openDraft === true ? { openDraft } : {}),
                  }),
                )
                if (sent._tag === 'Success') return
                const error = Cause.findErrorOption(sent.cause)
                const working = Option.isSome(error) && error.value instanceof ShipRefused && error.value.why === 'working'
                if (!working || tries >= NEXT_SHIP_TRIES) return yield* Effect.failCause(sent.cause)
                yield* Effect.sleep(NEXT_SHIP_EVERY)
              }
            }),
            (cause) => Effect.logWarning('Could not ship the next change', cause),
          ),
        ),
        scope,
      ),
    )

  /**
   * A Ship's ending, once its review is settled, or at once with none:
   * each open pull request takes what waits for it; where the last merged
   * or closed with commits after it, the next opens, and where there was
   * none, the first, as the plan ends (a draft, where it ends on its
   * branch). The holds go once it's up. One that can't go needs the
   * person, as a plan's ending does. Then as far as its route goes: a new
   * pull request opens a draft for a push and ready for the rest (one that
   * ends on its branch opens none), an open draft is marked ready, and
   * where it goes to merge, each merges once the checks its target
   * requires pass, the run under way at its merge stop until then.
   */
  const shipEnding = (run: RunRow, end: TaskEnd | null) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      // Already waiting to merge before Althar restarted, or its task was stopped: it carries on waiting, with nothing said again.
      const resumed = (yield* parametersNow(run)).ships?.at === 'merge'
      const admitted = yield* unlessStopped(
        sql.withTransaction(
          Effect.gen(function* () {
            const admission = yield* admit(run, 'publish', 0, { end, ships: true })
            const revision = yield* change('node_attempts', admission.attemptId, { state: 'running', startedAt: yield* timestamp })
            yield* fact({
              projectId: run.projectId,
              aggregateType: 'node_attempt',
              aggregateId: admission.attemptId,
              revision,
              type: 'node_attempt.running',
              actorId: instance.systemId,
            })
            return admission
          }),
        ),
      )
      if (admitted === undefined) return
      const { nodeId, attemptId } = admitted
      yield* touchCard(run.taskId)
      const shipping = (yield* parametersNow(run)).ships
      const only = shipping?.only
      // A review added after the work went up has nothing to send: it is over once settled.
      const reviewOnly = shipping?.reviewOnly === true
      // Nor one whose task came to stay here as it shipped: what waited waits for the next Ship. Nor one that ends with its branch
      // while its pull request stands open (a change stepped back to prototyping): pushing the branch would send its work there,
      // so it waits on the branch until the task ends in a pull request again, and that one carries on.
      const kept =
        end === 'none' && (yield* changes.keptOpen(run.taskId))
          ? (yield* changes.ofTask(run.taskId).pipe(Effect.orElseSucceed(() => []))).filter((one) => one.state === 'open')
          : []
      const stays = shipping?.stays === true || kept.length > 0
      // A new pull request opens as far as its route goes: a draft for a push, ready for review beyond. One admitted before
      // routes opens as the plan ends.
      const far = farOf(shipping)
      const opens: TaskEnd | null = (end === 'draft' || end === 'ready') && far !== undefined ? (far === 'push' ? 'draft' : 'ready') : end
      const shipped = yield* Effect.exit(
        Effect.gen(function* () {
          if (reviewOnly || stays) return { went: [] as Effect.Success<ReturnType<typeof changes.shipToOpen>>, published: undefined }
          const accepted = yield* acceptedShip(run)
          if (accepted === undefined) return yield* new ToolRefused({ message: 'Ship has no accepted code boundary.' })
          const went = yield* changes.shipToOpen(run.taskId, only, accepted.heads)
          const after = (yield* changes.unshipped(run.taskId)).filter((one) => only === undefined || only.includes(one.workspaceId))
          // A change of several with no pull request yet opens its first; one whose last merged or closed, its next.
          const fresh =
            only === undefined
              ? []
              : (yield* sql<{ id: string }>`
                      SELECT w.id FROM workspaces w WHERE w.task_id = ${run.taskId} AND w.access = 'write' AND w.state = 'ready'
                        AND NOT EXISTS (SELECT 1 FROM repository_changes c WHERE c.workspace_id = w.id AND c.pull_request_url IS NOT NULL)`).filter(
                  (one) => only.includes(one.id),
                )
          // An interrupted rebranch may temporarily hide its old head from unshipped(). The saved intent still needs
          // publication so Changes can reconcile that branch before measuring it again.
          const rebranching = (yield* parametersNow(run)).ships?.rebranching
          if ((after.length === 0 && fresh.length === 0 && Object.keys(rebranching ?? {}).length === 0) || opens === null)
            return { went, published: undefined }
          const opened = yield* changes.ofTask(run.taskId)
          // Its new work going out, a merged task is open again, until that merges too.
          yield* reopened(run.taskId, run.projectId)
          // A task that ends with its branch pushes it, as it stands, and opens nothing (a task is a conversation plus parts:
          // dropping its pull request leaves it a branch).
          const published = yield* publishForStep(run, attemptId, {
            projectId: run.projectId,
            taskId: run.taskId,
            runId: run.runId,
            end: opens,
            ...(opened.length > 0 && fresh.length === 0 && opens !== 'none' ? { again: true } : {}),
            ships: true,
            heads: accepted.heads,
            ...(only === undefined ? {} : { only }),
          })
          return { went, published }
        }),
      )
      if (shipped._tag === 'Failure') {
        const error = Cause.findErrorOption(shipped.cause)
        const notConnected = Option.isSome(error) && error.value instanceof NotConnected
        return yield* stuck(
          run,
          { id: attemptId },
          {
            step: 'publish',
            why: notConnected ? 'not_connected' : 'failed_to_start',
            detail:
              Option.isSome(error) && error.value instanceof NoChangeToOpen
                ? words(error.value, (agentId) => agentId).message
                : summarize(shipped.cause) || null,
            agentId: null,
            round: 0,
            open: 0,
          },
        )
      }
      const { went, published } = shipped.value
      if (!reviewOnly && !stays) yield* changes.releaseHolds(run.taskId, 'shipped', only, (yield* parametersNow(run)).ships?.heads)
      // Each change of several that shipped, a stamped row of the thread's: its name, and the pull request it went to.
      // With one change, the thread's line on its pull request says it.
      const [thread] = yield* sql<{ id: string }>`SELECT id FROM threads WHERE task_id = ${run.taskId} AND kind = 'task'`
      if (thread !== undefined && only !== undefined)
        for (const id of only) {
          const [one] = yield* sql<{
            name: string | null
            branch: string
            number: number | null
            short: string | null
            prefix: string | null
          }>`
                SELECT w.name, w.branch, json_extract(l.snapshot, '$.number') AS number, json_extract(l.snapshot, '$.words.short') AS short,
                  json_extract(l.snapshot, '$.words.prefix') AS prefix
                FROM workspaces w
                LEFT JOIN repository_changes c ON c.rowid = (
                  SELECT max(x.rowid) FROM repository_changes x WHERE x.workspace_id = w.id AND x.pull_request_url IS NOT NULL)
                LEFT JOIN external_links l ON l.url = c.pull_request_url AND l.kind = 'change'
                WHERE w.id = ${id}`
          if (one === undefined || one.number === null) continue
          const name = one.name ?? one.branch
          const where = `${one.short ?? 'PR'} ${one.prefix ?? '#'}${one.number}`
          const count = went.find((sent) => sent.change === one.name)?.count
          yield* addItem({ projectId: run.projectId, threadId: thread.id }, 'notice', {
            source: 'runtime',
            severity: 'info',
            title: `Shipped · ${name}${count === undefined ? '' : `, ${count === 1 ? '1 commit' : `${count} commits`}`} to ${where}.`,
            description: null,
            step: { kind: 'shipped', name, branch: where, toward: null },
          })
        }
      const sent = went.map((one) => `${one.count === 1 ? '1 commit' : `${one.count} commits`} to ${one.where}`)
      const opened = published === undefined ? undefined : publishedSummary(published, opens === 'none' || opens === null ? 'draft' : opens)
      const summary = [sent.length === 0 ? undefined : `Shipped ${sent.join(', ')}.`, opened].filter((line) => line !== undefined).join(' ')
      const said = {
        step: 'publish',
        round: 0,
        summary:
          summary === ''
            ? kept.length > 0
              ? `Kept on its branch here: ${kept.map((one) => `${one.words.short} ${one.words.prefix}${one.number}`).join(' and ')} ${kept.length === 1 ? 'stays' : 'stay'} as it is, and nothing more goes to it until it ends in a pull request again.`
              : stays
                ? 'Kept here: nothing went up.'
                : reviewOnly
                  ? 'Reviewed.'
                  : 'Shipped.'
            : summary,
        ...(published === undefined ? {} : openedOf(published)),
      }
      const attempt = { id: attemptId, nodeId }
      // Carried on after a restart or a stop, what went up was said already.
      const over: ShipOver = { said, went, published, sayResult: !resumed }
      // As far as its route goes, as it stands now (RouteShip may have changed it meanwhile): ready for review, then merged.
      if (!reviewOnly && !stays) {
        const urls = yield* shipScope(run.taskId, only)
        const goes = farOf((yield* parametersNow(run)).ships)
        if (goes === 'ready' || goes === 'merge') yield* readyStop(run, urls)
        if (farOf((yield* parametersNow(run)).ships) === 'merge') {
          const waiting = yield* mergeStop(run, urls, resumed)
          if (waiting.length > 0) {
            // What went up is said now; the run stays under way at its merge stop, and ends once each has merged or can't.
            if (!resumed) yield* result(run, said)
            return yield* awaitMerge(run, attempt, { ...over, sayResult: false }, waiting)
          }
        }
      }
      yield* shipOver(run, attempt, over)
    })

  /** The task's open pull requests a Ship sends to, by address: those of the change it ships, or all of them. */
  const shipScope = (taskId: string, only: ReadonlyArray<string> | undefined) =>
    Effect.gen(function* () {
      const open = (yield* changes.ofTask(taskId)).filter((one) => one.state === 'open')
      if (only === undefined) return open.map((one) => one.url)
      const sql = yield* SqlClient.SqlClient
      const ours = yield* sql<{ url: string }>`
            SELECT DISTINCT pull_request_url AS url FROM repository_changes
            WHERE workspace_id IN ${sql.in([...only])} AND pull_request_url IS NOT NULL`
      return open.filter((one) => ours.some((mine) => mine.url === one.url)).map((one) => one.url)
    })

  /** Where a Ship stands past its push, for its card and for RouteShip: kept on its run, said at once. */
  const atStop = (run: RunRow, stop: 'ready' | 'merge') =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`UPDATE runs SET parameters = json_set(parameters, '$.ships.at', ${stop}), revision = revision + 1 WHERE id = ${run.runId}`
      yield* touchCard(run.taskId)
    })

  /** Its route's ready stop: each open draft it sent to is marked ready for review. One its host won't mark is said. */
  const readyStop = (run: RunRow, urls: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      yield* atStop(run, 'ready')
      for (const one of yield* changes.ofTask(run.taskId)) {
        if (one.state !== 'open' || !one.draft || !urls.includes(one.url)) continue
        yield* changes.markReady(run.taskId, one.url).pipe(
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.interrupt
              : addItem({ projectId: run.projectId, threadId: run.threadId }, 'notice', {
                  source: 'runtime',
                  severity: 'warning',
                  title: `Shipped, but ${nameOf(one)} is still a draft: ${summarize(cause) || 'its host wouldn’t mark it ready.'}`,
                  description: null,
                }),
          ),
        )
      }
    })

  /**
   * Its route's merge stop: each open pull request it sent to merges at what it has now, its waiting commits up, where
   * the checks its target requires have passed (or its branch's merge queue waits for them, or its host can't say); a
   * required check that failed leaves it ready, a line saying why. Those still waiting on their required checks, by
   * address: optional ones never hold it. Unless the lead set a finding of this Ship's review aside, which a line says,
   * leaving Merge to the person. `told`: their wait was said already.
   */
  const mergeStop = (run: RunRow, urls: ReadonlyArray<string>, told: boolean) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* atStop(run, 'merge')
      const [aside] = yield* sql<{ n: number }>`
            SELECT count(*) AS n FROM findings f JOIN node_attempts a ON a.id = f.review_attempt_id JOIN nodes n ON n.id = a.node_id
            WHERE n.execution_id = ${run.executionId} AND f.state = 'set_aside'`
      if ((aside?.n ?? 0) > 0) {
        yield* addItem({ projectId: run.projectId, threadId: run.threadId }, 'notice', {
          source: 'runtime',
          severity: 'warning',
          title: `Not merged: the lead set ${aside?.n === 1 ? 'a finding' : `${aside?.n} findings`} of the review aside. Read why, then merge it yourself.`,
          description: null,
        })
        return [] as ReadonlyArray<string>
      }
      const waiting: Array<string> = []
      for (const url of urls) {
        const one = yield* mergeOne(run, url, told)
        if (one === 'rerouted') return yield* notMergedNow(run)
        if (one === 'waiting') waiting.push(url)
      }
      return waiting as ReadonlyArray<string>
    })

  /**
   * Whether a Ship still merges, read as its merge is sent (`mergeAsItStands`' `stands`): its run under way, its route as
   * far as merged. A RouteShip made while its merge stop read the host lands before this, and nothing is sent; or after
   * the merge's intent is kept, which it reads, and refuses.
   */
  const stillMerges = (run: RunRow) =>
    provide(
      Effect.gen(function* () {
        if (!(yield* going(run)) || farOf((yield* parametersNow(run)).ships) !== 'merge') return yield* new NotMergingNow()
      }),
    )

  /** Its route goes no further than ready now: said, and nothing more merges. */
  const notMergedNow = (run: RunRow) =>
    Effect.as(
      addItem({ projectId: run.projectId, threadId: run.threadId }, 'notice', {
        source: 'runtime',
        severity: 'info',
        title: 'Not merged: the Ship goes as far as ready for review now.',
        description: null,
      }),
      [] as ReadonlyArray<string>,
    )

  /**
   * One pull request at a Ship's merge stop: merged, or not with why, or still waiting on its required checks; or not sent,
   * its route changed while it read the host (`rerouted`).
   */
  const mergeOne = (run: RunRow, url: string, told: boolean) =>
    Effect.gen(function* () {
      const say = (title: string, severity: 'info' | 'warning' = 'warning') =>
        addItem({ projectId: run.projectId, threadId: run.threadId }, 'notice', {
          source: 'runtime',
          severity,
          title,
          description: null,
        })
      // Said once, as it starts to wait: what it waits on.
      const waits = (now: Extract<MergeStanding, { readonly kind: 'waiting' }>) =>
        Effect.gen(function* () {
          const on = now.on.length === 0 ? 'the checks' : now.on.join(', ')
          if (!told)
            yield* say(`${now.name} merges once ${on} ${now.on.length === 1 ? 'passes' : 'pass'}, as ${now.target} requires.`, 'info')
          return 'waiting' as const
        })
      const standing = yield* Effect.exit(mergeStandingOf(changes, run.taskId, url))
      if (Exit.isSuccess(standing)) {
        const now = standing.value
        if (now.kind === 'gone') return 'done' as const
        if (now.kind === 'failed') {
          const which = now.failed.length === 0 ? 'A check it requires' : now.failed.join(', ')
          yield* say(`Not merged: ${which} failed on ${now.name}, so it stays ready for review.`)
          return 'done' as const
        }
        if (now.kind === 'waiting') return yield* waits(now)
      }
      // To merge, or its host couldn't say: merged as it stands, as Review and merge always did, where its route still
      // goes that far as the merge is sent. Refused while its required checks still run, it waits on them after all.
      const merged = yield* Effect.exit(changes.mergeAsItStands(run.taskId, url, stillMerges(run)))
      if (Exit.isSuccess(merged)) return 'done' as const
      if (Cause.hasInterruptsOnly(merged.cause)) return yield* Effect.interrupt
      if (Option.getOrUndefined(Cause.findErrorOption(merged.cause)) instanceof NotMergingNow) return 'rerouted' as const
      const again = yield* Effect.exit(mergeStandingOf(changes, run.taskId, url))
      if (Exit.isSuccess(again) && again.value.kind === 'waiting') return yield* waits(again.value)
      yield* say(`Shipped, but not merged: ${summarize(merged.cause) || 'its host refused the merge.'}`)
      return 'done' as const
    })

  /**
   * A Ship waiting at its merge stop: each pull request is looked at again as often as an external wait reads its host,
   * or at once as its route changes, and merges once its required checks pass. Over once none waits, or its route goes
   * no further than ready; a stop, or another run, leaves it, and resuming waits again (`resumed`). Apart, so nothing
   * waits on it.
   */
  const awaitMerge = (
    run: RunRow,
    attempt: { readonly id: string; readonly nodeId: string },
    over: ShipOver,
    waiting: ReadonlyArray<string>,
  ) =>
    Effect.gen(function* () {
      const wake = yield* Queue.sliding<void>(1)
      const waits = Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        // Changed before it could be woken, it looks again at once.
        if (farOf((yield* parametersNow(run)).ships) !== 'merge') yield* Queue.offer(wake, undefined)
        let left = waiting
        while (left.length > 0) {
          yield* Effect.raceFirst(Queue.take(wake), Effect.sleep(Duration.millis(externalEvery)))
          const [still] = yield* sql<{ state: string }>`SELECT state FROM node_attempts WHERE id = ${attempt.id}`
          if (still?.state !== 'running' || !(yield* going(run))) return
          if (farOf((yield* parametersNow(run)).ships) !== 'merge') {
            left = yield* notMergedNow(run)
            break
          }
          const next: Array<string> = []
          for (const url of left) {
            const one = yield* mergeOne(run, url, true)
            if (one === 'rerouted') {
              next.length = 0
              yield* notMergedNow(run)
              break
            }
            if (one === 'waiting') next.push(url)
          }
          left = next
        }
        yield* shipOver(run, attempt, over)
      })
      yield* Effect.forkIn(
        provide(
          Effect.sync(() => mergeWakes.set(run.runId, wake)).pipe(
            Effect.andThen(waits),
            Effect.catchCause((cause) =>
              Cause.hasInterruptsOnly(cause)
                ? Effect.interrupt
                : Effect.andThen(Effect.logWarning('Could not wait to merge a Ship', cause), Effect.ignore(shipOver(run, attempt, over))),
            ),
            Effect.ensuring(Effect.sync(() => mergeWakes.get(run.runId) === wake && mergeWakes.delete(run.runId))),
          ),
        ),
        scope,
      )
    })

  /**
   * A Ship is over: its publish step and its run end, what went up said where it wasn't yet, its task back where its
   * card reads it; and the next change waiting ships now, in a Ship of its own, on the same route.
   */
  const shipOver = (run: RunRow, attempt: { readonly id: string; readonly nodeId: string }, over: ShipOver) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const say = over.sayResult !== false
      yield* sql.withTransaction(
        Effect.gen(function* () {
          const [still] = yield* sql<{ state: string }>`SELECT state FROM node_attempts WHERE id = ${attempt.id}`
          if (still?.state !== 'running' || !(yield* going(run))) return say ? yield* result(run, over.said) : undefined
          yield* ended(run, attempt, 'succeeded', {
            shipped: over.went,
            ...(over.published === undefined ? {} : { published: over.published }),
          })
          yield* unstuck(run)
          if (say) yield* result(run, over.said)
          yield* ends(run, 'succeeded')
        }),
      )
      yield* rest(run.taskId)
      yield* Effect.ignore(changes.settleIfMerged(run.taskId))
      yield* touchCard(run.taskId)
      const after = (yield* parametersNow(run)).ships
      const next = after?.next ?? []
      const route = after?.route ?? (after?.merges === true ? ({ review: true, far: 'merge' } as const) : undefined)
      if (next.length > 0) yield* shipNext(run.taskId, route, next, after?.openDraft)
    })

  /**
   * Merge, with commits not shipped. Review and merge is a Ship that merges once what waited is up (`mergeStop`). Merge
   * now owes a review after the merge of what no review read, where the task has a reviewer, then sends the commits up,
   * past the hold, and merges each open pull request at what it has then.
   */
  const mergeWaiting = (input: {
    readonly envelope: CommandEnvelope
    readonly taskId: string
    readonly how: 'review' | 'now'
    readonly url?: string
  }) =>
    Effect.gen(function* () {
      const waits = (yield* changes.aheadOfOpen(input.taskId)).length > 0 || (yield* changes.holds(input.taskId)).length > 0
      // Review and merge is a Ship all the way: its review where it has one, then merged once its required checks pass.
      if (input.how === 'review' && waits)
        return yield* Effect.asVoid(ship(input.taskId, input.envelope.actorId, { route: { review: true, far: 'merge' } }))
      const marks = yield* reviewMarksOf(input.taskId)
      const open = (yield* changes.ofTask(input.taskId)).filter(
        (one) => one.state === 'open' && (input.url === undefined || one.url === input.url),
      )
      if (waits) for (const one of open) yield* mergeReviews.owe(input.taskId, one.url, marks)
      if (waits) {
        const heads = yield* shipHeads(input.taskId)
        yield* changes.shipToOpen(input.taskId, undefined, heads)
        yield* changes.releaseHolds(input.taskId, 'shipped', undefined, heads)
      }
      for (const one of open) yield* changes.mergeAsItStands(input.taskId, one.url)
    })

  /** A merged task whose new work goes out is open again, until that merges too; inside its own transaction. */
  const reopened = (taskId: string, projectId: ProjectId) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql.withTransaction(
        Effect.gen(function* () {
          const [now] = yield* sql<{ state: string }>`SELECT state FROM tasks WHERE id = ${taskId}`
          if (now?.state !== 'done') return
          const revision = yield* change('tasks', taskId, { state: yield* transition(taskLifecycle, 'done', 'open'), settledAt: null })
          yield* fact({
            projectId,
            aggregateType: 'task',
            aggregateId: taskId,
            revision,
            type: 'task.reopened',
            payload: { shipped: true },
            actorId: instance.systemId,
          })
        }),
      )
    })

  /**
   * Where a round made nothing new, the task goes back where it was, inside
   * the caller's transaction: its run ends as the one before it did, so its
   * card says what it said before, and a merged task is done again, at the
   * time it first settled. A task that isn't a change waits in Needs you
   * instead: only the person settles one.
   */
  const backWhereItWas = (
    run: RunRow,
    back: RoundBack,
    why: 'nothing_new' | 'abandoned' = 'nothing_new',
    /** Given up having committed: what it committed is in no pull request yet, so a merged task stays open for its next. */
    committed = false,
  ) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* ends(run, back.ended)
      yield* change('runs', run.runId, { endReason: why })
      const [task] = yield* sql<{ state: string; change: number }>`
            SELECT k.state,
              CASE WHEN ${sql.unsafe(quickIn('k'))} OR EXISTS (SELECT 1 FROM external_links l WHERE l.task_id = k.id AND l.kind = 'review')
                THEN 0 ELSE 1 END AS change
            FROM tasks k WHERE k.id = ${run.taskId}`
      if (back.state !== 'done' || task?.state !== 'open' || committed) return
      // Only the person settles a task that isn't a change: written to after it settled, its round ends in Needs you.
      if (task.change === 0) return
      const state = yield* transition(taskLifecycle, 'open', 'done')
      const revision = yield* change('tasks', run.taskId, { state, settledAt: back.settledAt })
      yield* fact({
        projectId: run.projectId,
        aggregateType: 'task',
        aggregateId: run.taskId,
        revision,
        type: 'task.done',
        payload: { round: run.runId, back: true },
        actorId: instance.systemId,
      })
      // Settled again, its lead stops once its turn ends, with what it left running (LeftBehind.ts).
      yield* leftBehind.settled(run.taskId)
    })

  /**
   * A round's Implement step whose lead's turn ended, or whose session
   * went, having made nothing new, and asking the person nothing: the
   * round ends there, and the task is back where it was. Whether it did,
   * or, for the end of its lead's turn `turnId`, the step is past it
   * (`pastTurn`): either way, nothing more is that turn's to do.
   */
  const quietly = (
    run: RunRow,
    attempt: { readonly id: string; readonly nodeId: string; readonly nodeKey: string; readonly input: string },
    turnId?: string,
  ) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const round = run.planId === null && attempt.nodeKey === 'implement' ? roundOf(attempt.input) : undefined
      if (round === undefined || (yield* asking(run.threadId)) || (yield* madeSince(run.taskId, round.start))) return false
      const closed = yield* sql.withTransaction(
        Effect.gen(function* () {
          if (turnId !== undefined && (yield* pastTurn(run.threadId, turnId, attempt.id))) return 'past'
          const [still] = yield* sql<{ state: string }>`SELECT state FROM node_attempts WHERE id = ${attempt.id}`
          if (!(yield* going(run)) || !['admitted', 'running', 'waiting_attention'].includes(still?.state ?? '')) return 'kept'
          yield* ended(run, attempt, 'succeeded', { quiet: true })
          yield* unstuck(run)
          yield* backWhereItWas(run, round.round)
          return 'closed'
        }),
      )
      if (closed !== 'closed') return closed === 'past'
      yield* rest(run.taskId)
      // A pull request that merged while it ran settles the task now.
      yield* Effect.ignore(changes.settleIfMerged(run.taskId))
      yield* touchCard(run.taskId)
      return true
    })

  /**
   * An aside's first step, its lead's turn ended with its answer and nothing changed in the repository (`aside`): the step
   * ends there, with no report, and the task is ready, as finish_step with nothing built would leave it. What the person says
   * next is a round, as after any plan. Not one that asks the person something, or that became work and left Scratch.
   */
  const asideAnswered = (
    on: { readonly run: RunRow; readonly attemptId: string; readonly nodeId: string; readonly step: string },
    turnId: string,
  ) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      if (on.step !== 'implement' || on.run.planId === null) return false
      const parameters = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(PlanParameters))(on.run.parameters).pipe(Effect.option)
      if (Option.isNone(parameters) || parameters.value.aside !== true) return false
      const [task] = yield* sql<{ shelf: string | null }>`SELECT shelf FROM tasks WHERE id = ${on.run.taskId}`
      if (task?.shelf !== 'scratch' || (yield* asking(on.run.threadId)) || !(yield* unbranched(on.run.taskId))) return false
      const closed = yield* sql.withTransaction(
        Effect.gen(function* () {
          if (yield* pastTurn(on.run.threadId, turnId, on.attemptId)) return false
          if (!(yield* keeps(on.run, on.attemptId, { step: 'implement', aside: true }))) return false
          yield* ended(on.run, { id: on.attemptId, nodeId: on.nodeId }, 'succeeded', { quiet: true, aside: true })
          yield* unstuck(on.run)
          return true
        }),
      )
      if (!closed) return false
      yield* conclude(on.run)
      yield* touchCard(on.run.taskId)
      return true
    })

  return {
    acceptShipWork,
    asideAnswered,
    backWhereItWas,
    digestAll,
    fromItsStart,
    madeSince,
    mergeWaiting,
    openRound,
    parametersNow,
    quietly,
    restedOf,
    ship,
    shipEnding,
    shipHeads,
    shipToReview,
    startOf,
    tinyFixOf,
    worktreesOf,
  }
}
