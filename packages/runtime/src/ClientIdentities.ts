import { randomBytes, webcrypto } from 'node:crypto'

import {
  API_VERSION,
  ApiError,
  ClientChallenge,
  ClientListOptions,
  type ClientPage,
  type ClientIdentity,
  ClientName,
  ClientPublicKey,
  ClientSignature,
  RegisteredClient,
  clientChallengeMessage,
} from '@althar/contracts'
import { Ids, newId, now } from '@althar/domain'
import { Clock, Context, Crypto, Deferred, Effect, Layer, PubSub, Schema, Stream, type Scope } from 'effect'
import { SqlClient } from 'effect/sql'

import { Instance } from './Instance'

const AUTHENTICATION_WINDOW = 30_000
const MAX_CHALLENGES = 512
const MAX_CHALLENGES_PER_DEVICE = 8
const MAX_CLIENTS = 100
const authenticationFailed = () =>
  new ApiError({ reason: 'AuthenticationFailed', message: 'This device could not authenticate. Pair it again from a trusted client.' })
const storageFailed = () => new ApiError({ reason: 'IdentityUnavailable', message: 'Althar could not read its device identities.' })

interface Registration {
  readonly name: string
  readonly publicKey: string
  readonly role: 'paired_device' | 'socket'
}

export class ClientIdentities extends Context.Service<
  ClientIdentities,
  {
    register(input: Registration): Effect.Effect<RegisteredClient, ApiError>
    list(input?: ClientListOptions): Effect.Effect<ClientPage, ApiError>
    revoke(deviceId: string): Effect.Effect<void, ApiError>
    challenge(deviceId: string): Effect.Effect<ClientChallenge, ApiError>
    authenticate(challenge: ClientChallenge, signature: string): Effect.Effect<ClientIdentity, ApiError>
    check(identity: ClientIdentity): Effect.Effect<void, ApiError>
    readonly revoked: Stream.Stream<string>
    watchRevocation(deviceId: string): Effect.Effect<Effect.Effect<void>, never, Scope.Scope>
  }
>()('@althar/runtime/ClientIdentities') {
  static readonly layer = Layer.effect(
    ClientIdentities,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const instance = yield* Instance
      const crypto = yield* Crypto.Crypto
      const revoked = yield* PubSub.sliding<string>(MAX_CLIENTS)
      const watchers = new Map<string, Set<Deferred.Deferred<void>>>()
      const challenges = new Map<string, { readonly challenge: ClientChallenge; readonly revision: number }>()
      const find = (deviceId: string) => sql<RegisteredClient & { actorId: string }>`
      SELECT c.device_id, d.name, c.public_key, c.role, c.revision, c.created_at, c.revoked_at, c.actor_id
      FROM client_devices c JOIN devices d ON d.id = c.device_id WHERE c.device_id = ${deviceId}`
      const list = (input: ClientListOptions = {}) =>
        Effect.gen(function* () {
          const options = yield* Schema.decodeUnknownEffect(ClientListOptions)(input).pipe(
            Effect.mapError(() => new ApiError({ reason: 'InvalidRequest', message: 'This device list request is invalid.' })),
          )
          const limit = options.limit ?? 50
          const clients = yield* sql<RegisteredClient>`
      SELECT c.device_id, d.name, c.public_key, c.role, c.revision, c.created_at, c.revoked_at
      FROM client_devices c JOIN devices d ON d.id = c.device_id
      WHERE c.device_id > ${options.after ?? ''} ORDER BY c.device_id LIMIT ${limit + 1}`.pipe(Effect.mapError(storageFailed))
          const page = clients.slice(0, limit)
          return { clients: page, next: clients.length > limit ? (page.at(-1)?.deviceId ?? null) : null }
        })

      const register = (input: Registration) =>
        Effect.gen(function* () {
          const publicKey = yield* Schema.decodeUnknownEffect(ClientPublicKey)(input.publicKey).pipe(Effect.mapError(authenticationFailed))
          const name = yield* Schema.decodeUnknownEffect(ClientName)(input.name.trim()).pipe(Effect.mapError(authenticationFailed))
          if (Buffer.from(publicKey, 'base64url').toString('base64url') !== publicKey) return yield* authenticationFailed()
          yield* Effect.tryPromise({
            try: () => webcrypto.subtle.importKey('raw', Buffer.from(publicKey, 'base64url'), 'Ed25519', false, ['verify']),
            catch: authenticationFailed,
          })
          return yield* Effect.gen(function* () {
            const [existing] = yield* sql<{ deviceId: string }>`SELECT device_id FROM client_devices WHERE public_key = ${publicKey}`
            if (existing !== undefined) {
              const [registered] = yield* find(existing.deviceId)
              if (registered !== undefined && registered.revokedAt === null && registered.role === input.role) {
                const { actorId: _actorId, ...client } = registered
                return client
              }
              return yield* new ApiError({
                reason: 'ClientAlreadyRegistered',
                message: 'This key already belongs to a device. Use a new key to change its authority or pair it again.',
              })
            }
            const [count] = yield* sql<{ count: number }>`SELECT count(*) AS count FROM client_devices WHERE revoked_at IS NULL`
            if ((count?.count ?? 0) >= MAX_CLIENTS)
              return yield* new ApiError({ reason: 'ClientLimit', message: 'Revoke an unused device before pairing another.' })
            const deviceId = yield* newId(Ids.device).pipe(Effect.provideService(Crypto.Crypto, crypto))
            const createdAt = yield* now
            yield* sql`INSERT INTO devices ${sql.insert({ id: deviceId, name, createdAt })}`
            yield* sql`INSERT INTO client_devices ${sql.insert({ deviceId, actorId: instance.personId, publicKey, role: input.role, revision: 1, createdAt })}`
            return { deviceId, name, publicKey, role: input.role, revision: 1, createdAt, revokedAt: null }
          }).pipe(sql.withTransaction)
        }).pipe(Effect.mapError((error) => (error instanceof ApiError ? error : storageFailed())))

      const revoke = (deviceId: string) =>
        Effect.gen(function* () {
          const [client] = yield* find(deviceId)
          if (client === undefined)
            return yield* new ApiError({ reason: 'ClientNotFound', message: 'This registered device was not found.' })
          yield* sql`UPDATE client_devices SET revoked_at = coalesce(revoked_at, ${yield* now}), revision = revision + 1 WHERE device_id = ${deviceId} AND revoked_at IS NULL`
          for (const [nonce, pending] of challenges) if (pending.challenge.deviceId === deviceId) challenges.delete(nonce)
          for (const watcher of watchers.get(deviceId) ?? []) yield* Deferred.succeed(watcher, undefined)
          yield* PubSub.publish(revoked, deviceId)
        }).pipe(Effect.mapError((error) => (error instanceof ApiError ? error : storageFailed())))

      const challenge = (deviceId: string) =>
        Effect.gen(function* () {
          const at = yield* Clock.currentTimeMillis
          for (const [nonce, pending] of challenges) if (pending.challenge.expiresAt <= at) challenges.delete(nonce)
          const [client] = yield* find(deviceId)
          if (client === undefined || client.revokedAt !== null || challenges.size >= MAX_CHALLENGES) return yield* authenticationFailed()
          // Multiple windows may authenticate concurrently, with a bound per device as well as for the whole home.
          if ([...challenges.values()].filter((pending) => pending.challenge.deviceId === deviceId).length >= MAX_CHALLENGES_PER_DEVICE)
            return yield* authenticationFailed()
          const made: ClientChallenge = {
            protocol: 1,
            homeId: instance.homeId,
            deviceId,
            apiVersion: API_VERSION,
            nonce: randomBytes(32).toString('base64url'),
            expiresAt: at + AUTHENTICATION_WINDOW,
          }
          challenges.set(made.nonce, { challenge: made, revision: client.revision })
          return made
        }).pipe(Effect.mapError((error) => (error instanceof ApiError ? error : storageFailed())))

      const authenticate = (input: ClientChallenge, said: string) =>
        Effect.gen(function* () {
          const challenge = yield* Schema.decodeUnknownEffect(ClientChallenge)(input).pipe(Effect.mapError(authenticationFailed))
          const signature = yield* Schema.decodeUnknownEffect(ClientSignature)(said).pipe(Effect.mapError(authenticationFailed))
          const pending = challenges.get(challenge.nonce)
          challenges.delete(challenge.nonce)
          if (
            pending === undefined ||
            clientChallengeMessage(pending.challenge) !== clientChallengeMessage(challenge) ||
            challenge.expiresAt <= (yield* Clock.currentTimeMillis)
          )
            return yield* authenticationFailed()
          const [client] = yield* find(challenge.deviceId)
          if (client === undefined || client.revokedAt !== null || client.revision !== pending.revision)
            return yield* authenticationFailed()
          const verified = yield* Effect.tryPromise({
            try: async () => {
              const key = await webcrypto.subtle.importKey('raw', Buffer.from(client.publicKey, 'base64url'), 'Ed25519', false, ['verify'])
              return webcrypto.subtle.verify(
                'Ed25519',
                key,
                Buffer.from(signature, 'base64url'),
                Buffer.from(clientChallengeMessage(challenge)),
              )
            },
            catch: authenticationFailed,
          })
          if (!verified) return yield* authenticationFailed()
          return { homeId: instance.homeId, actorId: client.actorId, deviceId: client.deviceId, role: client.role } satisfies ClientIdentity
        }).pipe(Effect.mapError((error) => (error instanceof ApiError ? error : storageFailed())))

      const check = (identity: ClientIdentity) =>
        Effect.gen(function* () {
          if (identity.homeId !== instance.homeId) return yield* authenticationFailed()
          if (
            identity.role === 'window' ||
            identity.role === 'internal' ||
            (identity.role === 'socket' && identity.deviceId === instance.deviceId)
          ) {
            if (identity.actorId !== instance.personId || identity.deviceId !== instance.deviceId) return yield* authenticationFailed()
            return
          }
          const [client] = yield* find(identity.deviceId)
          if (client === undefined || client.revokedAt !== null || client.actorId !== identity.actorId || client.role !== identity.role)
            return yield* new ApiError({
              reason: 'ClientRevoked',
              message: 'This device no longer has access. Pair it again from a trusted client.',
            })
        }).pipe(Effect.mapError((error) => (error instanceof ApiError ? error : storageFailed())))

      const watchRevocation = (deviceId: string) =>
        Effect.gen(function* () {
          const signal = yield* Deferred.make<void>()
          const listeners = watchers.get(deviceId) ?? new Set<Deferred.Deferred<void>>()
          watchers.set(deviceId, listeners)
          listeners.add(signal)
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              listeners.delete(signal)
              if (listeners.size === 0) watchers.delete(deviceId)
            }),
          )
          return Deferred.await(signal)
        })
      return ClientIdentities.of({
        register,
        list,
        revoke,
        challenge,
        authenticate,
        check,
        watchRevocation,
        revoked: Stream.fromPubSub(revoked),
      })
    }),
  )
}
