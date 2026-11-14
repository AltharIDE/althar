import { generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MessageChannel } from 'node:worker_threads'

import { API_VERSION, Api, clientProtocol, emitterPort } from '@althar/contracts'
import { assert, describe, it } from '@effect/vitest'
import { Deferred, Effect, Exit, Fiber, Layer, Option, Scope, Stream } from 'effect'
import { RpcClient } from 'effect/rpc'
import { SqlClient } from 'effect/sql'

import { services } from '../src/Api'
import { authenticateApiClient, listenLocalApi, openApiSocket } from '../src/apiSocket'
import { ClientIdentities } from '../src/ClientIdentities'
import { Instance } from '../src/Instance'
import { Secrets } from '../src/Secrets'
import { fakeAgents, fakeConnectors, ROOMY } from './support'

const commandId = () => `cmd_${randomBytes(16).toString('hex')}`
const environment = services({
  database: ':memory:',
  worktreeRoot: mkdtempSync(join(tmpdir(), 'althar-socket-work-')),
  appVersion: 'test',
  deviceName: 'Host',
  agents: fakeAgents(),
  secrets: Secrets.memory(),
  connectors: fakeConnectors({}),
  busy: { machine: ROOMY },
})

const client = (port: Parameters<typeof clientProtocol>[0]) =>
  Effect.gen(function* () {
    const protocol = yield* Layer.build(clientProtocol(port))
    return yield* RpcClient.make(Api).pipe(Effect.provideContext(protocol))
  })

describe('the authenticated private API', () => {
  it.live('never signs a challenge for another home, device or API version', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const homeId = `home_${'1'.repeat(32)}`
        const deviceId = `dev_${'2'.repeat(32)}`
        const challenge = { protocol: 1, homeId, deviceId, apiVersion: API_VERSION, nonce: 'A'.repeat(43), expiresAt: Date.now() + 30_000 }
        for (const changed of [
          { homeId: `home_${'3'.repeat(32)}` },
          { deviceId: `dev_${'4'.repeat(32)}` },
          { apiVersion: API_VERSION + 1 },
        ]) {
          const channel = new MessageChannel()
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              channel.port1.close()
              channel.port2.close()
            }),
          )
          channel.port1.on('message', () => channel.port1.postMessage({ ...challenge, ...changed }))
          let signed = false
          const refused = yield* Effect.flip(
            authenticateApiClient(emitterPort(channel.port2), homeId, {
              kind: 'device',
              deviceId,
              sign: () =>
                Effect.sync(() => {
                  signed = true
                  return 'A'.repeat(86)
                }),
            }),
          )
          assert.strictEqual(refused.reason, 'AuthenticationFailed')
          assert.isFalse(signed)
        }
      }),
    ),
  )

  it.live('rejects a successful handshake for another home or version, or one that upgrades launch-secret authority', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const homeId = `home_${'1'.repeat(32)}`
        const identity = { homeId, actorId: `act_${'2'.repeat(32)}`, deviceId: `dev_${'3'.repeat(32)}`, role: 'socket' }
        for (const changed of [
          { identity: { ...identity, homeId: `home_${'4'.repeat(32)}` } },
          { apiVersion: API_VERSION + 1 },
          { identity: { ...identity, role: 'window' } },
        ]) {
          const channel = new MessageChannel()
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              channel.port1.close()
              channel.port2.close()
            }),
          )
          channel.port1.on('message', () =>
            channel.port1.postMessage({ type: 'Authenticated', identity, apiVersion: API_VERSION, ...changed }),
          )
          const refused = yield* Effect.flip(
            authenticateApiClient(emitterPort(channel.port2), homeId, { kind: 'secret', secret: '0'.repeat(64) }),
          )
          assert.strictEqual(refused.reason, 'AuthenticationFailed')
        }
      }),
    ),
  )

  it.live.skipIf(process.platform === 'win32')('refuses a symlink in place of its private endpoint directory', () =>
    Effect.gen(function* () {
      const profile = mkdtempSync(join(tmpdir(), 'althar-api-profile-'))
      const external = mkdtempSync(join(tmpdir(), 'althar-api-external-'))
      symlinkSync(external, join(profile, 'api'), 'dir')
      const error = yield* Effect.flip(listenLocalApi(profile))
      assert.strictEqual(error.reason, 'SocketUnavailable')
      assert.isFalse(existsSync(join(external, 'endpoint.json')))
    }).pipe(Effect.scoped, Effect.provide(environment)),
  )

  it.live('retires a launch’s socket and clients without deleting a newer endpoint descriptor', () =>
    Effect.gen(function* () {
      const profile = mkdtempSync(join(tmpdir(), 'althar-api-profile-'))
      mkdirSync(join(profile, 'api'), { mode: 0o755 })
      const launch = yield* Scope.make()
      yield* Effect.addFinalizer(() => Scope.close(launch, Exit.void))
      const first = yield* listenLocalApi(profile).pipe(Scope.provide(launch))
      const port = yield* openApiSocket(first.address)
      yield* authenticateApiClient(port, first.homeId, { kind: 'secret', secret: first.secret })
      const api = yield* client(port)
      yield* api.GetConnectionInfo({})
      const second = yield* listenLocalApi(profile)
      assert.notStrictEqual(first.secret, second.secret)
      yield* Scope.close(launch, Exit.void)
      assert.isTrue(Exit.isFailure(yield* Effect.exit(api.GetConnectionInfo({}))))
      assert.deepStrictEqual(JSON.parse(readFileSync(join(profile, 'api', 'endpoint.json'), 'utf8')), second)
      assert.strictEqual((yield* Effect.flip(openApiSocket(first.address))).reason, 'SocketUnavailable')
    }).pipe(Effect.scoped, Effect.provide(environment)),
  )

  it.live('publishes a private endpoint and gives a launch-secret client only socket authority', () =>
    Effect.gen(function* () {
      const profile = mkdtempSync(join(tmpdir(), 'althar-api-profile-'))
      const endpoint = yield* listenLocalApi(profile)
      const published = JSON.parse(readFileSync(join(profile, 'api', 'endpoint.json'), 'utf8'))
      assert.deepStrictEqual(published, endpoint)
      if (process.platform !== 'win32') {
        assert.strictEqual(statSync(join(profile, 'api')).mode & 0o777, 0o700)
        assert.strictEqual(statSync(join(profile, 'api', 'endpoint.json')).mode & 0o777, 0o600)
        assert.strictEqual(statSync(endpoint.address).mode & 0o777, 0o600)
      }
      const port = yield* openApiSocket(endpoint.address)
      const identity = yield* authenticateApiClient(port, endpoint.homeId, { kind: 'secret', secret: endpoint.secret })
      assert.strictEqual(identity.role, 'socket')
      const api = yield* client(port)
      assert.strictEqual((yield* api.GetConnectionInfo({})).identity.homeId, endpoint.homeId)
      assert.strictEqual(
        (yield* Effect.flip(api.RevokeClientDevice({ commandId: commandId(), deviceId: identity.deviceId }))).reason,
        'PersonRequired',
      )
    }).pipe(Effect.scoped, Effect.provide(environment)),
  )

  it.live('authenticates a device key, records the client device, and revokes its live connection', () =>
    Effect.gen(function* () {
      const identities = yield* ClientIdentities
      const instance = yield* Instance
      const sql = yield* SqlClient.SqlClient
      const pair = generateKeyPairSync('ed25519')
      const publicKey = pair.publicKey.export({ format: 'jwk' }).x
      if (publicKey === undefined) throw new Error('Missing Ed25519 public key')
      const registered = yield* identities.register({ name: 'Paired desktop', publicKey, role: 'paired_device' })
      const endpoint = yield* listenLocalApi(mkdtempSync(join(tmpdir(), 'althar-api-profile-')))
      const port = yield* openApiSocket(endpoint.address)
      yield* authenticateApiClient(port, endpoint.homeId, {
        kind: 'device',
        deviceId: registered.deviceId,
        sign: (message) => Effect.sync(() => sign(null, Buffer.from(message), pair.privateKey).toString('base64url')),
      })
      const api = yield* client(port)
      const info = yield* api.GetConnectionInfo({})
      assert.strictEqual(info.identity.deviceId, registered.deviceId)
      assert.strictEqual(info.hostDeviceId, instance.deviceId)
      const id = commandId()
      yield* api.LeftHome({ commandId: id })
      const [receipt] = yield* sql<{ deviceId: string }>`SELECT device_id FROM api_commands WHERE command_id = ${id}`
      assert.strictEqual(receipt?.deviceId, registered.deviceId)
      const [host] = yield* sql<{ looked: string | null }>`SELECT home_looked_at AS looked FROM devices WHERE id = ${instance.deviceId}`
      assert.isNull(host?.looked)
      const reconnected = yield* openApiSocket(endpoint.address)
      yield* authenticateApiClient(reconnected, endpoint.homeId, {
        kind: 'device',
        deviceId: registered.deviceId,
        sign: (message) => Effect.sync(() => sign(null, Buffer.from(message), pair.privateKey).toString('base64url')),
      })
      const second = yield* client(reconnected)
      const sentinel = '2000-01-01T00:00:00.000Z'
      yield* sql`UPDATE devices SET home_looked_at = ${sentinel} WHERE id = ${registered.deviceId}`
      yield* second.LeftHome({ commandId: id })
      const [kept] = yield* sql<{ looked: string }>`SELECT home_looked_at AS looked FROM devices WHERE id = ${registered.deviceId}`
      assert.strictEqual(kept?.looked, sentinel)
      const watching = yield* Deferred.make<void>()
      const stream = yield* Effect.forkChild(Stream.runForEach(api.WatchAttention({}), () => Deferred.succeed(watching, undefined)))
      yield* Deferred.await(watching)
      yield* identities.revoke(registered.deviceId)
      assert.isTrue(Exit.isFailure(yield* Fiber.await(stream)))
      assert.isTrue(Exit.isFailure(yield* Effect.exit(api.GetConnectionInfo({}))))
      assert.isTrue(Exit.isFailure(yield* Effect.exit(second.LeftHome({ commandId: id }))))
    }).pipe(Effect.scoped, Effect.provide(environment)),
  )

  it.live('refuses wrong launch secrets, homes and protocol versions before serving any RPC', () =>
    Effect.gen(function* () {
      const endpoint = yield* listenLocalApi(mkdtempSync(join(tmpdir(), 'althar-api-profile-')))
      const wrongSecret = yield* openApiSocket(endpoint.address)
      assert.isTrue(
        Exit.isFailure(yield* Effect.exit(authenticateApiClient(wrongSecret, endpoint.homeId, { kind: 'secret', secret: '0'.repeat(64) }))),
      )
      const wrongHome = yield* openApiSocket(endpoint.address)
      assert.isTrue(
        Exit.isFailure(
          yield* Effect.exit(authenticateApiClient(wrongHome, `home_${'0'.repeat(32)}`, { kind: 'secret', secret: endpoint.secret })),
        ),
      )
      const wrongVersion = yield* openApiSocket(endpoint.address)
      assert.isTrue(
        Exit.isFailure(
          yield* Effect.exit(authenticateApiClient(wrongVersion, endpoint.homeId, { kind: 'secret', secret: endpoint.secret }, 999)),
        ),
      )
    }).pipe(Effect.scoped, Effect.provide(environment)),
  )

  it.live('asks for a fresh snapshot for cursors from another home or beyond the current history', () =>
    Effect.gen(function* () {
      const endpoint = yield* listenLocalApi(mkdtempSync(join(tmpdir(), 'althar-api-profile-')))
      const port = yield* openApiSocket(endpoint.address)
      yield* authenticateApiClient(port, endpoint.homeId, { kind: 'secret', secret: endpoint.secret })
      const api = yield* client(port)
      const other = yield* Effect.flip(
        Stream.runHead(api.WatchFrom({ position: { homeId: `home_${'0'.repeat(32)}`, cursor: 0, checkpoint: null } })),
      )
      assert.strictEqual(other.reason, 'SnapshotRequired')
      const ahead = yield* Effect.flip(
        Stream.runHead(api.WatchFrom({ position: { homeId: endpoint.homeId, cursor: Number.MAX_SAFE_INTEGER, checkpoint: null } })),
      )
      assert.strictEqual(ahead.reason, 'SnapshotRequired')
    }).pipe(Effect.scoped, Effect.provide(environment)),
  )

  it.live('replays changes after a snapshot and detects a restored history even when the numeric cursor matches', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const endpoint = yield* listenLocalApi(mkdtempSync(join(tmpdir(), 'althar-api-profile-')))
      const port = yield* openApiSocket(endpoint.address)
      yield* authenticateApiClient(port, endpoint.homeId, { kind: 'secret', secret: endpoint.secret })
      const api = yield* client(port)
      const snapshot = yield* api.ListProjects()
      assert.isDefined(snapshot.position)
      if (snapshot.position === undefined) throw new Error('Missing snapshot position')
      yield* sql`INSERT INTO change_log (aggregate_type, aggregate_id, aggregate_revision, changed_at) VALUES ('project', 'test', 1, '2026-11-14T00:00:00.000Z')`
      const replay = Option.getOrUndefined(
        yield* Stream.runHead(Stream.filter(api.WatchFrom({ position: snapshot.position }), (event) => event._tag === 'Changed')),
      )
      assert.strictEqual(replay?._tag, 'Changed')
      if (replay?._tag !== 'Changed' || replay.checkpoint === undefined) throw new Error('Missing durable change')
      const saved = { homeId: endpoint.homeId, cursor: replay.cursor, checkpoint: replay.checkpoint }
      yield* sql`UPDATE change_log SET checkpoint = lower(hex(randomblob(16))) WHERE cursor = ${saved.cursor}`
      const refused = yield* Effect.flip(Stream.runHead(api.WatchFrom({ position: saved })))
      assert.strictEqual(refused.reason, 'SnapshotRequired')
    }).pipe(Effect.scoped, Effect.provide(environment)),
  )

  it.live('requires a new snapshot when saved history was pruned or a zero cursor claims a checkpoint', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const endpoint = yield* listenLocalApi(mkdtempSync(join(tmpdir(), 'althar-api-profile-')))
      const port = yield* openApiSocket(endpoint.address)
      yield* authenticateApiClient(port, endpoint.homeId, { kind: 'secret', secret: endpoint.secret })
      const api = yield* client(port)
      const zero = { homeId: endpoint.homeId, cursor: 0, checkpoint: null }
      const invalid = yield* Effect.flip(Stream.runHead(api.WatchFrom({ position: { ...zero, checkpoint: '0'.repeat(32) } })))
      assert.strictEqual(invalid.reason, 'SnapshotRequired')
      yield* sql`INSERT INTO change_log (aggregate_type, aggregate_id, aggregate_revision, changed_at) VALUES ('project', 'first', 1, '2026-11-14T00:00:00.000Z')`
      const position = (yield* api.GetConnectionInfo({})).position
      yield* sql`INSERT INTO change_log (aggregate_type, aggregate_id, aggregate_revision, changed_at) VALUES ('project', 'second', 1, '2026-11-14T00:00:00.000Z')`
      yield* sql`DELETE FROM change_log WHERE cursor = ${position.cursor}`
      const missing = yield* Effect.flip(Stream.runHead(api.WatchFrom({ position })))
      assert.strictEqual(missing.reason, 'SnapshotRequired')
      yield* sql`DELETE FROM change_log WHERE cursor < (SELECT max(cursor) FROM change_log)`
      const pruned = yield* Effect.flip(Stream.runHead(api.WatchFrom({ position: zero })))
      assert.strictEqual(pruned.reason, 'SnapshotRequired')
    }).pipe(Effect.scoped, Effect.provide(environment)),
  )
})
