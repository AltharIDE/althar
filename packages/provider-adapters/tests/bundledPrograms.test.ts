import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, assert, describe, it } from '@effect/vitest'

import { bundledProblem, claudeProgram, codexProgram, type Resolver } from '../src/bundledPrograms'
import { agents } from '../src/registry'
import { startFailureOf } from '../src/startFailure'

/*
 * The program Althar brings for Claude Code and Codex, looked for before each
 * start as the adapter would find it. The install here is the repository's
 * own; the rest are folders laid out as a package manager leaves them, with
 * the platform package missing, or an older one found further up, as on 24
 * November 2026.
 */

const folders: string[] = []
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

/** A node_modules of packages by name, each a version and the files it holds; `up` holds what Node would find further up. */
const layout = (
  near: Readonly<Record<string, { readonly version: string; readonly files?: ReadonlyArray<string> }>>,
  up: Readonly<Record<string, { readonly version: string; readonly files?: ReadonlyArray<string> }>> = {},
) => {
  const root = mkdtempSync(join(tmpdir(), 'althar-programs-'))
  folders.push(root)
  const write = (base: string, packages: typeof near) => {
    for (const [name, { version, files = [] }] of Object.entries(packages)) {
      const folder = join(base, name)
      mkdirSync(folder, { recursive: true })
      writeFileSync(join(folder, 'package.json'), JSON.stringify({ name, version }))
      for (const file of files) {
        mkdirSync(dirname(join(folder, file)), { recursive: true })
        writeFileSync(join(folder, file), '')
      }
    }
  }
  write(join(root, 'near'), near)
  write(join(root, 'up'), up)
  // Node's order: the folder of the package asking, then further up.
  const resolve: Resolver = (_from, request) => {
    const name = request.startsWith('@') ? request.split('/').slice(0, 2).join('/') : request.split('/')[0]!
    // A bare name is its main entry, the SDK's sdk.mjs.
    const file = request.slice(name.length + 1) || 'sdk.mjs'
    for (const base of [join(root, 'near'), join(root, 'up')]) {
      if (existsSync(join(base, name, file))) return join(base, name, file)
    }
    throw new Error(`Cannot find module '${request}'`)
  }
  return resolve
}

const claude = claudeProgram('darwin', 'arm64', false)
const ADAPTER = { version: '0.110.1' }

describe('the program Althar brings for an agent', () => {
  it('is there, and of the version its adapter needs, in this install', () => {
    for (const agent of [agents['claude-code'], agents.codex]) {
      assert.isDefined(agent.program, agent.id)
      assert.isUndefined(agent.program!({}), agent.id)
    }
  })

  it('isn’t asked for where the launch drives the person’s own copy', () => {
    assert.isUndefined(agents['claude-code'].program!({ CLAUDE_CODE_EXECUTABLE: '/nowhere/claude' }))
    assert.isUndefined(agents.codex.program!({ CODEX_PATH: '/nowhere/codex' }))
  })

  it('in a Flatpak, is Codex there only where its launch names the copy its bridge runs, never the bridge alone', () => {
    const before = process.env.FLATPAK_ID
    try {
      process.env.FLATPAK_ID = 'dev.althar.app'
      // `CODEX_PATH` is always the bridge there: told no copy to run, there is none, so its first start brings one.
      assert.include(agents.codex.program!({ CODEX_PATH: '/app/bin/althar-host-codex' }) ?? '', 'missing')
      assert.isUndefined(agents.codex.program!({ CODEX_PATH: '/app/bin/althar-host-codex', ALTHAR_CODEX_PROGRAM: '/kept/codex' }))
    } finally {
      if (before === undefined) delete process.env.FLATPAK_ID
      else process.env.FLATPAK_ID = before
    }
  })

  it('says it is missing where its platform package isn’t installed, and the rest are', () => {
    const resolve = layout({
      '@agentclientprotocol/claude-agent-acp': ADAPTER,
      '@anthropic-ai/claude-agent-sdk': { version: '0.3.330', files: ['sdk.mjs'] },
    })
    const said = bundledProblem(claude, '/althar', resolve)
    assert.strictEqual(
      said,
      "Claude Code's own program for this computer (@anthropic-ai/claude-agent-sdk-darwin-arm64 0.3.330) is missing.",
    )
    assert.strictEqual(startFailureOf(said!), 'incomplete')
  })

  it('says it is missing where its package is there but not the program, as a download still under way leaves it', () => {
    const resolve = layout({
      '@agentclientprotocol/claude-agent-acp': ADAPTER,
      '@anthropic-ai/claude-agent-sdk': { version: '0.3.330', files: ['sdk.mjs'] },
      '@anthropic-ai/claude-agent-sdk-darwin-arm64': { version: '0.3.330' },
    })
    assert.include(bundledProblem(claude, '/althar', resolve), 'is missing')
  })

  it('says the versions where Node finds an older one further up, as on 24 November 2026', () => {
    const resolve = layout(
      {
        '@agentclientprotocol/claude-agent-acp': ADAPTER,
        '@anthropic-ai/claude-agent-sdk': { version: '0.3.330', files: ['sdk.mjs'] },
      },
      { '@anthropic-ai/claude-agent-sdk-darwin-arm64': { version: '0.3.326', files: ['claude'] } },
    )
    const said = bundledProblem(claude, '/althar', resolve)
    assert.strictEqual(said, "Claude Code's own program is version 0.3.326, and its adapter needs 0.3.330.")
    assert.strictEqual(startFailureOf(said!), 'version_mismatch')
  })

  it('reads Codex’s platform build past its suffix', () => {
    const codex = codexProgram('darwin', 'arm64')!
    const program = join('vendor', 'aarch64-apple-darwin', 'bin', 'codex')
    const matching = layout({
      '@agentclientprotocol/codex-acp': { version: '2.10.0' },
      '@openai/codex': { version: '0.171.0' },
      '@openai/codex-darwin-arm64': { version: '0.171.0-darwin-arm64', files: [program] },
    })
    assert.isUndefined(bundledProblem(codex, '/althar', matching))
    const older = layout(
      { '@agentclientprotocol/codex-acp': { version: '2.10.0' }, '@openai/codex': { version: '0.171.0' } },
      { '@openai/codex-darwin-arm64': { version: '0.166.0-darwin-arm64', files: [program] } },
    )
    assert.strictEqual(bundledProblem(codex, '/althar', older), "Codex's own program is version 0.166.0, and its adapter needs 0.171.0.")
  })

  it('says nothing where the adapter itself isn’t there: it fails to start in its own words', () => {
    assert.isUndefined(bundledProblem(claude, '/althar', layout({})))
  })

  it('looks for the build for the computer’s C library first on Linux', () => {
    assert.deepStrictEqual(claudeProgram('linux', 'x64', true).platforms, [
      '@anthropic-ai/claude-agent-sdk-linux-x64-musl',
      '@anthropic-ai/claude-agent-sdk-linux-x64',
    ])
    assert.deepStrictEqual(claudeProgram('linux', 'x64', false).platforms, [
      '@anthropic-ai/claude-agent-sdk-linux-x64',
      '@anthropic-ai/claude-agent-sdk-linux-x64-musl',
    ])
    assert.strictEqual(claudeProgram('win32', 'x64', false).program, 'claude.exe')
    assert.isUndefined(codexProgram('freebsd', 'x64'))
  })
})
