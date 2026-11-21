import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { Effect } from 'effect'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { HostError } from '../src/errors'
import { parseOptions } from '../src/options'
import { setupHome, setupStatus, type SetupSystem } from '../src/sshSetup'
import { releaseInfo } from '../src/updates/info'
import { releaseIdentity, type ReleaseManifest } from '../src/updates/release'
import { temporary } from './support'

const fixture = () => {
  const home = temporary()
  const commands = { node: '/verified/node/bin/node', entry: '/verified/dist/althar-host.js', path: '/usr/bin:/bin' }
  const plan = { node: commands.node, entry: commands.entry, manifest: join(home, 'manifest'), key: join(home, 'release-key') }
  const pair = generateKeyPairSync('ed25519')
  const key = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const info = releaseInfo()
  const manifest: ReleaseManifest = {
    ...info,
    format: 1,
    sequence: 3,
    publishedAt: new Date(Date.now() - 1_000).toISOString(),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    archive: { url: 'https://example.test/archive', bytes: 64, sha256: 'a'.repeat(64) },
    unpackedBytes: 128,
    files: 8,
  }
  const signManifest = (fields: Partial<ReleaseManifest>) => {
    const payload = Buffer.from(JSON.stringify({ ...manifest, ...fields }))
    writeFileSync(
      plan.manifest,
      JSON.stringify({
        format: 1,
        keyId: releaseIdentity(key),
        payload: payload.toString('base64url'),
        signature: sign(null, payload, pair.privateKey).toString('base64url'),
      }),
      { mode: 0o600 },
    )
  }
  signManifest({})
  writeFileSync(plan.key, key, { mode: 0o600 })
  const parse = (args: string[]) => parseOptions(args, {}, home)
  const start = parse(['setup', '--manifest', plan.manifest, '--release-key', plan.key, '--json'])
  const inUnit = parse(['setup', '--run-setup', '--manifest', plan.manifest, '--release-key', plan.key])
  const status = parse(['setup', 'status', '--json'])
  const resume = parse(['setup', '--resume'])
  const output: string[] = []
  const identity = {
    state: 'ready' as const,
    homeId: 'home_test',
    hostDeviceId: 'device_test',
    apiVersion: info.apiVersion,
    version: info.version,
  }
  let active = false
  const command = vi.fn<SetupSystem['command']>(async (_file, args) => {
    if (args.includes('is-active') && !active) throw new Error('inactive')
    return { stdout: 'output\n', stderr: '' }
  })
  const install = vi.fn<SetupSystem['install']>(async (options) => ({ root: options.updateRoot, automatic: false }))
  const ready = vi.fn<SetupSystem['ready']>(() => Effect.succeed(identity))
  const services: SetupSystem = { command, install, ready }
  const root = `${start.updateRoot}.setup-v1`
  const stateFile = join(root, 'setup.json')
  const run = (options = start) => setupHome(options, commands, (line) => output.push(line), {}, services)
  const read = () => setupStatus(status, services)
  const record = (events: object[]) => {
    mkdirSync(root, { recursive: true, mode: 0o700 })
    writeFileSync(stateFile, JSON.stringify({ protocol: 1, plan, events: events.map((event) => ({ protocol: 1, ...event })) }), {
      mode: 0o600,
    })
  }
  return {
    start,
    inUnit,
    resume,
    plan,
    root,
    stateFile,
    read,
    run,
    record,
    output,
    command,
    install,
    ready,
    identity,
    signManifest,
    active: (value: boolean) => {
      active = value
    },
  }
}

afterEach(() => vi.unstubAllEnvs())

describe.runIf(process.platform === 'linux' && process.getuid?.() !== 0)('SSH home setup checkpoints', () => {
  it('verifies the release then queues a locked transient unit independent of the current SSH stream', async () => {
    const at = fixture()
    vi.stubEnv('XDG_CONFIG_HOME', '/explicit/config')
    expect(await at.read()).toMatchObject({ state: 'absent' })
    await at.run()
    expect(at.command.mock.calls.find(([file]) => file === 'systemd-run')?.[1]).toEqual(
      expect.arrayContaining([
        '--user',
        '--collect',
        '/usr/bin/flock',
        '--nonblock',
        '--run-setup',
        '--setenv=XDG_CONFIG_HOME=/explicit/config',
      ]),
    )
    expect(at.output.join('')).toContain('"detached":true')
    at.active(true)
    expect(await at.read()).toMatchObject({ state: 'queued' })
    await expect(at.run()).rejects.toThrow('Another host setup is running')
    expect(at.output.join('')).toContain('"LockHeld"')
  })

  it('hard-stops missing, tampered or different release metadata before launching', async () => {
    const at = fixture()
    await expect(at.run(at.resume)).rejects.toThrow('verified release first')
    at.signManifest({ version: '99.1.0' })
    await expect(at.run()).rejects.toThrow('signature, expiration or platform')
    writeFileSync(at.plan.manifest, '{}')
    await expect(at.run()).rejects.toThrow('signature, expiration or platform')
    expect(at.output.join('')).toContain('"SignatureMismatch"')
    expect(at.command).not.toHaveBeenCalled()
    await expect(at.run(at.inUnit)).rejects.toThrow('locked installer')
  })

  it('reports loss of the user manager, a launch error, and a competing unit', async () => {
    const at = fixture()
    at.command.mockRejectedValueOnce(new Error('missing bus'))
    await expect(at.run()).rejects.toThrow('Could not reach')
    at.command.mockImplementation(async (file, args) => {
      if (file === 'systemd-run' || args.includes('is-active')) throw new Error('not running')
      return { stdout: '', stderr: '' }
    })
    await expect(at.run()).rejects.toThrow('could not launch')
    let unitExists = false
    at.command.mockImplementation(async (file, args) => {
      if (file === 'systemd-run') {
        unitExists = true
        throw new Error('unit exists')
      }
      if (args.includes('is-active') && !unitExists) throw new Error('not running')
      return { stdout: '', stderr: '' }
    })
    await expect(at.run()).rejects.toThrow('Another host setup is running')
  })

  it('preserves the initialized identity and completed setup work across a failed start and a second invocation', async () => {
    const at = fixture()
    vi.stubEnv('ALTHAR_HOST_SETUP_UNIT', '1')
    vi.stubEnv('INVOCATION_ID', 'test')
    at.install.mockImplementationOnce(async (options, commands, dependencies) => {
      expect(options.start).toBe(false)
      expect(dependencies?.signedBootstrap?.manifest.sequence).toBe(3)
      await commands.run?.('systemctl', ['--user', 'daemon-reload'], { PATH: commands.path })
      return { root: options.updateRoot, automatic: false }
    })
    at.command.mockImplementationOnce(async () => ({ stdout: 'prepared\n', stderr: '' }))
    at.command.mockRejectedValueOnce(Object.assign(new Error('start failed'), { stdout: '', stderr: 'manager diagnostics\n' }))
    await expect(at.run(at.inUnit)).rejects.toThrow('stopped')
    const failed = await at.read()
    expect(failed).toMatchObject({ state: 'failed', rawOutput: 'prepared\nmanager diagnostics\nstart failed\n' })
    expect(failed.events.at(-1)).toMatchObject({ step: 'start', code: 'ServiceFailedToStart' })
    const originalId = failed.events.find((entry) => entry.step === 'setup' && entry.state === 'done')?.homeId
    expect(originalId).toMatch(/^home_[a-f0-9]{32}$/)
    at.identity.homeId = originalId ?? ''
    await at.run(at.inUnit)
    expect(at.install).toHaveBeenCalledTimes(1)
    expect(await at.read()).toMatchObject({ state: 'done' })
    expect(at.output.join('')).toContain(originalId)
    const snapshot = readFileSync(at.stateFile, 'utf8')
    await at.run()
    expect(readFileSync(at.stateFile, 'utf8')).toBe(snapshot)
    expect(at.ready).toHaveBeenCalledTimes(1)
  })

  it('reads an interrupted identity checkpoint and resumes without reinstalling or re-enabling', async () => {
    const at = fixture()
    vi.stubEnv('ALTHAR_HOST_SETUP_UNIT', '1')
    vi.stubEnv('INVOCATION_ID', 'test')
    at.record([
      { step: 'setup', state: 'done', homeId: at.identity.homeId },
      { step: 'start', state: 'done' },
      { step: 'identity', state: 'started' },
    ])
    expect(await at.read()).toMatchObject({ state: 'interrupted' })
    at.active(true)
    expect(await at.read()).toMatchObject({ state: 'running' })
    at.active(false)
    await at.run(at.resume)
    expect(at.command.mock.calls.find(([file]) => file === 'systemd-run')?.[1]).toContain(at.plan.entry)
    at.ready.mockReturnValueOnce(Effect.succeed({ ...at.identity, homeId: 'different' }))
    await expect(at.run(at.inUnit)).rejects.toThrow('stopped')
    expect((await at.read()).events.at(-1)).toMatchObject({ step: 'identity', code: 'IdentityMismatch' })
    await at.run(at.inUnit)
    expect((await at.read()).events.at(-1)).toMatchObject({ step: 'identity', state: 'done', homeId: at.identity.homeId })
    expect(at.install).not.toHaveBeenCalled()
    expect(at.command.mock.calls.every((call) => !call[1].includes('--now'))).toBe(true)
  })

  it.each([
    ['disk full', 'ENOSPC', 'NotEnoughDisk'],
    ['unknown', 'EIO', 'InstallFailed'],
  ])('records a mid-install %s without enabling the host', async (message, code, expected) => {
    const at = fixture()
    vi.stubEnv('ALTHAR_HOST_SETUP_UNIT', '1')
    vi.stubEnv('INVOCATION_ID', 'test')
    at.install.mockRejectedValueOnce(Object.assign(new Error(message), { code }))
    await expect(at.run(at.inUnit)).rejects.toThrow('stopped')
    expect((await at.read()).events.at(-1)).toMatchObject({ step: 'setup', code: expected })
    expect(at.ready).not.toHaveBeenCalled()
  })

  it('uses a stable service readiness code on an unreachable API', async () => {
    const at = fixture()
    vi.stubEnv('ALTHAR_HOST_SETUP_UNIT', '1')
    vi.stubEnv('INVOCATION_ID', 'test')
    at.record([
      { step: 'setup', state: 'done', homeId: at.identity.homeId },
      { step: 'start', state: 'started' },
    ])
    at.ready.mockReturnValueOnce(Effect.fail(new HostError({ code: 'HostUnavailable', message: 'unready' })))
    await expect(at.run(at.inUnit)).rejects.toThrow('stopped')
    expect((await at.read()).events.at(-1)).toMatchObject({ step: 'identity', code: 'ServiceFailedToStart' })
  })
})
