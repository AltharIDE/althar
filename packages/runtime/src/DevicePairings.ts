import { createHash, randomBytes, webcrypto } from 'node:crypto'

import {
  API_VERSION,
  ApiError,
  pairingLinkOf,
  type PairingCodeMade,
  type PairingStatus,
  type PhoneAccess,
  PairingRegistration,
  PairingTokenHash,
  pairingRegistrationMessage,
  type PairingInvitation,
  type RegisteredClient,
} from '@althar/contracts'
import { encodePairingCode } from '@althar/transport-node'
import { Clock, Context, Effect, Layer, Schema, Semaphore } from 'effect'

import { ClientIdentities } from './ClientIdentities'
import { Instance } from './Instance'

const LIFETIME = 5 * 60_000
const MAX_INVITATIONS = 32
/** How long past a code's five minutes the home still says which device used it. */
const FOLLOW_UP = 10 * 60_000
const refused = () =>
  new ApiError({
    reason: 'PairingRefused',
    message: 'This pairing code is invalid, expired or already used. Create a new code on the host.',
  })

interface Pending {
  readonly expiresAt: number
  publicKey?: string
  /** The device it paired, once it did. */
  deviceId?: string
}

/** Where phones reach the home, once its HTTPS listener is up: what a pairing code carries besides its token. */
export interface PhoneReach {
  readonly origin: string
  readonly tlsKeyPin: string
  /** The leaf certificate, DER as base64url. */
  readonly tlsCertificate: string
}

/** Turns This Mac's listener for phones on or off, where the home can (the desktop's own). The listener says where it answers (reachable). */
export type PhoneSwitch = (on: boolean) => Effect.Effect<void, ApiError>

const unreachable = () =>
  new ApiError({
    reason: 'PhonesCantReach',
    message: 'Phones can’t reach this home yet. Let phones in, or configure its HTTPS access on the host, then make a code.',
  })

/** Invitations deliberately expire on restart; registered device identities persist in the home. */
export class DevicePairings extends Context.Service<
  DevicePairings,
  {
    issue(tokenHash: string): Effect.Effect<PairingInvitation, ApiError>
    complete(input: PairingRegistration): Effect.Effect<RegisteredClient, ApiError>
    revokeConnection(deviceId: string): Effect.Effect<void, ApiError>
    /** A whole pairing code for a phone, its token made here: only its hash is kept. */
    create(): Effect.Effect<PairingCodeMade, ApiError>
    /** Whether a code made here is still waiting, ran out, or paired a device (and which). */
    status(tokenHash: string): Effect.Effect<PairingStatus, ApiError>
    /** Where phones reach the home, and whether it can be switched from a window. */
    access(): Effect.Effect<PhoneAccess>
    setAccess(on: boolean): Effect.Effect<PhoneAccess, ApiError>
    /** The HTTPS listener says where it answers as it starts, and null as it stops. */
    reachable(reach: PhoneReach | null): Effect.Effect<void>
    /** The desktop's own home lets a window turn its listener on and off. */
    switchable(change: PhoneSwitch, on: boolean): Effect.Effect<void>
  }
>()('@althar/runtime/DevicePairings') {
  static readonly layer = Layer.effect(
    DevicePairings,
    Effect.gen(function* () {
      const instance = yield* Instance
      const identities = yield* ClientIdentities
      const lock = yield* Semaphore.make(1)
      const invitations = new Map<string, Pending>()
      // Codes a device used, kept past the code's own five minutes so a window still asking hears it paired.
      const used = new Map<string, { readonly deviceId: string; readonly until: number }>()
      let reach: PhoneReach | null = null
      let change: PhoneSwitch | null = null
      let on = false
      const access = () =>
        Effect.succeed<PhoneAccess>({
          origin: reach?.origin ?? null,
          switchable: change !== null,
          on: change === null ? reach !== null : on,
        })
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
          const device = yield* identities.register({ name: input.name, publicKey: input.publicKey, role: 'socket' })
          pending.deviceId = device.deviceId
          const at = yield* Clock.currentTimeMillis
          for (const [key, kept] of used) if (kept.until <= at) used.delete(key)
          used.set(hash, { deviceId: device.deviceId, until: at + LIFETIME + FOLLOW_UP })
          return device
        }).pipe((effect) => lock.withPermit(effect))
      const create = () =>
        Effect.gen(function* () {
          const at = reach
          if (at === null) return yield* unreachable()
          const token = randomBytes(32).toString('base64url')
          const tokenHash = createHash('sha256').update(token).digest('hex')
          const invitation = yield* issue(tokenHash)
          const code = encodePairingCode({ ...invitation, protocol: 1, apiVersion: API_VERSION, ...at, token })
          const left = Math.max(0, invitation.expiresAt - (yield* Clock.currentTimeMillis))
          return { code, link: pairingLinkOf(code), tokenHash, expiresAt: invitation.expiresAt, left }
        })
      const status = (given: string) =>
        Effect.gen(function* () {
          const hash = yield* Schema.decodeUnknownEffect(PairingTokenHash)(given).pipe(Effect.mapError(refused))
          const pending = invitations.get(hash)
          const kept = used.get(hash)
          const deviceId =
            pending?.deviceId ?? (kept !== undefined && kept.until > (yield* Clock.currentTimeMillis) ? kept.deviceId : undefined)
          if (deviceId !== undefined) {
            const device = yield* identities.lookup(deviceId)
            if (device !== undefined && device.revokedAt === null) return { state: 'paired' as const, device }
          }
          if (pending === undefined || pending.expiresAt <= (yield* Clock.currentTimeMillis)) return { state: 'expired' as const }
          return { state: 'waiting' as const, expiresAt: pending.expiresAt }
        })
      const setAccess = (wanted: boolean) =>
        Effect.gen(function* () {
          if (change === null)
            return yield* new ApiError({
              reason: 'Forbidden',
              message: 'This home’s HTTPS access is set on its host: run althar-host configure-network there.',
            })
          yield* change(wanted)
          on = wanted
          if (!wanted) invitations.clear()
          return yield* access()
        }).pipe((effect) => lock.withPermit(effect))
      const revokeConnection = (deviceId: string) =>
        Effect.gen(function* () {
          const client = yield* identities.lookup(deviceId)
          if (client === undefined || client.role !== 'socket')
            return yield* new ApiError({ reason: 'ClientNotFound', message: 'Choose a connection device registered on this home.' })
          yield* identities.revoke(deviceId)
        })
      return DevicePairings.of({
        issue,
        complete,
        revokeConnection,
        create,
        status,
        access,
        setAccess,
        reachable: (given) =>
          Effect.sync(() => {
            reach = given
          }),
        switchable: (given, wasOn) =>
          Effect.sync(() => {
            change = given
            on = wasOn
          }),
      })
    }),
  )
}
