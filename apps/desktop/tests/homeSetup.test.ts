// @vitest-environment node
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { expect, it, vi } from 'vitest'

import type { HomeSetup } from '../src/homes'
import { authenticateRelease, findRelease, type HostRelease } from '../src/main/homes/release'
import { homeSetups, type Ran, type RunOptions, type SetupSystem } from '../src/main/homes/setup'

/*
 * Setting a home up over SSH, as main runs ssh.sh's protocol: a fake OpenSSH answers each operation as a server would,
 * and the setup is followed until the home answers, through its troubles.
 */

const HOME = `home_${'2'.repeat(32)}`
const KEY_BLOB = Buffer.from('server host key').toString('base64')
const LOGIN_BLOB = Buffer.from('login key').toString('base64')
const fingerprint = (blob: string) =>
  `SHA256:${createHash('sha256').update(Buffer.from(blob, 'base64')).digest('base64').replace(/=+$/, '')}`
const release: HostRelease = {
  envelope: new TextEncoder().encode('{"format":1}'),
  key: '-----BEGIN PUBLIC KEY-----\nfixture\n-----END PUBLIC KEY-----\n',
  version: '0.14.2',
  url: 'https://example.test/althar-host.tar.gz',
  sha256: 'a'.repeat(64),
  bytes: 40_000_000,
  unpackedBytes: 120_000_000,
}
const event = (step: string, state: string, more: Record<string, unknown> = {}) => JSON.stringify({ protocol: 1, step, state, ...more })
const looked = (more: Record<string, unknown> = {}) =>
  [
    event('reach', 'started'),
    event('reach', 'done'),
    event('look', 'started'),
    event('look', 'done', {
      os: 'linux',
      arch: 'x64',
      freeKiB: 22_020_096,
      git: true,
      login: 'deploy',
      root: false,
      linger: true,
      ...more,
    }),
  ].join('\n')
const hostStatus = (state: string, events: string[]) =>
  JSON.stringify({ protocol: 1, state, events: events.map((one) => JSON.parse(one) as unknown), rawOutput: '' })
const finished = [
  event('setup', 'started'),
  event('setup', 'done', { homeId: HOME }),
  event('start', 'started'),
  event('start', 'done'),
  event('identity', 'started'),
  event('identity', 'done', { homeId: HOME, version: '0.14.2', apiVersion: 1 }),
]

type Answer = Partial<Ran> | ((args: ReadonlyArray<string>, options: RunOptions) => Partial<Ran> | Promise<Partial<Ran>>)
/** A server, by what's asked of it: the operation ssh.sh is given (probe, status…), or another program (ssh-keyscan…). */
const server = (given: Record<string, Answer | Answer[]>) => {
  // Each server answers from its own copy: a list is used up as it's asked.
  const answers = Object.fromEntries(Object.entries(given).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value]))
  const asked: Array<{ program: string; args: ReadonlyArray<string>; operation: string }> = []
  const files = new Map<string, string>()
  const system: SetupSystem = {
    run: async (program, args, options) => {
      const remote = args.at(-1) ?? ''
      const operation =
        program !== 'ssh' ? program : args[0] === '-G' ? 'resolve' : (/^sh -s -- '([a-z-]+)'/.exec(remote)?.[1] ?? 'unknown')
      asked.push({ program, args, operation })
      const listed = answers[operation]
      const answer = Array.isArray(listed) ? (listed.length > 1 ? listed.shift() : listed[0]) : listed
      if (answer === undefined) throw new Error(`Nothing answers ${operation}`)
      const ran = { code: 0, stdout: '', stderr: '', ...(typeof answer === 'function' ? await answer(args, options) : answer) }
      for (const line of ran.stdout.split('\n')) options.line?.(line)
      return ran
    },
    release: vi.fn(async () => release),
    fetchArchive: vi.fn(async (_found, _to, progress) => progress(release.bytes)),
    readFile: async (path) => files.get(path) ?? null,
    writeFile: async (path, text) => {
      if (text === null) files.delete(path)
      else files.set(path, text)
    },
    appendFile: async (path, text) => {
      files.set(path, (files.get(path) ?? '') + text)
    },
    wait: async () => {},
    home: '/profile',
    scratch: '/scratch',
  }
  const told: Array<HomeSetup | null> = []
  return { system, asked, files, told, setups: () => homeSetups(system, (setup) => told.push(setup)) }
}
const settled = async (setups: ReturnType<ReturnType<typeof server>['setups']>, phase: HomeSetup['phase']) => {
  await vi.waitFor(async () => expect((await setups.state())?.phase).toBe(phase))
  return (await setups.state())!
}
const goesThrough = {
  probe: { stdout: looked() },
  status: [{ code: 1, stdout: event('setup', 'failed', { code: 'SetupNotFound' }) }, { stdout: hostStatus('done', finished) }],
  install: {
    stdout: [
      looked(),
      event('get', 'started', { bytes: 0, totalBytes: release.bytes }),
      event('get', 'progress', { bytes: 20_000_000, totalBytes: release.bytes }),
      event('get', 'done', { bytes: release.bytes, totalBytes: release.bytes }),
      event('setup', 'started', { detached: true }),
    ].join('\n'),
  },
}

it('sets a home up step by step, downloading the verified release on the server, and follows it until the home answers', async () => {
  const at = server(goesThrough)
  const setups = at.setups()
  setups.start({ target: 'deploy@vps.test', port: 2222 })
  // At once, before the server says anything.
  expect(at.told[0]).toMatchObject({ phase: 'running', at: 0, target: { target: 'deploy@vps.test' } })
  const done = await settled(setups, 'done')
  expect(done).toMatchObject({ at: 5, version: '0.14.2', facts: { arch: 'x64', git: true } })
  expect(at.told.some((one) => one?.progress?.bytes === 20_000_000)).toBe(true)
  const install = at.asked.find((one) => one.operation === 'install')!
  // Strict host keys, the person's own port, and the release's digest, sizes and signed envelope, each quoted.
  expect(install.args).toEqual(expect.arrayContaining(['-oBatchMode=yes', '-oStrictHostKeyChecking=yes', '-p', '2222', 'deploy@vps.test']))
  expect(install.args.at(-1)).toBe(
    `sh -s -- 'install' 'download' '${release.sha256}' '${release.bytes}' '${release.unpackedBytes}' '${release.url}' '${Buffer.from(release.envelope).toString('base64')}' '${Buffer.from(release.key).toString('base64')}'`,
  )
  expect(at.system.release).toHaveBeenCalledWith('x64', expect.any(AbortSignal))
  expect(done.log).toContain('althar-host status: ready')
  // Kept until it's connected or dismissed, so a restart of Althar opens on it.
  expect(JSON.parse(at.files.get('/profile/home-setup.json')!)).toMatchObject({ at: 5, target: { target: 'deploy@vps.test' } })
  await setups.act('dismiss')
  expect(at.told.at(-1)).toBeNull()
  await vi.waitFor(() => expect(at.files.has('/profile/home-setup.json')).toBe(false))
})

it('asks the person to trust a server’s key seen the first time, keeps it in known_hosts, and goes on', async () => {
  const at = server({
    ...goesThrough,
    probe: [
      {
        code: 255,
        stderr: 'No ED25519 host key is known for vps.test and you have requested strict checking.\nHost key verification failed.',
      },
      { stdout: looked() },
    ],
    resolve: { stdout: 'hostname vps.test\nport 22\nuserknownhostsfile /home/me/.ssh/known_hosts /home/me/.ssh/known_hosts2\n' },
    'ssh-keyscan': { stdout: `vps.test ssh-rsa ${LOGIN_BLOB}\nvps.test ssh-ed25519 ${KEY_BLOB}\n` },
  })
  const setups = at.setups()
  setups.start({ target: 'deploy@vps.test' })
  const asking = await settled(setups, 'trust')
  expect(asking.hostKey).toEqual({ host: 'vps.test', type: 'ED25519', fingerprint: fingerprint(KEY_BLOB) })
  expect(at.files.has('/home/me/.ssh/known_hosts')).toBe(false)
  await setups.act('trust')
  expect(at.files.get('/home/me/.ssh/known_hosts')).toBe(`vps.test ssh-ed25519 ${KEY_BLOB}\n`)
  await settled(setups, 'done')
})

it('stops on keys the server turns down, and Try again picks up from there', async () => {
  const at = server({
    ...goesThrough,
    probe: [{ code: 255, stderr: 'deploy@vps.test: Permission denied (publickey).' }, { stdout: looked() }],
  })
  const setups = at.setups()
  setups.start({ target: 'deploy@vps.test' })
  const failed = await settled(setups, 'failed')
  expect(failed).toMatchObject({ problem: 'AuthFailed', at: 0 })
  expect(failed.log).toContain('deploy@vps.test: Permission denied (publickey).')
  await setups.act('resume')
  await settled(setups, 'done')
})

it('makes the home a user of its own as root, with the key that logged in, and reaches it as althar from then on', async () => {
  const at = server({
    ...goesThrough,
    probe: [
      {
        stdout: looked({ root: true, login: 'root' }),
        stderr: `debug1: Server accepts key: me@laptop ED25519 ${fingerprint(LOGIN_BLOB)} agent`,
      },
      { stdout: looked() },
    ],
    resolve: { stdout: 'hostname vps.test\nidentityfile ~/.ssh/id_ed25519\n' },
    'ssh-add': { stdout: `ssh-rsa ${KEY_BLOB} other\nssh-ed25519 ${LOGIN_BLOB} me@laptop\n` },
    'root-login': {
      stdout: [looked({ root: true }), event('setup', 'started'), event('setup', 'done', { login: 'althar', linger: true })].join('\n'),
    },
  })
  const setups = at.setups()
  setups.start({ target: 'root@vps.test' })
  const done = await settled(setups, 'done')
  expect(done).toMatchObject({ madeUser: true, target: { target: 'althar@vps.test' } })
  expect(at.asked.find((one) => one.operation === 'root-login')!.args.at(-1)).toBe(`sh -s -- 'root-login' 'ssh-ed25519 ${LOGIN_BLOB}'`)
  expect(at.asked.find((one) => one.operation === 'install')!.args).toContain('althar@vps.test')
})

it('sends althar-host from this computer where the server can’t download it', async () => {
  const at = server({
    ...goesThrough,
    install: [
      {
        code: 1,
        stdout: [looked(), event('get', 'started', { bytes: 0, totalBytes: 1 }), event('get', 'failed', { code: 'CannotDownload' })].join(
          '\n',
        ),
      },
      { stdout: [looked(), event('get', 'done'), event('setup', 'started', { detached: true })].join('\n') },
    ],
    status: [
      { code: 1, stdout: event('setup', 'failed', { code: 'SetupNotFound' }) },
      { code: 1, stdout: event('setup', 'failed', { code: 'SetupNotFound' }) },
      { stdout: hostStatus('done', finished) },
    ],
    'prepare-upload': {
      stdout: [looked(), event('get', 'started', { uploadId: 'Ab12Cd34', uploadPath: '/home/deploy/up/archive.partial' })].join('\n'),
    },
    sftp: { code: 0 },
  })
  const setups = at.setups()
  setups.start({ target: 'deploy@vps.test' })
  expect(await settled(setups, 'failed')).toMatchObject({ problem: 'CannotDownload', at: 2 })
  await setups.act('upload')
  const done = await settled(setups, 'done')
  expect(done.upload).toBe(true)
  const sftp = at.asked.find((one) => one.program === 'sftp')!
  expect(sftp.args).toEqual(expect.arrayContaining(['-b', '-', '-oStrictHostKeyChecking=yes', 'deploy@vps.test']))
  expect(
    at.asked
      .filter((one) => one.operation === 'install')
      .at(-1)!
      .args.at(-1),
  ).toContain(`'install' 'upload' '${release.sha256}'`)
})

it('reconnects when the connection drops while it follows the setup, which goes on there', async () => {
  const at = server({
    ...goesThrough,
    status: [
      { code: 1, stdout: event('setup', 'failed', { code: 'SetupNotFound' }) },
      { code: 255, stderr: 'Connection to vps.test closed by remote host.' },
      { stdout: hostStatus('running', finished.slice(0, 2)) },
      { stdout: hostStatus('done', finished) },
    ],
  })
  const setups = at.setups()
  setups.start({ target: 'deploy@vps.test' })
  await settled(setups, 'done')
  expect(at.told.some((one) => one?.phase === 'reconnecting')).toBe(true)
})

it('stops where a server can’t keep a home, with nothing to try again', async () => {
  const at = server({
    probe: {
      code: 1,
      stdout: [event('reach', 'done'), event('look', 'started'), event('look', 'failed', { code: 'NoSystemd' })].join('\n'),
    },
  })
  const setups = at.setups()
  setups.start({ target: 'deploy@box.test' })
  expect(await settled(setups, 'failed')).toMatchObject({ problem: 'NoSystemd', at: 1 })
  await setups.act('resume')
  expect((await setups.state())?.phase).toBe('failed')
})

it('opens on a setup Althar quit partway through, and resumes it from what the server has', async () => {
  // The server finishes once it's resumed there.
  let resumed = false
  const at = server({
    ...goesThrough,
    status: () => ({ stdout: resumed ? hostStatus('done', finished) : hostStatus('interrupted', finished.slice(0, 2)) }),
    resume: () => {
      resumed = true
      return { stdout: '' }
    },
  })
  at.files.set('/profile/home-setup.json', JSON.stringify({ target: { target: 'deploy@vps.test' }, at: 3, madeUser: false, upload: false }))
  const setups = at.setups()
  expect(await setups.state()).toMatchObject({ phase: 'stopped', at: 3 })
  await setups.act('resume')
  await settled(setups, 'done')
  expect(resumed).toBe(true)
  expect(at.asked.some((one) => one.operation === 'install')).toBe(false)
})

it('stops at once, keeping what it did, and a stopped setup resumes', async () => {
  // The server takes its time to answer, until it's stopped.
  const slow = (_args: ReadonlyArray<string>, options: RunOptions) =>
    new Promise<Partial<Ran>>((resolve) => options.signal.addEventListener('abort', () => resolve({ code: 255 }), { once: true }))
  const at = server({ ...goesThrough, probe: [slow, { stdout: looked() }] })
  const setups = at.setups()
  setups.start({ target: 'deploy@vps.test' })
  await setups.act('stop')
  expect(at.told.at(-1)?.phase).toBe('stopped')
  await setups.act('resume')
  await settled(setups, 'done')
})

it('refuses a target that isn’t an SSH host', () => {
  const at = server({})
  expect(() => at.setups().start({ target: 'host; rm -rf ~' })).toThrow()
})

const signed = (manifest: Record<string, unknown>) => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const payload = Buffer.from(JSON.stringify(manifest))
  const keyId = createHash('sha256')
    .update(publicKey.export({ type: 'spki', format: 'der' }))
    .digest('hex')
  const envelope = Buffer.from(
    JSON.stringify({
      format: 1,
      keyId,
      payload: payload.toString('base64url'),
      signature: sign(null, payload, privateKey).toString('base64url'),
    }),
  )
  return { pem, envelope }
}
const manifest = {
  format: 1,
  version: '0.14.2',
  sequence: 3,
  publishedAt: '2026-11-01T00:00:00.000Z',
  expiresAt: '2027-05-01T00:00:00.000Z',
  platform: 'linux',
  arch: 'x64',
  archive: { url: 'https://example.test/a.tar.gz', sha256: 'b'.repeat(64), bytes: 40_000_000 },
  unpackedBytes: 120_000_000,
}
const now = Date.parse('2026-11-20T00:00:00.000Z')

it('authenticates a release only under a pinned key, for the server’s architecture, while it’s fresh', () => {
  const { pem, envelope } = signed(manifest)
  expect(authenticateRelease(envelope, [pem], 'x64', now)).toMatchObject({ version: '0.14.2', sha256: 'b'.repeat(64), bytes: 40_000_000 })
  const other = signed(manifest)
  expect(() => authenticateRelease(envelope, [other.pem], 'x64', now)).toThrow(/failed its check/)
  expect(() => authenticateRelease(envelope, [pem], 'arm64', now)).toThrow(/failed its check/)
  expect(() => authenticateRelease(envelope, [pem], 'x64', Date.parse('2027-06-01T00:00:00.000Z'))).toThrow(/failed its check/)
  const tampered = Buffer.from(
    envelope
      .toString()
      .replace(/"payload":"[^"]+"/, `"payload":"${Buffer.from(JSON.stringify({ ...manifest, version: '9.9.9' })).toString('base64url')}"`),
  )
  expect(() => authenticateRelease(tampered, [pem], 'x64', now)).toThrow(/failed its check/)
  const plain = signed({ ...manifest, archive: { ...manifest.archive, url: 'http://example.test/a.tar.gz' } })
  expect(() => authenticateRelease(plain.envelope, [plain.pem], 'x64', now)).toThrow(/failed its check/)
})

it('finds the newest host release on GitHub, and says there’s none where no key is pinned or none is published', async () => {
  const { pem, envelope } = signed(manifest)
  const fetcher = vi.fn(async (url: string) =>
    url.includes('api.github.com')
      ? Response.json([
          {
            tag_name: 'v0.9.0',
            draft: false,
            prerelease: false,
            assets: [{ name: 'althar-host-linux-x64.json', browser_download_url: 'https://x.test/desktop' }],
          },
          {
            tag_name: 'host-v0.14.3',
            draft: true,
            prerelease: false,
            assets: [{ name: 'althar-host-linux-x64.json', browser_download_url: 'https://x.test/draft' }],
          },
          {
            tag_name: 'host-v0.14.2',
            draft: false,
            prerelease: false,
            assets: [{ name: 'althar-host-linux-x64.json', browser_download_url: 'https://x.test/ok' }],
          },
        ])
      : new Response(url === 'https://x.test/ok' ? envelope : 'no'),
  )
  const signal = new AbortController().signal
  expect(await findRelease('x64', { keys: [pem], fetch: fetcher, now: () => now }, signal)).toMatchObject({ version: '0.14.2' })
  expect(fetcher).toHaveBeenLastCalledWith('https://x.test/ok', expect.anything())
  await expect(findRelease('x64', { keys: [], fetch: fetcher }, signal)).rejects.toMatchObject({ code: 'NoRelease' })
  await expect(findRelease('arm64', { keys: [pem], fetch: fetcher }, signal)).rejects.toMatchObject({ code: 'NoRelease' })
})
