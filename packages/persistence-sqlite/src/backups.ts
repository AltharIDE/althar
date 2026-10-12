import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { now } from '@althar/domain'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { Effect, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { idOf, type Migration, MIGRATIONS_TABLE } from './migrations'

/*
 * Before an update migrates the store, a copy of it as it was: made with
 * SQLite's backup API on the store's own connection, so it is a consistent
 * database even with writes in the WAL, written aside and renamed into place,
 * so a copy that stopped half way is never taken for one. The newest three are
 * kept. Nothing is copied when nothing is pending, or for a store no migration
 * has touched yet (a new profile), which holds nothing to lose.
 */

/** How many copies a profile keeps, newest first. */
export const KEEP_BACKUPS = 3

/** The store couldn't be copied before migrating, so it wasn't migrated: it is as it was. */
export class BackupFailed extends Schema.TaggedError<BackupFailed>()('BackupFailed', {
  folder: Schema.String,
  reason: Schema.String,
}) {}

/** `althar-<migration>-<UTC date and time>.sqlite`: the migration the store was at, and when it was copied. */
const NAME = /^althar-(\d{4,})-(\d{4}-\d{2}-\d{2}-\d{6})\.sqlite$/

/** A copy's name, from the migration the store is at and an ISO timestamp. */
export const backupName = (migration: number, at: string) =>
  `althar-${String(migration).padStart(4, '0')}-${at.slice(0, 10)}-${at.slice(11, 19).replaceAll(':', '')}.sqlite`

/** The copies in a folder, newest first; anything else there is left alone. None where there is no folder. */
export const listBackups = (folder: string): ReadonlyArray<string> => {
  const names = (() => {
    try {
      return readdirSync(folder)
    } catch {
      return []
    }
  })()
  return names
    .flatMap((name) => {
      const match = NAME.exec(name)
      return match?.[1] === undefined || match[2] === undefined ? [] : [{ name, migration: Number(match[1]), at: match[2] }]
    })
    .toSorted((a, b) => b.at.localeCompare(a.at) || b.migration - a.migration)
    .map((copy) => join(folder, copy.name))
}

/** The newest copy in a folder, or null. */
export const latestBackup = (folder: string): string | null => listBackups(folder)[0] ?? null

/** What went wrong, as each layer said it: an error's message and its causes', once each. */
export const reasonOf = (error: unknown): string => {
  const said: Array<string> = []
  let current: unknown = error
  for (let depth = 0; depth < 6 && current !== null && typeof current === 'object'; depth++) {
    const message = 'message' in current && typeof current.message === 'string' ? current.message.trim() : ''
    if (message !== '' && !said.some((earlier) => earlier.includes(message))) said.push(message)
    current = 'reason' in current && typeof current.reason === 'object' ? current.reason : 'cause' in current ? current.cause : null
  }
  return said.length === 0 ? String(error) : said.join(': ')
}

/** The migration the store is at; null for a store no migration has touched. */
const appliedMigration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const tables = yield* sql<{ name: string }>`SELECT name FROM sqlite_schema WHERE type = 'table' AND name = ${MIGRATIONS_TABLE}`
  if (tables.length === 0) return null
  const [row] = yield* sql<{ latest: number | null }>`SELECT max(migration_id) AS latest FROM ${sql(MIGRATIONS_TABLE)}`
  return row?.latest ?? null
})

/** Keeps the newest copies and drops the rest, with any a crash left half written. What can't be removed stays. */
const prune = (folder: string) =>
  Effect.sync(() => {
    const leftovers = readdirSync(folder).filter((name) => name.startsWith('althar-') && name.endsWith('.sqlite.partial'))
    for (const path of [...listBackups(folder).slice(KEEP_BACKUPS), ...leftovers.map((name) => join(folder, name))])
      rmSync(path, { force: true })
  }).pipe(Effect.catchDefect(() => Effect.void))

/**
 * Copies the store into `folder` when one of `migrations` is still to run on
 * it, and returns the copy's path; null when nothing is pending or the store
 * is new. A copy that can't be made fails with `BackupFailed`, and nothing
 * should be migrated then.
 */
export const backUpBeforeMigrating = (folder: string, migrations: ReadonlyArray<Migration>) =>
  Effect.gen(function* () {
    const applied = yield* appliedMigration
    if (applied === null || !migrations.some((migration) => idOf(migration) > applied)) return null
    const client = yield* SqliteClient.SqliteClient
    const path = join(folder, backupName(applied, yield* now))
    const partial = `${path}.partial`
    const failed = (error: unknown) => {
      try {
        rmSync(partial, { force: true })
      } catch {
        // Left for the next copy to clear away.
      }
      return new BackupFailed({ folder, reason: reasonOf(error) })
    }
    yield* Effect.try({ try: () => mkdirSync(folder, { recursive: true }), catch: failed })
    yield* client.backup(partial).pipe(Effect.mapError(failed))
    yield* Effect.try({ try: () => renameSync(partial, path), catch: failed })
    yield* prune(folder)
    return path
  })
