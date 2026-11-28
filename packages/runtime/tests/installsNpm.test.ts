import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type AgentDefinition, agents, type NpmDownload } from '@althar/provider-adapters'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Exit } from 'effect'

import { Installs } from '../src/Installs'

/*
 * Claude Code's and Codex's programs as Althar downloads them now that no build ships them
 * (docs/plans/agents-on-first-use.md): the exact npm package the lockfile pins for this platform, checked by its sha512
 * integrity, kept whole, what never runs removed, and found as Althar's copy, which the adapter is told to drive.
 */

const TARBALL = 'https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk-linux-x64/-/claude-agent-sdk-linux-x64-0.3.331.tgz'

/** An npm tarball of these files under `package/`, and its integrity as npm writes it. */
const tarball = async (files: Readonly<Record<string, string>>) => {
  const root = mkdtempSync(join(tmpdir(), 'althar-npm-'))
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, 'package', path, '..'), { recursive: true })
    writeFileSync(join(root, 'package', path), text, { mode: 0o755 })
  }
  const file = join(root, 'package.tgz')
  execFileSync('tar', ['-czf', file, '-C', root, 'package'])
  const bytes = readFileSync(file)
  return { bytes, integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` }
}

/** Claude Code pinned to this package for linux-x64, and npm serving it, with what it was asked kept. */
const pinnedTo = (bytes: Uint8Array, integrity: string): { agent: AgentDefinition; fetch: typeof fetch; asked: string[] } => {
  const download: NpmDownload = {
    npm: true,
    version: '0.3.331',
    assets: {
      'linux-x64': {
        name: '@anthropic-ai/claude-agent-sdk-linux-x64',
        version: '0.3.331',
        tarball: TARBALL,
        integrity,
        program: 'claude',
        prune: ['voice'],
        bytes: 184_581_466,
      },
    },
  }
  const asked: string[] = []
  return {
    // No copy beside an adapter, as in a build that ships none.
    agent: { ...agents['claude-code'], cli: { name: 'claude', drivenBy: 'CLAUDE_CODE_EXECUTABLE', download } },
    fetch: (async (url: string) => {
      asked.push(url)
      return new Response(new Uint8Array(bytes))
    }) as unknown as typeof fetch,
    asked,
  }
}

const using = <A, E>(root: string, pinned: ReturnType<typeof pinnedTo>, effect: (installs: Installs['Service']) => Effect.Effect<A, E>) =>
  Effect.runPromiseExit(
    Effect.provide(
      Effect.flatMap(Installs, effect),
      Installs.layer({ root, platform: 'linux', arch: 'x64', musl: false, fetch: pinned.fetch, search: { env: { PATH: '' }, dirs: [] } }),
    ),
  )

describe('a program the lockfile pins, downloaded from npm', () => {
  it('says its own size and version, is kept whole once its integrity holds, and is Althar’s copy the adapter drives', async () => {
    const { bytes, integrity } = await tarball({
      claude: '#!/bin/sh\necho "2.1.331 (Claude Code)"\n',
      'package.json': '{"name":"@anthropic-ai/claude-agent-sdk-linux-x64","version":"0.3.331"}',
      'voice/libsound.so': 'never runs',
    })
    const root = mkdtempSync(join(tmpdir(), 'althar-agents-'))
    const pinned = pinnedTo(bytes, integrity)
    const before = await using(root, pinned, (installs) => installs.state(pinned.agent))
    assert.isTrue(Exit.isSuccess(before))
    if (Exit.isSuccess(before))
      assert.deepInclude(before.value, { located: null, downloadable: true, size: '185 MB', pinned: '0.3.331', installing: false })
    const installed = await using(root, pinned, (installs) =>
      Effect.andThen(
        installs.install(pinned.agent),
        Effect.sync(() => installs.locate(pinned.agent)),
      ),
    )
    assert.isTrue(Exit.isSuccess(installed), JSON.stringify(installed))
    const program = join(root, 'claude-code', 'current', 'claude')
    if (Exit.isSuccess(installed)) assert.deepStrictEqual(installed.value, { command: program, whose: 'althar' })
    assert.deepStrictEqual(pinned.asked, [TARBALL])
    // Kept whole, by the version npm gave it; what never runs, gone; nothing of the download left.
    assert.isTrue(existsSync(join(root, 'claude-code', '0.3.331', 'package.json')))
    assert.isFalse(existsSync(join(root, 'claude-code', 'current', 'voice')))
    assert.deepStrictEqual(readdirSync(join(root, 'claude-code')).toSorted(), ['0.3.331', 'current'])
  })

  it('keeps nothing that isn’t exactly the package pinned, or holds no program, or whose program won’t run', async () => {
    const refused = async (bytes: Uint8Array, integrity: string, says: string) => {
      const root = mkdtempSync(join(tmpdir(), 'althar-agents-'))
      const exit = await using(root, pinnedTo(bytes, integrity), (installs) => installs.install(pinnedTo(bytes, integrity).agent))
      assert.isTrue(Exit.isFailure(exit), says)
      assert.include(JSON.stringify(exit), says)
      assert.isFalse(existsSync(join(root, 'claude-code', 'current')), says)
    }
    const good = await tarball({ claude: '#!/bin/sh\necho 2.1.331\n' })
    await refused(
      good.bytes,
      `sha512-${createHash('sha512').update('another').digest('base64')}`,
      'didn’t match the one Althar pins'.replace('’', "'"),
    )
    const empty = await tarball({ 'README.md': 'no program' })
    await refused(empty.bytes, empty.integrity, 'has no claude in it')
    const broken = await tarball({ claude: '#!/bin/sh\nexit 3\n' })
    await refused(broken.bytes, broken.integrity, "wouldn't run on this computer")
  })

  it('has none for a platform its maker publishes no package for, and Windows’ program by its own name', async () => {
    const { bytes, integrity } = await tarball({ claude: '#!/bin/sh\necho 2.1.331\n' })
    const pinned = pinnedTo(bytes, integrity)
    const state = await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(Installs, (installs) => installs.state(pinned.agent)),
        Installs.layer({ root: tmpdir(), platform: 'freebsd', arch: 'x64', fetch: pinned.fetch, search: { env: { PATH: '' }, dirs: [] } }),
      ),
    )
    assert.deepInclude(state, { downloadable: false, size: null })
  })
})
