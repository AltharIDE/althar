import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { expect, it, vi } from 'vitest'

import { workerRelease } from '../src/main/homes/release'
import type { Ran, RunOptions, SetupSystem } from '../src/main/homes/setup'
import { forTheLog, workerSetups, type WorkerLog } from '../src/main/homes/workerSetup'
import type { WorkerSetup } from '../src/workers'

const now = Date.parse('2026-11-25T00:00:00.000Z')
const signed = (version: string) => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const manifest = {
    format: 1,
    version,
    sequence: 1,
    publishedAt: '2026-11-20T00:00:00.000Z',
    expiresAt: '2027-05-01T00:00:00.000Z',
    platform: 'linux',
    arch: 'x64',
    archive: { url: 'https://example.test/a.tar.gz', sha256: 'b'.repeat(64), bytes: 40_000_000 },
    unpackedBytes: 120_000_000,
  }
  const payload = Buffer.from(JSON.stringify(manifest))
  const keyId = createHash('sha256')
    .update(publicKey.export({ type: 'spki', format: 'der' }))
    .digest('hex')
  const envelope = JSON.stringify({
    format: 1,
    keyId,
    payload: payload.toString('base64url'),
    signature: sign(null, payload, privateKey).toString('base64url'),
  })
  return { pem: publicKey.export({ type: 'spki', format: 'pem' }).toString(), envelope }
}
const asset = (name: string) => ({ name, browser_download_url: `https://x.test/${name}` })
const listing = (...releases: Array<Record<string, unknown>>) =>
  vi.fn(async (url: string, _init?: unknown) => (new URL(url).host === 'api.github.com' ? Response.json(releases) : new Response('no')))

it('says no release can add a worker where the newest host release came before workers, as host-v0.1.0 did', async () => {
  const signal = new AbortController().signal
  const fetcher = listing(
    { tag_name: 'v0.9.0', draft: false, prerelease: false, assets: [asset('latest.yml')] },
    {
      tag_name: 'host-v0.1.0',
      draft: false,
      prerelease: false,
      assets: [asset('althar-host-linux-x64.json'), asset('althar-host-linux-arm64.json')],
    },
  )
  expect(await workerRelease({ keys: [signed('0.1.0').pem], fetch: fetcher, now: () => now }, signal)).toEqual({
    kind: 'none',
    newest: '0.1.0',
    why: 'host-v0.1.0 publishes no althar-worker.sh, althar-host-release.pub: it came before workers.',
  })
  expect(await workerRelease({ keys: [], fetch: listing(), now: () => now }, signal)).toMatchObject({ kind: 'none', newest: null })
})

it('takes the newest host release with the worker’s bootstrap, once its manifest checks out, and where its files are', async () => {
  const signal = new AbortController().signal
  const { pem, envelope } = signed('0.2.0')
  const releases = [
    { tag_name: 'host-v0.3.0', draft: true, prerelease: false, assets: [] },
    {
      tag_name: 'host-v0.2.0',
      draft: false,
      prerelease: false,
      assets: [asset('althar-worker.sh'), asset('althar-host-release.pub'), asset('althar-host-linux-x64.json')],
    },
    { tag_name: 'host-v0.1.0', draft: false, prerelease: false, assets: [asset('althar-host-linux-x64.json')] },
  ]
  const fetcher = vi.fn(async (url: string, _init?: unknown) =>
    new URL(url).host === 'api.github.com'
      ? Response.json(releases)
      : new Response(url === 'https://x.test/althar-host-linux-x64.json' ? envelope : 'no'),
  )
  expect(await workerRelease({ keys: [pem], fetch: fetcher, now: () => now }, signal)).toEqual({
    kind: 'ready',
    version: '0.2.0',
    base: 'https://github.com/AltharIDE/althar/releases/download/host-v0.2.0',
  })
  // Under a key Althar doesn't pin, it can't be taken.
  expect(await workerRelease({ keys: [signed('0.2.0').pem], fetch: fetcher, now: () => now }, signal)).toMatchObject({
    kind: 'none',
    newest: '0.2.0',
  })
})

/** A worker's machine, by the operation ssh.sh is given; and what went to main.log. */
const machine = (answers: Record<string, Partial<Ran>>) => {
  const asked: string[] = []
  const system: SetupSystem = {
    run: async (program: string, args: ReadonlyArray<string>, _options: RunOptions) => {
      const operation = program !== 'ssh' ? program : (/^sh -s -- '([a-z-]+)'/.exec(args.at(-1) ?? '')?.[1] ?? 'resolve')
      asked.push(operation)
      return { code: 0, stdout: '', stderr: '', ...answers[operation] }
    },
    release: vi.fn(),
    fetchArchive: vi.fn(),
    readFile: async () => null,
    writeFile: async () => {},
    appendFile: async () => {},
    wait: async () => {},
    home: '/profile',
    scratch: vi.fn(),
  }
  const lines: Array<{ level: string; message: string; fields?: Record<string, unknown> }> = []
  const log: WorkerLog = {
    info: (message, fields) => lines.push({ level: 'INFO', message, ...(fields === undefined ? {} : { fields }) }),
    warn: (message, fields) => lines.push({ level: 'WARN', message, ...(fields === undefined ? {} : { fields }) }),
    error: (message, fields) => lines.push({ level: 'ERROR', message, ...(fields === undefined ? {} : { fields }) }),
  }
  return { system, asked, lines, log }
}
const ended = async (told: Array<WorkerSetup | null>) => {
  await vi.waitFor(() => expect(told.at(-1)?.phase).toBe('failed'))
  return told.at(-1)!
}

it('stops before the machine is touched where no release can add a worker, and says why in main.log', async () => {
  const { system, asked, lines, log } = machine({})
  const told: Array<WorkerSetup | null> = []
  const release = vi.fn(async () => ({ kind: 'none' as const, newest: '0.1.0', why: 'host-v0.1.0 publishes no althar-worker.sh' }))
  const setups = workerSetups(system, vi.fn(), (setup) => told.push(setup), vi.fn(), { log, release })
  setups.start({ target: 'build@box' }, true)
  expect(await ended(told)).toMatchObject({ at: 0, problem: { code: 'NoWorkerRelease', said: '0.1.0' } })
  expect(asked).toEqual([])
  expect(lines).toContainEqual(
    expect.objectContaining({
      level: 'ERROR',
      message: 'Adding a worker: no release can add one',
      fields: expect.objectContaining({ newest: '0.1.0' }),
    }),
  )
  // Try again asks afresh.
  await setups.act({ kind: 'again' })
  await vi.waitFor(() => expect(release).toHaveBeenLastCalledWith(true, expect.anything()))
})

it('keeps what SSH said where a step failed in main.log, with no secret in it', async () => {
  const stderr = [
    'debug1: Connecting to box [10.0.0.9] port 22.',
    'token althar-worker1.eyJob21lSWQiOiJob21lXzAxMjM0NTY3ODkwMTIzNDU2Nzg5MDEyIn0.c2ln and a grant eyJob21lSWQiOiJob21lXzAxMjM0NTY3ODkwMTIzNDU2Nzg5MDEyIn0',
    'ssh: connect to host box port 22: Connection refused',
  ].join('\n')
  const { system, lines, log } = machine({ probe: { code: 255, stderr } })
  const told: Array<WorkerSetup | null> = []
  const release = vi.fn(async () => ({ kind: 'ready' as const, version: '0.2.0', base: 'https://x.test' }))
  workerSetups(system, vi.fn(), (setup) => told.push(setup), vi.fn(), { log, release }).start({ target: 'build@box' }, true)
  expect(await ended(told)).toMatchObject({ at: 0, problem: { code: 'Unreachable' } })
  const call = lines.find((line) => line.message === 'Worker SSH call ended badly')
  expect(call?.fields).toMatchObject({ operation: 'probe', target: 'build@box', exit: 255 })
  expect(call?.fields?.stderr).toContain('Connection refused')
  expect(lines.find((line) => line.message === 'Adding a worker stopped')?.fields).toMatchObject({ step: 'reach', code: 'Unreachable' })
  const written = JSON.stringify(lines)
  expect(written).not.toContain('eyJob21lSWQiOiJob21lXzAxMjM0NTY3ODkwMTIzNDU2Nzg5MDEyIn0')
  expect(written).toContain('althar-worker1.…')
})

it('leaves codes, grants and keys out of what it logs, and keeps the last lines', () => {
  expect(forTheLog(`a\n\nb ${'A'.repeat(64)}==\nc`, 2)).toBe('b …\nc')
  expect(forTheLog('join althar-worker1.abc.def')).toBe('join althar-worker1.…')
})
