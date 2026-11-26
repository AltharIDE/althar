import { type ShipRoute, shipsToOpen } from '@althar/contracts'
import type { ActorId, CommandEnvelope, ProjectId } from '@althar/domain'
import type { Ledger, RevisionConflict, RowNotFound } from '@althar/persistence-sqlite'
import { Cause, type Crypto, Deferred, Effect, Exit, Option, Queue, Schema, type Scope } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'
import type { Artifacts } from './Artifacts'
import { touchCard } from './cards'
import type { Changes } from './Changes'
import type { Agents } from './Config'
import { envelope } from './envelope'
import { type GitFailed, NotFound, ShipRefused, TaskRefused } from './errors'
import type { Instance, InstanceInfo } from './Instance'
import type { MergeReviews } from './MergeReviews'
import { PlanParameters, type PlanStep, type TaskEnd, endingOf } from './planParameters'
import { roundsNow } from './plansAndReviews'
import { touchQuestion } from './Questions'
import { change, fact, timestamp } from './records'
import { ReviewRefused } from './Reviews'
import {
  AFTER_TURN_WAIT,
  NEXT_SHIP_EVERY,
  NEXT_SHIP_TRIES,
  type ReviewerChange,
  type RunRow,
  type ShipOptions,
  type Store,
  type TeamChanged,
  reviewerChange,
  roundOf,
} from './runRecords'
import type { Runs } from './Runs'
import type { Sessions } from './Sessions'
import { reviewsBeforeShip, routeOfShip, shipStopOf } from './shipRoute'
import { teamLeadOf } from './teamLead'
import { addItem } from './threads'
import { summarize } from './words'

interface RunPlanChangesDependencies {
  readonly agentsHere: Agents['Service']
  readonly changes: Changes['Service']
  readonly conclude: (run: RunRow) => Effect.Effect<void, unknown, SqlClient.SqlClient | Instance | Crypto.Crypto | Ledger>
  readonly currentRun: (taskId: string) => Effect.Effect<RunRow | undefined, SqlError.SqlError, SqlClient.SqlClient>
  readonly fromItsStart: (
    taskId: string,
  ) => Effect.Effect<
    { heads: Record<string, string>; uncommitted: Record<string, readonly string[]>; digest: string },
    SqlError.SqlError,
    SqlClient.SqlClient
  >
  readonly going: (run: RunRow) => Effect.Effect<boolean, SqlError.SqlError, SqlClient.SqlClient>
  readonly instance: InstanceInfo
  readonly mergeReviews: MergeReviews['Service']
  readonly mergeWakes: Map<string, Queue.Queue<void, never>>
  readonly provide: <A, E>(effect: Effect.Effect<A, E, Store>) => Effect.Effect<A, E>
  readonly publish: (taskId: string) => Effect.Effect<undefined, unknown, SqlClient.SqlClient | Instance | Crypto.Crypto | Ledger>
  readonly scope: Scope.Scope
  readonly sessions: Sessions['Service']
  readonly ship: (
    taskId: string,
    actorId: ActorId,
    options?: ShipOptions,
  ) => Effect.Effect<RunRow | undefined, unknown, SqlClient.SqlClient | Instance | Crypto.Crypto | Ledger | Artifacts>
  readonly shipHeads: (
    taskId: string,
    only?: ReadonlyArray<string>,
  ) => Effect.Effect<Record<string, string>, GitFailed | SqlError.SqlError, SqlClient.SqlClient>
  readonly unstuck: (
    run: RunRow,
  ) => Effect.Effect<void, SqlError.SqlError | Schema.SchemaError | RowNotFound | RevisionConflict, SqlClient.SqlClient | Ledger>
}

export const makeRunPlanChanges = (dependencies: RunPlanChangesDependencies) => {
  const {
    agentsHere,
    changes,
    conclude,
    currentRun,
    fromItsStart,
    going,
    instance,
    mergeReviews,
    mergeWakes,
    provide,
    publish,
    scope,
    sessions,
    ship,
    shipHeads,
    unstuck,
  } = dependencies

  const makeChange = (taskId: string, review: PlanStep | null, end: TaskEnd | null, actorId: ActorId) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(PlanParameters))
      // Its review in place of any it had, its ending, and nothing more of staying here; `publishes`, for a round under way.
      const reshaped = (parameters: string, publishes: boolean) =>
        Effect.map(decode(parameters), ({ here: _here, publishes: _publishes, ...before }) =>
          JSON.stringify({
            ...before,
            steps: [...before.steps.filter((step) => step.key !== 'review'), ...(review === null ? [] : [review])],
            end,
            ...(publishes ? { publishes: true } : {}),
          }),
        )
      const [plan] = yield* sql<{ id: string; projectId: ProjectId; parameters: string }>`
            SELECT id, project_id, parameters FROM task_plans WHERE task_id = ${taskId} AND state IN ('proposed', 'accepted')
            ORDER BY proposed_at DESC LIMIT 1`
      if (plan !== undefined) {
        const revision = yield* change('task_plans', plan.id, { parameters: yield* reshaped(plan.parameters, false) })
        yield* fact({
          projectId: plan.projectId,
          aggregateType: 'task_plan',
          aggregateId: plan.id,
          revision,
          type: 'task_plan.made_change',
          payload: { review, end },
          actorId,
        })
      }
      // The plan's run, which the rounds after it copy (openRound), and the latest run, a round of it or the same.
      const runs = yield* sql<{
        id: string
        projectId: ProjectId
        planId: string | null
        parameters: string
        state: string
        executionId: string
      }>`
            SELECT r.id, r.project_id, r.plan_id, r.parameters, r.state, e.id AS execution_id
            FROM runs r JOIN workflow_executions e ON e.run_id = r.id
            WHERE r.task_id = ${taskId} AND (r.plan_id = ${plan?.id ?? ''}
              OR r.id = (SELECT id FROM runs WHERE task_id = ${taskId} ORDER BY created_at DESC, rowid DESC LIMIT 1))`
      let underWay = false
      for (const run of runs) {
        // Under way, or stopped by the person and to be resumed: its steps from here are the change's.
        const going = run.state === 'running' || run.state === 'suspended'
        const round = run.planId === null && going
        underWay ||= going
        const parameters = yield* reshaped(run.parameters, round)
        const revision = yield* change('runs', run.id, { parameters })
        yield* fact({
          projectId: run.projectId,
          aggregateType: 'run',
          aggregateId: run.id,
          revision,
          type: 'run.made_change',
          payload: { review, end },
          actorId,
        })
        if (!going) continue
        // Its graph has the review now, as a patch to it.
        const [graph] = yield* sql<{
          revision: number
        }>`SELECT graph_revision AS revision FROM workflow_executions WHERE id = ${run.executionId}`
        const next = (graph?.revision ?? 1) + 1
        const steps = (yield* decode(parameters)).steps.filter((step) => !step.skipped)
        yield* sql`INSERT INTO execution_graph_revisions ${sql.insert({
          projectId: run.projectId,
          executionId: run.executionId,
          revision: next,
          graph: JSON.stringify({ steps, review: { rounds: yield* roundsNow }, ...(round ? { round: true } : {}) }),
          cause: 'patch',
          createdAt: yield* timestamp,
        })}`
        yield* change('workflow_executions', run.executionId, { graphRevision: next })
        if (!round) continue
        // A round's work is counted from where the task started: what its lead did before the person asked is the change's too.
        const start = yield* fromItsStart(taskId)
        const attempts = yield* sql<{ id: string; input: string | null }>`
              SELECT a.id, a.input FROM node_attempts a JOIN nodes n ON n.id = a.node_id
              WHERE n.execution_id = ${run.executionId} AND n.node_key = 'implement'`
        for (const attempt of attempts) {
          const was = roundOf(attempt.input)
          if (was !== undefined) yield* change('node_attempts', attempt.id, { input: JSON.stringify({ ...was, start }) })
        }
      }
      return underWay
    })

  /** Turns down the review a lead or the coordinator offered a task (`offer_review`): kept once, so it isn't offered again. */
  const declineReview = (taskId: string, actorId: ActorId) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const [task] = yield* sql<{ projectId: ProjectId; revision: number }>`SELECT project_id, revision FROM tasks WHERE id = ${taskId}`
      if (task === undefined) return yield* new NotFound({ kind: 'task', id: taskId })
      const [known] = yield* sql<{ one: number }>`
            SELECT 1 AS one FROM record_events WHERE aggregate_type = 'task' AND aggregate_id = ${taskId}
              AND type = 'task.review_offer_declined' LIMIT 1`
      if (known !== undefined) return
      yield* fact({
        projectId: task.projectId,
        aggregateType: 'task',
        aggregateId: taskId,
        revision: task.revision,
        type: 'task.review_offer_declined',
        actorId,
      })
      yield* touchCard(taskId)
    })

  /**
   * A review added after the task's work went up (a skipped review can be added back until merge): once its lead's turn is
   * over and the run that was ending is, a round of the review's own reads the task's head, from the last review or, with
   * none, all of it, with whatever waits for Ship on the branch too (that stays held, and goes up with Ship). Nothing where
   * nothing is built.
   */
  const reviewHead = (taskId: string, actorId: ActorId) =>
    Effect.asVoid(
      Effect.forkIn(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [thread] = yield* sql<{ id: string }>`SELECT id FROM threads WHERE task_id = ${taskId} AND kind = 'task'`
          if (thread !== undefined) yield* sessions.untilIdle(thread.id, AFTER_TURN_WAIT)
          for (let tries = 0; ; tries += 1) {
            const sent = yield* Effect.exit(ship(taskId, actorId, { reviewOnly: true }))
            if (sent._tag === 'Success') return
            const error = Cause.findErrorOption(sent.cause)
            const working = Option.isSome(error) && error.value instanceof ShipRefused && error.value.why === 'working'
            if (working && tries < NEXT_SHIP_TRIES) {
              yield* Effect.sleep(NEXT_SHIP_EVERY)
              continue
            }
            // Nothing to read, or it can't start: Ship reviews it as the plan says.
            const nothing = Option.isSome(error) && error.value instanceof ShipRefused
            return nothing ? undefined : yield* Effect.failCause(sent.cause)
          }
        }).pipe(
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause) ? Effect.interrupt : Effect.logWarning('Could not start the review added to the task', cause),
          ),
          provide,
        ),
        scope,
      ),
    )

  const reshape = (input: Parameters<Runs['Service']['reshape']>[0]) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const [task] = yield* sql<{ state: string }>`SELECT state FROM tasks WHERE id = ${input.taskId}`
      if (task === undefined) return yield* new NotFound({ kind: 'task', id: input.taskId })
      if (task.state === 'abandoned') return yield* new TaskRefused({ taskId: input.taskId, why: 'abandoned' })
      const [plan] = yield* sql<{ id: string; projectId: ProjectId; parameters: string }>`
            SELECT id, project_id, parameters FROM task_plans WHERE task_id = ${input.taskId} AND state IN ('proposed', 'accepted')
            ORDER BY proposed_at DESC LIMIT 1`
      if (plan === undefined) return yield* new TaskRefused({ taskId: input.taskId, why: 'no_lead' })
      const planned = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(PlanParameters))(plan.parameters)
      const was = endingOf(planned)
      const now = yield* timestamp
      // Here: nothing goes up until it ships; else its ending, with nothing more of staying here. Read after the merge: its
      // reviewer's row skipped, so nothing waits on it before; read before it ships again: the fast lane's mark gone.
      const reshaped = (parameters: string) => {
        const before = JSON.parse(parameters) as Record<string, unknown> & {
          steps?: ReadonlyArray<PlanStep>
          ships?: Record<string, unknown>
        }
        const { here, end, endChosen, reviewAfterMerge, ships, keptOpen, reviewsFrom, ...rest } = before
        // A change stepped back from its pull request to its branch (into prototyping, or a chat) keeps that pull request as it
        // is: marked, so nothing pushes to it until it ends in one again. Back in one, its next review reads the whole change,
        // from where it started, not from what a review read before it stepped back.
        const toPullRequest = input.end === 'draft' || input.end === 'ready'
        const stepped = {
          ...((input.end === 'none' || input.end === 'here') && (was === 'draft' || was === 'ready')
            ? { keptOpen: true }
            : toPullRequest || keptOpen === undefined
              ? {}
              : { keptOpen }),
          ...(toPullRequest && keptOpen === true ? { reviewsFrom: now } : reviewsFrom === undefined ? {} : { reviewsFrom }),
        }
        const chosen = input.end === undefined || input.chosen === undefined ? endChosen === true : input.chosen
        const ending = {
          ...(input.end === undefined
            ? { ...(here === undefined ? {} : { here }), ...(end === undefined ? {} : { end }) }
            : input.end === 'here'
              ? { end: null, here: true }
              : { end: input.end }),
          ...(chosen ? { endChosen: true } : {}),
        }
        // A Ship under way as its task comes to stay here sends nothing; one that goes back to ending elsewhere sends again.
        const { stays: _stays, openDraft: _openDraft, ...otherShipping } = ships ?? {}
        const shipping = { ...otherShipping, ...(input.end === undefined && ships?.openDraft === true ? { openDraft: true } : {}) }
        const shipped =
          ships === undefined
            ? {}
            : {
                ships: input.end === 'here' || (input.end === undefined && ships.stays === true) ? { ...shipping, stays: true } : shipping,
              }
        const after =
          input.afterMerge === undefined
            ? reviewAfterMerge === undefined
              ? {}
              : { reviewAfterMerge }
            : input.afterMerge === null
              ? {}
              : {
                  reviewAfterMerge: true,
                  steps: [
                    ...(before.steps ?? []).filter((step) => step.key !== 'review'),
                    { ...input.afterMerge, key: 'review' as const, skipped: true },
                  ],
                }
        return JSON.stringify({
          ...rest,
          ...ending,
          ...stepped,
          ...shipped,
          ...after,
          ...(input.smallChange !== undefined
            ? { smallChange: input.smallChange }
            : input.afterMerge != null && before.smallChange !== true
              ? { smallChange: false }
              : {}),
        })
      }
      const sameChoice = input.chosen === undefined || input.chosen === (planned.endChosen === true)
      if (
        (input.end === undefined || (was === input.end && sameChoice)) &&
        input.afterMerge === undefined &&
        input.smallChange === undefined
      )
        return { was }
      yield* sql.withTransaction(
        Effect.gen(function* () {
          const revision = yield* change('task_plans', plan.id, { parameters: reshaped(plan.parameters) })
          yield* fact({
            projectId: plan.projectId,
            aggregateType: 'task_plan',
            aggregateId: plan.id,
            revision,
            type: 'task_plan.changed',
            payload: { end: input.end ?? null, afterMerge: input.afterMerge ?? null },
            actorId: input.actorId,
          })
          // The plan's run, which Ship and the rounds after it read, and the latest run, a round of it or the same.
          const rows = yield* sql<{ id: string; projectId: ProjectId; parameters: string }>`
                SELECT r.id, r.project_id, r.parameters FROM runs r
                WHERE r.task_id = ${input.taskId} AND (r.plan_id = ${plan.id}
                  OR r.id = (SELECT id FROM runs WHERE task_id = ${input.taskId} ORDER BY created_at DESC, rowid DESC LIMIT 1))`
          for (const run of rows) {
            const runRevision = yield* change('runs', run.id, { parameters: reshaped(run.parameters) })
            yield* fact({
              projectId: run.projectId,
              aggregateType: 'run',
              aggregateId: run.id,
              revision: runRevision,
              type: 'run.plan_changed',
              payload: { end: input.end ?? null, afterMerge: input.afterMerge ?? null },
              actorId: input.actorId,
            })
          }
        }),
      )
      yield* touchCard(input.taskId)
      return { was }
    })

  const changeTeam = (input: Parameters<Runs['Service']['changeTeam']>[0]) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(PlanParameters))
      const [task] = yield* sql<{ state: string; threadId: string }>`
            SELECT k.state, t.id AS thread_id FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task' WHERE k.id = ${input.taskId}`
      if (task === undefined) return yield* new NotFound({ kind: 'task', id: input.taskId })
      if (task.state === 'abandoned') return yield* new TaskRefused({ taskId: input.taskId, why: 'abandoned' })
      // Merged, its change is in: the one it shows is the open one, else its latest. Its reviewer then reads what ships next.
      // One that can't be read yet counts as none: a change of its team never fails for it.
      const pulls = yield* changes.ofTask(input.taskId).pipe(Effect.orElseSucceed(() => []))
      const shown = pulls.find((one) => one.state === 'open') ?? pulls.at(-1)
      const merged = task.state === 'done' || shown?.state === 'merged'
      const [plan] = yield* sql<{ id: string; projectId: ProjectId; state: string; parameters: string; proposedAt: string }>`
            SELECT id, project_id, state, parameters, proposed_at FROM task_plans WHERE task_id = ${input.taskId} AND state IN ('proposed', 'accepted')
            ORDER BY proposed_at DESC LIMIT 1`
      if (plan === undefined) return yield* new TaskRefused({ taskId: input.taskId, why: 'no_lead' })
      const before = yield* decode(plan.parameters)
      const plannedLead = before.steps.find((step) => step.key === 'implement')
      if (plannedLead === undefined) return yield* new TaskRefused({ taskId: input.taskId, why: 'no_lead' })
      const lead =
        plan.state === 'accepted'
          ? yield* teamLeadOf(
              task.threadId,
              plannedLead,
              before.leadChanged ?? plan.proposedAt,
              Option.getOrUndefined(yield* sessions.running(task.threadId)),
            )
          : plannedLead
      const review = before.steps.find((step) => step.key === 'review')
      const wantedLead = input.steps.find((step) => step.key === 'implement')
      const wantedReview = input.steps.find((step) => step.key === 'review')
      const alike = (a: PlanStep, b: PlanStep) =>
        a.agentId === b.agentId && (a.model ?? null) === (b.model ?? null) && (a.effort ?? null) === (b.effort ?? null)
      // Any agent Althar has may take a review's steps (Reviews.canLead).
      if (before.reads === true)
        for (const step of input.steps) {
          if (step.skipped || agentsHere.list.some((entry) => entry.definition.id === step.agentId)) continue
          return yield* new ReviewRefused({ message: 'Althar has no such agent.' })
        }
      // Omitted model or effort keeps that part of the same agent's choice, as changeLead does below.
      const leadChanges =
        wantedLead !== undefined &&
        (lead.agentId !== wantedLead.agentId ||
          (wantedLead.model != null && lead.model !== wantedLead.model) ||
          (wantedLead.effort != null && lead.effort !== wantedLead.effort))
      const reviewed = review !== undefined && (!review.skipped || before.reviewAfterMerge === true)
      const preservesAfterMerge =
        before.reviewAfterMerge === true &&
        leadChanges &&
        wantedReview?.skipped === true &&
        review !== undefined &&
        alike(review, wantedReview)
      const reviews = wantedReview === undefined ? reviewed : !wantedReview.skipped || preservesAfterMerge
      const reviewChanges =
        wantedReview !== undefined &&
        (reviewed !== reviews ||
          (reviews &&
            review !== undefined &&
            (!alike(review, wantedReview) || (before.reviewAfterMerge === true && wantedReview.skipped !== true))))
      if (!leadChanges && !reviewChanges) return {} as TeamChanged
      const reviewAt: ReviewerChange = !reviewChanges ? 'now' : merged ? 'next_ship' : yield* reviewerChange(input.taskId)
      // Removing it ends the current round now; choosing another reviewer takes effect at the next round.
      const reviewWhen: ReviewerChange = !reviews && reviewAt === 'next_round' ? 'now' : reviewAt
      // A review put on before the work ships, where the plan read it only once it merged (the fast lane): it reads it before now.
      const clearsAfterMerge = reviewChanges && before.reviewAfterMerge === true
      const at = yield* timestamp
      // Each row's own steps: a round of work may have had its review skipped, which a change to the lead leaves as it is.
      const reshaped = (steps: ReadonlyArray<PlanStep>) => {
        const moved = steps.map((step): PlanStep =>
          step.key === 'implement' && leadChanges && wantedLead !== undefined ? { ...wantedLead, key: 'implement', skipped: false } : step,
        )
        if (!reviewChanges) return moved
        const own = steps.find((step) => step.key === 'review')
        const rest = moved.filter((step) => step.key !== 'review')
        if (reviews && wantedReview !== undefined) return [...rest, { ...wantedReview, key: 'review' as const, skipped: false }]
        return own === undefined ? rest : [...rest, { ...own, skipped: true }]
      }
      const rewritten = (parameters: string) =>
        Effect.map(decode(parameters), (now) => {
          const { reviewAfterMerge, ...rest } = JSON.parse(parameters) as Record<string, unknown>
          return JSON.stringify({
            ...rest,
            ...(clearsAfterMerge || reviewAfterMerge === undefined ? {} : { reviewAfterMerge }),
            steps: reshaped(now.steps),
            ...(leadChanges ? { leadChanged: at } : {}),
          })
        })
      yield* sql.withTransaction(
        Effect.gen(function* () {
          const planChange = yield* change('task_plans', plan.id, { parameters: yield* rewritten(plan.parameters) })
          yield* fact({
            projectId: plan.projectId,
            aggregateType: 'task_plan',
            aggregateId: plan.id,
            revision: planChange,
            type: 'task_plan.changed',
            ...(leadChanges ? { payload: { leadChanged: at } } : {}),
            actorId: input.actorId,
          })
          // A review put on where one was offered answers the offer: taken off again later, it doesn't stand again.
          if (reviewChanges && reviews && !reviewed) {
            const [offered] = yield* sql<{ one: number }>`
                  SELECT 1 AS one FROM record_events WHERE aggregate_type = 'task' AND aggregate_id = ${input.taskId}
                    AND type = 'task.review_offered' LIMIT 1`
            const [row] = yield* sql<{ revision: number }>`SELECT revision FROM tasks WHERE id = ${input.taskId}`
            if (offered !== undefined)
              yield* fact({
                projectId: plan.projectId,
                aggregateType: 'task',
                aggregateId: input.taskId,
                revision: row?.revision ?? 1,
                type: 'task.review_offer_accepted',
                actorId: input.actorId,
              })
          }
          // The plan's run, which the rounds after it copy, and the latest run, a round of it or the same.
          const rows = yield* sql<{
            id: string
            projectId: ProjectId
            planId: string | null
            parameters: string
            state: string
            executionId: string
          }>`
                SELECT r.id, r.project_id, r.plan_id, r.parameters, r.state, e.id AS execution_id
                FROM runs r JOIN workflow_executions e ON e.run_id = r.id
                WHERE r.task_id = ${input.taskId} AND (r.plan_id = ${plan.id}
                  OR r.id = (SELECT id FROM runs WHERE task_id = ${input.taskId} ORDER BY created_at DESC, rowid DESC LIMIT 1))`
          for (const run of rows) {
            const parameters = yield* rewritten(run.parameters)
            const revision = yield* change('runs', run.id, { parameters })
            yield* fact({
              projectId: run.projectId,
              aggregateType: 'run',
              aggregateId: run.id,
              revision,
              type: 'run.plan_changed',
              actorId: input.actorId,
            })
            // Under way, its graph has the review it has now, as a patch to it; one whose review is done keeps the graph it ran,
            // and the reviewer named reads what ships next.
            if (!reviewChanges || reviewWhen === 'next_ship' || (run.state !== 'running' && run.state !== 'suspended')) continue
            const [graph] = yield* sql<{
              revision: number
            }>`SELECT graph_revision AS revision FROM workflow_executions WHERE id = ${run.executionId}`
            const next = (graph?.revision ?? 1) + 1
            yield* sql`INSERT INTO execution_graph_revisions ${sql.insert({
              projectId: run.projectId,
              executionId: run.executionId,
              revision: next,
              graph: JSON.stringify({
                steps: (yield* decode(parameters)).steps.filter((step) => !step.skipped),
                review: { rounds: yield* roundsNow },
                ...(run.planId === null ? { round: true } : {}),
              }),
              cause: 'patch',
              createdAt: at,
            })}`
            yield* change('workflow_executions', run.executionId, { graphRevision: next })
          }
        }),
      )
      // No review in the team dialog also ends the review already under way, through the same command as its stuck card.
      if (reviewChanges && !reviews && reviewWhen !== 'next_ship')
        yield* skipReview({
          taskId: input.taskId,
          envelope: yield* envelope('task.skip_review', { taskId: input.taskId }, undefined, input.actorId),
        })
      // The lead it has now takes over from its next turn, never in the one it is in.
      const leadWhen =
        leadChanges && wantedLead !== undefined
          ? (yield* sessions.changeLead({
              threadId: task.threadId,
              agentId: wantedLead.agentId,
              ...(wantedLead.model === null ? {} : { model: wantedLead.model }),
              ...(wantedLead.effort == null ? {} : { effort: wantedLead.effort }),
            })) === 'later'
            ? ('next_turn' as const)
            : ('now' as const)
          : ('now' as const)
      yield* touchCard(input.taskId)
      // A review added where its run is over, or at its ending, has no round to come in it: where its work is up in an open
      // pull request, it reads the head now; where it isn't, Ship reviews it before sending it up.
      if (
        reviewChanges &&
        reviews &&
        !reviewed &&
        reviewWhen === 'now' &&
        input.atShip !== true &&
        pulls.some((one) => one.state === 'open')
      ) {
        const [last] = yield* sql<{ state: string; late: number }>`
              SELECT r.state, EXISTS (SELECT 1 FROM nodes n WHERE n.execution_id = e.id AND n.node_key = 'publish') AS late
              FROM runs r JOIN workflow_executions e ON e.run_id = r.id WHERE r.task_id = ${input.taskId}
              ORDER BY r.created_at DESC, r.rowid DESC LIMIT 1`
        if (last !== undefined && ((last.state !== 'running' && last.state !== 'suspended') || last.late === 1))
          yield* reviewHead(input.taskId, input.actorId)
      }
      const done: { lead?: TeamChanged['lead']; review?: TeamChanged['review'] } = {}
      if (leadChanges && wantedLead !== undefined)
        done.lead = { step: { ...wantedLead, key: 'implement', skipped: false }, was: lead, when: leadWhen }
      if (reviewChanges)
        done.review = {
          step: reviews && wantedReview !== undefined ? { ...wantedReview, key: 'review', skipped: false } : null,
          was: reviewed ? (review ?? null) : null,
          when: reviewWhen,
        }
      return done as TeamChanged
    })

  const skipReview = (input: { readonly envelope: CommandEnvelope; readonly taskId: string }) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const current = yield* currentRun(input.taskId)
      if (current === undefined) return
      const parameters = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(PlanParameters))(current.parameters)
      if (!parameters.steps.some((step) => step.key === 'review' && !step.skipped)) {
        const [active] = yield* sql<{ id: string }>`SELECT a.id FROM node_attempts a JOIN nodes n ON n.id = a.node_id
              WHERE n.execution_id = ${current.executionId} AND n.node_key = 'review' AND a.state IN ('admitted', 'running', 'waiting_attention', 'held') LIMIT 1`
        if (active === undefined) return
      }
      const skipped = {
        ...parameters,
        steps: parameters.steps.map((step) => (step.key === 'review' ? { ...step, skipped: true } : step)),
        ...(parameters.ships === undefined
          ? {}
          : {
              ships: {
                ...parameters.ships,
                heads: yield* shipHeads(
                  current.taskId,
                  parameters.ships.heads === undefined ? parameters.ships.only : Object.keys(parameters.ships.heads),
                ),
                snapshots: undefined,
                // Its route goes on without the review, as its card says.
                ...(parameters.ships.route === undefined ? {} : { route: { ...parameters.ships.route, review: false } }),
              },
            }),
      }
      const stopped = yield* sql.withTransaction(
        Effect.gen(function* () {
          if (!(yield* going(current))) return undefined
          const revision = yield* change('runs', current.runId, { parameters: JSON.stringify(skipped) })
          yield* fact({
            projectId: current.projectId,
            aggregateType: 'run',
            aggregateId: current.runId,
            revision,
            type: 'run.review_skipped',
            actorId: input.envelope.actorId,
            commandId: input.envelope.commandId,
          })
          // A review under way, waiting for its place or on the person, stops: gone on without, as when its call is abandoned.
          const reviews = yield* sql<{ id: string; nodeId: string; output: string | null }>`
                SELECT a.id, a.node_id, a.output FROM node_attempts a JOIN nodes n ON n.id = a.node_id
                WHERE n.execution_id = ${current.executionId} AND n.node_key = 'review'
                  AND a.state IN ('admitted', 'running', 'waiting_attention', 'held')`
          const at = yield* timestamp
          for (const attempt of reviews) {
            const ended = yield* change('node_attempts', attempt.id, {
              state: 'cancelled',
              holdReason: null,
              output: JSON.stringify({ skipped: true }),
              endedAt: at,
            })
            yield* change('nodes', attempt.nodeId, { state: 'cancelled' })
            yield* fact({
              projectId: current.projectId,
              aggregateType: 'node_attempt',
              aggregateId: attempt.id,
              revision: ended,
              type: 'node_attempt.cancelled',
              payload: { skipped: true },
              actorId: input.envelope.actorId,
              commandId: input.envelope.commandId,
            })
          }
          // So does a call that review's last round left for the person.
          const [called] = yield* sql<{ id: string }>`
                SELECT id FROM attention_requests WHERE task_id = ${input.taskId} AND kind = 'stuck' AND state = 'open'
                  AND json_extract(payload, '$.step') = 'review'`
          if (reviews.length > 0 || called !== undefined) yield* unstuck(current)
          // And what its reviewer asked the person: there is no review left to answer it for.
          const asked = yield* sql<{ id: string; payload: string }>`
                SELECT a.id, a.payload FROM attention_requests a JOIN threads t ON t.id = json_extract(a.payload, '$.threadId')
                WHERE a.task_id = ${input.taskId} AND a.kind = 'question' AND a.state = 'open' AND t.kind = 'step' AND t.node_key = 'review'`
          for (const question of asked) {
            // Said as the agent going on without an answer: the task goes on.
            const revision = yield* change('attention_requests', question.id, {
              state: 'withdrawn',
              payload: JSON.stringify({ ...(JSON.parse(question.payload) as object), withdrawn: 'turn' }),
            })
            yield* fact({
              projectId: current.projectId,
              aggregateType: 'attention_request',
              aggregateId: question.id,
              revision,
              type: 'attention_request.withdrawn',
              actorId: input.envelope.actorId,
              commandId: input.envelope.commandId,
            })
            yield* touchQuestion(question.id)
          }
          return reviews.length > 0 || called !== undefined
        }),
      )
      if (stopped === undefined) return
      if (stopped) {
        const [thread] = yield* sql<{
          id: string
        }>`SELECT id FROM threads WHERE task_id = ${input.taskId} AND kind = 'step' AND node_key = 'review'`
        if (thread !== undefined) yield* Effect.ignore(sessions.stop(thread.id))
        yield* addItem({ projectId: current.projectId, threadId: current.threadId }, 'notice', {
          source: 'runtime',
          severity: 'info',
          title: 'The review stopped: skipped, with what it found left open.',
        })
        yield* conclude(current)
      }
      yield* touchCard(input.taskId)
    })

  /**
   * The person's Ship: answered once its run is admitted and its card says so, or with why it can't ship. Its review's
   * start, or its push, goes on apart, in the round's lock as before, and says what became of it on the task: a press
   * waits on neither the reviewer's agent starting nor the host, which under load took seconds.
   */
  /** A request that could not start still answers on the task, including a deferred request made by its own lead. */
  const shipCouldNotStart = (taskId: string, cause: Cause.Cause<unknown>) =>
    Effect.gen(function* () {
      const error = Option.getOrUndefined(Cause.findErrorOption(cause))
      const sql = yield* SqlClient.SqlClient
      const [thread] = yield* sql<{
        id: string
        projectId: ProjectId
      }>`SELECT id, project_id FROM threads WHERE task_id = ${taskId} AND kind = 'task'`
      if (thread === undefined) return
      const nothing = error instanceof ShipRefused && error.why === 'nothing'
      const detail = nothing
        ? 'Nothing was waiting to ship.'
        : error instanceof ShipRefused && error.why === 'working'
          ? 'The task is still at work. Ship again once its turn ends.'
          : summarize(cause)
      yield* addItem({ projectId: thread.projectId, threadId: thread.id }, 'notice', {
        source: 'runtime',
        severity: nothing ? 'info' : 'warning',
        title: nothing ? detail : `Shipping could not start. ${detail}`,
      })
    })

  const shipPressed = (taskId: string, actorId: ActorId, options: Pick<ShipOptions, 'onlyChange' | 'openDraft' | 'route'> = {}) =>
    Effect.gen(function* () {
      const admitted = yield* Deferred.make<void, unknown>()
      yield* Effect.forkIn(
        provide(
          ship(taskId, actorId, { ...options, admitted, acceptStopped: true }).pipe(
            // Refused, or over before it was admitted: that is the press's answer, as it always was.
            Effect.onExit((exit) =>
              Exit.isSuccess(exit) ? Deferred.succeed(admitted, undefined) : Deferred.failCause(admitted, exit.cause),
            ),
            Effect.catchCause((cause) =>
              Effect.flatMap(Effect.exit(Deferred.await(admitted)), (pressed) =>
                // What fails once it is admitted goes on the task, as a plan's ending does; anything else is kept.
                Exit.isSuccess(pressed) && !Cause.hasInterruptsOnly(cause)
                  ? Effect.logWarning('Could not ship once its run was admitted', cause)
                  : Effect.void,
              ),
            ),
          ),
        ),
        scope,
      )
      yield* Deferred.await(admitted)
    })

  const setReviewAfterMerge = (input: Parameters<Runs['Service']['setReviewAfterMerge']>[0]) =>
    Effect.gen(function* () {
      // Validation and old-merge reconciliation precede timing, which is persisted under the same decision lock as the
      // explicit choice. A concurrent merge cannot permanently observe the old before-Ship timing between those writes.
      const prepare =
        input.review !== 'review'
          ? undefined
          : provide(
              Effect.gen(function* () {
                const sql = yield* SqlClient.SqlClient
                const [plan] = yield* sql<{
                  parameters: string
                }>`SELECT parameters FROM task_plans WHERE task_id = ${input.taskId} ORDER BY proposed_at DESC, rowid DESC LIMIT 1`
                if (plan === undefined) return
                const parameters = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(PlanParameters))(plan.parameters)
                if (parameters.reviewAfterMerge === true) return
                const review = parameters.steps.find((step) => step.key === 'review')
                if (review !== undefined)
                  yield* reshape({
                    taskId: input.taskId,
                    afterMerge: review,
                    smallChange: parameters.smallChange === true,
                    actorId: input.actorId,
                  })
              }),
            )
      const choice = yield* mergeReviews.choose(input.taskId, input.review, input.actorId, prepare)
      if (input.review === 'review')
        yield* skipReview({
          taskId: input.taskId,
          envelope: yield* envelope('task.skip_review', { taskId: input.taskId }, undefined, input.actorId),
        })
      return choice
    })

  /** Older Open-pull-request callers cannot bypass a newly configured review on a Change. */
  const publishAsked = (taskId: string) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const [plan] = yield* sql<{ parameters: string }>`
          SELECT parameters FROM task_plans WHERE task_id = ${taskId} AND state IN ('proposed', 'accepted')
          ORDER BY proposed_at DESC, rowid DESC LIMIT 1`
      if (plan !== undefined) {
        const parameters = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(PlanParameters))(plan.parameters)
        const reviewer = parameters.steps.some((step) => step.key === 'review' && !step.skipped) && parameters.reviewAfterMerge !== true
        if (reviewer) {
          // unshipped counts only repositories without an open pull request. A sibling's open request cannot bypass this review.
          const waiting = yield* changes.unshipped(taskId)
          if (waiting.some((one) => shipsToOpen({ end: 'draft', open: false, commits: one.commits.length })))
            return yield* shipPressed(taskId, instance.personId, { openDraft: true, route: { review: true, far: 'push' } })
        }
      }
      return yield* publish(taskId)
    })

  /**
   * The person's new route for the task's Ship under way (RouteShip): kept at once, and the press answered. Its review
   * goes as it says while it is still to come or under way, past it as it went; off, a review under way or waiting stops
   * behind, as Skip review stops it. How far, from wherever it stands: once marked ready, it can't go back to a draft, and
   * a Ship waiting to merge that goes no further than ready stops waiting, and ends there.
   */
  const routeShip = (input: Parameters<Runs['Service']['routeShip']>[0]) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const notShipping = new ShipRefused({ taskId: input.taskId, why: 'not_shipping' })
      const current = yield* currentRun(input.taskId)
      if (current === undefined) return yield* notShipping
      const changed = yield* sql.withTransaction(
        Effect.gen(function* () {
          if (!(yield* going(current))) return undefined
          const [stored] = yield* sql<{ parameters: string }>`SELECT parameters FROM runs WHERE id = ${current.runId}`
          const parameters = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(PlanParameters))(
            stored?.parameters ?? current.parameters,
          )
          const ships = parameters.ships
          if (ships === undefined || ships.reviewOnly === true) return undefined
          const [step] = yield* sql<{ nodeKey: string }>`
                SELECT n.node_key FROM node_attempts a JOIN nodes n ON n.id = a.node_id
                WHERE n.execution_id = ${current.executionId} AND a.state IN ('admitted', 'running', 'held', 'waiting_attention')
                ORDER BY a.admitted_at DESC, a.rowid DESC LIMIT 1`
          const was = routeOfShip(ships, parameters.steps, parameters.end ?? null)
          const at = shipStopOf({ at: ships.at, step: step?.nodeKey, reviewing: reviewsBeforeShip(parameters) })
          const wanted = { review: input.route.review ?? was.review, far: input.route.far ?? was.far }
          const route: ShipRoute = {
            review: at === 'review' ? was.review && wanted.review : was.review,
            far: (at === 'ready' || at === 'merge') && wanted.far === 'push' ? 'ready' : wanted.far,
          }
          // Its merge went to the host before this (its intent kept, as `stillMerges` read it): it can't be called back.
          if (at === 'merge' && route.far !== 'merge') {
            const [sent] = yield* sql<{ n: number }>`
                  SELECT count(*) AS n FROM mutation_receipts m JOIN work_items w ON w.id = m.work_item_id
                  JOIN external_links l ON l.id = w.subject_id AND w.subject_type = 'external_link'
                  JOIN runs r ON r.id = ${current.runId}
                  WHERE l.task_id = ${input.taskId} AND m.operation = 'merge' AND m.state IN ('intended', 'uncertain')
                    AND m.created_at >= r.created_at`
            if ((sent?.n ?? 0) > 0) return 'merging' as const
          }
          const revision = yield* change('runs', current.runId, {
            parameters: JSON.stringify({ ...parameters, ships: { ...ships, route } }),
          })
          yield* fact({
            projectId: current.projectId,
            aggregateType: 'run',
            aggregateId: current.runId,
            revision,
            type: 'run.rerouted',
            payload: { route },
            actorId: input.envelope.actorId,
            commandId: input.envelope.commandId,
          })
          return {
            route,
            skips: at === 'review' && was.review && !route.review,
            stopsWaiting: at === 'merge' && route.far !== 'merge',
          }
        }),
      )
      if (changed === undefined) return yield* notShipping
      if (changed === 'merging') return yield* new ShipRefused({ taskId: input.taskId, why: 'merging' })
      yield* touchCard(input.taskId)
      // Its review stops behind the press, as Skip review stops it, and the Ship goes on to its push.
      if (changed.skips)
        yield* Effect.forkIn(
          provide(
            skipReview({ envelope: input.envelope, taskId: input.taskId }).pipe(
              Effect.catchCause((cause) =>
                Cause.hasInterruptsOnly(cause) ? Effect.interrupt : Effect.logWarning('Could not stop the review of a Ship', cause),
              ),
            ),
          ),
          scope,
        )
      // Waiting to merge, it looks again now, and ends at ready.
      const wake = mergeWakes.get(current.runId)
      if (changed.stopsWaiting && wake !== undefined) yield* Queue.offer(wake, undefined)
      return changed.route
    })

  return {
    changeTeam,
    declineReview,
    makeChange,
    publishAsked,
    reshape,
    routeShip,
    setReviewAfterMerge,
    shipCouldNotStart,
    shipPressed,
    skipReview,
  }
}
