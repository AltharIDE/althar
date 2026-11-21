import { linkSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import * as Database from '../src/Database'

describe('the separate read connections', () => {
  it.live('rejects a second database path made by hard-linking an open profile', () => {
    const folder = mkdtempSync(join(tmpdir(), 'althar-store-alias-'))
    const filename = join(folder, 'profile.sqlite')
    const alias = join(folder, 'alias.sqlite')
    return Effect.scoped(
      Effect.gen(function* () {
        yield* Layer.build(Database.layer({ filename }))
        yield* Effect.sync(() => linkSync(filename, alias))
        const refused = yield* Effect.flip(Effect.provide(Effect.void, Database.layer({ filename: alias })))
        assert.strictEqual(refused._tag, 'SqlError')
      }),
    ).pipe(Effect.ensuring(Effect.sync(() => rmSync(folder, { recursive: true, force: true }))))
  })

  it.live('read committed snapshots during a write, reject writes, and release ownership on close', () => {
    const folder = mkdtempSync(join(tmpdir(), 'althar-store-read-'))
    const filename = join(folder, 'profile.sqlite')
    return Effect.gen(function* () {
      const store = Database.layer({ filename })
      yield* Effect.scoped(
        Effect.gen(function* () {
          const context = yield* Layer.build(store)
          yield* Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient
            const reader = yield* Database.ReadLane
            yield* sql`CREATE TABLE sample (the_value TEXT NOT NULL) STRICT`
            yield* sql`INSERT INTO sample VALUES ('committed')`
            const select = sql<{ theValue: string }>`SELECT the_value FROM sample ORDER BY the_value`
            yield* sql.withTransaction(
              Effect.gen(function* () {
                yield* sql`INSERT INTO sample VALUES ('pending')`
                assert.deepEqual(yield* reader.read(select, 'background'), [{ theValue: 'committed' }])
                assert.deepEqual(yield* reader.read(select, 'interactive'), [{ theValue: 'committed' }])
                assert.lengthOf(yield* select, 2)
              }),
            )
            assert.lengthOf(yield* reader.read(select, 'interactive'), 2)
            assert.isTrue((yield* Effect.exit(reader.read(sql`DELETE FROM sample RETURNING the_value`)))._tag === 'Failure')
            const other = yield* Effect.flip(Effect.provide(Effect.void, Layer.fresh(store)))
            assert.instanceOf(other, Database.DatabaseInUse)
          }).pipe(Effect.provideContext(context))
        }),
      )
      yield* Effect.provide(Effect.void, Layer.fresh(store))
    }).pipe(Effect.ensuring(Effect.sync(() => rmSync(folder, { recursive: true, force: true }))))
  })
})
