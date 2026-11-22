import { hostname } from 'node:os'
import { join } from 'node:path'

import { ApiError } from '@althar/contracts'
import { DevicePairings, listenNetworkApi } from '@althar/runtime'
import { readPrivate, writePrivate } from '@althar/runtime/privateFiles'
import { selfSignedCertificate } from '@althar/transport-node'
import { Clock, Context, Effect, Exit, Scope } from 'effect'

/*
 * Letting phones in to This Mac's home (Settings › Computers, Pair a phone):
 * the runtime's HTTPS listener, the one althar-host opens on a server, on the
 * Mac's own Bonjour name on the local network, with a certificate the Mac
 * makes itself. A phone trusts it by the pin and the certificate its pairing
 * code carries, so the key is made once and kept: re-pairing is never needed.
 * Whether phones are let in is kept too, so it holds across restarts. Every
 * connection still proves a paired device's key before it can do anything;
 * the only thing open to anyone is completing a pairing with a live code.
 */

export const PHONE_PORT = 6769
const SETTING = 'phones.json'
const TLS = 'phones-tls.json'

/** The Mac's name on the local network, as Bonjour answers it: `Studio-Mac.local`. */
export const localName = (name = hostname()) => {
  const bare = name
    .replace(/\.local\.?$/i, '')
    .replace(/[^A-Za-z0-9-]/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${bare === '' ? 'althar' : bare}.local`.toLowerCase()
}

const failed = (message: string) => new ApiError({ reason: 'PhonesCantReach', message })

const readJson = (path: string) =>
  Effect.promise(async () => {
    const bytes = await readPrivate(path, 64 * 1024).catch(() => null)
    if (bytes === null) return undefined
    try {
      return JSON.parse(bytes.toString('utf8')) as unknown
    } catch {
      return undefined
    }
  })

/** The kept key and certificate, made the first time; the certificate is made again for a new name, the key kept. */
export const tlsFor = (profile: string, name: string) =>
  Effect.gen(function* () {
    const kept = yield* readJson(join(profile, TLS))
    const was =
      typeof kept === 'object' && kept !== null && 'key' in kept && 'certificate' in kept && 'name' in kept
        ? (kept as { key: string; certificate: string; name: string })
        : undefined
    if (was !== undefined && was.name === name) return was
    const made = selfSignedCertificate(`Althar on ${name}`, [name, 'localhost'], yield* Clock.currentTimeMillis, was?.key)
    const next = { name, ...made }
    yield* Effect.tryPromise({
      try: () => writePrivate(join(profile, TLS), JSON.stringify(next), true),
      catch: () => failed('Althar couldn’t keep the certificate phones check. Check the profile’s folder and try again.'),
    })
    return next
  })

/**
 * Lets a window switch phones in and out of the runtime's home, and opens the
 * listener at once where the person had let them in before.
 */
export const phonesIn = (profile: string, context: Context.Context<never>) =>
  Effect.gen(function* () {
    const pairings = Context.get(context as Context.Context<DevicePairings>, DevicePairings)
    let open: Scope.Closeable | undefined
    const close = Effect.suspend(() => {
      const was = open
      open = undefined
      return was === undefined ? Effect.void : Scope.close(was, Exit.void)
    })
    const keep = (on: boolean) =>
      Effect.promise(() => writePrivate(join(profile, SETTING), JSON.stringify({ on }), true).catch(() => false))
    const start = Effect.gen(function* () {
      if (open !== undefined) return
      const name = localName()
      const tls = yield* tlsFor(profile, name)
      const scope = yield* Scope.make()
      yield* listenNetworkApi({
        origin: `https://${name}:${PHONE_PORT}`,
        address: '0.0.0.0',
        port: PHONE_PORT,
        certificate: Buffer.from(tls.certificate),
        key: Buffer.from(tls.key),
        version: process.env.ALTHAR_APP_VERSION ?? '0.0.0',
      }).pipe(
        Effect.provideContext(context as never),
        Scope.provide(scope),
        Effect.tapError(() => Scope.close(scope, Exit.void)),
        Effect.mapError(() =>
          failed(`Phones can’t be let in: port ${PHONE_PORT} is taken, or this Mac’s network refused it. Quit what uses it and try again.`),
        ),
      )
      open = scope
    })
    const change = (on: boolean) =>
      Effect.gen(function* () {
        if (on) yield* start
        else yield* close
        yield* keep(on)
      })
    const setting = yield* readJson(join(profile, SETTING))
    const wasOn = typeof setting === 'object' && setting !== null && 'on' in setting && setting.on === true
    yield* pairings.switchable(change, wasOn)
    if (wasOn) yield* start.pipe(Effect.catch((error) => Effect.logWarning('Phones could not be let in', error.message)))
    yield* Effect.addFinalizer(() => close)
  })
