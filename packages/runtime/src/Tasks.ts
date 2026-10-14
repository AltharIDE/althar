import { existsSync } from 'node:fs'

import { type CommandEnvelope, type ProjectId, RunState, runLifecycle, TaskState, taskLifecycle, transition } from '@althar/domain'
import type { Ledger } from '@althar/persistence-sqlite'
import { Context, type Crypto, Effect, Layer, Option, Schema, Semaphore } from 'effect'
import { SqlClient } from 'effect/sql'

import { touchCard } from './cards'
import { TITLE_LENGTH } from './Coordinator'
import { NotFound, TaskRefused } from './errors'
import { makeScratch } from './firstWrite'
import { branchExists, restoreDetachedWorktree, restoreWorktree } from './git'
import { Instance } from './Instance'
import { Plans } from './Plans'
import { copyReviewed, reviewOf } from './reviewing'
import { touchQuestion } from './Questions'
import { change, fact, timestamp } from './records'
import { indexTask } from './Search'
import { type Lead, PlanParameters, Runs } from './Runs'
import { Sessions } from './Sessions'
import { Setups } from './Setups'

/*
 * A task's course as the person steers it (docs/architecture/05, "Task and
 * run lifecycle"): start its plan now, stop it, resume it, abandon it, and
 * reopen it once abandoned. What applies is worked out once, in `actionsOf`,
 * for the task's menu and for the commands alike; a command that no longer
 * applies does nothing, so two presses are one.
 *
 * Stopping suspends the run: the step it was on is cut short, the call a
 * step waited on is withdrawn, and every agent on the task stops. Resuming
 * carries that step on (`Runs.resume`). Abandoning settles the task as it
 * stands: its plan is declined, its calls withdrawn, its run suspended rather
 * than ended, and its agents stop. Its worktree and branch stay where they
 * are, since Althar never removes the person's worktrees for them (01).
 * Reopening opens it on them again, putting back a worktree whose folder
 * went, which Althar sets up again (a plain task's that never had a branch
 * with none still, where it started; a review's copy at the head its lead
 * read, set up with nothing): a run that was cut short resumes like a
 * stopped one, a run that passed is ready again, and a plan that never
 * started waits, held. A merged task is done for good.
 */

/** What the person can do to a task as a whole, in its menu's order. */
export type TaskAction = 'start' | 'stop' | 'resume' | 'abandon' | 'reopen'

/** Where a task stands, as far as its course goes. */
export interface Standing {
  readonly taskId: string
  readonly projectId: ProjectId
  readonly state: TaskState
  /** Its plan still waiting to start. */
  readonly planId: string | null
  /** Its latest run's state. */
  readonly runState: RunState | null
  /** Its threads: its own, and its steps'. */
  readonly threads: ReadonlyArray<string>
  /** An agent is on one of them, or starting. */
  readonly working: boolean
}

/**
 * What applies where a task stands. Merged, nothing. Abandoned, reopening.
 * Otherwise abandoning, always; starting its plan while it waits to start;
 * stopping while its run runs or an agent is on it; resuming while its run
 * is suspended.
 */
export const actionsOf = (standing: Pick<Standing, 'state' | 'planId' | 'runState' | 'working'>): ReadonlyArray<TaskAction> => {
  switch (standing.state) {
    case 'done':
      return []
    case 'abandoned':
      return ['reopen']
    case 'draft':
    case 'open': {
      const actions: Array<TaskAction> = []
      if (standing.planId !== null) actions.push('start')
      if (standing.runState === 'running' || standing.working) actions.push('stop')
      if (standing.runState === 'suspended') actions.push('resume')
      actions.push('abandon')
      return actions
    }
  }
}

/** Where a task stands: its state, its plan waiting, its latest run, its threads, and whether an agent is on one. */
export const standingOf = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const sessions = yield* Sessions
    const [row] = yield* sql<{ projectId: ProjectId; state: string; planId: string | null; runState: string | null; starting: number }>`
      SELECT k.project_id, k.state,
        (SELECT id FROM task_plans WHERE task_id = k.id AND state = 'proposed' ORDER BY proposed_at DESC LIMIT 1) AS plan_id,
        (SELECT state FROM runs WHERE task_id = k.id ORDER BY created_at DESC LIMIT 1) AS run_state,
        -- An agent on its way: starting, its lead about to be asked about a conflict once it has a place, or a turn of
        -- its lead or reviewer waiting for one (Busy.ts).
        (SELECT count(*) FROM provider_sessions s JOIN threads h ON h.id = s.thread_id
          WHERE h.task_id = k.id AND s.state = 'starting')
        + (SELECT count(*) FROM conflict_resolutions c WHERE c.task_id = k.id AND c.state = 'resolving' AND c.waiting IS NOT NULL)
        + (SELECT count(*) FROM threads h WHERE h.task_id = k.id AND h.waits_for_place IS NOT NULL)
          AS starting
      FROM tasks k WHERE k.id = ${taskId}`
    if (row === undefined) return yield* new NotFound({ kind: 'task', id: taskId })
    const threads = (yield* sql<{ id: string }>`SELECT id FROM threads WHERE task_id = ${taskId} ORDER BY created_at`).map(
      (thread) => thread.id,
    )
    const live = yield* Effect.forEach(threads, (threadId) => sessions.running(threadId))
    return {
      taskId,
      projectId: row.projectId,
      // The store keeps only these words (each column refers to its vocabulary), so another is a bug, not an answer.
      state: yield* Effect.orDie(Schema.decodeUnknownEffect(TaskState)(row.state)),
      planId: row.planId,
      runState: row.runState === null ? null : yield* Effect.orDie(Schema.decodeUnknownEffect(RunState)(row.runState)),
      threads,
      working: row.starting > 0 || live.some(Option.isSome),
    } satisfies Standing
  })

/** What a stopped attempt kept of its output (the runtime's own JSON, or none), with the mark that stopping cut it short. */
const stoppedOutput = (output: string | null) =>
  JSON.stringify({ ...(JSON.parse(output ?? '{}') as Readonly<Record<string, unknown>>), stopped: true })

type Store = SqlClient.SqlClient | Instance | Ledger | Crypto.Crypto | Sessions | Runs | Plans | Setups

export class Tasks extends Context.Service<
  Tasks,
  {
    /** Stops the task: its run is suspended, the step it was on cut short, and every agent on it stops. */
    stop(input: { readonly envelope: CommandEnvelope; readonly taskId: string }): Effect.Effect<void, unknown>
    /** Carries a stopped task on from the step it was on: with its last lead, or the one given. */
    resume(input: { readonly envelope: CommandEnvelope; readonly taskId: string; readonly lead?: Lead }): Effect.Effect<void, unknown>
    /** Settles the task without its change; its worktree and branch stay. Refused for a merged task. */
    abandon(input: { readonly envelope: CommandEnvelope; readonly taskId: string }): Effect.Effect<void, unknown>
    /** Opens an abandoned task again, on its worktree and branch. Refused for a merged task. */
    reopen(input: { readonly envelope: CommandEnvelope; readonly taskId: string }): Effect.Effect<void, unknown>
    /**
     * Gives the task another title, in any state, and records who did. Its slug, its branch, its worktree's
     * folder and the title of a pull request or an issue already opened for it stay as they were made.
     */
    rename(input: { readonly envelope: CommandEnvelope; readonly taskId: string; readonly title: string }): Effect.Effect<void, unknown>
    /**
     * The person opened the task's screen: when, kept. One that finished as
     * a plain task (`finished`, as its card reads), with no pull request,
     * nothing waiting on the person and no plan to start, is done once seen:
     * settled now. Writing to its lead later opens it again (ADR-034).
     */
    see(input: { readonly taskId: string; readonly finished: boolean }): Effect.Effect<void, unknown>
    /** Does something in the task's turn: never beside its stopping, resuming, abandoning or reopening. */
    inTurn<A, E, R>(taskId: string, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R>
  }
>()('@althar/runtime/Tasks') {
  static readonly layer: Layer.Layer<Tasks, never, Store> = Layer.effect(
    Tasks,
    Effect.gen(function* () {
      const context = yield* Effect.context<Store>()
      const instance = yield* Instance
      const sessions = yield* Sessions
      const runs = yield* Runs
      const plans = yield* Plans
      const setups = yield* Setups
      const provide = <A, E>(effect: Effect.Effect<A, E, Store>) => Effect.provideContext(effect, context)
      /*
       * A task's course changes one at a time, through stopping its agents
       * and starting them: a resume pressed while a stop still waits for its
       * agents to go runs once they have.
       */
      const locks = new Map<string, Semaphore.Semaphore>()
      const inTurn = <A, E, R>(taskId: string, effect: Effect.Effect<A, E, R>) =>
        Effect.suspend(() => {
          const lock = locks.get(taskId) ?? Semaphore.makeUnsafe(1)
          locks.set(taskId, lock)
          return lock.withPermits(1)(effect)
        })
      const oneAtATime = <A, E>(taskId: string, effect: Effect.Effect<A, E, Store>) => provide(inTurn(taskId, effect))

      /**
       * Every agent on the task stops: its lead's, and its steps', on the
       * threads it has now, a step's made since it was read too. Stopping one
       * that isn't there is nothing.
       */
      const stopAgents = (taskId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const threads = yield* sql<{ id: string }>`SELECT id FROM threads WHERE task_id = ${taskId}`
          yield* Effect.forEach(threads, (thread) => Effect.ignore(sessions.stop(thread.id)), { concurrency: 'unbounded', discard: true })
        })

      /**
       * Suspends the task's run, if it runs: each attempt it was on is cut
       * short, marked stopped, and its run attempt interrupted. The call a
       * step waited on, and a question an agent asked, are withdrawn, run or
       * no run. A run already suspended has whatever started since cut short
       * too. Publishing Althar had begun on the host says what it did there
       * when it ends, and the run waits all the same. Inside the caller's
       * transaction.
       */
      const suspend = (taskId: string, envelope: CommandEnvelope, why: 'stopped' | 'abandoned') =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          // Nothing runs, so no step waits on the person, and no agent's question does: an agent asking outside a run too.
          const calls = yield* sql<{ id: string; projectId: ProjectId }>`
            SELECT id, project_id FROM attention_requests WHERE task_id = ${taskId} AND kind IN ('stuck', 'question') AND state = 'open'`
          for (const call of calls) {
            const revision = yield* change('attention_requests', call.id, { state: 'withdrawn' })
            yield* fact({
              projectId: call.projectId,
              aggregateType: 'attention_request',
              aggregateId: call.id,
              revision,
              type: 'attention_request.withdrawn',
              actorId: envelope.actorId,
              commandId: envelope.commandId,
            })
            yield* touchQuestion(call.id)
          }
          const [run] = yield* sql<{ id: string; projectId: ProjectId; state: string }>`
            SELECT id, project_id, state FROM runs WHERE task_id = ${taskId} AND state IN ('running', 'suspended')
            ORDER BY created_at DESC LIMIT 1`
          if (run === undefined) return
          const at = yield* timestamp
          const attempts = yield* sql<{ id: string; nodeId: string; output: string | null }>`
            SELECT a.id, a.node_id, a.output FROM node_attempts a JOIN nodes n ON n.id = a.node_id
            JOIN workflow_executions e ON e.id = n.execution_id
            WHERE e.run_id = ${run.id} AND a.state IN ('ready', 'admitted', 'running', 'waiting_attention', 'verifying', 'held', 'reconciling')`
          for (const attempt of attempts) {
            const revision = yield* change('node_attempts', attempt.id, {
              state: 'cancelled',
              holdReason: null,
              output: stoppedOutput(attempt.output),
              endedAt: at,
            })
            yield* change('nodes', attempt.nodeId, { state: 'cancelled' })
            yield* fact({
              projectId: run.projectId,
              aggregateType: 'node_attempt',
              aggregateId: attempt.id,
              revision,
              type: 'node_attempt.cancelled',
              payload: { stopped: true, why },
              actorId: envelope.actorId,
              commandId: envelope.commandId,
            })
          }
          const active = yield* sql<{ id: string }>`SELECT id FROM run_attempts WHERE run_id = ${run.id} AND state = 'active'`
          for (const attempt of active) yield* change('run_attempts', attempt.id, { state: 'interrupted', endedAt: at })
          if (run.state !== 'running') return
          const state = yield* transition(runLifecycle, 'running', 'suspended')
          const revision = yield* change('runs', run.id, { state })
          yield* fact({
            projectId: run.projectId,
            aggregateType: 'run',
            aggregateId: run.id,
            revision,
            type: 'run.suspended',
            payload: { why },
            actorId: envelope.actorId,
            commandId: envelope.commandId,
          })
        })

      const stop = (input: { readonly envelope: CommandEnvelope; readonly taskId: string }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const standing = yield* standingOf(input.taskId)
          if (!actionsOf(standing).includes('stop')) return
          // Suspended first, so no step takes its agents stopping as one going.
          yield* sql.withTransaction(suspend(input.taskId, input.envelope, 'stopped'))
          yield* stopAgents(input.taskId)
          // A turn of its agents that waited for a place waits no more: what it would have delivered stays in its thread.
          yield* sql`UPDATE threads SET waits_for_place = NULL WHERE task_id = ${input.taskId} AND waits_for_place IS NOT NULL`
          yield* touchCard(input.taskId)
        })

      const resume = (input: { readonly envelope: CommandEnvelope; readonly taskId: string; readonly lead?: Lead }) =>
        Effect.gen(function* () {
          if (!actionsOf(yield* standingOf(input.taskId)).includes('resume')) return
          yield* runs.resume(input)
        })

      const abandon = (input: { readonly envelope: CommandEnvelope; readonly taskId: string }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const standing = yield* standingOf(input.taskId)
          if (standing.state === 'done') return yield* new TaskRefused({ taskId: input.taskId, why: 'merged' })
          const abandoned = yield* sql.withTransaction(
            Effect.gen(function* () {
              // Read again where it is written: abandoned meanwhile, it stays so; merged meanwhile, the lifecycle refuses it.
              const [task] = yield* sql<{ state: string }>`SELECT state FROM tasks WHERE id = ${input.taskId}`
              const now = yield* Schema.decodeUnknownEffect(TaskState)(task?.state)
              if (now === 'abandoned') return false
              const state = yield* transition(taskLifecycle, now, 'abandoned')
              const at = yield* timestamp
              const said = { actorId: input.envelope.actorId, commandId: input.envelope.commandId }
              // Its plan doesn't start: declined, its countdown with it; and one its start had accepted, but made no run of yet.
              const proposed = yield* sql<{ id: string }>`
                SELECT id FROM task_plans p WHERE p.task_id = ${input.taskId}
                  AND (p.state = 'proposed' OR (p.state = 'accepted' AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.plan_id = p.id)))`
              for (const plan of proposed) {
                const revision = yield* change('task_plans', plan.id, { state: 'declined', startsAt: null, decidedAt: at })
                yield* fact({
                  projectId: standing.projectId,
                  aggregateType: 'task_plan',
                  aggregateId: plan.id,
                  revision,
                  type: 'task_plan.declined',
                  ...said,
                })
              }
              // Its calls go: there is nothing left to answer them for.
              const calls = yield* sql<{ id: string }>`
                SELECT id FROM attention_requests WHERE task_id = ${input.taskId} AND state = 'open'`
              for (const call of calls) {
                const revision = yield* change('attention_requests', call.id, { state: 'withdrawn' })
                yield* fact({
                  projectId: standing.projectId,
                  aggregateType: 'attention_request',
                  aggregateId: call.id,
                  revision,
                  type: 'attention_request.withdrawn',
                  ...said,
                })
                yield* touchQuestion(call.id)
              }
              yield* suspend(input.taskId, input.envelope, 'abandoned')
              const revision = yield* change('tasks', input.taskId, { state, settledAt: at })
              yield* fact({
                projectId: standing.projectId,
                aggregateType: 'task',
                aggregateId: input.taskId,
                revision,
                type: 'task.abandoned',
                ...said,
              })
              return true
            }),
          )
          if (!abandoned) return
          // Its run is suspended, so no step answers an agent going: each one on it stops.
          yield* stopAgents(input.taskId)
          yield* touchCard(input.taskId)
        })

      const reopen = (input: { readonly envelope: CommandEnvelope; readonly taskId: string }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const standing = yield* standingOf(input.taskId)
          if (standing.state === 'done') return yield* new TaskRefused({ taskId: input.taskId, why: 'merged' })
          if (standing.state !== 'abandoned') return
          const [project] = yield* sql<{ id: string }>`
            SELECT id FROM projects WHERE id = ${standing.projectId} AND archived_at IS NULL`
          if (project === undefined) return yield* new NotFound({ kind: 'project', id: standing.projectId })
          // Its worktrees, each put back on its branch where its folder went: git runs before the task is written. A plain task's
          // that never had one is put back with none, where it started, as it was made (DEV-96); a review's copy, at the head its
          // lead read, never where the pull request's change starts, which it only compares with.
          const worktrees = yield* sql<{
            id: string
            path: string
            access: string
            branch: string
            branched: number
            baseCommit: string | null
            repository: string
          }>`
            SELECT w.id, w.path, w.access, w.branch, w.branched_at IS NOT NULL AS branched, w.base_commit, l.path AS repository FROM workspaces w
            JOIN repository_bindings b ON b.id = w.binding_id
            JOIN repository_locations l ON l.binding_id = w.binding_id AND l.device_id = ${instance.deviceId}
            WHERE w.task_id = ${input.taskId} AND w.device_id = ${instance.deviceId} AND w.state = 'ready'
            ORDER BY b.created_at, b.rowid`
          let restored = false
          for (const worktree of worktrees) {
            if (existsSync(worktree.path)) continue
            if (worktree.access === 'read') {
              const review = yield* reviewOf(input.taskId)
              if (review === null) return yield* new TaskRefused({ taskId: input.taskId, why: 'branch_gone' })
              yield* copyReviewed(worktree.repository, worktree.path, review)
            } else if (worktree.branched === 0 && worktree.baseCommit !== null) {
              yield* restoreDetachedWorktree(worktree.repository, worktree.path, worktree.baseCommit)
              yield* makeScratch(worktree.path)
            } else {
              if (!(yield* branchExists(worktree.repository, worktree.branch)))
                return yield* new TaskRefused({ taskId: input.taskId, why: 'branch_gone' })
              yield* restoreWorktree(worktree.repository, worktree.path, worktree.branch)
            }
            // Put back, it is a fresh one, with nothing installed: it is set up again. Said at once, so a later one that
            // can't be put back doesn't leave this one taken for set up when the person tries again.
            yield* sql.withTransaction(
              Effect.gen(function* () {
                const revision = yield* change('workspaces', worktree.id, { setup: null })
                yield* fact({
                  projectId: standing.projectId,
                  aggregateType: 'workspace',
                  aggregateId: worktree.id,
                  revision,
                  type: 'workspace.restored',
                  actorId: input.envelope.actorId,
                  commandId: input.envelope.commandId,
                })
              }),
            )
            restored = true
          }
          const reopened = yield* sql.withTransaction(
            Effect.gen(function* () {
              // Read again where it is written: reopened meanwhile, the lifecycle refuses it.
              const [task] = yield* sql<{ state: string }>`SELECT state FROM tasks WHERE id = ${input.taskId}`
              const now = yield* Schema.decodeUnknownEffect(TaskState)(task?.state)
              // Abandoned before its plan started, its plan comes back held, and it is a draft again, which starts when the person says.
              const [ran] = yield* sql<{ id: string }>`SELECT id FROM runs WHERE task_id = ${input.taskId} LIMIT 1`
              const [declined] =
                ran === undefined
                  ? yield* sql<{ parameters: string }>`
                      SELECT parameters FROM task_plans WHERE task_id = ${input.taskId} AND state = 'declined'
                      ORDER BY proposed_at DESC LIMIT 1`
                  : []
              const state = yield* transition(taskLifecycle, now, declined === undefined ? 'open' : 'draft')
              const revision = yield* change('tasks', input.taskId, { state, settledAt: null })
              yield* fact({
                projectId: standing.projectId,
                aggregateType: 'task',
                aggregateId: input.taskId,
                revision,
                type: 'task.reopened',
                actorId: input.envelope.actorId,
                commandId: input.envelope.commandId,
              })
              return { declined }
            }),
          )
          if (reopened.declined !== undefined) {
            const plan = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(PlanParameters))(reopened.declined.parameters)
            yield* plans.propose({
              projectId: standing.projectId,
              taskId: input.taskId,
              steps: plan.steps,
              reason: plan.reason,
              end: plan.end ?? null,
              actorId: input.envelope.actorId,
              held: true,
            })
          }
          if (restored) yield* setups.begin(input.taskId)
          yield* touchCard(input.taskId)
        })

      /*
       * Only the title changes: the slug, the branch and the worktree's folder
       * were made from the first one and other things find them by it, and a
       * pull request or issue opened already keeps the title it was opened with.
       * The event says who renamed it, and what it was, so the person's rename
       * and a later coordinator's or lead's are one command.
       */
      const rename = (input: { readonly envelope: CommandEnvelope; readonly taskId: string; readonly title: string }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const title = input.title.trim()
          if (title === '') return yield* new TaskRefused({ taskId: input.taskId, why: 'no_title' })
          if (title.length > TITLE_LENGTH) return yield* new TaskRefused({ taskId: input.taskId, why: 'title_too_long' })
          const renamed = yield* sql.withTransaction(
            Effect.gen(function* () {
              const [task] = yield* sql<{
                projectId: ProjectId
                title: string
              }>`SELECT project_id, title FROM tasks WHERE id = ${input.taskId}`
              if (task === undefined) return yield* new NotFound({ kind: 'task', id: input.taskId })
              if (task.title === title) return false
              const revision = yield* change('tasks', input.taskId, { title })
              yield* fact({
                projectId: task.projectId,
                aggregateType: 'task',
                aggregateId: input.taskId,
                revision,
                type: 'task.renamed',
                payload: { title, was: task.title },
                actorId: input.envelope.actorId,
                commandId: input.envelope.commandId,
              })
              yield* indexTask(input.taskId)
              return true
            }),
          )
          if (renamed) yield* touchCard(input.taskId)
        })

      const see = (input: { readonly taskId: string; readonly finished: boolean }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const at = yield* timestamp
          yield* sql`UPDATE tasks SET seen_at = ${at} WHERE id = ${input.taskId}`
          if (!input.finished) return
          const settled = yield* sql.withTransaction(
            Effect.gen(function* () {
              // Read again where it is written: a round opened, a call came or a pull request opened meanwhile, and it stays.
              const [task] = yield* sql<{ projectId: ProjectId; state: string; run: string | null; open: number }>`
                SELECT k.project_id, k.state,
                  (SELECT state FROM runs WHERE task_id = k.id ORDER BY created_at DESC, rowid DESC LIMIT 1) AS run,
                  (SELECT count(*) FROM attention_requests a WHERE a.task_id = k.id AND a.state = 'open')
                  + (SELECT count(*) FROM task_plans p WHERE p.task_id = k.id AND p.state = 'proposed')
                  + (SELECT count(*) FROM external_links l WHERE l.task_id = k.id AND l.kind = 'change') AS open
                FROM tasks k WHERE k.id = ${input.taskId}`
              if (task === undefined || task.state !== 'open' || task.run !== 'succeeded' || task.open > 0) return false
              const state = yield* transition(taskLifecycle, 'open', 'done')
              const revision = yield* change('tasks', input.taskId, { state, settledAt: at })
              yield* fact({
                projectId: task.projectId,
                aggregateType: 'task',
                aggregateId: input.taskId,
                revision,
                type: 'task.done',
                payload: { seen: true },
                actorId: instance.personId,
              })
              return true
            }),
          )
          if (settled) yield* touchCard(input.taskId)
        })

      return Tasks.of({
        see: (input) => oneAtATime(input.taskId, see(input)),
        rename: (input) => provide(rename(input)),
        stop: (input) => oneAtATime(input.taskId, stop(input)),
        resume: (input) => oneAtATime(input.taskId, resume(input)),
        abandon: (input) => oneAtATime(input.taskId, abandon(input)),
        reopen: (input) => oneAtATime(input.taskId, reopen(input)),
        inTurn,
      })
    }),
  )
}
