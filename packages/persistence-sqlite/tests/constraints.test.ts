import * as Domain from '@charrette/domain'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Exit, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { seed } from './fixtures'
import { InMemory, WebCrypto } from './support'

const Env = Layer.mergeAll(InMemory, WebCrypto)

/** Each column that holds a vocabulary, and the domain's list for it. */
const vocabularies: Record<string, { readonly literals: ReadonlyArray<string> }> = {
  'actors.kind': Domain.ActorKind,
  'repository_locations.kind': Domain.LocationKind,
  'repository_locations.state': Domain.LocationState,
  'artifacts.kind': Domain.ArtifactKind,
  'artifacts.sensitivity': Domain.Sensitivity,
  'tasks.state': Domain.TaskState,
  'task_repository_requirements.access': Domain.RepositoryAccess,
  'task_plans.state': Domain.PlanState,
  'runs.state': Domain.RunState,
  'run_attempts.state': Domain.RunAttemptState,
  'workspace_sets.state': Domain.WorkspaceState,
  'workspaces.state': Domain.WorkspaceState,
  'workflow_executions.state': Domain.ExecutionState,
  'graph_patches.state': Domain.GraphPatchState,
  'execution_graph_revisions.cause': Domain.GraphRevisionCause,
  'nodes.type': Domain.NodeType,
  'nodes.state': Domain.NodeState,
  'threads.kind': Domain.ThreadKind,
  'user_inputs.disposition': Domain.InputDisposition,
  'user_inputs.state': Domain.UserInputState,
  'turn_deliveries.state': Domain.TurnDeliveryState,
  'thread_items.kind': Domain.ThreadItemKind,
  'agent_installations.status': Domain.InstallationStatus,
  'principals.auth_mode': Domain.AuthMode,
  'account_statuses.state': Domain.AccountState,
  'account_statuses.source': Domain.AccountStatusSource,
  'provider_sessions.state': Domain.ProviderSessionState,
  'processes.purpose': Domain.ProcessPurpose,
  'processes.state': Domain.ProcessState,
  'node_attempts.state': Domain.NodeAttemptState,
  'permission_requests.tool_kind': Domain.ToolKind,
  'permission_requests.state': Domain.PermissionRequestState,
  'attention_requests.kind': Domain.AttentionKind,
  'attention_requests.state': Domain.AttentionState,
  'decisions.outcome': Domain.DecisionOutcome,
  'change_sets.state': Domain.ChangeSetState,
  'repository_changes.pull_request_state': Domain.PullRequestState,
  'work_items.state': Domain.WorkItemState,
  'mutation_receipts.state': Domain.MutationState,
  'record_events.aggregate_type': Domain.AggregateType,
  'change_log.aggregate_type': Domain.AggregateType,
}

/** Columns with a fixed list that belongs to the store alone. */
const storeOnly = new Set(['provider_events.direction'])

const inserts = (statement: Effect.Effect<unknown, unknown, SqlClient.SqlClient>) => Effect.map(Effect.exit(statement), Exit.isSuccess)

describe('constraints', () => {
  it.effect('check every vocabulary column against the domain list', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const tables = yield* sql<{ name: string; sql: string }>`SELECT name, sql FROM sqlite_schema WHERE type = 'table'`
      const found = new Map<string, Array<string>>()
      for (const table of tables) {
        for (const match of table.sql.matchAll(/\n\s+(\w+) TEXT[^,\n]* CHECK \(\1 IN \(([^)]*)\)\)/g)) {
          const [, column = '', list = ''] = match
          found.set(
            `${table.name}.${column}`,
            [...list.matchAll(/'([^']*)'/g)].map(([, value = '']) => value),
          )
        }
      }
      for (const [column, values] of found) {
        if (storeOnly.has(column)) continue
        const vocabulary = vocabularies[column]
        assert.isDefined(vocabulary, `${column} holds a vocabulary with no domain list`)
        assert.deepStrictEqual(values.toSorted(), [...(vocabulary?.literals ?? [])].toSorted(), column)
      }
      for (const column of Object.keys(vocabularies)) assert.isTrue(found.has(column), `${column} has no CHECK list`)
    }).pipe(Effect.provide(InMemory)),
  )

  it.effect('enforce foreign keys', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { createdAt } = yield* seed
      const projectId = yield* Domain.newId(Domain.Ids.project)
      const orphan = yield* Domain.newId(Domain.Ids.actor)
      assert.isFalse(
        yield* inserts(
          sql`INSERT INTO projects ${sql.insert({ id: projectId, name: 'X', slug: 'x', createdByActorId: orphan, createdAt })}`,
        ),
      )
    }).pipe(Effect.provide(Env)),
  )

  it.effect('accept only ids of their own kind', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const createdAt = yield* Domain.now
      const device = (id: string) => inserts(sql`INSERT INTO devices ${sql.insert({ id, name: 'Mac', createdAt })}`)
      assert.isTrue(yield* device(yield* Domain.newId(Domain.Ids.device)))
      assert.isFalse(yield* device(yield* Domain.newId(Domain.Ids.actor)))
      assert.isFalse(yield* device('dev_0192f0b3c4d57e8f9a0b1c2d3e4f5a6'))
      assert.isFalse(yield* device('dev_0192F0B3C4D57E8F9A0B1C2D3E4F5A6B'))
    }).pipe(Effect.provide(Env)),
  )

  it.effect('accept only UTC timestamps with milliseconds, and valid JSON', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { projectId, actorId, createdAt } = yield* seed
      const policy = (rules: string, at: string) =>
        Effect.flatMap(Domain.newId(Domain.Ids.policy), (id) =>
          inserts(sql`INSERT INTO policies ${sql.insert({ id, projectId, revision: 1, rules, createdByActorId: actorId, createdAt: at })}`),
        )
      assert.isTrue(yield* policy('{"ask":[]}', createdAt))
      assert.isFalse(yield* policy('{"ask":', createdAt))
      assert.isFalse(yield* policy('{}', '2026-09-28T20:34:23Z'))
      assert.isFalse(yield* policy('{}', '2026-09-28 20:34:23.123'))
    }).pipe(Effect.provide(Env)),
  )

  it.effect('shape threads by kind, with one coordinator thread per person and one thread per task', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { projectId, actorId, createdAt } = yield* seed
      const taskId = yield* Domain.newId(Domain.Ids.task)
      yield* sql`INSERT INTO tasks ${sql.insert({ id: taskId, projectId, title: 'Retry checkout', slug: 'retry-checkout', state: 'open', createdByActorId: actorId, createdAt })}`
      const thread = (fields: Record<string, unknown>) =>
        Effect.flatMap(Domain.newId(Domain.Ids.thread), (id) =>
          inserts(
            sql`INSERT INTO threads ${sql.insert({ id, projectId, ownerActorId: null, taskId: null, nodeId: null, createdAt, ...fields })}`,
          ),
        )
      assert.isTrue(yield* thread({ kind: 'coordinator', ownerActorId: actorId }))
      assert.isFalse(yield* thread({ kind: 'coordinator', ownerActorId: actorId }))
      assert.isFalse(yield* thread({ kind: 'coordinator' }))
      assert.isTrue(yield* thread({ kind: 'task', taskId }))
      assert.isFalse(yield* thread({ kind: 'task', taskId }))
      assert.isFalse(yield* thread({ kind: 'step', taskId }))
    }).pipe(Effect.provide(Env)),
  )

  it.effect('record who superseded a provider session', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { projectId, actorId, createdAt } = yield* seed
      const threadId = yield* Domain.newId(Domain.Ids.thread)
      yield* sql`INSERT INTO threads ${sql.insert({ id: threadId, projectId, kind: 'coordinator', ownerActorId: actorId, createdAt })}`
      const session = (id: string, fields: Record<string, unknown>) =>
        inserts(sql`INSERT INTO provider_sessions ${sql.insert({ id, threadId, agentId: 'claude-code', startedAt: createdAt, ...fields })}`)
      const next = yield* Domain.newId(Domain.Ids.providerSession)
      assert.isTrue(yield* session(next, { state: 'active' }))
      assert.isFalse(yield* session(yield* Domain.newId(Domain.Ids.providerSession), { state: 'superseded' }))
      assert.isTrue(yield* session(yield* Domain.newId(Domain.Ids.providerSession), { state: 'superseded', supersededBySessionId: next }))
      assert.isFalse(yield* session(yield* Domain.newId(Domain.Ids.providerSession), { state: 'active', supersededBySessionId: next }))
    }).pipe(Effect.provide(Env)),
  )
})
