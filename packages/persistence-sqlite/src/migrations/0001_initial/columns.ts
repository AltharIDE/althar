/*
 * Column fragments for migration 0001. They belong to that migration: its
 * checksum covers what they produce, so they are never edited once released.
 * A later migration that needs different fragments gets its own.
 */

/** A primary key of one kind: its prefix, an underscore and 32 hex digits. */
export const id = (prefix: string) =>
  `id TEXT PRIMARY KEY NOT NULL CHECK (substr(id, 1, ${prefix.length + 1}) = '${prefix}_' AND length(id) = ${prefix.length + 33} AND substr(id, ${prefix.length + 2}) NOT GLOB '*[^0-9a-f]*')`

/** An instant in UTC, as ISO 8601 with milliseconds. */
export const at = (column: string, options: { readonly nullable?: boolean } = {}) =>
  `${column} TEXT${options.nullable === true ? '' : ' NOT NULL'} CHECK (${column} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')`

/** A JSON document. */
export const json = (column: string, options: { readonly nullable?: boolean; readonly empty?: '{}' | '[]' } = {}) =>
  `${column} TEXT${options.nullable === true ? '' : ' NOT NULL'}${options.empty === undefined ? '' : ` DEFAULT '${options.empty}'`} CHECK (json_valid(${column}))`

/** One of a fixed vocabulary. */
export const oneOf = (column: string, values: ReadonlyArray<string>, options: { readonly default?: string } = {}) =>
  `${column} TEXT NOT NULL${options.default === undefined ? '' : ` DEFAULT '${options.default}'`} CHECK (${column} IN (${values.map((value) => `'${value}'`).join(', ')}))`

/** A reference to another row's id. */
export const ref = (column: string, table: string, options: { readonly nullable?: boolean } = {}) =>
  `${column} TEXT${options.nullable === true ? '' : ' NOT NULL'} REFERENCES ${table} (id)`

/** An aggregate's revision, for optimistic concurrency. */
export const revision = `revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1)`

/** A SHA-256 digest as 64 lowercase hex digits. */
export const sha256 = (column: string) => `${column} TEXT NOT NULL CHECK (length(${column}) = 64 AND ${column} NOT GLOB '*[^0-9a-f]*')`

/** A 0 or 1 flag. */
export const flag = (column: string, fallback: 0 | 1) => `${column} INTEGER NOT NULL DEFAULT ${fallback} CHECK (${column} IN (0, 1))`

export const table = (name: string, columns: ReadonlyArray<string>) => `CREATE TABLE ${name} (\n  ${columns.join(',\n  ')}\n) STRICT`

export const index = (name: string, on: string, options: { readonly unique?: boolean; readonly where?: string } = {}) =>
  `CREATE ${options.unique === true ? 'UNIQUE ' : ''}INDEX ${name} ON ${on}${options.where === undefined ? '' : ` WHERE ${options.where}`}`
