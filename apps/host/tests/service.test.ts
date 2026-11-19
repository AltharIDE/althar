import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { parseOptions } from '../src/options'
import { installService, renderService, runExternal } from '../src/service'
import { initializeVault } from '../src/vault'
import { temporary } from './support'

describe('the supervised Linux host', () => {
  it.skipIf(!existsSync('/usr/bin/systemd-analyze'))(
    'passes the service manager’s own unit validation, including escaped paths',
    async () => {
      const root = temporary()
      const unit = join(root, 'althar-host.service')
      const options = parseOptions(
        ['install-service', '--profile', join(root, 'my $HOME% profile'), '--key-file', join(root, 'my % master-key')],
        {},
        root,
      )
      writeFileSync(unit, renderService(options, { node: process.execPath, entry: '/opt/althar host/main.js', path: '/usr/bin:/bin' }))
      await promisify(execFile)('/usr/bin/systemd-analyze', ['--user', 'verify', unit], { env: { ...process.env, XDG_RUNTIME_DIR: root } })
    },
  )
  it('uses private delivered credentials, readiness, bounded restart and complete process-group shutdown', () => {
    const options = parseOptions(
      ['install-service', '--profile', '/data/my $HOME% profile', '--key-file', '/private/master', '--worktrees', '/work/tasks'],
      {},
      '/home/owner',
    )
    const unit = renderService(options, {
      node: '/usr/bin/node',
      entry: '/opt/althar host/main.js',
      path: '/usr/bin:/home/owner/.local/bin',
    })
    assert.include(unit, 'Type=notify')
    assert.include(unit, 'LoadCredential=master-key:/private/master')
    assert.include(unit, 'ExecStart=:"/usr/bin/node" "/opt/althar host/main.js" "serve"')
    assert.include(unit, '"/data/my $HOME%% profile"')
    assert.include(unit, '"%d/master-key"')
    assert.include(unit, 'KillMode=control-group')
    assert.include(unit, 'UMask=0077')
    assert.notInclude(unit, 'PrivateTmp=true')
    assert.throws(() => renderService(options, { node: '/node\nExecStart=/evil', entry: '/entry', path: '/bin' }))
  })

  it.live('installs atomically, preserves unrelated units and starts only when explicitly requested', () =>
    Effect.gen(function* () {
      const root = temporary()
      const args = ['install-service', '--profile', join(root, 'profile'), '--key-file', join(root, 'keys/master')]
      const options = parseOptions(args, { XDG_CONFIG_HOME: join(root, 'config') }, root)
      yield* initializeVault(options)
      const calls: Array<readonly [string, ReadonlyArray<string>]> = []
      const dependencies = {
        node: '/usr/bin/node',
        entry: '/opt/althar/host.js',
        path: '/usr/bin',
        run: async (command: string, argv: ReadonlyArray<string>) => {
          calls.push([command, argv])
        },
      }
      const installed = yield* installService(options, dependencies)
      assert.include(readFileSync(installed, 'utf8'), 'Althar host service')
      assert.deepStrictEqual(calls, [['systemctl', ['--user', 'daemon-reload']]])
      yield* installService({ ...options, start: true }, dependencies)
      assert.deepStrictEqual(calls.at(-1), ['systemctl', ['--user', 'enable', '--now', 'althar-host.service']])
      writeFileSync(installed, '[Service]\nExecStart=/unrelated\n', { mode: 0o600 })
      assert.strictEqual((yield* Effect.flip(installService(options, dependencies))).code, 'InvalidConfig')
      assert.include(readFileSync(installed, 'utf8'), '/unrelated')
    }),
  )

  it('can require an OS-sealed service credential without adding a plaintext fallback', () => {
    const options = parseOptions(['install-service', '--encrypted-credential', '/private/host.cred'], {}, '/home/owner')
    const unit = renderService(options, { node: '/usr/bin/node', entry: '/opt/host.js', path: '/usr/bin' })
    assert.include(unit, 'LoadCredentialEncrypted=master-key:/private/host.cred')
    assert.notInclude(unit, '\nLoadCredential=')
    assert.throws(() => renderService(options, { node: 'relative-node', entry: '/entry', path: '/bin' }))
    for (const invalid of ['/private/key ', '/private/key\\', '/private/key\nInjected']) {
      assert.throws(() => renderService({ ...options, encryptedCredential: invalid }, { node: '/node', entry: '/entry', path: '/bin' }))
    }
  })

  it.live('validates encrypted credential installation and surfaces service manager failures', () =>
    Effect.gen(function* () {
      const root = temporary()
      const options = parseOptions(
        ['install-service', '--profile', join(root, 'profile'), '--key-file', join(root, 'keys/master')],
        { XDG_CONFIG_HOME: join(root, 'config') },
        root,
      )
      yield* initializeVault(options)
      const credential = join(root, 'keys/sealed')
      const commands = { node: '/usr/bin/node', entry: '/opt/host.js', path: '/bin', run: async () => {} }
      assert.strictEqual(
        (yield* Effect.flip(installService({ ...options, encryptedCredential: credential }, commands))).code,
        'InvalidConfig',
      )
      writeFileSync(credential, 'OS sealed test fixture', { mode: 0o600 })
      const path = yield* installService({ ...options, encryptedCredential: credential }, commands)
      assert.include(readFileSync(path, 'utf8'), 'LoadCredentialEncrypted=')
      const broken = {
        ...commands,
        run: async (_: string, argv: ReadonlyArray<string>) => {
          if (argv.includes('daemon-reload')) throw new Error('private diagnostics')
        },
      }
      assert.strictEqual((yield* Effect.flip(installService(options, broken))).code, 'ServiceUnavailable')
      const cannotStart = {
        ...commands,
        run: async (_: string, argv: ReadonlyArray<string>) => {
          if (argv.includes('enable')) throw new Error('private diagnostics')
        },
      }
      assert.strictEqual((yield* Effect.flip(installService({ ...options, start: true }, cannotStart))).code, 'ServiceUnavailable')
      assert.strictEqual((yield* Effect.flip(installService({ ...options, serviceName: '../bad' }, commands))).code, 'InvalidConfig')
    }),
  )

  it('executes helpers without a shell and limits diagnostic output on failure', async () => {
    await runExternal(process.execPath, ['-e', 'process.exit(0)'])
    try {
      await runExternal(process.execPath, ['-e', 'process.stderr.write("private"); process.exit(1)'])
      assert.fail('Expected a service error')
    } catch (error) {
      assert.instanceOf(error, Error)
      assert.notInclude(String(error), 'private')
    }
  })
})
