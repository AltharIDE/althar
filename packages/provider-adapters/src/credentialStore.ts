import { constants } from 'node:fs'
import { open, realpath } from 'node:fs/promises'
import { isAbsolute, join, normalize, sep } from 'node:path'
import { StringDecoder } from 'node:string_decoder'

/*
 * The one place that opens an agent's credential file (ADR-050, the usage
 * read). It is not exported from the package, and only `usageRead.ts` imports
 * it: a test fails if another file does. It reads one named file inside one
 * account's home, and takes one string out of it by its path, without ever
 * building the file's other values: it scans the text a chunk at a time,
 * skips what is not on the path (a refresh token, another provider's entry),
 * stops at the one string, and drops the rest. It never writes, and it
 * refuses a symlink or a file that resolves outside the home.
 */

/** Where a token is, in an account's home: a file, and the path to one string in its JSON. */
export interface TokenLocation {
  /** Relative to the account's home, such as `auth.json`. */
  readonly file: string
  readonly path: ReadonlyArray<string>
}

/** A key longer than this cannot be on a path, so it is not kept to compare. */
const LONGEST_KEY = 64

type Frame = { readonly array: boolean; key: string | null }

/** What feeding the next piece of JSON found: more is needed, or the string, or that there is none. */
export type Feed = { readonly done: false } | { readonly done: true; readonly value: string | null }

/**
 * A reader of JSON fed in pieces, looking for the one string at `path`. Only
 * keys short enough to be on the path, and the one string wanted, are ever
 * held; every other value is passed over, not built.
 */
export const stringFinder = (path: ReadonlyArray<string>): ((piece: string) => Feed) => {
  const stack: Frame[] = []
  let inString = false
  let escaped = false
  let isKey = false
  /** The characters of the string being read, only while it is a key or the one wanted; null when it is passed over. */
  let held: string[] | null = null
  let rawEscape = false
  let wantedValue = false
  let afterColon = false
  let finished: string | null | undefined

  const onPath = () => stack.length === path.length && stack.every((frame, i) => !frame.array && frame.key === path[i])
  const finish = (value: string | null): Feed => {
    finished = value
    return { done: true, value }
  }

  return (piece) => {
    if (finished !== undefined) return { done: true, value: finished }
    for (const ch of piece) {
      if (inString) {
        if (held !== null) {
          held.push(ch)
          if (isKey && held.length > LONGEST_KEY) held = null
        }
        if (escaped) {
          escaped = false
          rawEscape = true
        } else if (ch === '\\') escaped = true
        else if (ch === '"') {
          inString = false
          const text = held
          held = null
          if (isKey) {
            const top = stack.at(-1)
            // A key with an escape in it is never on the path.
            if (top !== undefined) top.key = text === null || rawEscape ? null : text.slice(0, -1).join('')
            isKey = false
          } else if (wantedValue) {
            if (text === null) return finish(null)
            try {
              const value: unknown = JSON.parse(`"${text.slice(0, -1).join('')}"`)
              return finish(typeof value === 'string' && value !== '' ? value : null)
            } catch {
              return finish(null)
            }
          }
          wantedValue = false
          afterColon = false
        }
        continue
      }
      if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') continue
      if (ch === '"') {
        inString = true
        rawEscape = false
        const top = stack.at(-1)
        isKey = top !== undefined && !top.array && !afterColon
        wantedValue = !isKey && afterColon && onPath()
        held = isKey || wantedValue ? [] : null
        continue
      }
      if (ch === '{') {
        stack.push({ array: false, key: null })
        afterColon = false
      } else if (ch === '[') {
        stack.push({ array: true, key: null })
        afterColon = false
      } else if (ch === '}' || ch === ']') {
        stack.pop()
        afterColon = false
      } else if (ch === ':') afterColon = true
      else if (ch === ',') afterColon = false
      else if (afterColon && onPath()) return finish(null) // the wanted value is a number, true, false or null
    }
    return { done: false }
  }
}

/** The string at `path` in JSON given in pieces, or null. */
export const extractString = (pieces: Iterable<string>, path: ReadonlyArray<string>): string | null => {
  const feed = stringFinder(path)
  for (const piece of pieces) {
    const fed = feed(piece)
    if (fed.done) return fed.value
  }
  return null
}

/** Chunks of a file, as text, one read at a time: never the whole file at once. */
async function* chunks(handle: import('node:fs/promises').FileHandle): AsyncGenerator<string> {
  const decoder = new StringDecoder('utf8')
  const buffer = Buffer.alloc(4096)
  for (;;) {
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, null)
    if (bytesRead === 0) break
    yield decoder.write(buffer.subarray(0, bytesRead))
  }
}

/** The token at `location`, or null where the file or the field is not there, is not a string, or is not inside the home. */
export const readTokenField = async (home: string, location: TokenLocation): Promise<string | null> => {
  const file = normalize(location.file)
  // Only a file inside the home, named by the registry: never a path from outside it.
  if (isAbsolute(file) || file === '..' || file.startsWith(`..${sep}`)) return null
  try {
    const root = await realpath(home)
    const path = join(root, file)
    // The file must really be inside the home, and not a link to somewhere else (another account's, say).
    if (!(await realpath(path)).startsWith(`${root}${sep}`)) return null
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      if (!(await handle.stat()).isFile()) return null
      // One chunk at a time, stopped at the token: the rest of the file is never read.
      const feed = stringFinder(location.path)
      for await (const piece of chunks(handle)) {
        const fed = feed(piece)
        if (fed.done) return fed.value
      }
      return null
    } finally {
      await handle.close()
    }
  } catch {
    return null
  }
}
