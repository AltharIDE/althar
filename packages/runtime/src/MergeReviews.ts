import { existsSync } from 'node:fs'

import { type AfterMergeRule, isAgentDefault, knownModelName } from '@althar/contracts'
import { type ActorId, Ids, newId, type ProjectId } from '@althar/domain'
import type { Ledger } from '@althar/persistence-sqlite'
import { Cause, Clock, Context, type Crypto, Duration, Effect, Layer, Option, Schema, Scope, Stream } from 'effect'
import { SqlClient } from 'effect/sql'

import { Agents } from './Config'
import { Models } from './Models'
import { afterMergeNow, bringsBack, TASK_AFTER_MERGE_SET, type TaskAfterMerge } from './afterMergeReview'
import { touchTask } from './cards'
import { envelope } from './envelope'
import { git } from './git'
import { Instance } from './Instance'
import { makeKeyedLock } from './keyedLock'
import { Live, type LiveEvent } from './Live'
import { fact, timestamp } from './records'
import { MERGE_REVIEW, mergeCopyOf } from './reviewCopy'
import { Sessions } from './Sessions'
import { addItem } from './threads'
import { ToolRefused } from './toolErrors'
import { DESCRIPTION_SHAPE } from './pullRequestWords'
import { summarize } from './words'

/*
 * The review after a merge, in the same task (a task is a conversation plus
 * parts, "After merge, in the same task"). Where a task with a reviewer has
 * a pull request merge with something of it no review read (an explicitly
 * configured after-merge pass, or what Merge now merged), that pull request is owed a review. The
 * task's own reviewer reads a copy at the merged head, from what the last
 * review read, in a thread of the task's own (`merge_review`), and reports
 * in the task's thread. Nothing is posted on the merged pull request.
 *
 * The merge ends only that change: the task settles where it was its last,
 * and the review runs on all the same, spared by the sweep that settling
 * starts (LeftBehind.ts). What it brings back is the project's rule, or the
 * task's own word, read when the merge is heard and kept on the review
 * (afterMergeReview.ts): under `major` only blocking and major findings, under
 * `all` any; under `none` an explicitly after-merge plan owes no review at all. What it
 * doesn't bring back is a line in the thread, its findings readable there.
 * What it brings back puts the task in Needs you for that change, until the
 * person says Fix it, which hands the findings to the lead in a turn that
 * ships as a new change after the merged one, or Leave it. A restart
 * mid-review starts it again; one that couldn't start is tried again until
 * it does.
 */

/** One finding of a review after a merge, as its reviewer reported it. */
const Found = Schema.Struct({
  severity: Schema.Literals(['blocking', 'major', 'minor', 'nit']),
  file: Schema.NullOr(Schema.String),
  line: Schema.NullOr(Schema.Number),
  claim: Schema.String,
  title: Schema.optional(Schema.NullOr(Schema.String)),
})
type Found = typeof Found.Type

/**
 * Who reviews: the plan's reviewer; and what its findings bring back to the person, as the rule said when the merge was heard
 * (`major` for a review owed before it was kept).
 */
const Reviewer = Schema.Struct({
  agentId: Schema.String,
  model: Schema.NullOr(Schema.String),
  effort: Schema.optional(Schema.NullOr(Schema.String)),
  bringsBack: Schema.optional(Schema.Literals(['major', 'all'])),
})
type Reviewer = typeof Reviewer.Type

const decodeFindings = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(Found)))
const decodeReviewer = Schema.decodeUnknownOption(Schema.fromJsonString(Reviewer))

/** Where a review after a merge stands. */
export type MergeReviewState = 'owed' | 'running' | 'clear' | 'found' | 'fixing' | 'left' | 'stopped'

/** A review after a merge, as the screens and the lead read it. */
export interface MergeReview {
  readonly url: string
  readonly taskId: string
  readonly number: number | null
  /** The pull request as its host's words name it: `#715`. */
  readonly words: string
  readonly state: MergeReviewState
  readonly summary: string | null
  readonly findings: ReadonlyArray<Found>
  readonly message: string | null
}

interface Row {
  readonly url: string
  readonly taskId: string
  readonly projectId: ProjectId
  readonly number: number | null
  readonly base: string | null
  readonly head: string | null
  readonly state: MergeReviewState
  readonly reviewer: string | null
  readonly summary: string | null
  readonly findings: string
  readonly attempts: number
  readonly message: string | null
}

/**
 * What an explicitly requested review after merge brings back: the project's rule, the task's own word (null where it leaves it
 * to the project), and what holds of the two.
 */
export interface AfterMergeChoice {
  readonly project: AfterMergeRule
  readonly task: TaskAfterMerge | null
  readonly holds: AfterMergeRule
}

/** Why a press on a review after a merge did nothing, in words for the window. */
export class MergeReviewRefused extends Schema.TaggedError<MergeReviewRefused>()('MergeReviewRefused', { message: Schema.String }) {}

const NO_REVIEW_OWED = 'external_link.merge_review_not_owed'

const wordsOf = (row: Pick<Row, 'number' | 'url'>, prefix = '#') =>
  row.number === null ? (row.url.split('/').at(-1) ?? 'the pull request') : `${prefix}${row.number}`

/** The findings, numbered, as the lead is handed them. */
const listed = (findings: ReadonlyArray<Found>) =>
  findings
    .map((finding, index) => {
      const where = finding.file === null ? '' : ` (${finding.file}${finding.line === null ? '' : `:${finding.line}`})`
      const title = finding.title == null || finding.title === '' ? '' : ` ${finding.title}`
      return `${index + 1}. [${finding.severity}]${title}${where}\n   ${finding.claim}`
    })
    .join('\n')

/**
 * What the lead is told when the person says Fix it: the findings, and what its fix goes out as. Its fix opens as a new pull request
 * after the merged one, so it is asked for that pull request's title and description now, as a first one's lead gives them: what its
 * reviewer reads is this pull request, not the task.
 */
export const fixBrief = (merged: string, findings: string) =>
  [
    `Fix what the review after ${merged} merged found. ${merged} merged already: commit your fix on the task's branch, and it goes out as a new pull request after it once your turn is over.`,
    findings,
    `Then call finish_step, once it is committed, with your summary and what the task has built in \`built\`, and for that new pull request: in \`title\`, what it does in a few words, the way a title reads (not the task's title, which says what ${merged} did); and in \`descriptions\`, its description, for whoever reviews it on the code host. ${DESCRIPTION_SHAPE} Here that means: why it exists (the finding it answers, naming ${merged} so the host links it), what changed, and what stays the same. Althar puts "After ${merged}:" before your title itself.`,
  ].join('\n\n')

const countOf = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

type Store = SqlClient.SqlClient | Instance | Sessions | Live | Ledger | Crypto.Crypto | Agents | Models

export class MergeReviews extends Context.Service<
  MergeReviews,
  {
    /**
     * A pull request of the task merged: where the task has a reviewer and
     * something of it no review read, its review is owed, kept before it is
     * tried, and started. Never fails: what can't start is said in the
     * task's thread, and tried again.
     */
    merged(taskId: string, url: string): Effect.Effect<void>
    /**
     * Merge now, with commits not shipped: the pull request is owed a review
     * after it merges, from what the last review read in each worktree
     * (by path), before it is merged.
     */
    owe(taskId: string, url: string, marks: Readonly<Record<string, string>>): Effect.Effect<void, unknown>
    /** Starts every review owed, and one a restart cut short, again. */
    retry(): Effect.Effect<void>
    /** Whether the thread is a review after a merge's, which its reviewer reports in. */
    owns(threadId: string): Effect.Effect<boolean>
    /** The reviewer's report, from `report_review` on its thread: what it found, kept, and said in the task's thread. */
    reported(
      access: { readonly threadId: string; readonly sessionId: string },
      report: {
        readonly verdict: 'pass' | 'changes_requested'
        readonly summary: string
        readonly findings: ReadonlyArray<Found>
        readonly model: string | null
      },
    ): Effect.Effect<string, ToolRefused>
    /**
     * Fix it: the findings go to the task's lead as the person's word, in a
     * turn whose fix goes out as a new change after the merged one. The
     * input that carries them, so whoever ships once its turn is over knows
     * which turn that is.
     */
    fix(taskId: string, url?: string): Effect.Effect<{ readonly threadId: string; readonly inputId: string | null }, unknown>
    /** Leave it: the findings close, and stay in the thread. */
    leave(taskId: string, url?: string): Effect.Effect<void, unknown>
    /** Waits until the turn that delivers the input has ended, or a while has passed. */
    afterTurnOf(threadId: string, inputId: string | null): Effect.Effect<void>
    /** The task's reviews after a merge, oldest first. */
    ofTask(taskId: string): Effect.Effect<ReadonlyArray<MergeReview>, unknown>
    /**
     * The person's explicit choice of a task's review after the merge, over its project's rule, until it merges: `review`, reviewed
     * after it merges though the rule says none; `none`, not reviewed after it; null, as the project's rule says. Kept as a
     * fact, read when the merge is heard. Saved reviews of earlier changes remain unchanged. Refused once every current change
     * merged or has its review saved already, and for `review` where
     * its plan names no reviewer.
     */
    choose(
      taskId: string,
      review: TaskAfterMerge | null,
      actorId: ActorId,
      /** Persists explicit timing under the same decision lock, after validation and reconciliation of older merges. */
      prepare?: Effect.Effect<void, unknown>,
    ): Effect.Effect<AfterMergeChoice, unknown>
    /** Preserve known merged decisions before changing canonical review timing through another task action. */
    beforeChange<A>(taskId: string, change: Effect.Effect<A, unknown>): Effect.Effect<A, unknown>
  }
>()('@althar/runtime/MergeReviews') {
  static readonly layer: Layer.Layer<MergeReviews, never, Store> = Layer.effect(
    MergeReviews,
    Effect.gen(function* () {
      const context = yield* Effect.context<Store>()
      const provide = <A, E>(effect: Effect.Effect<A, E, Store>) => Effect.provideContext(effect, context)
      const sessions = yield* Sessions
      const live = yield* Live
      const instance = yield* Instance
      const scope = yield* Scope.fork(yield* Effect.scope, 'sequential')
      const decisions = makeKeyedLock()

      const rowsOf = (taskId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          return yield* sql<Row>`
            SELECT url, task_id, project_id, number, base, head, state, reviewer, summary, findings, attempts, message
            FROM merge_reviews WHERE task_id = ${taskId} ORDER BY created_at, rowid`
        })

      const rowOf = (url: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [row] = yield* sql<Row>`
            SELECT url, task_id, project_id, number, base, head, state, reviewer, summary, findings, attempts, message
            FROM merge_reviews WHERE url = ${url}`
          return row
        })

      const setState = (url: string, fields: Partial<Record<'state' | 'message' | 'summary' | 'verdict' | 'findings', string | null>>) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const at = yield* timestamp
          yield* sql`UPDATE merge_reviews SET ${sql.update({ ...fields, updatedAt: at })} WHERE url = ${url}`
        })

      /** The task's own thread, where its lines go. */
      const taskThreadOf = (taskId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [row] = yield* sql<{ id: string }>`SELECT id FROM threads WHERE task_id = ${taskId} AND kind = 'task' LIMIT 1`
          return row?.id
        })

      /**
       * The reviewer the task's plan names, run before its work ships or after it merges, and whether it reads only once the work
       * merged (the small-change lane); none where it names none.
       */
      const reviewerOf = (taskId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [plan] = yield* sql<{ parameters: string }>`
            SELECT parameters FROM task_plans WHERE task_id = ${taskId} ORDER BY proposed_at DESC, rowid DESC LIMIT 1`
          if (plan === undefined) return undefined
          let read: unknown
          try {
            read = JSON.parse(plan.parameters)
          } catch {
            return undefined
          }
          const steps = (read as { readonly steps?: unknown }).steps
          if (!Array.isArray(steps)) return undefined
          const review = steps.find(
            (step): step is Reviewer & { readonly key: string; readonly skipped?: boolean } =>
              (step as { key?: unknown })?.key === 'review',
          )
          if (review === undefined || typeof review.agentId !== 'string') return undefined
          // Fast-lane plans deliberately skip the before-merge pass while retaining their reviewer after the merge.
          if (review.skipped === true && (read as { readonly reviewAfterMerge?: unknown }).reviewAfterMerge !== true) return undefined
          return {
            reviewer: { agentId: review.agentId, model: review.model ?? null, effort: review.effort ?? null } satisfies Reviewer,
            afterMerge: (read as { readonly reviewAfterMerge?: unknown }).reviewAfterMerge === true,
          }
        })

      /** The worktree the pull request came from, the repository's checkout here its commits live in, and what Althar pushed of it. */
      const placeOf = (taskId: string, url: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [row] = yield* sql<{
            id: string
            path: string
            base: string | null
            branch: string
            pushed: string | null
            repository: string | null
          }>`
            SELECT w.id, w.path, coalesce(w.base_commit, w.base_ref) AS base, coalesce(c.branch, w.branch) AS branch,
              c.head_commit AS pushed,
              (SELECT l.path FROM repository_locations l WHERE l.binding_id = w.binding_id AND l.device_id = ${instance.deviceId}) AS repository
            FROM workspaces w
            LEFT JOIN repository_changes c ON c.workspace_id = w.id AND c.pull_request_url = ${url}
            WHERE w.task_id = ${taskId} AND w.device_id = ${instance.deviceId}
            ORDER BY c.id IS NULL, w.created_at, w.rowid LIMIT 1`
          return row
        })

      /** Where git can read the task's commits: its worktree where it still is, else the repository's own checkout. */
      const gitDirOf = (place: { readonly path: string; readonly repository: string | null }) =>
        existsSync(place.path) ? place.path : place.repository

      /**
       * The merged head as a commit here: the head its host last said, where git has it (fetched by its pull request's ref
       * where it hasn't); else what Althar last pushed of it; else its branch's tip. Null where none is a commit here.
       */
      const mergedCommit = (
        dir: string,
        said: string | null,
        number: number | null,
        place: { readonly pushed: string | null; readonly branch: string },
      ) =>
        Effect.gen(function* () {
          const commit = (ref: string) => Effect.option(git(dir, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`))
          if (said !== null && /^[0-9a-f]{40,64}$/.test(said)) {
            const here = yield* commit(said)
            if (Option.isSome(here)) return here.value
            yield* Effect.ignore(git(dir, 'fetch', '-q', 'origin', said))
            if (number !== null) yield* Effect.ignore(git(dir, 'fetch', '-q', 'origin', `pull/${number}/head`))
            const fetched = yield* commit(said)
            if (Option.isSome(fetched)) return fetched.value
          }
          for (const ref of [place.pushed, place.branch]) {
            if (ref === null || ref === '') continue
            const found = yield* commit(ref)
            if (Option.isSome(found)) return found.value
          }
          return null
        })

      /**
       * What the last review of the worktree read, as a commit on its branch
       * with that tree; null where none read it, or none on the branch holds
       * what it read.
       */
      const reviewedUpTo = (workspaceId: string, dir: string, head: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [last] = yield* sql<{ commitSha: string | null }>`
            SELECT s.commit_sha FROM workspace_snapshots s JOIN node_attempts a ON a.id = s.node_attempt_id
            JOIN nodes n ON n.id = a.node_id
            WHERE s.workspace_id = ${workspaceId} AND n.node_key = 'review' AND s.commit_sha IS NOT NULL
              AND a.state = 'succeeded' AND json_extract(a.output, '$.verdict') IS NOT NULL
            ORDER BY s.taken_at DESC, s.rowid DESC LIMIT 1`
          if (last?.commitSha == null) return null
          const tree = yield* git(dir, 'rev-parse', `${last.commitSha}^{tree}`)
          const listed = yield* git(dir, 'log', '--format=%H %T', head)
          return (
            listed
              .split('\n')
              .map((line) => line.split(' '))
              .find(([, other]) => other === tree)?.[0] ?? null
          )
        }).pipe(Effect.orElseSucceed(() => null))

      /** A definitive decision for this merge, including no debt, survives policy changes and the recovery sweep. */
      const noReviewOwed = (
        link: { readonly id: string; readonly projectId: ProjectId; readonly revision: number },
        url: string,
        reason: 'no_reviewer' | 'before_ship' | 'rule_none' | 'review_task' | 'already_reviewed',
      ) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          yield* sql.withTransaction(
            Effect.gen(function* () {
              const [had] = yield* sql<{ one: number }>`SELECT 1 AS one FROM record_events
                WHERE aggregate_type = 'external_link' AND aggregate_id = ${link.id} AND type = ${NO_REVIEW_OWED} LIMIT 1`
              if (had !== undefined) return
              yield* fact({
                projectId: link.projectId,
                aggregateType: 'external_link',
                aggregateId: link.id,
                revision: link.revision,
                type: NO_REVIEW_OWED,
                payload: { url, reason },
                actorId: instance.systemId,
              })
            }),
          )
        })

      /**
       * A pull request merged. Existing debt starts; otherwise the configured after-merge pass is owed for work no review read.
       * A definitive decision that no review is owed is kept too: future task choices must not resurrect an earlier merge.
       */
      const merged = (taskId: string, url: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          if ((yield* rowOf(url)) !== undefined) return yield* start(url)
          const [link] = yield* sql<{ id: string; projectId: ProjectId; revision: number; snapshot: string }>`
            SELECT id, project_id, revision, snapshot FROM external_links
            WHERE task_id = ${taskId} AND kind = 'change' AND url = ${url} ORDER BY created_at DESC, rowid DESC LIMIT 1`
          if (link === undefined) return
          const snapshot = JSON.parse(link.snapshot) as { readonly number?: unknown; readonly headSha?: unknown; readonly state?: unknown }
          if (snapshot.state !== 'merged') return
          const [decided] = yield* sql<{ one: number }>`SELECT 1 AS one FROM record_events
            WHERE aggregate_type = 'external_link' AND aggregate_id = ${link.id} AND type = ${NO_REVIEW_OWED} LIMIT 1`
          if (decided !== undefined) return
          const plan = yield* reviewerOf(taskId)
          if (plan === undefined) {
            // A malformed stored plan is uncertain, not evidence that no reviewer was configured.
            const [stored] = yield* sql<{ parameters: string }>`
              SELECT parameters FROM task_plans WHERE task_id = ${taskId} ORDER BY proposed_at DESC, rowid DESC LIMIT 1`
            if (stored !== undefined && !Array.isArray((JSON.parse(stored.parameters) as { readonly steps?: unknown }).steps)) return
            return yield* noReviewOwed(link, url, 'no_reviewer')
          }
          if (!plan.afterMerge) return yield* noReviewOwed(link, url, 'before_ship')
          const rule = (yield* afterMergeNow(taskId)).holds
          if (rule === 'none') return yield* noReviewOwed(link, url, 'rule_none')
          const reviewer = { ...plan.reviewer, bringsBack: rule } satisfies Reviewer
          // Reviewed already in a review task of its own, as an Althar before this one did.
          const [reviewTask] = yield* sql<{
            one: number
          }>`SELECT 1 AS one FROM external_links WHERE kind = 'review' AND url = ${url} LIMIT 1`
          if (reviewTask !== undefined) return yield* noReviewOwed(link, url, 'review_task')
          const head = typeof snapshot.headSha === 'string' && snapshot.headSha !== '' ? snapshot.headSha : null
          const number = typeof snapshot.number === 'number' ? snapshot.number : null
          const place = yield* placeOf(taskId, url)
          const dir = place === undefined ? null : gitDirOf(place)
          const commit = place === undefined || dir === null ? null : yield* mergedCommit(dir, head, number, place)
          // What the last review read: the merged head itself, and nothing is owed.
          const upTo = place === undefined || dir === null || commit === null ? null : yield* reviewedUpTo(place.id, dir, commit)
          if (upTo !== null && upTo === commit) return yield* noReviewOwed(link, url, 'already_reviewed')
          const at = yield* timestamp
          yield* sql`
            INSERT INTO merge_reviews ${sql.insert({
              url,
              taskId,
              projectId: link.projectId,
              number,
              base: upTo ?? (place?.base !== null && place?.base !== undefined && /^[0-9a-f]{40,64}$/.test(place.base) ? place.base : null),
              head,
              state: 'owed',
              reviewer: JSON.stringify(reviewer),
              findings: '[]',
              attempts: 0,
              createdAt: at,
              updatedAt: at,
            })}
            ON CONFLICT (url) DO NOTHING`
          yield* start(url)
        })

      /**
       * Merge now, with commits not shipped: they are reviewed after the merge, whatever Checked by's when says, from what the
       * last review read (`base`, by worktree path, as Ship keeps it). Owed before the merge, and started once it lands. A task
       * with no reviewer gets none.
       */
      const owe = (taskId: string, url: string, marks: Readonly<Record<string, string>>) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const plan = yield* reviewerOf(taskId)
          if (plan === undefined) return
          // Merge now merges what no review read: it is reviewed after, except an explicitly after-merge plan whose rule says none.
          const rule = (yield* afterMergeNow(taskId)).holds
          if (rule === 'none' && plan.afterMerge) return
          const reviewer = { ...plan.reviewer, bringsBack: rule === 'all' ? 'all' : 'major' } satisfies Reviewer
          const [link] = yield* sql<{ projectId: ProjectId; snapshot: string }>`
            SELECT project_id, snapshot FROM external_links WHERE task_id = ${taskId} AND kind = 'change' AND url = ${url}
            ORDER BY created_at DESC, rowid DESC LIMIT 1`
          if (link === undefined) return
          const snapshot = JSON.parse(link.snapshot) as { readonly number?: unknown }
          const place = yield* placeOf(taskId, url)
          const base = place === undefined ? undefined : marks[place.path]
          const at = yield* timestamp
          yield* sql`
            INSERT INTO merge_reviews ${sql.insert({
              url,
              taskId,
              projectId: link.projectId,
              number: typeof snapshot.number === 'number' ? snapshot.number : null,
              base: base !== undefined && /^[0-9a-f]{40,64}$/.test(base) ? base : null,
              head: null,
              state: 'owed',
              reviewer: JSON.stringify(reviewer),
              findings: '[]',
              attempts: 0,
              createdAt: at,
              updatedAt: at,
            })}
            ON CONFLICT (url) DO UPDATE SET state = 'owed', base = excluded.base, head = NULL, reviewer = excluded.reviewer,
              updated_at = excluded.updated_at
            WHERE merge_reviews.state IN ('owed', 'stopped')`
        })

      /**
       * A review owed before its merge (Merge now owes it as it asks the merge, which may wait in a queue), read again by the
       * rule as the merge is heard: a small change's whose rule or own word now says none is no longer owed, and dropped;
       * any other keeps what the rule brings back now. Undefined where it was dropped.
       */
      const ruleOnMerge = (row: Row, link: { readonly id: string; readonly projectId: ProjectId; readonly revision: number }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const plan = yield* reviewerOf(row.taskId)
          const rule = (yield* afterMergeNow(row.taskId)).holds
          if (rule === 'none' && plan?.afterMerge === true) {
            yield* sql.withTransaction(
              Effect.gen(function* () {
                yield* noReviewOwed(link, row.url, 'rule_none')
                yield* sql`DELETE FROM merge_reviews WHERE url = ${row.url} AND state = 'owed'`
              }),
            )
            yield* touchTask(row.taskId)
            return undefined
          }
          const was = row.reviewer === null ? Option.none() : decodeReviewer(row.reviewer)
          if (Option.isNone(was)) return row
          const reviewer = JSON.stringify({ ...was.value, bringsBack: rule === 'all' ? 'all' : 'major' } satisfies Reviewer)
          if (reviewer !== row.reviewer) yield* sql`UPDATE merge_reviews SET reviewer = ${reviewer} WHERE url = ${row.url}`
          return { ...row, reviewer }
        })

      /** The merged head, where the review owed has none yet: what its pull request's host last said, once it merged. */
      const headOf = (row: Row) =>
        Effect.gen(function* () {
          if (row.head !== null) return { row, merged: true }
          const sql = yield* SqlClient.SqlClient
          const [link] = yield* sql<{ id: string; projectId: ProjectId; revision: number; snapshot: string }>`
            SELECT id, project_id, revision, snapshot FROM external_links WHERE task_id = ${row.taskId} AND kind = 'change' AND url = ${row.url}
            ORDER BY created_at DESC, rowid DESC LIMIT 1`
          const snapshot = link === undefined ? {} : (JSON.parse(link.snapshot) as { readonly state?: unknown; readonly headSha?: unknown })
          if (snapshot.state === 'closed') {
            yield* setState(row.url, { state: 'stopped', message: 'It closed without merging.' })
            return { row, merged: false }
          }
          if (link === undefined || snapshot.state !== 'merged' || typeof snapshot.headSha !== 'string') return { row, merged: false }
          // Heard merged: what is owed, and what it brings back, is read by the rule now, not as it was owed.
          const now = yield* ruleOnMerge(row, link)
          if (now === undefined) return { row, merged: false }
          yield* sql`UPDATE merge_reviews SET head = ${snapshot.headSha} WHERE url = ${row.url}`
          return { row: { ...now, head: snapshot.headSha }, merged: true }
        })

      /** The thread its reviewer works in: the task's own for reviews after a merge, made on the first. */
      const threadFor = (row: Row) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [had] = yield* sql<{ id: string }>`
            SELECT id FROM threads WHERE task_id = ${row.taskId} AND kind = 'step' AND node_key = ${MERGE_REVIEW} LIMIT 1`
          if (had !== undefined) return had.id
          const [run] = yield* sql<{ executionId: string }>`
            SELECT e.id AS execution_id FROM runs r JOIN workflow_executions e ON e.run_id = r.id
            WHERE r.task_id = ${row.taskId} ORDER BY r.created_at DESC, r.rowid DESC LIMIT 1`
          if (run === undefined) return yield* Effect.fail(new Error('The task has never run, so it has no reviewer to start.'))
          const threadId = yield* newId(Ids.thread)
          yield* sql`INSERT INTO threads ${sql.insert({
            id: threadId,
            projectId: row.projectId,
            kind: 'step',
            taskId: row.taskId,
            executionId: run.executionId,
            nodeKey: MERGE_REVIEW,
            createdAt: yield* timestamp,
          })}`
          return threadId
        })

      /** The copy the review reads: the merged head, checked out beside the task's other review copies. */
      const copyFor = (row: Row) =>
        Effect.gen(function* () {
          const place = yield* placeOf(row.taskId, row.url)
          if (place === undefined) return yield* Effect.fail(new Error('Its worktree’s repository isn’t on this computer.'))
          const dir = gitDirOf(place)
          const head = dir === null ? null : yield* mergedCommit(dir, row.head, row.number, place)
          if (dir === null || head === null) return yield* Effect.fail(new Error('Althar can’t find what merged on this computer.'))
          const copy = mergeCopyOf(place.path, row.number)
          if (existsSync(copy)) {
            yield* git(copy, 'checkout', '--detach', '--force', head)
            yield* git(copy, 'clean', '-fdq')
          } else {
            yield* Effect.ignore(git(dir, 'worktree', 'prune'))
            yield* git(dir, 'worktree', 'add', '--detach', copy, head)
          }
          return copy
        })

      /**
       * The model its agent offers for the reviewer's, as the plan names it (`claude-opus-5-5`, as list_models writes it, is the
       * `claude-opus-5` Claude Code offers): by id, else by name. Itself (or none, where none is asked for) where the agent's models
       * aren't known. Missing where they are and none is it: that is what the catalog says now, which may be the last session's list
       * while the agent is asked again (`probing`), so it is not final.
       */
      const offeredAs = (agentId: string, model: string | null) =>
        Effect.gen(function* () {
          if (model === null) return { found: true as const, model }
          const offered = (yield* (yield* Models).catalog).find((one) => one.agentId === agentId)
          if (offered === undefined || offered.models.length === 0) return { found: true as const, model }
          const agent = (yield* Agents).list.find((one) => one.definition.id === agentId)
          const squash = (words: string) => words.toLowerCase().replace(/[^a-z0-9]+/g, '')
          const wanted = squash(model.slice(model.lastIndexOf('/') + 1))
          const one =
            offered.models.find((candidate) => candidate.id === model) ??
            offered.models.find(
              (candidate) =>
                !isAgentDefault(candidate) &&
                (squash(candidate.id) === wanted ||
                  squash(knownModelName({ id: agentId, name: agent?.definition.name ?? agentId }, candidate)) === wanted),
            )
          return one === undefined ? { found: false as const, probing: offered.probing } : { found: true as const, model: one.id }
        }).pipe(Effect.orElseSucceed(() => ({ found: true as const, model })))

      /** How long a review that couldn't start waits before it is tried again: half a minute, doubling, up to ten minutes. */
      const backoff = (attempts: number) => Math.min(10 * 60_000, 30_000 * 2 ** Math.min(attempts, 10))

      /** Starts a review owed, or one a restart cut short, where no other of the task's runs: one at a time, in its thread. */
      const start = (url: string) =>
        Effect.gen(function* () {
          const kept = yield* rowOf(url)
          if (kept === undefined || (kept.state !== 'owed' && kept.state !== 'running')) return
          // Owed before it merged, it waits for the merge.
          const { row, merged: landed } = yield* headOf(kept)
          if (!landed) return
          const sql = yield* SqlClient.SqlClient
          const [other] = yield* sql<{ url: string }>`
            SELECT url FROM merge_reviews WHERE task_id = ${row.taskId} AND state = 'running' AND url <> ${url} LIMIT 1`
          if (other !== undefined) return
          const reviewer = row.reviewer === null ? Option.none() : decodeReviewer(row.reviewer)
          if (Option.isNone(reviewer)) return yield* setState(url, { state: 'stopped', message: 'Its plan names no reviewer.' })
          // The model as its agent offers it. One it doesn't offer starts no session: it waits, owed, with why, and is looked at
          // again after a longer wait each time, as the agent may offer it once asked again.
          const offered = yield* offeredAs(reviewer.value.agentId, reviewer.value.model)
          if (!offered.found) {
            // Being asked this moment: nothing to say yet, the next listening turn reads what it said.
            if (offered.probing) return
            const message = `${reviewer.value.agentId} doesn’t offer ${reviewer.value.model ?? 'its model'}, so its review can’t start yet.`
            yield* sql`
              UPDATE merge_reviews SET state = 'owed', attempts = attempts + 1, message = ${message}, updated_at = ${yield* timestamp}
              WHERE url = ${url}`
            return yield* touchTask(row.taskId)
          }
          const model = offered.model
          const begun = yield* Effect.exit(
            Effect.gen(function* () {
              yield* copyFor(row)
              const threadId = yield* threadFor(row)
              yield* setState(url, { state: 'running', message: null })
              const was = yield* sessions.running(threadId)
              if (Option.isSome(was)) yield* Effect.ignore(sessions.stop(threadId))
              yield* sessions.start({
                threadId,
                agentId: reviewer.value.agentId,
                ...(model === null ? {} : { model }),
                ...(reviewer.value.effort == null ? {} : { effort: reviewer.value.effort }),
              })
            }),
          )
          if (begun._tag === 'Success') return yield* touchTask(row.taskId)
          // Kept owed, with why, said once in the task's thread and tried again.
          const message = summarize(begun.cause) || 'It couldn’t start.'
          yield* sql`
            UPDATE merge_reviews SET state = 'owed', attempts = attempts + 1, message = ${message}, updated_at = ${yield* timestamp}
            WHERE url = ${url}`
          const threadId = yield* taskThreadOf(row.taskId)
          if (threadId !== undefined && row.attempts === 0)
            yield* addItem({ projectId: row.projectId, threadId }, 'notice', {
              source: 'runtime',
              severity: 'warning',
              title: `The review after ${wordsOf(row)} merged didn’t start: ${message} Althar tries again.`,
              description: null,
            })
        }).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not start a review after a merge', cause)))

      const retry = Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const waiting = yield* sql<{ url: string }>`
          SELECT r.url FROM merge_reviews r JOIN tasks k ON k.id = r.task_id JOIN projects p ON p.id = k.project_id
          WHERE r.state IN ('owed', 'running') AND k.state <> 'abandoned' AND p.archived_at IS NULL
          ORDER BY r.created_at, r.rowid`
        for (const one of waiting) {
          const row = yield* rowOf(one.url)
          // One running whose reviewer is still at work here is left to it.
          if (row?.state === 'running') {
            const [thread] = yield* sql<{ id: string }>`
              SELECT id FROM threads WHERE task_id = ${row.taskId} AND kind = 'step' AND node_key = ${MERGE_REVIEW} LIMIT 1`
            if (thread !== undefined && Option.isSome(yield* sessions.running(thread.id))) continue
            yield* setState(row.url, { state: 'owed' })
          }
          // One that couldn't start waits longer each time, not a try for every listening turn: each try is a session starting on the task.
          if (row?.state === 'owed' && row.attempts > 0) {
            const [last] = yield* sql<{ at: string }>`SELECT updated_at AS at FROM merge_reviews WHERE url = ${one.url}`
            if (last !== undefined && Date.parse(last.at) + backoff(row.attempts) > (yield* Clock.currentTimeMillis)) continue
          }
          yield* start(one.url)
        }
      })

      const owns = (threadId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [row] = yield* sql<{ one: number }>`
            SELECT 1 AS one FROM threads WHERE id = ${threadId} AND kind = 'step' AND node_key = ${MERGE_REVIEW}`
          return row !== undefined
        }).pipe(Effect.orElseSucceed(() => false))

      /** The review its thread's reviewer is at now. */
      const runningOn = (threadId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [row] = yield* sql<{ url: string }>`
            SELECT r.url FROM merge_reviews r JOIN threads t ON t.task_id = r.task_id AND t.kind = 'step' AND t.node_key = ${MERGE_REVIEW}
            WHERE t.id = ${threadId} AND r.state = 'running' ORDER BY r.updated_at DESC LIMIT 1`
          return row === undefined ? undefined : yield* rowOf(row.url)
        })

      /** The reviewer is done: its session goes once its turn is over, its copy with it, and the next owed starts. */
      const doneWith = (row: Row, threadId: string) =>
        Effect.gen(function* () {
          yield* sessions.untilIdle(threadId, Duration.minutes(2))
          yield* Effect.ignore(sessions.stop(threadId))
          const place = yield* placeOf(row.taskId, row.url)
          const dir = place === undefined ? null : gitDirOf(place)
          if (place !== undefined && dir !== null)
            yield* Effect.ignore(git(dir, 'worktree', 'remove', '--force', mergeCopyOf(place.path, row.number)))
          const sql = yield* SqlClient.SqlClient
          const next = yield* sql<{ url: string }>`
            SELECT url FROM merge_reviews WHERE task_id = ${row.taskId} AND state = 'owed' ORDER BY created_at, rowid LIMIT 1`
          for (const one of next) yield* start(one.url)
        }).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not let a reviewer after a merge go', cause)))

      const reported = (
        access: { readonly threadId: string; readonly sessionId: string },
        report: {
          readonly verdict: 'pass' | 'changes_requested'
          readonly summary: string
          readonly findings: ReadonlyArray<Found>
          readonly model: string | null
        },
      ) =>
        Effect.gen(function* () {
          const row = yield* runningOn(access.threadId)
          if (row === undefined) return yield* new ToolRefused({ message: 'No review is waiting on you.' })
          const sql = yield* SqlClient.SqlClient
          // What its findings bring back, as the rule said when the merge was heard: what doesn't stays in the thread, quietly.
          const decoded = row.reviewer === null ? Option.none() : decodeReviewer(row.reviewer)
          const rule = Option.isSome(decoded) ? (decoded.value.bringsBack ?? 'major') : 'major'
          const found = report.verdict === 'changes_requested' && bringsBack(rule, report.findings)
          const kept = report.verdict === 'changes_requested' && !found && report.findings.length > 0
          const [reviewer] = yield* sql<{ agentId: string }>`SELECT agent_id FROM provider_sessions WHERE id = ${access.sessionId}`
          const threadId = yield* taskThreadOf(row.taskId)
          // Its state and its report in the task's thread together: where the report can't be kept, the review still waits for
          // it, and the reviewer's Try again is taken.
          yield* sql.withTransaction(
            Effect.gen(function* () {
              yield* setState(row.url, {
                state: found ? 'found' : 'clear',
                verdict: report.verdict,
                summary: report.summary,
                findings: JSON.stringify(report.findings),
                message: null,
              })
              if (threadId !== undefined)
                yield* addItem({ projectId: row.projectId, threadId, sessionId: access.sessionId }, 'step_result', {
                  step: 'review',
                  round: 0,
                  verdict: report.verdict,
                  summary: report.summary,
                  findings: report.findings,
                  agentId: reviewer?.agentId ?? null,
                  ...(report.model === null ? {} : { model: report.model }),
                  afterMerge: { url: row.url, words: wordsOf(row), ...(kept ? { kept: true } : {}) },
                })
            }),
          )
          yield* touchTask(row.taskId)
          yield* Effect.forkIn(provide(doneWith(row, access.threadId)), scope)
          return found
            ? 'Althar has your review. The change merged already: the person decides whether the lead fixes what you found.'
            : kept
              ? 'Althar has your review. Nothing in it is blocking or major, so it stays in the thread for the person to read, and nothing waits on them.'
              : 'Althar has your review. The merged change passes.'
        }).pipe(
          Effect.catch((error) =>
            error instanceof ToolRefused
              ? Effect.fail(error)
              : Effect.andThen(
                  Effect.logWarning('Could not keep a review after a merge', error),
                  Effect.fail(new ToolRefused({ message: 'Althar could not record that. Try again.' })),
                ),
          ),
        )

      /** The task's review after a merge whose findings wait on the person: the one asked for, else the latest. */
      const waitingOf = (taskId: string, url: string | undefined) =>
        Effect.gen(function* () {
          const found = (yield* rowsOf(taskId)).filter((row) => row.state === 'found' && (url === undefined || row.url === url))
          const row = found.at(-1)
          if (row === undefined) return yield* new MergeReviewRefused({ message: 'No review after a merge waits on you here.' })
          return row
        })

      const fix = (taskId: string, url?: string) =>
        Effect.gen(function* () {
          const row = yield* waitingOf(taskId, url)
          const findings = Option.getOrElse(decodeFindings(row.findings), (): ReadonlyArray<Found> => [])
          const threadId = yield* taskThreadOf(taskId)
          if (threadId === undefined) return yield* new MergeReviewRefused({ message: 'The task has no lead to fix it.' })
          yield* setState(row.url, { state: 'fixing' })
          const body = fixBrief(wordsOf(row), listed(findings))
          yield* sessions.send({
            envelope: yield* envelope('thread.send', { threadId, afterMerge: row.url }),
            threadId,
            body,
            sender: { kind: 'window' },
            disposition: 'after_current',
          })
          // A settled task's lead has gone: it starts again for this, as it would for anything the person says.
          if (Option.isNone(yield* sessions.running(threadId))) yield* Effect.ignore(sessions.startLast(threadId))
          const sql = yield* SqlClient.SqlClient
          const [input] = yield* sql<{ id: string }>`
            SELECT id FROM user_inputs WHERE thread_id = ${threadId} ORDER BY sequence DESC LIMIT 1`
          yield* addItem({ projectId: row.projectId, threadId }, 'notice', {
            source: 'runtime',
            severity: 'info',
            title: `Fix it: the lead takes the ${countOf(findings.length, 'finding')} after ${wordsOf(row)} merged, and its fix goes out after it.`,
            description: null,
            // What the lead was given, for the pull request its fix opens to say what it answers (Changes.followUpOf).
            fixing: { url: row.url, findings },
          })
          yield* touchTask(taskId)
          return { threadId, inputId: input?.id ?? null }
        })

      const leave = (taskId: string, url?: string) =>
        Effect.gen(function* () {
          const row = yield* waitingOf(taskId, url)
          const findings = Option.getOrElse(decodeFindings(row.findings), (): ReadonlyArray<Found> => [])
          yield* setState(row.url, { state: 'left' })
          const threadId = yield* taskThreadOf(taskId)
          if (threadId !== undefined)
            yield* addItem({ projectId: row.projectId, threadId }, 'notice', {
              source: 'runtime',
              severity: 'info',
              title: `Left the ${countOf(findings.length, 'finding')} after ${wordsOf(row)} merged.`,
              description: null,
            })
          yield* touchTask(taskId)
        })

      const afterTurnOf = (threadId: string, inputId: string | null) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const over = Effect.gen(function* () {
            if (inputId === null) return true
            const [row] = yield* sql<{ endedAt: string | null }>`
              SELECT d.ended_at FROM turn_delivery_inputs di JOIN turn_deliveries d ON d.id = di.delivery_id
              WHERE di.user_input_id = ${inputId} ORDER BY d.requested_at DESC LIMIT 1`
            return row?.endedAt != null
          })
          if (yield* over) return
          const events = yield* live.subscribe
          yield* Stream.runForEachWhile(events, (event) =>
            event._tag === 'TurnEnded' && event.threadId === threadId ? Effect.map(over, (done) => !done) : Effect.succeed(true),
          )
        }).pipe(Effect.scoped, Effect.timeout(Duration.hours(2)), Effect.ignore)

      const ofTask = (taskId: string) =>
        Effect.map(rowsOf(taskId), (rows) =>
          rows.map((row): MergeReview => ({
            url: row.url,
            taskId: row.taskId,
            number: row.number,
            words: wordsOf(row),
            state: row.state,
            summary: row.summary,
            findings: Option.getOrElse(decodeFindings(row.findings), (): ReadonlyArray<Found> => []),
            message: row.message,
          })),
        )

      const reconcileMerged = (taskId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const links = yield* sql<{ url: string }>`SELECT url FROM external_links
            WHERE task_id = ${taskId} AND kind = 'change' AND json_extract(snapshot, '$.state') = 'merged'`
          for (const link of links) yield* merged(taskId, link.url)
        })

      const choose = (taskId: string, review: TaskAfterMerge | null, actorId: ActorId, prepare?: Effect.Effect<void, unknown>) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [task] = yield* sql<{ projectId: ProjectId; revision: number }>`
            SELECT project_id AS projectId, revision FROM tasks WHERE id = ${taskId}`
          if (task === undefined) return yield* new MergeReviewRefused({ message: 'That task isn’t here any more.' })
          const configured = yield* reviewerOf(taskId)
          if (review === 'review' && configured === undefined)
            return yield* new MergeReviewRefused({
              message: 'Its plan names no reviewer, so there is nobody to review it after it merges.',
            })
          const links = yield* sql<{ url: string; snapshot: string }>`
            SELECT url, snapshot FROM external_links WHERE task_id = ${taskId} AND kind = 'change' ORDER BY created_at, rowid`
          // As Changes.latestOf does: each repository's open pull request, else its newest. Earlier merges keep their saved
          // reviewer and rule; they do not settle what a new follow-up, or an unmerged sibling, should do.
          const current = new Map<string, { readonly url: string; readonly state: string | undefined }>()
          for (const link of links) {
            const snapshot = JSON.parse(link.snapshot) as { readonly state?: string; readonly repository?: ReadonlyArray<string> }
            const repository = snapshot.repository?.join('/').toLowerCase() ?? link.url
            if (current.get(repository)?.state !== 'open') current.set(repository, { url: link.url, state: snapshot.state })
          }
          const reviews = yield* rowsOf(taskId)
          // The task's choice is shared by its repositories. Debt saved before a merge still reads it when that merge lands:
          // changing it for a sibling now would also change that debt. Once the merged head is saved, its choice is independent.
          if (reviews.some((row) => row.head === null && (row.state === 'owed' || row.state === 'running')))
            return yield* new MergeReviewRefused({
              message: 'A pull request is waiting to merge with its review already saved. Change this choice after that merge finishes.',
            })
          const saved = new Set(reviews.map((row) => row.url))
          const mutable = [...current.values()].some((link) => link.state !== 'merged' && !saved.has(link.url))
          if (current.size === 0 ? saved.size > 0 : !mutable)
            return yield* new MergeReviewRefused({ message: 'It merged already: what its review after the merge does was settled then.' })
          // Older launches may have heard a merge without recording its no-debt decision. Reconcile those links under the
          // old plan and policy before a future choice changes either; genuine missing debt is repaired as before.
          yield* reconcileMerged(taskId)
          if ((yield* rowsOf(taskId)).some((row) => row.head === null && (row.state === 'owed' || row.state === 'running')))
            return yield* new MergeReviewRefused({
              message: 'A pull request is waiting to merge with its review already saved. Change this choice after that merge finishes.',
            })
          if (prepare !== undefined) yield* prepare
          const was = yield* afterMergeNow(taskId)
          if (was.task !== review)
            yield* fact({
              projectId: task.projectId,
              aggregateType: 'task',
              aggregateId: taskId,
              revision: task.revision,
              type: TASK_AFTER_MERGE_SET,
              payload: { review },
              actorId,
            })
          yield* touchTask(taskId)
          return yield* afterMergeNow(taskId)
        })

      /*
       * A reviewer whose turn ended without its report is told once more to
       * make it; ending again without one, its review stops, said in the
       * task's thread with Try again.
       */
      const reminded = new Set<string>()
      const watched = (event: Extract<LiveEvent, { readonly _tag: 'TurnEnded' }>) =>
        Effect.gen(function* () {
          const row = yield* runningOn(event.threadId)
          if (row === undefined) return
          const key = `${row.url}`
          if (event.state !== 'completed' || event.errorClass !== undefined) {
            // A turn that failed (out of usage, out of reach) is tried again by the retry, from the start: after a longer wait each
            // time, as each try is a session starting on the task.
            if (event.errorClass !== undefined && event.errorClass !== 'turn_in_progress') {
              const sql = yield* SqlClient.SqlClient
              yield* sql`
                UPDATE merge_reviews SET state = 'owed', attempts = attempts + 1, message = ${`Its reviewer’s turn failed (${event.errorClass}).`},
                  updated_at = ${yield* timestamp}
                WHERE url = ${row.url}`
            }
            return
          }
          if (!reminded.has(key)) {
            reminded.add(key)
            return yield* sessions.send({
              envelope: yield* envelope('thread.send', { threadId: event.threadId, remind: row.url }, undefined, instance.systemId),
              threadId: event.threadId,
              body: "Your review isn't done until you call Althar's report_review tool. Call it now with your verdict, a summary and your findings.",
              quiet: true,
            })
          }
          reminded.delete(key)
          yield* setState(row.url, { state: 'stopped', message: 'Its reviewer ended without saying what it found.' })
          const threadId = yield* taskThreadOf(row.taskId)
          if (threadId !== undefined)
            yield* addItem({ projectId: row.projectId, threadId }, 'notice', {
              source: 'runtime',
              severity: 'warning',
              title: `The review after ${wordsOf(row)} merged stopped: its reviewer ended without saying what it found.`,
              description: null,
            })
          yield* touchTask(row.taskId)
          yield* Effect.forkIn(provide(doneWith(row, event.threadId)), scope)
        })
      const events = yield* live.subscribe
      yield* Effect.forkScoped(
        Stream.runForEach(events, (event) =>
          event._tag !== 'TurnEnded'
            ? Effect.void
            : provide(watched(event)).pipe(
                Effect.catchCause((cause) =>
                  Cause.hasInterruptsOnly(cause) ? Effect.interrupt : Effect.logWarning('Could not check a review after a merge', cause),
                ),
              ),
        ),
      )

      return MergeReviews.of({
        merged: (taskId, url) =>
          provide(decisions.withLock(taskId, merged(taskId, url))).pipe(
            Effect.catchCause((cause) => Effect.logWarning('Could not owe a review after a merge', cause)),
          ),
        owe: (taskId, url, marks) => provide(decisions.withLock(taskId, owe(taskId, url, marks))),
        retry: () => provide(retry).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not start reviews after a merge', cause))),
        owns: (threadId) => provide(owns(threadId)),
        reported: (access, report) => provide(reported(access, report)),
        fix: (taskId, url) => provide(fix(taskId, url)),
        leave: (taskId, url) => provide(leave(taskId, url)),
        afterTurnOf: (threadId, inputId) => provide(afterTurnOf(threadId, inputId)),
        ofTask: (taskId) => provide(ofTask(taskId)),
        choose: (taskId, review, actorId, prepare) => provide(decisions.withLock(taskId, choose(taskId, review, actorId, prepare))),
        beforeChange: (taskId, change) =>
          provide(
            decisions.withLock(
              taskId,
              Effect.gen(function* () {
                yield* reconcileMerged(taskId)
                if ((yield* rowsOf(taskId)).some((row) => row.head === null && (row.state === 'owed' || row.state === 'running')))
                  return yield* new MergeReviewRefused({
                    message:
                      'A pull request is waiting to merge with its review already saved. Change this choice after that merge finishes.',
                  })
                return yield* change
              }),
            ),
          ),
      })
    }),
  )
}
