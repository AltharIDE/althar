import { readFile } from 'node:fs/promises'
import { isAbsolute, join, normalize, sep } from 'node:path'

/*
 * The one place that opens an agent's credential file (ADR-043, the usage
 * read). It is not exported from the package, and only `usageRead.ts` imports
 * it: a test fails if another file does. It reads one named file in one
 * account's home, picks one string field out of it, and keeps nothing else.
 * It never writes.
 */

/** Where a token is, in an account's home: a file, and the path to one string in its JSON. */
export interface TokenLocation {
  /** Relative to the account's home, such as `auth.json`. */
  readonly file: string
  readonly path: ReadonlyArray<string>
}

/** The token at `location`, or null where the file or the field is not there or is not a string. */
export const readTokenField = async (home: string, location: TokenLocation): Promise<string | null> => {
  const file = normalize(location.file)
  // Only a file inside the home, named by the registry: never a path from outside it.
  if (isAbsolute(file) || file === '..' || file.startsWith(`..${sep}`)) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(join(home, file), 'utf8'))
  } catch {
    return null
  }
  let at: unknown = parsed
  for (const key of location.path) {
    if (typeof at !== 'object' || at === null || Array.isArray(at)) return null
    at = (at as Record<string, unknown>)[key]
  }
  return typeof at === 'string' && at !== '' ? at : null
}
