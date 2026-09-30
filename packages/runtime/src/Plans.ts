import { type ActorId, Ids, newId, type ProjectId } from '@charrette/domain'
import type { Ledger } from '@charrette/persistence-sqlite'
import { Context, type Crypto, Duration, Effect, Layer, Queue } from 'effect'
import { SqlClient } from 'effect/sql'

import { postCard, touchCard } from './cards'
import { NotFound } from './errors'
import { Instance } from './Instance'
import { change, fact, timestamp } from './records'
import { type PlanStep, Runs } from './Runs'

/*
 * A task's plan before it runs (docs/architecture/04): its steps and who does
 * them, and when it starts. The coordinator proposes it; its card shows in
 * the coordinator's thread with the time left; leaving it alone starts it.
 * The runtime keeps the countdown, so a plan starts with the window closed.
 * A plan whose time came while Charrette wasn't running is held, not started
 * unannounced at the next launch.
 */

/** How long a proposed plan waits before it starts on its own (docs/plans/mvp.md). */
export const COUNTDOWN = Duration.seconds(25)

type Store = SqlClient.SqlClient | Instance | Runs | Ledger | Crypto.Crypto

export class Plans extends Context.Service<
  Plans,
  {
    /** Proposes a task's plan; it starts on its own after the countdown, or at once with `startsIn` zero. */
    propose(input: {
      readonly projectId: ProjectId
      readonly taskId: string
      readonly steps: ReadonlyArray<PlanStep>
      readonly reason: string | null
      readonly actorId: ActorId
      readonly startsIn?: Duration.Duration
    }): Effect.Effect<string, unknown>
    /** Starts a proposed plan now. */
    start(planId: string, actorId: ActorId): Effect.Effect<void, unknown>
    /** Holds a proposed plan until someone starts it. */
    hold(planId: string, actorId: ActorId): Effect.Effect<void, unknown>
    /** Changes a proposed plan's steps: who does them, or which are skipped. */
    change(planId: string, steps: ReadonlyArray<PlanStep>, actorId: ActorId): Effect.Effect<void, unknown>
  }
>()('@charrette/runtime/Plans') {
  static readonly layer: Layer.Layer<Plans, never, Store> = Layer.effect(
    Plans,
    Effect.gen(function* () {
      const context = yield* Effect.context<Store>()
      const instance = yield* Instance
      const runs = yield* Runs
      const provide = <A, E>(effect: Effect.Effect<A, E, Store>) => Effect.provideContext(effect, context)
      /** Wakes the countdown when a plan changes. */
      const wake = yield* Queue.sliding<void>(1)

      const load = (planId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [plan] = yield* sql<{ projectId: ProjectId; taskId: string; state: string; parameters: string; startsAt: string | null }>`
            SELECT project_id, task_id, state, parameters, starts_at FROM task_plans WHERE id = ${planId}`
          return plan === undefined ? yield* new NotFound({ kind: 'plan', id: planId }) : plan
        })

      /** Records a change to a plan, tells its card, and wakes the countdown. */
      const record = (
        planId: string,
        plan: { readonly projectId: ProjectId; readonly taskId: string },
        set: Readonly<Record<string, unknown>>,
        type: string,
        actorId: ActorId,
      ) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          yield* sql.withTransaction(
            Effect.gen(function* () {
              const revision = yield* change('task_plans', planId, set)
              yield* fact({ projectId: plan.projectId, aggregateType: 'task_plan', aggregateId: planId, revision, type, actorId })
            }),
          )
          yield* touchCard(plan.taskId)
          yield* Queue.offer(wake, undefined)
        })

      const propose: Plans['Service']['propose'] = (input) =>
        provide(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient
            const planId = yield* newId(Ids.taskPlan)
            const workflowVersionId = yield* runs.workflowVersion
            const at = yield* timestamp
            const startsAt = new Date(Date.parse(at) + Duration.toMillis(input.startsIn ?? COUNTDOWN)).toISOString()
            yield* sql.withTransaction(
              Effect.gen(function* () {
                // A task has one plan waiting: a new proposal replaces the one before.
                const earlier = yield* sql<{ id: string }>`SELECT id FROM task_plans WHERE task_id = ${input.taskId} AND state = 'proposed'`
                for (const plan of earlier) {
                  const revision = yield* change('task_plans', plan.id, { state: 'replaced', decidedAt: at })
                  yield* fact({
                    projectId: input.projectId,
                    aggregateType: 'task_plan',
                    aggregateId: plan.id,
                    revision,
                    type: 'task_plan.replaced',
                    actorId: input.actorId,
                  })
                }
                yield* sql`INSERT INTO task_plans ${sql.insert({
                  id: planId,
                  projectId: input.projectId,
                  taskId: input.taskId,
                  workflowVersionId,
                  parameters: JSON.stringify({ steps: input.steps, reason: input.reason }),
                  proposedByActorId: input.actorId,
                  state: 'proposed',
                  proposedAt: at,
                  startsAt,
                })}`
                yield* fact({
                  projectId: input.projectId,
                  aggregateType: 'task_plan',
                  aggregateId: planId,
                  revision: 1,
                  type: 'task_plan.proposed',
                  payload: { steps: input.steps, reason: input.reason, startsAt },
                  actorId: input.actorId,
                })
              }),
            )
            yield* postCard(input.projectId, input.taskId)
            yield* Queue.offer(wake, undefined)
            return planId
          }),
        )

      const start = (planId: string, actorId: ActorId) =>
        Effect.gen(function* () {
          const plan = yield* load(planId)
          if (plan.state !== 'proposed') return
          yield* record(planId, plan, { state: 'accepted', startsAt: null, decidedAt: yield* timestamp }, 'task_plan.accepted', actorId)
          yield* runs.run(planId)
        })

      // The countdown: the next plan due starts when its time comes, or sooner if a plan changes.
      const countdown = Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        for (;;) {
          const [next] = yield* sql<{ id: string; startsAt: string }>`
            SELECT id, starts_at FROM task_plans WHERE state = 'proposed' AND starts_at IS NOT NULL ORDER BY starts_at LIMIT 1`
          if (next === undefined) {
            yield* Queue.take(wake)
            continue
          }
          const wait = Date.parse(next.startsAt) - Date.now()
          if (wait > 0) {
            yield* Effect.raceFirst(Queue.take(wake), Effect.sleep(Duration.millis(wait)))
            continue
          }
          yield* start(next.id, instance.systemId).pipe(Effect.catchCause((cause) => Effect.logWarning('A plan could not start', cause)))
        }
      })

      // What came due while Charrette was closed waits for the person, rather than starting unannounced.
      yield* provide(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const overdue = yield* sql<{ id: string; projectId: ProjectId; taskId: string }>`
            SELECT id, project_id, task_id FROM task_plans WHERE state = 'proposed' AND starts_at IS NOT NULL AND starts_at < ${yield* timestamp}`
          for (const plan of overdue) yield* record(plan.id, plan, { startsAt: null }, 'task_plan.held', instance.systemId)
        }).pipe(
          Effect.catchCause((cause) => Effect.logWarning('Could not hold the plans that came due while Charrette was closed', cause)),
        ),
      )
      yield* Effect.forkScoped(provide(countdown))

      return Plans.of({
        propose,
        start: (planId, actorId) => provide(start(planId, actorId)),
        hold: (planId, actorId) =>
          provide(
            Effect.gen(function* () {
              const plan = yield* load(planId)
              if (plan.state === 'proposed') yield* record(planId, plan, { startsAt: null }, 'task_plan.held', actorId)
            }),
          ),
        change: (planId, steps, actorId) =>
          provide(
            Effect.gen(function* () {
              const plan = yield* load(planId)
              if (plan.state !== 'proposed') return
              const reason = (JSON.parse(plan.parameters) as { reason?: string | null }).reason ?? null
              yield* record(planId, plan, { parameters: JSON.stringify({ steps, reason }) }, 'task_plan.changed', actorId)
            }),
          ),
      })
    }),
  )
}
