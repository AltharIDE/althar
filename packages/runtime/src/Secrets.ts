import { chmodSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { removeFully } from '@althar/provider-adapters'
import { Clock, Context, Duration, Effect, Layer, Schedule, Schema } from 'effect'

/*
 * Where Althar keeps a secret, such as a code host's token
 * (docs/architecture/06, "Signing in"): sealed, in a file of its own in the
 * profile, never in the record or a log. In the app, Electron's safeStorage
 * seals it in the main process, using the system keychain or, in a Linux
 * Flatpak, the Secret portal's key for Althar's application id when available.
 * Main falls back only to a safe synchronous keyring for the current session;
 * the runtime never holds the key and asks main to seal and open. The command-line client
 * has no such key, so it keeps no secrets: the connections it shares with the
 * app stay the app's. Tests keep secrets in memory.
 *
 * Under load a secret can fail to be kept or given back for a moment: the
 * main process too busy to answer in time, the keychain slow to hand over its
 * key, or the system out of open files. Each is tried again, a moment apart,
 * before Althar says it couldn't. A secret the keychain answers it can no
 * longer open is another matter: it is lost, not late.
 */

/** Secrets couldn't be kept or given back. */
export class SecretsUnavailable extends Schema.TaggedError<SecretsUnavailable>()('SecretsUnavailable', {
  reason: Schema.String,
  /** The main process's own keyring refusal: its words are the person's, and only these are shown verbatim (words.ts). */
  keyring: Schema.optional(Schema.Boolean),
  /**
   * The secret is there, sealed, and the main process answered that it can't open it: sealed with a key the keychain no longer
   * holds. No ask will change that, so it is not tried again; the sign-in it was is lost, and its person makes it again.
   */
  unreadable: Schema.optional(Schema.Boolean),
}) {}

/**
 * A secret that couldn't be kept or opened is tried this many times more, a
 * moment apart, then twice that; not where there is no keyring to keep it,
 * or where the key to open it is gone, which a moment doesn't change.
 */
const AGAIN = {
  times: 2,
  schedule: Schedule.exponential(Duration.millis(200)),
  while: (error: SecretsUnavailable) => error.keyring !== true && error.unreadable !== true,
}

/** How long a secret opened is kept open in memory before the keychain is asked again. */
export const KEPT_OPEN = Duration.minutes(5)

/** What seals a secret so that only Althar can open it, and opens it again: in the app, its main process. */
export interface Sealer {
  /** The secret, sealed, as base64. */
  seal(value: string): Effect.Effect<string, SecretsUnavailable>
  open(sealed: string): Effect.Effect<string, SecretsUnavailable>
}

export class Secrets extends Context.Service<
  Secrets,
  {
    set(name: string, value: string): Effect.Effect<void, SecretsUnavailable>
    /** The secret, or null when there is none by that name. */
    get(name: string): Effect.Effect<string | null, SecretsUnavailable>
    remove(name: string): Effect.Effect<void, SecretsUnavailable>
  }
>()('@althar/runtime/Secrets') {
  /** Secrets in memory, for tests: kept for each runtime, or across several given the same map, as a keychain is across launches. */
  static readonly memory = (shared?: Map<string, string>): Layer.Layer<Secrets> =>
    Layer.sync(Secrets, () => {
      const kept = shared ?? new Map<string, string>()
      return Secrets.of({
        set: (name, value) => Effect.sync(() => void kept.set(name, value)),
        get: (name) => Effect.sync(() => kept.get(name) ?? null),
        remove: (name) => Effect.sync(() => void kept.delete(name)),
      })
    })

  /** No secrets: every one asked for isn't there, and keeping one says why. As in the command-line client. */
  static readonly none = (reason: string): Layer.Layer<Secrets> =>
    Layer.succeed(
      Secrets,
      Secrets.of({
        set: () => Effect.fail(new SecretsUnavailable({ reason })),
        get: () => Effect.fail(new SecretsUnavailable({ reason })),
        remove: () => Effect.void,
      }),
    )

  /**
   * Secrets sealed by `sealer`, each in a file of its own in `folder`, which
   * only this user can read; a file is replaced whole, so a secret is never
   * half written.
   *
   * A secret opened is kept open in this process's memory for `keptOpen`, a
   * few minutes: a code host's or tracker's every call reads its token, and
   * each read was a file read and a round trip to the main process, which
   * asks the keychain. One kept, changed or removed is forgotten at once, and
   * an open that began before the change never keeps what it read.
   */
  static readonly sealed = (
    folder: string,
    sealer: Sealer,
    { keptOpen = KEPT_OPEN }: { readonly keptOpen?: Duration.Duration } = {},
  ): Layer.Layer<Secrets> =>
    Layer.sync(Secrets, () => {
      const pathOf = (name: string) =>
        /^[\w.-]+$/.test(name) && !name.startsWith('.')
          ? Effect.succeed(join(folder, name))
          : Effect.fail(new SecretsUnavailable({ reason: `Not a secret's name: ${name}` }))
      const failed = (what: string) => (error: unknown) => new SecretsUnavailable({ reason: `Couldn't ${what}: ${String(error)}` })
      const attempt = <A>(what: string, run: () => A) => Effect.try({ try: run, catch: failed(what) })
      /** Secrets opened, by name, until when each is kept. */
      const open = new Map<string, { readonly value: string; readonly until: number }>()
      /** How many times each has changed, so an open that began before a change never keeps what it read. */
      const changes = new Map<string, number>()
      const changed = (name: string) => {
        changes.set(name, (changes.get(name) ?? 0) + 1)
        open.delete(name)
      }
      const keep = (name: string, value: string, at: number) =>
        Effect.map(Clock.currentTimeMillis, (now) => {
          if ((changes.get(name) ?? 0) === at && Duration.toMillis(keptOpen) > 0)
            open.set(name, { value, until: now + Duration.toMillis(keptOpen) })
        })
      /** The sealed secret on disk, read off the thread; null where none is kept. */
      const sealedAt = (path: string) =>
        Effect.tryPromise({
          try: async () => {
            try {
              return await readFile(path, 'utf8')
            } catch (error) {
              // None kept, unless its folder is a file: Windows says a name under one isn't there, POSIX that it isn't a folder.
              const blocked = (await stat(folder).catch(() => null))?.isDirectory() === false
              if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !blocked) return null
              throw error
            }
          },
          catch: failed('read the secret'),
        })
      return Secrets.of({
        set: (name, value) =>
          Effect.flatMap(pathOf(name), (path) =>
            Effect.gen(function* () {
              changed(name)
              const sealed = yield* sealer.seal(value)
              const at = yield* attempt('keep the secret', () => {
                mkdirSync(folder, { recursive: true, mode: 0o700 })
                chmodSync(folder, 0o700)
                const next = `${path}.next`
                writeFileSync(next, sealed, { mode: 0o600 })
                renameSync(next, path)
                // As it lands, in the same breath: what is kept open is what is on disk.
                changed(name)
                return changes.get(name) ?? 0
              })
              yield* keep(name, value, at)
            }).pipe(Effect.retry(AGAIN)),
          ),
        get: (name) =>
          Effect.flatMap(pathOf(name), (path) =>
            Effect.gen(function* () {
              const kept = open.get(name)
              if (kept !== undefined && kept.until > (yield* Clock.currentTimeMillis)) return kept.value
              const at = changes.get(name) ?? 0
              const sealed = yield* sealedAt(path)
              if (sealed === null) return null
              const value = yield* sealer.open(sealed)
              yield* keep(name, value, at)
              return value
            }).pipe(Effect.retry(AGAIN)),
          ),
        remove: (name) =>
          Effect.flatMap(pathOf(name), (path) =>
            Effect.sync(() => changed(name)).pipe(
              Effect.andThen(removeFully(path)),
              // Once it is gone too: an open that read it meanwhile keeps nothing.
              Effect.ensuring(Effect.sync(() => changed(name))),
              Effect.mapError((error) => new SecretsUnavailable({ reason: `Couldn't remove the secret: ${error.reason}` })),
            ),
          ),
      })
    })
}
