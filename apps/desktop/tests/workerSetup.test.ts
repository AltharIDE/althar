import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { expect, it, vi } from 'vitest'

import { findRelease, findWorkerRelease, workerRelease } from '../src/main/homes/release'
import { runProgram, type Ran, type RunOptions, type SetupSystem } from '../src/main/homes/setup'
import { forTheLog, terminalLine, transferTime, workerSetups, type WorkerLog } from '../src/main/homes/workerSetup'
import type { WorkerSetup } from '../src/workers'

const now = Date.parse('2026-01-20T00:00:00.000Z')
const signed = (version: string, extra: Record<string, unknown> = {}, pair = generateKeyPairSync('ed25519')) => {
  const { privateKey, publicKey } = pair
  const manifest = {
    format: 1,
    version,
    sequence: 1,
    publishedAt: '2025-11-01T00:00:00.000Z',
    expiresAt: '2026-05-01T00:00:00.000Z',
    platform: 'linux',
    apiVersion: 1,
    storage: 'c'.repeat(64),
    arch: 'x64',
    archive: { url: 'https://example.test/a.tar.gz', sha256: 'b'.repeat(64), bytes: 40_000_000 },
    unpackedBytes: 120_000_000,
    ...extra,
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

it('installs a worker from its own release, beside the home’s; from one before workers had their own, from the home’s', async () => {
  const signal = new AbortController().signal
  const pair = generateKeyPairSync('ed25519')
  const home = signed('0.3.0', {}, pair)
  const worker = signed('0.3.0', { product: 'worker', archive: { url: 'https://x.test/w.tar.gz', sha256: 'd'.repeat(64), bytes: 9 } }, pair)
  const releases = [
    {
      tag_name: 'host-v0.3.0',
      draft: false,
      prerelease: false,
      assets: [asset('althar-host-linux-x64.json'), asset('althar-worker-linux-x64.json')],
    },
    { tag_name: 'host-v0.2.0', draft: false, prerelease: false, assets: [asset('althar-host-linux-x64.json')] },
  ]
  const serving = (listed: typeof releases) =>
    vi.fn(async (url: string, _init?: unknown) =>
      new URL(url).host === 'api.github.com'
        ? Response.json(listed)
        : new Response(url.endsWith('althar-worker-linux-x64.json') ? worker.envelope : home.envelope),
    )
  const source = (listed: typeof releases) => ({ keys: [home.pem], fetch: serving(listed), now: () => now })
  expect(await findWorkerRelease('x64', source(releases), signal)).toMatchObject({ version: '0.3.0', url: 'https://x.test/w.tar.gz' })
  // A home is never set up from a worker's release, nor the other way round where the worker's own is published.
  expect(await findRelease('x64', source(releases), signal)).toMatchObject({ url: 'https://example.test/a.tar.gz' })
  expect(await findWorkerRelease('x64', source(releases.slice(1)), signal)).toMatchObject({ url: 'https://example.test/a.tar.gz' })
  const swapped = vi.fn(async (url: string, _init?: unknown) =>
    new URL(url).host === 'api.github.com' ? Response.json(releases) : new Response(worker.envelope),
  )
  await expect(findRelease('x64', { keys: [home.pem], fetch: swapped, now: () => now }, signal)).rejects.toThrow(/failed its check/)
  // A release of your own: the worker's where it is one, else the home's it names.
  const own = (envelope: string) => ({
    keys: [home.pem],
    manifest: 'http://127.0.0.1:8080/r/m.json',
    fetch: vi.fn(async () => new Response(envelope)),
    now: () => now,
  })
  expect(await findWorkerRelease('x64', own(worker.envelope), signal)).toMatchObject({ url: 'https://x.test/w.tar.gz' })
  expect(await findWorkerRelease('x64', own(home.envelope), signal)).toMatchObject({ url: 'https://example.test/a.tar.gz' })
  await expect(findRelease('x64', own(worker.envelope), signal)).rejects.toThrow(/failed its check/)
})

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
  // Under a key Althar doesn't pin, or where its manifest can't be read, it can't be found out: never said to have no worker.
  await expect(workerRelease({ keys: [signed('0.2.0').pem], fetch: fetcher, now: () => now }, signal)).rejects.toThrow(/failed its check/)
  const down = vi.fn(async (url: string, _init?: unknown) =>
    new URL(url).host === 'api.github.com' ? Response.json(releases) : new Response('', { status: 503 }),
  )
  await expect(workerRelease({ keys: [pem], fetch: down, now: () => now }, signal)).rejects.toBeTruthy()
  // A release of your own is taken unread, its files beside its manifest.
  expect(await workerRelease({ keys: [pem], manifest: 'http://127.0.0.1:8080/r/althar-host-linux-x64.json', fetch: down }, signal)).toEqual(
    {
      kind: 'ready',
      version: 'own',
      base: 'http://127.0.0.1:8080/r',
    },
  )
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

it('logs each step of a run that goes through, and nothing of the grant it hands the worker', async () => {
  const event = (step: string, state: string, more: Record<string, unknown> = {}) => JSON.stringify({ protocol: 1, step, state, ...more })
  const { system, lines, log } = machine({
    probe: { stdout: [event('reach', 'done'), event('look', 'done', { arch: 'arm64', freeKiB: 65_000_000, linger: true })].join('\n') },
    'worker-install': { stdout: event('key', 'done', { publicKey: 'PUBLIC' }) },
    'worker-enroll': { stdout: event('start', 'done', { agents: [] }) },
  })
  vi.mocked(system.release).mockResolvedValue({
    envelope: new Uint8Array([1]),
    key: 'KEY',
    version: '0.2.0',
    url: 'https://x.test/a.tar.gz',
    sha256: 'a'.repeat(64),
    bytes: 1,
    unpackedBytes: 1,
    apiVersion: 1,
    storage: 'c'.repeat(64),
  })
  const told: Array<WorkerSetup | null> = []
  const release = vi.fn(async () => ({ kind: 'ready' as const, version: '0.2.0', base: 'https://x.test' }))
  const setups = workerSetups(system, vi.fn(), (setup) => told.push(setup), vi.fn(), { log, release })
  setups.start({ target: 'build@box' }, true)
  await vi.waitFor(() => expect(told.at(-1)?.phase).toBe('enroll'))
  const grant = { homeId: `home_${'1'.repeat(32)}`, workerId: `wrk_${'7'.repeat(32)}`, authority: 'CA', certificate: 'CERT' }
  await setups.act({ kind: 'enroll', grant: grant as never })
  await vi.waitFor(() => expect(told.at(-1)?.phase).toBe('done'))
  expect(lines.filter((line) => line.message === 'Adding a worker: step').map((line) => line.fields?.step)).toEqual([
    'look',
    'get',
    'enroll',
    'start',
    'done',
  ])
  expect(lines.map((line) => line.message)).toContain('Adding a worker: started')
  expect(lines.some((line) => line.level !== 'INFO')).toBe(false)
  expect(JSON.stringify(lines)).not.toContain(Buffer.from(JSON.stringify(grant)).toString('base64url'))
})

it('logs a sign-in’s failure with its words, and its other steps by kind only', async () => {
  const { system, lines, log } = machine({})
  const { PassThrough } = await import('node:stream')
  const { EventEmitter } = await import('node:events')
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin: new PassThrough(),
    kill: vi.fn(),
  })
  const said = vi.fn()
  const setups = workerSetups(system, (() => child) as never, vi.fn(), said, {
    log,
    release: vi.fn(async () => ({ kind: 'ready' as const, version: '0.2.0', base: 'https://x.test' })),
  })
  await setups.signIn('build@box', 'codex', 'device')
  const event = (more: Record<string, unknown>) => `${JSON.stringify({ protocol: 1, step: 'sign-in', ...more })}\n`
  child.stdout.write(event({ state: 'started', kind: 'device', code: 'WXYZ-1234', page: 'https://x.test/device', minutes: 15 }))
  child.stdout.write(event({ state: 'done', kind: 'refused', message: 'Pasted ABCD-9876 was wrong' }))
  child.stdout.write(event({ state: 'failed', kind: 'failed', message: 'The provider stopped answering.' }))
  await vi.waitFor(() => expect(said).toHaveBeenCalledTimes(3))
  expect(lines).toContainEqual(
    expect.objectContaining({
      level: 'WARN',
      message: 'Worker sign-in failed',
      fields: expect.objectContaining({ message: 'The provider stopped answering.' }),
    }),
  )
  const written = JSON.stringify(lines)
  expect(written).toContain('"kind":"device"')
  expect(written).not.toContain('WXYZ-1234')
  expect(written).not.toContain('ABCD-9876')
  child.emit('exit', 255)
  setups.stop()
})

it('leaves codes, grants and keys out of what it logs, and keeps the last lines', () => {
  expect(forTheLog(`a\n\nb ${'A'.repeat(64)}==\nc`, 2)).toBe('b …\nc')
  expect(forTheLog('join althar-worker1.abc.def')).toBe('join althar-worker1.…')
})

it('ends with the worker’s check: stays at it where its sandbox can’t start, and says when sudo couldn’t allow it', async () => {
  const event = (step: string, state: string, more: Record<string, unknown> = {}) => JSON.stringify({ protocol: 1, step, state, ...more })
  const fix = "sudo sh -c 'apparmor_parser -r /etc/apparmor.d/althar-worker-bwrap'"
  const blocked = event('check', 'done', {
    sandbox: { starts: false, problem: 'NoUserNamespaces', fix },
    tools: [],
    agents: [{ id: 'codex', name: 'Codex', signedIn: false, models: 0 }],
  })
  const { system, asked } = machine({
    probe: { stdout: [event('reach', 'done'), event('look', 'done', { arch: 'x64', freeKiB: 65_000_000, linger: true })].join('\n') },
    'worker-install': { stdout: event('key', 'done', { publicKey: 'PUBLIC' }) },
    'worker-enroll': { stdout: [event('start', 'done', { agents: [] }), event('check', 'started'), blocked].join('\n') },
    'worker-sandbox': {
      code: 1,
      stdout: [
        blocked,
        event('sandbox', 'failed', { code: 'NeedsAdministrator', message: 'This login can’t use sudo without a password here.' }),
      ].join('\n'),
    },
  })
  vi.mocked(system.release).mockResolvedValue({
    envelope: new Uint8Array([1]),
    key: 'KEY',
    version: '0.3.0',
    url: 'https://x.test/a.tar.gz',
    sha256: 'a'.repeat(64),
    bytes: 1,
    unpackedBytes: 1,
    apiVersion: 1,
    storage: 'c'.repeat(64),
  })
  const told: Array<WorkerSetup | null> = []
  const release = vi.fn(async () => ({ kind: 'ready' as const, version: '0.3.0', base: 'https://x.test' }))
  const setups = workerSetups(system, vi.fn(), (setup) => told.push(setup), vi.fn(), { log: machine({}).log, release })
  setups.start({ target: 'build@box' }, true)
  await vi.waitFor(() => expect(told.at(-1)?.phase).toBe('enroll'))
  await setups.act({ kind: 'enroll', grant: { homeId: `home_${'1'.repeat(32)}`, workerId: `wrk_${'7'.repeat(32)}` } as never })
  await vi.waitFor(() => expect(told.at(-1)?.phase).toBe('done'))
  // Added, at its check: what stops a task there, with the command that lets it.
  expect(told.at(-1)).toMatchObject({ at: 5, check: { sandbox: { starts: false, problem: 'NoUserNamespaces', fix } } })
  await setups.act({ kind: 'sandbox' })
  await vi.waitFor(() => expect(told.at(-1)?.check?.allowed).toBe('NeedsAdministrator'))
  expect(told.at(-1)).toMatchObject({ phase: 'done', at: 5, checking: false })
  expect(asked).toContain('worker-sandbox')
})

it('takes a worker release’s base, without its agents’ own programs, and refuses one that isn’t over HTTPS', async () => {
  const signal = new AbortController().signal
  const pair = generateKeyPairSync('ed25519')
  const base = { url: 'https://x.test/base.tar.gz', sha256: 'e'.repeat(64), bytes: 50, files: 3, unpackedBytes: 500 }
  const own = (extra: Record<string, unknown>, product = 'worker') => ({
    keys: [signed('0.3.1', {}, pair).pem],
    manifest: 'http://127.0.0.1:8080/r/m.json',
    fetch: vi.fn(async () => new Response(signed('0.3.1', { product, ...extra }, pair).envelope)),
    now: () => now,
  })
  expect(await findWorkerRelease('x64', own({ base }), signal)).toMatchObject({
    url: 'https://example.test/a.tar.gz',
    base: { url: 'https://x.test/base.tar.gz', sha256: 'e'.repeat(64), bytes: 50, unpackedBytes: 500 },
  })
  expect((await findWorkerRelease('x64', own({}), signal)).base).toBeUndefined()
  await expect(findWorkerRelease('x64', own({ base: { ...base, url: 'http://x.test/b' } }), signal)).rejects.toThrow(/failed its check/)
  await expect(findWorkerRelease('x64', own({ base: { ...base, sha256: 'nope' } }), signal)).rejects.toThrow(/failed its check/)
})

/** Adding a worker from a release in parts, its first install answered as `first` says: what each install was asked, and its deadline. */
const addingInParts = async (first: Partial<Ran>) => {
  const event = (step: string, state: string, more: Record<string, unknown> = {}) => JSON.stringify({ protocol: 1, step, state, ...more })
  const installs: Array<{ readonly args: ReadonlyArray<string>; readonly timeout: number }> = []
  const { system: given, log } = machine({})
  const system: SetupSystem = {
    ...given,
    run: async (program: string, args: ReadonlyArray<string>, options: RunOptions) => {
      const operation = program !== 'ssh' ? program : (/^sh -s -- '([a-z-]+)'/.exec(args.at(-1) ?? '')?.[1] ?? 'resolve')
      const answers: Record<string, string> = {
        probe: [event('reach', 'done'), event('look', 'done', { arch: 'x64', freeKiB: 65_000_000, linger: true })].join('\n'),
        'worker-prepare-upload': event('get', 'started', { uploadId: 'abcdefgh', uploadPath: '/u/archive.partial' }),
      }
      if (operation === 'worker-install') {
        installs.push({
          args:
            args
              .at(-1)
              ?.split(' ')
              .map((one) => one.replace(/^'|'$/gu, ''))
              .slice(4, 9) ?? [],
          timeout: options.timeout,
        })
        if (installs.length === 1) return { code: 1, stdout: '', stderr: '', ...first }
        return { code: 0, stdout: event('key', 'done', { publicKey: 'PUBLIC' }), stderr: '' }
      }
      return { code: 0, stdout: answers[operation] ?? '', stderr: '' }
    },
  }
  vi.mocked(system.release).mockResolvedValue({
    envelope: new Uint8Array([1]),
    key: 'KEY',
    version: '0.3.1',
    url: 'https://x.test/whole.tar.gz',
    sha256: 'a'.repeat(64),
    bytes: 400_000_000,
    unpackedBytes: 1_000_000_000,
    apiVersion: 1,
    storage: 'c'.repeat(64),
    base: {
      url: 'https://x.test/base.tar.gz',
      sha256: 'e'.repeat(64),
      bytes: 60_000_000,
      unpackedBytes: 200_000_000,
    },
  })
  vi.mocked(system.scratch).mockResolvedValue({ path: '/scratch', remove: async () => {} })
  const told: Array<WorkerSetup | null> = []
  const release = vi.fn(async () => ({ kind: 'ready' as const, version: '0.3.1', base: 'https://x.test' }))
  workerSetups(system, vi.fn(), (setup) => told.push(setup), vi.fn(), { log, release }).start({ target: 'build@box' }, true)
  await vi.waitFor(() => expect(['enroll', 'failed']).toContain(told.at(-1)?.phase))
  return { installs, told, system, event }
}

it('downloads a release in parts on the machine by its base, and sends the whole one where the machine can’t download', async () => {
  const event = (step: string, state: string, more: Record<string, unknown> = {}) => JSON.stringify({ protocol: 1, step, state, ...more })
  const { installs, system } = await addingInParts({ stdout: event('get', 'failed', { code: 'CannotDownload' }) })
  // On the machine, the base, with the time it takes; sent from here, the whole release, which needs nothing more.
  expect(installs[0]?.args).toEqual(['download', 'e'.repeat(64), '60000000', '200000000', 'https://x.test/base.tar.gz'])
  expect(installs[0]?.timeout).toBe(transferTime(60_000_000))
  expect(transferTime(400_000_000)).toBeGreaterThan(60 * 60_000)
  expect(installs[1]?.args).toEqual(['upload', 'a'.repeat(64), '400000000', '1000000000', 'abcdefgh'])
  expect(vi.mocked(system.fetchArchive).mock.calls[0]?.[0]).toMatchObject({ url: 'https://x.test/whole.tar.gz', sha256: 'a'.repeat(64) })
})

it('sends the whole release where downloading on the machine outran its time, and stops at Get where a part won’t fit', async () => {
  // Stopped at its deadline: OpenSSH exits 255 when stopped, as for a connection that failed; no word from the machine.
  const slow = await addingInParts({ code: 255, timedOut: true })
  expect(slow.installs.map((one) => one.args[0])).toEqual(['download', 'upload'])
  expect(slow.told.at(-1)?.phase).toBe('enroll')
  // A connection that failed is still that.
  const gone = await addingInParts({ code: 255, stderr: 'ssh: connect to host box port 22: Connection refused' })
  expect(gone.installs).toHaveLength(1)
  expect(gone.told.at(-1)).toMatchObject({ phase: 'failed', problem: { code: 'Unreachable' } })
  const full = await addingInParts({ stdout: slow.event('get', 'failed', { code: 'NotEnoughDisk' }) })
  expect(full.installs).toHaveLength(1)
  expect(full.told.at(-1)).toMatchObject({ phase: 'failed', at: 2, problem: { code: 'NotEnoughDisk' } })
})

it('says a program it ran was stopped at its deadline, whatever it exited with then', async () => {
  const signal = new AbortController().signal
  // Node, which every computer the tests run on has; where a stop is a signal it can catch, it exits 255 as OpenSSH does.
  const node = (script: string, timeout: number) => runProgram(process.execPath, ['-e', script], { signal, timeout })
  const late = await node('process.on("SIGTERM", () => process.exit(255)); setTimeout(() => undefined, 20_000)', 500)
  expect(late.timedOut).toBe(true)
  if (process.platform !== 'win32') expect(late.code).toBe(255)
  const done = await node('process.exit(3)', 20_000)
  expect(done.code).toBe(3)
  expect(done.timedOut).toBeUndefined()
})

it('gives an agent’s own sign-in as the line that runs it on the worker over its SSH address, its port where it has one', () => {
  expect(terminalLine('althar@build-box', 'opencode auth login --standalone')).toBe(
    "ssh -t althar@build-box 'opencode auth login --standalone'",
  )
  expect(terminalLine('me@10.0.0.9:2222', "copilot login --host 'x'")).toBe(`ssh -t -p 2222 me@10.0.0.9 'copilot login --host '\\''x'\\'''`)
})

it('checks a worker’s sign-ins by its whole check, so one signed in in a terminal is started, and its models said, first', async () => {
  const event = (step: string, state: string, more: Record<string, unknown> = {}) => JSON.stringify({ protocol: 1, step, state, ...more })
  const agents = [
    // Junie can't say whether it is signed in: its check started it, so it is.
    { id: 'junie', name: 'Junie', signedIn: true, started: true, models: 3 },
    { id: 'qwen-code', name: 'Qwen Code', signedIn: false, started: false, message: 'It didn’t start.', models: 0 },
  ]
  const { system, asked, log } = machine({
    'worker-check': { stdout: [event('check', 'started'), event('check', 'done', { sandbox: { starts: true }, agents })].join('\n') },
  })
  const setups = workerSetups(system, vi.fn(), vi.fn(), vi.fn(), { log, release: vi.fn() })
  expect(await setups.agents('build@box')).toEqual([
    { id: 'junie', name: 'Junie', signedIn: true },
    { id: 'qwen-code', name: 'Qwen Code', signedIn: false },
  ])
  expect(asked).toContain('worker-check')
  expect(asked).not.toContain('worker-agents')
})

it('runs a worker’s whole check for Check again: its sandbox as a fix left it, and nothing where its release doesn’t say', async () => {
  const event = (step: string, state: string, more: Record<string, unknown> = {}) => JSON.stringify({ protocol: 1, step, state, ...more })
  const fix = "sudo sh -c 'apparmor_parser -r /etc/apparmor.d/althar-worker-bwrap'"
  const { system, asked, log } = machine({
    'worker-check': {
      stdout: [
        event('check', 'started'),
        event('check', 'done', { sandbox: { starts: false, problem: 'NoUserNamespaces', fix }, agents: [] }),
      ].join('\n'),
    },
  })
  const setups = workerSetups(system, vi.fn(), vi.fn(), vi.fn(), { log, release: vi.fn() })
  expect(await setups.check('build@box')).toEqual({ sandbox: { starts: false, problem: 'NoUserNamespaces', fix }, agents: [] })
  expect(asked).toContain('worker-check')
  const older = machine({ 'worker-check': { stdout: event('check', 'started') } })
  expect(await workerSetups(older.system, vi.fn(), vi.fn(), vi.fn(), { log: older.log, release: vi.fn() }).check('build@box')).toBeNull()
})
