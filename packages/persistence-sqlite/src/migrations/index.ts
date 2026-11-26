/// <reference types="vite/client" />
import { readdirSync } from 'node:fs'
import { createRequire } from 'node:module'

import { SqliteMigrator } from '@effect/sql-sqlite-node'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

export interface Migration {
  /** `<number>_<name>`, the order they run in. */
  readonly key: string
  readonly statements: ReadonlyArray<string>
}

/** Where the migrator records each migration it ran, by number. */
export const MIGRATIONS_TABLE = 'schema_migrations'

/** A migration's number, as the migrator records it: 18 for `0018_questions`. */
export const idOf = (migration: Migration) => Number.parseInt(migration.key, 10)

interface File {
  readonly statements: ReadonlyArray<string>
}

/** A migration's file: `0018_questions.ts`. A migration in parts keeps them in a folder of its name, as `0001_initial` does. */
const NAMED = /^\d{4}_[a-z0-9_]+\.ts$/

/*
 * Every migration is a file here, found by its name: nothing lists them, so two pull requests that each add one change
 * different files. Vite reads the folder as it builds the app's runtime, the host and the CLI, and Vitest as it runs.
 * Code run as it is, without Vite, as Playwright runs the end-to-end specs' helpers, has no `import.meta.glob`: it
 * reads the folder on the disk instead.
 */
const files = (): Record<string, File> => {
  try {
    return import.meta.glob<File>('./[0-9][0-9][0-9][0-9]_*.ts', { eager: true })
  } catch {
    const here = new URL('./', import.meta.url)
    const load = createRequire(here)
    const names = readdirSync(here).filter((name) => NAMED.test(name))
    // Bundled by something other than Vite, the folder is gone: say so, rather than open a store with no schema.
    if (names.length === 0) throw new Error(`No migrations in ${here.pathname}: build what runs the store with Vite.`)
    return Object.fromEntries(names.map((name) => [`./${name}`, load(`./${name}`) as File]))
  }
}

/**
 * Every migration, in the order of its number. Migrations are append-only: once
 * main has one, it never changes, and CI's `numbers` check refuses a change to
 * it (.github/scripts/numbers.py).
 */
export const migrations: ReadonlyArray<Migration> = Object.entries(files())
  .map(([path, file]) => ({ key: path.slice('./'.length, -'.ts'.length), statements: file.statements }))
  .toSorted((a, b) => idOf(a) - idOf(b))

const run = (statements: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    for (const statement of statements) yield* sql.unsafe(statement)
  })

export const loaderFor = (list: ReadonlyArray<Migration>) =>
  SqliteMigrator.fromRecord(Object.fromEntries(list.map((migration) => [migration.key, run(migration.statements)])))
