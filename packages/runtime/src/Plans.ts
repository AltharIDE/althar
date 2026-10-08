import { type ActorId, Ids, newId, type ProjectId } from '@althar/domain'
import type { Ledger } from '@althar/persistence-sqlite'
import { Context, type Crypto, Duration, Effect, Layer, Queue } from 'effect'
import { SqlClient } from 'effect/sql'

import { postCard, touchCard } from './cards'
import { NotFound } from './errors'
import { RuntimeConfig } from './Config'
import { Instance } from './Instance'
import { change, fact, timestamp } from './records'
import { type PlanStep, Runs, type TaskEnd } from './Runs'

/*
 * A task's plan before it runs (docs/architecture/04): its steps and who does
 * them, and when it starts. The coordinator proposes it; its card shows in
 * the coordinator's thread with the time left; leaving it alone starts it.
 * The runtime keeps the countdown, so a plan starts with the window closed.
 * A plan whose time came while Althar wasn't running is held, not started
 * unannounced at the next launch.
 */

/** How long a proposed plan waits before it starts on its own (docs/plans/mvp.md). */
export const COUNTDOWN = Duration.seconds(25)

type Store = SqlClient.SqlClient | Instance | Runs | Ledger | Crypto.Crypto | RuntimeConfig

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
      /** What happens when the work is done: a pull request, the branch pushed, or nothing outside. */
      readonly end?: TaskEnd | null
    }): Effect.Effect<string, unknown>
    /** Starts a proposed plan now. */
    start(planId: string, actorId: ActorId): Effect.Effect<void, unknown>
    /** Holds a proposed plan until someone starts it. */
    hold(planId: string, actorId: ActorId): Effect.Effect<void, unknown>
    /** Changes a proposed plan's steps (who does them, or which are skipped), and what happens when the work is done. */
    change(planId: string, steps: ReadonlyArray<PlanStep>, actorId: ActorId, end?: TaskEnd | null): Effect.Effect<void, unknown>
  }
>()('@althar/runtime/Plans') {
  static readonly layer: Layer.Layer<Plans, never, Store> = Layer.effect(
    Plans,
    Effect.gen(function* () {
      const context = yield* Effect.context<Store>()
      const instance = yield* Instance
      const runs = yield* Runs
      const countdownOf = (yield* RuntimeConfig).countdown ?? COUNTDOWN
      const provide = <A, E>(effect: Effect.Effect<A, E, Store>) => Effect.provideContext(effect, context)
      /** Wakes the countdown when a plan changes. */
      const wake = yield* Queue.sliding<void>(1)

      const load = (planId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [plan] = yield* sql<{ projectId: ProjectId; taskId: string; state: string; parameters: string; startsAt: string | null }>`
            SELECT project_id, task_id, state, parameters, starts_at FROM task_plans
            WHERE id = ${planId} AND project_id IN (SELECT id FROM projects WHERE archived_at IS NULL)`
          return plan === undefined ? yield* new NotFound({ kind: 'plan', id: planId }) : plan
        })

      type PlanRow = Effect.Success<ReturnType<typeof load>>

      /**
       * Changes a plan if it still stands as `when` needs, checked and changed
       * in one transaction, so a start and a hold, or two starts, can't both
       * happen. Then tells its card and wakes the countdown. Whether it changed.
       */
      const transition = (
        planId: string,
        when: (plan: PlanRow) => boolean,
        set: (plan: PlanRow) => Readonly<Record<string, unknown>>,
        type: string,
        actorId: ActorId,
      ) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const changed = yield* sql.withTransaction(
            Effect.gen(function* () {
              const plan = yield* load(planId)
              if (!when(plan)) return undefined
              const revision = yield* change('task_plans', planId, set(plan))
              yield* fact({ projectId: plan.projectId, aggregateType: 'task_plan', aggregateId: planId, revision, type, actorId })
              return plan
            }),
          )
          if (changed === undefined) return false
          yield* touchCard(changed.taskId)
          yield* Queue.offer(wake, undefined)
          return true
        })

      /** Whether a plan still counts down. */
      const counting = (plan: PlanRow) => plan.state === 'proposed' && plan.startsAt !== null

      const propose: Plans['Service']['propose'] = (input) =>
        provide(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient
            const planId = yield* newId(Ids.taskPlan)
            const workflowVersionId = yield* runs.workflowVersion
            const at = yield* timestamp
            const startsAt = new Date(Date.parse(at) + Duration.toMillis(input.startsIn ?? countdownOf)).toISOString()
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
                  parameters: JSON.stringify({ steps: input.steps, reason: input.reason, end: input.end ?? null }),
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
                  payload: { steps: input.steps, reason: input.reason, end: input.end ?? null, startsAt },
                  actorId: input.actorId,
                })
              }),
            )
            yield* postCard(input.projectId, input.taskId)
            yield* Queue.offer(wake, undefined)
            return planId
          }),
        )

      /** Starts a proposed plan: when the person says, or, `due`, when its countdown has ended and it isn't held. */
      const start = (planId: string, actorId: ActorId, due = false) =>
        Effect.gen(function* () {
          const at = yield* timestamp
          const accepted = yield* transition(
            planId,
            (plan) => (due ? counting(plan) && plan.startsAt !== null && plan.startsAt <= at : plan.state === 'proposed'),
            () => ({ state: 'accepted', startsAt: null, decidedAt: at }),
            'task_plan.accepted',
            actorId,
          )
          if (accepted) yield* runs.run(planId)
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
          yield* start(next.id, instance.systemId, true).pipe(
            Effect.catchCause((cause) => Effect.logWarning('A plan could not start', cause)),
          )
        }
      })

      // What came due while Althar was closed waits for the person, rather than starting unannounced.
      yield* provide(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const overdue = yield* sql<{ id: string }>`
            SELECT id FROM task_plans WHERE state = 'proposed' AND starts_at IS NOT NULL AND starts_at < ${yield* timestamp}`
          for (const plan of overdue) yield* transition(plan.id, counting, () => ({ startsAt: null }), 'task_plan.held', instance.systemId)
        }).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not hold the plans that came due while Althar was closed', cause))),
      )
      yield* Effect.forkScoped(provide(countdown))

      return Plans.of({
        propose,
        start: (planId, actorId) => provide(start(planId, actorId)),
        hold: (planId, actorId) =>
          provide(Effect.asVoid(transition(planId, counting, () => ({ startsAt: null }), 'task_plan.held', actorId))),
        change: (planId, steps, actorId, end) =>
          provide(
            Effect.asVoid(
              transition(
                planId,
                (plan) => plan.state === 'proposed',
                (plan) => {
                  const before = JSON.parse(plan.parameters) as { reason?: string | null; end?: TaskEnd | null }
                  return {
                    parameters: JSON.stringify({
                      steps,
                      reason: before.reason ?? null,
                      end: end === undefined ? (before.end ?? null) : end,
                    }),
                  }
                },
                'task_plan.changed',
                actorId,
              ),
            ),
          ),
      })
    }),
  )
}
