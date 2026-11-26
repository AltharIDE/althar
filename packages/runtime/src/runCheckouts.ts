import type { CheckoutAnswer, CheckoutAsk, CheckoutWait, WorksIn } from '@althar/contracts'
import { type ActorId, type CommandEnvelope, Ids, type ProjectId, newId } from '@althar/domain'
import type { Ledger, RevisionConflict, RowNotFound } from '@althar/persistence-sqlite'
import { type Crypto, Duration, Effect, Option, Queue, type Schema } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'
import type { Busy } from './Busy'
import { touchCard } from './cards'
import type { Changes } from './Changes'
import { RuntimeConfig } from './Config'
import { envelope } from './envelope'
import { AttentionClosed, NotFound, NothingToWaitFor } from './errors'
import type { InstanceInfo } from './Instance'
import {
  type CheckoutConsent,
  type CheckoutSeen,
  type MoveConsent,
  type Moved,
  type Spot,
  checkoutsHeld,
  giveBackSpot,
  moveToLocal,
  moveToWorktree,
  movesWaiting,
  place,
  settledHolding,
  waitMove,
} from './local'
import type { PlanParameters, PlanStep, TaskEnd } from './planParameters'
import { change, fact, timestamp } from './records'
import { type CheckoutHold, type Place, type RunRow, type Store, type StuckInfo, waitingOf } from './runRecords'
import type { Sessions } from './Sessions'
import { Setups } from './Setups'
import { makeTaskPlaces, placesWaiting } from './taskPlaces'
import { summarize } from './words'

interface RunCheckoutsDependencies {
  readonly busy: Busy['Service']
  readonly changes: Changes['Service']
  readonly currentRun: (taskId: string) => Effect.Effect<RunRow | undefined, SqlError.SqlError, SqlClient.SqlClient>
  readonly instance: InstanceInfo
  readonly notYetStopped: Effect.Effect<Set<string>>
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
  readonly waitForPlace: (
    run: Pick<RunRow, 'projectId'>,
    attemptId: string,
    place: Place,
    since?: string,
  ) => Effect.Effect<void, SqlError.SqlError | Schema.SchemaError | RowNotFound | RevisionConflict, SqlClient.SqlClient | Ledger>
}

export const makeRunCheckouts = (dependencies: RunCheckoutsDependencies) =>
  Effect.gen(function* () {
    const { busy, changes, currentRun, instance, notYetStopped, sessions, stepsOf, stuck, waitForPlace } = dependencies
    // Moving a task between the home and its workers (taskPlaces.ts): one that waits is tried again with the moves below.
    const places = makeTaskPlaces({ sessions })

    /* ---- Local tasks (ADR-091): a plan's first step takes its checkouts, or waits for them ---- */

    /** Settled tasks' checkouts Althar said stay on their branch, by workspace: said once a launch. */
    const toldStays = new Set<string>()

    const toldOnce = (spot: Spot) => {
      if (toldStays.has(spot.id)) return true
      toldStays.add(spot.id)
      return false
    }

    const checkoutWakes = yield* Queue.sliding<void>(1)

    const checkoutsEvery = (yield* RuntimeConfig).local?.every ?? Duration.seconds(5)

    const worksInOf = (run: Pick<RunRow, 'parameters'>): WorksIn =>
      (JSON.parse(run.parameters) as { worksIn?: WorksIn }).worksIn ?? 'worktree'

    /** Holds a first step for its checkout, with what it waits for: inside the caller's transaction. */
    const holdForCheckout = (run: RunRow, attemptId: string, hold: CheckoutHold) =>
      Effect.gen(function* () {
        const revision = yield* change('node_attempts', attemptId, {
          state: 'held',
          holdReason: 'checkout',
          output: JSON.stringify(hold),
        })
        yield* fact({
          projectId: run.projectId,
          aggregateType: 'node_attempt',
          aggregateId: attemptId,
          revision,
          type: 'node_attempt.held',
          payload: { reason: 'checkout', waits: hold.waits ?? null },
          actorId: instance.systemId,
        })
      })

    /** Asks the person about a checkout before the task takes it, once, keeping what was seen, which the answer holds for: inside the caller's transaction. */
    const askCheckout = (run: RunRow, attemptId: string, ask: CheckoutAsk, seen: CheckoutSeen) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const [open] = yield* sql<{ id: string }>`
            SELECT id FROM attention_requests WHERE task_id = ${run.taskId} AND kind = 'checkout' AND state = 'open'`
        if (open !== undefined) return
        const id = yield* newId(Ids.attentionRequest)
        yield* sql`INSERT INTO attention_requests ${sql.insert({
          id,
          projectId: run.projectId,
          taskId: run.taskId,
          nodeAttemptId: attemptId,
          kind: 'checkout',
          addresseeActorId: instance.personId,
          payload: JSON.stringify({ ...ask, seen }),
          state: 'open',
          createdAt: yield* timestamp,
        })}`
        yield* fact({
          projectId: run.projectId,
          aggregateType: 'attention_request',
          aggregateId: id,
          revision: 1,
          type: 'attention_request.opened',
          payload: ask,
          actorId: instance.systemId,
        })
      })

    /**
     * Places a plan's first step where its plan says it works, before its
     * lead starts (local.ts): true where it is. Otherwise it is held for its
     * checkout, freeing its place among the agents at work, with what it
     * waits for, or asking the person; and it is looked at again
     * (`lookAtCheckouts`). A worktree that can't be made leaves the step
     * needing the person, as a lead that can't start does.
     */
    const placeFirst = (run: RunRow, attemptId: string, hold?: CheckoutHold) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const placed = yield* Effect.exit(place(run.taskId, worksInOf(run), hold?.consents ?? [], toldOnce, notYetStopped))
        if (placed._tag === 'Failure') {
          const { implement } = yield* stepsOf(run)
          yield* stuck(
            run,
            { id: attemptId },
            {
              step: 'implement',
              why: 'failed_to_start',
              detail: summarize(placed.cause) || null,
              agentId: implement?.agentId ?? null,
              round: 0,
              open: 0,
            },
          )
          return false
        }
        const where = placed.value
        if (where.kind === 'ready') return true
        const waits: CheckoutWait | undefined =
          where.kind === 'taken'
            ? { why: 'taken', by: where.by }
            : where.kind === 'changes'
              ? { why: 'changes', repository: where.repository }
              : undefined
        const next: CheckoutHold = {
          place: { how: 'start' },
          since: hold?.since ?? (yield* timestamp),
          ...(hold?.consents === undefined ? {} : { consents: hold.consents }),
          ...(waits === undefined ? {} : { waits }),
        }
        const changed = yield* sql.withTransaction(
          Effect.gen(function* () {
            const [now] = yield* sql<{ state: string; holdReason: string | null; output: string | null }>`
                SELECT state, hold_reason, output FROM node_attempts WHERE id = ${attemptId}`
            const held = now?.state === 'held' && now.holdReason === 'checkout'
            if (now === undefined || (now.state !== 'admitted' && !held)) return false
            if (held && now.output === JSON.stringify(next) && where.kind !== 'asks') return false
            yield* holdForCheckout(run, attemptId, next)
            if (where.kind === 'asks') yield* askCheckout(run, attemptId, where.ask, where.seen)
            return true
          }),
        )
        if (changed) {
          yield* touchCard(run.taskId)
          // The place among the agents at work it had is another's meanwhile.
          yield* busy.wake
        }
        return false
      })

    /** A first step held for its checkout, looked at again: placed now, it waits for a place among the agents at work, as any first step. */
    const lookAgain = (row: { readonly taskId: string; readonly attemptId: string; readonly output: string | null }) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const current = yield* currentRun(row.taskId)
        if (current === undefined) return
        const hold = waitingOf(row.output, yield* timestamp) as CheckoutHold
        if (!(yield* placeFirst(current, row.attemptId, hold))) return
        const moved = yield* sql.withTransaction(
          Effect.gen(function* () {
            const [still] = yield* sql<{ state: string; holdReason: string | null }>`
                SELECT state, hold_reason FROM node_attempts WHERE id = ${row.attemptId}`
            if (still?.state !== 'held' || still.holdReason !== 'checkout') return false
            // From when it began waiting, so it keeps its place in the line.
            yield* waitForPlace(current, row.attemptId, { how: 'start' }, hold.since)
            return true
          }),
        )
        if (moved) {
          yield* touchCard(row.taskId)
          yield* busy.wake
        }
      })

    /**
     * What waits on a checkout, looked at: each checkout a settled task
     * still holds, given back where it can be now; then each first step held
     * for one, with nothing asked of the person, placed again, oldest first.
     * True while any of them is left, or any task holds a checkout here:
     * what is looked at again in a few seconds, as the person commits or a
     * task settles.
     */
    const lookAtCheckouts = Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      // Not while anything of its task is still at work: settling stops it first (LeftBehind.ts), read again under the checkout's lock.
      const working = yield* notYetStopped
      for (const spot of (yield* settledHolding).filter((one) => !working.has(one.taskId)))
        yield* giveBackSpot(spot, toldOnce, notYetStopped).pipe(
          Effect.catchCause((cause) => Effect.logWarning('Could not give a checkout back', cause)),
        )
      const held = yield* sql<{ taskId: string; attemptId: string; output: string | null }>`
          SELECT r.task_id, a.id AS attempt_id, a.output FROM runs r JOIN workflow_executions e ON e.run_id = r.id
          JOIN nodes n ON n.execution_id = e.id JOIN node_attempts a ON a.node_id = n.id
          JOIN tasks k ON k.id = r.task_id JOIN projects p ON p.id = r.project_id
          WHERE r.state = 'running' AND a.state = 'held' AND a.hold_reason = 'checkout'
            AND k.state IN ('draft', 'open') AND p.archived_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM attention_requests q WHERE q.task_id = r.task_id AND q.kind = 'checkout' AND q.state = 'open')
          ORDER BY a.admitted_at`
      for (const row of held)
        yield* lookAgain(row).pipe(
          Effect.catchCause((cause) => Effect.logWarning('Could not place a task waiting for its checkout', cause)),
        )
      // Moves that wait for a checkout to be free or clean, or for the lead's turn to end, are tried again.
      const moves = yield* movesWaiting
      for (const one of moves)
        yield* moving(one.taskId, one.movingTo, one.change, instance.systemId).pipe(
          Effect.catchCause((cause) => Effect.logWarning('Could not move a task between a worktree and its checkout', cause)),
        )
      // And moves between the home and its workers that wait for the lead's turn to end.
      const placing = yield* placesWaiting
      for (const one of placing)
        yield* places
          .place({
            taskId: one.taskId,
            to: one.movingTo.to,
            ...(one.movingTo.lead === undefined ? {} : { lead: one.movingTo.lead }),
            ...(one.movingTo.fromLastTurn === true ? { fromLastTurn: true } : {}),
            retry: true,
            actorId: instance.systemId,
          })
          .pipe(Effect.catchCause((cause) => Effect.logWarning('Could not move a task between the home and a worker', cause)))
      return held.length > 0 || moves.length > 0 || placing.length > 0 || (yield* checkoutsHeld)
    })

    const workToward = (input: {
      readonly taskId: string
      readonly toward: string | null
      readonly change?: string | null
      readonly byLead?: boolean
    }): Effect.Effect<ReadonlyArray<string>, unknown, Store> =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const [task] = yield* sql<{ projectId: ProjectId; threadId: string; state: string }>`
            SELECT k.project_id, t.id AS thread_id, k.state FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task'
            WHERE k.id = ${input.taskId}`
        if (task === undefined) return yield* new NotFound({ kind: 'task', id: input.taskId })
        // Between turns: one under way ends first, so nothing moves under it.
        if (input.byLead !== true) yield* sessions.untilIdle(task.threadId, Duration.minutes(30))
        const done = yield* changes.retarget(input.taskId, input.toward, input.change ?? null)
        if (done.conflicts.length > 0 && input.byLead !== true) {
          const body = `The task works toward another branch now (${done.said.join(' ')}) Resolve the conflicts in ${done.conflicts.join(', ')}, then carry on: where a rebase stopped, \`git add\` them and \`git rebase --continue\`.`
          yield* sessions
            .send({
              envelope: yield* envelope('thread.send', { threadId: task.threadId }),
              threadId: task.threadId,
              body,
              quiet: true,
            })
            .pipe(Effect.catchCause((cause) => Effect.logWarning('Could not tell the lead about a conflict on its new target', cause)))
        }
        if (done.opens.length > 0) {
          const [run] = yield* sql<{ id: string }>`
              SELECT id FROM runs WHERE task_id = ${input.taskId} ORDER BY created_at DESC, rowid DESC LIMIT 1`
          if (run !== undefined)
            yield* changes
              .publish({ projectId: task.projectId, taskId: input.taskId, runId: run.id, end: 'draft', only: done.opens })
              .pipe(Effect.catchCause((cause) => Effect.logWarning('Could not open the pull request into the new branch', cause)))
        }
        yield* touchCard(input.taskId)
        return done.said
      })

    /**
     * Moves a task's change where the person asked, between its lead's turns: its lead in one, the move waits for it to end.
     * Moved, its plan says where it works now, its lead's next turn starts afresh in the new folder, and a new worktree is set
     * up as any is.
     */
    const moving = (
      taskId: string,
      to: 'worktree' | 'checkout',
      change: string | null,
      actorId: ActorId,
      consent?: MoveConsent,
    ): Effect.Effect<Moved, unknown, Store> =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const [thread] = yield* sql<{ id: string }>`SELECT id FROM threads WHERE task_id = ${taskId} AND kind = 'task'`
        if (thread === undefined) return yield* new NotFound({ kind: 'task', id: taskId })
        const lead = yield* sessions.running(thread.id)
        if (Option.isSome(lead) && lead.value.turnRunning) {
          const why = to === 'checkout' ? 'Moves to Local once its lead’s turn ends.' : 'Moves to a worktree once its lead’s turn ends.'
          yield* waitMove(taskId, change, to, why)
          return { kind: 'waits', why } as Moved
        }
        const moved = to === 'checkout' ? yield* moveToLocal(taskId, change, consent) : yield* moveToWorktree(taskId, change)
        if (moved.kind === 'moved') {
          yield* sql.withTransaction(moveTo(taskId, to, actorId))
          yield* sessions.moved(thread.id)
          if (to === 'worktree') yield* (yield* Setups).begin(taskId)
        }
        yield* touchCard(taskId)
        return moved
      })

    /** Where a task's plan and run say it works: as the person's answer moved it. Inside the caller's transaction. */
    const moveTo = (taskId: string, worksIn: WorksIn, actorId: ActorId) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{ table: 'runs' | 'task_plans'; id: string; projectId: ProjectId; parameters: string }>`
            SELECT 'runs' AS "table", id, project_id, parameters FROM runs WHERE task_id = ${taskId} AND state = 'running'
            UNION ALL
            SELECT 'task_plans' AS "table", id, project_id, parameters FROM task_plans WHERE task_id = ${taskId} AND state = 'accepted'`
        for (const row of rows) {
          const parameters = JSON.stringify({ ...(JSON.parse(row.parameters) as object), worksIn, worksInWhy: null })
          const revision = yield* change(row.table, row.id, { parameters })
          yield* fact({
            projectId: row.projectId,
            aggregateType: row.table === 'runs' ? 'run' : 'task_plan',
            aggregateId: row.id,
            revision,
            type: row.table === 'runs' ? 'run.plan_changed' : 'task_plan.changed',
            payload: { worksIn },
            actorId,
          })
        }
      })

    const answerCheckout = (input: { readonly envelope: CommandEnvelope; readonly attentionId: string; readonly answer: CheckoutAnswer }) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const { answer } = input
        const call = yield* sql.withTransaction(
          Effect.gen(function* () {
            const [row] = yield* sql<{ projectId: ProjectId; taskId: string; attemptId: string | null; payload: string; state: string }>`
                SELECT project_id, task_id, node_attempt_id AS attempt_id, payload, state FROM attention_requests
                WHERE id = ${input.attentionId} AND kind = 'checkout'`
            if (row === undefined) return yield* new NotFound({ kind: 'attention_request', id: input.attentionId })
            if (row.state !== 'open') return yield* new AttentionClosed({ attentionId: input.attentionId })
            const ask = JSON.parse(row.payload) as CheckoutAsk & { readonly seen?: CheckoutSeen }
            // Only what fits what was asked: waiting is for changes not committed, the branch's two answers for a branch.
            const fits = answer === 'worktree' || (answer === 'wait' ? ask.holdup === 'changes' : ask.holdup === 'branch')
            if (!fits) return yield* new NothingToWaitFor({ attentionId: input.attentionId })
            const revision = yield* change('attention_requests', input.attentionId, {
              state: 'answered',
              answeredAt: yield* timestamp,
              payload: JSON.stringify({ ...ask, answer }),
            })
            yield* fact({
              projectId: row.projectId,
              aggregateType: 'attention_request',
              aggregateId: input.attentionId,
              revision,
              type: 'attention_request.answered',
              payload: { answer },
              actorId: input.envelope.actorId,
              commandId: input.envelope.commandId,
            })
            if (answer === 'worktree') yield* moveTo(row.taskId, 'worktree', input.envelope.actorId)
            else if (row.attemptId !== null && ask.seen !== undefined) {
              // For that checkout only, as it was when asked: another, or this one changed since, is asked about again (local.ts).
              const consent: CheckoutConsent = { ...ask.seen, holdup: ask.holdup, answer }
              const [attempt] = yield* sql<{ output: string | null }>`SELECT output FROM node_attempts WHERE id = ${row.attemptId}`
              const hold = waitingOf(attempt?.output ?? null, yield* timestamp) as CheckoutHold
              const consents = [...(hold.consents ?? []).filter((one) => one.spotId !== consent.spotId), consent]
              yield* change('node_attempts', row.attemptId, { output: JSON.stringify({ ...hold, consents }) })
            }
            return row
          }),
        )
        yield* touchCard(call.taskId)
        // Placed again now, as answered.
        yield* Queue.offer(checkoutWakes, undefined)
      })

    return {
      answerCheckout,
      checkoutWakes,
      checkoutsEvery,
      lookAtCheckouts,
      moving,
      place: places.place,
      placeFirst,
      workToward,
      worksInOf,
    }
  })
