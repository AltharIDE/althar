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
import { updateItem } from './threads'

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
     * A small change merged: its review starts, reading the merged change,
     * unless a review of it is already under way or over.
     */
    reviewMerged(taskId: string): Effect.Effect<void, unknown>
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
        })

      const undoTheModelMove = (itemId: string) =>
        Effect.gen(function* () {
          const found = yield* card(itemId, 'model_move')
          if (found === undefined) return yield* new FastLaneRefused({ message: 'That line isn’t here any more.' })
          const taskId = typeof found.content.taskId === 'string' ? found.content.taskId : ''
          if (taskId !== '') yield* sql`DELETE FROM task_model_keeps WHERE task_id = ${taskId}`
          yield* updateItem(found.projectId, itemId, { ...found.content, kept: false })
        })

      const reviewMerged = (taskId: string) =>
        Effect.gen(function* () {
          const plan = yield* planOf(taskId)
          if (plan === undefined || plan.review === null) return
          yield* startReview(taskId, {
            afterMerge: true,
            request:
              'Review this change, which merged already: it went in on the fast lane, with its review after the merge. Say what you find, for the person.',
          })
        }).pipe(Effect.catchCause(() => Effect.void))

      return FastLane.of({
        makeFullTask: (taskId) => provide(makeFullTask(taskId)).pipe(Effect.asVoid),
        keepTheModel: (itemId) => provide(keepTheModel(itemId)).pipe(Effect.asVoid),
        undoTheModelMove: (itemId) => provide(undoTheModelMove(itemId)).pipe(Effect.asVoid),
        reviewMerged: (taskId) => provide(reviewMerged(taskId)).pipe(Effect.asVoid),
      })
    }),
  )
}
