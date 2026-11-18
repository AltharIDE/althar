import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { tmpdir } from 'node:os'

import { pairingRegistrationMessage } from '@althar/contracts'
import { Database, Ledger } from '@althar/persistence-sqlite'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { TestClock } from 'effect/testing'

import { ClientIdentities } from '../src/ClientIdentities'
import { DevicePairings } from '../src/DevicePairings'
import { RuntimeConfig, WebCrypto } from '../src/Config'
import { Instance } from '../src/Instance'

const base = Instance.layer.pipe(
  Layer.provideMerge(Ledger.layer),
  Layer.provideMerge(Database.layer({ filename: ':memory:' })),
  Layer.provideMerge(WebCrypto),
  Layer.provideMerge(Layer.succeed(RuntimeConfig, { worktreeRoot: tmpdir(), appVersion: 'test', deviceName: 'Host' })),
)
const env = DevicePairings.layer.pipe(Layer.provideMerge(ClientIdentities.layer), Layer.provideMerge(base))
const token = () => randomBytes(32).toString('base64url')
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const request = (homeId: string, invitation: string) => {
  const keys = generateKeyPairSync('ed25519')
  const publicKey = keys.publicKey.export({ format: 'jwk' }).x
  if (publicKey === undefined) throw new Error('No public key')
  const input = { homeId, token: invitation, name: 'Desktop', publicKey }
  return { ...input, signature: sign(null, Buffer.from(pairingRegistrationMessage(input)), keys.privateKey).toString('base64url') }
}

describe('device pairing invitations', () => {
  it.effect('consumes an invitation for one key, permits lost-reply retries and never grants approval authority', () =>
    Effect.gen(function* () {
      const pairings = yield* DevicePairings
      const identities = yield* ClientIdentities
      const secret = token()
      const invitation = yield* pairings.issue(hash(secret))
      const input = request(invitation.homeId, secret)
      const first = yield* pairings.complete(input)
      const retry = yield* pairings.complete(input)
      assert.strictEqual(first.deviceId, retry.deviceId)
      assert.strictEqual(first.role, 'socket')
      assert.strictEqual((yield* identities.list()).clients.length, 1)
      assert.strictEqual((yield* Effect.flip(pairings.complete(request(invitation.homeId, secret)))).reason, 'PairingRefused')
    }).pipe(Effect.provide(env)),
  )

  it.effect('serializes competing claims and admits exactly one device', () =>
    Effect.gen(function* () {
      const pairings = yield* DevicePairings
      const secret = token()
      const invitation = yield* pairings.issue(hash(secret))
      const results = yield* Effect.all(
        [request(invitation.homeId, secret), request(invitation.homeId, secret)].map((input) =>
          pairings.complete(input).pipe(Effect.result),
        ),
        { concurrency: 'unbounded' },
      )
      assert.strictEqual(results.filter((result) => result._tag === 'Success').length, 1)
      assert.strictEqual((yield* (yield* ClientIdentities).list()).clients.length, 1)
    }).pipe(Effect.provide(env)),
  )

  it.effect('rejects expired, cross-home and forged claims without spending the valid invitation', () =>
    Effect.gen(function* () {
      const pairings = yield* DevicePairings
      const secret = token()
      const invitation = yield* pairings.issue(hash(secret))
      const input = request(invitation.homeId, secret)
      for (const invalid of [
        { ...input, homeId: `home_${'0'.repeat(32)}` },
        { ...input, name: 'Another device' },
        { ...input, token: token() },
      ])
        assert.strictEqual((yield* Effect.flip(pairings.complete(invalid))).reason, 'PairingRefused')
      yield* TestClock.adjust('5 minutes')
      assert.strictEqual((yield* Effect.flip(pairings.complete(input))).reason, 'PairingRefused')
      assert.strictEqual((yield* (yield* ClientIdentities).list()).clients.length, 0)
    }).pipe(Effect.provide(env)),
  )

  it.effect('does not let a retry resurrect a revoked device or revoke a trusted approval key', () =>
    Effect.gen(function* () {
      const pairings = yield* DevicePairings
      const identities = yield* ClientIdentities
      const secret = token()
      const invitation = yield* pairings.issue(hash(secret))
      const input = request(invitation.homeId, secret)
      const device = yield* pairings.complete(input)
      yield* pairings.revokeConnection(device.deviceId)
      assert.strictEqual((yield* Effect.flip(pairings.complete(input))).reason, 'ClientAlreadyRegistered')
      const trusted = yield* identities.register({ ...request(invitation.homeId, token()), role: 'paired_device' })
      assert.strictEqual((yield* Effect.flip(pairings.revokeConnection(trusted.deviceId))).reason, 'ClientNotFound')
      assert.strictEqual((yield* identities.list()).clients.find((client) => client.deviceId === trusted.deviceId)?.revokedAt, null)
    }).pipe(Effect.provide(env)),
  )

  it.effect('bounds active invitations and releases capacity after expiry', () =>
    Effect.gen(function* () {
      const pairings = yield* DevicePairings
      for (let index = 0; index < 32; index++) yield* pairings.issue(hash(token()))
      assert.strictEqual((yield* Effect.flip(pairings.issue(hash(token())))).reason, 'PairingLimit')
      yield* TestClock.adjust('5 minutes')
      yield* pairings.issue(hash(token()))
    }).pipe(Effect.provide(env)),
  )
})
