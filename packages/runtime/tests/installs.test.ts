import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { agents } from '@althar/provider-adapters'
import { assert, describe, expect, it } from '@effect/vitest'
import { Effect, Exit } from 'effect'

import { Installs, type InstallsOptions } from '../src/Installs'

/*
 * Downloading an agent for a person who has none: its latest release's file
 * for this computer, kept only when it is exactly what the release says,
 * and run from Althar's folder only where the person has no copy of their own.
 */

const opencode = agents.opencode
const ASSET = 'opencode-linux-x64.tar.gz'

/** A release archive with an `opencode` in it that says its version. */
const archive = (version = '9.9.9') => {
  const dir = mkdtempSync(join(tmpdir(), 'althar-release-'))
  const bin = join(dir, 'opencode')
  writeFileSync(bin, `#!/bin/sh\necho ${version}\n`)
  chmodSync(bin, 0o755)
  const file = join(dir, ASSET)
  execFileSync('tar', ['-czf', file, '-C', dir, 'opencode'])
  return readFileSync(file)
}

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

/** GitHub as far as a download asks it: the latest release, and its file. */
const github = (bytes: Buffer, { digest = `sha256:${sha(bytes)}` as string | null, tag = 'v1.18.35', asset = ASSET } = {}) => {
  const asked: Array<string> = []
  const fetch = async (url: string) => {
    asked.push(url)
    if (url.endsWith('/releases/latest'))
      return Response.json({
        tag_name: tag,
        assets: [{ name: asset, browser_download_url: 'https://github.example/download', ...(digest === null ? {} : { digest }) }],
      })
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
  it('keeps its latest release, checked, and runs it where the person has none', async () => {
    const { fetch, asked } = github(archive())
    const { root, run } = using({ fetch })
    const before = await run(Effect.flatMap(Installs, (installs) => installs.state(opencode)))
    assert.isTrue(Exit.isSuccess(before) && before.value.located === null && before.value.downloadable && before.value.size === '45 MB')
    const done = await run(Effect.flatMap(Installs, (installs) => installs.install(opencode)))
    assert.isTrue(Exit.isSuccess(done))
    assert.strictEqual(asked[0], 'https://api.github.com/repos/anomalyco/opencode/releases/latest')
    assert.strictEqual(readlinkSync(join(root, 'opencode', 'current')), 'v1.18.35')
    assert.strictEqual(execFileSync(join(root, 'opencode', 'current', 'opencode'), { encoding: 'utf8' }).trim(), '9.9.9')
    const after = await run(Effect.map(Installs, (installs) => installs.locate(opencode)))
    assert.deepStrictEqual(Exit.isSuccess(after) ? after.value : null, {
      command: join(root, 'opencode', 'current', 'opencode'),
      whose: 'althar',
    })
  })

  it('replaces the version before, leaving nothing of the download behind', async () => {
    const first = github(archive('1.0.0'), { tag: 'v1.0.0' })
    const { root, run } = using({ fetch: first.fetch })
    await run(Effect.flatMap(Installs, (installs) => installs.install(opencode)))
    const second = github(archive('2.0.0'), { tag: 'v2.0.0' })
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
    assert.deepStrictEqual(
      execFileSync('ls', ['-A', join(root, 'opencode')], { encoding: 'utf8' })
        .trim()
        .split('\n')
        .toSorted(),
      ['current', 'v2.0.0'],
    )
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
    // An agent without a command of its own to find is never downloaded, nor looked for.
    const bundled = await none.run(Effect.flatMap(Installs, (installs) => installs.state(agents.codex)))
    assert.isTrue(Exit.isSuccess(bundled) && !bundled.value.downloadable && bundled.value.located === null)
  })

  it('runs the person’s own copy over Althar’s: on their PATH, or where an installer put it', async () => {
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

  it('says what stopped it at each step, and lets only one download of an agent run at a time', async () => {
    const said = async (fetch: (url: string) => Promise<Response>, options: Partial<InstallsOptions> = {}) =>
      JSON.stringify(await using({ fetch, ...options }).run(Effect.flatMap(Installs, (installs) => installs.install(opencode))))
    const bytes = archive()
    const good = github(bytes).fetch
    expect(await said(async () => Promise.reject(new Error('offline')))).toContain("GitHub couldn't be reached")
    expect(await said(async () => new Response('', { status: 403 }))).toContain("GitHub didn't say where")
    expect(await said(async () => new Response('not json'))).toContain("couldn't be read")
    expect(await said(async () => Response.json({ tag_name: '../../x', assets: [] }))).toContain('has no download for this computer')
    expect(await said(async (url) => (url.endsWith('/latest') ? good(url) : new Response('', { status: 404 })))).toContain(
      "OpenCode couldn't be downloaded",
    )
    expect(await said(async (url) => (url.endsWith('/latest') ? good(url) : Promise.reject(new Error('reset'))))).toContain(
      "OpenCode couldn't be downloaded",
    )
    // An archive without the command, and one whose command won't run here.
    const empty = mkdtempSync(join(tmpdir(), 'althar-empty-'))
    writeFileSync(join(empty, 'README'), 'nothing')
    execFileSync('tar', ['-czf', join(empty, ASSET), '-C', empty, 'README'])
    expect(await said(github(readFileSync(join(empty, ASSET))).fetch)).toContain('has no opencode in it')
    // A link in the archive is never followed: what it points at was never checked.
    const linked = mkdtempSync(join(tmpdir(), 'althar-linked-'))
    writeFileSync(join(linked, 'payload'), '#!/bin/sh\necho outside\n')
    chmodSync(join(linked, 'payload'), 0o755)
    symlinkSync(join(linked, 'payload'), join(linked, 'opencode'))
    execFileSync('tar', ['-czf', join(linked, ASSET), '-C', linked, 'opencode'])
    expect(await said(github(readFileSync(join(linked, ASSET))).fetch)).toContain('has no opencode in it')
    const broken = mkdtempSync(join(tmpdir(), 'althar-broken-'))
    writeFileSync(join(broken, 'opencode'), '#!/bin/sh\nexit 3\n')
    chmodSync(join(broken, 'opencode'), 0o755)
    execFileSync('tar', ['-czf', join(broken, ASSET), '-C', broken, 'opencode'])
    expect(await said(github(readFileSync(join(broken, ASSET))).fetch)).toContain("wouldn't run on this computer")
    expect(await said(github(Buffer.from('not an archive')).fetch)).toContain("couldn't be unpacked")
    // A second download while the first runs is refused; the first finishes.
    let release: () => void = () => {}
    const slow = async (url: string) => {
      if (!url.endsWith('/latest')) await new Promise<void>((resolve) => (release = resolve))
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
      Exit.isSuccess(shipped) && shipped.value?.whose === 'bundled' && shipped.value.command.endsWith('/claude'),
      JSON.stringify(shipped),
    )
    const state = await run(Effect.flatMap(Installs, (installs) => installs.state(agents['claude-code'])))
    assert.isTrue(Exit.isSuccess(state) && !state.value.downloadable)
    const theirs = mkdtempSync(join(tmpdir(), 'althar-claude-'))
    writeFileSync(join(theirs, 'claude'), '#!/bin/sh\necho mine\n')
    chmodSync(join(theirs, 'claude'), 0o755)
    const own = using({ platform: process.platform, arch: process.arch, search: { env: { PATH: theirs }, dirs: [] } })
    const found = await own.run(Effect.map(Installs, (installs) => installs.locate(agents['claude-code'])))
    assert.deepStrictEqual(Exit.isSuccess(found) ? found.value : null, { command: 'claude', whose: 'theirs' })
  })

  it('takes the release’s musl build on a musl Linux, as Alpine is', async () => {
    const bytes = archive()
    const { fetch, asked } = github(bytes, { asset: 'opencode-linux-x64-musl.tar.gz' })
    const { run } = using({ fetch, musl: true })
    const done = await run(Effect.flatMap(Installs, (installs) => installs.install(opencode)))
    assert.isTrue(Exit.isSuccess(done))
    assert.lengthOf(asked, 2)
  })
})
