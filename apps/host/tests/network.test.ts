import { chmodSync, copyFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { configureNetwork, disableNetwork, networkFiles, readNetworkConfiguration } from '../src/network'
import { parseOptions } from '../src/options'
import { temporary } from './support'

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
  return { options, certificate, key }
}

describe('opt-in HTTPS home configuration', () => {
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

  it('validates command-specific network and device controls before any files are opened', () => {
    for (const args of [
      ['configure-network'],
      ['configure-network', '--origin', 'https://host.test'],
      ['serve', '--origin', 'https://host.test'],
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
