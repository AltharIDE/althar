import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type AgentDefinition, agents, type LaunchSpec, usingLocated } from '@althar/provider-adapters'
import { assert, describe, expect, it } from '@effect/vitest'
import { Effect, Exit } from 'effect'
import { zipSync } from 'fflate'

import { Installs, type InstallsOptions } from '../src/Installs'

/** Windows, where what some tests stand on isn't (each says what). */
const windows = process.platform === 'win32'

/*
 * Downloading an agent for a person who has none: its latest release's file
 * for this computer, kept only when it is exactly what the release says,
 * and run from Althar's folder only where the person has no copy of their own.
 */

const opencode = agents.opencode
const ASSET = 'opencode-linux-x64.tar.gz'

/** Packs files in a folder as a release's gzipped tar, there: by relative names, which GNU tar on Windows would read a drive (C:) in as a host. */
const pack = (dir: string, ...names: ReadonlyArray<string>) => {
  execFileSync('tar', ['-czf', ASSET, ...names], { cwd: dir })
  return join(dir, ASSET)
}

/** A release archive with an `opencode` in it that says its version. */
const archive = (version = '1.18.35') => {
  const dir = mkdtempSync(join(tmpdir(), 'althar-release-'))
  const bin = join(dir, 'opencode')
  writeFileSync(bin, `#!/bin/sh\necho ${version}\n`)
  chmodSync(bin, 0o755)
  return readFileSync(pack(dir, 'opencode'))
}

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

/** What GitHub's API is asked, as against a release's file. */
const api = (url: string) => url.startsWith('https://api.github.com/')

/**
 * GitHub as far as a download asks it: the latest release, or the list of
 * them, newest first, and its file. Another major's releases, a prerelease and
 * a draft of this one come before it in the list, as they would once there are.
 */
const github = (bytes: Buffer, { digest = `sha256:${sha(bytes)}` as string | null, tag = 'v1.18.35', asset = ASSET } = {}) => {
  const asked: Array<string> = []
  const release = {
    tag_name: tag,
    assets: [{ name: asset, browser_download_url: 'https://github.example/download', ...(digest === null ? {} : { digest }) }],
  }
  const elsewhere = { name: asset, browser_download_url: 'https://github.example/other', digest: `sha256:${'1'.repeat(64)}` }
  const fetch = async (url: string) => {
    asked.push(url)
    if (url.endsWith('/releases/latest')) return Response.json(release)
    if (api(url))
      return Response.json([
        { tag_name: 'v2.0.29', assets: [elsewhere] },
        { tag_name: 'v1.20.0-beta.1', prerelease: true, assets: [elsewhere] },
        { tag_name: 'v1.20.0', draft: true, assets: [elsewhere] },
        release,
        { tag_name: 'v1.0.0', assets: [elsewhere] },
      ])
    return new Response(new Uint8Array(bytes))
  }
  return { fetch, asked }
}

const using = (options: Partial<InstallsOptions>) => {
  const root = mkdtempSync(join(tmpdir(), 'althar-agents-'))
  const layer = Installs.layer({ root, platform: 'linux', arch: 'x64', musl: false, search: { env: { PATH: '' }, dirs: [] }, ...options })
  return { root, run: <A, E>(effect: Effect.Effect<A, E, Installs>) => Effect.runPromiseExit(Effect.provide(effect, layer)) }
}

describe('downloading an agent', () => {
  // Not on Windows: the release it downloads is a shell script, which Althar runs (--version) to check it.
  it.skipIf(windows)('keeps its latest release, checked, and runs it where the person has none', async () => {
    const { fetch, asked } = github(archive())
    const { root, run } = using({ fetch })
    const before = await run(Effect.flatMap(Installs, (installs) => installs.state(opencode)))
    assert.isTrue(
      Exit.isSuccess(before) &&
        before.value.located === null &&
        before.value.downloadable &&
        before.value.size === '45 MB' &&
        before.value.pinned === null,
    )
    const done = await run(Effect.flatMap(Installs, (installs) => installs.install(opencode)))
    assert.isTrue(Exit.isSuccess(done))
    assert.deepStrictEqual(asked, [
      'https://api.github.com/repos/anomalyco/opencode/releases?per_page=100',
      'https://github.example/download',
    ])
    assert.strictEqual(readlinkSync(join(root, 'opencode', 'current')), 'v1.18.35')
    assert.strictEqual(execFileSync(join(root, 'opencode', 'current', 'opencode'), { encoding: 'utf8' }).trim(), '1.18.35')
    const after = await run(Effect.map(Installs, (installs) => installs.locate(opencode)))
    assert.deepStrictEqual(Exit.isSuccess(after) ? after.value : null, {
      command: join(root, 'opencode', 'current', 'opencode'),
      whose: 'althar',
    })
  })

  // Not on Windows: the release it downloads is a shell script, which Althar runs (--version) to check it.
  it.skipIf(windows)('replaces the version before, leaving nothing of the download behind', async () => {
    const first = github(archive('1.18.35'), { tag: 'v1.18.35' })
    const { root, run } = using({ fetch: first.fetch })
    await run(Effect.flatMap(Installs, (installs) => installs.install(opencode)))
    const second = github(archive('1.19.0'), { tag: 'v1.19.0' })
    const again = Installs.layer({
      root,
      platform: 'linux',
      arch: 'x64',
      musl: false,
      fetch: second.fetch,
      search: { env: { PATH: '' }, dirs: [] },
    })
    await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(Installs, (installs) => installs.install(opencode)),
        again,
      ),
    )
    assert.deepStrictEqual(readdirSync(join(root, 'opencode')).toSorted(), ['current', 'v1.19.0'])
  })

  it('keeps nothing that isn’t exactly the release’s file, or that its release gives no digest for', async () => {
    const wrong = using({ fetch: github(archive(), { digest: `sha256:${'0'.repeat(64)}` }).fetch })
    const refused = await wrong.run(Effect.flatMap(Installs, (installs) => installs.install(opencode)))
    assert.isTrue(Exit.isFailure(refused))
    assert.include(JSON.stringify(refused), 'didn’t match its release'.replace('’', "'"))
    assert.isFalse(existsSync(join(wrong.root, 'opencode', 'current')))
    const unchecked = using({ fetch: github(archive(), { digest: null }).fetch })
    const unsure = await unchecked.run(Effect.flatMap(Installs, (installs) => installs.install(opencode)))
    assert.include(JSON.stringify(unsure), "can't be checked")
  })

  it('says so where there is nothing for this computer, or nowhere to keep it', async () => {
    const none = using({ fetch: github(archive()).fetch, platform: 'freebsd' })
    const state = await none.run(Effect.flatMap(Installs, (installs) => installs.state(opencode)))
    assert.isTrue(Exit.isSuccess(state) && !state.value.downloadable)
    const failed = await none.run(Effect.flatMap(Installs, (installs) => installs.install(opencode)))
    assert.include(JSON.stringify(failed), 'no OpenCode for this computer')
    const nowhere = Installs.layer({ fetch: github(archive()).fetch })
    const cant = await Effect.runPromiseExit(
      Effect.provide(
        Effect.flatMap(Installs, (installs) => installs.install(opencode)),
        nowhere,
      ),
    )
    assert.include(JSON.stringify(cant), "can't download OpenCode")
    // Codex has a bundled CLI for sign-in, but it is not downloadable as an agent.
    const bundled = await none.run(Effect.flatMap(Installs, (installs) => installs.state(agents.codex)))
    assert.isTrue(Exit.isSuccess(bundled) && !bundled.value.downloadable)
  })

  // Not on Windows: the release it downloads is a shell script, which Althar runs (--version) to check it.
  it.skipIf(windows)('runs the person’s own copy over Althar’s: on their PATH, or where an installer put it', async () => {
    const { fetch } = github(archive())
    const theirs = mkdtempSync(join(tmpdir(), 'althar-theirs-'))
    mkdirSync(join(theirs, 'bin'))
    writeFileSync(join(theirs, 'bin', 'opencode'), '#!/bin/sh\necho mine\n')
    chmodSync(join(theirs, 'bin', 'opencode'), 0o755)
    const onPath = using({ fetch, search: { env: { PATH: join(theirs, 'bin') }, dirs: [] } })
    await onPath.run(Effect.flatMap(Installs, (installs) => installs.install(opencode)))
    const found = await onPath.run(Effect.map(Installs, (installs) => installs.locate(opencode)))
    assert.deepStrictEqual(Exit.isSuccess(found) ? found.value : null, { command: 'opencode', whose: 'theirs' })
    const usual = using({ fetch, search: { env: { PATH: '' }, dirs: [join(theirs, 'bin')] } })
    const there = await usual.run(Effect.map(Installs, (installs) => installs.locate(opencode)))
    assert.deepStrictEqual(Exit.isSuccess(there) ? there.value : null, { command: join(theirs, 'bin', 'opencode'), whose: 'theirs' })
  })

  it('in a sandbox that cannot see the device, finds and runs the person’s own command out there', async () => {
    const ran: Array<string> = []
    const onDevice = {
      reachable: true,
      where: (name: string) => (name === 'opencode' ? '/device/bin/opencode' : null),
      run: (spec: LaunchSpec, at: { readonly env: Readonly<Record<string, string>> }) => {
        ran.push(spec.command)
        return { command: 'flatpak-spawn', args: ['--host', spec.command, ...spec.args], env: at.env }
      },
    }
    const { run } = using({ onDevice, platform: process.platform, arch: process.arch })
    const found = await run(Effect.map(Installs, (installs) => installs.locate(opencode)))
    const located = Exit.isSuccess(found) ? found.value : null
    assert.strictEqual(located?.command, '/device/bin/opencode')
    assert.strictEqual(located?.whose, 'theirs')
    const launched = usingLocated(opencode, () => located)
      .launch('node')
      .onDevice?.({ env: {} })
    assert.strictEqual(launched?.command, 'flatpak-spawn')
    assert.deepStrictEqual(launched?.args, ['--host', '/device/bin/opencode', 'acp'])
    assert.deepStrictEqual(ran, ['/device/bin/opencode'])
    // A copy that is here still stands where the device cannot be reached...
    const unreachable = { ...onDevice, reachable: false, where: () => null }
    const shipped = await using({ onDevice: unreachable, platform: process.platform, arch: process.arch }).run(
      Effect.map(Installs, (installs) => installs.locate(agents['claude-code'])),
    )
    assert.isTrue(Exit.isSuccess(shipped) && shipped.value?.whose === 'bundled' && shipped.value.out === undefined)
    // ...and where there is none here either, the run goes out there anyway, so its failure says what to put right.
    const theirs = await using({ onDevice: unreachable }).run(Effect.map(Installs, (installs) => installs.locate(opencode)))
    assert.isTrue(Exit.isSuccess(theirs) && theirs.value?.command === 'opencode' && typeof theirs.value.out === 'function')
  })

  // Not on Windows: the release it downloads is a shell script, which Althar runs (--version) to check it.
  it.skipIf(windows)('keeps a copy downloaded at the person’s asking in the sandbox, even where the device has its own', async () => {
    const { fetch } = github(archive())
    const onDevice = {
      reachable: true,
      where: () => '/device/bin/opencode',
      run: () => ({ command: 'flatpak-spawn', args: [] }),
    }
    const { root, run } = using({ fetch, onDevice })
    await run(Effect.flatMap(Installs, (installs) => installs.install(opencode)))
    const found = await run(Effect.map(Installs, (installs) => installs.locate(opencode)))
    assert.deepStrictEqual(Exit.isSuccess(found) ? found.value : null, {
      command: join(root, 'opencode', 'current', 'opencode'),
      whose: 'althar',
    })
  })

  // Not on Windows: the release it downloads is a shell script, which Althar runs (--version) to check it.
  it.skipIf(windows)('says what stopped it at each step, and lets only one download of an agent run at a time', async () => {
    const said = async (fetch: (url: string) => Promise<Response>, options: Partial<InstallsOptions> = {}) =>
      JSON.stringify(await using({ fetch, ...options }).run(Effect.flatMap(Installs, (installs) => installs.install(opencode))))
    const bytes = archive()
    const good = github(bytes).fetch
    expect(await said(async () => Promise.reject(new Error('offline')))).toContain("GitHub couldn't be reached")
    expect(await said(async () => new Response('', { status: 403 }))).toContain("GitHub didn't say where")
    expect(await said(async () => new Response('not json'))).toContain("couldn't be read")
    expect(await said(async () => Response.json([{ tag_name: 'v1.0.0/../../x', assets: [] }]))).toContain(
      'has no download for this computer',
    )
    expect(await said(async () => Response.json({ tag_name: 'v1.19.0', assets: [] }))).toContain('has no release of OpenCode 1')
    expect(await said(async (url) => (api(url) ? good(url) : new Response('', { status: 404 })))).toContain(
      "OpenCode couldn't be downloaded",
    )
    expect(await said(async (url) => (api(url) ? good(url) : Promise.reject(new Error('reset'))))).toContain(
      "OpenCode couldn't be downloaded",
    )
    // An archive without the command, and one whose command won't run here.
    const empty = mkdtempSync(join(tmpdir(), 'althar-empty-'))
    writeFileSync(join(empty, 'README'), 'nothing')
    pack(empty, 'README')
    expect(await said(github(readFileSync(join(empty, ASSET))).fetch)).toContain('has no opencode in it')
    // A link in the archive is never followed: what it points at was never checked.
    const linked = mkdtempSync(join(tmpdir(), 'althar-linked-'))
    writeFileSync(join(linked, 'payload'), '#!/bin/sh\necho outside\n')
    chmodSync(join(linked, 'payload'), 0o755)
    symlinkSync(join(linked, 'payload'), join(linked, 'opencode'))
    pack(linked, 'opencode')
    expect(await said(github(readFileSync(join(linked, ASSET))).fetch)).toContain('has no opencode in it')
    const broken = mkdtempSync(join(tmpdir(), 'althar-broken-'))
    writeFileSync(join(broken, 'opencode'), '#!/bin/sh\nexit 3\n')
    chmodSync(join(broken, 'opencode'), 0o755)
    pack(broken, 'opencode')
    expect(await said(github(readFileSync(join(broken, ASSET))).fetch)).toContain("wouldn't run on this computer")
    expect(await said(github(Buffer.from('not an archive')).fetch)).toContain("couldn't be unpacked")
    // A second download while the first runs is refused; the first finishes.
    let release: () => void = () => {}
    const slow = async (url: string) => {
      if (!api(url)) await new Promise<void>((resolve) => (release = resolve))
      return good(url)
    }
    const once = using({ fetch: slow })
    const both = await once.run(
      Effect.flatMap(Installs, (installs) =>
        Effect.all(
          [
            installs.install(opencode),
            Effect.gen(function* () {
              yield* Effect.sleep('50 millis')
              const during = yield* installs.state(opencode)
              const second = yield* Effect.exit(installs.install(opencode))
              release()
              return { during: during.installing, second: JSON.stringify(second) }
            }),
          ],
          { concurrency: 'unbounded' },
        ),
      ),
    )
    expect(Exit.isSuccess(both) && both.value[1].during).toBe(true)
    expect(Exit.isSuccess(both) ? both.value[1].second : '').toContain('already downloading')
  })

  it('runs Claude Code from the copy that ships with Althar where the person has none, and theirs where they do', async () => {
    // The SDK ships the build for the computer the tests run on.
    const { run } = using({ platform: process.platform, arch: process.arch })
    const shipped = await run(Effect.map(Installs, (installs) => installs.locate(agents['claude-code'])))
    assert.isTrue(
      Exit.isSuccess(shipped) && shipped.value?.whose === 'bundled' && /[/\\]claude(\.exe)?$/.test(shipped.value.command),
      JSON.stringify(shipped),
    )
    const state = await run(Effect.flatMap(Installs, (installs) => installs.state(agents['claude-code'])))
    assert.isTrue(Exit.isSuccess(state) && !state.value.downloadable)
    const theirs = mkdtempSync(join(tmpdir(), 'althar-claude-'))
    // A program, as Windows names one.
    const mine = join(theirs, process.platform === 'win32' ? 'claude.exe' : 'claude')
    writeFileSync(mine, '#!/bin/sh\necho mine\n')
    chmodSync(mine, 0o755)
    const own = using({ platform: process.platform, arch: process.arch, search: { env: { PATH: theirs }, dirs: [] } })
    const found = await own.run(Effect.map(Installs, (installs) => installs.locate(agents['claude-code'])))
    // Named bare, as the shell finds it; on Windows by the path it was found at, as a launch there needs.
    assert.deepStrictEqual(Exit.isSuccess(found) ? found.value : null, {
      command: process.platform === 'win32' ? mine : 'claude',
      whose: 'theirs',
    })
  })

  // Not on Windows: the release it downloads is a shell script, which Althar runs (--version) to check it.
  it.skipIf(windows)('takes the release’s musl build on a musl Linux, as Alpine is', async () => {
    const bytes = archive()
    const { fetch, asked } = github(bytes, { asset: 'opencode-linux-x64-musl.tar.gz' })
    const { run } = using({ fetch, musl: true })
    const done = await run(Effect.flatMap(Installs, (installs) => installs.install(opencode)))
    assert.isTrue(Exit.isSuccess(done))
    assert.lengthOf(asked, 2)
  })

  it('takes only releases of the major Althar runs the agent at, and keeps no copy that says it is another', async () => {
    // Where GitHub's newest releases are OpenCode 2, the newest 1.x one is downloaded.
    const { fetch, asked } = github(archive('1.19.0'), { tag: 'v1.19.0' })
    const { root, run } = using({ fetch })
    assert.isTrue(Exit.isSuccess(await run(Effect.flatMap(Installs, (installs) => installs.install(opencode)))))
    assert.strictEqual(asked[1], 'https://github.example/download')
    assert.strictEqual(readlinkSync(join(root, 'opencode', 'current')), 'v1.19.0')
    // A file tagged 1.x that says it is 2.x when it runs isn't kept.
    const mislabelled = using({ fetch: github(archive('opencode v2.0.29'), { tag: 'v1.19.0' }).fetch })
    const refused = await mislabelled.run(Effect.flatMap(Installs, (installs) => installs.install(opencode)))
    assert.include(JSON.stringify(refused), 'OpenCode 2 isn’t supported yet')
    assert.isFalse(existsSync(join(mislabelled.root, 'opencode', 'current')))
    // Nor one whose version can't be told: it can't be told to be 1.x.
    const unsaid = using({ fetch: github(archive('opencode dev build'), { tag: 'v1.19.0' }).fetch })
    const untold = await unsaid.run(Effect.flatMap(Installs, (installs) => installs.install(opencode)))
    assert.include(JSON.stringify(untold), 'couldn’t tell which version of OpenCode this is')
    assert.isFalse(existsSync(join(unsaid.root, 'opencode', 'current')))
    // An agent run at any version still takes GitHub's latest release, whatever its major.
    const { supported: _, ...anyVersion } = opencode
    const latest = github(archive('2.0.29'), { tag: 'v2.0.29' })
    const unpinned = using({ fetch: latest.fetch })
    assert.isTrue(Exit.isSuccess(await unpinned.run(Effect.flatMap(Installs, (installs) => installs.install(anyVersion)))))
    assert.strictEqual(latest.asked[0], 'https://api.github.com/repos/anomalyco/opencode/releases/latest')
  })
})

/*
 * Antigravity's server: one version from Google's address, the zip and each
 * of its two programs pinned by sha256, kept together as they run together.
 */
describe('downloading a pinned agent', () => {
  const SERVER = '#!/bin/sh\necho server\n'
  const HARNESS = '#!/bin/sh\necho harness\n'
  const URL = 'https://dl.google.example/agy-acp-server-linux-x86_64.zip'
  const text = (words: string) => new TextEncoder().encode(words)
  const sum = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

  /** A zip of what it holds, and Antigravity with it pinned: its own sha256 and its files', unless told otherwise. */
  const pinnedTo = (held: Readonly<Record<string, string>>, pins: { zip?: string; files?: Readonly<Record<string, string>> } = {}) => {
    const zip = zipSync(Object.fromEntries(Object.entries(held).map(([name, body]) => [name, text(body)])))
    const download = agents.antigravity.cli?.download
    if (download === undefined || !('version' in download)) throw new Error('Antigravity has a pinned download')
    const agent: AgentDefinition = {
      ...agents.antigravity,
      cli: {
        name: 'agy_acp_server.par',
        download: {
          ...download,
          assets: {
            'linux-x64': {
              url: URL,
              sha256: pins.zip ?? sum(zip),
              files: pins.files ?? {
                'agy_acp_server.par': sum(text(SERVER)),
                localharness_external: sum(text(HARNESS)),
              },
            },
          },
        },
      },
    }
    const asked: Array<string> = []
    const fetch = async (url: string) => {
      asked.push(url)
      return new Response(new Uint8Array(zip))
    }
    return { agent, fetch, asked }
  }
  const whole = { 'agy_acp_server.par': SERVER, localharness_external: HARNESS }

  // Not on Windows: the pinned release's programs are shell scripts, which it runs.
  it.skipIf(windows)('keeps the version it is pinned at, whole and checked, from its maker’s address alone', async () => {
    const { agent, fetch, asked } = pinnedTo(whole)
    const { root, run } = using({ fetch })
    const before = await run(Effect.flatMap(Installs, (installs) => installs.state(agent)))
    assert.isTrue(Exit.isSuccess(before) && before.value.downloadable && before.value.pinned === '1.3.0')
    const done = await run(Effect.flatMap(Installs, (installs) => installs.install(agent)))
    assert.isTrue(Exit.isSuccess(done), JSON.stringify(done))
    assert.deepStrictEqual(asked, [URL])
    assert.strictEqual(readlinkSync(join(root, 'antigravity', 'current')), '1.3.0')
    // Both programs, side by side, as the server finds its harness beside itself.
    assert.strictEqual(execFileSync(join(root, 'antigravity', 'current', 'agy_acp_server.par'), { encoding: 'utf8' }).trim(), 'server')
    assert.strictEqual(execFileSync(join(root, 'antigravity', 'current', 'localharness_external'), { encoding: 'utf8' }).trim(), 'harness')
    assert.deepStrictEqual(readdirSync(join(root, 'antigravity')).toSorted(), ['1.3.0', 'current'])
    const after = await run(Effect.map(Installs, (installs) => installs.locate(agent)))
    assert.deepStrictEqual(Exit.isSuccess(after) ? after.value : null, {
      command: join(root, 'antigravity', 'current', 'agy_acp_server.par'),
      whose: 'althar',
    })
  })

  it('keeps nothing whose archive, or any file in it, isn’t what it was pinned with, or that holds more', async () => {
    const refused = async (held: Readonly<Record<string, string>>, pins: Parameters<typeof pinnedTo>[1], says: string) => {
      const { agent, fetch } = pinnedTo(held, pins)
      const { root, run } = using({ fetch })
      const exit = await run(Effect.flatMap(Installs, (installs) => installs.install(agent)))
      assert.isTrue(Exit.isFailure(exit), says)
      assert.include(JSON.stringify(exit), says)
      assert.isFalse(existsSync(join(root, 'antigravity', 'current')), says)
      assert.deepStrictEqual(existsSync(join(root, 'antigravity')) ? readdirSync(join(root, 'antigravity')) : [], [], says)
    }
    await refused(whole, { zip: '0'.repeat(64) }, "didn't match its release")
    await refused(
      whole,
      { files: { 'agy_acp_server.par': '0'.repeat(64), localharness_external: sum(text(HARNESS)) } },
      "didn't hold what it was pinned with",
    )
    await refused({ ...whole, 'extra.sh': 'echo planted' }, {}, "couldn't be unpacked")
    await refused({ ...whole, '../escaped': 'echo planted' }, {}, "couldn't be unpacked")
    await refused({ 'agy_acp_server.par': SERVER }, {}, "didn't hold what it was pinned with")
  })

  it('has nothing to download where its maker has no build, as for Windows', async () => {
    const { fetch } = pinnedTo(whole)
    const { run } = using({ fetch, platform: 'win32' })
    const state = await run(Effect.flatMap(Installs, (installs) => installs.state(agents.antigravity)))
    assert.isTrue(Exit.isSuccess(state) && !state.value.downloadable)
    const failed = await run(Effect.flatMap(Installs, (installs) => installs.install(agents.antigravity)))
    assert.include(JSON.stringify(failed), 'no Google Antigravity for this computer')
  })
})
