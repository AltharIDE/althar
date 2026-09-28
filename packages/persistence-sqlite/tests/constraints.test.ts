import * as Domain from '@charrette/domain'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Exit, Layer, Predicate, Schema } from 'effect'
import { SqlClient } from 'effect/sql'
import { snakeToPascal } from 'effect/String'

import { seed, seedRun } from './fixtures'
import { InMemory, WebCrypto } from './support'

const Env = Layer.mergeAll(InMemory, WebCrypto)

/** The domain's vocabularies by name: every exported schema with a list of literals. */
const domainVocabularies = new Map(
  Object.entries(Domain).flatMap(([name, value]) =>
    Schema.isSchema(value) && 'literals' in value && Array.isArray(value.literals)
      ? [[name, value.literals.filter(Predicate.isString)]]
      : [],
  ),
)

const succeeds = (statement: Effect.Effect<unknown, unknown, SqlClient.SqlClient>) => Effect.map(Effect.exit(statement), Exit.isSuccess)

describe('constraints', () => {
  it.effect('hold every domain vocabulary in a lookup table with the same words', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const tables = yield* sql<{ name: string }>`SELECT name FROM sqlite_schema WHERE type = 'table' AND name LIKE 'vocab_%'`
      const stored = new Map<string, ReadonlyArray<string>>()
      for (const { name } of tables) {
        const words = yield* sql<{ word: string }>`SELECT word FROM ${sql(name)}`
        stored.set(
          snakeToPascal(name.replace('vocab_', '')),
          words.map((row) => row.word),
        )
      }
      assert.deepStrictEqual([...stored.keys()].toSorted(), [...domainVocabularies.keys()].toSorted())
      for (const [name, words] of stored)
        assert.deepStrictEqual([...words].toSorted(), [...(domainVocabularies.get(name) ?? [])].toSorted(), name)
    }).pipe(Effect.provide(InMemory)),
  )

  it.effect('refuse a word that is not in its vocabulary', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const createdAt = yield* Domain.now
      const actor = (kind: string) =>
        Effect.flatMap(Domain.newId(Domain.Ids.actor), (id) =>
          succeeds(sql`INSERT INTO actors ${sql.insert({ id, kind, displayName: 'X', createdAt })}`),
        )
      assert.isTrue(yield* actor('person'))
      assert.isFalse(yield* actor('robot'))
    }).pipe(Effect.provide(Env)),
  )

  it.effect('enforce foreign keys', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { createdAt } = yield* seed
      const id = yield* Domain.newId(Domain.Ids.project)
      const orphan = yield* Domain.newId(Domain.Ids.actor)
      assert.isFalse(
        yield* succeeds(sql`INSERT INTO projects ${sql.insert({ id, name: 'X', slug: 'x', createdByActorId: orphan, createdAt })}`),
      )
    }).pipe(Effect.provide(Env)),
  )

  it.effect('keep references inside their project', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const mine = yield* seedRun
      const other = yield* seed
      const thread = (projectId: string) =>
        Effect.flatMap(Domain.newId(Domain.Ids.thread), (id) =>
          succeeds(
            sql`INSERT INTO threads ${sql.insert({ id, projectId, kind: 'step', taskId: mine.taskId, executionId: mine.executionId, nodeKey: 'verify', createdAt: mine.createdAt })}`,
          ),
        )
      assert.isTrue(yield* thread(mine.projectId))
      assert.isFalse(yield* thread(other.projectId))
    }).pipe(Effect.provide(Env)),
  )

  it.effect('accept only ids of their own kind', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const createdAt = yield* Domain.now
      const device = (id: string) => succeeds(sql`INSERT INTO devices ${sql.insert({ id, name: 'Mac', createdAt })}`)
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
      let revision = 0
      const policy = (rules: string, at: string) =>
        Effect.flatMap(Domain.newId(Domain.Ids.policy), (id) =>
          succeeds(
            sql`INSERT INTO policies ${sql.insert({ id, projectId, revision: ++revision, rules, createdByActorId: actorId, createdAt: at })}`,
          ),
        )
      assert.isTrue(yield* policy('{"ask":[]}', createdAt))
      assert.isFalse(yield* policy('{"ask":', createdAt))
      assert.isFalse(yield* policy('{}', '2026-09-28T20:34:23Z'))
      assert.isFalse(yield* policy('{}', '2026-09-28 20:34:23.123'))
    }).pipe(Effect.provide(Env)),
  )

  it.effect('shape threads by kind: one coordinator thread per person, one per task, one per step', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { projectId, actorId, taskId, executionId, createdAt } = yield* seedRun
      const thread = (fields: Record<string, unknown>) =>
        Effect.flatMap(Domain.newId(Domain.Ids.thread), (id) =>
          succeeds(sql`INSERT INTO threads ${sql.insert({ id, projectId, createdAt, ...fields })}`),
        )
      assert.isTrue(yield* thread({ kind: 'coordinator', ownerActorId: actorId }))
      assert.isFalse(yield* thread({ kind: 'coordinator', ownerActorId: actorId }))
      assert.isFalse(yield* thread({ kind: 'coordinator' }))
      assert.isFalse(yield* thread({ kind: 'task', taskId }), 'seedRun already made the task thread')
      assert.isTrue(yield* thread({ kind: 'step', taskId, executionId, nodeKey: 'review' }))
      assert.isFalse(yield* thread({ kind: 'step', taskId, executionId, nodeKey: 'review' }))
      assert.isFalse(yield* thread({ kind: 'step', taskId, executionId }))
    }).pipe(Effect.provide(Env)),
  )

  it.effect('record who superseded a session or an input', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { projectId, threadId, actorId, createdAt } = yield* seedRun
      const session = (fields: Record<string, unknown>) =>
        Effect.flatMap(Domain.newId(Domain.Ids.providerSession), (id) =>
          succeeds(
            sql`INSERT INTO provider_sessions ${sql.insert({ id, projectId, threadId, agentId: 'claude-code', startedAt: createdAt, ...fields })}`,
          ),
        )
      const next = yield* Domain.newId(Domain.Ids.providerSession)
      yield* sql`INSERT INTO provider_sessions ${sql.insert({ id: next, projectId, threadId, agentId: 'codex', state: 'active', startedAt: createdAt })}`
      assert.isFalse(yield* session({ state: 'superseded' }))
      assert.isTrue(yield* session({ state: 'superseded', supersededBySessionId: next }))
      assert.isFalse(yield* session({ state: 'active', supersededBySessionId: next }))

      const input = (sequence: number, fields: Record<string, unknown>) =>
        Effect.gen(function* () {
          const id = yield* Domain.newId(Domain.Ids.userInput)
          const commandId = yield* Domain.newId(Domain.Ids.command)
          const ok = yield* succeeds(
            sql`INSERT INTO user_inputs ${sql.insert({ id, projectId, threadId, sequence, commandId, disposition: 'after_current', body: 'x', authorActorId: actorId, acceptedAt: createdAt, ...fields })}`,
          )
          return { id, ok }
        })
      const replacement = yield* input(1, { state: 'queued' })
      assert.isFalse((yield* input(2, { state: 'superseded' })).ok)
      assert.isTrue((yield* input(3, { state: 'superseded', supersededByInputId: replacement.id })).ok)
    }).pipe(Effect.provide(Env)),
  )

  it.effect('allow one unfinished attempt per node, and say why an attempt is held', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { projectId, nodeId, runAttemptId, createdAt } = yield* seedRun
      const attempt = (attemptNumber: number, fields: Record<string, unknown>) =>
        Effect.flatMap(Domain.newId(Domain.Ids.nodeAttempt), (id) =>
          succeeds(
            sql`INSERT INTO node_attempts ${sql.insert({ id, projectId, nodeId, attemptNumber, runAttemptId, controllerGeneration: 1, admittedAt: createdAt, ...fields })}`,
          ),
        )
      assert.isTrue(yield* attempt(1, { state: 'superseded' }))
      assert.isTrue(yield* attempt(2, { state: 'running' }))
      assert.isFalse(yield* attempt(3, { state: 'held', holdReason: 'usage_limit' }), 'attempt 2 is still unfinished')
      yield* sql`UPDATE node_attempts SET state = 'failed' WHERE attempt_number = 2`
      assert.isFalse(yield* attempt(3, { state: 'held' }))
      assert.isTrue(yield* attempt(3, { state: 'held', holdReason: 'usage_limit' }))
      assert.isFalse(yield* attempt(4, { state: 'failed', holdReason: 'usage_limit' }))
    }).pipe(Effect.provide(Env)),
  )

  it.effect('record a process before it has a pid, and not after', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { deviceId, instanceId, createdAt } = yield* seed
      const process = (fields: Record<string, unknown>) =>
        Effect.flatMap(Domain.newId(Domain.Ids.process), (id) =>
          succeeds(
            sql`INSERT INTO processes ${sql.insert({ id, deviceId, runtimeInstanceId: instanceId, purpose: 'agent', executable: 'claude-agent-acp', launchedAt: createdAt, ...fields })}`,
          ),
        )
      assert.isTrue(yield* process({ state: 'launching' }))
      assert.isFalse(yield* process({ state: 'running' }))
      assert.isTrue(yield* process({ state: 'running', pid: 4321 }))
    }).pipe(Effect.provide(Env)),
  )

  it.effect('let a decision answer exactly one thing, and scope only permissions', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { projectId, nodeId, runAttemptId, actorId, createdAt } = yield* seedRun
      const reviewAttemptId = yield* Domain.newId(Domain.Ids.nodeAttempt)
      yield* sql`INSERT INTO node_attempts ${sql.insert({ id: reviewAttemptId, projectId, nodeId, attemptNumber: 1, runAttemptId, controllerGeneration: 1, state: 'succeeded', admittedAt: createdAt })}`
      const findingId = yield* Domain.newId(Domain.Ids.finding)
      yield* sql`INSERT INTO findings ${sql.insert({ id: findingId, projectId, reviewAttemptId, severity: 'major', claim: 'Retries are unbounded', state: 'open', createdAt })}`
      const decision = (fields: Record<string, unknown>) =>
        Effect.flatMap(Domain.newId(Domain.Ids.decision), (id) =>
          succeeds(sql`INSERT INTO decisions ${sql.insert({ id, projectId, decidedByActorId: actorId, decidedAt: createdAt, ...fields })}`),
        )
      assert.isTrue(yield* decision({ findingId, outcome: 'dismiss', reason: 'Bounded by the queue' }))
      assert.isFalse(yield* decision({ outcome: 'dismiss' }))
      assert.isFalse(yield* decision({ findingId, outcome: 'allow' }))
      assert.isFalse(yield* decision({ findingId, outcome: 'dismiss', scope: 'once' }))
      assert.isFalse(yield* decision({ findingId, outcome: 'fix', agentOptionId: 'allow-once' }))
      yield* sql`UPDATE findings SET state = 'set_aside', settled_at = ${createdAt}, response = 'Bounded by the queue' WHERE id = ${findingId}`
      assert.isTrue(
        yield* succeeds(
          sql`INSERT INTO findings ${sql.insert({ id: yield* Domain.newId(Domain.Ids.finding), projectId, reviewAttemptId, severity: 'major', claim: 'Retries are unbounded under load', state: 'open', repeatsFindingId: findingId, createdAt })}`,
        ),
        'a finding raised again says which one it repeats',
      )
      assert.isFalse(
        yield* succeeds(
          sql`INSERT INTO findings ${sql.insert({ id: yield* Domain.newId(Domain.Ids.finding), projectId, reviewAttemptId, severity: 'major', claim: 'x', state: 'open', repeatsFindingId: yield* Domain.newId(Domain.Ids.finding), createdAt })}`,
        ),
        'and the one it repeats exists',
      )
      assert.isFalse(
        yield* succeeds(
          sql`INSERT INTO findings ${sql.insert({ id: yield* Domain.newId(Domain.Ids.finding), projectId, reviewAttemptId, severity: 'nit', claim: 'x', state: 'fixed', createdAt })}`,
        ),
        'a settled finding says when',
      )
    }).pipe(Effect.provide(Env)),
  )

  it.effect('allow one active turn per thread, and a claim only with a holder and a lease', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { projectId, threadId, instanceId, createdAt } = yield* seedRun
      const sessionId = yield* Domain.newId(Domain.Ids.providerSession)
      yield* sql`INSERT INTO provider_sessions ${sql.insert({ id: sessionId, projectId, threadId, agentId: 'claude-code', state: 'active', startedAt: createdAt })}`
      const turn = (state: string) =>
        Effect.flatMap(Domain.newId(Domain.Ids.turnDelivery), (id) =>
          succeeds(
            sql`INSERT INTO turn_deliveries ${sql.insert({ id, projectId, threadId, providerSessionId: sessionId, controllerGeneration: 1, state, requestedAt: createdAt })}`,
          ),
        )
      assert.isTrue(yield* turn('completed'))
      assert.isTrue(yield* turn('delivered'))
      assert.isFalse(yield* turn('pending'))

      const workItem = (fields: Record<string, unknown>) =>
        Effect.flatMap(Domain.newId(Domain.Ids.workItem), (id) =>
          succeeds(
            sql`INSERT INTO work_items ${sql.insert({ id, kind: 'open_pull_request', subjectType: 'change_set', subjectId: 'chg', availableAt: createdAt, createdAt, updatedAt: createdAt, ...fields })}`,
          ),
        )
      assert.isTrue(yield* workItem({ state: 'pending' }))
      assert.isFalse(yield* workItem({ state: 'claimed' }))
      assert.isTrue(yield* workItem({ state: 'claimed', claimedByInstanceId: instanceId, leaseExpiresAt: createdAt }))
    }).pipe(Effect.provide(Env)),
  )
})
