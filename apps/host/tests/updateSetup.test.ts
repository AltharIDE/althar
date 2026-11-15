import { execFile } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { promisify } from 'node:util'

import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { configuredHome } from '../src/configuration'
import { parseOptions } from '../src/options'
import { configureUpdates, renderLauncher, renderUpdateUnits } from '../src/updates/setup'
import { releaseInfo } from '../src/updates/info'
import { loadInstallation } from '../src/updates/store'
import { initializeVault } from '../src/vault'
import { fixtureFiles, HOME_ID } from './updateFixture'
import { temporary } from './support'

const fixture = async () => {
  const root = temporary()
  const publicKey = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const key = join(root, 'release.pub')
  writeFileSync(key, publicKey)
  const options = parseOptions(
    [
      'configure-updates',
      '--profile',
      join(root, 'profile'),
      '--key-file',
      join(root, 'keys/master'),
      '--installation',
      join(root, 'program'),
      '--release-key',
      key,
    ],
    { XDG_CONFIG_HOME: join(root, 'config') },
    root,
  )
  const configured = await Effect.runPromise(configuredHome(options, true))
  await Effect.runPromise(initializeVault(configured))
  const db = new DatabaseSync(join(options.profile, 'althar.sqlite'))
  db.exec(`CREATE TABLE runtime_homes(singleton INTEGER PRIMARY KEY,id TEXT); INSERT INTO runtime_homes VALUES(1,'${HOME_ID}')`)
  db.close()
  const entry = join(root, 'entry.js')
  writeFileSync(entry, 'fixture source')
  const calls: ReadonlyArray<string>[] = []
  const commands = {
    node: process.execPath,
    entry,
    path: '/usr/bin:/bin',
    run: async (_: string, args: ReadonlyArray<string>) => {
      calls.push(args)
    },
  }
  const dependencies = {
    services: { active: async () => false, stop: async () => {}, start: async () => {}, kick: async () => {} },
    assemble: async (_: unknown, destination: string) => {
      fixtureFiles(destination)
    },
    execute: async () => JSON.stringify(releaseInfo()),
  }
  return { root, options: configured, commands, dependencies, calls }
}

describe('managed update setup', () => {
  it('pins the existing home/service, rotates trusted keys and rejects an invalid trust set before installation', async () => {
    const at = await fixture()
    const keys = Array.from({ length: 9 }, (_, i) => {
      const path = join(at.root, `release-${i}.pub`)
      writeFileSync(path, generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }))
      return path
    })
    await expect(configureUpdates({ ...at.options, releaseKeys: keys }, at.commands, at.dependencies)).rejects.toMatchObject({
      code: 'UpdateFailed',
    })
    await configureUpdates(at.options, at.commands, at.dependencies)
    await configureUpdates(
      { ...at.options, releaseKeys: [keys[0] ?? ''], updateFeed: 'https://updates.example/feed' },
      at.commands,
      at.dependencies,
    )
    expect((await loadInstallation(at.options.updateRoot)).config.keys).toHaveLength(2)
    await expect(configureUpdates({ ...at.options, serviceName: 'another-home' }, at.commands, at.dependencies)).rejects.toMatchObject({
      code: 'UpdateFailed',
    })
    await expect(configureUpdates({ ...at.options, releaseKeys: keys.slice(1) }, at.commands, at.dependencies)).rejects.toMatchObject({
      code: 'UpdateFailed',
    })
    const { run: _, ...withoutRunner } = at.commands
    const calls: ReadonlyArray<string>[] = []
    await configureUpdates({ ...at.options, releaseKeys: [] }, withoutRunner, {
      ...at.dependencies,
      execute: async (_program, args) => {
        calls.push(args)
        return ''
      },
    })
    expect(calls.some((args) => args.includes('daemon-reload'))).toBe(true)
  })

  it('recovers partial setup without replacing unrelated units or starting the host early', async () => {
    const at = await fixture()
    let rejectReload = true
    const calls: ReadonlyArray<string>[] = []
    const commands = {
      ...at.commands,
      run: async (_: string, args: ReadonlyArray<string>) => {
        calls.push(args)
        if (rejectReload && args.includes('daemon-reload')) throw new Error('manager unavailable')
      },
    }
    await expect(configureUpdates({ ...at.options, start: true }, commands, at.dependencies)).rejects.toThrow()
    expect(calls.some((args) => args.includes('--now'))).toBe(false)
    rejectReload = false
    await configureUpdates({ ...at.options, start: true }, commands, at.dependencies)
    expect(calls.at(-1)).toEqual(['--user', 'enable', '--now', 'althar-host.service'])
    const other = await fixture()
    await expect(
      configureUpdates(other.options, other.commands, {
        ...other.dependencies,
        assemble: async () => {
          throw new Error('missing license')
        },
      }),
    ).rejects.toMatchObject({ code: 'UpdateFailed' })
    let activeCalls = 0
    await expect(
      configureUpdates(other.options, other.commands, {
        ...other.dependencies,
        services: { ...other.dependencies.services, active: async () => ++activeCalls > 1 },
      }),
    ).rejects.toMatchObject({ code: 'UpdateBusy' })
  })
  it('captures trusted local bootstrap code, preserves credentials/data, installs independent units and defaults to explicit apply', async () => {
    const at = await fixture()
    const key = readFileSync(at.options.keyFile)
    await configureUpdates(at.options, at.commands, at.dependencies)
    const installation = await loadInstallation(at.options.updateRoot)
    expect(installation.config.automatic).toBe(false)
    expect(readFileSync(at.options.keyFile)).toEqual(key)
    expect(readFileSync(join(at.options.unitDirectory, 'althar-host.service'), 'utf8')).toContain('/launcher')
    expect(readFileSync(join(at.options.unitDirectory, 'althar-host-update.service'), 'utf8')).toContain('Type=oneshot')
    expect(at.calls.some((args) => args.includes('althar-host-update.path'))).toBe(true)
    await configureUpdates({ ...at.options, automaticUpdates: true }, at.commands, at.dependencies)
    expect((await loadInstallation(at.options.updateRoot)).config.automatic).toBe(true)
    await configureUpdates({ ...at.options, automaticUpdates: false }, at.commands, at.dependencies)
    expect((await loadInstallation(at.options.updateRoot)).config.automatic).toBe(false)
  })

  it('refuses running homes, missing trust keys, overlapping data roots and unrelated unit files', async () => {
    const at = await fixture()
    await expect(configureUpdates({ ...at.options, releaseKeys: [] }, at.commands, at.dependencies)).rejects.toMatchObject({
      code: 'UpdateNotConfigured',
    })
    await expect(
      configureUpdates(at.options, at.commands, {
        ...at.dependencies,
        services: { ...at.dependencies.services, active: async () => true },
      }),
    ).rejects.toMatchObject({ code: 'UpdateBusy' })
    await expect(configureUpdates({ ...at.options, updateRoot: at.options.profile }, at.commands, at.dependencies)).rejects.toThrow()
    mkdirSync(at.options.unitDirectory, { recursive: true, mode: 0o700 })
    writeFileSync(join(at.options.unitDirectory, 'althar-host-update.service'), '[Service]\nExecStart=/unrelated\n', { mode: 0o600 })
    await expect(configureUpdates(at.options, at.commands, at.dependencies)).rejects.toThrow()
    expect(readFileSync(join(at.options.unitDirectory, 'althar-host-update.service'), 'utf8')).toContain('/unrelated')
  })

  it.skipIf(!existsSync('/usr/bin/systemd-analyze'))(
    'passes systemd unit and shell validation with spaces, quotes, dollars and percent signs',
    async () => {
      const root = temporary()
      const options = { serviceName: 'althar-host', updateRoot: join(root, "my ' $HOME% program") }
      const units = renderUpdateUnits(options)
      for (const [kind, value] of Object.entries(units)) writeFileSync(join(root, `althar-host-update.${kind}`), value)
      await promisify(execFile)(
        '/usr/bin/systemd-analyze',
        [
          '--user',
          'verify',
          join(root, 'althar-host-update.service'),
          join(root, 'althar-host-update.timer'),
          join(root, 'althar-host-update.path'),
        ],
        { env: { ...process.env, XDG_RUNTIME_DIR: root } },
      )
      const launcher = join(root, 'launcher')
      writeFileSync(launcher, renderLauncher(options.updateRoot))
      await promisify(execFile)('/bin/sh', ['-n', launcher])
      expect(() => renderUpdateUnits({ ...options, updateRoot: '/unsafe\nprogram' })).toThrow()
    },
  )
})
