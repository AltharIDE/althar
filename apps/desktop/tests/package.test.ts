import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { ADAPTER_PATCH_MARKER, adapterPatchFor, applyAdapterPatch, assertAdapterPatched, PATCHED_FILE } from '../scripts/adapterPatch'
import { loadLocalCatalog } from '../../../packages/skills/src/local'
import { binariesFor, speechPackage } from '../scripts/binaries'
import { stageSkillsCatalog } from '../scripts/catalog'
import { entitlementsFor } from '../scripts/entitlements'
import { fetchNode, NODE_ARCHIVES, NODE_VERSION, nodeArchive, nodeProgram } from '../scripts/node'

const JIT = 'com.apple.security.cs.allow-jit'
const UNSIGNED_MEMORY = 'com.apple.security.cs.allow-unsigned-executable-memory'
const ANY_LIBRARY = 'com.apple.security.cs.disable-library-validation'
const MICROPHONE = 'com.apple.security.device.audio-input'

const frameworks = 'Contents/Frameworks'
const modules = 'Contents/Resources/app/node_modules'
const codex = `${modules}/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin`

describe('the packaged app', () => {
  it('ships the skill catalog where its runtime looks, and the runtime loads every skill from there', async () => {
    const stage = mkdtempSync(join(tmpdir(), 'althar-stage-'))
    const source = join(import.meta.dirname, '..', '..', '..', 'packages', 'skills', 'catalog')
    const found = stageSkillsCatalog(source, stage)
    expect(found).toBe(join(stage, 'resources', 'skills-catalog'))
    const [packaged, built] = await Effect.runPromise(Effect.all([loadLocalCatalog(found), loadLocalCatalog(source)]))
    expect(packaged.skills.map(({ entry }) => entry.id)).toEqual(built.skills.map(({ entry }) => entry.id))
    expect(packaged.skills.length).toBeGreaterThan(0)
    // A catalog with a skill gone is never packaged.
    const broken = mkdtempSync(join(tmpdir(), 'althar-catalog-'))
    cpSync(source, broken, { recursive: true })
    const first = packaged.skills[0]
    if (first === undefined) throw new Error('The catalog has no skill to take away')
    const gone = first.entry.id
    rmSync(join(broken, 'skills', gone), { recursive: true })
    expect(() => stageSkillsCatalog(broken, mkdtempSync(join(tmpdir(), 'althar-stage-')))).toThrow(`missing ${gone}`)
  })

  it('gives each executable only what it needs', () => {
    expect(entitlementsFor('')).toEqual([JIT, MICROPHONE])
    expect(entitlementsFor(`${frameworks}/Althar Helper.app`)).toEqual([JIT, MICROPHONE])
    expect(entitlementsFor(`${frameworks}/Althar Helper.app/Contents/MacOS/Althar Helper`)).toEqual([JIT, MICROPHONE])
    for (const kind of ['Renderer', 'GPU', 'Plugin']) expect(entitlementsFor(`${frameworks}/Althar Helper (${kind}).app`)).toEqual([JIT])
    expect(entitlementsFor('Contents/Resources/node/bin/node')).toEqual([JIT])
    expect(entitlementsFor(`${modules}/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude`)).toEqual([JIT, UNSIGNED_MEMORY, ANY_LIBRARY])
    expect(entitlementsFor(`${codex}/bin/codex`)).toEqual([JIT, UNSIGNED_MEMORY])
    expect(entitlementsFor(`${codex}/bin/codex-code-mode-host`)).toEqual([JIT, UNSIGNED_MEMORY])
  })

  it('gives nothing to what needs nothing, or does what Althar never asks of it', () => {
    for (const path of [
      `${codex}/codex-path/rg`,
      `${codex}/codex-resources/zsh/bin/zsh`,
      `${codex}/codex-resources/voice/bin/codex-voice-host`,
      `${modules}/sherpa-onnx-darwin-arm64/sherpa-onnx.node`,
      `${frameworks}/Squirrel.framework/Versions/A/Resources/ShipIt`,
      // Only the Node the app ships is Althar's: one anywhere else is not.
      `${modules}/somewhere/bin/node`,
    ])
      expect(entitlementsFor(path), path).toEqual([])
  })

  it('lets only Electron’s own binaries load any library when signed ad hoc', () => {
    expect(entitlementsFor('', true)).toEqual([JIT, MICROPHONE, ANY_LIBRARY])
    expect(entitlementsFor(`${frameworks}/Althar Helper (GPU).app`, true)).toEqual([JIT, ANY_LIBRARY])
    expect(entitlementsFor(`${frameworks}/Squirrel.framework/Versions/A/Resources/ShipIt`, true)).toEqual([ANY_LIBRARY])
    expect(entitlementsFor('Contents/Resources/node/bin/node', true)).toEqual([JIT])
    expect(entitlementsFor(`${codex}/bin/codex`, true)).toEqual([JIT, UNSIGNED_MEMORY])
  })

  it('ships a Node for every platform it is packaged on, from nodejs.org', () => {
    for (const platform of ['darwin-arm64', 'linux-x64', 'win32-x64']) expect(NODE_ARCHIVES[platform]).toMatch(/^[0-9a-f]{64}$/)
    expect(nodeArchive('darwin', 'arm64').url).toBe(`https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-arm64.tar.gz`)
    expect(nodeArchive('darwin', 'arm64').program).toBe(`node-v${NODE_VERSION}-darwin-arm64/bin/node`)
    expect(nodeProgram('darwin')).toBe('node')
  })

  it('takes Windows’ Node from its zip, where it is node.exe at the top, named win', () => {
    expect(nodeArchive('win32', 'x64')).toEqual({
      name: `node-v${NODE_VERSION}-win-x64`,
      file: `node-v${NODE_VERSION}-win-x64.zip`,
      program: `node-v${NODE_VERSION}-win-x64/node.exe`,
      url: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-win-x64.zip`,
    })
    expect(nodeProgram('win32')).toBe('node.exe')
  })

  it('looks for Codex, Claude Code and the speech engine where the runtime finds them, as .exe on Windows', () => {
    expect(binariesFor('win32', 'x64')).toEqual([
      { parent: '@openai/codex', name: '@openai/codex-win32-x64', file: 'vendor/x86_64-pc-windows-msvc/bin/codex.exe' },
      { parent: '@anthropic-ai/claude-agent-sdk', name: '@anthropic-ai/claude-agent-sdk-win32-x64', file: 'claude.exe' },
      { parent: 'sherpa-onnx-node', name: 'sherpa-onnx-win-x64', file: 'sherpa-onnx.node' },
    ])
    expect(binariesFor('darwin', 'arm64').map(({ name, file }) => `${name}/${file}`)).toEqual([
      '@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex',
      '@anthropic-ai/claude-agent-sdk-darwin-arm64/claude',
      'sherpa-onnx-darwin-arm64/sherpa-onnx.node',
    ])
    expect(speechPackage('linux', 'x64')).toBe('sherpa-onnx-linux-x64')
    expect(() => binariesFor('win32', 'ia32')).toThrow(/no build for win32-ia32/)
  })

  it('refuses a platform it has no Node for, before fetching anything', async () => {
    await expect(fetchNode(mkdtempSync(join(tmpdir(), 'althar-node-')), 'plan9', 'mips')).rejects.toThrow(/no Node for plan9-mips/)
  })
})

describe('the patch to Claude Code’s adapter, in the packaged app', () => {
  const version = (
    JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')) as {
      readonly dependencies: Record<string, string>
    }
  ).dependencies['@agentclientprotocol/claude-agent-acp']
  const patch = adapterPatchFor(join(import.meta.dirname, '..', '..', '..'), version)

  /** The adapter as npm installs it, unpatched, staged in a repository as apps/desktop/out is. */
  const stagedInARepository = () => {
    const repository = mkdtempSync(join(tmpdir(), 'althar-stage-'))
    execFileSync('git', ['init', '-q'], { cwd: repository })
    const adapter = join(repository, 'out', 'stage', 'node_modules', '@agentclientprotocol', 'claude-agent-acp')
    const workspace = dirname(createRequire(import.meta.url).resolve('@agentclientprotocol/claude-agent-acp/package.json'))
    // Each file the patch changes, as `git apply -R` needs them all.
    for (const [, file] of readFileSync(patch, 'utf8').matchAll(/^diff --git a\/(\S+) /gm)) {
      mkdirSync(dirname(join(adapter, file!)), { recursive: true })
      cpSync(join(workspace, file!), join(adapter, file!))
    }
    // The workspace's copy is bun's, patched: undone outside any repository, it is npm's.
    execFileSync('git', ['apply', '-R', patch], { cwd: adapter, env: { ...process.env, GIT_CEILING_DIRECTORIES: dirname(adapter) } })
    return adapter
  }

  it('is applied to a copy staged inside a repository, where git apply would skip it and succeed', () => {
    const adapter = stagedInARepository()
    expect(() => assertAdapterPatched(adapter)).toThrow(/is not patched/)
    applyAdapterPatch(adapter, patch)
    expect(readFileSync(join(adapter, PATCHED_FILE), 'utf8')).toContain(ADAPTER_PATCH_MARKER)
  })

  it('stops packaging when the adapter has no patch for its version', () => {
    expect(() => applyAdapterPatch(stagedInARepository(), adapterPatchFor(tmpdir(), '0.0.0'))).toThrow(/no patch for the Claude adapter/)
  })
})
