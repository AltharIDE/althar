import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import * as Database from '../src/Database'

/*
 * A store another connection is writing to when the runtime opens it: the
 * client opens it fine, since it is in WAL mode, and the runtime's own lock
 * is what can't be had.
 */

const withFile = <A, E, R>(use: (filename: string) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => mkdtempSync(join(tmpdir(), 'althar-held-'))),
    (directory) => use(join(directory, 'althar.sqlite')),
    (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
  )

const select = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`SELECT 1`
})

describe('a store held by another writer', () => {
  it.effect('is in use while another connection holds its write lock, and opens once that ends', () =>
    withFile((filename) =>
      Effect.gen(function* () {
        yield* Effect.provide(select, Layer.fresh(Database.layer({ filename })))

        // Another connection, not in exclusive mode, starts writing and keeps the lock until it closes.
        yield* Effect.gen(function* () {
          const other = yield* SqlClient.SqlClient
          yield* other.unsafe('BEGIN IMMEDIATE')
          const opened = yield* Effect.flip(
            Effect.provide(select, Layer.fresh(Database.layer({ filename, busyTimeout: Duration.millis(50) }))),
          )
          assert.instanceOf(opened, Database.DatabaseInUse)
          assert.strictEqual((opened as Database.DatabaseInUse).filename, filename)
        }).pipe(Effect.provide(Layer.fresh(SqliteClient.layer({ filename }))))

        yield* Effect.provide(select, Layer.fresh(Database.layer({ filename })))
      }),
    ),
  )
})
