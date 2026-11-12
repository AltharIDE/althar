import { type ActorId, Ids, newId, type ProjectId, type WorksIn } from '@althar/domain'
import type { Ledger } from '@althar/persistence-sqlite'
import { Clock, Context, type Crypto, Duration, Effect, Layer, Queue } from 'effect'
import { SqlClient } from 'effect/sql'

import { postCard, touchCard } from './cards'
import { ChangeRefused, NotFound } from './errors'
import { backoff, keptGoing } from './Failures'
import { Accounts } from './Accounts'
import { Agents, RuntimeConfig } from './Config'
import { Installs } from './Installs'
import { Limits } from './Limits'
import { ModelFacts } from './ModelFacts'
import { Models } from './Models'
import { PlanUsage } from './PlanUsage'
import { presetModels } from './presetModels'
import { SignIns } from './SignIns'
import { usableModels } from './usableModels'
import { countdownNow } from './plansAndReviews'
import { Reviews } from './Reviews'
import { Instance } from './Instance'
import { offerPreset, planFromPreset, presetsIn, reviewerOfPreset } from './presets'
import { shelve } from './scratch'
import { change, fact, timestamp } from './records'
import { setToward } from './towards'
import { type PlanStep, Runs, type TaskEnd } from './Runs'

/*
 * A task's plan before it runs (docs/architecture/04): its steps and who does
 * them, and when it starts. The coordinator proposes it; its card shows in
 * the coordinator's thread with the time left; leaving it alone starts it.
 * Held, it waits until the person starts it.
 * The runtime keeps the countdown, so a plan starts with the window closed.
 * A plan whose time came while Althar wasn't running is held, not started
 * unannounced at the next launch.
 * A review of someone else's pull request has a plan too, of its lead alone
 * (`reads`): it has no run, and starting it starts its lead (Reviews.lead);
 * its lead is only ever one its session holds to reading.
 */

type Store =
  | SqlClient.SqlClient
  | Instance
  | Runs
  | Reviews
  | Ledger
  | Crypto.Crypto
  | RuntimeConfig
  // The models in use now, for the lead and the reviewer a preset names or lacks (presetModels.ts).
  | Agents
  | Models
  | ModelFacts
  | SignIns
  | Installs
  | Limits
  | Accounts
  | PlanUsage

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
      /** The ending is the person's own choice, rather than the project's setting. */
      readonly endChosen?: boolean
      /** Held from the start: it waits until someone starts it, with no countdown. */
      readonly held?: boolean
      /** Nothing of it leaves this Mac when it is done, whatever the project's host (`PlanParameters.here`). */
      readonly here?: boolean
      /** A review of someone else's pull request, its one step its lead (`PlanParameters.reads`). */
      readonly reads?: boolean
      /** No card in the coordinator's conversation: an aside's, which has a tab of its own there instead. */
      readonly card?: false
      /** The fast lane: reviewed after it merges, not before (`PlanParameters.reviewAfterMerge`). */
      readonly reviewAfterMerge?: boolean
      /** Where it works (ADR-091), and why, where that isn't the project's default (`PlanParameters.worksIn`). */
      readonly worksIn?: WorksIn
      readonly worksInWhy?: string | null
      /** What the proposing call was, as the coordinator made it: kept with the plan through the person's changes, so a repeat of the call is known for one (`Coordinator.propose`). */
      readonly proposal?: string
    }): Effect.Effect<string, unknown>
    /**
     * Starts a proposed plan now: its first step is under way (`running`), or
     * waits for a place among the agents at work on this machine (`waiting`);
     * null where it no longer stood to start. One accepted whose run was never
     * made, as when Althar stopped in between, runs now.
     */
    start(planId: string, actorId: ActorId): Effect.Effect<'running' | 'waiting' | null, unknown>
    /**
     * Holds a plan until someone starts it: one counting down, or one started whose first step still waits for a place or its
     * checkout, which leaves the line. Whether it was held; a plan under way isn't.
     */
    hold(planId: string, actorId: ActorId): Effect.Effect<boolean, unknown>
    /**
     * Changes a proposed plan's steps (who does them, or which are skipped),
     * and what happens when the work is done; or a started one's, while its
     * first step waits for a place among the agents at work here (ADR-032).
     */
    change(
      planId: string,
      steps: ReadonlyArray<PlanStep>,
      actorId: ActorId,
      end?: TaskEnd | null,
      /** Where it works, until its first step starts (ADR-091); as it was without it. */
      worksIn?: WorksIn,
      /** The branch it works toward, until its first step starts (ADR-093); null for the default branch, as it was without it. */
      toward?: string | null,
    ): Effect.Effect<void, unknown>
    /**
     * Picks another preset for a plan before it starts (a task is a conversation plus parts, "How a task starts"): its parts
     * change to match, by the preset's id or name: its lead and reviewer where it names them, Checked by and when, its ending,
     * where it works and sits, and its brief added to the task's description. A preset with no ending of its own ends the plan
     * as `projectEnd` says, the project's. The preset's name.
     */
    applyPreset(planId: string, preset: string, actorId: ActorId, projectEnd?: TaskEnd | null): Effect.Effect<string, unknown>
  }
>()('@althar/runtime/Plans') {
  static readonly layer: Layer.Layer<Plans, never, Store> = Layer.effect(
    Plans,
    Effect.gen(function* () {
      const context = yield* Effect.context<Store>()
      const instance = yield* Instance
      const runs = yield* Runs
      const reviews = yield* Reviews
      // The person's setting (plansAndReviews.ts), read as each plan is proposed; a test's own takes its place.
      const testCountdown = (yield* RuntimeConfig).countdown
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

      const parametersOf = (plan: PlanRow) =>
        JSON.parse(plan.parameters) as {
          steps: ReadonlyArray<PlanStep>
          reason?: string | null
          end?: TaskEnd | null
          endChosen?: boolean
          here?: boolean
          reads?: boolean
          worksIn?: WorksIn
          worksInWhy?: string | null
          proposal?: string
          reviewAfterMerge?: boolean
        }

      /** Whether a plan still counts down. */
      const counting = (plan: PlanRow) => plan.state === 'proposed' && plan.startsAt !== null

      const propose: Plans['Service']['propose'] = (input) =>
        provide(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient
            const planId = yield* newId(Ids.taskPlan)
            const workflowVersionId = yield* runs.workflowVersion
            const at = yield* timestamp
            const countdown = input.startsIn ?? testCountdown ?? (yield* countdownNow)
            const countdownEnds = new Date(Date.parse(at) + Duration.toMillis(countdown)).toISOString()
            let startsAt: string | null = null
            yield* sql.withTransaction(
              Effect.gen(function* () {
                // A task has one plan waiting: a new proposal replaces the one before.
                const earlier = yield* sql<{ id: string; startsAt: string | null }>`
                  SELECT id, starts_at FROM task_plans WHERE task_id = ${input.taskId} AND state = 'proposed'`
                // A plan the person held stays held when it is re-planned, unless this one is to start at once or says how soon.
                const keepsHold = input.held === undefined && input.startsIn === undefined && earlier.some((plan) => plan.startsAt === null)
                startsAt = input.held === true || keepsHold ? null : countdownEnds
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
                  parameters: JSON.stringify({
                    steps: input.steps,
                    reason: input.reason,
                    end: input.end ?? null,
                    ...(input.endChosen === true ? { endChosen: true } : {}),
                    ...(input.here === true ? { here: true } : {}),
                    ...(input.reads === true ? { reads: true } : {}),
                    ...(input.reviewAfterMerge === true ? { reviewAfterMerge: true } : {}),
                    ...(input.worksIn === undefined ? {} : { worksIn: input.worksIn }),
                    ...(input.worksInWhy == null || input.worksInWhy.trim() === '' ? {} : { worksInWhy: input.worksInWhy.trim() }),
                    ...(input.proposal === undefined ? {} : { proposal: input.proposal }),
                  }),
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
            if (input.card !== false) yield* postCard(input.projectId, input.taskId)
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
          const plan = yield* load(planId)
          const parameters = parametersOf(plan)
          // The same parts set up twice running: the coordinator offers them as a preset, once (a task is a conversation plus parts).
          if (accepted)
            yield* offerPreset(plan.projectId, instance.coordinatorId).pipe(
              Effect.catchCause((cause) => Effect.logWarning('Could not offer a preset', cause)),
            )
          if (parameters.reads === true) {
            // A review's lead starts in its thread; accepted before, it started then, or its thread says why it couldn't.
            const [lead] = parameters.steps
            if (!accepted || lead === undefined) return null
            yield* reviews.lead(plan.taskId, lead, actorId)
            return 'running' as const
          }
          if (accepted) return yield* runs.run(planId)
          // Accepted, but Althar stopped before its run was made: it runs now, once.
          return !due && plan.state === 'accepted' ? yield* runs.run(planId) : null
        })

      /**
       * Holds a plan that hasn't begun: one counting down stops counting. One started, its first step waiting for a place among
       * the agents at work here or for its checkout, goes back to a plan the person starts: its waiting step
       * leaves the line, and a start makes its run anew. Whether it was held.
       */
      const hold = (planId: string, actorId: ActorId) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          if (yield* transition(planId, counting, () => ({ startsAt: null }), 'task_plan.held', actorId)) return true
          const taken = yield* sql.withTransaction(
            Effect.gen(function* () {
              const plan = yield* load(planId)
              if (plan.state !== 'accepted' || !(yield* runs.unstart(plan.taskId, actorId))) return undefined
              const revision = yield* change('task_plans', planId, { state: 'proposed', startsAt: null, decidedAt: null })
              yield* fact({
                projectId: plan.projectId,
                aggregateType: 'task_plan',
                aggregateId: planId,
                revision,
                type: 'task_plan.held',
                actorId,
              })
              return plan
            }),
          )
          if (taken === undefined) return false
          yield* touchCard(taken.taskId)
          yield* Queue.offer(wake, undefined)
          return true
        })

      /** Plans that couldn't start when their time came, each waiting a while before it is tried again. */
      const tries = backoff()

      // The countdown: the next plan due starts when its time comes, or sooner if a plan changes. One that couldn't start
      // is due again once it has waited, and the others start in their time meanwhile.
      const countdown = Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        for (;;) {
          const counting = yield* sql<{ id: string; startsAt: string }>`
            SELECT id, starts_at FROM task_plans WHERE state = 'proposed' AND starts_at IS NOT NULL`
          const [next] = counting
            .map((plan) => ({ id: plan.id, at: Math.max(Date.parse(plan.startsAt), tries.until(plan.id)) }))
            .toSorted((a, b) => a.at - b.at)
          if (next === undefined) {
            yield* Queue.take(wake)
            continue
          }
          const wait = next.at - (yield* Clock.currentTimeMillis)
          if (wait > 0) {
            yield* Effect.raceFirst(Queue.take(wake), Effect.sleep(Duration.millis(wait)))
            continue
          }
          yield* tries.attempt(next.id, 'Plans.start', start(next.id, instance.systemId, true))
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
      yield* Effect.forkScoped(provide(keptGoing('Plans.countdown', countdown)))

      return Plans.of({
        propose,
        start: (planId, actorId) => provide(start(planId, actorId)),
        hold: (planId, actorId) => provide(hold(planId, actorId)),
        change: (planId, steps, actorId, end, worksIn, toward) =>
          provide(
            Effect.gen(function* () {
              const changed = (plan: PlanRow) => {
                const before = parametersOf(plan)
                const where = worksIn ?? before.worksIn
                // The person's choice of where it works is theirs: the coordinator's reason for its own no longer says why.
                const why = worksIn === undefined || worksIn === before.worksIn ? before.worksInWhy : undefined
                return JSON.stringify({
                  steps,
                  reason: before.reason ?? null,
                  end: end === undefined ? (before.end ?? null) : end,
                  // A card sends the ending it shows with every change: only another one than the plan had is the person's choice.
                  ...(before.endChosen === true || (end !== undefined && end !== (before.end ?? null)) ? { endChosen: true } : {}),
                  ...(before.here === true ? { here: true } : {}),
                  ...(before.reads === true ? { reads: true } : {}),
                  ...(where === undefined ? {} : { worksIn: where }),
                  ...(why == null ? {} : { worksInWhy: why }),
                  ...(before.proposal === undefined ? {} : { proposal: before.proposal }),
                  ...(before.reviewAfterMerge === true ? { reviewAfterMerge: true } : {}),
                })
              }
              // Any agent Althar has may lead a review.
              if (parametersOf(yield* load(planId)).reads === true)
                for (const step of steps) if (!step.skipped) yield* reviews.canLead(step.agentId)
              return yield* reshape(planId, changed, actorId, toward, worksIn !== undefined)
            }),
          ),
        applyPreset: (planId, asked, actorId, projectEnd) =>
          provide(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient
              const plan = yield* load(planId)
              const presets = yield* presetsIn(plan.projectId)
              const preset = presets.find((one) => one.id === asked || one.name.toLowerCase() === asked.trim().toLowerCase())
              if (preset === undefined) return yield* new NotFound({ kind: 'preset', id: asked })
              const before = parametersOf(plan)
              // A review of someone's pull request is its own: a plan of work doesn't become one, nor one of those work.
              if ((preset.parts.reviews === true) !== (before.reads === true))
                return yield* new ChangeRefused({
                  message: before.reads === true ? 'A review stays a review.' : 'Review a PR starts from a pull request.',
                })
              // The models as the agents list them, for a lead and a reviewer the preset names, and a reviewer it lacks.
              const models = presetModels(yield* usableModels(plan.projectId).pipe(Effect.orElseSucceed(() => [])))
              // Its review is what the preset promises: with no model but the lead's own to give it, nothing changes.
              if (preset.parts.checked !== 'none' && reviewerOfPreset(before, preset.parts, models) === null)
                return yield* new ChangeRefused({
                  message: `${preset.name} is reviewed, and no model apart from its lead's can be used to review it right now.`,
                })
              const steps = planFromPreset(before, preset.parts, models).steps
              if (before.reads === true) for (const step of steps) if (!step.skipped) yield* reviews.canLead(step.agentId)
              yield* reshape(
                planId,
                (now) => JSON.stringify(planFromPreset(parametersOf(now), preset.parts, models, projectEnd)),
                actorId,
                undefined,
                true,
              )
              // Where it sits, and a few lines for its lead, as the preset has them.
              yield* shelve(plan.taskId, preset.parts.shelf === 'scratch' ? 'scratch' : null, actorId)
              const brief = preset.parts.brief.trim()
              if (brief !== '') {
                const [task] = yield* sql<{ description: string }>`SELECT description FROM tasks WHERE id = ${plan.taskId}`
                if (task !== undefined && !task.description.includes(brief))
                  yield* sql.withTransaction(
                    Effect.gen(function* () {
                      const revision = yield* change('tasks', plan.taskId, {
                        description: task.description.trim() === '' ? brief : `${task.description.trim()}\n\n${brief}`,
                      })
                      yield* fact({
                        projectId: plan.projectId,
                        aggregateType: 'task',
                        aggregateId: plan.taskId,
                        revision,
                        type: 'task.described',
                        payload: { preset: preset.name },
                        actorId,
                      })
                    }),
                  )
              }
              yield* touchCard(plan.taskId)
              return preset.name
            }),
          ),
      })

      /** Rewrites a plan's parameters before it starts: proposed, or started with its first step waiting for a place. */
      function reshape(
        planId: string,
        changed: (plan: PlanRow) => string,
        actorId: ActorId,
        toward: string | null | undefined,
        moved: boolean,
      ) {
        return Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const plan = yield* load(planId)
          if (plan.state === 'proposed') {
            // Pointed at another branch first: one the remote doesn't have changes nothing of the plan.
            if (toward !== undefined) yield* setToward(plan.taskId, toward)
            yield* transition(
              planId,
              (now) => now.state === 'proposed',
              (now) => ({ parameters: changed(now) }),
              'task_plan.changed',
              actorId,
            )
            return
          }
          // Started, it can still be changed while its first step waits for a place, nothing of it begun: its run with it.
          if (plan.state !== 'accepted') return
          const done = yield* sql.withTransaction(
            Effect.gen(function* () {
              const now = yield* load(planId)
              if (now.state !== 'accepted') return false
              const parameters = changed(now)
              if (!(yield* runs.changeWaiting(now.taskId, parameters, actorId))) return false
              if (toward !== undefined) yield* setToward(now.taskId, toward)
              const revision = yield* change('task_plans', planId, { parameters })
              yield* fact({
                projectId: now.projectId,
                aggregateType: 'task_plan',
                aggregateId: planId,
                revision,
                type: 'task_plan.changed',
                actorId,
              })
              return true
            }),
          )
          if (done) {
            yield* touchCard(plan.taskId)
            // Moved between a worktree and its checkout as it waits: placed again now (ADR-091).
            if (moved) yield* runs.checkoutsMoved
          }
        })
      }
    }),
  )
}
