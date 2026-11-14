import { generateKeyPairSync, sign } from 'node:crypto'
import { tmpdir } from 'node:os'

import { clientChallengeMessage } from '@althar/contracts'
import { bumpRevision, Database, Ledger } from '@althar/persistence-sqlite'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { TestClock } from 'effect/testing'

import { ClientIdentities } from '../src/ClientIdentities'
import { RuntimeConfig, WebCrypto } from '../src/Config'
import { Instance } from '../src/Instance'

const config = Layer.succeed(RuntimeConfig, { worktreeRoot: tmpdir(), appVersion: 'test', deviceName: 'Host' })
const base = Instance.layer.pipe(
  Layer.provideMerge(Ledger.layer),
  Layer.provideMerge(Database.layer({ filename: ':memory:' })),
  Layer.provideMerge(WebCrypto),
  Layer.provideMerge(config),
)
const env = ClientIdentities.layer.pipe(Layer.provideMerge(base))

const keys = () => {
  const pair = generateKeyPairSync('ed25519')
  const publicKey = pair.publicKey.export({ format: 'jwk' }).x
  if (publicKey === undefined) throw new Error('Ed25519 public key has no x coordinate')
  return { publicKey, privateKey: pair.privateKey }
}

describe('authenticated client identities', () => {
  it.effect('rejects a proof made before the credential revision changed, while a fresh challenge still authenticates', () =>
    Effect.gen(function* () {
      const identities = yield* ClientIdentities
      const pair = keys()
      const device = yield* identities.register({ name: 'Desktop', publicKey: pair.publicKey, role: 'paired_device' })
      const before = yield* identities.challenge(device.deviceId)
      yield* bumpRevision('client_devices', device.deviceId, device.revision)
      const signChallenge = (challenge: Parameters<typeof clientChallengeMessage>[0]) =>
        sign(null, Buffer.from(clientChallengeMessage(challenge)), pair.privateKey).toString('base64url')
      assert.strictEqual((yield* Effect.flip(identities.authenticate(before, signChallenge(before)))).reason, 'AuthenticationFailed')
      const after = yield* identities.challenge(device.deviceId)
      assert.strictEqual((yield* identities.authenticate(after, signChallenge(after))).deviceId, device.deviceId)
    }).pipe(Effect.provide(env)),
  )

  it.effect('refuses malformed enrollment, unknown devices and forged home, actor or authority claims', () =>
    Effect.gen(function* () {
      const identities = yield* ClientIdentities
      const instance = yield* Instance
      const pair = keys()
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
      const noncanonical = pair.publicKey.slice(0, -1) + alphabet[alphabet.indexOf(pair.publicKey.at(-1) ?? '') + 1]
      for (const input of [
        { name: 'Bad key', publicKey: 'bad' },
        { name: 'Noncanonical key', publicKey: noncanonical },
        { name: '  ', publicKey: pair.publicKey },
      ]) {
        assert.strictEqual((yield* Effect.flip(identities.register({ ...input, role: 'socket' }))).reason, 'AuthenticationFailed')
      }
      const device = yield* identities.register({ name: 'CLI', publicKey: pair.publicKey, role: 'socket' })
      const identity = { homeId: instance.homeId, actorId: instance.personId, deviceId: instance.deviceId, role: 'window' as const }
      yield* identities.check(identity)
      assert.strictEqual(
        (yield* Effect.flip(identities.check({ ...identity, homeId: `home_${'0'.repeat(32)}` }))).reason,
        'AuthenticationFailed',
      )
      assert.strictEqual(
        (yield* Effect.flip(identities.check({ ...identity, actorId: `act_${'0'.repeat(32)}` }))).reason,
        'AuthenticationFailed',
      )
      assert.strictEqual(
        (yield* Effect.flip(identities.check({ ...identity, deviceId: device.deviceId, role: 'paired_device' }))).reason,
        'ClientRevoked',
      )
      assert.strictEqual(
        (yield* Effect.flip(identities.check({ ...identity, deviceId: device.deviceId, role: 'socket', actorId: `act_${'0'.repeat(32)}` })))
          .reason,
        'ClientRevoked',
      )
      assert.strictEqual((yield* Effect.flip(identities.challenge(instance.deviceId))).reason, 'AuthenticationFailed')
      assert.strictEqual((yield* Effect.flip(identities.revoke(instance.deviceId))).reason, 'ClientNotFound')
      const challenge = yield* identities.challenge(device.deviceId)
      assert.strictEqual((yield* Effect.flip(identities.authenticate(challenge, 'malformed'))).reason, 'AuthenticationFailed')
      yield* identities.revoke(device.deviceId)
      yield* identities.revoke(device.deviceId)
      assert.strictEqual((yield* identities.list()).clients[0]?.revision, 2)
      assert.strictEqual(
        (yield* Effect.flip(identities.register({ name: 'Reused revoked key', publicKey: pair.publicKey, role: 'socket' }))).reason,
        'ClientAlreadyRegistered',
      )
    }).pipe(Effect.provide(env)),
  )

  it.effect('bounds enrollment and pending challenges across devices and reclaims expired or revoked capacity', () =>
    Effect.gen(function* () {
      const identities = yield* ClientIdentities
      const devices = yield* Effect.forEach(
        Array.from({ length: 100 }, (_, i) => i),
        (i) => identities.register({ name: `Device ${i}`, publicKey: keys().publicKey, role: 'socket' }),
      )
      const extra = { name: 'Extra', publicKey: keys().publicKey, role: 'socket' as const }
      assert.strictEqual((yield* Effect.flip(identities.register(extra))).reason, 'ClientLimit')
      yield* Effect.forEach(devices.slice(0, 64), (device) =>
        Effect.forEach(Array.from({ length: 8 }), () => identities.challenge(device.deviceId)),
      )
      const next = devices[64]
      const first = devices[0]
      if (next === undefined || first === undefined) throw new Error('Missing enrolled devices')
      assert.strictEqual((yield* Effect.flip(identities.challenge(next.deviceId))).reason, 'AuthenticationFailed')
      yield* TestClock.adjust('31 seconds')
      yield* identities.challenge(next.deviceId)
      yield* identities.revoke(first.deviceId)
      yield* identities.register(extra)
      assert.lengthOf((yield* identities.list({ limit: 100 })).clients, 100)
    }).pipe(Effect.provide(env)),
  )

  it.effect('paginates registered and revoked devices without dropping audit entries', () =>
    Effect.gen(function* () {
      const identities = yield* ClientIdentities
      const registered = yield* Effect.forEach(['One', 'Two', 'Three'], (name) =>
        identities.register({ name, publicKey: keys().publicKey, role: 'socket' }),
      )
      const oldest = registered[0]
      if (oldest === undefined) throw new Error('Missing device')
      yield* identities.revoke(oldest.deviceId)
      const first = yield* identities.list({ limit: 2 })
      assert.lengthOf(first.clients, 2)
      assert.isNotNull(first.next)
      const second = yield* identities.list({ after: first.next ?? undefined, limit: 2 })
      assert.lengthOf(second.clients, 1)
      assert.isNull(second.next)
      assert.sameMembers(
        [...first.clients, ...second.clients].map((client) => client.deviceId),
        registered.map((client) => client.deviceId),
      )
      assert.strictEqual((yield* Effect.flip(identities.list({ limit: 0 }))).reason, 'InvalidRequest')
    }).pipe(Effect.provide(env)),
  )

  it.effect('allows simultaneous challenges up to the device bound and expires unused challenges', () =>
    Effect.gen(function* () {
      const identities = yield* ClientIdentities
      const pair = keys()
      const device = yield* identities.register({ name: 'Desktop', publicKey: pair.publicKey, role: 'paired_device' })
      const challenges = yield* Effect.forEach(Array.from({ length: 8 }), () => identities.challenge(device.deviceId))
      assert.strictEqual(new Set(challenges.map((challenge) => challenge.nonce)).size, 8)
      assert.strictEqual((yield* Effect.flip(identities.challenge(device.deviceId))).reason, 'AuthenticationFailed')
      for (const challenge of challenges) {
        const signature = sign(null, Buffer.from(clientChallengeMessage(challenge)), pair.privateKey).toString('base64url')
        assert.strictEqual((yield* identities.authenticate(challenge, signature)).deviceId, device.deviceId)
      }
      yield* identities.challenge(device.deviceId)
      yield* TestClock.adjust('31 seconds')
      yield* identities.challenge(device.deviceId)
    }).pipe(Effect.provide(env)),
  )

  it.effect('binds a signature to a registered device and home; a challenge can be used only once', () =>
    Effect.gen(function* () {
      const identities = yield* ClientIdentities
      const instance = yield* Instance
      const pair = keys()
      const device = yield* identities.register({ name: 'Phone', publicKey: pair.publicKey, role: 'paired_device' })
      const challenge = yield* identities.challenge(device.deviceId)
      const signature = sign(null, Buffer.from(clientChallengeMessage(challenge)), pair.privateKey).toString('base64url')
      const authenticated = yield* identities.authenticate(challenge, signature)
      assert.deepStrictEqual(authenticated, {
        homeId: instance.homeId,
        actorId: instance.personId,
        deviceId: device.deviceId,
        role: 'paired_device',
      })
      const replayed = yield* Effect.flip(identities.authenticate(challenge, signature))
      assert.strictEqual(replayed.reason, 'AuthenticationFailed')
      assert.notStrictEqual(authenticated.deviceId, instance.deviceId)
    }).pipe(Effect.provide(env)),
  )

  it.effect('refuses a forged signature, changed home or API version, and expired challenges', () =>
    Effect.gen(function* () {
      const identities = yield* ClientIdentities
      const pair = keys()
      const stranger = keys()
      const device = yield* identities.register({ name: 'Desktop', publicKey: pair.publicKey, role: 'paired_device' })
      const challenge = yield* identities.challenge(device.deviceId)
      const forged = sign(null, Buffer.from(clientChallengeMessage(challenge)), stranger.privateKey).toString('base64url')
      assert.strictEqual((yield* Effect.flip(identities.authenticate(challenge, forged))).reason, 'AuthenticationFailed')
      const another = yield* identities.challenge(device.deviceId)
      const signature = sign(null, Buffer.from(clientChallengeMessage(another)), pair.privateKey).toString('base64url')
      assert.strictEqual(
        (yield* Effect.flip(identities.authenticate({ ...another, apiVersion: another.apiVersion + 1 }, signature))).reason,
        'AuthenticationFailed',
      )
      const expired = yield* identities.challenge(device.deviceId)
      const lateSignature = sign(null, Buffer.from(clientChallengeMessage(expired)), pair.privateKey).toString('base64url')
      yield* TestClock.adjust('1 minute')
      assert.strictEqual((yield* Effect.flip(identities.authenticate(expired, lateSignature))).reason, 'AuthenticationFailed')
    }).pipe(Effect.provide(env)),
  )

  it.effect('revokes access for existing identities and all outstanding challenges, retaining the device audit record', () =>
    Effect.gen(function* () {
      const identities = yield* ClientIdentities
      const pair = keys()
      const device = yield* identities.register({ name: 'Old phone', publicKey: pair.publicKey, role: 'paired_device' })
      const challenge = yield* identities.challenge(device.deviceId)
      const signature = sign(null, Buffer.from(clientChallengeMessage(challenge)), pair.privateKey).toString('base64url')
      const identity = yield* identities.authenticate(challenge, signature)
      const waiting = yield* identities.challenge(device.deviceId)
      yield* identities.revoke(device.deviceId)
      assert.strictEqual((yield* Effect.flip(identities.check(identity))).reason, 'ClientRevoked')
      assert.strictEqual(
        (yield* Effect.flip(
          identities.authenticate(waiting, sign(null, Buffer.from(clientChallengeMessage(waiting)), pair.privateKey).toString('base64url')),
        )).reason,
        'AuthenticationFailed',
      )
      assert.isNotNull((yield* identities.list()).clients[0]?.revokedAt)
      assert.strictEqual((yield* Effect.flip(identities.challenge(device.deviceId))).reason, 'AuthenticationFailed')
    }).pipe(Effect.provide(env)),
  )

  it.effect('keeps key registration idempotent and never upgrades socket authority by registering the same key again', () =>
    Effect.gen(function* () {
      const identities = yield* ClientIdentities
      const pair = keys()
      const first = yield* identities.register({ name: 'CLI', publicKey: pair.publicKey, role: 'socket' })
      assert.deepStrictEqual(yield* identities.register({ name: 'CLI', publicKey: pair.publicKey, role: 'socket' }), first)
      assert.strictEqual(
        (yield* Effect.flip(identities.register({ name: 'CLI', publicKey: pair.publicKey, role: 'paired_device' }))).reason,
        'ClientAlreadyRegistered',
      )
    }).pipe(Effect.provide(env)),
  )
})
