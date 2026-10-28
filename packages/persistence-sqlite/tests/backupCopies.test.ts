import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { backupName, latestBackup, listBackups, reasonOf } from '../src/backups'
import * as Database from '../src/Database'
import { migrations } from '../src/migrations'

/*
 * How the copies in a profile's backups folder are read back, how a failure's
 * words are gathered for the person, and a store the migrator has only begun.
 */

const withFolder = <A, E, R>(use: (folder: string) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => mkdtempSync(join(tmpdir(), 'althar-copies-'))),
    use,
    (folder) => Effect.sync(() => rmSync(folder, { recursive: true, force: true })),
  )

describe('backup copies', () => {
  it.effect('lists copies made in the same second newest migration first, and has no latest in an empty folder', () =>
    withFolder((folder) =>
      Effect.sync(() => {
        const backups = join(folder, 'backups')
        mkdirSync(backups)
        assert.isNull(latestBackup(backups))

        const at = '2026-10-11T10:32:48.000Z'
        const earlier = backupName(17, at)
        const later = backupName(18, at)
        const yesterday = backupName(19, '2026-10-10T10:32:48.000Z')
        for (const name of [earlier, yesterday, later]) writeFileSync(join(backups, name), '')

        assert.deepStrictEqual(
          listBackups(backups),
          [later, earlier, yesterday].map((name) => join(backups, name)),
        )
        assert.strictEqual(latestBackup(backups), join(backups, later))
        assert.isNull(latestBackup(join(folder, 'missing')))
      }),
    ),
  )

  it('says what went wrong from the causes when the outer error has no words', () => {
    assert.strictEqual(reasonOf({ cause: new Error('disk I/O error') }), 'disk I/O error')
    assert.strictEqual(
      reasonOf({ message: 42, reason: { message: 'Migration 0038 failed', cause: new Error('no such table: devices') } }),
      'Migration 0038 failed: no such table: devices',
    )
  })

  it('falls back to the error itself when nothing in it says anything', () => {
    assert.strictEqual(reasonOf('interrupted'), 'interrupted')
    assert.strictEqual(reasonOf({ message: '  ' }), '[object Object]')
  })

  it.effect('copies nothing for a store whose migrator recorded nothing yet, and migrates it', () =>
    withFolder((folder) =>
      Effect.gen(function* () {
        const filename = join(folder, 'althar.sqlite')
        const backups = join(folder, 'backups')
        const migrated = Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          return yield* sql<{ migrationId: number }>`SELECT migration_id FROM schema_migrations`
        })
        // The migrator sets up its table even with nothing to run.
        assert.lengthOf(yield* Effect.provide(migrated, Layer.fresh(Database.layer({ filename, migrations: [] }))), 0)

        const applied = yield* Effect.provide(migrated, Layer.fresh(Database.layer({ filename, backups })))
        assert.lengthOf(applied, migrations.length)
        assert.deepStrictEqual(listBackups(backups), [])
      }),
    ),
  )
})
