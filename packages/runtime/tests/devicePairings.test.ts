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

describe('pairing codes the home makes for a window', () => {
  const reach = { origin: 'https://mac.local:6769', tlsKeyPin: 'a'.repeat(64), tlsCertificate: 'Y2VydGlmaWNhdGU' }
  const bodyOf = (code: string) =>
    JSON.parse(Buffer.from(code.slice('althar-pairing1.'.length), 'base64url').toString('utf8')) as Record<string, unknown>

  it.effect('refuses a code until phones can reach the home, then carries where they reach it', () =>
    Effect.gen(function* () {
      const pairings = yield* DevicePairings
      assert.strictEqual((yield* Effect.flip(pairings.create())).reason, 'PhonesCantReach')
      assert.deepStrictEqual(yield* pairings.access(), { origin: null, switchable: false, on: false })
      yield* pairings.reachable(reach)
      assert.deepStrictEqual(yield* pairings.access(), { origin: reach.origin, switchable: false, on: true })
      const made = yield* pairings.create()
      const body = bodyOf(made.code)
      assert.strictEqual(body.origin, reach.origin)
      assert.strictEqual(body.tlsKeyPin, reach.tlsKeyPin)
      assert.strictEqual(body.tlsCertificate, reach.tlsCertificate)
      assert.strictEqual(hash(String(body.token)), made.tokenHash)
      assert.strictEqual(made.link, `https://althar.ai/pair#${made.code.slice('althar-pairing'.length)}`)
      assert.deepStrictEqual(yield* pairings.status(made.tokenHash), { state: 'waiting', expiresAt: made.expiresAt })
    }).pipe(Effect.provide(env)),
  )

  it.effect('says which device a code paired, and that it ran out otherwise', () =>
    Effect.gen(function* () {
      const pairings = yield* DevicePairings
      yield* pairings.reachable(reach)
      const made = yield* pairings.create()
      const device = yield* pairings.complete(request(String(bodyOf(made.code).homeId), String(bodyOf(made.code).token)))
      const paired = yield* pairings.status(made.tokenHash)
      assert.strictEqual(paired.state, 'paired')
      assert.strictEqual(paired.state === 'paired' ? paired.device.deviceId : null, device.deviceId)
      const unused = yield* pairings.create()
      yield* TestClock.adjust('5 minutes')
      assert.deepStrictEqual(yield* pairings.status(unused.tokenHash), { state: 'expired' })
      assert.deepStrictEqual(yield* pairings.status(hash(token())), { state: 'expired' })
    }).pipe(Effect.provide(env)),
  )

  it.effect('still says a code paired after it ran out and another code cleared it away', () =>
    Effect.gen(function* () {
      const pairings = yield* DevicePairings
      yield* pairings.reachable(reach)
      const made = yield* pairings.create()
      yield* TestClock.adjust('4 minutes')
      const device = yield* pairings.complete(request(String(bodyOf(made.code).homeId), String(bodyOf(made.code).token)))
      yield* TestClock.adjust('2 minutes')
      // Another window's code, made after the first ran out, clears the run-out invitations away.
      yield* pairings.create()
      const status = yield* pairings.status(made.tokenHash)
      assert.strictEqual(status.state === 'paired' ? status.device.deviceId : status.state, device.deviceId)
      yield* TestClock.adjust('15 minutes')
      yield* pairings.create()
      assert.deepStrictEqual(yield* pairings.status(made.tokenHash), { state: 'expired' })
    }).pipe(Effect.provide(env)),
  )

  it.effect('switches phone access only where the home lets a window, and drops codes out as it turns off', () =>
    Effect.gen(function* () {
      const pairings = yield* DevicePairings
      assert.strictEqual((yield* Effect.flip(pairings.setAccess(true))).reason, 'Forbidden')
      yield* pairings.switchable((on) => pairings.reachable(on ? reach : null), false)
      assert.deepStrictEqual(yield* pairings.access(), { origin: null, switchable: true, on: false })
      assert.deepStrictEqual(yield* pairings.setAccess(true), { origin: reach.origin, switchable: true, on: true })
      const made = yield* pairings.create()
      assert.deepStrictEqual(yield* pairings.setAccess(false), { origin: null, switchable: true, on: false })
      assert.deepStrictEqual(yield* pairings.status(made.tokenHash), { state: 'expired' })
      assert.strictEqual((yield* Effect.flip(pairings.create())).reason, 'PhonesCantReach')
    }).pipe(Effect.provide(env)),
  )
})
