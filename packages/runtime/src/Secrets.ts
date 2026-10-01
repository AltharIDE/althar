import { execFile, spawn } from 'node:child_process'

import { Context, Effect, Layer, Schema } from 'effect'

/*
 * Where Charrette keeps a secret, such as a code host's token
 * (docs/architecture/06, "External auth boundaries"): the system keychain,
 * under the service "Charrette" and a name the store keeps, never the store,
 * the record or a log. On macOS that is the login keychain, through the
 * `security` tool; a value goes to it on standard input, so it never shows in
 * a process list. Tests and the end-to-end suite keep secrets in memory.
 */

const SERVICE = 'Charrette'

/** The keychain couldn't keep or give back a secret. */
export class SecretsUnavailable extends Schema.TaggedError<SecretsUnavailable>()('SecretsUnavailable', {
  reason: Schema.String,
}) {}

export class Secrets extends Context.Service<
  Secrets,
  {
    set(name: string, value: string): Effect.Effect<void, SecretsUnavailable>
    /** The secret, or null when there is none by that name. */
    get(name: string): Effect.Effect<string | null, SecretsUnavailable>
    remove(name: string): Effect.Effect<void, SecretsUnavailable>
  }
>()('@charrette/runtime/Secrets') {
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

  /** The macOS login keychain. Elsewhere, every call says there is no keychain yet. */
  static readonly keychain: Layer.Layer<Secrets> = Layer.succeed(
    Secrets,
    process.platform === 'darwin'
      ? Secrets.of({
          // Base64 keeps the value one word for `security -i`, whatever it holds.
          set: (name, value) =>
            Effect.suspend(() =>
              interactive(`add-generic-password -U -s ${SERVICE} -a ${word(name)} -w ${Buffer.from(value).toString('base64')}\n`),
            ),
          get: (name) =>
            Effect.callback<string | null, SecretsUnavailable>((resume) => {
              execFile(
                'security',
                ['find-generic-password', '-s', SERVICE, '-a', name, '-w'],
                { timeout: 15_000 },
                (error, stdout, stderr) => {
                  // 44: no such item.
                  if (error !== null && error.code === 44) return resume(Effect.succeed(null))
                  if (error !== null) return resume(Effect.fail(new SecretsUnavailable({ reason: stderr.trim() || error.message })))
                  resume(Effect.succeed(Buffer.from(stdout.trim(), 'base64').toString('utf8')))
                },
              )
            }),
          remove: (name) =>
            Effect.callback<void, SecretsUnavailable>((resume) => {
              execFile('security', ['delete-generic-password', '-s', SERVICE, '-a', name], { timeout: 15_000 }, (error, _stdout, stderr) =>
                resume(
                  error === null || error.code === 44
                    ? Effect.void
                    : Effect.fail(new SecretsUnavailable({ reason: stderr.trim() || error.message })),
                ),
              )
            }),
        })
      : Secrets.of({
          set: () =>
            Effect.fail(new SecretsUnavailable({ reason: 'Charrette keeps secrets in the macOS keychain, and this is not macOS.' })),
          get: () => Effect.succeed(null),
          remove: () => Effect.void,
        }),
  )
}

/** A name as one word for `security -i`: names are Charrette's own ids, so this only guards against a mistake. */
const word = (name: string) => {
  if (!/^[\w.-]+$/.test(name)) throw new Error(`Not a keychain name: ${name}`)
  return name
}

/** Runs `security` commands from standard input, so no secret is in its arguments. */
const interactive = (commands: string): Effect.Effect<void, SecretsUnavailable> =>
  Effect.callback<void, SecretsUnavailable>((resume) => {
    const child = spawn('security', ['-i'], { stdio: ['pipe', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => resume(Effect.fail(new SecretsUnavailable({ reason: error.message }))))
    child.on('close', (code) =>
      resume(
        code === 0 && stderr.trim() === ''
          ? Effect.void
          : Effect.fail(new SecretsUnavailable({ reason: stderr.trim() || `security exited ${code}` })),
      ),
    )
    child.stdin.end(commands)
  })
