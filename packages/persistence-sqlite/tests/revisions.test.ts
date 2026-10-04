import { Ids, newId, now } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { RevisionConflict, RowNotFound } from '../src/errors'
import { bumpRevision, revisionedTables } from '../src/Revisions'
import { seed } from './fixtures'
import { InMemory, WebCrypto } from './support'

const Env = Layer.mergeAll(InMemory, WebCrypto)

describe('bumpRevision', () => {
  it.effect('moves a row to its next revision', () =>
    Effect.gen(function* () {
      const { projectId } = yield* seed
      assert.strictEqual(yield* bumpRevision('projects', projectId, 1), 2)
      assert.strictEqual(yield* bumpRevision('projects', projectId, 2), 3)
    }).pipe(Effect.provide(Env)),
  )

  it.effect('fails when someone else changed the row first', () =>
    Effect.gen(function* () {
      const { projectId } = yield* seed
      yield* bumpRevision('projects', projectId, 1)
      const conflict = yield* Effect.flip(bumpRevision('projects', projectId, 1))
      assert.instanceOf(conflict, RevisionConflict)
      assert.deepStrictEqual([conflict.expected, conflict.actual], [1, 2])
    }).pipe(Effect.provide(Env)),
  )

  it.effect('fails when the row does not exist', () =>
    Effect.gen(function* () {
      const missing = yield* Effect.flip(bumpRevision('tasks', yield* newId(Ids.task), 1))
      assert.instanceOf(missing, RowNotFound)
    }).pipe(Effect.provide(Env)),
  )

  it.effect('finds project settings by their project', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { projectId } = yield* seed
      yield* sql`INSERT INTO project_settings ${sql.insert({ projectId, updatedAt: yield* now })}`
      assert.strictEqual(yield* bumpRevision('project_settings', projectId, 1), 2)
    }).pipe(Effect.provide(Env)),
  )

  // Policies and graph revisions are immutable rows; their `revision` numbers a version, not a concurrency check.
  it.effect('covers exactly the tables with a revision column', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const tables = yield* sql<{ name: string }>`
        SELECT DISTINCT m.name FROM sqlite_schema m, pragma_table_info(m.name) c
        WHERE m.type = 'table' AND c.name = 'revision'
          AND m.name NOT IN ('policies', 'execution_graph_revisions')`
      assert.deepStrictEqual(tables.map((table) => table.name).toSorted(), [...revisionedTables].toSorted())
    }).pipe(Effect.provide(Env)),
  )
})
