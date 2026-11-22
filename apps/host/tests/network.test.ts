import { chmodSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'node:net'

import { assert, describe, it } from '@effect/vitest'
import { Agents } from '@althar/runtime'
import { completeDevicePairing, createDeviceKey, decodePairingCode, openHttpsConnection, signDeviceMessage } from '@althar/transport-node'
import { Deferred, Effect, Fiber, Layer, Schema } from 'effect'
import { vi } from 'vitest'

import { runCommand } from '../src/commands'
import { initializeHome, serveHome, type HomeReady } from '../src/home'
import { configureNetwork, disableNetwork, networkFiles, readNetworkConfiguration } from '../src/network'
import { parseOptions } from '../src/options'
import { temporary } from './support'
import * as approvalKeys from '../src/approvalKeys'

const fixture = () => {
  const root = temporary()
  const profile = join(root, 'profile')
  const worktrees = join(root, 'worktrees')
  mkdirSync(profile, { mode: 0o700 })
  mkdirSync(worktrees, { mode: 0o700 })
  const certificate = join(root, 'certificate.pem')
  const key = join(root, 'key.pem')
  copyFileSync(new URL('../../../packages/transport-node/tests/fixtures/tls/certificate.pem', import.meta.url), certificate)
  copyFileSync(new URL('../../../packages/transport-node/tests/fixtures/tls/key.pem', import.meta.url), key)
  chmodSync(certificate, 0o600)
  chmodSync(key, 0o600)
  const options = parseOptions(
    [
      'configure-network',
      '--profile',
      profile,
      '--worktrees',
      worktrees,
      '--key-file',
      join(root, 'keys/master'),
      '--origin',
      'https://home.test:6769',
      '--tls-certificate',
      certificate,
      '--tls-key',
      key,
    ],
    {},
    root,
  )
  return { root, options, certificate, key }
}

const freePort = Effect.promise(
  () =>
    new Promise<number>((resolve, reject) => {
      const server = createServer()
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        if (address === null || typeof address === 'string') return server.close(() => reject(new Error('No fixture port')))
        server.close((error) => (error == null ? resolve(address.port) : reject(error)))
      })
    }),
)

describe('opt-in HTTPS home configuration', () => {
  it.live('checks the administrator’s key file before saving HTTPS configuration', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { root, options } = fixture()
        if (options.network === undefined) throw new Error('Missing HTTPS fixture')
        const port = yield* freePort
        const origin = `https://localhost:${port}`
        const filename = join(root, 'approval-keys.json')
        const guarded = { ...options, network: { ...options.network, address: '127.0.0.1', port, origin, approvalKeys: filename } }
        assert.include((yield* Effect.flip(configureNetwork(guarded))).message, 'server administrator')
        const dependencies = {
          agents: Layer.succeed(Agents, Agents.from([])),
          agentConfigs: { homeDir: root, folder: join(root, 'agent-sync') },
        }
        const initialized = yield* initializeHome(guarded, dependencies)
        const read = vi.spyOn(approvalKeys, 'readApprovalKeys').mockResolvedValue({
          version: 1,
          homeId: `home_${'3'.repeat(32)}`,
          origin,
          credentials: [],
        })
        try {
          yield* configureNetwork(guarded)
          assert.strictEqual((yield* readNetworkConfiguration(options.profile))?.approvalKeys, filename)
          assert.deepStrictEqual(read.mock.calls, [[filename, origin]])
          assert.include((yield* Effect.flip(serveHome(guarded, () => Effect.void, dependencies))).message, 'different home')
          read.mockResolvedValue({ version: 1, homeId: initialized.homeId, origin, credentials: [] })
          const ready = yield* Deferred.make<HomeReady, unknown>()
          const server = yield* Effect.forkScoped(
            serveHome(guarded, (info) => Effect.asVoid(Deferred.succeed(ready, info)), dependencies).pipe(
              Effect.catchCause((cause) => Effect.andThen(Deferred.failCause(ready, cause), Effect.failCause(cause))),
            ),
          )
          assert.strictEqual((yield* Deferred.await(ready)).homeId, initialized.homeId)
          yield* Fiber.interrupt(server)
        } finally {
          read.mockRestore()
        }
      }),
    ),
  )

  it.live('runs the operator pairing, inventory and revocation commands against a real configured home', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { root, options: original } = fixture()
        if (original.network === undefined) throw new Error('Missing fixture configuration')
        const port = yield* freePort
        const options = { ...original, network: { ...original.network, port, origin: `https://127.0.0.1:${port}` } }
        const output: string[] = []
        const io = {
          out: (value: string) => {
            output.push(value)
          },
          node: process.execPath,
          entry: '/unused',
          path: '/bin',
        }
        const dependencies = {
          agents: Layer.succeed(Agents, Agents.from([])),
          agentConfigs: { homeDir: root, folder: join(root, 'agent-sync') },
        }
        yield* runCommand({ ...options, command: 'init' }, io, dependencies)
        assert.include((yield* Effect.flip(runCommand({ ...options, command: 'pair' }, io))).message, 'Configure direct')
        yield* runCommand(options, io)
        assert.include(output.at(-1) ?? '', 'Restart the host explicitly')
        const ready = yield* Deferred.make<HomeReady, unknown>()
        const host = yield* Effect.forkScoped(
          serveHome(options, (info) => Effect.asVoid(Deferred.succeed(ready, info)), dependencies).pipe(
            Effect.catchCause((cause) => Effect.andThen(Deferred.failCause(ready, cause), Effect.failCause(cause))),
          ),
        )
        yield* Deferred.await(ready)
        yield* runCommand({ ...options, command: 'pair', json: true }, io)
        const invitation = Schema.decodeUnknownSync(Schema.Struct({ code: Schema.String }))(JSON.parse(output.at(-1) ?? ''))
        const device = yield* createDeviceKey
        const target = yield* completeDevicePairing(decodePairingCode(invitation.code), device, 'Operator test')
        yield* runCommand({ ...options, command: 'devices' }, io)
        assert.include(output.at(-1) ?? '', `${target.deviceId}  Operator test  socket  active`)
        yield* runCommand({ ...options, command: 'devices', deviceAfter: target.deviceId, json: true }, io)
        assert.deepStrictEqual(JSON.parse(output.at(-1) ?? ''), { clients: [], next: null })
        yield* runCommand({ ...options, command: 'revoke-device', revokeDeviceId: target.deviceId }, io)
        assert.include(output.at(-1) ?? '', 'Device access revoked')
        yield* Effect.flip(openHttpsConnection(target, (message) => signDeviceMessage(device.privateKey, message)))
        assert.include(
          (yield* Effect.flip(runCommand({ ...options, command: 'revoke-device', revokeDeviceId: `dev_${'0'.repeat(32)}` }, io))).message,
          'Choose a connection device',
        )
        yield* runCommand({ ...options, command: 'disable-network' }, io)
        assert.isUndefined(yield* readNetworkConfiguration(options.profile))
        yield* Fiber.interrupt(host)
      }),
    ),
  )

  it.live('keeps direct access disabled until configured and persists it independently of service/update flags', () =>
    Effect.gen(function* () {
      const { options } = fixture()
      assert.isUndefined(yield* readNetworkConfiguration(options.profile))
      const configured = yield* configureNetwork(options)
      assert.strictEqual(configured.origin, 'https://home.test:6769')
      assert.match(configured.tlsKeyPin, /^[0-9a-f]{64}$/)
      const saved = yield* readNetworkConfiguration(options.profile)
      assert.deepStrictEqual(saved, options.network)
      yield* disableNetwork(options.profile)
      assert.isUndefined(yield* readNetworkConfiguration(options.profile))
    }),
  )

  it.live('reports damaged settings and refuses to configure without HTTPS options', () =>
    Effect.gen(function* () {
      const { options } = fixture()
      assert.strictEqual((yield* Effect.flip(configureNetwork({ ...options, network: undefined }))).code, 'InvalidConfig')
      const path = join(options.profile, 'network.json')
      writeFileSync(path, '{damaged', { mode: 0o600 })
      assert.strictEqual((yield* Effect.flip(readNetworkConfiguration(options.profile))).code, 'InvalidConfig')
      chmodSync(path, 0o644)
      assert.include((yield* Effect.flip(readNetworkConfiguration(options.profile))).message, 'private')
    }),
  )

  it.live('refuses public key files, insecure origins and a private TLS key inside project storage', () =>
    Effect.gen(function* () {
      const { options, certificate, key } = fixture()
      if (options.network === undefined) throw new Error('Missing network fixture')
      chmodSync(key, 0o644)
      yield* Effect.flip(networkFiles(options, options.network))
      chmodSync(key, 0o600)
      yield* Effect.flip(networkFiles(options, { ...options.network, origin: 'http://home.test' }))
      const exposed = join(options.worktrees, 'key.pem')
      copyFileSync(key, exposed)
      chmodSync(exposed, 0o600)
      yield* Effect.flip(networkFiles(options, { ...options.network, key: exposed }))
      yield* Effect.flip(networkFiles(options, { ...options.network, key: certificate }))
    }),
  )

  it.live('rejects a matching TLS certificate too large for a bounded pairing code', () =>
    Effect.gen(function* () {
      const { options, certificate } = fixture()
      copyFileSync(new URL('../../../packages/transport-node/tests/fixtures/tls/oversized-certificate.pem', import.meta.url), certificate)
      chmodSync(certificate, 0o600)
      const failure = yield* Effect.flip(configureNetwork(options))
      assert.include(failure.message, 'leaf certificate of at most 4 KiB')
      assert.isUndefined(yield* readNetworkConfiguration(options.profile))
    }),
  )

  it('validates command-specific network and device controls before any files are opened', () => {
    for (const args of [
      ['configure-network'],
      ['configure-network', '--origin', 'https://host.test'],
      ['serve', '--origin', 'https://host.test'],
      ['serve', '--approval-keys', '/trusted-keys.json'],
      ['revoke-device'],
      ['devices', '--device-id', `dev_${'1'.repeat(32)}`],
      ['serve', '--after', `dev_${'1'.repeat(32)}`],
      [
        'configure-network',
        '--origin',
        'https://host.test',
        '--tls-certificate',
        '/certificate',
        '--tls-key',
        '/key',
        '--listen-port',
        '0',
      ],
    ])
      assert.throws(() => parseOptions(args, {}, '/tmp'))
    assert.strictEqual(parseOptions(['pair'], {}, '/tmp').command, 'pair')
    assert.strictEqual(parseOptions(['devices', '--after', `dev_${'1'.repeat(32)}`], {}, '/tmp').deviceAfter, `dev_${'1'.repeat(32)}`)
    assert.strictEqual(
      parseOptions(['revoke-device', '--device-id', `dev_${'1'.repeat(32)}`], {}, '/tmp').revokeDeviceId,
      `dev_${'1'.repeat(32)}`,
    )
  })
})
