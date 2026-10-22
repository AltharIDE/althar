import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Effect, Predicate, Result, Schema, Semaphore } from 'effect'
import { parseJson } from './catalog'
import { SkillStoreFailed } from './errors'
import { exists, io, lockTree, readTree, unlockTree } from './files'
import { type Files, treeHash } from './hash'
import { isSafePath } from './validate'

/*
 * The shared store, in Althar's per-user data and never in a project checkout:
 *   objects/<tree-hash>/   immutable skill trees, read-only, files and folders
 *   installs.json          what is installed: source, pin, hashes, review state
 *   runs/<run-id>/<agent>/ one run's projection (projection.ts)
 */

const SHA = Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/))
const HASH = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/))
const Source = Schema.Literals(['github', 'local', 'althar-default'])
const Review = Schema.Literals(['not-reviewed', 'reviewed', 'default'])

const Install = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1)),
  /** `github` can be refreshed from its repository; `local` only by re-importing; `althar-default` comes with the catalog. */
  source: Source,
  repo: Schema.optionalKey(Schema.String),
  sha: Schema.optionalKey(SHA),
  subpath: Schema.optionalKey(Schema.String),
  /** The branch, tag or commit the person installed from, resolved again only when they check for updates. */
  ref: Schema.optionalKey(Schema.String),
  treeHash: HASH,
  review: Review,
  /** Whether it is bound for use; installed is not the same as active. */
  active: Schema.Boolean,
  /**
   * Versions it had before, newest last, so an update can be rolled back; their objects are kept. Each says where
   * it was from, as one installed in place of another source's goes back to that source; an entry without a
   * source is from the same one.
   */
  history: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        treeHash: HASH,
        sha: Schema.optionalKey(SHA),
        source: Schema.optionalKey(Source),
        repo: Schema.optionalKey(Schema.String),
        subpath: Schema.optionalKey(Schema.String),
        ref: Schema.optionalKey(Schema.String),
        review: Schema.optionalKey(Review),
      }),
    ),
  ),
}).check(
  Schema.makeFilter(
    (install) => !(install.active && install.review === 'not-reviewed') || 'an install that was not reviewed cannot be active',
  ),
)

const Installs = Schema.Struct({
  version: Schema.Literal(1),
  /** The hash of the default catalog's catalog.json last installed, so an unchanged catalog is not installed again. */
  catalog: Schema.optionalKey(Schema.String),
  installs: Schema.Array(Install),
})

export type Install = typeof Install.Type
export type Installs = typeof Installs.Type

export const EMPTY_INSTALLS: Installs = { version: 1, installs: [] }

const STRICT = { onExcessProperty: 'error' } as const
const decodeInstalls = Schema.decodeUnknownEffect(Installs, STRICT)
const decodeInstall = Schema.decodeUnknownResult(Install, STRICT)
const decodeFile = Schema.decodeUnknownEffect(
  Schema.Struct({ version: Schema.Literal(1), catalog: Schema.optionalKey(Schema.String), installs: Schema.Array(Schema.Unknown) }),
  STRICT,
)

const HASHED = /^[0-9a-f]{64}$/

export const isTreeHash = (value: string): boolean => HASHED.test(value)

const objectDirectory = (root: string, hash: string): Effect.Effect<string, SkillStoreFailed> =>
  isTreeHash(hash)
    ? Effect.succeed(join(root, 'objects', hash))
    : Effect.fail(new SkillStoreFailed({ message: 'a tree hash is 64 lowercase hex characters' }))

/** Writes `text` so a reader sees the old file or the new one, never half. */
const writeAtomically = (path: string, text: string): Effect.Effect<void, SkillStoreFailed> =>
  io(`writing ${path}`, async () => {
    await mkdir(dirname(path), { recursive: true })
    const temporary = `${path}.${randomUUID()}.tmp`
    await writeFile(temporary, text, { mode: 0o600 })
    await rename(temporary, path)
  })

/** Whether the store holds a version under this hash, as a reviewed card names it. */
export const hasObject = (root: string, hash: string): Effect.Effect<boolean, SkillStoreFailed> =>
  Effect.flatMap(objectDirectory(root, hash), exists)

/**
 * Keeps a skill tree under its hash. The same tree is the same object, so putting it twice changes nothing.
 * Refuses an unsafe path rather than writing outside the object. Its files and folders are read-only once in place.
 */
export const putObject = (root: string, files: Files): Effect.Effect<string, SkillStoreFailed> =>
  Effect.gen(function* () {
    for (const path of files.keys()) {
      if (!isSafePath(path)) return yield* new SkillStoreFailed({ message: `unsafe path in skill: ${path}` })
    }
    const hash = treeHash(files)
    const directory = yield* objectDirectory(root, hash)
    if (yield* exists(directory)) return hash
    const staging = `${directory}.${randomUUID()}.partial`
    yield* io(`staging ${hash}`, async () => {
      await mkdir(staging, { recursive: true })
      for (const [path, bytes] of files) {
        const target = join(staging, path)
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, bytes, { mode: 0o444 })
      }
    })
    // Locked before it is renamed into place, so no reader ever sees a writable object; within one folder, a rename needs no write on the folder moved.
    yield* lockTree(staging)
    yield* io(`storing ${hash}`, () => rename(staging, directory)).pipe(
      Effect.catch((error) =>
        Effect.gen(function* () {
          yield* unlockTree(staging)
          yield* io(`clearing ${staging}`, () => rm(staging, { recursive: true, force: true }))
          // Another writer put the same tree there first: it is the same object.
          if (!(yield* exists(directory))) return yield* error
        }),
      ),
    )
    return hash
  })

/** Reads a stored tree back, and checks it still hashes to its name. A symlink or a changed file is a refusal. */
export const readObject = (root: string, hash: string): Effect.Effect<Files, SkillStoreFailed> =>
  Effect.gen(function* () {
    const files = yield* readTree(yield* objectDirectory(root, hash), hash)
    if (treeHash(files) !== hash) return yield* new SkillStoreFailed({ message: `the stored skill ${hash} no longer matches its hash` })
    return files
  })

const locks = new Map<string, Semaphore.Semaphore>()

/** Runs `work` after every earlier one on the same store has finished: installs.json is read, changed and rewritten, and two at once would lose one. */
export const serialized = <A, E, R>(root: string, work: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.suspend(() => {
    const lock = locks.get(root) ?? Semaphore.makeUnsafe(1)
    locks.set(root, lock)
    return lock.withPermits(1)(work)
  })

/** installs.json's text, or none where there is no file yet. Any other read error is surfaced, so an unreadable record is never taken for empty. */
const installsText = (root: string): Effect.Effect<string | null, SkillStoreFailed> =>
  io('reading installs.json', () =>
    readFile(join(root, 'installs.json'), 'utf8').catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }),
  )

const damaged = (error: Schema.SchemaError) => new SkillStoreFailed({ message: `installs.json does not read: ${error.message}` })

/** What is installed. Refused whole where any of it doesn't read, so a change is never written over a record it couldn't read. */
export const readInstalls = (root: string): Effect.Effect<Installs, SkillStoreFailed> =>
  Effect.gen(function* () {
    const text = yield* installsText(root)
    if (text === null) return EMPTY_INSTALLS
    return yield* decodeInstalls(yield* parseJson(text, 'installs.json')).pipe(Effect.mapError(damaged))
  })

/** One install as a listing reads it: whole, or broken on its own with what can be told of it. */
export type Listed =
  | { readonly ok: true; readonly install: Install }
  | { readonly ok: false; readonly id: string; readonly problem: string; readonly at: number }

/**
 * What is installed, for reading only (a list, a run's selection): an install that doesn't read is kept to itself,
 * named by its id where it has one, and the rest are read as they are. Only a file that isn't an install list at all fails.
 */
export const listInstalls = (root: string): Effect.Effect<ReadonlyArray<Listed>, SkillStoreFailed> =>
  Effect.gen(function* () {
    const text = yield* installsText(root)
    if (text === null) return []
    const file = yield* decodeFile(yield* parseJson(text, 'installs.json')).pipe(Effect.mapError(damaged))
    return file.installs.map((raw, at): Listed => {
      const read = decodeInstall(raw)
      if (Result.isSuccess(read)) return { ok: true, install: read.success }
      const named = Predicate.isObject(raw) && 'id' in raw && Predicate.isString(raw.id) && raw.id !== '' ? raw.id : null
      return { ok: false, id: named ?? `#${at + 1}`, problem: read.failure.message, at }
    })
  })

export const writeInstalls = (root: string, installs: Installs): Effect.Effect<void, SkillStoreFailed> =>
  Effect.gen(function* () {
    const checked = yield* Schema.encodeUnknownEffect(
      Installs,
      STRICT,
    )(installs).pipe(Effect.mapError((error) => new SkillStoreFailed({ message: `not an install list: ${error.message}` })))
    yield* writeAtomically(join(root, 'installs.json'), `${JSON.stringify(checked, null, 2)}\n`)
  })

/** Adds or replaces an install by id. A replaced version's object stays until nothing references it. */
export const withInstall = (installs: Installs, install: Install): Installs => ({
  ...installs,
  installs: [...installs.installs.filter(({ id }) => id !== install.id), install].toSorted((a, b) => a.id.localeCompare(b.id)),
})
