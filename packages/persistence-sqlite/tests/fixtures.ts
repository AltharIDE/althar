import { Ids, newId, now } from '@charrette/domain'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

const HASH = 'a'.repeat(64)

/** A device, a person, a runtime launch and a project to hang other rows off. */
export const seed = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const createdAt = yield* now
  const deviceId = yield* newId(Ids.device)
  const actorId = yield* newId(Ids.actor)
  const instanceId = yield* newId(Ids.runtimeInstance)
  const projectId = yield* newId(Ids.project)
  yield* sql`INSERT INTO devices ${sql.insert({ id: deviceId, name: 'This Mac', createdAt })}`
  yield* sql`INSERT INTO actors ${sql.insert({ id: actorId, kind: 'person', displayName: 'Ada', agentId: null, createdAt })}`
  yield* sql`INSERT INTO runtime_instances ${sql.insert({ id: instanceId, deviceId, pid: 4242, appVersion: '0.0.0', startedAt: createdAt })}`
  const slug = `meridian-${projectId.slice(-6)}`
  yield* sql`INSERT INTO projects ${sql.insert({ id: projectId, name: 'Meridian', slug, createdByActorId: actorId, createdAt })}`
  return { deviceId, actorId, instanceId, projectId, createdAt }
})

/** Everything down to one node of one run: a task, its thread, a policy, a workflow, a run, an attempt and an execution. */
export const seedRun = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const base = yield* seed
  const { projectId, actorId, deviceId, instanceId, createdAt } = base
  const ids = {
    taskId: yield* newId(Ids.task),
    threadId: yield* newId(Ids.thread),
    policyId: yield* newId(Ids.policy),
    definitionId: yield* newId(Ids.workflowDefinition),
    versionId: yield* newId(Ids.workflowVersion),
    runId: yield* newId(Ids.run),
    runAttemptId: yield* newId(Ids.runAttempt),
    executionId: yield* newId(Ids.workflowExecution),
    nodeId: yield* newId(Ids.node),
  }
  yield* sql`INSERT INTO tasks ${sql.insert({ id: ids.taskId, projectId, title: 'Retry checkout', slug: 'retry-checkout', state: 'open', createdByActorId: actorId, createdAt })}`
  yield* sql`INSERT INTO threads ${sql.insert({ id: ids.threadId, projectId, kind: 'task', taskId: ids.taskId, createdAt })}`
  yield* sql`INSERT INTO policies ${sql.insert({ id: ids.policyId, projectId, revision: 1, rules: '{}', createdByActorId: actorId, createdAt })}`
  yield* sql`INSERT INTO workflow_definitions ${sql.insert({ id: ids.definitionId, name: `mvp-${ids.definitionId.slice(-6)}`, createdAt })}`
  yield* sql`INSERT INTO workflow_versions ${sql.insert({ id: ids.versionId, definitionId: ids.definitionId, version: 1, contentHash: HASH, definition: '{}', createdAt })}`
  yield* sql`INSERT INTO runs ${sql.insert({ id: ids.runId, projectId, taskId: ids.taskId, workflowVersionId: ids.versionId, policyId: ids.policyId, state: 'running', createdAt })}`
  yield* sql`INSERT INTO run_attempts ${sql.insert({ id: ids.runAttemptId, projectId, runId: ids.runId, attemptNumber: 1, deviceId, controllerInstanceId: instanceId, state: 'active', startedAt: createdAt })}`
  yield* sql`INSERT INTO workflow_executions ${sql.insert({ id: ids.executionId, projectId, runId: ids.runId, workflowVersionId: ids.versionId, state: 'running', createdAt })}`
  yield* sql`INSERT INTO nodes ${sql.insert({ id: ids.nodeId, projectId, executionId: ids.executionId, nodeKey: 'review', type: 'agent', addedInRevision: 1, state: 'running', createdAt })}`
  return { ...base, ...ids }
})
