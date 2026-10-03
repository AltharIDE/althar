import { createHash } from 'node:crypto'

import { type CommandEnvelope, Ids, newId, type ProjectId } from '@charrette/domain'
import type { Ledger } from '@charrette/persistence-sqlite'
import { Cause, Context, type Crypto, Duration, Effect, Layer, Option, Queue, Schema, Stream } from 'effect'
import { SqlClient } from 'effect/sql'

import { touchCard } from './cards'
import { Changes, type Published } from './Changes'
import { NotConnected } from './Connections'
import { AttentionClosed, NoChangeToOpen, NotFound } from './errors'
import { Instance } from './Instance'
import { Limits, outWords } from './Limits'
import { Live, type LiveEvent } from './Live'
import { Policies, usageLimitOf } from './Policies'
import { treeOf, uncommittedFiles } from './git'
import { filesLine } from './pullRequestWords'
import { snapshotForReview } from './reviewCopy'
import { change, fact, timestamp } from './records'
import { envelope } from './envelope'
import { Sessions } from './Sessions'
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
 * A step ends when its agent says so through Charrette's tools: the lead's
 * finish_step, the reviewer's report_review. What each reported goes into the
 * task's thread as a step result, which the person reads instead of the work.
 */

/** Review rounds before a task is left ready with findings still open. */
export const ROUNDS = 3

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
    Effect.mapError((error) => new ToolRefused({ message: `Charrette couldn't read that: ${error.message}` })),
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
}

type Store = SqlClient.SqlClient | Instance | Sessions | ToolServer | Crypto.Crypto | Ledger | Live | Changes | Limits | Policies

/** Why a step needs the person (docs/architecture/05): its agent didn't report after a reminder, went, couldn't start, or a restart stopped it; or review ran out of rounds. */
export type StuckWhy = 'no_report' | 'session_ended' | 'failed_to_start' | 'restarted' | 'round_limit' | 'not_connected' | 'usage_limit'

/** What a stuck step's call says: the step, why, what went wrong in words, who was on it, the round, and the findings still open. */
export interface StuckInfo {
  readonly step: 'implement' | 'review' | 'settle' | 'publish'
  readonly why: StuckWhy
  readonly detail: string | null
  readonly agentId: string | null
  readonly round: number
  readonly open: number
}

/** The person's answer: tell the step's agent what to do, hand the step to an agent, or abandon it (a review is gone on without). */
export type StuckAnswer =
  | { readonly kind: 'tell'; readonly note: string }
  | { readonly kind: 'retry'; readonly agentId: string }
  | { readonly kind: 'abandon' }

export class Runs extends Context.Service<
  Runs,
  {
    /** Runs an accepted plan: its task opens, and its steps run in order. */
    run(planId: string): Effect.Effect<void, unknown>
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
  }
>()('@charrette/runtime/Runs') {
  static readonly layer: Layer.Layer<Runs, never, Store> = Layer.effect(
    Runs,
    Effect.gen(function* () {
      const context = yield* Effect.context<Store>()
      const instance = yield* Instance
      const sessions = yield* Sessions
      const toolServer = yield* ToolServer
      const live = yield* Live
      const changes = yield* Changes
      const limits = yield* Limits
      const policies = yield* Policies
      const scope = yield* Effect.scope
      // Asked when a step is held for a reset, so the wait for it starts again.
      const holdsChanged = yield* Queue.sliding<void>(1)
      const provide = <A, E>(effect: Effect.Effect<A, E, Store>) => Effect.provideContext(effect, context)

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
            SELECT r.id AS run_id, a.id AS run_attempt_id, e.id AS execution_id, r.project_id, r.task_id, t.id AS thread_id, r.parameters
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
              // What Charrette does itself, outside, is an integration node; the rest is an agent's.
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

      /** An attempt now runs in a session. */
      const started = (run: RunRow, attemptId: string, sessionId: string) =>
        Effect.gen(function* () {
          const revision = yield* change('node_attempts', attemptId, {
            state: 'running',
            holdReason: null,
            providerSessionId: sessionId,
            startedAt: yield* timestamp,
          })
          yield* fact({
            projectId: run.projectId,
            aggregateType: 'node_attempt',
            aggregateId: attemptId,
            revision,
            type: 'node_attempt.running',
            actorId: instance.systemId,
          })
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
      const result = (run: Pick<RunRow, 'projectId' | 'threadId'>, content: Readonly<Record<string, unknown>>) =>
        addItem({ projectId: run.projectId, threadId: run.threadId }, 'step_result', content)

      /** The run is over: the task is ready for the person, or stopped. */
      const finish = (run: RunRow, state: 'succeeded' | 'failed' | 'cancelled') =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          yield* sql.withTransaction(
            Effect.gen(function* () {
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
            }),
          )
          yield* touchCard(run.taskId)
        })

      /** What a step that Charrette does itself reported, in a line. */
      const publishedSummary = (published: Published, end: TaskEnd) => {
        const did = ((): string => {
          switch (published.kind) {
            case 'opened': {
              const noun = published.change.words.noun
              const name = `${noun} ${published.change.words.prefix}${published.change.number}`
              return end === 'ready' || !published.change.draft ? `Opened ${name} for review.` : `Opened draft ${name}.`
            }
            case 'pushed':
              return `Pushed ${published.branch}.`
            case 'nothing':
              return 'The branch has no commits to propose, so nothing was pushed.'
          }
        })()
        return published.left.length === 0 ? did : `${did} Left out what the lead didn't commit: ${filesLine(published.left)}.`
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
                  description: "Its repository isn't on a code host Charrette knows, so nothing was pushed.",
                }
              : {
                  title: `The task ends on its branch: ${host.name} isn't connected.`,
                  description: `Nothing was pushed. Connect ${host.name} from the project, then open the pull request from here.`,
                }),
          })
        })

      // One action on the task's pull request: two quick clicks open one, and the second hears it has one.
      const publish = (taskId: string) =>
        changes.exclusive(
          taskId,
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient
            const [task] = yield* sql<{ state: string }>`SELECT state FROM tasks WHERE id = ${taskId}`
            if (task === undefined) return yield* new NotFound({ kind: 'task', id: taskId })
            // A settled task's branch stays as it is.
            if (task.state === 'done' || task.state === 'abandoned') return yield* new NoChangeToOpen({ taskId, why: 'settled' })
            const [last] = yield* sql<{ runId: string; projectId: ProjectId; threadId: string; state: string }>`
            SELECT r.id AS run_id, r.project_id, t.id AS thread_id, r.state FROM runs r
            JOIN threads t ON t.task_id = r.task_id AND t.kind = 'task'
            WHERE r.task_id = ${taskId} ORDER BY r.created_at DESC LIMIT 1`
            if (last === undefined || !['succeeded', 'failed', 'cancelled'].includes(last.state))
              return yield* new NoChangeToOpen({ taskId, why: 'working' })
            if (last.state !== 'succeeded') return yield* new NoChangeToOpen({ taskId, why: 'stopped' })
            if ((yield* changes.ofTask(taskId)).length > 0) return yield* new NoChangeToOpen({ taskId, why: 'opened' })
            const published = yield* changes.publish({ projectId: last.projectId, taskId, runId: last.runId, end: 'draft' })
            yield* result(
              { projectId: last.projectId, threadId: last.threadId },
              {
                step: 'publish',
                round: 0,
                summary: publishedSummary(published, 'draft'),
                ...(published.kind === 'opened' ? { change: published.change } : {}),
              },
            )
            yield* touchCard(taskId)
          }),
        )

      /**
       * The work is done: the task's ending, if its plan has one, then the
       * run is over and the task ready. Pushing and opening its pull request
       * is Charrette's own step; if it can't, the person decides.
       */
      const conclude = (run: RunRow) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          // A plan made while the repository's host wasn't connected opens its pull request if it is by now.
          const end = (yield* stepsOf(run)).end ?? (yield* changes.endFor(run.projectId))
          if (end === null) {
            yield* onBranch(run)
            return yield* finish(run, 'succeeded')
          }
          const { nodeId, attemptId } = yield* sql.withTransaction(admit(run, 'publish', 0, { end }))
          yield* sql.withTransaction(
            Effect.gen(function* () {
              const revision = yield* change('node_attempts', attemptId, { state: 'running', startedAt: yield* timestamp })
              yield* fact({
                projectId: run.projectId,
                aggregateType: 'node_attempt',
                aggregateId: attemptId,
                revision,
                type: 'node_attempt.running',
                actorId: instance.systemId,
              })
            }),
          )
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
              yield* ended(run, { id: attemptId, nodeId }, 'succeeded', published.value)
              yield* unstuck(run)
              yield* result(run, {
                step: 'publish',
                round: 0,
                summary: publishedSummary(published.value, end),
                ...(published.value.kind === 'opened' ? { change: published.value.change } : {}),
              })
            }),
          )
          yield* finish(run, 'succeeded')
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
              if (attempt !== null) {
                const revision = yield* change('node_attempts', attempt.id, { state: 'waiting_attention' })
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

      /** Review findings of the run the lead hasn't settled. */
      const openFindings = (run: RunRow) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          return yield* sql<{ id: string; severity: Finding['severity']; location: string; claim: string }>`
            SELECT f.id, f.severity, f.location, f.claim FROM findings f JOIN node_attempts a ON a.id = f.review_attempt_id
            JOIN nodes n ON n.id = a.node_id WHERE n.execution_id = ${run.executionId} AND f.state = 'open' ORDER BY f.created_at`
        })

      /** The step waiting on a thread's agent: the lead's (Implement, settling) on the task's thread, or the review on its own. */
      const stepOn = (threadId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [row] = yield* sql<{ taskId: string; nodeKey: string; attemptId: string; output: string | null; iteration: number }>`
            SELECT r.task_id, n.node_key, a.id AS attempt_id, a.output, n.iteration
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
        lead: "Your step isn't done until you call Charrette's finish_step tool. If you have done it, call finish_step now with your summary. If you can't go on without the person, call it saying what you need from them.",
        reviewer:
          "Your review isn't done until you call Charrette's report_review tool. Call it now with your verdict, a summary and your findings.",
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
          if (event._tag === 'TurnEnded' && event.state === 'interrupted') return
          const on = yield* stepOn(event.threadId)
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
          const reminded = (JSON.parse(on.output ?? '{}') as { reminded?: boolean }).reminded === true
          if (reminded) return yield* stuck(on.run, { id: on.attemptId }, info('no_report', event.errorClass ?? null))
          yield* change('node_attempts', on.attemptId, { output: JSON.stringify({ reminded: true }) })
          yield* sessions
            .send({
              envelope: yield* envelope('thread.send', { threadId: event.threadId, reminder: on.attemptId }),
              threadId: event.threadId,
              body: on.step === 'review' ? reminders.reviewer : reminders.lead,
              quiet: true,
            })
            .pipe(Effect.catchCause((cause) => stuck(on.run, { id: on.attemptId }, info('no_report', summarize(cause) || null))))
        })

      /**
       * Starts, or carries on, a round of review, on the plan's reviewer or
       * another the person picked. The reviewer's thread spans the rounds. A
       * reviewer that can't start leaves the step needing the person.
       */
      const review = (run: RunRow, round: number, settled?: string, reviewer?: string, model?: string | null) =>
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
          const { nodeId, attemptId } = yield* sql.withTransaction(admit(run, 'review', round, step))
          const begun = yield* Effect.exit(reviewRound(run, round, settled, step, attemptId))
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
          return { nodeId, attemptId }
        })

      /** A round of review's copy, thread and session: its reviewer reads the work as it stands. */
      const reviewRound = (run: RunRow, round: number, settled: string | undefined, step: PlanStep, attemptId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          // The round reads a copy of the work as it stands now, and the record keeps which code that was (ADR-008).
          const [workspace] = yield* sql<{ id: string; path: string }>`
            SELECT id, path FROM workspaces WHERE task_id = ${run.taskId} AND device_id = ${instance.deviceId}`
          if (workspace !== undefined) {
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
          // Handed to another agent, the round starts that one afresh.
          const running = yield* sessions.running(threadId)
          // Handed to another agent, or its account out of usage, the round starts afresh, on another account where it is.
          const spent = Option.isSome(running) && Option.isSome(yield* limits.outAccount(running.value.accountId))
          if (Option.isSome(running) && (spent || running.value.agentId !== step.agentId)) yield* Effect.ignore(sessions.stop(threadId))
          const live = Option.filter(running, (session) => !spent && session.agentId === step.agentId)
          const sessionId = Option.isSome(live)
            ? live.value.sessionId
            : yield* sessions.start({
                threadId,
                agentId: step.agentId,
                ...(step.model === null ? {} : { model: step.model }),
                ...(step.effort == null ? {} : { effort: step.effort }),
              })
          if (Option.isSome(live) || round > 0)
            yield* sessions.send({
              envelope: yield* envelope('thread.send', { threadId, round }),
              threadId,
              body: `Round ${round + 1}. The lead settled your findings:\n\n${settled ?? ''}\n\nYour copy now holds the settled work. Review the change again. Check that the fixes hold, and don't raise again what the lead set aside unless you have new evidence; then say which finding you repeat, and why.`,
              quiet: true,
            })
          yield* sql.withTransaction(started(run, attemptId, sessionId))
          yield* touchCard(run.taskId)
        })

      /** The lead settles what the review found, in its own session. */
      const settle = (run: RunRow, round: number, findings: ReadonlyArray<Finding & { readonly id: string }>) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [workspace] = yield* sql<{ path: string }>`
            SELECT path FROM workspaces WHERE task_id = ${run.taskId} AND device_id = ${instance.deviceId}`
          const before = workspace === undefined ? '' : yield* digestOf(workspace.path)
          const { implement } = yield* stepsOf(run)
          const { attemptId } = yield* sql.withTransaction(admit(run, 'settle', round, implement ?? {}, { before }))
          const begun = yield* Effect.exit(
            Effect.gen(function* () {
              const sessionId = yield* leadOn(run)
              yield* sessions.send({
                envelope: yield* envelope('thread.send', { threadId: run.threadId, round, settle: true }),
                threadId: run.threadId,
                body: settling(findings),
                quiet: true,
              })
              yield* sql.withTransaction(started(run, attemptId, sessionId))
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

      /** The lead's session: the one running, or the plan's lead (or another the person picked) started. */
      const leadOn = (run: RunRow, agentId?: string, model?: string | null, said?: string) =>
        Effect.gen(function* () {
          const { implement } = yield* stepsOf(run)
          const wanted = agentId ?? implement?.agentId ?? 'claude-code'
          const live = yield* sessions.running(run.threadId)
          // One on an account that is out of usage hands over, to the same agent's next account where it has one (ADR-012).
          const spent = Option.isSome(live) && Option.isSome(yield* limits.outAccount(live.value.accountId))
          if (Option.isSome(live) && !spent && (agentId === undefined || live.value.agentId === agentId)) return live.value.sessionId
          if (Option.isSome(live))
            return yield* sessions.switchAgent({
              threadId: run.threadId,
              agentId: wanted,
              ...(model == null ? {} : { model }),
              ...(said === undefined ? {} : { said }),
            })
          if (said !== undefined) yield* sayOut(run.threadId, run.projectId, said)
          // The plan's lead, unless it is out of usage and the project moves on: the next free agent instead.
          const instead = agentId === undefined && implement !== undefined ? yield* insteadOf(run, implement) : undefined
          // The plan's model and effort are for the plan's lead; another starts on the model chosen for it, or its own.
          const planned = agentId === undefined && instead === undefined
          const chosen = instead?.model ?? (planned ? (implement?.model ?? null) : (model ?? null))
          const effort = planned ? (implement?.effort ?? null) : null
          return yield* sessions.start({
            threadId: run.threadId,
            agentId: instead?.agentId ?? wanted,
            ...(chosen === null ? {} : { model: chosen }),
            ...(effort === null ? {} : { effort }),
          })
        })

      /** Says in the task's thread what a usage limit did. */
      const sayOut = (threadId: string, projectId: ProjectId, title: string) =>
        addItem({ projectId, threadId }, 'notice', { source: 'runtime', severity: 'warning', title })

      /**
       * A planned agent that is out of usage, where the project moves on: the
       * next free agent, and the model it takes over on. Undefined where the
       * planned one is fine, or nothing is free.
       */
      const insteadOf = (run: RunRow, planned: PlanStep) =>
        Effect.gen(function* () {
          const out = yield* limits.out(planned.agentId)
          if (Option.isNone(out) || (yield* usageLimitOfRun(run)) !== 'move') return undefined
          const other = yield* otherStepOf(run, planned.key)
          const next = yield* limits.free([planned.agentId], other === undefined ? [] : [other])
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
       * person hands it over; otherwise it is held until the reset, or, with no
       * reset known, it needs the person.
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
              const revision = yield* change('node_attempts', on.attemptId, {
                state: 'held',
                holdReason: 'usage_limit',
                output: JSON.stringify({ heldFor: agentId, until }),
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
          if ((yield* usageLimitOfRun(on.run)) === 'move') {
            const other = yield* otherStepOf(on.run, on.step === 'review' ? 'review' : 'implement')
            // The same agent's next account first, on the same model; then the next free agent.
            const next = Option.isNone(yield* limits.out(agentId))
              ? agentId
              : yield* limits.free([agentId], other === undefined ? [] : [other])
            if (next !== undefined) {
              const model = yield* limits.modelFor({
                agentId: next,
                projectId: on.run.projectId,
                ...(planned === undefined ? {} : { planned }),
              })
              const to = next === agentId ? (yield* limits.pick({ agentId: next })).id : null
              const said = outWords({ from, resetsAt, to: { ...(yield* limits.named(next, model, to)), ownWork: next === other } })
              // Held while the next agent takes over, so nothing it says before it is told the step counts for the step.
              yield* hold
              const handing = yield* envelope('thread.send', { threadId: on.run.threadId, usageLimit: on.attemptId })
              return yield* carryOn(on.run, on.attemptId, info, { kind: 'retry', agentId: next }, handing, model, said)
            }
          }
          if (out === null || resetsAt === null) return yield* stuck(on.run, { id: on.attemptId }, info)
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
            // The same agent's next account first, then the next free agent.
            const next = Option.isNone(yield* limits.out(agentId)) ? agentId : yield* limits.free([agentId])
            if (next !== undefined) {
              const model = yield* limits.modelFor({ agentId: next, projectId: thread.projectId })
              const to = next === agentId ? (yield* limits.pick({ agentId: next })).id : null
              yield* sessions.switchAgent({
                threadId,
                agentId: next,
                ...(model === null ? {} : { model }),
                said: outWords({ from, resetsAt, to: yield* limits.named(next, model, to) }),
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
          if (plan === undefined) return
          const [already] = yield* sql<{ id: string }>`SELECT id FROM runs WHERE plan_id = ${planId}`
          if (already !== undefined) return
          const parameters = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(PlanParameters))(plan.parameters)
          const implement = parameters.steps.find((step) => step.key === 'implement')
          if (implement === undefined) return
          const runId = yield* newId(Ids.run)
          const runAttemptId = yield* newId(Ids.runAttempt)
          const executionId = yield* newId(Ids.workflowExecution)
          yield* sql.withTransaction(
            Effect.gen(function* () {
              const at = yield* timestamp
              const [task] = yield* sql<{ state: string }>`SELECT state FROM tasks WHERE id = ${plan.taskId}`
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
          if (current === undefined) return
          const { attemptId } = yield* sql.withTransaction(admit(current, 'implement', 0, implement))
          // A lead that can't start leaves Implement needing the person, who can hand it to another agent.
          const begun = yield* Effect.exit(leadOn(current))
          if (begun._tag === 'Failure')
            return yield* stuck(
              current,
              { id: attemptId },
              {
                step: 'implement',
                why: 'failed_to_start',
                detail: summarize(begun.cause) || null,
                agentId: implement.agentId,
                round: 0,
                open: 0,
              },
            )
          yield* sql.withTransaction(started(current, attemptId, begun.value))
          yield* touchCard(plan.taskId)
        })

      /** The lead says its step is done: Implement, or a round of settling. */
      const finishStep = (access: ToolAccess, input: unknown) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const { summary, findings: settled = [] } = yield* read(Finished, input)
          const current = access.taskId === null ? undefined : yield* currentRun(access.taskId)
          const [planned] =
            access.taskId === null ? [] : yield* sql<{ id: string }>`SELECT id FROM runs WHERE task_id = ${access.taskId} LIMIT 1`
          if (current === undefined && planned === undefined) {
            // A task started without a plan has no steps: the summary is still what the person reads.
            yield* addItem({ projectId: access.projectId as ProjectId, threadId: access.threadId }, 'step_result', {
              step: 'implement',
              summary,
            })
            return 'Charrette has your summary.'
          }
          const attempt = current === undefined ? undefined : yield* running(current, ['implement', 'settle'])
          if (current === undefined || attempt === undefined)
            return yield* new ToolRefused({ message: 'No step is waiting on you, so Charrette keeps no summary now.' })
          const step = attempt.nodeKey === 'settle' ? 'settle' : 'implement'
          // A task that ends on its host pushes commits only: what isn't committed is the lead's to commit or clear away first.
          if ((yield* stepsOf(current)).end !== null) {
            const [workspace] = yield* sql<{ path: string }>`
              SELECT path FROM workspaces WHERE task_id = ${current.taskId} AND device_id = ${instance.deviceId}`
            const left = workspace === undefined ? [] : yield* uncommittedFiles(workspace.path)
            if (left.length > 0)
              return yield* new ToolRefused({
                message: `These aren't committed: ${filesLine(left)}. Charrette pushes commits only, so commit what belongs to the task, delete the rest (scratch files, logs), and call finish_step again.`,
              })
          }
          yield* sql.withTransaction(
            Effect.gen(function* () {
              yield* ended(current, attempt, 'succeeded', { summary })
              yield* result(current, { step, round: attempt.iteration, summary })
              // What became of each finding, as the lead says: the input to the next round, and to what reviews learn.
              if (step === 'settle') yield* settleFindings(current, attempt.id, settled)
              // A step that needed the person and reported after all no longer does.
              yield* unstuck(current)
            }),
          )
          if (step === 'implement') {
            const next = yield* review(current, 0)
            return next === undefined
              ? 'Charrette has your summary. The task is ready for the person.'
              : 'Charrette has your summary. A review starts now; wait for its findings.'
          }
          // Another round only if settling changed the code, and rounds are left.
          const [workspace] = yield* sql<{ path: string }>`
            SELECT path FROM workspaces WHERE task_id = ${current.taskId} AND device_id = ${instance.deviceId}`
          const before = (JSON.parse(attempt.input) as { before?: string }).before ?? ''
          const after = workspace === undefined ? before : yield* digestOf(workspace.path)
          if (after !== before && attempt.iteration + 1 < ROUNDS) {
            yield* review(current, attempt.iteration + 1, summary)
            return 'Charrette has your summary. The review looks again.'
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
            return 'Charrette has your summary. That was the last round of review, so the person decides what comes next.'
          }
          yield* conclude(current)
          return 'Charrette has your summary. The task is ready for the person.'
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
          if (reviewed.verdict === 'pass' || findings.length === 0) {
            yield* conclude(current)
            return 'Charrette has your review. The change passes.'
          }
          yield* settle(current, attempt.iteration, recorded)
          return 'Charrette has your review. The lead settles your findings; you may be asked to look again.'
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
                    Effect.fail(new ToolRefused({ message: 'Charrette could not record that. Try again.' })),
                  ),
            ),
          ),
      })

      yield* toolServer.serve('lead', [
        tool(
          'finish_step',
          "Tells Charrette you have done your step: the task, or settling a review's findings. The summary is what the person reads instead of your whole turn: a few lines on what you changed, how you checked it, and anything left open.",
          {
            type: 'object',
            properties: {
              summary: { type: 'string' },
              findings: {
                type: 'array',
                description: 'When settling a review: what became of each finding, by the id Charrette gave it.',
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
       * over runs it again on that agent: the lead's steps in its thread, a
       * review as a new round. Abandoning stops the run; for a review, the
       * task goes on without it and is ready.
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
                reason: answer.kind === 'tell' ? answer.note : answer.kind === 'retry' ? `Hand the step to ${answer.agentId}` : 'Abandon',
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
          yield* carryOn(current, call.attemptId, info, answer, input.envelope)
        })

      /**
       * Carries a step on that stopped: told what to do, handed to another
       * agent (on a model, where one is chosen), or abandoned; as the person
       * answered its call, or as Charrette does when an agent is out of usage.
       */
      const carryOn = (
        current: RunRow,
        attemptId: string | null,
        info: StuckInfo,
        answer: StuckAnswer,
        envelope: CommandEnvelope,
        model?: string | null,
        /** Why it carries on so, where Charrette says: in place of the thread's own line for a switch. */
        said?: string,
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
          /** The waiting attempt runs again, reminded afresh. */
          const resume = (sessionId: string) =>
            attempt === undefined
              ? Effect.void
              : sql.withTransaction(
                  Effect.andThen(change('node_attempts', attempt.id, { output: null }), started(current, attempt.id, sessionId)),
                )
          const endAttempt = (state: 'failed' | 'cancelled', output: unknown) =>
            attempt === undefined
              ? Effect.void
              : sql.withTransaction(
                  Effect.gen(function* () {
                    const at = yield* timestamp
                    const revision = yield* change('node_attempts', attempt.id, { state, output: JSON.stringify(output), endedAt: at })
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
            // Gone on without its ending, the task is ready on its branch; otherwise Charrette tries again.
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
              info.why === 'round_limit' ? last?.summary : undefined,
              answer.kind === 'retry' ? answer.agentId : undefined,
              model,
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
            yield* endAttempt('cancelled', { abandoned: true })
            return yield* finish(current, 'cancelled')
          }
          // The lead's step: its agent (or the one picked) on the task's thread, told again what the step is.
          const sessionId = yield* leadOn(current, answer.kind === 'retry' ? answer.agentId : undefined, model, said)
          yield* resume(sessionId)
          if (answer.kind === 'tell') yield* sessions.send({ envelope: envelope, threadId: current.threadId, body: answer.note })
          else
            yield* sessions.send({
              envelope: envelope,
              threadId: current.threadId,
              body:
                info.step === 'settle'
                  ? settling(
                      (yield* openFindings(current)).map((finding) => {
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
                  : "Carry on with the task from where it stands. When it's done, call Charrette's finish_step tool with your summary.",
              quiet: true,
            })
          yield* touchCard(current.taskId)
        })

      // A step running when Charrette stopped can't be trusted to carry on on its own: each needs the person.
      yield* provide(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const left = yield* sql<{ taskId: string; nodeKey: string; attemptId: string; iteration: number; config: string }>`
            SELECT r.task_id, n.node_key, a.id AS attempt_id, n.iteration, n.config
            FROM runs r JOIN workflow_executions e ON e.run_id = r.id JOIN nodes n ON n.execution_id = e.id
            JOIN node_attempts a ON a.node_id = n.id
            WHERE r.state = 'running' AND a.state IN ('admitted', 'running')`
          for (const step of left) {
            const current = yield* currentRun(step.taskId)
            if (current === undefined) continue
            const agent = (JSON.parse(step.config) as { agentId?: string }).agentId ?? null
            yield* stuck(
              current,
              { id: step.attemptId },
              {
                step: stepOf(step.nodeKey),
                why: 'restarted',
                detail: null,
                agentId: agent,
                round: step.iteration,
                open: 0,
              },
            )
          }
        }).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not mark the steps a restart stopped', cause))),
      )

      /** A step held for a usage limit runs again at the reset, on the agent it was held for. */
      const resumeHeld = (held: {
        readonly taskId: string
        readonly attemptId: string
        readonly nodeKey: string
        readonly iteration: number
        readonly agentId: string
      }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const current = yield* currentRun(held.taskId)
          if (current === undefined) return
          yield* sql.withTransaction(
            Effect.gen(function* () {
              const revision = yield* change('node_attempts', held.attemptId, { state: 'running', holdReason: null, output: null })
              yield* fact({
                projectId: current.projectId,
                aggregateType: 'node_attempt',
                aggregateId: held.attemptId,
                revision,
                type: 'node_attempt.resumed',
                actorId: instance.systemId,
              })
            }),
          )
          const info: StuckInfo = {
            step: stepOf(held.nodeKey),
            why: 'usage_limit',
            detail: null,
            agentId: held.agentId,
            round: held.iteration,
            open: 0,
          }
          const resuming = yield* envelope('thread.send', { threadId: current.threadId, resumed: held.attemptId })
          yield* carryOn(current, held.attemptId, info, { kind: 'retry', agentId: held.agentId }, resuming)
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
              AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.task_id = t.task_id AND r.state = 'running')
              AND EXISTS (SELECT 1 FROM user_inputs i JOIN actors a ON a.id = i.author_actor_id
                WHERE i.thread_id = t.id AND i.state = 'queued' AND a.kind = 'person')`
          const due: Array<{ readonly at: number; readonly run: Effect.Effect<void, unknown, Store> }> = held.map((step) => {
            const { heldFor, until } = JSON.parse(step.output) as { heldFor: string; until: string }
            return { at: Date.parse(until), run: resumeHeld({ ...step, agentId: heldFor }) }
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

      return Runs.of({
        run: (planId) => provide(run(planId)),
        workflowVersion: provide(workflowVersion),
        publish: (taskId) => provide(publish(taskId)),
        answerStuck: (input) => provide(answerStuck(input)),
      })
    }),
  )
}
