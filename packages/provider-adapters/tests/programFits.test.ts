import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, normalize } from 'node:path'

import { afterEach, assert, describe, it } from '@effect/vitest'

import { claudeFits, codexFits, installedVersion, type Resolver } from '../src/bundledPrograms'
import { locate, usingLocated } from '../src/installs'
import { pinsFromLock, tarballOf } from '../src/pinnedLock'
import { PINNED_PROGRAMS } from '../src/pinnedPrograms'
import { agents } from '../src/registry'

/*
 * Claude Code and Codex come on first use (docs/plans/agents-on-first-use.md): the person's own install where its
 * adapter can drive it, read from where it is installed, else the exact package the lockfile pins, which Althar
 * downloads. Folders here are laid out as each installer leaves them.
 */

const folders: string[] = []
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})
const temp = () => {
  const folder = mkdtempSync(join(tmpdir(), 'althar-fits-'))
  folders.push(folder)
  return folder
}
/** A file, its folders made, executable. */
const file = (path: string, text = '#!/bin/sh\n') => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text, { mode: 0o755 })
  return path
}
const link = (target: string, path: string) => {
  mkdirSync(dirname(path), { recursive: true })
  symlinkSync(target, path)
  return path
}

describe('the version of an install of an agent, read from where it is', () => {
  it('reads Claude Code’s own installer’s folder of versions through its link, and Homebrew’s', () => {
    const home = temp()
    const native = file(join(home, '.local/share/claude/versions/2.1.340'))
    const claude = link(native, join(home, '.local/bin/claude'))
    assert.strictEqual(installedVersion(claude, ['@anthropic-ai/claude-code'], ['claude', 'claude-code']), '2.1.340')
    const cellar = file(join(home, 'Cellar/codex/0.172.3/bin/codex'))
    assert.strictEqual(installedVersion(link(cellar, join(home, 'bin/codex')), ['@openai/codex'], ['codex']), '0.172.3')
    const cask = file(join(home, 'Caskroom/claude-code/2.1.400/claude'))
    assert.strictEqual(installedVersion(cask, ['@anthropic-ai/claude-code'], ['claude', 'claude-code']), '2.1.400')
  })

  it('reads the npm package a command belongs to, its platform builds too, and nothing else’s', () => {
    const prefix = temp()
    const pkg = join(prefix, 'lib/node_modules/@openai/codex')
    writeFileSync(file(join(pkg, 'package.json'), ''), JSON.stringify({ name: '@openai/codex', version: '0.172.1' }))
    file(join(pkg, 'bin/codex.js'))
    const codex = link(join(pkg, 'bin/codex.js'), join(prefix, 'bin/codex'))
    assert.strictEqual(installedVersion(codex, ['@openai/codex'], ['codex']), '0.172.1')
    const platform = join(prefix, 'node_modules/@openai/codex-linux-x64')
    writeFileSync(file(join(platform, 'package.json'), ''), JSON.stringify({ name: '@openai/codex', version: '0.172.0-linux-x64' }))
    assert.strictEqual(
      installedVersion(file(join(platform, 'vendor/x86_64-unknown-linux-musl/bin/codex')), ['@openai/codex'], ['codex']),
      '0.172.0-linux-x64',
    )
    // Another package's folder, a version-looking folder that isn't its installer's, a path that isn't there: nothing.
    const other = join(prefix, 'other')
    writeFileSync(file(join(other, 'package.json'), ''), JSON.stringify({ name: 'something-else', version: '9.9.9' }))
    assert.isUndefined(installedVersion(file(join(other, 'bin/codex')), ['@openai/codex'], ['codex']))
    assert.isUndefined(installedVersion(file(join(prefix, 'node/24.1.0/bin/codex')), ['@openai/codex'], ['codex']))
    assert.isUndefined(installedVersion(join(prefix, 'nowhere/codex'), ['@openai/codex'], ['codex']))
  })
})

/** The adapters as Node would find them: Claude Code's SDK naming its version, codex-acp its range. */
const adapters = (claudeCodeVersion = '2.1.331', codexRange = '^0.172.0') => {
  const root = temp()
  const at = (name: string, manifest: Record<string, unknown>, main?: string) => {
    writeFileSync(file(join(root, name, 'package.json'), ''), JSON.stringify({ name, ...manifest }))
    if (main !== undefined) file(join(root, name, main))
  }
  at('@agentclientprotocol/claude-agent-acp', { version: '0.113.0' })
  at('@anthropic-ai/claude-agent-sdk', { version: '0.3.331', claudeCodeVersion }, 'sdk.mjs')
  at('@agentclientprotocol/codex-acp', { version: '2.12.1', dependencies: { '@openai/codex': codexRange } })
  const resolve: Resolver = (_from, request) => {
    const name = request.split('/').slice(0, 2).join('/')
    return join(root, name, request.slice(name.length + 1) || 'sdk.mjs')
  }
  return resolve
}

describe('whether an agent’s own install is one its adapter can drive', () => {
  it('takes a Claude Code of the release its SDK names or newer, of the same major, and no older one', () => {
    const resolve = adapters()
    const home = temp()
    const at = (version: string) => file(join(home, `claude/versions/${version}`))
    for (const fits of ['2.1.331', '2.1.400', '2.2.0']) assert.isTrue(claudeFits(at(fits), resolve, 'file:///here'), fits)
    for (const not of ['2.1.330', '2.0.999', '3.0.0']) assert.isFalse(claudeFits(at(not), resolve, 'file:///here'), not)
    // One whose version can't be read is never taken over Althar's own.
    assert.isFalse(claudeFits(file(join(home, 'bin/claude')), resolve, 'file:///here'))
    assert.isFalse(
      claudeFits(at('2.1.331'), () => {
        throw new Error('no adapter')
      }),
    )
  })

  it('takes a Codex within codex-acp’s caret range, holding its minor below 1.0 and its major from it', () => {
    const home = temp()
    const at = (version: string) => file(join(home, `Cellar/codex/${version}/bin/codex`))
    const resolve = adapters()
    for (const fits of ['0.172.0', '0.172.9']) assert.isTrue(codexFits(at(fits), resolve, 'file:///here'), fits)
    for (const not of ['0.171.9', '0.173.0', '1.172.0']) assert.isFalse(codexFits(at(not), resolve, 'file:///here'), not)
    const major = adapters('2.1.331', '^1.4.2')
    for (const fits of ['1.4.2', '1.9.0']) assert.isTrue(codexFits(at(fits), major, 'file:///here'), fits)
    for (const not of ['1.4.1', '2.0.0']) assert.isFalse(codexFits(at(not), major, 'file:///here'), not)
    assert.isFalse(codexFits(at('0.172.0'), adapters('2.1.331', 'latest'), 'file:///here'))
  })
})

describe('finding an agent’s program, where the person’s own must fit', () => {
  it('passes over a copy of the person’s that doesn’t fit, for Althar’s download, and drives the one it found', () => {
    const home = temp()
    const theirs = file(join(home, 'bin/claude'))
    const kept = file(join(home, 'agents/claude-code/current/claude'))
    const options = { platform: 'linux', env: { PATH: join(home, 'bin') }, dirs: [] }
    assert.deepStrictEqual(locate('claude', { bundled: null, kept }, { ...options, fits: () => true }), {
      command: 'claude',
      whose: 'theirs',
    })
    assert.deepStrictEqual(locate('claude', { bundled: null, kept }, { ...options, fits: () => false }), { command: kept, whose: 'althar' })
    // Compared as paths: on Windows, the Linux lookup joins its PATH with `/`, where `theirs` was joined with `\`.
    assert.isNull(locate('claude', { bundled: null, kept: null }, { ...options, fits: (path) => normalize(path) !== normalize(theirs) }))
    // Its adapter drives Althar's download, or the person's own, by the variable it reads; the copy beside it, as before.
    const claude = agents['claude-code']
    const launched = (found: Parameters<typeof usingLocated>[1]) => usingLocated(claude, found).launch('/node').env ?? {}
    assert.strictEqual(launched(() => ({ command: kept, whose: 'althar' })).CLAUDE_CODE_EXECUTABLE, kept)
    assert.strictEqual(launched(() => ({ command: theirs, whose: 'theirs' })).CLAUDE_CODE_EXECUTABLE, theirs)
    assert.isUndefined(launched(() => ({ command: '/app/claude', whose: 'bundled' })).CLAUDE_CODE_EXECUTABLE)
    assert.isUndefined(launched(() => null).CLAUDE_CODE_EXECUTABLE)
  })
})

describe('Claude Code’s and Codex’s programs, pinned', () => {
  it('are the packages the lockfile resolves, for every platform their makers publish, each with its size', () => {
    const lock = readFileSync(join(import.meta.dirname, '..', '..', '..', 'bun.lock'), 'utf8')
    const fromLock = pinsFromLock(lock)
    for (const agent of ['claude-code', 'codex'] as const) {
      const pinned = PINNED_PROGRAMS[agent]
      assert.strictEqual(pinned.version, fromLock[agent].version, `${agent}: run scripts/pinPrograms.ts`)
      assert.deepStrictEqual(Object.keys(pinned.assets).sort(), Object.keys(fromLock[agent].assets).sort())
      for (const [target, asset] of Object.entries(pinned.assets)) {
        const { bytes, ...rest } = asset
        assert.deepStrictEqual(rest, fromLock[agent].assets[target], `${agent} ${target}: run scripts/pinPrograms.ts`)
        assert.isAbove(bytes ?? 0, 100_000_000, `${agent} ${target}`)
        assert.match(asset.integrity, /^sha512-[A-Za-z0-9+/]{86}==$/u)
        assert.strictEqual(asset.tarball, tarballOf(asset.name, asset.version))
      }
    }
    assert.includeMembers(Object.keys(PINNED_PROGRAMS['claude-code'].assets), [
      'linux-x64',
      'linux-x64-musl',
      'linux-arm64',
      'darwin-arm64',
      'win32-x64',
    ])
    assert.strictEqual(PINNED_PROGRAMS.codex.assets['linux-x64']?.program, 'vendor/x86_64-unknown-linux-musl/bin/codex')
    assert.deepStrictEqual(PINNED_PROGRAMS.codex.assets['linux-x64']?.prune, ['vendor/x86_64-unknown-linux-musl/codex-resources/voice'])
    assert.strictEqual(PINNED_PROGRAMS['claude-code'].assets['win32-x64']?.program, 'claude.exe')
    assert.strictEqual(
      tarballOf('@openai/codex', '0.172.0-linux-x64'),
      'https://registry.npmjs.org/@openai/codex/-/codex-0.172.0-linux-x64.tgz',
    )
  })

  it('refuse a lockfile without one of them', () => {
    assert.throws(() => pinsFromLock('{}'), /bun.lock resolves no/u)
  })

  it('are what Claude Code and Codex download, with the adapter told which program to drive', () => {
    assert.deepStrictEqual(agents['claude-code'].cli?.download, { npm: true, ...PINNED_PROGRAMS['claude-code'] })
    assert.deepStrictEqual(agents.codex.cli?.download, { npm: true, ...PINNED_PROGRAMS.codex })
    assert.strictEqual(agents['claude-code'].cli?.drivenBy, 'CLAUDE_CODE_EXECUTABLE')
    assert.strictEqual(agents.codex.cli?.drivenBy, 'CODEX_PATH')
  })
})
