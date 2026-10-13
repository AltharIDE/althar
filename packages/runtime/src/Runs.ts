import { createHash } from 'node:crypto'

import type { LimitCall } from '@althar/contracts'
import type { FieldAnswer } from '@althar/provider-adapters'
import {
  type ActorId,
  type CommandEnvelope,
  Ids,
  newId,
  type ProjectId,
  type RunState,
  runLifecycle,
  taskLifecycle,
  transition,
} from '@althar/domain'
import type { Ledger } from '@althar/persistence-sqlite'
import { Cause, Context, type Crypto, Duration, Effect, Layer, Option, Queue, Schema, Semaphore, Stream } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'

import { Busy } from './Busy'
import type { Artifacts } from './Artifacts'
import { touchCard } from './cards'
import { Agents, RuntimeConfig } from './Config'
import { Changes, type Published } from './Changes'
import { NotConnected } from './Connections'
import { AttentionClosed, NoChangeToOpen, NotFound, NothingToWaitFor } from './errors'
import { Instance } from './Instance'
import { Limits, outWords, whenWords } from './Limits'
import { Live, type LiveEvent } from './Live'
import { Policies, usageLimitOf } from './Policies'
import { conventionsAt } from './conventions'
import { commitOf, commitsAhead, treeOf, uncommittedFiles } from './git'
import { filesLine, templateAsk } from './pullRequestWords'
import { evidenceFolderOf, reviewCopyOf, snapshotForReview } from './reviewCopy'
import { change, fact, timestamp } from './records'
import { envelope } from './envelope'
import { type Answered, Questions } from './Questions'
import {
  EVIDENCE_KINDS,
  EvidenceGiven,
  evidenceFiles,
  evidenceForReview,
  evidencePaths,
  keepEvidence,
  readEvidence,
  unverifiedOf,
} from './evidence'
import { Sessions } from './Sessions'
import { type GiveUp, watchStalls } from './Stalls'
import type { Tried } from './stallWatch'
import { addItem } from './threads'
import { ToolRefused, ToolServer, type Tool, type ToolAccess } from './ToolServer'
import { summarize } from './words'

/*
 * A task's run (docs/architecture/05; docs/plans/mvp.md, "The plan"): its
 * plan's steps, one after the other, on the real kernel. A run and its first
 * attempt, an execution with its first graph revision, a node per step, and an
 * attempt each time a node runs. For now the steps are Implement and Review,
 * and Review loops with the lead settling what it found, for up to three
 * rounds.
 *
 * A step ends when its agent says so through Althar's tools: the lead's
 * finish_step, the reviewer's report_review. What each reported goes into the
 * task's thread as a step result, which the person reads instead of the work.
 */

/** Review rounds before a task is left ready with findings still open. */
export const ROUNDS = 3

/**
 * How long a step carried on after a restart must have been at work for the
 * next restart to carry it on again; stopped sooner, it needs the person.
 */
export const RESTART_GRACE = Duration.minutes(5)

/** How often a step's agent cut off by its own limit on a turn carries on before it is reminded to report. */
const CONTINUES = 3

/** What it is told when it was cut off so. */
const CONTINUING = "Your last turn stopped at the agent's own limit on a turn's output or steps. Carry on from where you were."

export const PlanStep = Schema.Struct({
  key: Schema.Literals(['implement', 'review']),
  agentId: Schema.String,
  model: Schema.NullOr(Schema.String),
  /** How hard its agent thinks; the agent's own default without one. */
  effort: Schema.optional(Schema.NullOr(Schema.String)),
  skipped: Schema.Boolean,
})
export type PlanStep = typeof PlanStep.Type

/**
 * What a task does when its steps are done (the kit's "When the work is
 * done"): open a draft pull request, open one for review, or push its branch
 * only. Null where nothing reaches the repository's host: the task ends ready
 * on its branch.
 */
export const TaskEnd = Schema.Literals(['draft', 'ready', 'none'])
export type TaskEnd = typeof TaskEnd.Type

/** What a plan holds: its steps, why the lead was chosen, and what happens when the work is done. */
export const PlanParameters = Schema.Struct({
  steps: Schema.Array(PlanStep),
  reason: Schema.NullOr(Schema.String),
  end: Schema.optional(Schema.NullOr(TaskEnd)),
})
export type PlanParameters = typeof PlanParameters.Type

const Finding = Schema.Struct({
  severity: Schema.Literals(['blocking', 'major', 'minor', 'nit']),
  file: Schema.optional(Schema.String),
  line: Schema.optional(Schema.Int),
  claim: Schema.String,
})
type Finding = typeof Finding.Type

const Finished = Schema.Struct({
  summary: Schema.String,
  /** The pull request's description, in the repository's template: by repository, which a task of one needn't name. */
  descriptions: Schema.optional(Schema.Array(Schema.Struct({ repository: Schema.optional(Schema.String), text: Schema.String }))),
  /** What shows the change does what it should; and what couldn't be shown. */
  evidence: Schema.optional(Schema.Array(EvidenceGiven)),
  unverified: Schema.optional(Schema.Array(Schema.String)),
  /** When settling a review: what became of each finding, by its id. */
  findings: Schema.optional(
    Schema.Array(
      Schema.Struct({ id: Schema.String, outcome: Schema.Literals(['fixed', 'set_aside']), reason: Schema.optional(Schema.String) }),
    ),
  ),
})
const Reviewed = Schema.Struct({
  verdict: Schema.Literals(['pass', 'changes_requested']),
  summary: Schema.String,
  findings: Schema.optional(Schema.Array(Finding)),
})

/** Reads a tool's input, or refuses it with what was wrong, for the agent to try again. */
const read = <A>(schema: Schema.Codec<A, unknown>, input: unknown) =>
  Schema.decodeUnknownEffect(schema)(input).pipe(
    Effect.mapError((error) => new ToolRefused({ message: `Althar couldn't read that: ${error.message}` })),
  )

/** What the worktree holds now: whether settling changed anything. */
const digestOf = (worktree: string) => treeOf(worktree).pipe(Effect.orElseSucceed(() => ''))

const findingsText = (findings: ReadonlyArray<Finding & { readonly id: string }>) =>
  findings
    .map((finding) => {
      const where = finding.file === undefined ? '' : ` ${finding.file}${finding.line === undefined ? '' : `:${finding.line}`}`
      return `- ${finding.id} [${finding.severity}]${where}: ${finding.claim}`
    })
    .join('\n')

interface RunRow {
  readonly runId: string
  readonly runAttemptId: string
  readonly executionId: string
  readonly projectId: ProjectId
  readonly taskId: string
  readonly threadId: string
  readonly parameters: string
  /** The plan it runs; null for a round of work after it (ADR-034). */
  readonly planId: string | null
}

/** Where a round of work started (ADR-034): each worktree's head, what it held, and what it hadn't committed, by its path. */
interface RoundStart {
  readonly heads: Readonly<Record<string, string>>
  readonly digest: string
  readonly uncommitted: Readonly<Record<string, ReadonlyArray<string>>>
}

/** Where a task stood before a round of work: what it goes back to where the round makes nothing new. */
interface RoundBack {
  readonly state: 'open' | 'done'
  readonly settledAt: string | null
  /** How the run before it ended. */
  readonly ended: 'succeeded' | 'failed' | 'cancelled'
}

/** What a round's Implement attempt keeps as its input. */
interface RoundInput {
  readonly round: RoundBack
  readonly start: RoundStart
}

/** A round's Implement attempt's input, read; undefined for any other attempt's. */
const roundOf = (input: string | null | undefined): RoundInput | undefined => {
  try {
    const read = JSON.parse(input ?? '') as Partial<RoundInput>
    if (typeof read.round === 'object' && read.round !== null && typeof read.start === 'object' && read.start !== null)
      return read as RoundInput
  } catch {
    // Not a round's: as below.
  }
  return undefined
}

type Store =
  | SqlClient.SqlClient
  | Instance
  | Sessions
  | ToolServer
  | Crypto.Crypto
  | Ledger
  | Live
  | Changes
  | Limits
  | Policies
  | Agents
  | RuntimeConfig
  | Busy
  | Questions
  | Artifacts

/**
 * Why a step needs the person (docs/architecture/05): its agent didn't report
 * after a reminder, went, couldn't start, a restart stopped it, it stalled,
 * went round in circles, ran past its budget, or refused; or review ran out
 * of rounds.
 */
export type StuckWhy =
  | 'no_report'
  | 'session_ended'
  | 'failed_to_start'
  | 'restarted'
  | 'round_limit'
  | 'not_connected'
  | 'usage_limit'
  | 'stalled'
  | 'looping'
  | 'over_budget'
  | 'refused'

/** What a stuck step's call says: the step, why, what went wrong in words, who was on it, the round, and the findings still open. */
export interface StuckInfo {
  readonly step: 'implement' | 'review' | 'settle' | 'publish'
  readonly why: StuckWhy
  readonly detail: string | null
  readonly agentId: string | null
  readonly round: number
  readonly open: number
  /** What Althar did about it before asking, where it did something. */
  readonly tried?: ReadonlyArray<Tried>
  /** For a usage limit: whose account, when it resets where it said, and who could take the step over. */
  readonly limit?: LimitCall
}

/**
 * The person's answer: tell the step's agent what to do, hand the step to an
 * agent (on the account and model they picked, where they did), or abandon
 * it (a review is gone on without). A step a usage limit stopped can wait for
 * the reset, where it is known.
 */
export type StuckAnswer =
  | { readonly kind: 'tell'; readonly note: string }
  | { readonly kind: 'retry'; readonly agentId: string; readonly accountId?: string | undefined; readonly model?: string | undefined }
  | { readonly kind: 'wait' }
  | { readonly kind: 'abandon' }

/** The run was stopped or abandoned as a step was on its way: nothing more starts on it until it is resumed. */
class RunStopped extends Schema.TaggedError<RunStopped>()('RunStopped', { runId: Schema.String }) {}

/** Nothing, where the run was stopped as a step was on its way. */
const unlessStopped = <A, E, R>(effect: Effect.Effect<A, E | RunStopped, R>) =>
  effect.pipe(
    Effect.catchIf(
      (error): error is RunStopped => error instanceof RunStopped,
      () => Effect.succeed(undefined),
    ),
  )

/** Who leads a task's thread: an agent, on a model and effort, or its own where null. */
export interface Lead {
  readonly agentId: string
  readonly model: string | null
  readonly effort: string | null
}

/**
 * How a step waiting for a place among the agents at work on this machine
 * starts once it has one (Busy.ts): a plan's first, on its lead as the plan
 * says; one a restart stopped, carried on as after any restart; one the
 * person resumed, on the lead they gave, or a review on its reviewer; one
 * back from a usage limit, on the agent, account and model it was held for.
 */
export type Place =
  | { readonly how: 'start' }
  | { readonly how: 'restart' }
  | { readonly how: 'resume'; readonly lead: Lead; readonly reviewer?: PlanStep }
  /** The step after the one before it, as a review after the lead's, or the lead settling after a review. */
  | { readonly how: 'next'; readonly reviewer?: PlanStep }
  /** A lead's step that needed the person, carried on as they answered once it has a place. */
  | { readonly how: 'answered'; readonly info: StuckInfo; readonly answer: Exclude<StuckAnswer, { readonly kind: 'wait' }> }
  | { readonly how: 'reset'; readonly agentId: string; readonly accountId: string | null; readonly model: string | null }

/** What a step waiting for a place keeps in its output: how it starts, and since when it waits. */
interface Waiting {
  readonly place: Place
  readonly since: string
}

/** A waiting step's output, read; one Althar can't read carries on as after a restart, from when it is read. */
const waitingOf = (output: string | null, now: string): Waiting => {
  try {
    const read = JSON.parse(output ?? '') as Partial<Waiting>
    if (typeof read.since === 'string' && typeof read.place === 'object' && read.place !== null) return read as Waiting
  } catch {
    // Not the runtime's own JSON: as below.
  }
  return { place: { how: 'restart' }, since: now }
}

/** Whether the task's run waits for a place before its first step: its one attempt, Implement, held for one, to start. */
export const planWaits = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ nodeKey: string; state: string; holdReason: string | null; output: string | null }>`
      SELECT n.node_key, a.state, a.hold_reason, a.output FROM runs r JOIN workflow_executions e ON e.run_id = r.id
      JOIN nodes n ON n.execution_id = e.id JOIN node_attempts a ON a.node_id = n.id
      WHERE r.id = (SELECT id FROM runs WHERE task_id = ${taskId} ORDER BY created_at DESC LIMIT 1) AND r.state = 'running'`
    const [only] = rows
    if (rows.length !== 1 || only === undefined) return false
    if (only.nodeKey !== 'implement' || only.state !== 'held' || only.holdReason !== 'machine_busy') return false
    return waitingOf(only.output, '').place.how === 'start'
  })

export class Runs extends Context.Service<
  Runs,
  {
    /**
     * Runs an accepted plan: its task opens, and its steps run in order. Its
     * first step starts now (`running`), or waits for a place among the
     * agents at work on this machine (`waiting`); null where it runs nothing.
     */
    run(planId: string): Effect.Effect<'running' | 'waiting' | null, unknown>
    /** The workflow version every task's plan runs, for now. */
    readonly workflowVersion: Effect.Effect<string, unknown>
    /**
     * Opens the pull request of a task whose work ended on its branch, a
     * draft, as the person said: pushes the branch and opens it, as the
     * task's own ending would have.
     */
    publish(taskId: string): Effect.Effect<void, unknown>
    /** The person's answer to a step that needs them. */
    answerStuck(input: {
      readonly envelope: CommandEnvelope
      readonly attentionId: string
      readonly answer: StuckAnswer
    }): Effect.Effect<void, unknown>
    /**
     * Carries on the run a task's stop suspended, from the step it was on:
     * with its last lead, or the one given. Nothing happens to a run that
     * isn't suspended.
     */
    resume(input: { readonly envelope: CommandEnvelope; readonly taskId: string; readonly lead?: Lead }): Effect.Effect<void, unknown>
    /** Tells the person's answer to a question whose agent has gone since it asked: to the agent on its thread next, started for it. */
    answered(input: { readonly envelope: CommandEnvelope; readonly threadId: string; readonly body: string }): Effect.Effect<void, unknown>
    /**
     * The person's answer to a question a task's lead or reviewer asked:
     * told to it once it has a place among the agents at work on this
     * machine, and kept until then (Busy.ts); to an agent gone since it
     * asked, as `answered`.
     */
    answer(input: {
      readonly envelope: CommandEnvelope
      readonly attentionId: string
      readonly answers: Readonly<Record<string, FieldAnswer>>
    }): Effect.Effect<void, unknown>
    /**
     * Skips the review of the task's run under way, as the person said
     * (ADR-034): the run no longer has one, a review under way or waiting
     * stops, and a run whose lead is done with its step concludes. The next
     * round of work has its review again, as the plan says.
     */
    skipReview(input: { readonly envelope: CommandEnvelope; readonly taskId: string }): Effect.Effect<void, unknown>
    /** Whether the task's plan waits for a place before its first step, nothing of it started yet: the person can still change it. */
    planWaits(taskId: string): Effect.Effect<boolean, SqlError.SqlError, SqlClient.SqlClient>
    /**
     * Changes the plan of a run whose first step waits for a place, as the
     * person changed it: who leads and reviews, and how it ends. False, and
     * nothing changed, where it no longer waits. Inside the caller's
     * transaction.
     */
    changeWaiting(
      taskId: string,
      parameters: string,
      actorId: ActorId,
    ): Effect.Effect<boolean, unknown, SqlClient.SqlClient | Ledger | Crypto.Crypto>
  }
>()('@althar/runtime/Runs') {
  static readonly layer: Layer.Layer<Runs, never, Store> = Layer.effect(
    Runs,
    Effect.gen(function* () {
      const context = yield* Effect.context<Store>()
      const instance = yield* Instance
      const sessions = yield* Sessions
      const questions = yield* Questions
      const toolServer = yield* ToolServer
      const live = yield* Live
      const changes = yield* Changes
      const limits = yield* Limits
      const policies = yield* Policies
      const busy = yield* Busy
      const scope = yield* Effect.scope
      // Asked when a step is held for a reset, so the wait for it starts again.
      const holdsChanged = yield* Queue.sliding<void>(1)
      const provide = <A, E>(effect: Effect.Effect<A, E, Store>) => Effect.provideContext(effect, context)
      // Starts a thread's budget again, as a step that starts does: the stall watch's, once it is running below.
      let freshen: (threadId: string) => Effect.Effect<void> = () => Effect.void

      /** The workflow every task runs, for now: made once per profile. */
      const workflowVersion = Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const [known] = yield* sql<{ id: string }>`
          SELECT v.id FROM workflow_versions v JOIN workflow_definitions d ON d.id = v.definition_id WHERE d.name = 'task' AND v.version = 1`
        if (known !== undefined) return known.id
        const definition = JSON.stringify({ steps: ['implement', 'review'], review: { rounds: ROUNDS, settledBy: 'lead' } })
        const definitionId = yield* newId(Ids.workflowDefinition)
        const versionId = yield* newId(Ids.workflowVersion)
        const at = yield* timestamp
        yield* sql`INSERT INTO workflow_definitions ${sql.insert({ id: definitionId, name: 'task', createdAt: at })}`
        yield* sql`INSERT INTO workflow_versions ${sql.insert({
          id: versionId,
          definitionId,
          version: 1,
          contentHash: createHash('sha256').update(definition).digest('hex'),
          definition,
          createdAt: at,
        })}`
        return versionId
      })

      /** The project's rules, as the run records them: the revision it starts under. */
      const policyOf = (projectId: ProjectId) => Effect.map(policies.current(projectId), (policy) => policy.id)

      /** What a usage limit does to a run's steps: as the rules it ran under say. */
      const usageLimitOfRun = (run: RunRow) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [cited] = yield* sql<{ policyId: string }>`SELECT policy_id FROM runs WHERE id = ${run.runId}`
          return usageLimitOf(
            cited === undefined ? (yield* policies.current(run.projectId)).rules : yield* policies.rulesOf(cited.policyId),
          )
        })

      /** The run a task is on now. */
      const currentRun = (taskId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [row] = yield* sql<RunRow>`
            SELECT r.id AS run_id, a.id AS run_attempt_id, e.id AS execution_id, r.project_id, r.task_id, t.id AS thread_id, r.parameters,
              r.plan_id
            FROM runs r
            JOIN run_attempts a ON a.run_id = r.id AND a.state = 'active'
            JOIN workflow_executions e ON e.run_id = r.id
            JOIN threads t ON t.task_id = r.task_id AND t.kind = 'task'
            WHERE r.task_id = ${taskId} AND r.state = 'running'
            ORDER BY r.created_at DESC LIMIT 1`
          return row
        })

      const stepsOf = (run: RunRow) =>
        Effect.map(Schema.decodeUnknownEffect(Schema.fromJsonString(PlanParameters))(run.parameters), (parameters) => ({
          implement: parameters.steps.find((step) => step.key === 'implement'),
          review: parameters.steps.find((step) => step.key === 'review' && !step.skipped),
          end: parameters.end ?? null,
        }))

      /**
       * Whether the run is still the one this was read from: running, on the
       * same run attempt. A stop suspends it and interrupts that attempt, and
       * resuming makes another, so whatever read it before either can't write
       * to it any more. Inside the caller's transaction.
       */
      const going = (run: RunRow) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [row] = yield* sql<{ n: number }>`
            SELECT count(*) AS n FROM runs r JOIN run_attempts a ON a.run_id = r.id
            WHERE r.id = ${run.runId} AND r.state = 'running' AND a.id = ${run.runAttemptId} AND a.state = 'active'`
          return (row?.n ?? 0) > 0
        })

      /**
       * Whether a step's report can still be kept: its run is going, on the
       * attempt it was read from, and the step's attempt still waits for it.
       * One that can't is kept out of the run and said in the record, as
       * from an agent that worked on while the task was stopped and resumed.
       * Inside the caller's transaction.
       */
      const keeps = (run: RunRow, attemptId: string, report: unknown) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [attempt] = yield* sql<{
            state: string
            output: string | null
          }>`SELECT state, output FROM node_attempts WHERE id = ${attemptId}`
          if ((yield* going(run)) && ['admitted', 'running', 'waiting_attention'].includes(attempt?.state ?? '')) return true
          const revision = yield* change('node_attempts', attemptId, { output: attempt?.output ?? null })
          yield* fact({
            projectId: run.projectId,
            aggregateType: 'node_attempt',
            aggregateId: attemptId,
            revision,
            type: 'node_attempt.report_dropped',
            payload: report,
            actorId: instance.systemId,
          })
          return false
        })

      /** What a step whose report was dropped is told. */
      const dropped = new ToolRefused({ message: 'That step was stopped, so Althar keeps nothing of this report.' })

      /** Adds a node for a step, for a round of the review loop, and admits an attempt at it. */
      const admit = (
        run: RunRow,
        key: 'implement' | 'review' | 'settle' | 'publish',
        iteration: number,
        config: unknown,
        input: unknown = {},
      ) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          // Nothing new starts on a run its task's stop suspended, or for whatever read it before it was resumed.
          if (!(yield* going(run))) return yield* new RunStopped({ runId: run.runId })
          const at = yield* timestamp
          const [existing] = yield* sql<{ id: string }>`
            SELECT id FROM nodes WHERE execution_id = ${run.executionId} AND node_key = ${key} AND iteration = ${iteration}`
          const nodeId = existing?.id ?? (yield* newId(Ids.node))
          if (existing === undefined)
            yield* sql`INSERT INTO nodes ${sql.insert({
              id: nodeId,
              projectId: run.projectId,
              executionId: run.executionId,
              nodeKey: key,
              iteration,
              // What Althar does itself, outside, is an integration node; the rest is an agent's.
              type: key === 'publish' ? 'integration' : 'agent',
              addedInRevision: 1,
              config: JSON.stringify(config),
              state: 'running',
              createdAt: at,
            })}`
          else yield* change('nodes', nodeId, { state: 'running' })
          const [previous] = yield* sql<{ n: number }>`SELECT count(*) AS n FROM node_attempts WHERE node_id = ${nodeId}`
          const attemptId = yield* newId(Ids.nodeAttempt)
          yield* sql`INSERT INTO node_attempts ${sql.insert({
            id: attemptId,
            projectId: run.projectId,
            nodeId,
            attemptNumber: (previous?.n ?? 0) + 1,
            runAttemptId: run.runAttemptId,
            controllerGeneration: 1,
            state: 'admitted',
            input: JSON.stringify(input),
            admittedAt: at,
          })}`
          yield* fact({
            projectId: run.projectId,
            aggregateType: 'node_attempt',
            aggregateId: attemptId,
            revision: 1,
            type: 'node_attempt.admitted',
            payload: { node: key, iteration },
            actorId: instance.systemId,
          })
          return { nodeId, attemptId }
        })

      /**
       * An attempt waits for a place among the agents at work on this machine,
       * held until one frees (Busy.ts), with how it starts then and since when
       * it waits: now, or, for one a restart stopped, since it was admitted, so
       * it goes before what waited behind it. Inside the caller's transaction.
       */
      const waitForPlace = (run: Pick<RunRow, 'projectId'>, attemptId: string, place: Place, since?: string) =>
        Effect.gen(function* () {
          const revision = yield* change('node_attempts', attemptId, {
            state: 'held',
            holdReason: 'machine_busy',
            output: JSON.stringify({ place, since: since ?? (yield* timestamp) } satisfies Waiting),
          })
          yield* fact({
            projectId: run.projectId,
            aggregateType: 'node_attempt',
            aggregateId: attemptId,
            revision,
            type: 'node_attempt.held',
            payload: { reason: 'machine_busy', how: place.how },
            actorId: instance.systemId,
          })
        })

      /**
       * An attempt now runs in a session, unless it can't any more: its run
       * was stopped or abandoned while its agent started (`stopped`: the
       * caller stops that agent), or it ended meanwhile, as one whose agent
       * reported in its first turn (`past`: it stays as it ended). `fresh`
       * clears what it had said, for one reminded afresh.
       */
      const started = (run: RunRow, attemptId: string, sessionId: string, fresh = false) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [now] = yield* sql<{ attempt: string }>`SELECT state AS attempt FROM node_attempts WHERE id = ${attemptId}`
          if (now === undefined || now.attempt === 'cancelled' || !(yield* going(run))) return 'stopped' as const
          if (!['admitted', 'running', 'waiting_attention', 'held'].includes(now.attempt)) return 'past' as const
          const revision = yield* change('node_attempts', attemptId, {
            state: 'running',
            holdReason: null,
            providerSessionId: sessionId,
            startedAt: yield* timestamp,
            // One that waited, for a place or a reset, starts with nothing said yet.
            ...(fresh || now.attempt === 'held' ? { output: null } : {}),
          })
          yield* fact({
            projectId: run.projectId,
            aggregateType: 'node_attempt',
            aggregateId: attemptId,
            revision,
            type: 'node_attempt.running',
            actorId: instance.systemId,
          })
          const [session] = yield* sql<{ threadId: string }>`SELECT thread_id FROM provider_sessions WHERE id = ${sessionId}`
          if (session !== undefined) yield* freshen(session.threadId)
          return 'running' as const
        })

      /** Marks an attempt running in a session, and stops that agent where the run was stopped meanwhile. Whether it runs. */
      const begin = (run: RunRow, attemptId: string, sessionId: string, threadId: string, fresh = false) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const now = yield* sql.withTransaction(started(run, attemptId, sessionId, fresh))
          if (now === 'stopped') yield* Effect.ignore(sessions.stop(threadId))
          return now !== 'stopped'
        })

      /** Ends an attempt and its node, with what it reported. */
      const ended = (
        run: RunRow,
        attempt: { readonly id: string; readonly nodeId: string },
        state: 'succeeded' | 'failed',
        output: unknown,
      ) =>
        Effect.gen(function* () {
          const at = yield* timestamp
          const revision = yield* change('node_attempts', attempt.id, { state, output: JSON.stringify(output), endedAt: at })
          yield* change('nodes', attempt.nodeId, { state })
          yield* fact({
            projectId: run.projectId,
            aggregateType: 'node_attempt',
            aggregateId: attempt.id,
            revision,
            type: `node_attempt.${state}`,
            payload: output,
            actorId: instance.systemId,
          })
        })

      /** The attempt running now, at one of these steps. */
      const running = (run: RunRow, keys: ReadonlyArray<string>) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [attempt] = yield* sql<{ id: string; nodeId: string; nodeKey: string; iteration: number; input: string }>`
            SELECT a.id, a.node_id, n.node_key, n.iteration, a.input FROM node_attempts a JOIN nodes n ON n.id = a.node_id
            WHERE n.execution_id = ${run.executionId} AND a.state IN ('admitted', 'running', 'waiting_attention')
              AND n.node_key IN ${sql.in(keys)}
            ORDER BY a.admitted_at DESC LIMIT 1`
          return attempt
        })

      /** A step's result, in the task's thread: what the person reads instead of the work. */
      const result = (run: Pick<RunRow, 'projectId' | 'threadId'>, content: Readonly<Record<string, unknown>>, id?: string) =>
        addItem({ projectId: run.projectId, threadId: run.threadId }, 'step_result', content, id === undefined ? {} : { id })

      /** The run is over: the task is ready for the person, or stopped. */
      const finish = (run: RunRow, state: 'succeeded' | 'failed' | 'cancelled') =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          yield* sql.withTransaction(ends(run, state))
          yield* touchCard(run.taskId)
        })

      /** The run ends, inside the caller's transaction: unless its task's stop suspended it meanwhile, when it waits to be resumed. */
      const ends = (run: RunRow, state: 'succeeded' | 'failed' | 'cancelled') =>
        Effect.gen(function* () {
          if (!(yield* going(run))) return
          const at = yield* timestamp
          yield* change('run_attempts', run.runAttemptId, { state, endedAt: at })
          yield* change('workflow_executions', run.executionId, { state, endedAt: at })
          const revision = yield* change('runs', run.runId, { state, endedAt: at })
          yield* fact({
            projectId: run.projectId,
            aggregateType: 'run',
            aggregateId: run.runId,
            revision,
            type: `run.${state}`,
            actorId: instance.systemId,
          })
        })

      /** What a step that Althar does itself reported, in a line. */
      /** What publishing did, in words: in each repository, by name where there are several. */
      const publishedSummary = (published: Published, end: TaskEnd) =>
        published
          .map((one) => {
            const did = ((): string => {
              switch (one.kind) {
                case 'opened': {
                  const noun = one.change.words.noun
                  const name = `${noun} ${one.change.words.prefix}${one.change.number}`
                  return end === 'ready' || !one.change.draft ? `Opened ${name} for review.` : `Opened draft ${name}.`
                }
                case 'pushed':
                  return `Pushed ${one.branch}.`
                case 'nothing':
                  return 'The branch has no commits to propose, so nothing was pushed.'
                case 'branch':
                  return "It isn't on a code host Althar knows, so it ends on its branch."
              }
            })()
            const said = one.left.length === 0 ? did : `${did} Left out what the lead didn't commit: ${filesLine(one.left)}.`
            return published.length > 1 ? `${one.repository}: ${said}` : said
          })
          .join('\n')

      /** The pull request publishing opened, for the thread to show: the first, where it opened several. */
      const openedOf = (published: Published) => {
        const opened = published.find((one) => one.kind === 'opened')
        return opened?.kind === 'opened' ? { change: opened.change } : {}
      }

      /** A task that ends on its branch says why, and how its pull request can still open. */
      const onBranch = (run: RunRow) =>
        Effect.gen(function* () {
          const host = yield* changes.hostFor(run.projectId)
          yield* addItem({ projectId: run.projectId, threadId: run.threadId }, 'notice', {
            source: 'runtime',
            severity: 'info',
            ...(host === null
              ? {
                  title: 'The task ends on its branch.',
                  description: "Its repository isn't on a code host Althar knows, so nothing was pushed.",
                }
              : {
                  title: `The task ends on its branch: ${host.name} isn't connected.`,
                  description: `Nothing was pushed. Connect ${host.name} from the project, then open the pull request from here.`,
                }),
          })
        })

      /**
       * One action on the task's pull request: two quick clicks open one, and
       * the second hears it has one. A task whose last pull request merged or
       * closed opens its next, for the commits after it (ADR-034); a merged
       * task with such commits is open again for it.
       */
      const publish = (taskId: string) =>
        changes.exclusive(
          taskId,
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient
            const [task] = yield* sql<{ state: string; projectId: ProjectId }>`SELECT state, project_id FROM tasks WHERE id = ${taskId}`
            if (task === undefined) return yield* new NotFound({ kind: 'task', id: taskId })
            // An abandoned task's branch stays as it is; so does a merged one's, but for commits after its pull requests.
            if (task.state === 'abandoned') return yield* new NoChangeToOpen({ taskId, why: 'settled' })
            const opened = yield* changes.ofTask(taskId)
            const open = opened.some((change) => change.state === 'open')
            const after = opened.length > 0 && !open ? yield* changes.unshipped(taskId) : []
            if (task.state === 'done' && after.length === 0) return yield* new NoChangeToOpen({ taskId, why: 'settled' })
            const [last] = yield* sql<{ runId: string; projectId: ProjectId; threadId: string; state: string }>`
            SELECT r.id AS run_id, r.project_id, t.id AS thread_id, r.state FROM runs r
            JOIN threads t ON t.task_id = r.task_id AND t.kind = 'task'
            WHERE r.task_id = ${taskId} ORDER BY r.created_at DESC, r.rowid DESC LIMIT 1`
            if (last === undefined || !['succeeded', 'failed', 'cancelled'].includes(last.state))
              return yield* new NoChangeToOpen({ taskId, why: 'working' })
            if (last.state !== 'succeeded') return yield* new NoChangeToOpen({ taskId, why: 'stopped' })
            if (open) return yield* new NoChangeToOpen({ taskId, why: 'opened' })
            if (opened.length > 0 && after.length === 0) return yield* new NoChangeToOpen({ taskId, why: 'nothing' })
            const published = yield* changes.publish({
              projectId: last.projectId,
              taskId,
              runId: last.runId,
              end: 'draft',
              ...(opened.length > 0 ? { again: true } : {}),
            })
            // Its new work going out, a merged task is open again, until that merges too.
            if (task.state === 'done')
              yield* sql.withTransaction(
                Effect.gen(function* () {
                  const [now] = yield* sql<{ state: string }>`SELECT state FROM tasks WHERE id = ${taskId}`
                  if (now?.state !== 'done') return
                  const revision = yield* change('tasks', taskId, {
                    state: yield* transition(taskLifecycle, 'done', 'open'),
                    settledAt: null,
                  })
                  yield* fact({
                    projectId: task.projectId,
                    aggregateType: 'task',
                    aggregateId: taskId,
                    revision,
                    type: 'task.reopened',
                    payload: { published: true },
                    actorId: instance.personId,
                  })
                }),
              )
            yield* result(
              { projectId: last.projectId, threadId: last.threadId },
              {
                step: 'publish',
                round: 0,
                summary: publishedSummary(published, 'draft'),
                ...openedOf(published),
              },
            )
            yield* touchCard(taskId)
          }),
        )

      /**
       * The work is done: the task's ending, if its plan has one, then the
       * run is over and the task ready. Pushing and opening its pull request
       * is Althar's own step; if it can't, the person decides.
       */
      const conclude = (run: RunRow) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          // A round of work never publishes by itself (ADR-034): what it committed goes to the task's open pull request from its
          // card, or in a new one the person opens there once the last merged or closed.
          if (run.planId === null) {
            const after = yield* changes.unshipped(run.taskId).pipe(Effect.orElseSucceed(() => []))
            const [first] = after
            if (first !== undefined)
              yield* addItem({ projectId: run.projectId, threadId: run.threadId }, 'notice', {
                source: 'runtime',
                severity: 'info',
                title: `${after.map((one) => `${one.change.words.short} ${one.change.words.prefix}${one.change.number}`).join(' and ')} ${
                  after.length > 1 ? 'are' : first.change.state === 'merged' ? 'is merged' : 'was closed'
                }${after.length > 1 ? ' merged or closed' : ''}, so what the follow-up committed isn't in a pull request yet.`,
                description: 'Open a new pull request for it from the task.',
              })
            yield* finish(run, 'succeeded')
            return yield* Effect.ignore(changes.settleIfMerged(run.taskId))
          }
          // A plan made while the repository's host wasn't connected opens its pull request if it is by now.
          // The plan's ending, else the project's, as when a plan is made: one made while the host wasn't connected opens its pull request if it is by now.
          const end = (yield* stepsOf(run)).end ?? (yield* changes.endFor(run.projectId, run.taskId))
          if (end === null) {
            yield* onBranch(run)
            return yield* finish(run, 'succeeded')
          }
          // Admitted and under way in one transaction, which a stop can't come between: once it is running, publishing has begun.
          const admitted = yield* unlessStopped(
            sql.withTransaction(
              Effect.gen(function* () {
                const admission = yield* admit(run, 'publish', 0, { end })
                const revision = yield* change('node_attempts', admission.attemptId, { state: 'running', startedAt: yield* timestamp })
                yield* fact({
                  projectId: run.projectId,
                  aggregateType: 'node_attempt',
                  aggregateId: admission.attemptId,
                  revision,
                  type: 'node_attempt.running',
                  actorId: instance.systemId,
                })
                return admission
              }),
            ),
          )
          if (admitted === undefined) return
          const { nodeId, attemptId } = admitted
          yield* touchCard(run.taskId)
          const published = yield* Effect.exit(changes.publish({ projectId: run.projectId, taskId: run.taskId, runId: run.runId, end }))
          if (published._tag === 'Failure') {
            const error = Cause.findErrorOption(published.cause)
            const notConnected = Option.isSome(error) && error.value instanceof NotConnected
            return yield* stuck(
              run,
              { id: attemptId },
              {
                step: 'publish',
                why: notConnected ? 'not_connected' : 'failed_to_start',
                detail: summarize(published.cause) || null,
                agentId: null,
                round: 0,
                open: 0,
              },
            )
          }
          yield* sql.withTransaction(
            Effect.gen(function* () {
              const said = { step: 'publish', round: 0, summary: publishedSummary(published.value, end), ...openedOf(published.value) }
              // Stopped or abandoned while it published, what it did on the host is said, and the run waits: publishing again, as resuming
              // does, adopts what is there.
              const [still] = yield* sql<{ state: string }>`SELECT state FROM node_attempts WHERE id = ${attemptId}`
              if (still?.state !== 'running' || !(yield* going(run))) return yield* result(run, said)
              yield* ended(run, { id: attemptId, nodeId }, 'succeeded', published.value)
              yield* unstuck(run)
              yield* result(run, said)
              yield* ends(run, 'succeeded')
            }),
          )
          yield* touchCard(run.taskId)
        })

      /**
       * A step needs the person (docs/architecture/05): its attempt waits on
       * them, and a call in the task says why. A run has one such call open at
       * a time.
       */
      const stuck = (run: RunRow, attempt: { readonly id: string } | null, info: StuckInfo) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const opened = yield* sql.withTransaction(
            Effect.gen(function* () {
              const [open] = yield* sql<{ id: string }>`
                SELECT id FROM attention_requests WHERE task_id = ${run.taskId} AND kind = 'stuck' AND state = 'open'`
              if (open !== undefined) return false
              // A run its task's stop suspended, or a step it cut short, asks nothing of the person: they stopped it.
              const [now] = yield* sql<{ attempt: string | null }>`
                SELECT (SELECT state FROM node_attempts WHERE id = ${attempt?.id ?? ''}) AS attempt`
              if (!(yield* going(run)) || now?.attempt === 'cancelled') return false
              if (attempt !== null) {
                // One held for a limit, whose handover didn't go through, waits on the person instead.
                const revision = yield* change('node_attempts', attempt.id, { state: 'waiting_attention', holdReason: null })
                yield* fact({
                  projectId: run.projectId,
                  aggregateType: 'node_attempt',
                  aggregateId: attempt.id,
                  revision,
                  type: 'node_attempt.waiting_attention',
                  payload: info,
                  actorId: instance.systemId,
                })
              }
              const id = yield* newId(Ids.attentionRequest)
              yield* sql`INSERT INTO attention_requests ${sql.insert({
                id,
                projectId: run.projectId,
                taskId: run.taskId,
                nodeAttemptId: attempt?.id ?? null,
                kind: 'stuck',
                addresseeActorId: instance.personId,
                payload: JSON.stringify(info),
                state: 'open',
                createdAt: yield* timestamp,
              })}`
              yield* fact({
                projectId: run.projectId,
                aggregateType: 'attention_request',
                aggregateId: id,
                revision: 1,
                type: 'attention_request.opened',
                payload: info,
                actorId: instance.systemId,
              })
              return true
            }),
          )
          if (opened) yield* touchCard(run.taskId)
        })

      /** The model a step's agent last ran on, on the step's own thread: the one it carries on with at a reset. */
      const modelOnStep = (taskId: string, step: StuckInfo['step'], agentId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [last] = yield* sql<{ model: string | null }>`
            SELECT s.model FROM provider_sessions s JOIN threads t ON t.id = s.thread_id
            WHERE t.task_id = ${taskId} AND t.kind = ${step === 'review' ? 'step' : 'task'} AND s.agent_id = ${agentId}
            ORDER BY s.started_at DESC, s.rowid DESC LIMIT 1`
          return last?.model ?? null
        })

      /** A step that reported after all no longer needs the person: its call is withdrawn. */
      const unstuck = (run: RunRow) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const open = yield* sql<{ id: string }>`
            SELECT id FROM attention_requests WHERE task_id = ${run.taskId} AND kind = 'stuck' AND state = 'open'`
          for (const call of open) {
            const revision = yield* change('attention_requests', call.id, { state: 'withdrawn' })
            yield* fact({
              projectId: run.projectId,
              aggregateType: 'attention_request',
              aggregateId: call.id,
              revision,
              type: 'attention_request.withdrawn',
              actorId: instance.systemId,
            })
          }
        })

      /** Whether an agent on the thread asked the person a question they haven't answered, or whose answer waits for a place to be told. */
      const asking = (threadId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [open] = yield* sql<{ id: string }>`
            SELECT id FROM attention_requests
            WHERE kind = 'question' AND json_extract(payload, '$.threadId') = ${threadId}
              AND (state = 'open' OR (state = 'answered' AND json_extract(payload, '$.waitsForPlace') IS NOT NULL)) LIMIT 1`
          return open !== undefined
        })

      /** The answers kept on the task's threads while there was no place to tell them, oldest first. */
      const keptAnswers = (taskId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          return yield* sql<{ id: string }>`
            SELECT id FROM attention_requests WHERE task_id = ${taskId} AND kind = 'question' AND state = 'answered'
              AND json_extract(payload, '$.waitsForPlace') IS NOT NULL ORDER BY answered_at`
        })

      /** Review findings of the run the lead hasn't settled. */
      const openFindings = (run: RunRow) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          return yield* sql<{ id: string; severity: Finding['severity']; location: string; claim: string }>`
            SELECT f.id, f.severity, f.location, f.claim FROM findings f JOIN node_attempts a ON a.id = f.review_attempt_id
            JOIN nodes n ON n.id = a.node_id WHERE n.execution_id = ${run.executionId} AND f.state = 'open' ORDER BY f.created_at`
        })

      /** The run's open findings, as the lead is told to settle them. */
      const openToSettle = (run: RunRow) =>
        Effect.map(openFindings(run), (open) =>
          open.map((finding) => {
            const location = JSON.parse(finding.location) as { file?: string | null; line?: number | null }
            return {
              id: finding.id,
              severity: finding.severity,
              claim: finding.claim,
              ...(location.file == null ? {} : { file: location.file }),
              ...(location.line == null ? {} : { line: location.line }),
            }
          }),
        )

      /** The step waiting on a thread's agent: the lead's (Implement, settling) on the task's thread, or the review on its own. */
      const stepOn = (threadId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [row] = yield* sql<{
            taskId: string
            nodeKey: string
            nodeId: string
            attemptId: string
            output: string | null
            input: string
            iteration: number
          }>`
            SELECT r.task_id, n.node_key, n.id AS node_id, a.id AS attempt_id, a.output, a.input, n.iteration
            FROM threads t
            JOIN runs r ON r.task_id = t.task_id AND r.state = 'running'
            JOIN workflow_executions e ON e.run_id = r.id
            JOIN nodes n ON n.execution_id = e.id
            JOIN node_attempts a ON a.node_id = n.id AND a.state = 'running'
            WHERE t.id = ${threadId}
              AND ((t.kind = 'task' AND n.node_key IN ('implement', 'settle')) OR (t.kind = 'step' AND n.node_key = 'review'))
            ORDER BY a.admitted_at DESC LIMIT 1`
          if (row === undefined) return undefined
          const run = yield* currentRun(row.taskId)
          return run === undefined ? undefined : { ...row, run, step: stepOf(row.nodeKey) }
        })

      const stepOf = (key: string): StuckInfo['step'] =>
        key === 'review' ? 'review' : key === 'settle' ? 'settle' : key === 'publish' ? 'publish' : 'implement'

      /** Told once when its turn ends without the report its step needs. */
      const reminders = {
        lead: "Your step isn't done until you call Althar's finish_step tool. If you have done it, call finish_step now with your summary. If you can't go on without the person, call it saying what you need from them.",
        round:
          "Your step isn't done until you call Althar's finish_step tool: you changed the task's work since the person last wrote to you. If you have done what they asked, call finish_step now with your summary and your evidence. If you can't go on without the person, call it saying what you need from them.",
        reviewer:
          "Your review isn't done until you call Althar's report_review tool. Call it now with your verdict, a summary and your findings.",
      }

      /**
       * When a step's agent ends a turn without reporting, it is reminded once,
       * and then the step needs the person. When it goes (and no other agent
       * took the thread over), the step needs the person at once. A turn the
       * person interrupted is theirs to carry on.
       */
      const watch = (event: LiveEvent) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          if (event._tag !== 'TurnEnded' && event._tag !== 'SessionEnded') return
          const on = yield* stepOn(event.threadId)
          // A turn the person interrupted is theirs to carry on; a round of work it left with nothing new goes back where it was.
          if (event._tag === 'TurnEnded' && event.state === 'interrupted') {
            if (on !== undefined) yield* quietly(on.run, { id: on.attemptId, nodeId: on.nodeId, nodeKey: on.nodeKey, input: on.input })
            return
          }
          if (event._tag === 'TurnEnded' && event.errorClass === 'usage_limit') {
            // Only the live session's turn speaks for the thread; one another agent took over from is history.
            const [turn] = yield* sql<{ sessionId: string | null; agentId: string; accountId: string | null }>`
              SELECT t.provider_session_id AS session_id, s.agent_id, s.account_id FROM turn_deliveries t
              JOIN provider_sessions s ON s.id = t.provider_session_id WHERE t.id = ${event.turnId}`
            const live = yield* sessions.running(event.threadId)
            if (turn === undefined || Option.isNone(live) || live.value.sessionId !== turn.sessionId) return
            return yield* on === undefined
              ? outOfUsageElsewhere(event.threadId, turn.agentId, turn.accountId)
              : outOfUsage(on, turn.agentId, turn.accountId)
          }
          if (on === undefined) return
          const [agent] = yield* sql<{ agentId: string }>`
            SELECT agent_id FROM provider_sessions WHERE thread_id = ${event.threadId} ORDER BY started_at DESC LIMIT 1`
          const info = (why: StuckWhy, detail: string | null): StuckInfo => ({
            step: on.step,
            why,
            detail,
            agentId: agent?.agentId ?? null,
            round: on.iteration,
            open: 0,
          })
          if (event._tag === 'SessionEnded') {
            // Another agent took the thread over: the step carries on there.
            if (event.state === 'superseded' || Option.isSome(yield* sessions.running(event.threadId))) return
            // It went while it asked the person something: their answer starts it again, so the question is the call.
            if (yield* asking(event.threadId)) return
            // A round that made nothing new ends with its lead (ADR-034).
            if (yield* quietly(on.run, { id: on.attemptId, nodeId: on.nodeId, nodeKey: on.nodeKey, input: on.input })) return
            return yield* stuck(on.run, { id: on.attemptId }, info('session_ended', null))
          }
          // A turn of a session another agent has taken over from is that session's last, not the step's.
          const [turn] = yield* sql<{ sessionId: string | null }>`
            SELECT provider_session_id AS session_id FROM turn_deliveries WHERE id = ${event.turnId}`
          const live = yield* sessions.running(event.threadId)
          if (Option.isSome(live) && turn?.sessionId != null && live.value.sessionId !== turn.sessionId) return
          // More input waits on the thread, so another turn comes, which may yet report.
          const [queued] = yield* sql<{ id: string }>`
            SELECT id FROM user_inputs WHERE thread_id = ${event.threadId} AND state = 'queued' LIMIT 1`
          if (queued !== undefined) return
          // A round whose lead made nothing new, as for a question answered, ends there: the task is back where it was (ADR-034).
          if (yield* quietly(on.run, { id: on.attemptId, nodeId: on.nodeId, nodeKey: on.nodeKey, input: on.input })) return
          const output = JSON.parse(on.output ?? '{}') as { reminded?: boolean; continued?: number }
          // Refused, it won't go on however it's reminded.
          if (event.stopReason === 'refusal') return yield* stuck(on.run, { id: on.attemptId }, info('refused', null))
          // Cut off by the agent's own limit on a turn, it carries on where it was, a few times, before it is reminded.
          const continued = output.continued ?? 0
          if (
            (event.stopReason === 'max_tokens' || event.stopReason === 'max_turn_requests') &&
            event.errorClass === undefined &&
            continued < CONTINUES
          ) {
            yield* change('node_attempts', on.attemptId, { output: JSON.stringify({ ...output, continued: continued + 1 }) })
            return yield* sessions
              .send({
                envelope: yield* envelope('thread.send', { threadId: event.threadId, continued: on.attemptId }),
                threadId: event.threadId,
                body: CONTINUING,
                quiet: true,
              })
              .pipe(
                Effect.asVoid,
                Effect.catchCause((cause) => stuck(on.run, { id: on.attemptId }, info('no_report', summarize(cause) || null))),
              )
          }
          if (output.reminded === true) return yield* stuck(on.run, { id: on.attemptId }, info('no_report', event.errorClass ?? null))
          yield* change('node_attempts', on.attemptId, { output: JSON.stringify({ ...output, reminded: true }) })
          yield* sessions
            .send({
              envelope: yield* envelope('thread.send', { threadId: event.threadId, reminder: on.attemptId }),
              threadId: event.threadId,
              body:
                on.step === 'review'
                  ? reminders.reviewer
                  : on.run.planId === null && on.step === 'implement'
                    ? reminders.round
                    : reminders.lead,
              quiet: true,
            })
            .pipe(Effect.catchCause((cause) => stuck(on.run, { id: on.attemptId }, info('no_report', summarize(cause) || null))))
        })

      /**
       * Starts, or carries on, a round of review, on the plan's reviewer or
       * another the person picked. The reviewer's thread spans the rounds. A
       * reviewer that can't start leaves the step needing the person. The
       * round asks for a place among the agents at work on this machine first,
       * and without one waits for it: after the lead's step, the lead's place is
       * the reviewer's, unless what the lead left running still runs; resumed by
       * the person (`resumed`, their lead), it asks as any other.
       */
      const review = (
        run: RunRow,
        round: number,
        settled?: string,
        reviewer?: string,
        model?: string | null,
        accountId?: string,
        resumed?: Lead,
      ) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const { review: planned } = yield* stepsOf(run)
          if (planned === undefined) return yield* conclude(run)
          // The plan's reviewer, unless it is out of usage and the project moves on.
          const instead = reviewer === undefined ? yield* insteadOf(run, planned) : undefined
          const step =
            instead !== undefined
              ? { ...planned, agentId: instead.agentId, model: instead.model }
              : reviewer === undefined || reviewer === planned.agentId
                ? model == null
                  ? planned
                  : { ...planned, model }
                : { ...planned, agentId: reviewer, model: model ?? null }
          const admitted = yield* unlessStopped(
            busy.enter(
              run.taskId,
              (room) =>
                sql.withTransaction(
                  Effect.gen(function* () {
                    const admission = yield* admit(run, 'review', round, step)
                    if (!room)
                      yield* waitForPlace(
                        run,
                        admission.attemptId,
                        resumed === undefined ? { how: 'next', reviewer: step } : { how: 'resume', lead: resumed, reviewer: step },
                      )
                    return { ...admission, room }
                  }),
                ),
              { review: true, ...(resumed === undefined ? { after: 'lead' as const } : {}) },
            ),
          )
          if (admitted === undefined) return undefined
          const { nodeId, attemptId } = admitted
          if (!admitted.room) yield* touchCard(run.taskId)
          else yield* reviewOn(run, round, settled, step, attemptId, accountId)
          return { nodeId, attemptId }
        })

      /** A round of review admitted, under way on its reviewer; one that can't start needs the person. */
      const reviewOn = (run: RunRow, round: number, settled: string | undefined, step: PlanStep, attemptId: string, accountId?: string) =>
        Effect.gen(function* () {
          const begun = yield* Effect.exit(reviewRound(run, round, settled, step, attemptId, accountId))
          if (begun._tag === 'Failure')
            yield* stuck(
              run,
              { id: attemptId },
              {
                step: 'review',
                why: 'failed_to_start',
                detail: summarize(begun.cause) || null,
                agentId: step.agentId,
                round,
                open: 0,
              },
            )
        })

      /** What the lead settled last, for a round of review after the first to read. */
      const settledBefore = (run: RunRow) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [last] = yield* sql<{ summary: string }>`
            SELECT json_extract(content, '$.summary') AS summary FROM thread_items
            WHERE thread_id = ${run.threadId} AND kind = 'step_result' AND json_extract(content, '$.step') = 'settle'
            ORDER BY sequence DESC LIMIT 1`
          return last?.summary
        })

      /** What a reviewer is told of a round of work after the plan: what the lead did, and how to see what changed since it started. */
      const moreToReview = (run: RunRow, start: RoundStart) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [lead] = yield* sql<{ summary: string | null }>`
            SELECT json_extract(content, '$.summary') AS summary FROM thread_items WHERE thread_id = ${run.threadId} AND kind = 'step_result'
              AND json_extract(content, '$.step') = 'implement' ORDER BY sequence DESC LIMIT 1`
          const worktrees = yield* worktreesOf(run.taskId)
          const from = worktrees.flatMap((worktree) => {
            const head = start.heads[worktree.path]
            return head === undefined || head === '' ? [] : [{ name: worktree.name, head: head.slice(0, 12) }]
          })
          const how =
            from.length === 1
              ? `with \`git diff ${from[0]?.head ?? ''}\` in your copy`
              : from.map((one) => `\n- ${one.name}: \`git diff ${one.head}\``).join('')
          return `More to review. The task's earlier work was reviewed before; since then the person asked the lead for more, and it did it:\n\n${lead?.summary ?? ''}\n\nReview what changed since, ${how}. Look at the earlier work only where the new work touches it.`
        })

      /** The task's worktrees here, one per repository it changes, the project's first first. */
      const worktreesOf = (taskId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          return yield* sql<{ id: string; path: string; name: string; slug: string; base: string | null }>`
            SELECT w.id, w.path, b.display_name AS name, b.slug, coalesce(w.base_commit, w.base_ref) AS base
            FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id
            WHERE w.task_id = ${taskId} AND w.device_id = ${instance.deviceId} ORDER BY b.created_at, b.rowid`
        })

      /** What the task's worktrees hold, together: it changes when any of them does. */
      const digestAll = (taskId: string) =>
        Effect.map(
          Effect.flatMap(worktreesOf(taskId), (worktrees) => Effect.forEach(worktrees, (worktree) => digestOf(worktree.path))),
          (digests) => digests.join(' '),
        )

      /* ---- Rounds of work after a task's plan (ADR-034) ---- */

      /** Where a round of work starts: each of the task's worktrees' head, what they hold, and what they haven't committed. */
      const startOf = (taskId: string) =>
        Effect.gen(function* () {
          const heads: Record<string, string> = {}
          const uncommitted: Record<string, ReadonlyArray<string>> = {}
          for (const worktree of yield* worktreesOf(taskId)) {
            heads[worktree.path] = yield* commitOf(worktree.path, 'HEAD').pipe(Effect.orElseSucceed(() => ''))
            uncommitted[worktree.path] = yield* uncommittedFiles(worktree.path).pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []))
          }
          return { heads, uncommitted, digest: yield* digestAll(taskId) } satisfies RoundStart
        })

      /**
       * Whether a round made new work since it started: new commits in any of
       * the task's repositories, or changes left uncommitted that weren't
       * there then and aren't evidence the lead handed.
       */
      const madeSince = (taskId: string, start: RoundStart) =>
        Effect.gen(function* () {
          const now = yield* startOf(taskId)
          if (Object.entries(now.heads).some(([path, head]) => start.heads[path] !== head)) return true
          if (now.digest === start.digest) return false
          const pictures = yield* evidencePaths(taskId)
          return Object.entries(now.uncommitted).some(([path, files]) =>
            files.some((file) => !pictures(path, file) && !(start.uncommitted[path] ?? []).includes(file)),
          )
        })

      /* One round opens at a time on a task: the person's turn and its lead's finish_step don't open two. */
      const roundLocks = new Map<string, Semaphore.Semaphore>()
      const oneRound = <A, E, R>(taskId: string, effect: Effect.Effect<A, E, R>) =>
        Effect.suspend(() => {
          const lock = roundLocks.get(taskId) ?? Semaphore.makeUnsafe(1)
          roundLocks.set(taskId, lock)
          return lock.withPermits(1)(effect)
        })

      /**
       * Opens a round of work on a task whose latest run is over, as what the
       * person said reaches its lead, or its lead reports with no step open
       * (ADR-034): a run of its own, with no plan, whose steps and ending are
       * the plan's run's, and its Implement step under way at once on the
       * lead's session, which is at work already in its turn. A merged task
       * opens again for it. None while a run runs or is stopped, the task is
       * a draft or abandoned, its project removed, or a conflict round is
       * under way, which is its own course. The round's run and its attempt,
       * or undefined where none opened.
       */
      const openRound = (taskId: string, sessionId: string) =>
        oneRound(
          taskId,
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient
            const [last] = yield* sql<{ id: string; state: string; workflowVersionId: string; parameters: string; createdAt: string }>`
              SELECT id, state, workflow_version_id, parameters, created_at FROM runs WHERE task_id = ${taskId}
              ORDER BY created_at DESC, rowid DESC LIMIT 1`
            if (last === undefined || (last.state !== 'succeeded' && last.state !== 'failed' && last.state !== 'cancelled'))
              return undefined
            const ended: RoundBack['ended'] = last.state
            const [task] = yield* sql<{
              state: string
              settledAt: string | null
              projectId: ProjectId
              archived: string | null
              rounds: number
            }>`
              SELECT k.state, k.settled_at, k.project_id, p.archived_at AS archived,
                (SELECT count(*) FROM conflict_resolutions c WHERE c.task_id = k.id AND c.state IN ('resolving', 'checking')) AS rounds
              FROM tasks k JOIN projects p ON p.id = k.project_id WHERE k.id = ${taskId}`
            if (task === undefined || task.archived !== null || task.rounds > 0 || (task.state !== 'open' && task.state !== 'done'))
              return undefined
            const was: RoundBack['state'] = task.state
            // Its steps and ending are the plan's: a reviewed task's round has a review, whatever the last round skipped.
            const [planned] = yield* sql<{ parameters: string }>`
              SELECT parameters FROM runs WHERE task_id = ${taskId} AND plan_id IS NOT NULL ORDER BY created_at, rowid LIMIT 1`
            const parameters = planned?.parameters ?? last.parameters
            const implement = (yield* Schema.decodeUnknownEffect(Schema.fromJsonString(PlanParameters))(parameters)).steps.find(
              (step) => step.key === 'implement',
            )
            if (implement === undefined) return undefined
            // Only for its lead, on the task's own thread.
            const [lead] = yield* sql<{ id: string }>`
              SELECT s.id FROM provider_sessions s JOIN threads t ON t.id = s.thread_id
              WHERE s.id = ${sessionId} AND t.task_id = ${taskId} AND t.kind = 'task'`
            if (lead === undefined) return undefined
            const start = yield* startOf(taskId)
            const policyId = yield* policyOf(task.projectId)
            const runId = yield* newId(Ids.run)
            const opened = yield* sql.withTransaction(
              Effect.gen(function* () {
                // Read again where it is written: another run, or the task moving meanwhile, opens none.
                const [still] = yield* sql<{ id: string }>`
                  SELECT id FROM runs WHERE task_id = ${taskId} ORDER BY created_at DESC, rowid DESC LIMIT 1`
                const [now] = yield* sql<{ state: string }>`SELECT state FROM tasks WHERE id = ${taskId}`
                if (still?.id !== last.id || now?.state !== was) return false
                const at = yield* timestamp
                if (was === 'done') {
                  const state = yield* transition(taskLifecycle, 'done', 'open')
                  const revision = yield* change('tasks', taskId, { state, settledAt: null })
                  yield* fact({
                    projectId: task.projectId,
                    aggregateType: 'task',
                    aggregateId: taskId,
                    revision,
                    type: 'task.reopened',
                    payload: { round: runId },
                    actorId: instance.systemId,
                  })
                }
                const executionId = yield* newId(Ids.workflowExecution)
                yield* sql`INSERT INTO runs ${sql.insert({
                  id: runId,
                  projectId: task.projectId,
                  taskId,
                  planId: null,
                  workflowVersionId: last.workflowVersionId,
                  policyId,
                  parameters,
                  state: 'running',
                  createdAt: at,
                })}`
                yield* sql`INSERT INTO run_attempts ${sql.insert({
                  id: yield* newId(Ids.runAttempt),
                  projectId: task.projectId,
                  runId,
                  attemptNumber: 1,
                  deviceId: instance.deviceId,
                  controllerGeneration: 1,
                  controllerInstanceId: instance.id,
                  state: 'active',
                  startedAt: at,
                })}`
                yield* sql`INSERT INTO workflow_executions ${sql.insert({
                  id: executionId,
                  projectId: task.projectId,
                  runId,
                  workflowVersionId: last.workflowVersionId,
                  graphRevision: 1,
                  state: 'running',
                  createdAt: at,
                })}`
                const steps = (yield* Schema.decodeUnknownEffect(Schema.fromJsonString(PlanParameters))(parameters)).steps
                yield* sql`INSERT INTO execution_graph_revisions ${sql.insert({
                  projectId: task.projectId,
                  executionId,
                  revision: 1,
                  graph: JSON.stringify({ steps: steps.filter((step) => !step.skipped), review: { rounds: ROUNDS }, round: true }),
                  cause: 'materialized',
                  createdAt: at,
                })}`
                yield* fact({
                  projectId: task.projectId,
                  aggregateType: 'run',
                  aggregateId: runId,
                  revision: 1,
                  type: 'run.admitted',
                  payload: { round: true, after: last.id },
                  actorId: instance.systemId,
                })
                return true
              }),
            )
            if (!opened) return undefined
            const current = yield* currentRun(taskId)
            if (current === undefined) return undefined
            const input: RoundInput = { round: { state: was, settledAt: task.settledAt, ended }, start }
            const admitted = yield* unlessStopped(sql.withTransaction(admit(current, 'implement', 0, implement, input)))
            if (admitted === undefined) return undefined
            yield* begin(current, admitted.attemptId, sessionId, current.threadId)
            yield* touchCard(taskId)
            return { run: current, ...admitted }
          }),
        )

      /**
       * Where a round made nothing new, the task goes back where it was, inside
       * the caller's transaction: its run ends as the one before it did, so its
       * card says what it said before, and a merged task is done again, at the
       * time it first settled.
       */
      const backWhereItWas = (run: RunRow, back: RoundBack, why: 'nothing_new' | 'abandoned' = 'nothing_new') =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          yield* ends(run, back.ended)
          yield* change('runs', run.runId, { endReason: why })
          const [task] = yield* sql<{ state: string }>`SELECT state FROM tasks WHERE id = ${run.taskId}`
          if (back.state !== 'done' || task?.state !== 'open') return
          const state = yield* transition(taskLifecycle, 'open', 'done')
          const revision = yield* change('tasks', run.taskId, { state, settledAt: back.settledAt })
          yield* fact({
            projectId: run.projectId,
            aggregateType: 'task',
            aggregateId: run.taskId,
            revision,
            type: 'task.done',
            payload: { round: run.runId, back: true },
            actorId: instance.systemId,
          })
        })

      /**
       * A round's Implement step whose lead's turn ended, or whose session
       * went, having made nothing new, and asking the person nothing: the
       * round ends there, and the task is back where it was. Whether it did.
       */
      const quietly = (
        run: RunRow,
        attempt: { readonly id: string; readonly nodeId: string; readonly nodeKey: string; readonly input: string },
      ) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const round = run.planId === null && attempt.nodeKey === 'implement' ? roundOf(attempt.input) : undefined
          if (round === undefined || (yield* asking(run.threadId)) || (yield* madeSince(run.taskId, round.start))) return false
          const closed = yield* sql.withTransaction(
            Effect.gen(function* () {
              const [still] = yield* sql<{ state: string }>`SELECT state FROM node_attempts WHERE id = ${attempt.id}`
              if (!(yield* going(run)) || !['admitted', 'running', 'waiting_attention'].includes(still?.state ?? '')) return false
              yield* ended(run, attempt, 'succeeded', { quiet: true })
              yield* unstuck(run)
              yield* backWhereItWas(run, round.round)
              return true
            }),
          )
          if (!closed) return false
          // A pull request that merged while it ran settles the task now.
          yield* Effect.ignore(changes.settleIfMerged(run.taskId))
          yield* touchCard(run.taskId)
          return true
        })

      /** Where a round started, as its Implement step keeps it; undefined for a run of a plan. */
      const roundStartOf = (run: RunRow) =>
        Effect.gen(function* () {
          if (run.planId !== null) return undefined
          const sql = yield* SqlClient.SqlClient
          const [first] = yield* sql<{ input: string }>`
            SELECT a.input FROM node_attempts a JOIN nodes n ON n.id = a.node_id
            WHERE n.execution_id = ${run.executionId} AND n.node_key = 'implement' ORDER BY a.admitted_at, a.rowid LIMIT 1`
          return roundOf(first?.input)
        })

      /** A round of review's copy, thread and session: its reviewer reads the work as it stands, on the account picked, where one was. */
      const reviewRound = (
        run: RunRow,
        round: number,
        settled: string | undefined,
        step: PlanStep,
        attemptId: string,
        accountId?: string,
      ) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          // The round reads a copy of the work as it stands now, in each repository, and the record keeps which code that was (ADR-008).
          for (const workspace of yield* worktreesOf(run.taskId)) {
            const snapshot = yield* snapshotForReview(workspace.path, round)
            yield* sql`INSERT INTO workspace_snapshots ${sql.insert({
              id: yield* newId(Ids.workspaceSnapshot),
              projectId: run.projectId,
              workspaceId: workspace.id,
              nodeAttemptId: attemptId,
              commitSha: snapshot.commit,
              treeSha: snapshot.tree,
              reason: 'node_started',
              takenAt: yield* timestamp,
            })}`
          }
          const [thread] = yield* sql<{ id: string }>`
            SELECT id FROM threads WHERE task_id = ${run.taskId} AND kind = 'step' AND node_key = 'review'`
          const threadId = thread?.id ?? (yield* newId(Ids.thread))
          if (thread === undefined)
            yield* sql`INSERT INTO threads ${sql.insert({
              id: threadId,
              projectId: run.projectId,
              kind: 'step',
              taskId: run.taskId,
              executionId: run.executionId,
              nodeKey: 'review',
              createdAt: yield* timestamp,
            })}`
          // Handed to another agent, the round starts that one afresh; one being stopped isn't carried on with.
          const running = Option.filter(yield* sessions.running(threadId), (session) => !session.stopping)
          // Handed to another agent or account, or its account out of usage, the round starts afresh, on another account where it is.
          const spent = Option.isSome(running) && Option.isSome(yield* limits.outAccount(running.value.accountId))
          const elsewhere = (session: { readonly agentId: string; readonly accountId: string }) =>
            session.agentId !== step.agentId || (accountId !== undefined && session.accountId !== accountId)
          if (Option.isSome(running) && (spent || elsewhere(running.value))) yield* Effect.ignore(sessions.stop(threadId))
          const onIt = Option.filter(running, (session) => !spent && !elsewhere(session))
          // Kept for another round, the reviewer is on the model its step names; one that won't move starts afresh.
          const kept = Option.isSome(onIt) && (yield* onModel(threadId, onIt.value.sessionId, step.model))
          if (Option.isSome(onIt) && !kept) yield* Effect.ignore(sessions.stop(threadId))
          const live = kept ? onIt : Option.none()
          const sessionId = Option.isSome(live)
            ? live.value.sessionId
            : yield* sessions.start({
                threadId,
                agentId: step.agentId,
                ...(step.model === null ? {} : { model: step.model }),
                ...(step.effort == null ? {} : { effort: step.effort }),
                ...(accountId === undefined ? {} : { accountId }),
              })
          // A reviewer carrying on has the brief it started with: the lead's evidence as it stands now, written out again, goes with the round.
          const [first] = yield* worktreesOf(run.taskId)
          const shown =
            Option.isSome(live) && first !== undefined
              ? yield* evidenceForReview(run.threadId, evidenceFolderOf(reviewCopyOf(first.path))).pipe(Effect.orElseSucceed(() => ''))
              : ''
          // A round of work after the plan is reviewed for what it changed since it started (ADR-034).
          const since = round === 0 ? yield* roundStartOf(run) : undefined
          if (since !== undefined)
            yield* sessions.send({
              envelope: yield* envelope('thread.send', { threadId, round, since: run.runId }),
              threadId,
              body: yield* moreToReview(run, since.start),
              quiet: true,
            })
          else if (Option.isSome(live) || round > 0)
            yield* sessions.send({
              envelope: yield* envelope('thread.send', { threadId, round }),
              threadId,
              body: `Round ${round + 1}. The lead settled your findings:\n\n${settled ?? ''}\n\nYour copy now holds the settled work. Review the change again. Check that the fixes hold, and don't raise again what the lead set aside unless you have new evidence; then say which finding you repeat, and why.${shown === '' ? '' : `\n\nAs it stands now, in place of what you were told before:\n\n${shown}`}`,
              quiet: true,
            })
          yield* begin(run, attemptId, sessionId, threadId)
          yield* touchCard(run.taskId)
        })

      /**
       * The lead settles what the review found, in its own session, once it
       * has a place among the agents at work on this machine: the reviewer's,
       * unless what the reviewer left running still runs. Without one, it waits
       * for one, and is then told what is still open.
       */
      const settle = (run: RunRow, round: number, findings: ReadonlyArray<Finding & { readonly id: string }>) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const before = yield* digestAll(run.taskId)
          const { implement } = yield* stepsOf(run)
          const admitted = yield* unlessStopped(
            busy.enter(
              run.taskId,
              (room) =>
                sql.withTransaction(
                  Effect.gen(function* () {
                    const admission = yield* admit(run, 'settle', round, implement ?? {}, { before })
                    if (!room) yield* waitForPlace(run, admission.attemptId, { how: 'next' })
                    return { ...admission, room }
                  }),
                ),
              { after: 'review' },
            ),
          )
          if (admitted === undefined) return
          if (!admitted.room) return yield* touchCard(run.taskId)
          yield* settleOn(run, round, admitted.attemptId, findings)
        })

      /** The lead told what to settle, on the settle step admitted for it; one that can't start needs the person. */
      const settleOn = (run: RunRow, round: number, attemptId: string, findings: ReadonlyArray<Finding & { readonly id: string }>) =>
        Effect.gen(function* () {
          const { implement } = yield* stepsOf(run)
          const begun = yield* Effect.exit(
            Effect.gen(function* () {
              const sessionId = yield* leadOn(run)
              yield* sessions.send({
                envelope: yield* envelope('thread.send', { threadId: run.threadId, round, settle: true }),
                threadId: run.threadId,
                body: settling(findings),
                quiet: true,
              })
              yield* begin(run, attemptId, sessionId, run.threadId)
            }),
          )
          if (begun._tag === 'Failure')
            yield* stuck(
              run,
              { id: attemptId },
              {
                step: 'settle',
                why: 'failed_to_start',
                detail: summarize(begun.cause) || null,
                agentId: implement?.agentId ?? null,
                round,
                open: findings.length,
              },
            )
          yield* touchCard(run.taskId)
        })

      /** What the lead is told to settle a review's findings. */
      const settling = (findings: ReadonlyArray<Finding & { readonly id: string }>) =>
        `The review found:\n\n${findingsText(findings)}\n\nSettle each: fix what holds, and set aside what doesn't, with a reason. Then call finish_step with a summary, and in \`findings\` what became of each, by its id: fixed, or set_aside with the reason.`

      /**
       * Whether a session kept for a step is on the model the step asks for,
       * put there where it was on another of its agent's. One the agent won't
       * move isn't kept: the step starts afresh on its model instead.
       */
      const onModel = (threadId: string, sessionId: string, model: string | null | undefined) =>
        Effect.gen(function* () {
          if (model == null) return true
          const sql = yield* SqlClient.SqlClient
          const [on] = yield* sql<{ model: string | null }>`SELECT model FROM provider_sessions WHERE id = ${sessionId}`
          if (on?.model === model) return true
          const moved = yield* sessions.setModel({ threadId, model }).pipe(
            Effect.as(true),
            Effect.catchCause((cause) =>
              Effect.as(Effect.logWarning('A kept session wouldn’t move to its step’s model; starting afresh', cause), false),
            ),
          )
          if (!moved) return false
          // Moved, it is on what the agent says it took, which may not be what was asked for.
          const [now] = yield* sql<{ model: string | null }>`SELECT model FROM provider_sessions WHERE id = ${sessionId}`
          return now?.model === model
        })

      /** The lead's session: the one running, or the plan's lead (or another the person picked, on the account they picked) started. */
      const leadOn = (run: RunRow, agentId?: string, model?: string | null, said?: string, effort?: string | null, accountId?: string) =>
        Effect.gen(function* () {
          const { implement } = yield* stepsOf(run)
          const wanted = agentId ?? implement?.agentId ?? 'claude-code'
          // One being stopped isn't carried on with: a new one starts once it has gone.
          const live = Option.filter(yield* sessions.running(run.threadId), (session) => !session.stopping)
          // One on an account that is out of usage hands over, to the same agent's next account where it has one (ADR-012).
          const spent = Option.isSome(live) && Option.isSome(yield* limits.outAccount(live.value.accountId))
          if (
            Option.isSome(live) &&
            !spent &&
            (agentId === undefined || live.value.agentId === agentId) &&
            (accountId === undefined || live.value.accountId === accountId)
          ) {
            // Kept, it moves to a model asked for now; the plan's, or one the person set on it since, stays. One that won't move starts afresh.
            if (yield* onModel(run.threadId, live.value.sessionId, model)) return live.value.sessionId
            yield* Effect.ignore(sessions.stop(run.threadId))
            return yield* sessions.start({ threadId: run.threadId, agentId: live.value.agentId, ...(model == null ? {} : { model }) })
          }
          if (Option.isSome(live))
            return yield* sessions.switchAgent({
              threadId: run.threadId,
              agentId: wanted,
              ...(model == null ? {} : { model }),
              ...(effort == null ? {} : { effort }),
              ...(said === undefined ? {} : { said, about: 'limit' as const }),
              ...(accountId === undefined ? {} : { accountId }),
            })
          if (said !== undefined) yield* sayOut(run.threadId, run.projectId, said)
          // The plan's lead, unless it is out of usage and the project moves on: the next free agent instead.
          const instead = agentId === undefined && implement !== undefined ? yield* insteadOf(run, implement) : undefined
          // The plan's model and effort are for the plan's lead; another starts on the model chosen for it, or its own.
          const planned = agentId === undefined && instead === undefined
          const chosen = instead?.model ?? (planned ? (implement?.model ?? null) : (model ?? null))
          const thinks = planned ? (implement?.effort ?? null) : (effort ?? null)
          return yield* sessions.start({
            threadId: run.threadId,
            agentId: instead?.agentId ?? wanted,
            ...(chosen === null ? {} : { model: chosen }),
            ...(thinks === null ? {} : { effort: thinks }),
            ...(accountId === undefined ? {} : { accountId }),
          })
        })

      /**
       * Whether work goes on with the agent's next account here: only where
       * the project turned that on (ADR-012), and another of its accounts the
       * project allows can run.
       */
      const nextAccount = (agentId: string, projectId: ProjectId) =>
        Effect.gen(function* () {
          if (!(yield* limits.rotates(projectId))) return false
          return Option.isNone(yield* limits.out(agentId, projectId))
        })

      /** Says in the task's thread what a usage limit did; the home reads it as the loop's doing. */
      const sayOut = (threadId: string, projectId: ProjectId, title: string) =>
        addItem({ projectId, threadId }, 'notice', { source: 'runtime', severity: 'warning', title, about: 'limit' })

      /**
       * A planned agent that is out of usage, where the project moves on: the
       * next free agent, and the model it takes over on. Undefined where the
       * planned one is fine, or nothing is free.
       */
      const insteadOf = (run: RunRow, planned: PlanStep) =>
        Effect.gen(function* () {
          const out = yield* limits.out(planned.agentId, run.projectId)
          if (Option.isNone(out) || (yield* usageLimitOfRun(run)) !== 'move') return undefined
          const other = yield* otherStepOf(run, planned.key)
          const next = yield* limits.free([planned.agentId], other === undefined ? [] : [other], run.projectId)
          if (next === undefined) return undefined
          const model = yield* limits.modelFor({ agentId: next, projectId: run.projectId, planned })
          const [from, to] = [yield* limits.named(planned.agentId, null), yield* limits.named(next, model)]
          yield* sayOut(
            run.threadId,
            run.projectId,
            outWords({ from: from.agent, resetsAt: out.value.resetsAt, to: { ...to, ownWork: next === other } }),
          )
          return { agentId: next, model }
        })

      /**
       * The agent on the run's other step: the lead's, for a review (as it
       * leads now); the planned reviewer's, for the lead's steps. Work moved on
       * goes to it only when nothing else is free, so an agent rarely reviews
       * what it wrote.
       */
      const otherStepOf = (run: RunRow, key: 'implement' | 'review') =>
        Effect.gen(function* () {
          const { implement, review: planned } = yield* stepsOf(run)
          if (key !== 'review') return planned?.agentId
          const lead = yield* sessions.running(run.threadId)
          return Option.isSome(lead) ? lead.value.agentId : implement?.agentId
        })

      /**
       * A step's agent is out of usage (docs/architecture/05). Where the
       * project moves on and an agent is free, the step goes to it, as when the
       * person hands it over; otherwise it is held until the reset. Where the
       * project asks, or with no reset known, it needs the person, with who
       * could take it over and when the agent is back.
       */
      const outOfUsage = (on: NonNullable<Effect.Success<ReturnType<typeof stepOn>>>, agentId: string, accountId: string | null) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const out = Option.getOrNull(yield* accountId === null ? limits.out(agentId) : limits.outAccount(accountId))
          const resetsAt = out?.resetsAt ?? null
          const from = (yield* limits.named(agentId, null, accountId)).agent
          const { implement, review: plannedReview } = yield* stepsOf(on.run)
          const planned = on.step === 'review' ? plannedReview : implement
          const info: StuckInfo = { step: on.step, why: 'usage_limit', detail: null, agentId, round: on.iteration, open: 0 }
          /** Held until its reset: what waits for it, and what brings it back if handing it over doesn't go through. */
          const hold = sql.withTransaction(
            Effect.gen(function* () {
              // Its reset; one already past still waits an hour, so nothing brings the step back mid-handover.
              const until = out?.until ?? new Date(Date.parse(yield* timestamp) + Duration.toMillis(Duration.hours(1))).toISOString()
              // The account and model it was on, so it carries on there at the reset, after a restart too.
              const model = yield* modelOnStep(on.run.taskId, on.step, agentId)
              const revision = yield* change('node_attempts', on.attemptId, {
                state: 'held',
                holdReason: 'usage_limit',
                output: JSON.stringify({ heldFor: agentId, until, account: accountId, model }),
              })
              yield* fact({
                projectId: on.run.projectId,
                aggregateType: 'node_attempt',
                aggregateId: on.attemptId,
                revision,
                type: 'node_attempt.held',
                payload: { reason: 'usage_limit', agentId, until },
                actorId: instance.systemId,
              })
            }),
          )
          const policy = yield* usageLimitOfRun(on.run)
          const other = yield* otherStepOf(on.run, on.step === 'review' ? 'review' : 'implement')
          if (policy === 'move') {
            // The same agent's next account first, on the same model, where the project turned that on; then the next free agent.
            const next = (yield* nextAccount(agentId, on.run.projectId))
              ? agentId
              : yield* limits.free([agentId], other === undefined ? [] : [other], on.run.projectId)
            if (next !== undefined) {
              const model = yield* limits.modelFor({
                agentId: next,
                projectId: on.run.projectId,
                ...(planned === undefined ? {} : { planned }),
              })
              const to = next === agentId ? (yield* limits.pick({ agentId: next, projectId: on.run.projectId })).id : null
              const said = outWords({ from, resetsAt, to: { ...(yield* limits.named(next, model, to)), ownWork: next === other } })
              // Held while the next agent takes over, so nothing it says before it is told the step counts for the step.
              yield* hold
              const handing = yield* envelope('thread.send', { threadId: on.run.threadId, usageLimit: on.attemptId })
              return yield* carryOn(on.run, on.attemptId, info, { kind: 'retry', agentId: next }, handing, model, said)
            }
          }
          if (policy === 'ask' || out === null || resetsAt === null) {
            const choices = yield* limits.choices({
              accountId,
              projectId: on.run.projectId,
              rather: other === undefined ? [] : [other],
              ...(planned === undefined ? {} : { planned }),
            })
            return yield* stuck(on.run, { id: on.attemptId }, { ...info, limit: { accountId, resetsAt, choices } })
          }
          yield* hold
          yield* sayOut(on.run.threadId, on.run.projectId, outWords({ from, resetsAt, waits: 'step' }))
          yield* touchCard(on.run.taskId)
          yield* Queue.offer(holdsChanged, undefined)
        })

      /**
       * Outside a step, the coordinator or a lead the person is talking to is
       * out of usage. Where the project moves on, the next free agent takes the
       * thread over, with what the person said waiting for it; otherwise what
       * they said waits for the reset.
       */
      const outOfUsageElsewhere = (threadId: string, agentId: string, accountId: string | null) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [thread] = yield* sql<{ projectId: ProjectId; kind: string }>`SELECT project_id, kind FROM threads WHERE id = ${threadId}`
          if (thread === undefined || (thread.kind !== 'coordinator' && thread.kind !== 'task')) return
          const out = Option.getOrNull(yield* accountId === null ? limits.out(agentId) : limits.outAccount(accountId))
          const resetsAt = out?.resetsAt ?? null
          const from = (yield* limits.named(agentId, null, accountId)).agent
          if (usageLimitOf((yield* policies.current(thread.projectId)).rules) === 'move') {
            // The same agent's next account first, where the project turned that on; then the next free agent.
            const next = (yield* nextAccount(agentId, thread.projectId)) ? agentId : yield* limits.free([agentId], [], thread.projectId)
            if (next !== undefined) {
              const model = yield* limits.modelFor({ agentId: next, projectId: thread.projectId })
              const to = next === agentId ? (yield* limits.pick({ agentId: next, projectId: thread.projectId })).id : null
              yield* sessions.switchAgent({
                threadId,
                agentId: next,
                ...(model === null ? {} : { model }),
                said: outWords({ from, resetsAt, to: yield* limits.named(next, model, to) }),
                about: 'limit',
              })
              return
            }
          }
          yield* sayOut(threadId, thread.projectId, outWords({ from, resetsAt, waits: 'message' }))
          // Back at its reset, it takes what waits: the same loop as a held step's, so after a restart too.
          yield* Queue.offer(holdsChanged, undefined)
        })

      const run = (planId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [plan] = yield* sql<{ projectId: ProjectId; taskId: string; state: string; parameters: string; workflowVersionId: string }>`
            SELECT project_id, task_id, state, parameters, workflow_version_id FROM task_plans WHERE id = ${planId}`
          if (plan === undefined) return null
          const [already] = yield* sql<{ id: string }>`SELECT id FROM runs WHERE plan_id = ${planId}`
          if (already !== undefined) return null
          const parameters = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(PlanParameters))(plan.parameters)
          const implement = parameters.steps.find((step) => step.key === 'implement')
          if (implement === undefined) return null
          const runId = yield* newId(Ids.run)
          const runAttemptId = yield* newId(Ids.runAttempt)
          const executionId = yield* newId(Ids.workflowExecution)
          yield* sql.withTransaction(
            Effect.gen(function* () {
              // Checked where the run is written: a project removed meanwhile gets no run.
              const [live] = yield* sql<{ id: string }>`SELECT id FROM projects WHERE id = ${plan.projectId} AND archived_at IS NULL`
              if (live === undefined) return yield* new NotFound({ kind: 'project', id: plan.projectId })
              const at = yield* timestamp
              const [task] = yield* sql<{ state: string }>`SELECT state FROM tasks WHERE id = ${plan.taskId}`
              // Abandoned as its plan was accepted, it gets no run; nor does a plan declined meanwhile.
              if (task?.state === 'abandoned' || task?.state === 'done') return
              const [still] = yield* sql<{ state: string }>`SELECT state FROM task_plans WHERE id = ${planId}`
              if (still?.state !== 'accepted') return
              if (task?.state === 'draft') {
                const revision = yield* change('tasks', plan.taskId, { state: 'open' })
                yield* fact({
                  projectId: plan.projectId,
                  aggregateType: 'task',
                  aggregateId: plan.taskId,
                  revision,
                  type: 'task.opened',
                  actorId: instance.systemId,
                })
              }
              yield* sql`INSERT INTO runs ${sql.insert({
                id: runId,
                projectId: plan.projectId,
                taskId: plan.taskId,
                planId,
                workflowVersionId: plan.workflowVersionId,
                policyId: yield* policyOf(plan.projectId),
                parameters: plan.parameters,
                state: 'running',
                createdAt: at,
              })}`
              yield* sql`INSERT INTO run_attempts ${sql.insert({
                id: runAttemptId,
                projectId: plan.projectId,
                runId,
                attemptNumber: 1,
                deviceId: instance.deviceId,
                controllerGeneration: 1,
                controllerInstanceId: instance.id,
                state: 'active',
                startedAt: at,
              })}`
              yield* sql`INSERT INTO workflow_executions ${sql.insert({
                id: executionId,
                projectId: plan.projectId,
                runId,
                workflowVersionId: plan.workflowVersionId,
                graphRevision: 1,
                state: 'running',
                createdAt: at,
              })}`
              yield* sql`INSERT INTO execution_graph_revisions ${sql.insert({
                projectId: plan.projectId,
                executionId,
                revision: 1,
                graph: JSON.stringify({ steps: parameters.steps.filter((step) => !step.skipped), review: { rounds: ROUNDS } }),
                cause: 'materialized',
                createdAt: at,
              })}`
              yield* fact({
                projectId: plan.projectId,
                aggregateType: 'run',
                aggregateId: runId,
                revision: 1,
                type: 'run.admitted',
                payload: { planId },
                actorId: instance.systemId,
              })
            }),
          )
          const current = yield* currentRun(plan.taskId)
          if (current === undefined) return null
          // Its first step takes a place among the agents at work on this machine, or waits for one.
          const admitted = yield* unlessStopped(
            busy.enter(plan.taskId, (room) =>
              sql.withTransaction(
                Effect.gen(function* () {
                  const admission = yield* admit(current, 'implement', 0, implement)
                  if (!room) yield* waitForPlace(current, admission.attemptId, { how: 'start' })
                  return { ...admission, room }
                }),
              ),
            ),
          )
          if (admitted === undefined) return null
          if (!admitted.room) {
            yield* touchCard(plan.taskId)
            return 'waiting' as const
          }
          yield* startFirst(current, admitted.attemptId)
          return 'running' as const
        })

      /** A plan's first step under way: its lead, as the plan says, on it. A lead that can't start leaves Implement needing the person, who can hand it to another agent. */
      const startFirst = (current: RunRow, attemptId: string) =>
        Effect.gen(function* () {
          const begun = yield* Effect.exit(leadOn(current))
          if (begun._tag === 'Failure') {
            const { implement } = yield* stepsOf(current)
            return yield* stuck(
              current,
              { id: attemptId },
              {
                step: 'implement',
                why: 'failed_to_start',
                detail: summarize(begun.cause) || null,
                agentId: implement?.agentId ?? null,
                round: 0,
                open: 0,
              },
            )
          }
          yield* begin(current, attemptId, begun.value, current.threadId)
          yield* touchCard(current.taskId)
        })

      /**
       * Descriptions the lead gave for a step Althar sent back, by thread:
       * kept, so a task of several can give them one by one. Kept for the
       * launch; after a restart, the lead is asked again.
       */
      const givenBefore = new Map<string, Readonly<Record<string, string>>>()

      /** The descriptions the lead gave, by the slug of the repository each is for; refused where it names none of the task's. */
      const descriptionsOf = (
        worktrees: ReadonlyArray<{ readonly name: string; readonly slug: string }>,
        given: ReadonlyArray<{ readonly repository?: string | undefined; readonly text: string }>,
      ) =>
        Effect.gen(function* () {
          const named: Record<string, string> = {}
          for (const description of given) {
            const wanted = description.repository?.trim().toLowerCase()
            const worktree =
              wanted === undefined || wanted === ''
                ? worktrees.length === 1
                  ? worktrees[0]
                  : undefined
                : worktrees.find((candidate) => candidate.slug === wanted || candidate.name.toLowerCase() === wanted)
            if (worktree === undefined)
              return yield* new ToolRefused({
                message: `Say which repository each description is for: ${worktrees.map((candidate) => candidate.name).join(', ')}.`,
              })
            if (description.text.trim() !== '') named[worktree.slug] = description.text
          }
          return Object.keys(named).length === 0 ? {} : { descriptions: named }
        })

      /**
       * The task's repositories with a pull request to open, in a template
       * the lead hasn't written a description in, now or before. One with
       * nothing to publish opens none, so it needs none.
       */
      const templatesUnwritten = (
        threadId: string,
        worktrees: ReadonlyArray<{ readonly path: string; readonly name: string; readonly slug: string; readonly base: string | null }>,
        given: Readonly<Record<string, string>>,
        /** Only descriptions given since, for a task's next pull request: its last one's describe that. */
        since: string | null = null,
      ) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const unwritten: Array<{ readonly name: string; readonly path: string; readonly text: string }> = []
          for (const worktree of worktrees) {
            if (given[worktree.slug] !== undefined) continue
            const ahead = worktree.base === null ? 1 : yield* commitsAhead(worktree.path, worktree.base).pipe(Effect.orElseSucceed(() => 1))
            if (ahead === 0) continue
            const { template } = yield* conventionsAt(worktree.path, 'HEAD')
            if (template === null) continue
            const [before] = yield* sql<{ n: number }>`
              SELECT count(*) AS n FROM thread_items WHERE thread_id = ${threadId} AND kind = 'step_result'
                AND json_extract(content, '$.descriptions.' || json_quote(${worktree.slug})) IS NOT NULL
                AND (${since} IS NULL OR created_at > ${since})`
            if ((before?.n ?? 0) === 0) unwritten.push({ name: worktree.name, ...template })
          }
          return unwritten
        })

      /** The lead says its step is done: Implement, or a round of settling. */
      const finishStep = (access: ToolAccess, input: unknown) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const {
            summary,
            findings: settled = [],
            descriptions: given = [],
            evidence: handed = [],
            unverified,
          } = yield* read(Finished, input)
          const worktrees = access.taskId === null ? [] : yield* worktreesOf(access.taskId)
          // What it shows of its work: its pictures read now, and kept once the step is taken.
          const evidence = yield* readEvidence(
            handed,
            worktrees.map((worktree) => worktree.path),
          )
          const itemId = yield* newId(Ids.threadItem)
          const shows = Effect.gen(function* () {
            const kept = yield* keepEvidence({ projectId: access.projectId as ProjectId, itemId, folders: [] }, evidence)
            // A list given is kept even empty: what an earlier step couldn't show, this one may have.
            return {
              ...(kept.length === 0 ? {} : { evidence: kept }),
              ...(unverified === undefined ? {} : { unverified: unverifiedOf(unverified) }),
            }
          })
          // What it gave before Althar sent the step back, and what it gives now.
          const now = yield* descriptionsOf(worktrees, given)
          const kept = { ...givenBefore.get(access.threadId), ...now.descriptions }
          const descriptions = Object.keys(kept).length === 0 ? {} : { descriptions: kept }
          const underWay = access.taskId === null ? undefined : yield* currentRun(access.taskId)
          const [planned] =
            access.taskId === null ? [] : yield* sql<{ id: string }>`SELECT id FROM runs WHERE task_id = ${access.taskId} LIMIT 1`
          if (underWay === undefined && planned === undefined) {
            // A task started without a plan has no steps: the summary is still what the person reads.
            yield* addItem(
              { projectId: access.projectId as ProjectId, threadId: access.threadId },
              'step_result',
              { step: 'implement', summary, ...descriptions, ...(yield* shows) },
              { id: itemId },
            )
            return 'Althar has your summary.'
          }
          // After its plan, the lead's report opens a round of work of its own, which it finishes (ADR-034).
          const current = underWay ?? (access.taskId === null ? undefined : (yield* openRound(access.taskId, access.sessionId))?.run)
          const attempt = current === undefined ? undefined : yield* running(current, ['implement', 'settle'])
          if (current === undefined || attempt === undefined)
            return yield* new ToolRefused({ message: 'No step is waiting on you, so Althar keeps no summary now.' })
          const step = attempt.nodeKey === 'settle' ? 'settle' : 'implement'
          // A round of work that made nothing new ends with its summary, and the task is back where it was.
          const round = current.planId === null && step === 'implement' ? roundOf(attempt.input) : undefined
          const quiet = round !== undefined && !(yield* madeSince(current.taskId, round.start))
          // A task that ends on its host pushes commits only: what isn't committed is the lead's to commit or clear away first.
          const end = (yield* stepsOf(current)).end ?? (yield* changes.endFor(current.projectId, current.taskId))
          if (end !== null) {
            // In a task of several repositories, each file by the repository it's in. A picture handed as evidence, now or at an
            // earlier step, needn't be committed.
            const pictures = evidenceFiles(evidence)
            const before = yield* evidencePaths(current.taskId)
            const left = (yield* Effect.forEach(worktrees, (worktree) =>
              Effect.map(uncommittedFiles(worktree.path), (files) =>
                files
                  .filter(
                    (file) =>
                      !before(worktree.path, file) &&
                      !pictures.some((picture) => picture.worktree === worktree.path && picture.file === file),
                  )
                  .map((file) => (worktrees.length > 1 ? `${worktree.name}/${file}` : file)),
              ),
            )).flat()
            if (left.length > 0)
              return yield* new ToolRefused({
                message: `These aren't committed: ${filesLine(left)}. Althar pushes commits only, so commit what belongs to the task, delete the rest (scratch files, logs), and call finish_step again.`,
              })
          }
          // A pull request in a repository with a template is described in it, by the lead, as a teammate would.
          if ((end === 'draft' || end === 'ready') && !quiet) {
            // A round's work after its task's pull request merged or closed goes in a new one, described from what came since.
            const after = round === undefined ? [] : yield* changes.unshipped(current.taskId).pipe(Effect.orElseSucceed(() => []))
            const since = after.map((one) => one.openedAt).toSorted()[0] ?? null
            const unwritten = yield* templatesUnwritten(access.threadId, worktrees, kept, since)
            if (unwritten.length > 0) {
              givenBefore.set(access.threadId, kept)
              return yield* new ToolRefused({ message: templateAsk(unwritten, worktrees.length > 1) })
            }
          }
          givenBefore.delete(access.threadId)
          const showing = yield* shows
          const taken = yield* sql.withTransaction(
            Effect.gen(function* () {
              // Read before the looks at git above: stopped and resumed meanwhile, the report is dropped.
              if (!(yield* keeps(current, attempt.id, { step, summary }))) return false
              yield* ended(current, attempt, 'succeeded', { summary })
              yield* result(current, { step, round: attempt.iteration, summary, ...descriptions, ...showing }, itemId)
              // What became of each finding, as the lead says: the input to the next round, and to what reviews learn.
              if (step === 'settle') yield* settleFindings(current, attempt.id, settled)
              // A step that needed the person and reported after all no longer does.
              yield* unstuck(current)
              if (quiet && round !== undefined) yield* backWhereItWas(current, round.round)
              return true
            }),
          )
          if (!taken) return yield* dropped
          if (quiet) {
            // A pull request that merged while it ran settles the task now.
            yield* Effect.ignore(changes.settleIfMerged(current.taskId))
            yield* touchCard(current.taskId)
            return 'Althar has your summary. Nothing on the branch changed this round, so the task is back where it was.'
          }
          if (step === 'implement') {
            const next = yield* review(current, 0)
            return next === undefined
              ? 'Althar has your summary. The task is ready for the person.'
              : 'Althar has your summary. A review starts now; wait for its findings.'
          }
          // Another round only if settling changed the code, and rounds are left.
          const before = (JSON.parse(attempt.input) as { before?: string }).before ?? ''
          const after = yield* digestAll(current.taskId)
          if (after !== before && attempt.iteration + 1 < ROUNDS) {
            yield* review(current, attempt.iteration + 1, summary)
            return 'Althar has your summary. The review looks again.'
          }
          // Out of rounds, with changes no review has seen: that isn't ready, it's the person's call (05: Stuck, findings open).
          if (after !== before) {
            const { review: reviewer } = yield* stepsOf(current)
            yield* stuck(current, null, {
              step: 'review',
              why: 'round_limit',
              detail: summary,
              agentId: reviewer?.agentId ?? null,
              round: attempt.iteration + 1,
              open: (yield* openFindings(current)).length,
            })
            return 'Althar has your summary. That was the last round of review, so the person decides what comes next.'
          }
          yield* conclude(current)
          return 'Althar has your summary. The task is ready for the person.'
        })

      /** Records what the lead did about each of the run's open findings it names: fixed, or set aside with its reason. */
      const settleFindings = (
        run: RunRow,
        attemptId: string,
        settled: ReadonlyArray<{ readonly id: string; readonly outcome: 'fixed' | 'set_aside'; readonly reason?: string | undefined }>,
      ) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const at = yield* timestamp
          for (const outcome of settled) {
            const [finding] = yield* sql<{ id: string }>`
              SELECT f.id FROM findings f JOIN node_attempts a ON a.id = f.review_attempt_id JOIN nodes n ON n.id = a.node_id
              WHERE f.id = ${outcome.id} AND f.state = 'open' AND n.execution_id = ${run.executionId}`
            if (finding === undefined) continue
            const revision = yield* change('findings', finding.id, {
              state: outcome.outcome,
              settledInAttemptId: attemptId,
              response: outcome.reason ?? null,
              settledAt: at,
            })
            yield* fact({
              projectId: run.projectId,
              aggregateType: 'finding',
              aggregateId: finding.id,
              revision,
              type: `finding.${outcome.outcome}`,
              payload: { reason: outcome.reason ?? null },
              actorId: instance.systemId,
            })
          }
        })

      /** The reviewer's findings: the run ends if there are none, and the lead settles them if there are. */
      const reportReview = (access: ToolAccess, input: unknown) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const reviewed = yield* read(Reviewed, input)
          const findings = reviewed.findings ?? []
          const current = access.taskId === null ? undefined : yield* currentRun(access.taskId)
          const attempt = current === undefined ? undefined : yield* running(current, ['review'])
          if (current === undefined || attempt === undefined) return yield* new ToolRefused({ message: 'No review is waiting on you.' })
          const recorded = yield* sql.withTransaction(
            Effect.gen(function* () {
              if (!(yield* keeps(current, attempt.id, { step: 'review', verdict: reviewed.verdict, summary: reviewed.summary })))
                return undefined
              yield* unstuck(current)
              const ids: Array<Finding & { readonly id: string }> = []
              for (const finding of findings) {
                const id = yield* newId(Ids.finding)
                ids.push({ ...finding, id })
                yield* sql`INSERT INTO findings ${sql.insert({
                  id,
                  projectId: current.projectId,
                  reviewAttemptId: attempt.id,
                  severity: finding.severity,
                  location: JSON.stringify({ file: finding.file ?? null, line: finding.line ?? null }),
                  claim: finding.claim,
                  state: 'open',
                  createdAt: yield* timestamp,
                })}`
              }
              yield* ended(current, attempt, 'succeeded', {
                verdict: reviewed.verdict,
                summary: reviewed.summary,
                findings: findings.length,
              })
              const [reviewer] = yield* sql<{ agentId: string }>`SELECT agent_id FROM provider_sessions WHERE id = ${access.sessionId}`
              yield* result(current, {
                step: 'review',
                round: attempt.iteration,
                verdict: reviewed.verdict,
                summary: reviewed.summary,
                findings,
                agentId: reviewer?.agentId ?? null,
              })
              return ids
            }),
          )
          if (recorded === undefined) return yield* dropped
          if (reviewed.verdict === 'pass' || findings.length === 0) {
            yield* conclude(current)
            return 'Althar has your review. The change passes.'
          }
          yield* settle(current, attempt.iteration, recorded)
          return 'Althar has your review. The lead settles your findings; you may be asked to look again.'
        })

      const tool = (
        name: string,
        description: string,
        input: Readonly<Record<string, unknown>>,
        call: (access: ToolAccess, input: unknown) => Effect.Effect<string, unknown, Store>,
      ): Tool => ({
        name,
        description,
        input,
        call: (value, access) =>
          provide(call(access, value)).pipe(
            Effect.catch((error) =>
              error instanceof ToolRefused
                ? Effect.fail(error)
                : Effect.andThen(
                    Effect.logWarning('A step tool did not succeed', error),
                    Effect.fail(new ToolRefused({ message: 'Althar could not record that. Try again.' })),
                  ),
            ),
          ),
      })

      yield* toolServer.serve('lead', [
        tool(
          'finish_step',
          "Tells Althar you have done your step: the task, or settling a review's findings. The summary is what the person reads instead of your whole turn: a few lines on what you changed, how you checked it, and anything left open. With it, the evidence you gathered that the change does what it should, and in `unverified` what you couldn't show.",
          {
            type: 'object',
            properties: {
              summary: { type: 'string' },
              evidence: {
                type: 'array',
                description:
                  "What shows the change does what it should, in the form that fits the task, each with a caption saying what it shows. A screenshot or recording is a PNG, JPEG, GIF or WebP file in the worktree, by its path (it needn't be committed); a command or test run is what you ran, its exit code and the end of its output, all three; a response, log or note is text. Where nothing fits (a typo, a version bump), one note saying so.",
                items: {
                  type: 'object',
                  properties: {
                    kind: { type: 'string', enum: [...EVIDENCE_KINDS] },
                    caption: {
                      type: 'string',
                      description: 'What it shows, in a line: "The Evidence section with two screenshots and a test run".',
                    },
                    path: { type: 'string', description: 'For a screenshot or recording: the picture, from the worktree.' },
                    command: { type: 'string', description: 'For a command or test run: what you ran.' },
                    exit_code: { type: 'integer' },
                    output: {
                      type: 'string',
                      description: 'What it printed: the part that shows the result, such as the summary of a test run.',
                    },
                    text: { type: 'string', description: 'For a response, log or note: the text.' },
                  },
                  required: ['kind', 'caption'],
                },
              },
              unverified: {
                type: 'array',
                description:
                  'What you changed but couldn\'t show working, each in a line, and why: "Not tried with a real microphone: none in the sandbox". A claim with no evidence belongs here. Settling a review, an empty list says what you couldn\'t show before, you have now.',
                items: { type: 'string' },
              },
              descriptions: {
                type: 'array',
                description:
                  "Where the task's pull request is opened in a repository with a pull request template: its description, written in that template as a teammate would. Keep every heading and checklist, fill each section from your work, and leave every box unticked.",
                items: {
                  type: 'object',
                  properties: {
                    repository: { type: 'string', description: 'Which repository it is for, where the task has several.' },
                    text: { type: 'string' },
                  },
                  required: ['text'],
                },
              },
              findings: {
                type: 'array',
                description: 'When settling a review: what became of each finding, by the id Althar gave it.',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    outcome: { type: 'string', enum: ['fixed', 'set_aside'] },
                    reason: { type: 'string', description: 'Why it was set aside.' },
                  },
                  required: ['id', 'outcome'],
                },
              },
            },
            required: ['summary'],
          },
          finishStep,
        ),
      ])
      yield* toolServer.serve('reviewer', [
        tool(
          'report_review',
          'Reports your review of the change: a verdict, a summary of a few lines, and your findings. With no findings worth fixing, the verdict is pass.',
          {
            type: 'object',
            properties: {
              verdict: { type: 'string', enum: ['pass', 'changes_requested'] },
              summary: { type: 'string' },
              findings: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    severity: { type: 'string', enum: ['blocking', 'major', 'minor', 'nit'] },
                    file: { type: 'string' },
                    line: { type: 'integer' },
                    claim: { type: 'string' },
                  },
                  required: ['severity', 'claim'],
                },
              },
            },
            required: ['verdict', 'summary'],
          },
          reportReview,
        ),
      ])

      /**
       * The person's answer to a step that needs them. Telling sends their
       * words to the step's agent, started again if it went. Handing the step
       * over runs it again on that agent, on the account and model picked
       * where one was: the lead's steps in its thread, a review as a new
       * round. Waiting holds a step a usage limit stopped until the reset.
       * Abandoning stops the run; for a review, the task goes on without it
       * and is ready.
       */
      const answerStuck = (input: { readonly envelope: CommandEnvelope; readonly attentionId: string; readonly answer: StuckAnswer }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const { answer } = input
          const call = yield* sql.withTransaction(
            Effect.gen(function* () {
              const [row] = yield* sql<{ projectId: ProjectId; taskId: string; attemptId: string | null; payload: string; state: string }>`
                SELECT project_id, task_id, node_attempt_id AS attempt_id, payload, state FROM attention_requests
                WHERE id = ${input.attentionId} AND kind = 'stuck'`
              if (row === undefined) return yield* new NotFound({ kind: 'attention_request', id: input.attentionId })
              if (row.state !== 'open') return yield* new AttentionClosed({ attentionId: input.attentionId })
              // Only a reset that is known can be waited for.
              if (answer.kind === 'wait' && (JSON.parse(row.payload) as StuckInfo).limit?.resetsAt == null)
                return yield* new NothingToWaitFor({ attentionId: input.attentionId })
              // An account picked is one of the agent's own, still there; otherwise the call stays open.
              if (answer.kind === 'retry' && answer.accountId !== undefined) {
                const [owner] = yield* sql<{ agentId: string }>`
                  SELECT agent_id FROM agent_accounts WHERE id = ${answer.accountId} AND removed_at IS NULL`
                if (owner?.agentId !== answer.agentId) return yield* new NotFound({ kind: 'account', id: answer.accountId })
              }
              const at = yield* timestamp
              const revision = yield* change('attention_requests', input.attentionId, { state: 'answered', answeredAt: at })
              yield* fact({
                projectId: row.projectId,
                aggregateType: 'attention_request',
                aggregateId: input.attentionId,
                revision,
                type: 'attention_request.answered',
                payload: answer,
                actorId: input.envelope.actorId,
                commandId: input.envelope.commandId,
              })
              const decisionId = yield* newId(Ids.decision)
              yield* sql`INSERT INTO decisions ${sql.insert({
                id: decisionId,
                projectId: row.projectId,
                attentionRequestId: input.attentionId,
                outcome: 'answer',
                reason:
                  answer.kind === 'tell'
                    ? answer.note
                    : answer.kind === 'retry'
                      ? `Hand the step to ${answer.agentId}`
                      : answer.kind === 'wait'
                        ? 'Wait for the reset'
                        : 'Abandon',
                decidedByActorId: input.envelope.actorId,
                decidedAt: at,
              })}`
              yield* fact({
                projectId: row.projectId,
                aggregateType: 'decision',
                aggregateId: decisionId,
                revision: 1,
                type: 'decision.made',
                payload: answer,
                actorId: input.envelope.actorId,
                commandId: input.envelope.commandId,
              })
              return row
            }),
          )
          const current = yield* currentRun(call.taskId)
          if (current === undefined) return
          const info = JSON.parse(call.payload) as StuckInfo
          if (answer.kind === 'wait') return yield* waitForReset(current, call.attemptId, info, input.envelope)
          yield* carryOnPlaced(current, call.attemptId, info, answer, input.envelope)
        })

      /**
       * Carries on a lead's step that needed the person, as they answered,
       * once its lead has a place among the agents at work on this machine
       * (Busy.ts): without one, the step is held with the answer, and carries
       * on as answered once one frees, after a restart too. A review asks for
       * its place as it starts again; abandoning, and publishing, which is
       * Althar's own, take none.
       */
      const carryOnPlaced = (
        current: RunRow,
        attemptId: string | null,
        info: StuckInfo,
        answer: Exclude<StuckAnswer, { readonly kind: 'wait' }>,
        envelope: CommandEnvelope,
      ) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          if (attemptId === null || answer.kind === 'abandon' || (info.step !== 'implement' && info.step !== 'settle'))
            return yield* carryOn(current, attemptId, info, answer, envelope)
          yield* busy.enter(
            current.taskId,
            (room) =>
              room
                ? Effect.succeed(true)
                : sql.withTransaction(
                    Effect.gen(function* () {
                      // Stopped since the answer, the step is the person's to resume, not to carry on.
                      const [still] = yield* sql<{ state: string }>`SELECT state FROM node_attempts WHERE id = ${attemptId}`
                      if (still?.state !== 'waiting_attention' || !(yield* going(current))) return false
                      yield* waitForPlace(current, attemptId, { how: 'answered', info, answer })
                      return false
                    }),
                  ),
            { next: (room) => (room ? provide(carryOn(current, attemptId, info, answer, envelope)) : Effect.void) },
          )
          yield* touchCard(current.taskId)
        })

      /**
       * A step a usage limit stopped, held until the reset as the person said:
       * at it, the same agent carries it on, as for a project that waits. A
       * reset already past by the answer carries it on now.
       */
      const waitForReset = (current: RunRow, attemptId: string | null, info: StuckInfo, envelope: CommandEnvelope) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const until = info.limit?.resetsAt
          if (attemptId === null || info.agentId === null || until == null) return
          if (Date.parse(until) <= Date.parse(yield* timestamp))
            return yield* carryOnPlaced(current, attemptId, info, { kind: 'retry', agentId: info.agentId }, envelope)
          const agentId = info.agentId
          const from = (yield* limits.named(agentId, null, info.limit?.accountId)).agent
          const model = yield* modelOnStep(current.taskId, info.step, agentId)
          const held = yield* sql.withTransaction(
            Effect.gen(function* () {
              // Stopped since the answer, the step waits for the person to resume it, not for the reset.
              const [still] = yield* sql<{ state: string }>`SELECT state FROM node_attempts WHERE id = ${attemptId}`
              if (still?.state !== 'waiting_attention' || !(yield* going(current))) return false
              const revision = yield* change('node_attempts', attemptId, {
                state: 'held',
                holdReason: 'usage_limit',
                output: JSON.stringify({ heldFor: agentId, until, account: info.limit?.accountId ?? null, model }),
              })
              yield* fact({
                projectId: current.projectId,
                aggregateType: 'node_attempt',
                aggregateId: attemptId,
                revision,
                type: 'node_attempt.held',
                payload: { reason: 'usage_limit', agentId, until },
                actorId: envelope.actorId,
              })
              return true
            }),
          )
          if (!held) return
          // The person's doing, so not one the home lists as the loop's.
          yield* addItem({ projectId: current.projectId, threadId: current.threadId }, 'notice', {
            source: 'runtime',
            severity: 'info',
            title: `The step waits until ${whenWords(until)}, when ${from} is back.`,
          })
          yield* touchCard(current.taskId)
          yield* Queue.offer(holdsChanged, undefined)
        })

      /**
       * Carries a step on that stopped: told what to do, handed to another
       * agent (on a model, where one is chosen), or abandoned; as the person
       * answered its call, or as Althar does when an agent is out of usage.
       */
      const carryOn = (
        current: RunRow,
        attemptId: string | null,
        info: StuckInfo,
        answer: Exclude<StuckAnswer, { readonly kind: 'wait' }>,
        envelope: CommandEnvelope,
        model?: string | null,
        /** Why it carries on so, where Althar says: in place of the thread's own line for a switch. */
        said?: string,
        /** How hard the agent it is handed to thinks, where the person picked. */
        effort?: string | null,
      ) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [attempt] =
            attemptId === null
              ? []
              : yield* sql<{
                  id: string
                  nodeId: string
                  state: string
                }>`SELECT id, node_id, state FROM node_attempts WHERE id = ${attemptId}`
          // The account and model the person picked, where they did; a model Althar chose comes first.
          const accountId = answer.kind === 'retry' ? answer.accountId : undefined
          const on = model ?? (answer.kind === 'retry' ? answer.model : undefined)
          /** The waiting attempt runs again, reminded afresh; whether it does, its run not stopped meanwhile. */
          const resume = (sessionId: string) =>
            attempt === undefined ? Effect.succeed(true) : begin(current, attempt.id, sessionId, current.threadId, true)
          const endAttempt = (state: 'failed' | 'cancelled', output: unknown) =>
            attempt === undefined
              ? Effect.void
              : sql.withTransaction(
                  Effect.gen(function* () {
                    const at = yield* timestamp
                    // One held for a limit and handed on ends with its hold.
                    const revision = yield* change('node_attempts', attempt.id, {
                      state,
                      holdReason: null,
                      output: JSON.stringify(output),
                      endedAt: at,
                    })
                    yield* change('nodes', attempt.nodeId, { state })
                    yield* fact({
                      projectId: current.projectId,
                      aggregateType: 'node_attempt',
                      aggregateId: attempt.id,
                      revision,
                      type: `node_attempt.${state}`,
                      payload: output,
                      actorId: envelope.actorId,
                    })
                  }),
                )
          if (info.step === 'publish') {
            // Gone on without its ending, the task is ready on its branch; otherwise Althar tries again.
            if (answer.kind === 'abandon') {
              yield* endAttempt('cancelled', { skipped: true })
              return yield* finish(current, 'succeeded')
            }
            yield* endAttempt('failed', { again: true })
            return yield* conclude(current)
          }
          if (info.step === 'review') {
            if (answer.kind === 'abandon') {
              // Gone on without the review, the task is ready, with what was found left open.
              yield* endAttempt('cancelled', { skipped: true })
              return yield* conclude(current)
            }
            yield* endAttempt('failed', { handedTo: answer.kind === 'retry' ? answer.agentId : info.agentId })
            // A review starts on its own thread, so why it moved is said in the task's.
            if (said !== undefined) yield* sayOut(current.threadId, current.projectId, said)
            const [last] = yield* sql<{ summary: string }>`
              SELECT json_extract(content, '$.summary') AS summary FROM thread_items
              WHERE thread_id = ${current.threadId} AND kind = 'step_result' AND json_extract(content, '$.step') = 'settle'
              ORDER BY sequence DESC LIMIT 1`
            const round = yield* review(
              current,
              info.round,
              // A round after the first reads what the lead settled before it.
              info.round > 0 ? last?.summary : undefined,
              answer.kind === 'retry' ? answer.agentId : undefined,
              on,
              accountId,
              // As the person said: a place of its own, not the lead's.
              yield* lastLead(current),
            )
            if (answer.kind === 'tell') {
              const [thread] = yield* sql<{
                id: string
              }>`SELECT id FROM threads WHERE task_id = ${current.taskId} AND kind = 'step' AND node_key = 'review'`
              if (thread !== undefined && round !== undefined)
                yield* sessions.send({ envelope: envelope, threadId: thread.id, body: answer.note })
            }
            return
          }
          if (answer.kind === 'abandon') {
            // Given up, a round of work after the plan leaves the task where it was before it (ADR-034); what it committed stays.
            const round = info.step === 'implement' ? yield* roundStartOf(current) : undefined
            if (round !== undefined) {
              yield* endAttempt('cancelled', { abandoned: true })
              yield* sql.withTransaction(backWhereItWas(current, round.round, 'abandoned'))
              yield* Effect.ignore(changes.settleIfMerged(current.taskId))
              return yield* touchCard(current.taskId)
            }
            yield* endAttempt('cancelled', { abandoned: true })
            return yield* finish(current, 'cancelled')
          }
          // The lead's step: its agent (or the one picked) on the task's thread, told again what the step is.
          const sessionId = yield* leadOn(current, answer.kind === 'retry' ? answer.agentId : undefined, on, said, effort, accountId)
          if (!(yield* resume(sessionId))) return
          if (answer.kind === 'tell') yield* sessions.send({ envelope: envelope, threadId: current.threadId, body: answer.note })
          else
            yield* sessions.send({
              envelope: envelope,
              threadId: current.threadId,
              body:
                info.step === 'settle'
                  ? settling(yield* openToSettle(current))
                  : current.planId === null && info.step === 'implement'
                    ? "Carry on with the task from where it stands: what the person asked you last. When it's done, call Althar's finish_step tool with your summary."
                    : "Carry on with the task from where it stands. When it's done, call Althar's finish_step tool with your summary.",
              quiet: true,
            })
          yield* touchCard(current.taskId)
        })

      /** Who leads the task's thread: the last agent on it, on its model and effort, else the plan's lead. */
      const lastLead = (run: RunRow) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [last] = yield* sql<{ agentId: string; model: string | null; effort: string | null }>`
            SELECT agent_id, model, effort FROM provider_sessions WHERE thread_id = ${run.threadId} ORDER BY started_at DESC, rowid DESC LIMIT 1`
          if (last !== undefined) return last satisfies Lead
          const { implement } = yield* stepsOf(run)
          return { agentId: implement?.agentId ?? 'claude-code', model: implement?.model ?? null, effort: implement?.effort ?? null }
        })

      /**
       * Carries on a run its task's stop suspended (docs/architecture/05,
       * "Task and run lifecycle"): it runs again, on an attempt of its own,
       * from the step stopping cut short. The lead's step runs again on the
       * lead given, or its last, told to carry on (or to settle what is still
       * open); a review starts its round again on its reviewer; publishing is
       * tried again. Stopped between two steps, the lead carries its own on.
       * What the person said meanwhile waits in the lead's thread: beside a
       * review or publishing the lead starts too, so it is read now.
       */
      /**
       * Tells an answer to a question whose agent has gone since it asked
       * (DEV-13): queued for the thread, quietly, and read by the agent on it,
       * or by one started for it. A run's lead step that waited on the answer
       * carries on, its lead started as a stuck step's is when told what to do;
       * otherwise the agent last on the thread starts again.
       */
      const answered = (input: { readonly envelope: CommandEnvelope; readonly threadId: string; readonly body: string }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          // Queued first, so the agent that starts reads it in its first turn.
          yield* sessions.send({ envelope: input.envelope, threadId: input.threadId, body: input.body, quiet: true })
          if (Option.isSome(yield* sessions.running(input.threadId))) return
          const [step] = yield* sql<{ taskId: string; attemptId: string }>`
            SELECT r.task_id, a.id AS attempt_id FROM threads t
            JOIN runs r ON r.task_id = t.task_id AND r.state = 'running'
            JOIN workflow_executions e ON e.run_id = r.id
            JOIN nodes n ON n.execution_id = e.id AND n.node_key IN ('implement', 'settle')
            JOIN node_attempts a ON a.node_id = n.id AND a.state IN ('running', 'waiting_attention')
            WHERE t.id = ${input.threadId} AND t.kind = 'task'
            ORDER BY a.admitted_at DESC LIMIT 1`
          const current = step === undefined ? undefined : yield* currentRun(step.taskId)
          if (step !== undefined && current !== undefined) {
            const sessionId = yield* leadOn(current)
            yield* begin(current, step.attemptId, sessionId, current.threadId, true)
            return
          }
          yield* sessions.startLast(input.threadId)
        })

      /** The lead's step a resume carries on, on the lead given, told to carry on; a lead that can't start leaves it needing the person, as when a plan starts. */
      const resumeLead = (
        current: RunRow,
        attemptId: string,
        key: 'implement' | 'settle',
        iteration: number,
        lead: Lead,
        said: CommandEnvelope,
      ) =>
        Effect.gen(function* () {
          const info: StuckInfo = { step: key, why: 'restarted', detail: null, agentId: lead.agentId, round: iteration, open: 0 }
          const carried = yield* Effect.exit(
            carryOn(current, attemptId, info, { kind: 'retry', agentId: lead.agentId }, said, lead.model, undefined, lead.effort),
          )
          if (carried._tag === 'Failure')
            yield* stuck(current, { id: attemptId }, { ...info, why: 'failed_to_start', detail: summarize(carried.cause) || null })
        })

      const resume = (input: { readonly envelope: CommandEnvelope; readonly taskId: string; readonly lead?: Lead }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const resumed = yield* sql.withTransaction(
            Effect.gen(function* () {
              const [last] = yield* sql<{ id: string; projectId: ProjectId; state: RunState }>`
                SELECT id, project_id, state FROM runs WHERE task_id = ${input.taskId} ORDER BY created_at DESC LIMIT 1`
              if (last === undefined || last.state !== 'suspended') return false
              // Read where it is written: a task abandoned meanwhile stays as it is.
              const [task] = yield* sql<{ state: string }>`SELECT state FROM tasks WHERE id = ${input.taskId}`
              if (task?.state !== 'open' && task?.state !== 'draft') return false
              const state = yield* transition(runLifecycle, last.state, 'running')
              const at = yield* timestamp
              const [attempts] = yield* sql<{ n: number }>`SELECT max(attempt_number) AS n FROM run_attempts WHERE run_id = ${last.id}`
              // A new attempt at the run: the one stopping interrupted stays as it ended.
              yield* sql`INSERT INTO run_attempts ${sql.insert({
                id: yield* newId(Ids.runAttempt),
                projectId: last.projectId,
                runId: last.id,
                attemptNumber: (attempts?.n ?? 0) + 1,
                deviceId: instance.deviceId,
                controllerGeneration: 1,
                controllerInstanceId: instance.id,
                state: 'active',
                startedAt: at,
              })}`
              const revision = yield* change('runs', last.id, { state })
              yield* fact({
                projectId: last.projectId,
                aggregateType: 'run',
                aggregateId: last.id,
                revision,
                type: 'run.resumed',
                actorId: input.envelope.actorId,
                commandId: input.envelope.commandId,
              })
              return true
            }),
          )
          if (!resumed) return
          const current = yield* currentRun(input.taskId)
          if (current === undefined) return
          // An answer kept for a place when the task stopped is the lead's to read as it carries on, as anything said meanwhile.
          for (const kept of yield* keptAnswers(input.taskId)) {
            const told = yield* questions.tell(kept.id)
            if (!told.told)
              yield* sessions.send({
                envelope: yield* envelope('thread.send', { threadId: told.threadId, answered: kept.id }),
                threadId: told.threadId,
                body: told.body,
                quiet: true,
              })
          }
          const lead = input.lead ?? (yield* lastLead(current))
          // The run's latest attempt: the one stopping cut short, unless it stopped between two steps; with the agent it ran on,
          // where it started one, since a step handed to another agent keeps its node's first.
          const [latest] = yield* sql<{
            nodeKey: string
            iteration: number
            config: string
            input: string
            state: string
            stopped: number | null
            ranOn: string | null
            ranModel: string | null
          }>`
            SELECT n.node_key, n.iteration, n.config, a.input, a.state, json_extract(a.output, '$.stopped') AS stopped,
              s.agent_id AS ran_on, s.model AS ran_model
            FROM node_attempts a JOIN nodes n ON n.id = a.node_id LEFT JOIN provider_sessions s ON s.id = a.provider_session_id
            WHERE n.execution_id = ${current.executionId} ORDER BY a.admitted_at DESC, a.rowid DESC LIMIT 1`
          const cut = latest !== undefined && latest.state === 'cancelled' && latest.stopped === 1 ? latest : undefined
          const step = cut === undefined ? undefined : stepOf(cut.nodeKey)
          const config = JSON.parse(cut?.config ?? '{}') as { agentId?: string; model?: string | null }
          if (cut !== undefined && step === 'review') {
            // Its round again, on its reviewer, with what the lead settled before it, after the first: once it has a place.
            const settled = cut.iteration > 0 ? yield* settledBefore(current) : undefined
            const reviewer =
              cut.ranOn === null ? { agentId: config.agentId, model: config.model ?? null } : { agentId: cut.ranOn, model: cut.ranModel }
            yield* review(current, cut.iteration, settled, reviewer.agentId, reviewer.model, undefined, lead)
          } else if (cut !== undefined && step === 'publish') yield* conclude(current)
          else {
            // The lead's step: the one cut short, else the lead's latest, else Implement.
            const [own] =
              cut === undefined
                ? yield* sql<{ nodeKey: string; iteration: number; config: string; input: string }>`
                    SELECT n.node_key, n.iteration, n.config, a.input FROM node_attempts a JOIN nodes n ON n.id = a.node_id
                    WHERE n.execution_id = ${current.executionId} AND n.node_key IN ('implement', 'settle')
                    ORDER BY a.admitted_at DESC, a.rowid DESC LIMIT 1`
                : [cut]
            const { implement } = yield* stepsOf(current)
            const key = own?.nodeKey === 'settle' ? 'settle' : 'implement'
            const iteration = own?.iteration ?? 0
            // It takes a place among the agents at work on this machine, or waits for one.
            const admitted = yield* busy.enter(current.taskId, (room) =>
              sql.withTransaction(
                Effect.gen(function* () {
                  const admission = yield* admit(
                    current,
                    key,
                    iteration,
                    JSON.parse(own?.config ?? JSON.stringify(implement ?? {})),
                    JSON.parse(own?.input ?? '{}'),
                  )
                  if (!room) yield* waitForPlace(current, admission.attemptId, { how: 'resume', lead })
                  return { ...admission, room }
                }),
              ),
            )
            if (admitted.room) yield* resumeLead(current, admitted.attemptId, key, iteration, lead, input.envelope)
            return yield* touchCard(current.taskId)
          }
          // Beside a review or publishing, what the person said is read now: the lead starts for it.
          const [waiting] = yield* sql<{ id: string }>`
            SELECT i.id FROM user_inputs i JOIN actors a ON a.id = i.author_actor_id
            WHERE i.thread_id = ${current.threadId} AND i.state = 'queued' AND a.kind = 'person' LIMIT 1`
          if (waiting !== undefined && Option.isNone(yield* sessions.running(current.threadId)))
            yield* Effect.ignore(leadOn(current, lead.agentId, lead.model, undefined, lead.effort))
          yield* touchCard(current.taskId)
        })

      /**
       * Whether a restart stopped the step soon after the last one carried it
       * on: the last sign of life in the task's thread or its review's, the
       * line that said it carried on at least, came within RESTART_GRACE of
       * that line.
       */
      const restartedAgain = (current: RunRow, step: { readonly nodeId: string }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [carried] = yield* sql<{ createdAt: string }>`
            SELECT created_at FROM thread_items
            WHERE thread_id = ${current.threadId} AND kind = 'notice' AND json_extract(content, '$.restarted') = ${step.nodeId}
            ORDER BY sequence DESC LIMIT 1`
          if (carried === undefined) return false
          const grace = new Date(Date.parse(carried.createdAt) + Duration.toMillis(RESTART_GRACE)).toISOString()
          const [alive] = yield* sql<{ later: number }>`
            SELECT count(*) AS later FROM thread_items i JOIN threads t ON t.id = i.thread_id
            WHERE t.task_id = ${current.taskId} AND (t.kind = 'task' OR (t.kind = 'step' AND t.node_key = 'review'))
              AND i.created_at >= ${grace}`
          return alive?.later === 0
        })

      /** A step a restart stopped, to carry on once the launch is up. */
      interface Interrupted {
        readonly current: RunRow
        readonly attemptId: string
        readonly nodeId: string
        readonly nodeKey: string
        readonly iteration: number
        readonly ranOn: string | null
        readonly ranModel: string | null
      }

      /** A step waiting for a place: what carrying it on needs, as for one a restart stopped, and its node's step. */
      interface Placed extends Omit<Interrupted, 'current'> {
        readonly taskId: string
        readonly config: string
      }

      /**
       * A step running when Althar stopped carries on by itself, as the
       * person's resume would carry it on, and the thread says so in a line.
       * A lead that asked the person a question still waits on them. A step
       * carried on after a restart that stops with Althar again before its
       * agent has been at it for RESTART_GRACE (Althar crashing on it, say)
       * needs the person instead, so it doesn't start over forever. A step on
       * an agent takes a place among the agents at work on this machine like
       * any other (Busy.ts): each waits for one, in the order they were first
       * admitted, so those that were working go before what waited behind
       * them, and as many carry on at once as there are places. Publishing,
       * which is Althar's own, takes none and carries on at once.
       */
      const interrupted = yield* provide(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const left = yield* sql<{
            taskId: string
            nodeKey: string
            nodeId: string
            attemptId: string
            iteration: number
            ranOn: string | null
            ranModel: string | null
            admittedAt: string
            input: string
          }>`
            SELECT r.task_id, n.node_key, n.id AS node_id, a.id AS attempt_id, n.iteration, a.admitted_at, a.input,
              -- The agent it ran on, on its model; one not started yet, the plan's for the step (Althar's own, none).
              coalesce(s.agent_id, json_extract(n.config, '$.agentId')) AS ran_on,
              CASE WHEN s.id IS NULL THEN json_extract(n.config, '$.model') ELSE s.model END AS ran_model
            FROM runs r JOIN workflow_executions e ON e.run_id = r.id JOIN nodes n ON n.execution_id = e.id
            JOIN node_attempts a ON a.node_id = n.id LEFT JOIN provider_sessions s ON s.id = a.provider_session_id
            WHERE r.state = 'running' AND a.state IN ('admitted', 'running')`
          const carrying: Array<Interrupted> = []
          for (const step of left) {
            const current = yield* currentRun(step.taskId)
            if (current === undefined) continue
            // A lead that asked the person a question still waits on them: their answer carries the step on.
            if (step.nodeKey !== 'review' && (yield* asking(current.threadId))) {
              const revision = yield* change('node_attempts', step.attemptId, { state: 'waiting_attention' })
              yield* fact({
                projectId: current.projectId,
                aggregateType: 'node_attempt',
                aggregateId: step.attemptId,
                revision,
                type: 'node_attempt.waiting_attention',
                payload: { question: true },
                actorId: instance.systemId,
              })
              continue
            }
            // A round of work whose lead's last turn had completed as Althar stopped waited on the person: as that turn's end would
            // have, it ends where it made nothing new (ADR-034). One cut short by the stop is carried on, as any step.
            if (current.planId === null && step.nodeKey === 'implement') {
              const [turn] = yield* sql<{ state: string }>`
                SELECT state FROM turn_deliveries WHERE thread_id = ${current.threadId} ORDER BY requested_at DESC, rowid DESC LIMIT 1`
              if (
                turn?.state === 'completed' &&
                (yield* quietly(current, { id: step.attemptId, nodeId: step.nodeId, nodeKey: step.nodeKey, input: step.input }))
              )
                continue
            }
            if (yield* restartedAgain(current, step)) {
              yield* stuck(
                current,
                { id: step.attemptId },
                { step: stepOf(step.nodeKey), why: 'restarted', detail: null, agentId: step.ranOn, round: step.iteration, open: 0 },
              )
              continue
            }
            if (step.nodeKey === 'publish') carrying.push({ ...step, current })
            else yield* sql.withTransaction(waitForPlace(current, step.attemptId, { how: 'restart' }, step.admittedAt))
          }
          return carrying
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.as(Effect.logWarning('Could not mark the steps a restart stopped', cause), [] as ReadonlyArray<Interrupted>),
          ),
        ),
      )

      /**
       * Carries on a step a restart stopped, as the person's resume does: the
       * lead's step on the lead, its model and effort, told to carry on; a
       * review's round again on its reviewer; publishing tried again. An
       * agent out of usage goes the way a limit takes it, held or handed on;
       * a lead that can't start needs the person.
       */
      const carryOnAfterRestart = (step: Interrupted) =>
        Effect.gen(function* () {
          const { current } = step
          const kind = stepOf(step.nodeKey)
          // The lead's steps on the lead, as it last was; a review on its reviewer.
          const { agentId, model, effort } =
            kind === 'implement' || kind === 'settle'
              ? yield* lastLead(current)
              : { agentId: step.ranOn, model: step.ranModel, effort: null }
          const info: StuckInfo = { step: kind, why: 'restarted', detail: null, agentId, round: step.iteration, open: 0 }
          // Out of usage on what the project runs it on, it goes the way a limit takes it, with the account that is out.
          const out = agentId === null ? Option.none() : yield* limits.out(agentId, current.projectId)
          const carried = yield* Effect.exit(
            Option.isSome(out)
              ? outOfUsage(
                  { ...step, taskId: current.taskId, output: null, input: '{}', run: current, step: kind },
                  out.value.agentId,
                  out.value.accountId,
                )
              : Effect.gen(function* () {
                  // Said first, so a restart while it starts counts as one soon after.
                  yield* addItem({ projectId: current.projectId, threadId: current.threadId }, 'notice', {
                    source: 'runtime',
                    severity: 'info',
                    title: 'Althar restarted; the step carried on from here.',
                    restarted: step.nodeId,
                  })
                  const carrying = yield* envelope('thread.send', { threadId: current.threadId, restarted: step.attemptId })
                  yield* carryOn(
                    current,
                    step.attemptId,
                    info,
                    // Publishing, which is Althar's own, is tried again whoever is named.
                    { kind: 'retry', agentId: agentId ?? 'althar' },
                    carrying,
                    model,
                    undefined,
                    effort,
                  )
                }),
          )
          // A lead that can't start, or one handed on for a limit that can't, leaves its step needing the person, as when a plan starts.
          if (carried._tag === 'Failure')
            yield* stuck(current, { id: step.attemptId }, { ...info, why: 'failed_to_start', detail: summarize(carried.cause) || null })
        })

      /**
       * A step held for a usage limit runs again at the reset, on the agent,
       * account and model it was held for, once it has a place among the
       * agents at work on this machine; until then it waits for one.
       * `placed`, it waited for a place after its reset, and has one now.
       */
      const resumeHeld = (
        held: {
          readonly taskId: string
          readonly attemptId: string
          readonly nodeKey: string
          readonly iteration: number
          readonly agentId: string
          readonly accountId: string | null
          readonly model: string | null
        },
        placed = false,
      ) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const current = yield* currentRun(held.taskId)
          if (current === undefined) return
          const resumed = yield* busy.enter(
            held.taskId,
            (room) =>
              sql.withTransaction(
                Effect.gen(function* () {
                  // Stopped meanwhile, it waits for the person to resume it, not for the reset.
                  const [still] = yield* sql<{ state: string }>`SELECT state FROM node_attempts WHERE id = ${held.attemptId}`
                  if (still?.state !== (placed ? 'admitted' : 'held')) return false
                  if (!room) {
                    yield* waitForPlace(current, held.attemptId, {
                      how: 'reset',
                      agentId: held.agentId,
                      accountId: held.accountId,
                      model: held.model,
                    })
                    return false
                  }
                  const revision = yield* change('node_attempts', held.attemptId, { state: 'running', holdReason: null, output: null })
                  yield* fact({
                    projectId: current.projectId,
                    aggregateType: 'node_attempt',
                    aggregateId: held.attemptId,
                    revision,
                    type: 'node_attempt.resumed',
                    actorId: instance.systemId,
                  })
                  return true
                }),
              ),
            { review: held.nodeKey === 'review' },
          )
          if (!resumed) return yield* touchCard(held.taskId)
          const info: StuckInfo = {
            step: stepOf(held.nodeKey),
            why: 'usage_limit',
            detail: null,
            agentId: held.agentId,
            round: held.iteration,
            open: 0,
          }
          const resuming = yield* envelope('thread.send', { threadId: current.threadId, resumed: held.attemptId })
          yield* carryOn(
            current,
            held.attemptId,
            info,
            {
              kind: 'retry',
              agentId: held.agentId,
              ...(held.accountId === null ? {} : { accountId: held.accountId }),
              ...(held.model === null ? {} : { model: held.model }),
            },
            resuming,
          )
        })

      /** A message that waited for an agent's reset goes to it then: to its session, or, after a restart, to one started for it. */
      const deliverWaiting = (waiting: { readonly threadId: string; readonly agentId: string }) =>
        Effect.gen(function* () {
          const live = yield* sessions.running(waiting.threadId)
          if (Option.isNone(live)) return void (yield* sessions.start({ threadId: waiting.threadId, agentId: waiting.agentId }))
          // Another agent the person picked since has the message already.
          if (live.value.agentId === waiting.agentId) yield* sessions.wake(waiting.threadId)
        })

      /* The turns whose waiting message was given back this launch, so one that fails again waits for its own reset. */
      const given = new Set<string>()

      /*
       * What waits for a usage limit to reset runs again then, the soonest
       * first, or sooner if something new waits; after a restart too. A step
       * held for it, and what the person said to the coordinator or a lead
       * outside a step.
       */
      const holds = Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        for (;;) {
          const held = yield* sql<{ taskId: string; attemptId: string; nodeKey: string; iteration: number; output: string }>`
            SELECT r.task_id, a.id AS attempt_id, n.node_key, n.iteration, a.output
            FROM runs r JOIN workflow_executions e ON e.run_id = r.id JOIN nodes n ON n.execution_id = e.id
            JOIN node_attempts a ON a.node_id = n.id
            WHERE r.state = 'running' AND a.state = 'held' AND a.hold_reason = 'usage_limit'`
          // A message waits where the thread's last turn reached the limit, outside a step, and the person's input is queued.
          const messages = yield* sql<{ threadId: string; turnId: string; agentId: string; accountId: string | null }>`
            SELECT t.id AS thread_id, d.id AS turn_id, s.agent_id, s.account_id FROM threads t
            JOIN turn_deliveries d ON d.id = (SELECT id FROM turn_deliveries WHERE thread_id = t.id ORDER BY requested_at DESC LIMIT 1)
            JOIN provider_sessions s ON s.id = d.provider_session_id
            WHERE t.kind IN ('coordinator', 'task') AND d.error_class = 'usage_limit'
              AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.task_id = t.task_id AND r.state IN ('running', 'suspended'))
              AND NOT EXISTS (SELECT 1 FROM tasks k WHERE k.id = t.task_id AND k.state IN ('done', 'abandoned'))
              AND EXISTS (SELECT 1 FROM user_inputs i JOIN actors a ON a.id = i.author_actor_id
                WHERE i.thread_id = t.id AND i.state = 'queued' AND a.kind = 'person')`
          const due: Array<{ readonly at: number; readonly run: Effect.Effect<void, unknown, Store> }> = held.map((step) => {
            // Held before Althar kept the account and model, it carries on as the agent picks.
            const { heldFor, until, account, model } = JSON.parse(step.output) as {
              heldFor: string
              until: string
              account?: string | null
              model?: string | null
            }
            return {
              at: Date.parse(until),
              run: resumeHeld({ ...step, agentId: heldFor, accountId: account ?? null, model: model ?? null }),
            }
          })
          for (const message of messages) {
            if (given.has(message.turnId)) continue
            const out = yield* message.accountId === null ? limits.out(message.agentId) : limits.outAccount(message.accountId)
            due.push({
              at: Option.isSome(out) ? Date.parse(out.value.until) : 0,
              run: Effect.andThen(
                Effect.sync(() => given.add(message.turnId)),
                deliverWaiting(message),
              ),
            })
          }
          const next = due.toSorted((a, b) => a.at - b.at)[0]
          if (next === undefined) {
            yield* Queue.take(holdsChanged)
            continue
          }
          const wait = next.at - Date.now()
          if (wait > 0) {
            yield* Effect.raceFirst(Queue.take(holdsChanged), Effect.sleep(Duration.millis(wait)))
            continue
          }
          yield* next.run.pipe(Effect.catchCause((cause) => Effect.logWarning('What waited for a usage limit could not go on', cause)))
        }
      })
      yield* Effect.forkScoped(provide(holds))

      // What the person says to a task's lead after its plan opens a round of work, as the turn begins (ADR-034); Althar's own words don't.
      yield* sessions.onPersonsTurn((lead) =>
        provide(Effect.asVoid(openRound(lead.taskId, lead.sessionId))).pipe(
          Effect.catchCause((cause) => Effect.logWarning('Could not open a round of work for the person’s turn', cause)),
        ),
      )

      // Each turn a step's agent ends, and each session that goes, is checked for the report its step needs.
      const events = yield* live.subscribe
      yield* Effect.forkScoped(
        Stream.runForEach(events, (event) =>
          provide(watch(event)).pipe(
            Effect.catchCause((cause) =>
              Cause.hasInterruptsOnly(cause) ? Effect.interrupt : Effect.logWarning('Could not check a step after its turn', cause),
            ),
          ),
        ),
      )

      /** A step's agent stalled, went round in circles or ran past its budget, beyond what Althar could do: the step needs the person. */
      const stalledStep = (giveUp: GiveUp) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const on = yield* stepOn(giveUp.threadId)
          if (on === undefined) return false
          const [agent] = yield* sql<{ agentId: string }>`
            SELECT agent_id FROM provider_sessions WHERE thread_id = ${giveUp.threadId} ORDER BY started_at DESC LIMIT 1`
          yield* stuck(
            on.run,
            { id: on.attemptId },
            {
              step: on.step,
              why: giveUp.why,
              detail: giveUp.detail,
              agentId: agent?.agentId ?? null,
              round: on.iteration,
              open: 0,
              ...(giveUp.tried.length === 0 ? {} : { tried: giveUp.tried }),
            },
          )
          return true
        }).pipe(Effect.catchCause((cause) => Effect.as(Effect.logWarning('Could not ask the person about a stalled step', cause), false)))
      const stalls = yield* watchStalls((giveUp) => provide(stalledStep(giveUp)))
      freshen = (threadId) => stalls.fresh(threadId)

      /**
       * Starts a step that waited for a place, now it has one, as it would
       * have started: a plan's first on its lead; one a restart stopped as
       * after a restart; one the person resumed on the lead they gave, or its
       * reviewer; one back from a usage limit on the agent it was held for.
       */
      const startPlaced = (row: Placed, waited: Waiting) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const current = yield* currentRun(row.taskId)
          if (current === undefined) return
          // Its place taken in the store, read where it is written: stopped since it was listed, it is the person's to resume.
          // Admitted from here on, a restart carries it on as any step a restart stopped, and needs the person where it
          // stopped Althar again soon after.
          const taken = yield* sql.withTransaction(
            Effect.gen(function* () {
              const [still] = yield* sql<{ state: string; holdReason: string | null }>`
                SELECT state, hold_reason FROM node_attempts WHERE id = ${row.attemptId}`
              if (still?.state !== 'held' || still.holdReason !== 'machine_busy') return false
              const revision = yield* change('node_attempts', row.attemptId, { state: 'admitted', holdReason: null, output: null })
              yield* fact({
                projectId: current.projectId,
                aggregateType: 'node_attempt',
                aggregateId: row.attemptId,
                revision,
                type: 'node_attempt.admitted',
                payload: { node: row.nodeKey, iteration: row.iteration, placed: waited.place.how },
                actorId: instance.systemId,
              })
              return true
            }),
          )
          if (!taken) return
          const { place } = waited
          switch (place.how) {
            case 'start':
              return yield* startFirst(current, row.attemptId)
            case 'restart':
              return yield* carryOnAfterRestart({ ...row, current })
            case 'resume': {
              if (row.nodeKey === 'review') {
                const step = place.reviewer ?? (JSON.parse(row.config) as PlanStep)
                yield* reviewOn(current, row.iteration, row.iteration > 0 ? yield* settledBefore(current) : undefined, step, row.attemptId)
              } else {
                const said = yield* envelope('thread.send', { threadId: current.threadId, placed: row.attemptId })
                const key = row.nodeKey === 'settle' ? 'settle' : 'implement'
                yield* resumeLead(current, row.attemptId, key, row.iteration, place.lead, said)
              }
              return yield* touchCard(current.taskId)
            }
            case 'reset':
              return yield* resumeHeld({ ...row, agentId: place.agentId, accountId: place.accountId, model: place.model }, true)
            case 'answered':
              return yield* carryOn(
                current,
                row.attemptId,
                place.info,
                place.answer,
                yield* envelope('thread.send', { placed: row.attemptId }),
              )
            case 'next': {
              if (row.nodeKey === 'review') {
                const step = place.reviewer ?? (JSON.parse(row.config) as PlanStep)
                yield* reviewOn(current, row.iteration, row.iteration > 0 ? yield* settledBefore(current) : undefined, step, row.attemptId)
              } else yield* settleOn(current, row.iteration, row.attemptId, yield* openToSettle(current))
              return yield* touchCard(current.taskId)
            }
          }
        })

      /** Every step that waits for a place, with since when and how it starts once it has one. */
      const placed = Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const at = yield* timestamp
        const rows = yield* sql<Placed & { output: string | null }>`
          SELECT r.task_id, n.node_key, n.id AS node_id, n.config, a.id AS attempt_id, n.iteration, a.output,
            coalesce(s.agent_id, json_extract(n.config, '$.agentId')) AS ran_on,
            CASE WHEN s.id IS NULL THEN json_extract(n.config, '$.model') ELSE s.model END AS ran_model
          FROM runs r JOIN workflow_executions e ON e.run_id = r.id JOIN nodes n ON n.execution_id = e.id
          JOIN node_attempts a ON a.node_id = n.id LEFT JOIN provider_sessions s ON s.id = a.provider_session_id
          JOIN tasks k ON k.id = r.task_id JOIN projects p ON p.id = r.project_id
          WHERE r.state = 'running' AND a.state = 'held' AND a.hold_reason = 'machine_busy'
            AND k.state IN ('draft', 'open') AND p.archived_at IS NULL`
        return rows.map((row) => {
          const waited = waitingOf(row.output, at)
          return { taskId: row.taskId, review: row.nodeKey === 'review', since: waited.since, start: provide(startPlaced(row, waited)) }
        })
      })
      yield* busy.queue(provide(placed))

      /**
       * Every answer kept while there was no place for its agent to carry on,
       * with since when: told once there is one, to the agent waiting on it,
       * or, gone, as an answer to a question whose agent went is (`answered`).
       * Not while its task is stopped: resuming it tells them.
       */
      const answersWaiting = Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{ id: string; taskId: string; kind: string; since: string }>`
          SELECT q.id, q.task_id, t.kind, json_extract(q.payload, '$.waitsForPlace') AS since
          FROM attention_requests q JOIN threads t ON t.id = json_extract(q.payload, '$.threadId')
          JOIN tasks k ON k.id = q.task_id JOIN projects p ON p.id = q.project_id
          WHERE q.kind = 'question' AND q.state = 'answered' AND json_extract(q.payload, '$.waitsForPlace') IS NOT NULL
            AND k.state IN ('draft', 'open') AND p.archived_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.task_id = q.task_id AND r.state = 'suspended'
              AND r.created_at = (SELECT max(created_at) FROM runs WHERE task_id = q.task_id))`
        return rows.map((row) => ({
          taskId: row.taskId,
          review: row.kind === 'step',
          since: row.since,
          start: provide(
            Effect.gen(function* () {
              const told = yield* questions.tell(row.id)
              if (told.told) return
              yield* answered({
                envelope: yield* envelope('thread.send', { threadId: told.threadId, answered: row.id }),
                threadId: told.threadId,
                body: told.body,
              })
            }),
          ),
        }))
      })
      yield* busy.queue(provide(answersWaiting))

      // The steps a restart stopped carry on now the launch is up, a few at a time so their agents don't all start at once.
      yield* Effect.forkScoped(
        provide(
          Effect.forEach(
            interrupted,
            (step) =>
              carryOnAfterRestart(step).pipe(
                Effect.catchCause((cause) =>
                  Cause.hasInterruptsOnly(cause)
                    ? Effect.interrupt
                    : Effect.logWarning('Could not carry on a step a restart stopped', cause),
                ),
              ),
            { concurrency: 3, discard: true },
          ),
        ),
      )

      const skipReview = (input: { readonly envelope: CommandEnvelope; readonly taskId: string }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const current = yield* currentRun(input.taskId)
          if (current === undefined) return
          const parameters = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(PlanParameters))(current.parameters)
          if (!parameters.steps.some((step) => step.key === 'review' && !step.skipped)) return
          const skipped = {
            ...parameters,
            steps: parameters.steps.map((step) => (step.key === 'review' ? { ...step, skipped: true } : step)),
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
              return reviews.length > 0 || called !== undefined
            }),
          )
          if (stopped === undefined) return
          if (stopped) {
            const [thread] = yield* sql<{
              id: string
            }>`SELECT id FROM threads WHERE task_id = ${input.taskId} AND kind = 'step' AND node_key = 'review'`
            if (thread !== undefined) yield* Effect.ignore(sessions.stop(thread.id))
            yield* conclude(current)
          }
          yield* touchCard(input.taskId)
        })

      return Runs.of({
        run: (planId) => provide(run(planId)),
        skipReview: (input) => provide(skipReview(input)),
        workflowVersion: provide(workflowVersion),
        publish: (taskId) => provide(publish(taskId)),
        answerStuck: (input) => provide(answerStuck(input)),
        resume: (input) => provide(resume(input)),
        answered: (input) => provide(answered(input)),
        planWaits,
        changeWaiting: (taskId, parameters, actorId) =>
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient
            if (!(yield* planWaits(taskId))) return false
            const current = yield* currentRun(taskId)
            if (current === undefined) return false
            const revision = yield* change('runs', current.runId, { parameters })
            yield* fact({
              projectId: current.projectId,
              aggregateType: 'run',
              aggregateId: current.runId,
              revision,
              type: 'run.plan_changed',
              actorId,
            })
            // Its first step starts on the lead the plan now names, as admitted.
            const steps = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(PlanParameters))(parameters)
            const implement = steps.steps.find((step) => step.key === 'implement')
            if (implement !== undefined)
              yield* sql`UPDATE nodes SET config = ${JSON.stringify(implement)} WHERE execution_id = ${current.executionId} AND node_key = 'implement'`
            return true
          }),
        answer: (input) =>
          provide(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient
              const [on] = yield* sql<{ taskId: string | null; kind: string | null }>`
                SELECT q.task_id, t.kind FROM attention_requests q LEFT JOIN threads t ON t.id = json_extract(q.payload, '$.threadId')
                WHERE q.id = ${input.attentionId}`
              const onward = (told: Answered) =>
                told.told
                  ? Effect.void
                  : provide(
                      Effect.gen(function* () {
                        yield* answered({
                          envelope: yield* envelope('thread.send', { threadId: told.threadId, answered: input.attentionId }),
                          threadId: told.threadId,
                          body: told.body,
                        })
                      }),
                    )
              const answering = (keep: boolean) => questions.answer({ ...input, keep })
              if (on?.taskId == null) return yield* Effect.flatMap(answering(false), onward)
              yield* busy.enter(on.taskId, (room) => answering(!room), { review: on.kind === 'step', next: onward })
            }),
          ),
      })
    }),
  )
}
