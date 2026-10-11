import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { Context, Duration, Effect, Layer, Schedule, Schema } from 'effect'

/*
 * Where Althar keeps a secret, such as a code host's token
 * (docs/architecture/06, "Signing in"): sealed, in a file of its own in the
 * profile, never in the record or a log. Only Althar can open one. In the
 * app, Electron's safeStorage seals it in the main process, with a key the
 * system keychain keeps for the signed app alone: another process asking for
 * that key, an agent's shell among them, gets a prompt the person would
 * notice. The runtime never holds the key; it asks main to seal and open.
 *
 * The command-line client has no such key, so it keeps no secrets: the
 * connections it shares with the app stay the app's. Tests keep secrets in
 * memory.
 *
 * Under load a secret can fail to be kept or given back for a moment: the
 * main process too busy to answer in time, the keychain slow to hand over its
 * key, or the system out of open files. Each is tried again, a moment apart,
 * before Althar says it couldn't.
 */

/** Secrets couldn't be kept or given back. */
export class SecretsUnavailable extends Schema.TaggedError<SecretsUnavailable>()('SecretsUnavailable', {
  reason: Schema.String,
}) {}

/** A secret that couldn't be kept or opened is tried this many times more, a moment apart, then twice that. */
const AGAIN = { times: 2, schedule: Schedule.exponential(Duration.millis(200)) }

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
  /** Secrets in memory, for tests. */
  static readonly memory = (): Layer.Layer<Secrets> =>
    Layer.sync(Secrets, () => {
      const kept = new Map<string, string>()
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
   */
  static readonly sealed = (folder: string, sealer: Sealer): Layer.Layer<Secrets> =>
    Layer.sync(Secrets, () => {
      const pathOf = (name: string) =>
        /^[\w.-]+$/.test(name) && !name.startsWith('.')
          ? Effect.succeed(join(folder, name))
          : Effect.fail(new SecretsUnavailable({ reason: `Not a secret's name: ${name}` }))
      const attempt = <A>(what: string, run: () => A) =>
        Effect.try({ try: run, catch: (error) => new SecretsUnavailable({ reason: `Couldn't ${what}: ${String(error)}` }) })
      return Secrets.of({
        set: (name, value) =>
          Effect.flatMap(pathOf(name), (path) =>
            Effect.gen(function* () {
              const sealed = yield* sealer.seal(value)
              yield* attempt('keep the secret', () => {
                mkdirSync(folder, { recursive: true, mode: 0o700 })
                chmodSync(folder, 0o700)
                const next = `${path}.next`
                writeFileSync(next, sealed, { mode: 0o600 })
                renameSync(next, path)
              })
            }).pipe(Effect.retry(AGAIN)),
          ),
        get: (name) =>
          Effect.flatMap(pathOf(name), (path) =>
            Effect.gen(function* () {
              const sealed = yield* attempt('read the secret', () => {
                try {
                  return readFileSync(path, 'utf8')
                } catch (error) {
                  if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
                  throw error
                }
              })
              return sealed === null ? null : yield* sealer.open(sealed)
            }).pipe(Effect.retry(AGAIN)),
          ),
        remove: (name) => Effect.flatMap(pathOf(name), (path) => attempt('remove the secret', () => rmSync(path, { force: true }))),
      })
    })
}
