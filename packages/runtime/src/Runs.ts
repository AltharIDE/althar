import { createHash } from 'node:crypto'

import { Ids, newId, type ProjectId } from '@charrette/domain'
import type { Ledger } from '@charrette/persistence-sqlite'
import { Context, type Crypto, Effect, Layer, Option, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { touchCard } from './cards'
import { Instance } from './Instance'
import { git } from './git'
import { change, fact, timestamp } from './records'
import { envelope } from './envelope'
import { Sessions } from './Sessions'
import { addItem } from './threads'
import { ToolRefused, ToolServer, type Tool, type ToolAccess } from './ToolServer'

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
  skipped: Schema.Boolean,
})
export type PlanStep = typeof PlanStep.Type

/** What a plan holds: its steps, and why the lead was chosen. */
export const PlanParameters = Schema.Struct({ steps: Schema.Array(PlanStep), reason: Schema.NullOr(Schema.String) })
export type PlanParameters = typeof PlanParameters.Type

const Finding = Schema.Struct({
  severity: Schema.Literals(['blocking', 'major', 'minor', 'nit']),
  file: Schema.optional(Schema.String),
  line: Schema.optional(Schema.Int),
  claim: Schema.String,
})
type Finding = typeof Finding.Type

const Finished = Schema.Struct({ summary: Schema.String })
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

/** What the worktree holds now, as a digest: whether settling changed anything. */
const digestOf = (worktree: string, base: string | null) =>
  Effect.gen(function* () {
    const quiet = (effect: Effect.Effect<string, unknown>) => effect.pipe(Effect.orElseSucceed(() => ''))
    const diff = yield* quiet(git(worktree, 'diff', base ?? 'HEAD'))
    const status = yield* quiet(git(worktree, 'status', '--porcelain'))
    return createHash('sha256').update(`${diff}\u0000${status}`).digest('hex')
  })

const findingsText = (findings: ReadonlyArray<Finding>) =>
  findings
    .map((finding, index) => {
      const where = finding.file === undefined ? '' : ` ${finding.file}${finding.line === undefined ? '' : `:${finding.line}`}`
      return `${index + 1}. [${finding.severity}]${where}: ${finding.claim}`
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

type Store = SqlClient.SqlClient | Instance | Sessions | ToolServer | Crypto.Crypto | Ledger

export class Runs extends Context.Service<
  Runs,
  {
    /** Runs an accepted plan: its task opens, and its steps run in order. */
    run(planId: string): Effect.Effect<void, unknown>
    /** The workflow version every task's plan runs, for now. */
    readonly workflowVersion: Effect.Effect<string, unknown>
  }
>()('@charrette/runtime/Runs') {
  static readonly layer: Layer.Layer<Runs, never, Store> = Layer.effect(
    Runs,
    Effect.gen(function* () {
      const context = yield* Effect.context<Store>()
      const instance = yield* Instance
      const sessions = yield* Sessions
      const toolServer = yield* ToolServer
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

      /** The project's rules, as the run records them: the MVP's, for now. */
      const policyOf = (projectId: ProjectId) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [known] = yield* sql<{ id: string }>`SELECT id FROM policies WHERE project_id = ${projectId} ORDER BY revision DESC LIMIT 1`
          if (known !== undefined) return known.id
          const id = yield* newId(Ids.policy)
          yield* sql`INSERT INTO policies ${sql.insert({
            id,
            projectId,
            revision: 1,
            rules: JSON.stringify({
              source: 'mvp',
              alwaysAsk: ['push to the default branch', 'force push', 'merge', 'deploy', 'write outside the worktree'],
            }),
            createdByActorId: instance.systemId,
            createdAt: yield* timestamp,
          })}`
          return id
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
        }))

      /** Adds a node for a step, for a round of the review loop, and admits an attempt at it. */
      const admit = (run: RunRow, key: 'implement' | 'review' | 'settle', iteration: number, config: unknown, input: unknown = {}) =>
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
              type: 'agent',
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
            WHERE n.execution_id = ${run.executionId} AND a.state IN ('admitted', 'running')
              AND n.node_key IN ${sql.in(keys)}
            ORDER BY a.admitted_at DESC LIMIT 1`
          return attempt
        })

      /** A step's result, in the task's thread: what the person reads instead of the work. */
      const result = (run: RunRow, content: Readonly<Record<string, unknown>>) =>
        addItem({ projectId: run.projectId, threadId: run.threadId }, 'step_result', content)

      /** The run is over: the task is ready for the person. */
      const finish = (run: RunRow, state: 'succeeded' | 'failed') =>
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

      /** Starts, or carries on, a round of review. The reviewer's thread spans the rounds. */
      const review = (run: RunRow, round: number, settled?: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const { review: step } = yield* stepsOf(run)
          if (step === undefined) return yield* finish(run, 'succeeded')
          const { nodeId, attemptId } = yield* sql.withTransaction(admit(run, 'review', round, step))
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
          const live = yield* sessions.running(threadId)
          const sessionId = Option.isSome(live)
            ? live.value.sessionId
            : yield* sessions.start({ threadId, agentId: step.agentId, ...(step.model === null ? {} : { model: step.model }) })
          if (Option.isSome(live) || round > 0)
            yield* sessions.send({
              envelope: yield* envelope('thread.send', { threadId, round }),
              threadId,
              body: `Round ${round + 1}. The lead settled your findings:\n\n${settled ?? ''}\n\nReview the change again. Check that the fixes hold, and don't raise again what the lead set aside unless you have new evidence; then say which finding you repeat, and why.`,
              quiet: true,
            })
          yield* sql.withTransaction(started(run, attemptId, sessionId))
          yield* touchCard(run.taskId)
          return { nodeId, attemptId }
        })

      /** The lead settles what the review found, in its own session. */
      const settle = (run: RunRow, round: number, findings: ReadonlyArray<Finding>) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [workspace] = yield* sql<{ path: string; baseCommit: string | null }>`
            SELECT path, base_commit FROM workspaces WHERE task_id = ${run.taskId} AND device_id = ${instance.deviceId}`
          const before = workspace === undefined ? '' : yield* digestOf(workspace.path, workspace.baseCommit)
          const { implement } = yield* stepsOf(run)
          const { attemptId } = yield* sql.withTransaction(admit(run, 'settle', round, implement ?? {}, { before }))
          const live = yield* sessions.running(run.threadId)
          const sessionId = Option.isSome(live)
            ? live.value.sessionId
            : yield* sessions.start({
                threadId: run.threadId,
                agentId: implement?.agentId ?? 'claude-code',
                ...(implement?.model === null || implement?.model === undefined ? {} : { model: implement.model }),
              })
          yield* sessions.send({
            envelope: yield* envelope('thread.send', { threadId: run.threadId, round, settle: true }),
            threadId: run.threadId,
            body: `The review found:\n\n${findingsText(findings)}\n\nSettle each: fix what holds, and set aside what doesn't, with a reason. Then call finish_step with what you did about each.`,
            quiet: true,
          })
          yield* sql.withTransaction(started(run, attemptId, sessionId))
          yield* touchCard(run.taskId)
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
          const { attemptId, nodeId } = yield* sql.withTransaction(admit(current, 'implement', 0, implement))
          const sessionId = yield* sessions
            .start({
              threadId: current.threadId,
              agentId: implement.agentId,
              ...(implement.model === null ? {} : { model: implement.model }),
            })
            .pipe(
              Effect.tapError(() =>
                Effect.andThen(
                  sql.withTransaction(ended(current, { id: attemptId, nodeId }, 'failed', { reason: 'The lead could not start.' })),
                  finish(current, 'failed'),
                ),
              ),
            )
          yield* sql.withTransaction(started(current, attemptId, sessionId))
          yield* touchCard(plan.taskId)
        })

      /** The lead says its step is done: Implement, or a round of settling. */
      const finishStep = (access: ToolAccess, input: unknown) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const { summary } = yield* read(Finished, input)
          const current = access.taskId === null ? undefined : yield* currentRun(access.taskId)
          const attempt = current === undefined ? undefined : yield* running(current, ['implement', 'settle'])
          if (current === undefined || attempt === undefined) {
            // No step is waiting on it, as when the task was started without a plan: the summary is still what the person reads.
            yield* addItem({ projectId: access.projectId as ProjectId, threadId: access.threadId }, 'step_result', {
              step: 'implement',
              summary,
            })
            return 'Charrette has your summary.'
          }
          const step = attempt.nodeKey === 'settle' ? 'settle' : 'implement'
          yield* sql.withTransaction(
            Effect.andThen(ended(current, attempt, 'succeeded', { summary }), result(current, { step, round: attempt.iteration, summary })),
          )
          if (step === 'implement') {
            const next = yield* review(current, 0)
            return next === undefined
              ? 'Charrette has your summary. The task is ready for the person.'
              : 'Charrette has your summary. A review starts now; wait for its findings.'
          }
          // Another round only if settling changed the code, and rounds are left.
          const [workspace] = yield* sql<{ path: string; baseCommit: string | null }>`
            SELECT path, base_commit FROM workspaces WHERE task_id = ${current.taskId} AND device_id = ${instance.deviceId}`
          const before = String((JSON.parse(attempt.input) as { before?: unknown }).before ?? '')
          const after = workspace === undefined ? before : yield* digestOf(workspace.path, workspace.baseCommit)
          if (after !== before && attempt.iteration + 1 < ROUNDS) {
            yield* review(current, attempt.iteration + 1, summary)
            return 'Charrette has your summary. The review looks again.'
          }
          yield* finish(current, 'succeeded')
          return 'Charrette has your summary. The task is ready for the person.'
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
          yield* sql.withTransaction(
            Effect.gen(function* () {
              for (const finding of findings) {
                yield* sql`INSERT INTO findings ${sql.insert({
                  id: yield* newId(Ids.finding),
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
            }),
          )
          if (reviewed.verdict === 'pass' || findings.length === 0) {
            yield* finish(current, 'succeeded')
            return 'Charrette has your review. The change passes.'
          }
          yield* settle(current, attempt.iteration, findings)
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
          { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
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

      return Runs.of({
        run: (planId) => provide(run(planId)),
        workflowVersion: provide(workflowVersion),
      })
    }),
  )
}
