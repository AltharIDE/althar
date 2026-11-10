import { existsSync } from 'node:fs'

import { Ids, newId, type ProjectId } from '@althar/domain'
import type { Ledger } from '@althar/persistence-sqlite'
import { Cause, Context, type Crypto, Duration, Effect, Layer, Option, Schema, Scope, Stream } from 'effect'
import { SqlClient } from 'effect/sql'

import { touchTask } from './cards'
import { envelope } from './envelope'
import { git } from './git'
import { Instance } from './Instance'
import { Live, type LiveEvent } from './Live'
import { timestamp } from './records'
import { MERGE_REVIEW, mergeCopyOf } from './reviewCopy'
import { Sessions } from './Sessions'
import { addItem } from './threads'
import { ToolRefused } from './toolErrors'
import { summarize } from './words'

/*
 * The review after a merge, in the same task (a task is a conversation plus
 * parts, "After merge, in the same task"). Where a task with a reviewer has
 * a pull request merge with something of it no review read (the small-change
 * lane, or what Merge now merged), that pull request is owed a review. The
 * task's own reviewer reads a copy at the merged head, from what the last
 * review read, in a thread of the task's own (`merge_review`), and reports
 * in the task's thread. Nothing is posted on the merged pull request.
 *
 * The merge ends only that change: the task settles where it was its last,
 * and the review runs on all the same, spared by the sweep that settling
 * starts (LeftBehind.ts). Found nothing, it is a line in the thread. Found
 * something, the task is in Needs you for that change, until the person
 * says Fix it, which hands the findings to the lead in a turn that ships as
 * a new change after the merged one, or Leave it. A restart mid-review
 * starts it again; one that couldn't start is tried again until it does.
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

/** Who reviews: the plan's reviewer. */
const Reviewer = Schema.Struct({
  agentId: Schema.String,
  model: Schema.NullOr(Schema.String),
  effort: Schema.optional(Schema.NullOr(Schema.String)),
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

/** Why a press on a review after a merge did nothing, in words for the window. */
export class MergeReviewRefused extends Schema.TaggedError<MergeReviewRefused>()('MergeReviewRefused', { message: Schema.String }) {}

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

const countOf = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

type Store = SqlClient.SqlClient | Instance | Sessions | Live | Ledger | Crypto.Crypto

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
          const review = steps.find((step): step is Reviewer & { readonly key: string } => (step as { key?: unknown })?.key === 'review')
          if (review === undefined || typeof review.agentId !== 'string') return undefined
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

      /**
       * A pull request merged. One owed already (Merge now owed it as it merged) starts; else, on the small-change lane, it is
       * owed for what of it no review read, and starts. Any other merge was reviewed before it shipped.
       */
      const merged = (taskId: string, url: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          if ((yield* rowOf(url)) !== undefined) return yield* start(url)
          const plan = yield* reviewerOf(taskId)
          // A plan that named no reviewer gets no review after its merge.
          if (plan === undefined || !plan.afterMerge) return
          const { reviewer } = plan
          // Reviewed already in a review task of its own, as an Althar before this one did.
          const [reviewTask] = yield* sql<{
            one: number
          }>`SELECT 1 AS one FROM external_links WHERE kind = 'review' AND url = ${url} LIMIT 1`
          if (reviewTask !== undefined) return
          const [link] = yield* sql<{ projectId: ProjectId; snapshot: string }>`
            SELECT project_id, snapshot FROM external_links WHERE task_id = ${taskId} AND kind = 'change' AND url = ${url}
            ORDER BY created_at DESC, rowid DESC LIMIT 1`
          if (link === undefined) return
          const snapshot = JSON.parse(link.snapshot) as { readonly number?: unknown; readonly headSha?: unknown; readonly state?: unknown }
          if (snapshot.state !== 'merged') return
          const head = typeof snapshot.headSha === 'string' && snapshot.headSha !== '' ? snapshot.headSha : null
          const number = typeof snapshot.number === 'number' ? snapshot.number : null
          const place = yield* placeOf(taskId, url)
          const dir = place === undefined ? null : gitDirOf(place)
          const commit = place === undefined || dir === null ? null : yield* mergedCommit(dir, head, number, place)
          // What the last review read: the merged head itself, and nothing is owed.
          const upTo = place === undefined || dir === null || commit === null ? null : yield* reviewedUpTo(place.id, dir, commit)
          if (upTo !== null && upTo === commit) return
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
              reviewer: JSON.stringify(plan.reviewer),
              findings: '[]',
              attempts: 0,
              createdAt: at,
              updatedAt: at,
            })}
            ON CONFLICT (url) DO UPDATE SET state = 'owed', base = excluded.base, head = NULL, updated_at = excluded.updated_at
            WHERE merge_reviews.state IN ('owed', 'stopped')`
        })

      /** The merged head, where the review owed has none yet: what its pull request's host last said, once it merged. */
      const headOf = (row: Row) =>
        Effect.gen(function* () {
          if (row.head !== null) return { row, merged: true }
          const sql = yield* SqlClient.SqlClient
          const [link] = yield* sql<{ snapshot: string }>`
            SELECT snapshot FROM external_links WHERE task_id = ${row.taskId} AND kind = 'change' AND url = ${row.url}
            ORDER BY created_at DESC, rowid DESC LIMIT 1`
          const snapshot = link === undefined ? {} : (JSON.parse(link.snapshot) as { readonly state?: unknown; readonly headSha?: unknown })
          if (snapshot.state === 'closed') {
            yield* setState(row.url, { state: 'stopped', message: 'It closed without merging.' })
            return { row, merged: false }
          }
          if (snapshot.state !== 'merged' || typeof snapshot.headSha !== 'string') return { row, merged: false }
          yield* sql`UPDATE merge_reviews SET head = ${snapshot.headSha} WHERE url = ${row.url}`
          return { row: { ...row, head: snapshot.headSha }, merged: true }
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
                ...(reviewer.value.model === null ? {} : { model: reviewer.value.model }),
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
          const found = report.verdict === 'changes_requested' && report.findings.length > 0
          yield* setState(row.url, {
            state: found ? 'found' : 'clear',
            verdict: report.verdict,
            summary: report.summary,
            findings: JSON.stringify(report.findings),
            message: null,
          })
          const [reviewer] = yield* sql<{ agentId: string }>`SELECT agent_id FROM provider_sessions WHERE id = ${access.sessionId}`
          const threadId = yield* taskThreadOf(row.taskId)
          if (threadId !== undefined)
            yield* addItem({ projectId: row.projectId, threadId, sessionId: access.sessionId }, 'step_result', {
              step: 'review',
              round: 0,
              verdict: report.verdict,
              summary: report.summary,
              findings: report.findings,
              agentId: reviewer?.agentId ?? null,
              ...(report.model === null ? {} : { model: report.model }),
              afterMerge: { url: row.url, words: wordsOf(row) },
            })
          yield* touchTask(row.taskId)
          yield* Effect.forkIn(provide(doneWith(row, access.threadId)), scope)
          return found
            ? 'Althar has your review. The change merged already: the person decides whether the lead fixes what you found.'
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
          const body = `Fix what the review after ${wordsOf(row)} merged found. ${wordsOf(row)} merged already: commit your fix on the task's branch, and it goes out as a new pull request after it once your turn is over.\n\n${listed(findings)}`
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
            // A turn that failed (out of usage, out of reach) is tried again by the retry, from the start.
            if (event.errorClass !== undefined && event.errorClass !== 'turn_in_progress') yield* setState(row.url, { state: 'owed' })
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
          provide(merged(taskId, url)).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not owe a review after a merge', cause))),
        owe: (taskId, url, marks) => provide(owe(taskId, url, marks)),
        retry: () => provide(retry).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not start reviews after a merge', cause))),
        owns: (threadId) => provide(owns(threadId)),
        reported: (access, report) => provide(reported(access, report)),
        fix: (taskId, url) => provide(fix(taskId, url)),
        leave: (taskId, url) => provide(leave(taskId, url)),
        afterTurnOf: (threadId, inputId) => provide(afterTurnOf(threadId, inputId)),
        ofTask: (taskId) => provide(ofTask(taskId)),
      })
    }),
  )
}
