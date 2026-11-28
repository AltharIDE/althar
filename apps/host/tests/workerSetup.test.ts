import { createHash, generateKeyPairSync, sign, X509Certificate } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:https'
import { join } from 'node:path'

import { agents, type AgentDefinition } from '@althar/provider-adapters'
import { c } from 'tar'
import { openWorkers, workerAuthority } from '@althar/runtime/workerHome'
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { HOST_VERSION } from '../src/home'
import type { CheckSystem } from '../src/workerCheck'
import { treeDigest } from '../src/updates/parts'
import { releaseIdentity } from '../src/updates/release'
import {
  enroll,
  install,
  join_,
  listAgents,
  programFolder,
  signIn,
  update,
  withWorkerSystem,
  workerFolder,
  workerMain,
} from '../src/workerSetup'
import { temporary } from './support'

/*
 * A worker's own setup, as the window's SSH setup and a code run it on the machine (apps/host/src/workerSetup.ts),
 * with its user's service manager and its agents' sign-in checks stood in for: the release it was given made current,
 * its own key, what its home gave written down, its agents for any project, its services started, and a code's way to
 * the same against a home's real code port.
 */

const homeId = `home_${'1'.repeat(32)}`
const workerId = `wrk_${'2'.repeat(32)}`
let said: Array<Record<string, unknown>>
const out = (text: string) => {
  for (const line of text.split('\n')) if (line !== '') said.push(JSON.parse(line) as Record<string, unknown>)
}
let calls: Array<ReadonlyArray<string>>
let busy = ''
/** Its check, stood in for: bubblewrap starts, git is there, and an agent started says its models. */
const checking: CheckSystem = {
  run: async (command) => ({ ok: true, stdout: command.endsWith('git') ? 'git version 2.43.0' : '', stderr: '' }),
  read: () => undefined,
  executable: (path) => /\/(bwrap|socat|git)$/u.test(path) && !path.includes('/usr/local/'),
  startAgent: async () => [{ id: 'gpt-6.2-sol', name: 'GPT-6.2 Sol' }],
}
let restore: () => void
let data: string
let config: string

beforeEach(() => {
  said = []
  calls = []
  busy = ''
  const root = temporary()
  data = join(root, 'data')
  config = join(root, 'config')
  process.env.XDG_DATA_HOME = data
  process.env.XDG_CONFIG_HOME = config
  restore = withWorkerSystem({
    systemctl: async (args) => {
      calls.push(args)
      return args[0] === 'list-units' ? busy : ''
    },
    signedIn: async (agent) => agent.id === 'codex',
    agents: () => [
      { id: 'codex', definition: agents.codex, program: '/opt/codex' },
      { id: 'claude-code', definition: agents['claude-code'], program: '/opt/claude' },
    ],
    check: checking,
    shipped: () => ({}),
    sudo: async () => false,
  })
})
afterEach(() => {
  restore()
  delete process.env.XDG_DATA_HOME
  delete process.env.XDG_CONFIG_HOME
})

/** A release as ssh.sh unpacks it, in the worker's program folder. */
const release = (name = 'bundle-abc') => {
  const folder = join(data, 'althar-worker-program', name)
  mkdirSync(folder, { recursive: true, mode: 0o700 })
  writeFileSync(join(folder, 'althar-worker'), '#!/bin/sh\n', { mode: 0o700 })
  return folder
}
const keyOf = () => said.find((one) => one.step === 'key')?.publicKey as string
const grantFor = async (publicKey: string, home = homeId, worker = workerId) => {
  const authority = await workerAuthority(join(temporary(), 'profile'), Date.now())
  return {
    homeId: home,
    workerId: worker,
    authority: authority.certificate,
    certificate: authority.issue(Buffer.from(publicKey, 'base64url'), worker, Date.now()),
    serverName: 'home.althar.invalid',
    port: 6770,
    addresses: ['192.168.1.2:6770', 'studio.local:6770'],
  }
}

describe('installing a worker from its release', () => {
  it('points current at it and makes its own key once, kept private', async () => {
    const folder = release()
    await install(folder, out)
    const key = keyOf()
    expect(key).toMatch(/^[A-Za-z0-9_-]{80,}$/u)
    expect(said[0]).toMatchObject({ protocol: 1, step: 'key', state: 'done', release: HOST_VERSION })
    expect(readlinkSync(join(data, 'althar-worker-program', 'current'))).toBe(folder)
    expect(statSync(join(data, 'althar-worker', 'worker.key')).mode & 0o777).toBe(0o600)
    // Again, as Try again does: the same key, the newer release current.
    said = []
    const newer = release('bundle-def')
    await install(newer, out)
    expect(keyOf()).toBe(key)
    expect(readlinkSync(join(data, 'althar-worker-program', 'current'))).toBe(newer)
  })

  it('refuses a folder that isn’t a release in its program folder, or one with no worker', async () => {
    await expect(install(temporary(), out)).rejects.toMatchObject({ code: 'InvalidRequest' })
    const folder = release()
    chmodSync(join(folder, 'althar-worker'), 0o600)
    await expect(install(folder, out)).rejects.toMatchObject({ code: 'NoWorker' })
  })
})

describe('enrolling a worker with what its home gave', () => {
  it('writes it down, its agents for any project, and starts its services', async () => {
    await install(release(), out)
    await enroll(await grantFor(keyOf()), out, ['10.0.0.5:6770'])
    const folder = join(data, 'althar-worker')
    expect(readFileSync(join(folder, 'enrollment'), 'utf8').split('\n')).toEqual([
      homeId,
      workerId,
      'home.althar.invalid',
      '10.0.0.5:6770',
      '192.168.1.2:6770',
      'studio.local:6770',
      '',
    ])
    expect(readFileSync(join(folder, 'agents.conf'), 'utf8')).toBe(
      `${join(folder, 'workspaces')}\n*\tcodex\t${join(folder, 'agents', 'codex')}\n*\tclaude-code\t${join(folder, 'agents', 'claude-code')}\n`,
    )
    const program = readFileSync(join(folder, 'agents', 'codex'), 'utf8')
    // The run's PATH, as the worker gives it; where none came, the worker's own, its sandbox's programs first.
    expect(program).toContain('if [ -z "${PATH:-}" ]; then PATH=')
    expect(program).toContain(`${join(folder, 'bin')}:`)
    expect(program).toContain(`:${join(data, 'althar-worker-program', 'current', 'node', 'bin')}'`)
    expect(statSync(join(folder, 'agents', 'codex')).mode & 0o777).toBe(0o700)
    expect(readFileSync(join(folder, 'signed-in'), 'utf8')).toBe('codex\n')
    const unit = readFileSync(join(config, 'systemd', 'user', 'althar-worker.service'), 'utf8')
    expect(unit).toContain(`ExecStart=${join(data, 'althar-worker-program', 'current', 'althar-worker')} serve ${folder}`)
    expect(unit).toContain('Restart=always')
    expect(existsSync(join(config, 'systemd', 'user', 'althar-worker-update.timer'))).toBe(true)
    // A release with no worker entry of its own is a home's: its update runs as `althar-host worker update`.
    expect(readFileSync(join(config, 'systemd', 'user', 'althar-worker-update.service'), 'utf8')).toContain(
      `${join(data, 'althar-worker-program', 'current', 'dist', 'althar-host.js')} worker update\n`,
    )
    expect(calls).toEqual([
      ['daemon-reload'],
      ['enable', 'althar-worker.service', 'althar-worker-update.timer'],
      ['restart', 'althar-worker.service'],
      ['start', 'althar-worker-update.timer'],
    ])
    expect(said.find((one) => one.step === 'start' && one.state === 'done')).toMatchObject({
      workerId,
      agents: [
        { id: 'codex', name: 'Codex', signedIn: true },
        { id: 'claude-code', name: 'Claude Code', signedIn: false },
      ],
    })
    // Then a test run: its sandbox started, and its signed-in agent started once, which said its models.
    expect(said.at(-1)).toMatchObject({
      step: 'check',
      state: 'done',
      sandbox: { starts: true },
      agents: [
        { id: 'codex', signedIn: true, started: true, models: 1 },
        { id: 'claude-code', signedIn: false, models: 0 },
      ],
    })
    expect(readFileSync(join(folder, 'readiness'), 'utf8')).toBe(
      'sandbox\tstarts\ntool\tgit\t2.43.0\nmodel\tcodex\tgpt-6.2-sol\tGPT-6.2 Sol\nagent\tcodex\tstarts\n',
    )
  })

  it('keeps what it did for another home apart when it joins a new one', async () => {
    await install(release(), out)
    await enroll(await grantFor(keyOf()), out)
    const folder = join(data, 'althar-worker')
    mkdirSync(join(folder, 'journal', 'runs'), { recursive: true })
    await enroll(await grantFor(keyOf(), `home_${'3'.repeat(32)}`, `wrk_${'4'.repeat(32)}`), out)
    expect(lstatSync(join(folder, `journal-${workerId}`, 'runs')).isDirectory()).toBe(true)
    expect(existsSync(join(folder, 'journal', 'runs'))).toBe(false)
  })

  it('refuses what isn’t a grant, or one signed for another key', async () => {
    await install(release(), out)
    await expect(enroll({ homeId: 'nope' }, out)).rejects.toMatchObject({ code: 'InvalidRequest' })
    const other = generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ type: 'spki', format: 'der' })
    await expect(enroll(await grantFor(other.toString('base64url')), out)).rejects.toMatchObject({ code: 'WrongKey' })
  })
})

describe('its agents, checked again', () => {
  it('keeps who is signed in where the worker says it with its heartbeats, without starting it again', async () => {
    await install(release(), out)
    await enroll(await grantFor(keyOf()), out)
    calls = []
    restore()
    restore = withWorkerSystem({
      systemctl: async (args) => {
        calls.push(args)
        return ''
      },
      signedIn: async () => true,
      agents: () => [
        { id: 'codex', definition: agents.codex, program: '/opt/codex' },
        { id: 'claude-code', definition: agents['claude-code'], program: '/opt/claude' },
      ],
      check: checking,
      shipped: () => ({}),
    })
    await listAgents(out)
    expect(said.at(-1)).toMatchObject({ step: 'agents', state: 'done' })
    expect(readFileSync(join(data, 'althar-worker', 'signed-in'), 'utf8')).toBe('codex\nclaude-code\n')
    expect(calls).toEqual([])
  })
})

describe('a code’s way', () => {
  it('asks the home at the addresses the code gives, trusting only its authority, and enrolls', async () => {
    const root = temporary()
    const paths = { profile: join(root, 'profile'), worktrees: join(root, 'worktrees') }
    mkdirSync(paths.profile, { mode: 0o700 })
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const home = yield* openWorkers(paths, homeId)
          const { code } = yield* Effect.promise(() => home.managed!.code('laptop'))
          yield* Effect.promise(async () => {
            await install(release(), out)
            await join_(code, 'build-box', out)
          })
          expect(home.workers()).toEqual([expect.objectContaining({ name: 'build-box' })])
          expect(said.findLast((one) => one.step === 'start')).toMatchObject({ step: 'start', state: 'done' })
          // The address that answered goes first, on the home's worker port.
          const lines = readFileSync(join(data, 'althar-worker', 'enrollment'), 'utf8').split('\n')
          expect(lines[3]).toMatch(new RegExp(`:${home.port}$`, 'u'))
        }),
      ),
    )
  })

  it('refuses what isn’t a code, and one that expired', async () => {
    await expect(join_('althar-pairing1.abc', 'x', out)).rejects.toMatchObject({ code: 'InvalidRequest' })
    const expired = `althar-worker1.${Buffer.from(
      JSON.stringify({ homeId, addresses: [], port: 1, authority: '', token: 't', expiresAt: Date.now() - 1 }),
    ).toString('base64url')}`
    await expect(join_(expired, 'x', out)).rejects.toMatchObject({ code: 'Expired' })
  })
})

describe('updating itself', () => {
  const seal = (version: string, sequence: number) => {
    const pair = generateKeyPairSync('ed25519')
    const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
    const payload = Buffer.from(
      JSON.stringify({
        format: 1,
        version,
        sequence,
        publishedAt: new Date(Date.now() - 1000).toISOString(),
        expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        platform: 'linux',
        arch: process.arch === 'arm64' ? 'arm64' : 'x64',
        updaterProtocol: 1,
        apiVersion: 1,
        storage: 'a'.repeat(64),
        archive: { url: 'https://updates.example/release.tar.gz', sha256: 'b'.repeat(64), bytes: 100 },
        files: 6,
        unpackedBytes: 100,
      }),
    )
    const envelope = JSON.stringify({
      format: 1,
      keyId: releaseIdentity(publicKey),
      payload: payload.toString('base64url'),
      signature: sign(null, payload, pair.privateKey).toString('base64url'),
    })
    return { publicKey, envelope, pair }
  }

  it('stays as it is with no newer release, and waits while it runs a task', async () => {
    const folder = release()
    await install(folder, out)
    const installed = seal(HOST_VERSION, 1)
    writeFileSync(join(folder, '.manifest'), installed.envelope, { mode: 0o600 })
    writeFileSync(join(folder, '.release-key'), installed.publicKey, { mode: 0o600 })
    const answer = (body: string) => (async () => new Response(body)) as unknown as typeof fetch
    writeFileSync(join(data, 'althar-worker', 'update-feed'), 'https://updates.example/manifest.json', { mode: 0o600 })
    await update(out, answer(installed.envelope))
    expect(said.findLast((one) => one.step === 'update')).toMatchObject({ step: 'update', state: 'current', version: HOST_VERSION })
    // A newer one, signed by the same key, while a task runs: it waits for the next check.
    const [major, minor, patch] = HOST_VERSION.split('.').map(Number)
    const newer = JSON.parse(Buffer.from(JSON.parse(installed.envelope).payload, 'base64url').toString('utf8')) as Record<string, unknown>
    const body = Buffer.from(JSON.stringify({ ...newer, version: `${major}.${minor}.${(patch ?? 0) + 1}`, sequence: 2, product: 'worker' }))
    const envelope = JSON.stringify({
      format: 1,
      keyId: releaseIdentity(installed.publicKey),
      payload: body.toString('base64url'),
      signature: sign(null, body, installed.pair.privateKey).toString('base64url'),
    })
    busy = 'althar-agent-war_1.service loaded active running'
    await update(out, answer(envelope))
    expect(said.at(-1)).toMatchObject({ step: 'update', state: 'waiting' })
  })
})

describe('its command line', () => {
  it('says what it can’t do, as JSON, with its exit code', async () => {
    expect(await workerMain(['nonsense'], out)).toBe(64)
    expect(said.at(-1)).toMatchObject({ state: 'failed', code: 'InvalidRequest' })
    expect(await workerMain(['enroll', '--grant', Buffer.from('{}').toString('base64url')], out)).toBe(1)
    expect(said.at(-1)).toMatchObject({ step: 'enroll', state: 'failed', code: 'InvalidRequest' })
    expect(await workerMain(['install', '--program', '/nowhere'], out)).toBe(1)
    expect(await workerMain(['sign-in', '--agent', 'nobody'], out)).toBe(1)
    expect(said.at(-1)).toMatchObject({ code: 'UnknownAgent' })
  })
})

describe('a code’s way, where it doesn’t get through', () => {
  const codeOf = (fields: Record<string, unknown>) => `althar-worker1.${Buffer.from(JSON.stringify(fields)).toString('base64url')}`

  it('asks for the worker first, says the home couldn’t be reached, and what the home said where it refused', async () => {
    const root = temporary()
    const paths = { profile: join(root, 'profile'), worktrees: join(root, 'worktrees') }
    mkdirSync(paths.profile, { mode: 0o700 })
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const home = yield* openWorkers(paths, homeId)
          const { code } = yield* Effect.promise(() => home.managed!.code('laptop'))
          const read = JSON.parse(Buffer.from(code.slice(code.indexOf('.') + 1), 'base64url').toString('utf8')) as Record<string, unknown>
          yield* Effect.promise(async () => {
            // Not installed yet: it has no key to enroll.
            await expect(join_(code, 'box', out)).rejects.toMatchObject({ code: 'NoKey' })
            await install(release(), out)
            // Nobody answers at the addresses it gives.
            await expect(join_(codeOf({ ...read, addresses: ['127.0.0.1:1', '[::1]:1'] }), 'box', out)).rejects.toMatchObject({
              code: 'Unreachable',
              message: 'Couldn’t reach the home at [::1]:1.',
            })
            // The home answers, and refuses a token it never made.
            await expect(join_(codeOf({ ...read, token: 'not-its-token' }), 'box', out)).rejects.toMatchObject({ code: 'Refused' })
          })
          expect(home.workers()).toEqual([])
        }),
      ),
    )
  })
})

describe('finding the newest release, with no feed of its own', () => {
  const asset = `althar-worker-linux-${process.arch === 'arm64' ? 'arm64' : 'x64'}.json`
  const listing = (releases: ReadonlyArray<Record<string, unknown>>, manifest = '') =>
    (async (input: string) =>
      new URL(input).hostname === 'api.github.com'
        ? new Response(JSON.stringify(releases))
        : new Response(manifest)) as unknown as typeof fetch
  const sealed = () => {
    const pair = generateKeyPairSync('ed25519')
    const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
    const payload = Buffer.from(
      JSON.stringify({
        format: 1,
        version: HOST_VERSION,
        sequence: 1,
        publishedAt: new Date(Date.now() - 1000).toISOString(),
        expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        platform: 'linux',
        arch: process.arch === 'arm64' ? 'arm64' : 'x64',
        updaterProtocol: 1,
        apiVersion: 1,
        storage: 'a'.repeat(64),
        archive: { url: 'https://updates.example/release.tar.gz', sha256: 'b'.repeat(64), bytes: 100 },
        files: 6,
        unpackedBytes: 100,
      }),
    )
    const envelope = JSON.stringify({
      format: 1,
      keyId: releaseIdentity(publicKey),
      payload: payload.toString('base64url'),
      signature: sign(null, payload, pair.privateKey).toString('base64url'),
    })
    return { publicKey, envelope }
  }

  it('passes over drafts, prereleases, other tags and releases without its asset, and says when there is none', async () => {
    const folder = release()
    await install(folder, out)
    const installed = sealed()
    writeFileSync(join(folder, '.manifest'), installed.envelope, { mode: 0o600 })
    writeFileSync(join(folder, '.release-key'), installed.publicKey, { mode: 0o600 })
    const passed = [
      { tag_name: 'host-v9.0.0', draft: true, assets: [{ name: asset, browser_download_url: 'https://x/draft' }] },
      { tag_name: 'host-v9.0.0', prerelease: true, assets: [{ name: asset, browser_download_url: 'https://x/pre' }] },
      { tag_name: 'desktop-v9.0.0', assets: [{ name: asset, browser_download_url: 'https://x/desktop' }] },
      { tag_name: 'host-v8.0.0', assets: [{ name: 'other.json', browser_download_url: 'https://x/other' }] },
      { tag_name: 'host-v8.0.0' },
      {},
    ]
    await expect(update(out, listing(passed))).rejects.toMatchObject({ code: 'NoRelease' })
    // The newest that is the host's, with the worker's asset: here, the one it runs already.
    const found = [...passed, { tag_name: 'host-v1.0.0', assets: [{ name: asset, browser_download_url: 'https://x/host' }] }]
    await update(out, listing(found, installed.envelope))
    expect(said.findLast((one) => one.step === 'update')).toMatchObject({ step: 'update', state: 'current', version: HOST_VERSION })
    // An empty feed is no feed.
    writeFileSync(join(data, 'althar-worker', 'update-feed'), '\n', { mode: 0o600 })
    await update(out, listing(found, installed.envelope))
    expect(said.findLast((one) => one.step === 'update')).toMatchObject({ step: 'update', state: 'current' })
  })

  it('fails from the command line where it isn’t installed, in its own words', async () => {
    expect(await workerMain(['update'], out)).toBe(1)
    expect(said.at(-1)).toMatchObject({ step: 'update', state: 'failed' })
  })
})

describe('its command line, at work', () => {
  it('enrolls with the home first where it was set up from, by IPv4 or IPv6, and lists its agents', async () => {
    await install(release(), out)
    const grant = await grantFor(keyOf())
    const encoded = Buffer.from(JSON.stringify(grant)).toString('base64url')
    expect(await workerMain(['enroll', '--grant', encoded, '--first', 'fd00::2'], out)).toBe(0)
    expect(readFileSync(join(data, 'althar-worker', 'enrollment'), 'utf8').split('\n')[3]).toBe('[fd00::2]:6770')
    expect(await workerMain(['enroll', '--grant', encoded, '--first', '192.168.1.9'], out)).toBe(0)
    expect(readFileSync(join(data, 'althar-worker', 'enrollment'), 'utf8').split('\n')[3]).toBe('192.168.1.9:6770')
    expect(await workerMain(['enroll', '--grant', Buffer.from(JSON.stringify({ ...grant, port: 'x' })).toString('base64url')], out)).toBe(0)
    expect(await workerMain(['agents'], out)).toBe(0)
    expect(said.at(-1)).toMatchObject({ step: 'agents', state: 'done' })
    expect(await workerMain(['join', '--code', 'nonsense'], out)).toBe(1)
    expect(said.at(-1)).toMatchObject({ step: 'join', code: 'InvalidRequest' })
    expect(await workerMain(['sign-in', '--agent', 'nobody', '--way', 'device'], out)).toBe(1)
    expect(await workerMain([], out)).toBe(64)
  })
})

describe('its command line, at its edges', () => {
  it('reads a missing flag as nothing, and says a failure that has no code of its own', async () => {
    expect(await workerMain(['install'], out)).toBe(1)
    expect(await workerMain(['join'], out)).toBe(1)
    expect(said.at(-1)).toMatchObject({ step: 'join', code: 'InvalidRequest' })
    expect(await workerMain(['sign-in'], out)).toBe(1)
    expect(said.at(-1)).toMatchObject({ code: 'UnknownAgent' })
    // Not a grant at all: what it couldn't read, with no code of its own.
    expect(await workerMain(['enroll', '--grant', Buffer.from('not json').toString('base64url')], out)).toBe(1)
    expect(said.at(-1)).toMatchObject({ step: 'enroll', state: 'failed', code: 'Failed' })
  })

  it('keeps its folders under the user’s own where nothing says otherwise', () => {
    expect(workerFolder({})).toMatch(/\.local\/share\/althar-worker$/u)
    expect(programFolder({ XDG_DATA_HOME: '/data' })).toBe('/data/althar-worker-program')
  })

  it('keeps its key when installed again', async () => {
    await install(release(), out)
    const first = keyOf()
    said = []
    await install(release('bundle-def'), out)
    expect(keyOf()).toBe(first)
  })

  it('refuses a grant with no addresses, or one it can’t use', async () => {
    await install(release(), out)
    const grant = await grantFor(keyOf())
    for (const addresses of [undefined, [], ['bad address!']])
      await expect(enroll({ ...grant, addresses }, out)).rejects.toMatchObject({ code: 'InvalidRequest' })
    await expect(enroll({ ...grant, serverName: 'Not A Name' }, out)).rejects.toMatchObject({ code: 'InvalidRequest' })
  })

  it('says an agent doesn’t sign in that way here, then what it has', async () => {
    restore()
    const { inApp: _none, ...rest } = agents.codex.signIn
    const plain: AgentDefinition = { ...agents.codex, signIn: rest }
    restore = withWorkerSystem({
      systemctl: async () => '',
      signedIn: async () => false,
      agents: () => [{ id: 'codex', definition: plain, program: '/opt/codex' }],

      check: checking,
      shipped: () => ({}),
    })
    await install(release(), out)
    await signIn('codex', 'device', out)
    expect(said).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ step: 'sign-in', kind: 'failed', message: 'This agent doesn’t sign in that way here.' }),
      ]),
    )
    expect(said.findLast((one) => one.step === 'agents')).toMatchObject({ step: 'agents', state: 'done' })
    // Then its check, for the agent it may have signed in.
    expect(said.at(-1)).toMatchObject({ step: 'check', state: 'done' })
  })
})

describe('updating itself to a newer release', () => {
  it('downloads it, checks and unpacks it, switches to it and starts again, keeping the one before', async () => {
    const pair = generateKeyPairSync('ed25519')
    const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
    const envelopeOf = (fields: Record<string, unknown>) => {
      const payload = Buffer.from(
        JSON.stringify({
          format: 1,
          publishedAt: new Date(Date.now() - 1000).toISOString(),
          expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
          platform: 'linux',
          arch,
          updaterProtocol: 1,
          apiVersion: 1,
          storage: 'a'.repeat(64),
          ...fields,
        }),
      )
      return JSON.stringify({
        format: 1,
        keyId: releaseIdentity(publicKey),
        payload: payload.toString('base64url'),
        signature: sign(null, payload, pair.privateKey).toString('base64url'),
      })
    }
    // What it runs now, and an older release beside it, which goes once the newer one is current.
    const folder = release()
    await install(folder, out)
    writeFileSync(
      join(folder, '.manifest'),
      envelopeOf({
        version: HOST_VERSION,
        sequence: 1,
        archive: { url: 'https://updates.example/old.tar.gz', sha256: 'b'.repeat(64), bytes: 100 },
        files: 1,
        unpackedBytes: 1,
      }),
      { mode: 0o600 },
    )
    writeFileSync(join(folder, '.release-key'), publicKey, { mode: 0o600 })
    release('bundle-older')
    // The newer release, as its archive.
    const root = temporary()
    const source = join(root, 'source')
    mkdirSync(join(source, 'dist'), { recursive: true })
    writeFileSync(join(source, 'dist', 'althar-worker.js'), 'host')
    writeFileSync(join(source, 'althar-worker'), 'worker', { mode: 0o700 })
    const archive = join(root, 'release.tar.gz')
    await c({ file: archive, cwd: source, gzip: true, portable: true, noMtime: true }, ['dist', 'althar-worker'])
    const bytes = readFileSync(archive)
    const [major, minor, patch] = HOST_VERSION.split('.').map(Number)
    const version = `${major}.${minor}.${(patch ?? 0) + 1}`
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const manifest = envelopeOf({
      version,
      sequence: 2,
      archive: { url: 'https://updates.example/release.tar.gz', sha256, bytes: bytes.length },
      files: 2,
      unpackedBytes: 'host'.length + 'worker'.length,
      product: 'worker',
    })
    writeFileSync(join(data, 'althar-worker', 'update-feed'), 'https://updates.example/manifest.json', { mode: 0o600 })
    const fetcher = (async (input: string) =>
      input.endsWith('.tar.gz') ? new Response(bytes) : new Response(manifest)) as unknown as typeof fetch
    await update(out, fetcher)
    expect(said.at(-1)).toMatchObject({ step: 'update', state: 'done', version })
    const program = join(data, 'althar-worker-program')
    expect(readlinkSync(join(program, 'current'))).toContain(`bundle-${sha256}`)
    expect(readFileSync(join(data, 'althar-worker', 'release'), 'utf8')).toBe(`${version}\n`)
    expect(calls).toEqual(expect.arrayContaining([['daemon-reload'], ['restart', 'althar-worker.service']]))
    expect(existsSync(join(program, 'bundle-abc'))).toBe(true)
    expect(existsSync(join(program, 'bundle-older'))).toBe(false)
    // A worker's own release runs its update by its own entry, through `current`.
    expect(readFileSync(join(config, 'systemd', 'user', 'althar-worker-update.service'), 'utf8')).toContain(
      `ExecStart=${join(program, 'current', 'node', 'bin', 'node')} ${join(program, 'current', 'dist', 'althar-worker.js')} update\n`,
    )
  })

  it('moves a worker installed from a home’s release to the worker’s own of the same release, and only then', async () => {
    const pair = generateKeyPairSync('ed25519')
    const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
    const envelopeOf = (fields: Record<string, unknown>) => {
      const payload = Buffer.from(
        JSON.stringify({
          format: 1,
          version: HOST_VERSION,
          sequence: 7,
          publishedAt: new Date(Date.now() - 1000).toISOString(),
          expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
          platform: 'linux',
          arch,
          updaterProtocol: 1,
          apiVersion: 1,
          storage: 'a'.repeat(64),
          files: 2,
          ...fields,
        }),
      )
      return JSON.stringify({
        format: 1,
        keyId: releaseIdentity(publicKey),
        payload: payload.toString('base64url'),
        signature: sign(null, payload, pair.privateKey).toString('base64url'),
      })
    }
    // Installed from a home's release, which runs its commands as `althar-host worker …`.
    const folder = release()
    mkdirSync(join(folder, 'dist'))
    writeFileSync(join(folder, 'dist', 'althar-host.js'), 'host')
    await install(folder, out)
    const home = envelopeOf({
      archive: { url: 'https://updates.example/host.tar.gz', sha256: 'b'.repeat(64), bytes: 100 },
      unpackedBytes: 1,
    })
    writeFileSync(join(folder, '.manifest'), home, { mode: 0o600 })
    writeFileSync(join(folder, '.release-key'), publicKey, { mode: 0o600 })
    const source = join(temporary(), 'source')
    mkdirSync(join(source, 'dist'), { recursive: true })
    writeFileSync(join(source, 'dist', 'althar-worker.js'), 'worker commands')
    writeFileSync(join(source, 'althar-worker'), 'worker', { mode: 0o700 })
    const archive = join(source, '..', 'worker.tar.gz')
    await c({ file: archive, cwd: source, gzip: true, portable: true, noMtime: true }, ['dist', 'althar-worker'])
    const bytes = readFileSync(archive)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    // The same release, as the worker's own: same version, same sequence.
    const own = envelopeOf({
      archive: { url: 'https://updates.example/worker.tar.gz', sha256, bytes: bytes.length },
      unpackedBytes: 'worker commands'.length + 'worker'.length,
      product: 'worker',
    })
    writeFileSync(join(data, 'althar-worker', 'update-feed'), 'https://updates.example/manifest.json', { mode: 0o600 })
    const serving = (manifest: string) =>
      (async (input: string) => (input.endsWith('.tar.gz') ? new Response(bytes) : new Response(manifest))) as unknown as typeof fetch
    // A home's release in the worker's feed is never taken.
    await update(out, serving(home))
    expect(said.findLast((one) => one.step === 'update')).toMatchObject({ state: 'current' })
    await update(out, serving(own))
    expect(said.at(-1)).toMatchObject({ step: 'update', state: 'done', version: HOST_VERSION })
    const program = join(data, 'althar-worker-program')
    expect(readlinkSync(join(program, 'current'))).toContain(`bundle-${sha256}`)
    expect(readFileSync(join(config, 'systemd', 'user', 'althar-worker-update.service'), 'utf8')).toContain('dist/althar-worker.js update')
    // On its own release now, the same one again is no update.
    await update(out, serving(own))
    expect(said.findLast((one) => one.step === 'update')).toMatchObject({ state: 'current' })
  })
})

describe('its agents and its grant, at their edges', () => {
  it('runs an agent’s own sign-in, says how it ended, then what it has', async () => {
    restore()
    const failing: AgentDefinition = {
      ...agents['claude-code'],
      signIn: {
        ...agents['claude-code'].signIn,
        inApp: { kind: 'claude-login', ways: ['browser'], run: () => ({ command: process.execPath, args: ['-e', 'process.exit(1)'] }) },
      },
    }
    restore = withWorkerSystem({
      systemctl: async () => '',
      signedIn: async () => false,
      agents: () => [{ id: 'claude-code', definition: failing, program: '/opt/claude' }],

      check: checking,
      shipped: () => ({}),
    })
    await install(release(), out)
    await signIn('claude-code', 'browser', out)
    expect(said).toEqual(expect.arrayContaining([expect.objectContaining({ step: 'sign-in', kind: 'failed' })]))
    expect(said.findLast((one) => one.step === 'agents')).toMatchObject({ step: 'agents', state: 'done' })
  })

  it('keeps an earlier enrollment’s runs apart, by its name or as before, and refuses another authority’s certificate', async () => {
    await install(release(), out)
    const grant = await grantFor(keyOf())
    mkdirSync(join(data, 'althar-worker', 'journal'), { recursive: true })
    writeFileSync(join(data, 'althar-worker', 'enrollment'), 'home_other', { mode: 0o600 })
    expect(await workerMain(['enroll', '--grant', Buffer.from(JSON.stringify(grant)).toString('base64url')], out)).toBe(0)
    expect(existsSync(join(data, 'althar-worker', 'journal-before'))).toBe(true)
    const other = await grantFor(keyOf())
    await expect(enroll({ ...grant, authority: other.authority }, out)).rejects.toMatchObject({ code: 'WrongKey' })
  })
})

describe('a home that answers a code oddly', () => {
  it('says the home refused where it gives no reason, and takes no grant without the port it answered on', async () => {
    const authority = await workerAuthority(join(temporary(), 'profile'), Date.now())
    let answer = { status: 403, body: '{}' }
    const server = createServer({ cert: authority.home.certificate, key: authority.home.key }, (_request, response) => {
      response.writeHead(answer.status, { 'content-type': 'application/json' })
      response.end(answer.body)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const port = (server.address() as { port: number }).port
      const code = `althar-worker1.${Buffer.from(
        JSON.stringify({
          homeId,
          addresses: [`127.0.0.1:${port}`],
          port,
          authority: new X509Certificate(authority.certificate).raw.toString('base64url'),
          token: 't',
          expiresAt: Date.now() + 60_000,
        }),
      ).toString('base64url')}`
      await install(release(), out)
      await expect(join_(code, 'box', out)).rejects.toMatchObject({ code: 'Refused', message: 'The home refused this worker.' })
      answer = { status: 200, body: '{}' }
      await expect(join_(code, 'box', out)).rejects.toMatchObject({ code: 'Unreachable' })
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})

describe('where its user keeps things', () => {
  it('puts its services under the user’s own config folder where nothing else says', async () => {
    const home = temporary()
    const was = process.env.HOME
    process.env.HOME = home
    delete process.env.XDG_CONFIG_HOME
    try {
      await install(release(), out)
      await enroll(await grantFor(keyOf()), out)
      expect(existsSync(join(home, '.config', 'systemd', 'user', 'althar-worker.service'))).toBe(true)
    } finally {
      process.env.HOME = was
    }
  })
})

describe('its check, and letting its sandbox start', () => {
  /** A machine whose bubblewrap starts only once AppArmor's rule is in, as newer Ubuntu's does. */
  const ubuntu = () => {
    let ruled = false
    const ran: string[] = []
    const system: CheckSystem = {
      ...checking,
      run: async (command, args) => {
        ran.push([command, ...args].join(' '))
        return { ok: !args.includes('--unshare-user') || ruled, stdout: '', stderr: '' }
      },
      read: (path) => (path === '/proc/sys/kernel/apparmor_restrict_unprivileged_userns' ? '1\n' : undefined),
    }
    return { system, ran, rule: () => (ruled = true) }
  }

  it('says why its sandbox can’t start and the one command that lets it, and lets it with sudo where it may', async () => {
    const machine = ubuntu()
    const sudo: string[] = []
    restore()
    restore = withWorkerSystem({
      systemctl: async () => '',
      signedIn: async () => false,
      agents: () => [],
      check: machine.system,
      shipped: () => ({}),
      sudo: async (script) => {
        sudo.push(script)
        machine.rule()
        return true
      },
    })
    await install(release(), out)
    expect(await workerMain(['check'], out)).toBe(0)
    const found = said.at(-1) as { sandbox: { starts: boolean; problem: string; fix: string } }
    expect(found).toMatchObject({ step: 'check', state: 'done', sandbox: { starts: false, problem: 'NoUserNamespaces' } })
    expect(found.sandbox.fix).toMatch(/^sudo sh -c '.*apparmor_parser -r \/etc\/apparmor\.d\/althar-worker-bwrap'$/u)
    expect(found.sandbox.fix).toContain(`profile althar-worker-bwrap ${join(data, 'althar-worker-program')}/bundle-*/**/bwrap`)
    expect(readFileSync(join(data, 'althar-worker', 'readiness'), 'utf8')).toContain('sandbox\tfails\tNoUserNamespaces\nfix\tsudo sh -c')
    said = []
    expect(await workerMain(['sandbox'], out)).toBe(0)
    // What went to sudo is the check's own script, without its `sudo sh -c` and quotes.
    expect(sudo).toEqual([found.sandbox.fix.slice("sudo sh -c '".length, -1)])
    expect(said.at(-1)).toMatchObject({ step: 'check', state: 'done', sandbox: { starts: true } })
    expect(readFileSync(join(data, 'althar-worker', 'readiness'), 'utf8')).toMatch(/^sandbox\tstarts\n/u)
  })

  it('says so where its login can’t use sudo without a password, and leaves the command for an administrator', async () => {
    const machine = ubuntu()
    restore()
    restore = withWorkerSystem({
      systemctl: async () => '',
      signedIn: async () => false,
      agents: () => [],
      check: machine.system,
      shipped: () => ({}),
      sudo: async () => false,
    })
    await install(release(), out)
    expect(await workerMain(['sandbox'], out)).toBe(1)
    expect(said.at(-1)).toMatchObject({ step: 'sandbox', state: 'failed', code: 'NeedsAdministrator' })
    expect(readFileSync(join(data, 'althar-worker', 'readiness'), 'utf8')).toContain('fix\tsudo sh -c')
  })

  it('asks nothing of sudo where its sandbox starts, and says where nothing it knows lets it, or it still can’t', async () => {
    const asked: string[] = []
    const machine = ubuntu()
    const using = (check: CheckSystem) => {
      restore()
      restore = withWorkerSystem({
        systemctl: async () => '',
        signedIn: async () => false,
        agents: () => [],
        check,
        shipped: () => ({}),
        // It may, but what it runs changes nothing.
        sudo: async (script) => {
          asked.push(script)
          return true
        },
      })
    }
    await install(release(), out)
    using(checking)
    expect(await workerMain(['sandbox'], out)).toBe(0)
    expect(asked).toEqual([])
    using({ ...checking, executable: () => false })
    expect(await workerMain(['sandbox'], out)).toBe(1)
    expect(said.at(-1)).toMatchObject({ step: 'sandbox', state: 'failed', code: 'SandboxUnfixable' })
    using(machine.system)
    expect(await workerMain(['sandbox'], out)).toBe(1)
    expect(said.at(-1)).toMatchObject({ step: 'sandbox', state: 'failed', code: 'SandboxStillFails' })
    expect(asked).toHaveLength(1)
  })

  it('links what the release ships for the sandbox through current, and only what it ships', async () => {
    restore()
    restore = withWorkerSystem({
      systemctl: async () => '',
      signedIn: async () => false,
      agents: () => [],
      check: checking,
      shipped: (running) => ({ bwrap: join(running, 'tools', 'bin', 'bwrap'), rg: undefined, socat: '/opt/socat' }),
      sudo: async () => false,
    })
    await install(release(), out)
    await enroll(await grantFor(keyOf()), out)
    const bin = join(data, 'althar-worker', 'bin')
    expect(readlinkSync(join(bin, 'bwrap'))).toBe(join(data, 'althar-worker-program', 'current', 'tools', 'bin', 'bwrap'))
    expect(readlinkSync(join(bin, 'socat'))).toBe('/opt/socat')
    expect(existsSync(join(bin, 'rg'))).toBe(false)
  })

  it('installs only the tools a worker installs itself, saying why not in a plain line', async () => {
    const lines: string[] = []
    expect(await workerMain(['tools', 'cargo@1'], (text) => lines.push(text))).toBe(1)
    expect(lines.join('')).toBe('cargo@1 isn’t a tool a worker installs.\n')
  })
})

describe('a release in parts', () => {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  const claude = 'node_modules/@anthropic-ai/claude-agent-sdk-test'
  const codex = 'node_modules/@openai/codex-test'
  /** A folder of files, made: each path's text, executable where it says. */
  const tree = (folder: string, files: Record<string, string>) => {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(folder, path, '..'), { recursive: true, mode: 0o700 })
      writeFileSync(join(folder, path), text, { mode: path.endsWith('.json') ? 0o600 : 0o700 })
    }
    return folder
  }
  const archived = async (folder: string, file: string, zstd: boolean) => {
    await c({ file, cwd: folder, portable: true, noMtime: true, ...(zstd ? { zstd: true } : { gzip: true }) }, readdirSync(folder))
    const bytes = readFileSync(file)
    return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') }
  }
  const countOf = (files: Record<string, string>) => ({
    files: Object.keys(files).length,
    unpackedBytes: Object.values(files).reduce((sum, text) => sum + Buffer.byteLength(text), 0),
  })

  /** The newer release, as its base and its two parts, signed, and served from one place; what was asked for, kept. */
  const published = async (pair = generateKeyPairSync('ed25519'), tamper = false) => {
    const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
    const root = temporary()
    const baseFiles = { 'dist/althar-worker.js': 'worker commands', 'althar-worker': 'worker' }
    const claudeFiles = { 'package.json': '{"version":"0.3.331"}', claude: 'Claude Code 0.3.331' }
    const codexFiles = { 'package.json': '{"version":"0.173.0"}', 'vendor/bin/codex': 'Codex 0.173.0' }
    const base = await archived(tree(join(root, 'base'), baseFiles), join(root, 'base.tar.gz'), false)
    const parts = [
      { name: 'claude-agent-sdk-test', path: claude, files: claudeFiles },
      { name: 'codex-test', path: codex, files: codexFiles },
    ]
    const served = new Map<string, Buffer>()
    served.set('https://updates.example/base.tar.gz', base.bytes)
    const of = []
    for (const part of parts) {
      const folder = tree(join(root, part.name), part.files)
      const packed = await archived(folder, join(root, `${part.name}.tar.zst`), true)
      const url = `https://updates.example/${part.name}.tar.zst`
      served.set(url, packed.bytes)
      of.push({
        name: part.name,
        path: part.path,
        tree: tamper && part.name === 'codex-test' ? 'f'.repeat(64) : await treeDigest(folder),
        url,
        sha256: packed.sha256,
        bytes: packed.bytes.length,
        ...countOf(part.files),
      })
    }
    const [major, minor, patch] = HOST_VERSION.split('.').map(Number)
    const version = `${major}.${minor}.${(patch ?? 0) + 1}`
    const payload = Buffer.from(
      JSON.stringify({
        format: 1,
        version,
        sequence: 2,
        publishedAt: new Date(Date.now() - 1000).toISOString(),
        expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        platform: 'linux',
        arch,
        updaterProtocol: 1,
        apiVersion: 1,
        storage: 'a'.repeat(64),
        parts: {
          base: { url: 'https://updates.example/base.tar.gz', sha256: base.sha256, bytes: base.bytes.length, ...countOf(baseFiles) },
          of,
        },
        archive: { url: 'https://updates.example/whole.tar.gz', sha256: 'c'.repeat(64), bytes: 1000 },
        files: 6,
        unpackedBytes: 1000,
        product: 'worker',
      }),
    )
    const envelope = JSON.stringify({
      format: 1,
      keyId: releaseIdentity(publicKey),
      payload: payload.toString('base64url'),
      signature: sign(null, payload, pair.privateKey).toString('base64url'),
    })
    const asked: string[] = []
    const fetcher = (async (input: string) => {
      asked.push(input)
      if (input.endsWith('manifest.json')) return new Response(envelope)
      const body = served.get(input)
      return body === undefined ? new Response('', { status: 404 }) : new Response(body)
    }) as unknown as typeof fetch
    return { publicKey, pair, envelope, base, version, asked, fetcher, served }
  }

  it('updates by its base and only the parts the release it runs hasn’t got, lending the rest without a copy', async () => {
    const pair = generateKeyPairSync('ed25519')
    const newer = await published(pair)
    // What it runs: Claude Code's the same as the newer release's, Codex's older.
    const folder = release()
    await install(folder, out)
    tree(join(folder, claude), { 'package.json': '{"version":"0.3.331"}', claude: 'Claude Code 0.3.331' })
    tree(join(folder, codex), { 'package.json': '{"version":"0.172.0"}', 'vendor/bin/codex': 'Codex 0.172.0' })
    const installedPayload = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(JSON.parse(newer.envelope).payload, 'base64url').toString('utf8')),
        version: HOST_VERSION,
        sequence: 1,
        parts: undefined,
      }),
    )
    writeFileSync(
      join(folder, '.manifest'),
      JSON.stringify({
        format: 1,
        keyId: releaseIdentity(newer.publicKey),
        payload: installedPayload.toString('base64url'),
        signature: sign(null, installedPayload, pair.privateKey).toString('base64url'),
      }),
      { mode: 0o600 },
    )
    writeFileSync(join(folder, '.release-key'), newer.publicKey, { mode: 0o600 })
    writeFileSync(join(data, 'althar-worker', 'update-feed'), 'https://updates.example/manifest.json', { mode: 0o600 })
    await update(out, newer.fetcher)
    expect(said.at(-1)).toMatchObject({
      step: 'update',
      state: 'done',
      version: newer.version,
      lent: ['claude-agent-sdk-test'],
      downloaded: ['codex-test'],
    })
    expect(newer.asked).not.toContain('https://updates.example/claude-agent-sdk-test.tar.zst')
    expect(newer.asked).not.toContain('https://updates.example/whole.tar.gz')
    const program = join(data, 'althar-worker-program')
    const target = join(program, `bundle-${newer.base.sha256}`)
    expect(readlinkSync(join(program, 'current'))).toBe(target)
    expect(readFileSync(join(target, codex, 'vendor/bin/codex'), 'utf8')).toBe('Codex 0.173.0')
    expect(readFileSync(join(target, 'dist/althar-worker.js'), 'utf8')).toBe('worker commands')
    // Lent: the same file, linked, not a second copy; and it still runs.
    expect(statSync(join(target, claude, 'claude')).ino).toBe(statSync(join(folder, claude, 'claude')).ino)
    expect(statSync(join(target, claude, 'claude')).mode & 0o777).toBe(0o700)
    expect(statSync(join(target, codex, 'vendor/bin/codex')).mode & 0o777).toBe(0o700)
  })

  it('makes a release the bootstrap unpacked from its base whole as it installs, saying the download as it goes', async () => {
    const newer = await published()
    const folder = release(`bundle-${newer.base.sha256}`)
    tree(folder, { 'dist/althar-worker.js': 'worker commands' })
    writeFileSync(join(folder, '.manifest'), newer.envelope, { mode: 0o600 })
    writeFileSync(join(folder, '.release-key'), newer.publicKey, { mode: 0o600 })
    await install(folder, out, newer.fetcher)
    expect(readFileSync(join(folder, claude, 'claude'), 'utf8')).toBe('Claude Code 0.3.331')
    expect(readFileSync(join(folder, codex, 'vendor/bin/codex'), 'utf8')).toBe('Codex 0.173.0')
    const total = [...newer.served.values()].reduce((sum, bytes) => sum + bytes.length, 0)
    expect(said.findLast((one) => one.step === 'get')).toMatchObject({ state: 'done', bytes: total, totalBytes: total })
    expect(said.at(-1)).toMatchObject({ step: 'key', state: 'done' })
    expect(readdirSync(join(data, 'althar-worker-program')).filter((name) => name.startsWith('.install-'))).toEqual([])
    // Installed again, as Try again does: it has them, and asks for nothing.
    newer.asked.length = 0
    await install(folder, out, newer.fetcher)
    expect(newer.asked).toEqual([])
  })

  it('refuses a part that doesn’t hold what it should, and says it can’t download one it can’t reach', async () => {
    /** A release the bootstrap unpacked from its base, its manifest and key beside it. */
    const unpacked = (from: Awaited<ReturnType<typeof published>>) => {
      const folder = release(`bundle-${from.base.sha256}`)
      writeFileSync(join(folder, '.manifest'), from.envelope, { mode: 0o600 })
      writeFileSync(join(folder, '.release-key'), from.publicKey, { mode: 0o600 })
      return folder
    }
    const tampered = await published(undefined, true)
    const folder = unpacked(tampered)
    await expect(install(folder, out, tampered.fetcher)).rejects.toMatchObject({ code: 'ReleaseRejected', step: 'get' })
    // What it unpacked goes with it, so its space is free again.
    expect(existsSync(folder)).toBe(false)
    // Claude Code's part comes, Codex's can't be reached: the window sends the whole release from its own computer then,
    // into the space the base and the first part took.
    const unreachable = await published()
    unreachable.served.delete('https://updates.example/codex-test.tar.zst')
    const other = unpacked(unreachable)
    await expect(install(other, out, unreachable.fetcher)).rejects.toMatchObject({ code: 'CannotDownload', step: 'get' })
    expect(unreachable.asked).toContain('https://updates.example/claude-agent-sdk-test.tar.zst')
    expect(existsSync(other)).toBe(false)
    expect(readdirSync(join(data, 'althar-worker-program')).filter((name) => !name.startsWith('upload.'))).toEqual([])
    // Nor where its disk hasn't the room for one, said at the download as the bootstrap says it.
    const was = restore
    restore = withWorkerSystem({ free: async () => 1_048_576 })
    const again = unpacked(unreachable)
    expect(await workerMain(['install', '--program', again], out)).toBe(1)
    expect(said.at(-1)).toMatchObject({ step: 'get', state: 'failed', code: 'NotEnoughDisk' })
    expect(existsSync(again)).toBe(false)
    restore()
    restore = was
  })

  it('never removes the release it runs when making it whole again fails', async () => {
    const unreachable = await published()
    unreachable.served.delete('https://updates.example/codex-test.tar.zst')
    const folder = release(`bundle-${unreachable.base.sha256}`)
    writeFileSync(join(folder, '.manifest'), unreachable.envelope, { mode: 0o600 })
    writeFileSync(join(folder, '.release-key'), unreachable.publicKey, { mode: 0o600 })
    symlinkSync(folder, join(data, 'althar-worker-program', 'current'))
    await expect(install(folder, out, unreachable.fetcher)).rejects.toMatchObject({ code: 'CannotDownload' })
    expect(existsSync(join(folder, 'althar-worker'))).toBe(true)
  })
})
