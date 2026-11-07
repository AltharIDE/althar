import type { ProjectId } from '@althar/domain'
import type { Ledger } from '@althar/persistence-sqlite'
import { Context, type Crypto, Effect, Layer, Option, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { envelope } from './envelope'
import { Instance } from './Instance'
import { ReviewRefused, Reviews } from './Reviews'
import { Sessions } from './Sessions'
import { timestamp } from './records'
import { smallChangeOf } from './smallChange'
import { addItem, updateItem } from './threads'
import { summarize } from './words'

/*
 * The fast lane's doings (README sections 6 and 7): Make it a full task,
 * which starts the review of an open change instead of waiting for its merge;
 * the review a small change's merge starts; and the person's keep of the
 * heavier model after Auto moved the lead to a lighter one.
 *
 * A small change's card is read from the task as it stands (Queries), so
 * nothing here writes a card: starting its review is enough for the card to
 * say the review went ahead, and keeping a model is a row Auto reads.
 */

/** Why the fast lane couldn't do what the person pressed, in words for the window. */
export class FastLaneRefused extends Schema.TaggedError<FastLaneRefused>()('FastLaneRefused', { message: Schema.String }) {}

type Store = SqlClient.SqlClient | Instance | Reviews | Sessions | Ledger | Crypto.Crypto

/** The item a card is, as the store keeps it. */
interface Card {
  readonly id: string
  readonly projectId: ProjectId
  readonly content: Readonly<Record<string, unknown>>
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object' && value !== null

export class FastLane extends Context.Service<
  FastLane,
  {
    /**
     * Makes a small change a full task: its change is reviewed before it
     * merges, by the reviewer its plan named. The card folds to a line
     * linking the review. Refused where there is no open change to review, or
     * the plan named no reviewer.
     */
    makeFullTask(taskId: string): Effect.Effect<void, unknown>
    /** Keeps the heavier model for this task, as the line Auto moved the lead with offers: Auto moves nothing more here. */
    keepTheModel(itemId: string): Effect.Effect<void, unknown>
    /** Puts the move Auto made again: the task's lead may move to the lighter model at its next step. */
    undoTheModelMove(itemId: string): Effect.Effect<void, unknown>
    /**
     * Keeps that a small change merged and its review is owed, before it is
     * tried: a launch that stops before it starts is tried again after.
     */
    markReviewPending(taskId: string, projectId: ProjectId): Effect.Effect<void, unknown>
    /**
     * A small change merged: its review starts, reading the merged change,
     * unless a review of it is already under way or over. Where it can't
     * start, its reason is a line in the task's thread and it is tried again.
     */
    reviewMerged(taskId: string): Effect.Effect<void, unknown>
    /** Tries again every review after a merge that didn't start, until one does. */
    retryPendingReviews(): Effect.Effect<void, unknown>
  }
>()('@althar/runtime/FastLane') {
  static readonly layer: Layer.Layer<FastLane, never, Store> = Layer.effect(
    FastLane,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const instance = yield* Instance
      const reviews = yield* Reviews
      const sessions = yield* Sessions
      const context = yield* Effect.context<Store>()
      const provide = <A, E>(effect: Effect.Effect<A, E, Store>) => Effect.provideContext(effect, context)

      const card = (itemId: string, kind: 'small_change' | 'model_move') =>
        Effect.gen(function* () {
          const [row] = yield* sql<{ id: string; projectId: ProjectId; content: string }>`
            SELECT id, project_id AS projectId, content FROM thread_items WHERE id = ${itemId} AND kind = ${kind}`
          if (row === undefined) return undefined
          const content = JSON.parse(row.content) as unknown
          return isRecord(content) ? ({ ...row, content } satisfies Card) : undefined
        })

      /** The reviewer a small change's plan names, and the plan's change URL, read from the task as it stands. */
      const planOf = (taskId: string) =>
        Effect.gen(function* () {
          const [plan] = yield* sql<{ parameters: string }>`
            SELECT parameters FROM task_plans WHERE task_id = ${taskId} ORDER BY proposed_at DESC, rowid DESC LIMIT 1`
          return smallChangeOf(plan?.parameters ?? null)
        })

      /** Where a task's open or merged change is: its URL, and whether it merged. */
      const changeOf = (taskId: string) =>
        Effect.gen(function* () {
          const [link] = yield* sql<{ url: string; snapshot: string }>`
            SELECT url, snapshot FROM external_links WHERE task_id = ${taskId} AND kind = 'change'
            ORDER BY created_at DESC, rowid DESC LIMIT 1`
          if (link === undefined) return undefined
          let state = 'open'
          try {
            const kept = JSON.parse(link.snapshot) as unknown
            if (isRecord(kept) && typeof kept.state === 'string') state = kept.state
          } catch {
            // A snapshot Althar can't read is taken as an open change.
          }
          return { url: link.url, state }
        })

      /** Whether a review task of that change exists, still open or over. */
      const reviewed = (url: string) =>
        Effect.gen(function* () {
          const [row] = yield* sql<{ one: number }>`
            SELECT 1 AS one FROM external_links WHERE kind = 'review' AND url = ${url} LIMIT 1`
          return row !== undefined
        })

      /**
       * Starts the review of a change, by the reviewer its plan named.
       * Refused where the plan named none, or the change isn't there.
       */
      const startReview = (taskId: string, input: { readonly afterMerge: boolean; readonly request: string }) =>
        Effect.gen(function* () {
          const plan = yield* planOf(taskId)
          if (plan === undefined || plan.review === null)
            return yield* new FastLaneRefused({
              message: 'Its plan names no reviewer, so Althar can’t start one. Ask for a review of it instead.',
            })
          const change = yield* changeOf(taskId)
          if (change === undefined) return yield* new FastLaneRefused({ message: 'It has no pull request to review yet.' })
          if (yield* reviewed(change.url)) return
          const commandId = `cmd_${(yield* Effect.sync(() =>
            Buffer.from(`${taskId}\u0000${change.url}\u0000${input.afterMerge ? 'after' : 'before'}`).toString('hex'),
          )).slice(0, 32)}`
          yield* reviews
            .start({
              envelope: yield* envelope(
                'task.review',
                { taskId, afterMerge: input.afterMerge },
                commandId,
                input.afterMerge ? instance.systemId : instance.personId,
              ),
              projectId: (yield* projectOf(taskId)) as ProjectId,
              pullRequest: change.url,
              lead: {
                agentId: plan.review.agentId,
                model: plan.review.model,
                ...(plan.review.effort === undefined || plan.review.effort === null ? {} : { effort: plan.review.effort }),
              },
              request: input.request,
              ...(input.afterMerge ? { afterMerge: true } : {}),
            })
            .pipe(Effect.mapError((error) => (error instanceof ReviewRefused ? new FastLaneRefused({ message: error.message }) : error)))
        })

      const projectOf = (taskId: string) =>
        Effect.gen(function* () {
          const [row] = yield* sql<{ projectId: string }>`SELECT project_id AS projectId FROM tasks WHERE id = ${taskId}`
          if (row === undefined) return yield* new FastLaneRefused({ message: 'That task isn’t here any more.' })
          return row.projectId
        })

      /** The task's own thread, where its lines go. */
      const threadOf = (taskId: string) =>
        Effect.gen(function* () {
          const [row] = yield* sql<{ threadId: string }>`
            SELECT id AS threadId FROM threads WHERE task_id = ${taskId} AND kind = 'task' ORDER BY rowid LIMIT 1`
          return row?.threadId
        })

      /** The line that says a review after a merge hasn't started, where the task has one. */
      const pendingOf = (threadId: string) =>
        Effect.gen(function* () {
          const [row] = yield* sql<{ id: string; content: string }>`
            SELECT id, content FROM thread_items WHERE thread_id = ${threadId} AND kind = 'notice'
              AND json_extract(content, '$.reviewAfterMerge') = 1 ORDER BY sequence DESC LIMIT 1`
          return row
        })

      /** Says in the task's thread why the review after the merge hasn't started, once: its line stays until it does. */
      const pendingNote = (threadId: string, projectId: ProjectId, message: string) =>
        Effect.gen(function* () {
          const had = yield* pendingOf(threadId)
          const before = had === undefined ? 0 : ((JSON.parse(had.content) as { attempts?: number }).attempts ?? 0)
          const content = {
            source: 'runtime',
            severity: 'warning',
            title: `The review after the merge didn’t start: ${message} Althar tries again.`,
            description: null,
            reviewAfterMerge: true,
            attempts: before + 1,
          }
          if (had === undefined) yield* addItem({ projectId, threadId }, 'notice', content)
          else yield* updateItem(projectId, had.id, content)
        })

      /** The line goes once the review starts, or once there is no reviewer to start it. */
      const clearPending = (threadId: string) =>
        sql`
          DELETE FROM thread_items WHERE thread_id = ${threadId} AND kind = 'notice'
            AND json_extract(content, '$.reviewAfterMerge') = 1`.pipe(Effect.asVoid)

      const makeFullTask = (taskId: string) =>
        Effect.gen(function* () {
          const change = yield* changeOf(taskId)
          yield* startReview(taskId, {
            afterMerge: change?.state === 'merged',
            request: 'Review this change before it merges: the person made it a full task. Say what you find.',
          })
        })

      const keepTheModel = (itemId: string) =>
        Effect.gen(function* () {
          const found = yield* card(itemId, 'model_move')
          if (found === undefined) return yield* new FastLaneRefused({ message: 'That line isn’t here any more.' })
          const taskId = typeof found.content.taskId === 'string' ? found.content.taskId : ''
          const from = isRecord(found.content.from) ? found.content.from : {}
          const agentId = typeof from.agentId === 'string' ? from.agentId : ''
          const model = typeof from.model === 'string' ? from.model : ''
          if (taskId === '' || agentId === '' || model === '')
            return yield* new FastLaneRefused({ message: 'That line names no model to keep.' })
          yield* sql`
            INSERT INTO task_model_keeps ${sql.insert({ taskId, agentId, model, keptAt: yield* timestamp })}
            ON CONFLICT (task_id) DO UPDATE SET agent_id = excluded.agent_id, model = excluded.model, kept_at = excluded.kept_at`
          yield* updateItem(found.projectId, itemId, { ...found.content, kept: true })
          // The lead on it now goes back too, not only the steps after it.
          const threadId = yield* threadOf(taskId)
          if (threadId !== undefined && Option.isSome(yield* sessions.running(threadId)))
            yield* sessions
              .setModel({ threadId, model })
              .pipe(Effect.catchCause((cause) => Effect.logWarning('Could not move a running lead back to its kept model', cause)))
        })

      const undoTheModelMove = (itemId: string) =>
        Effect.gen(function* () {
          const found = yield* card(itemId, 'model_move')
          if (found === undefined) return yield* new FastLaneRefused({ message: 'That line isn’t here any more.' })
          const taskId = typeof found.content.taskId === 'string' ? found.content.taskId : ''
          if (taskId !== '') yield* sql`DELETE FROM task_model_keeps WHERE task_id = ${taskId}`
          yield* updateItem(found.projectId, itemId, { ...found.content, kept: false })
        })

      /** Keeps that the review is owed, before it is tried: a stop before it starts loses nothing. */
      const markReviewPending = (taskId: string, projectId: ProjectId) =>
        Effect.gen(function* () {
          const plan = yield* planOf(taskId)
          if (plan === undefined || plan.review === null) return
          const now = yield* timestamp
          yield* sql`
            INSERT INTO reviews_after_merge ${sql.insert({
              taskId,
              projectId,
              attempts: 0,
              message: null,
              createdAt: now,
              updatedAt: now,
            })}
            ON CONFLICT (task_id) DO NOTHING`
        })

      /**
       * Starts the review a small change's merge promised. A failure is kept
       * as a line in the task's thread, and `retryPendingReviews` tries it
       * again: a host that is down for a moment, or a stop just after the
       * merge, loses no review.
       */
      const reviewMerged = (taskId: string) =>
        Effect.gen(function* () {
          const threadId = yield* threadOf(taskId)
          const plan = yield* planOf(taskId)
          // No plan, or no reviewer in it: nothing will start one, so no line and nothing to retry.
          if (plan === undefined || plan.review === null) {
            yield* clearReview(taskId, threadId)
            return
          }
          const change = yield* changeOf(taskId)
          if (change === undefined) {
            yield* clearReview(taskId, threadId)
            return
          }
          if (yield* reviewed(change.url)) {
            yield* clearReview(taskId, threadId)
            return
          }
          const projectId = (yield* projectOf(taskId)) as ProjectId
          // Called on its own, as from a retry, it is still one owed: keep it until it starts.
          yield* markReviewPending(taskId, projectId)
          const outcome = yield* Effect.exit(
            startReview(taskId, {
              afterMerge: true,
              request:
                'Review this change, which merged already: it went in on the fast lane, with its review after the merge. Say what you find, for the person.',
            }),
          )
          if (outcome._tag === 'Success') {
            yield* clearReview(taskId, threadId)
            return
          }
          const message = summarize(outcome.cause) || 'It couldn’t start.'
          yield* sql`
            UPDATE reviews_after_merge SET attempts = attempts + 1, message = ${message}, updated_at = ${yield* timestamp}
            WHERE task_id = ${taskId}`
          if (threadId !== undefined) yield* pendingNote(threadId, projectId, message)
        })

      /** The review exists, or none will: nothing is owed, and its line goes. */
      const clearReview = (taskId: string, threadId: string | undefined) =>
        Effect.andThen(
          sql`DELETE FROM reviews_after_merge WHERE task_id = ${taskId}`,
          threadId === undefined ? Effect.void : clearPending(threadId),
        ).pipe(Effect.asVoid)

      /**
       * Every task whose review after a merge is still owed: its line stays
       * until it starts. Also every merged small change with no review and
       * no row, which a stop between the merge's snapshot and its row leaves:
       * the merge is read again and the review is owed from there.
       */
      const retryPending = Effect.gen(function* () {
        const waiting = yield* sql<{ taskId: string }>`
          SELECT DISTINCT waiting.taskId FROM (
            SELECT r.task_id AS taskId FROM reviews_after_merge r
            JOIN tasks k ON k.id = r.task_id
            WHERE k.state <> 'abandoned' AND k.project_id IN (SELECT id FROM projects WHERE archived_at IS NULL)
            UNION
            SELECT x.task_id AS taskId FROM external_links x
            JOIN tasks k ON k.id = x.task_id
            WHERE x.kind = 'change' AND json_extract(x.snapshot, '$.state') = 'merged'
              AND k.state <> 'abandoned' AND k.project_id IN (SELECT id FROM projects WHERE archived_at IS NULL)
              AND EXISTS (
                SELECT 1 FROM task_plans p WHERE p.task_id = x.task_id
                  AND json_extract(p.parameters, '$.reviewAfterMerge') = 1
              )
              AND NOT EXISTS (SELECT 1 FROM external_links rv WHERE rv.kind = 'review' AND rv.url = x.url)
          ) waiting`
        for (const one of waiting)
          yield* reviewMerged(one.taskId).pipe(
            Effect.catchCause((cause) => Effect.logWarning('Could not try a review after a merge again', cause)),
          )
      }).pipe(Effect.asVoid)

      return FastLane.of({
        makeFullTask: (taskId) => provide(makeFullTask(taskId)).pipe(Effect.asVoid),
        markReviewPending: (taskId, projectId) => provide(markReviewPending(taskId, projectId)).pipe(Effect.asVoid),
        keepTheModel: (itemId) => provide(keepTheModel(itemId)).pipe(Effect.asVoid),
        undoTheModelMove: (itemId) => provide(undoTheModelMove(itemId)).pipe(Effect.asVoid),
        reviewMerged: (taskId) =>
          provide(reviewMerged(taskId)).pipe(
            Effect.catchCause((cause) => Effect.logWarning('Could not start the review after a merge', cause)),
            Effect.asVoid,
          ),
        retryPendingReviews: () => provide(retryPending).pipe(Effect.asVoid),
      })
    }),
  )
}
