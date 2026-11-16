import { createHash, webcrypto } from 'node:crypto'

import {
  ApiError,
  PairingRegistration,
  PairingTokenHash,
  pairingRegistrationMessage,
  type PairingInvitation,
  type RegisteredClient,
} from '@althar/contracts'
import { Clock, Context, Effect, Layer, Schema, Semaphore } from 'effect'

import { ClientIdentities } from './ClientIdentities'
import { Instance } from './Instance'

const LIFETIME = 5 * 60_000
const MAX_INVITATIONS = 32
const refused = () =>
  new ApiError({
    reason: 'PairingRefused',
    message: 'This pairing code is invalid, expired or already used. Create a new code on the host.',
  })

interface Pending {
  readonly expiresAt: number
  publicKey?: string
}

/** Invitations deliberately expire on restart; registered device identities persist in the home. */
export class DevicePairings extends Context.Service<
  DevicePairings,
  {
    issue(tokenHash: string): Effect.Effect<PairingInvitation, ApiError>
    complete(input: PairingRegistration): Effect.Effect<RegisteredClient, ApiError>
    revokeConnection(deviceId: string): Effect.Effect<void, ApiError>
  }
>()('@althar/runtime/DevicePairings') {
  static readonly layer = Layer.effect(
    DevicePairings,
    Effect.gen(function* () {
      const instance = yield* Instance
      const identities = yield* ClientIdentities
      const lock = yield* Semaphore.make(1)
      const invitations = new Map<string, Pending>()
      const issue = (given: string) =>
        Effect.gen(function* () {
          const hash = yield* Schema.decodeUnknownEffect(PairingTokenHash)(given).pipe(Effect.mapError(refused))
          const at = yield* Clock.currentTimeMillis
          for (const [key, pending] of invitations) if (pending.expiresAt <= at) invitations.delete(key)
          const existing = invitations.get(hash)
          if (existing !== undefined) return { homeId: instance.homeId, expiresAt: existing.expiresAt }
          if (invitations.size >= MAX_INVITATIONS)
            return yield* new ApiError({
              reason: 'PairingLimit',
              message: 'Several pairing codes are active. Wait five minutes before creating another.',
            })
          const expiresAt = at + LIFETIME
          invitations.set(hash, { expiresAt })
          return { homeId: instance.homeId, expiresAt }
        })
      const complete = (given: PairingRegistration) =>
        Effect.gen(function* () {
          const input = yield* Schema.decodeUnknownEffect(PairingRegistration)(given).pipe(Effect.mapError(refused))
          if (
            input.homeId !== instance.homeId ||
            input.name !== input.name.trim() ||
            Array.from(input.name).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) ||
            Buffer.from(input.token, 'base64url').toString('base64url') !== input.token ||
            Buffer.from(input.publicKey, 'base64url').toString('base64url') !== input.publicKey ||
            Buffer.from(input.signature, 'base64url').toString('base64url') !== input.signature
          )
            return yield* refused()
          const hash = createHash('sha256').update(input.token).digest('hex')
          const pending = invitations.get(hash)
          if (
            pending === undefined ||
            pending.expiresAt <= (yield* Clock.currentTimeMillis) ||
            (pending.publicKey !== undefined && pending.publicKey !== input.publicKey)
          )
            return yield* refused()
          const verified = yield* Effect.tryPromise({
            try: async () => {
              const key = await webcrypto.subtle.importKey('raw', Buffer.from(input.publicKey, 'base64url'), 'Ed25519', false, ['verify'])
              return webcrypto.subtle.verify(
                'Ed25519',
                key,
                Buffer.from(input.signature, 'base64url'),
                Buffer.from(pairingRegistrationMessage(input)),
              )
            },
            catch: refused,
          })
          if (!verified || pending.expiresAt <= (yield* Clock.currentTimeMillis)) return yield* refused()
          // Claim before the first durable write. The same key may retry a lost reply;
          // no second key can consume the invitation, including after an interrupted write.
          pending.publicKey = input.publicKey
          return yield* identities.register({ name: input.name, publicKey: input.publicKey, role: 'socket' })
        }).pipe((effect) => lock.withPermit(effect))
      const revokeConnection = (deviceId: string) =>
        Effect.gen(function* () {
          const client = yield* identities.lookup(deviceId)
          if (client === undefined || client.role !== 'socket')
            return yield* new ApiError({ reason: 'ClientNotFound', message: 'Choose a connection device registered on this home.' })
          yield* identities.revoke(deviceId)
        })
      return DevicePairings.of({ issue, complete, revokeConnection })
    }),
  )
}
