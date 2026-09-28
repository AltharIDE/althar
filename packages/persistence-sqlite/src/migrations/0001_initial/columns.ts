/*
 * Column fragments for migration 0001. They belong to that migration: its
 * checksum covers what they produce, so they are never edited once released.
 * A later migration that needs different fragments gets its own.
 */

interface Nullable {
  readonly nullable?: boolean
}

const notNull = (options: Nullable) => (options.nullable === true ? '' : ' NOT NULL')

/** A primary key of one kind: its prefix, an underscore and 32 hex digits. */
export const id = (prefix: string) => `id TEXT PRIMARY KEY NOT NULL CHECK (${idCheck('id', prefix)})`

/** The check every id of a kind passes, for columns that hold one without referencing a row. */
export const idCheck = (column: string, prefix: string) =>
  `substr(${column}, 1, ${prefix.length + 1}) = '${prefix}_' AND length(${column}) = ${prefix.length + 33} AND substr(${column}, ${prefix.length + 2}) NOT GLOB '*[^0-9a-f]*'`

/** An instant in UTC, as ISO 8601 with milliseconds. */
export const at = (column: string, options: Nullable = {}) =>
  `${column} TEXT${notNull(options)} CHECK (${column} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')`

/** A JSON document. */
export const json = (column: string, options: Nullable & { readonly empty?: '{}' | '[]' } = {}) =>
  `${column} TEXT${notNull(options)}${options.empty === undefined ? '' : ` DEFAULT '${options.empty}'`} CHECK (json_valid(${column}))`

/** A word from a vocabulary, which lives in its own table so a new word is an insert. */
export const word = (column: string, vocabulary: string, options: Nullable & { readonly default?: string } = {}) =>
  `${column} TEXT${notNull(options)}${options.default === undefined ? '' : ` DEFAULT '${options.default}'`} REFERENCES vocab_${vocabulary} (word)`

/** A reference to a row's id in a table that is not scoped to a project. */
export const ref = (column: string, table: string, options: Nullable = {}) => `${column} TEXT${notNull(options)} REFERENCES ${table} (id)`

/** A reference to a row in the same project. Pair it with `sameProject` in the table's constraints. */
export const scoped = (column: string, options: Nullable = {}) => `${column} TEXT${notNull(options)}`

/** Makes a scoped reference point into the row's own project. */
export const sameProject = (column: string, table: string) => `FOREIGN KEY (${column}, project_id) REFERENCES ${table} (id, project_id)`

/** The project a row belongs to. */
export const project = (options: Nullable = {}) => `project_id TEXT${notNull(options)} REFERENCES projects (id)`

/** Lets rows in other tables point into this row's project. */
export const referencedInProject = 'UNIQUE (id, project_id)'

/** A row's revision, for optimistic concurrency and the change feed. */
export const revision = `revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1)`

/** A SHA-256 digest as 64 lowercase hex digits. */
export const sha256 = (column: string) => `${column} TEXT NOT NULL CHECK (length(${column}) = 64 AND ${column} NOT GLOB '*[^0-9a-f]*')`

/** A Git object id: 40 hex digits for SHA-1 repositories, 64 for SHA-256. */
export const gitObject = (column: string, options: Nullable = {}) =>
  `${column} TEXT${notNull(options)} CHECK (length(${column}) IN (40, 64) AND ${column} NOT GLOB '*[^0-9a-f]*')`

/** A 0 or 1 flag. */
export const flag = (column: string, fallback: 0 | 1) => `${column} INTEGER NOT NULL DEFAULT ${fallback} CHECK (${column} IN (0, 1))`

export const table = (name: string, columns: ReadonlyArray<string>, constraints: ReadonlyArray<string> = []) =>
  `CREATE TABLE ${name} (\n  ${[...columns, ...constraints].join(',\n  ')}\n) STRICT`

export const index = (name: string, on: string, options: { readonly unique?: boolean; readonly where?: string } = {}) =>
  `CREATE ${options.unique === true ? 'UNIQUE ' : ''}INDEX ${name} ON ${on}${options.where === undefined ? '' : ` WHERE ${options.where}`}`

/** A vocabulary's table and its words. */
export const vocabulary = (name: string, words: ReadonlyArray<string>): ReadonlyArray<string> => [
  `CREATE TABLE vocab_${name} (word TEXT PRIMARY KEY NOT NULL) STRICT`,
  `INSERT INTO vocab_${name} (word) VALUES ${words.map((entry) => `('${entry}')`).join(', ')}`,
]
