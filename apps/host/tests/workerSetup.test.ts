import { generateKeyPairSync, sign } from 'node:crypto'
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { agents } from '@althar/provider-adapters'
import { openWorkers, workerAuthority } from '@althar/runtime/workerHome'
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { HOST_VERSION } from '../src/home'
import { releaseIdentity } from '../src/updates/release'
import { enroll, install, join_, listAgents, update, withWorkerSystem, workerMain } from '../src/workerSetup'
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
    expect(program).toContain(`${join(data, 'althar-worker-program', 'current', 'node', 'bin')}:/usr/local/bin`)
    expect(statSync(join(folder, 'agents', 'codex')).mode & 0o777).toBe(0o700)
    expect(readFileSync(join(folder, 'signed-in'), 'utf8')).toBe('codex\n')
    const unit = readFileSync(join(config, 'systemd', 'user', 'althar-worker.service'), 'utf8')
    expect(unit).toContain(`ExecStart=${join(data, 'althar-worker-program', 'current', 'althar-worker')} serve ${folder}`)
    expect(unit).toContain('Restart=always')
    expect(existsSync(join(config, 'systemd', 'user', 'althar-worker-update.timer'))).toBe(true)
    expect(calls).toEqual([
      ['daemon-reload'],
      ['enable', 'althar-worker.service', 'althar-worker-update.timer'],
      ['restart', 'althar-worker.service'],
      ['start', 'althar-worker-update.timer'],
    ])
    expect(said.at(-1)).toMatchObject({
      step: 'start',
      state: 'done',
      workerId,
      agents: [
        { id: 'codex', name: 'Codex', signedIn: true },
        { id: 'claude-code', name: 'Claude Code', signedIn: false },
      ],
    })
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
  it('starts the worker again to say a change, unless it runs a task', async () => {
    await install(release(), out)
    await enroll(await grantFor(keyOf()), out)
    calls = []
    restore()
    restore = withWorkerSystem({
      systemctl: async (args) => {
        calls.push(args)
        return args[0] === 'list-units' ? busy : ''
      },
      signedIn: async () => true,
      agents: () => [
        { id: 'codex', definition: agents.codex, program: '/opt/codex' },
        { id: 'claude-code', definition: agents['claude-code'], program: '/opt/claude' },
      ],
    })
    busy = 'althar-agent-war_1.service loaded active running'
    await listAgents(out)
    expect(said.at(-1)).toMatchObject({ step: 'agents', restarted: false })
    expect(readFileSync(join(data, 'althar-worker', 'signed-in'), 'utf8')).toBe('codex\nclaude-code\n')
    // Nothing changed since: nothing to say again.
    busy = ''
    await listAgents(out)
    expect(said.at(-1)).toMatchObject({ step: 'agents', restarted: false })
    expect(calls.some((args) => args[0] === 'try-restart')).toBe(false)
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
          expect(said.at(-1)).toMatchObject({ step: 'start', state: 'done' })
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
    expect(said.at(-1)).toMatchObject({ step: 'update', state: 'current', version: HOST_VERSION })
    // A newer one, signed by the same key, while a task runs: it waits for the next check.
    const [major, minor, patch] = HOST_VERSION.split('.').map(Number)
    const newer = JSON.parse(Buffer.from(JSON.parse(installed.envelope).payload, 'base64url').toString('utf8')) as Record<string, unknown>
    const body = Buffer.from(JSON.stringify({ ...newer, version: `${major}.${minor}.${(patch ?? 0) + 1}`, sequence: 2 }))
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
