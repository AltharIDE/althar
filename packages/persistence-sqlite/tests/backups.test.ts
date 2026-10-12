import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'
import { TestClock } from 'effect/testing'

import { backupName, listBackups } from '../src/backups'
import * as Database from '../src/Database'
import { idOf, type Migration, migrations } from '../src/migrations'

/*
 * The copy a store makes of itself before an update migrates it, and what
 * the update leaves when a migration fails: the store as it was, the copy in
 * place, and both opening in the build before.
 */

const NOW = Date.parse('2026-10-11T10:32:48.123Z')
const DEVICE = `dev_${'0'.repeat(32)}`

const previous = migrations.slice(0, -1)
const atPrevious = idOf(previous[previous.length - 1] ?? { key: '0', statements: [] })
const atLatest = idOf(migrations[migrations.length - 1] ?? { key: '0', statements: [] })

/** A migration that can never run, past every real one. */
const failing: Migration = { key: '9999_fails', statements: ['INSERT INTO no_such_table VALUES (1)'] }

const withProfile = <A, E, R>(use: (profile: { filename: string; backups: string }) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => mkdtempSync(join(tmpdir(), 'althar-backups-'))),
    (directory) => use({ filename: join(directory, 'althar.sqlite'), backups: join(directory, 'backups') }),
    (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
  )

const open = <A, E>(options: Database.DatabaseOptions, use: Effect.Effect<A, E, SqlClient.SqlClient>) =>
  Effect.provide(use, Layer.fresh(Database.layer(options)))

/** The migration a store is at, and the device rows it holds. */
const inspect = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const [row] = yield* sql<{ latest: number }>`SELECT max(migration_id) AS latest FROM schema_migrations`
  const devices = yield* sql<{ id: string }>`SELECT id FROM devices`
  return { at: row?.latest, devices: devices.map((device) => device.id) }
})

const addDevice = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql.unsafe(`INSERT INTO devices (id, name, created_at) VALUES ('${DEVICE}', 'Mac', '2026-09-28T20:34:23.123Z')`)
})

describe('backups', () => {
  it.effect('copies the store before a pending migration, as a database the build before opens', () =>
    withProfile(({ filename, backups }) =>
      Effect.gen(function* () {
        yield* open({ filename, migrations: previous }, addDevice)
        yield* TestClock.setTime(NOW)
        yield* open({ filename, backups }, Effect.void)

        const copy = join(backups, backupName(atPrevious, '2026-10-11T10:32:48.123Z'))
        assert.deepStrictEqual(listBackups(backups), [copy])
        assert.match(copy, /althar-\d{4}-2026-10-11-103248\.sqlite$/)
        // Only the copy: nothing half written, and no journal beside it.
        assert.deepStrictEqual(readdirSync(backups), [copy.slice(backups.length + 1)])

        assert.deepStrictEqual(yield* open({ filename: copy, migrations: previous }, inspect), { at: atPrevious, devices: [DEVICE] })
        assert.deepStrictEqual(yield* open({ filename }, inspect), { at: atLatest, devices: [DEVICE] })
      }),
    ),
  )

  it.effect('copies nothing for a new store, or when nothing is pending', () =>
    withProfile(({ filename, backups }) =>
      Effect.gen(function* () {
        yield* open({ filename, backups }, Effect.void)
        yield* open({ filename, backups }, Effect.void)
        assert.deepStrictEqual(listBackups(backups), [])
      }),
    ),
  )

  it.effect('keeps the newest three copies, clears half-written ones, and leaves anything else alone', () =>
    withProfile(({ filename, backups }) =>
      Effect.gen(function* () {
        yield* open({ filename, migrations: previous }, Effect.void)
        mkdirSync(backups)
        const oldest = backupName(10, '2026-09-30T08:00:00.000Z')
        const older = backupName(11, '2026-10-02T08:00:00.000Z')
        const newer = backupName(12, '2026-10-05T08:00:00.000Z')
        const halfWritten = `${backupName(12, '2026-10-06T08:00:00.000Z')}.partial`
        for (const name of [oldest, older, newer, halfWritten, 'notes.txt']) writeFileSync(join(backups, name), '')

        yield* TestClock.setTime(NOW)
        yield* open({ filename, backups }, Effect.void)

        const made = backupName(atPrevious, '2026-10-11T10:32:48.123Z')
        assert.deepStrictEqual(
          listBackups(backups),
          [made, newer, older].map((name) => join(backups, name)),
        )
        assert.deepStrictEqual(readdirSync(backups).toSorted(), [made, newer, older, 'notes.txt'].toSorted())
      }),
    ),
  )

  it.effect('leaves the store as it was, and the copy in place, when a migration fails', () =>
    withProfile(({ filename, backups }) =>
      Effect.gen(function* () {
        yield* open({ filename }, addDevice)
        yield* TestClock.setTime(NOW)

        const error = yield* Effect.flip(open({ filename, backups, migrations: [...migrations, failing] }, Effect.void))
        assert.instanceOf(error, Database.MigrationFailed)
        const { backup, reason } = error as Database.MigrationFailed
        assert.strictEqual(backup, join(backups, backupName(atLatest, '2026-10-11T10:32:48.123Z')))
        assert.include(reason, '9999_fails')
        assert.include(reason, 'no such table: no_such_table')

        // Nothing of the update stayed: the build before opens the store, and the copy, as they were.
        assert.deepStrictEqual(yield* open({ filename }, inspect), { at: atLatest, devices: [DEVICE] })
        assert.deepStrictEqual(yield* open({ filename: backup ?? '', migrations }, inspect), { at: atLatest, devices: [DEVICE] })
      }),
    ),
  )

  it.effect('migrates nothing when the copy can’t be made: no folder for it, or the copy itself stops', () =>
    withProfile(({ filename, backups }) =>
      Effect.gen(function* () {
        yield* open({ filename, migrations: previous }, Effect.void)
        // A file where the folder should be.
        writeFileSync(backups, '')
        const noFolder = yield* Effect.flip(open({ filename, backups }, Effect.void))
        assert.instanceOf(noFolder, Database.BackupFailed)
        assert.strictEqual((noFolder as Database.BackupFailed).folder, backups)
        assert.strictEqual((yield* open({ filename, migrations: previous }, inspect)).at, atPrevious)

        // A folder where SQLite would write the copy, so the backup API stops.
        rmSync(backups)
        yield* TestClock.setTime(NOW)
        mkdirSync(`${join(backups, backupName(atPrevious, '2026-10-11T10:32:48.123Z'))}.partial`, { recursive: true })
        const copyStopped = yield* Effect.flip(open({ filename, backups }, Effect.void))
        assert.instanceOf(copyStopped, Database.BackupFailed)
        assert.deepStrictEqual(listBackups(backups), [])
        assert.strictEqual((yield* open({ filename, migrations: previous }, inspect)).at, atPrevious)
      }),
    ),
  )

  it.effect('says where the copy is when migrations leave rows pointing at nothing, on that launch and the next', () =>
    withProfile(({ filename, backups }) =>
      Effect.gen(function* () {
        yield* open(
          { filename },
          Effect.gen(function* () {
            yield* addDevice
            const sql = yield* SqlClient.SqlClient
            yield* sql.unsafe(
              `INSERT INTO runtime_instances (id, device_id, pid, app_version, started_at) VALUES ('rt_${'0'.repeat(32)}', '${DEVICE}', 42, '0.0.0', '2026-09-28T20:34:23.123Z')`,
            )
          }),
        )
        const orphaning: Migration = { key: '9999_drop_devices', statements: ['DELETE FROM devices'] }
        const update = { filename, backups, migrations: [...migrations, orphaning] }

        const first = yield* Effect.flip(open(update, Effect.void))
        const again = yield* Effect.flip(open(update, Effect.void))
        const [copy] = listBackups(backups)
        assert.isDefined(copy)
        for (const error of [first, again]) {
          assert.instanceOf(error, Database.ForeignKeyViolations)
          assert.strictEqual((error as Database.ForeignKeyViolations).backup, copy)
        }
        assert.lengthOf(listBackups(backups), 1)
      }),
    ),
  )
})
