import { chmodSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import * as Database from '../src/Database'
import { checkMaintenance } from '../src/maintenance'

const token = 'a'.repeat(32)
const withFile = <A, E, R>(use: (filename: string) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => mkdtempSync(join(tmpdir(), 'althar-reserved-'))),
    (directory) => use(join(directory, 'althar.sqlite')),
    (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
  )
const open = (filename: string, maintenanceToken?: string) =>
  Effect.provide(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`SELECT 1`
    }),
    Layer.fresh(Database.layer({ filename, ...(maintenanceToken === undefined ? {} : { maintenanceToken }) })),
  )
const marker = (filename: string, text = JSON.stringify({ format: 1, token })) =>
  writeFileSync(`${filename}.maintenance`, text, { mode: 0o600 })

describe('reserved database maintenance', () => {
  it.effect('keeps unrelated runtimes out before opening SQLite and admits only the explicit permit', () =>
    withFile((filename) =>
      Effect.gen(function* () {
        yield* open(filename)
        const before = readFileSync(filename)
        marker(filename)
        assert.instanceOf(yield* Effect.flip(open(filename)), Database.DatabaseInMaintenance)
        assert.instanceOf(yield* Effect.flip(open(filename, 'b'.repeat(32))), Database.DatabaseInMaintenance)
        assert.deepStrictEqual(readFileSync(filename), before)
        yield* open(filename, token)
        rmSync(`${filename}.maintenance`)
        yield* open(filename)
      }),
    ),
  )

  it.effect('fails closed on malformed, oversized, exposed or linked reservations, without leaking their contents', () =>
    withFile((filename) =>
      Effect.gen(function* () {
        for (const value of ['bad json', '{}', JSON.stringify({ format: 2, token }), 'x'.repeat(5000)]) {
          marker(filename, value)
          const error = yield* Effect.flip(checkMaintenance(filename, token))
          assert.instanceOf(error, Database.DatabaseInMaintenance)
          assert.strictEqual(JSON.stringify(error).includes(token), false)
        }
        if (process.platform !== 'win32') {
          marker(filename)
          chmodSync(`${filename}.maintenance`, 0o644)
          assert.instanceOf(yield* Effect.flip(checkMaintenance(filename, token)), Database.DatabaseInMaintenance)
          rmSync(`${filename}.maintenance`)
          const target = `${filename}.other`
          writeFileSync(target, JSON.stringify({ format: 1, token }), { mode: 0o600 })
          symlinkSync(target, `${filename}.maintenance`)
          assert.instanceOf(yield* Effect.flip(checkMaintenance(filename, token)), Database.DatabaseInMaintenance)
        }
        yield* checkMaintenance(':memory:')
      }),
    ),
  )

  it.effect('rejects an older migration set without changing the newer database', () =>
    withFile((filename) =>
      Effect.gen(function* () {
        const future = {
          key: '9999_future',
          statements: ['CREATE TABLE future_data (value TEXT)', "INSERT INTO future_data VALUES ('retained')"],
        }
        yield* Effect.provide(Effect.void, Layer.fresh(Database.layer({ filename, migrations: [future] })))
        const error = yield* Effect.flip(open(filename))
        assert.instanceOf(error, Database.DatabaseSchemaTooNew)
        if (error instanceof Database.DatabaseSchemaTooNew) assert.strictEqual(error.applied, 9999)
        const values = yield* Effect.provide(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient
            return yield* sql<{ value: string }>`SELECT value FROM future_data`
          }),
          Layer.fresh(Database.layer({ filename, migrations: [future] })),
        )
        assert.deepStrictEqual(values, [{ value: 'retained' }])
      }),
    ),
  )
})
