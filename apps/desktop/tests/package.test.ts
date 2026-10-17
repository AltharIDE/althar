import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { ADAPTER_PATCH_MARKER, adapterPatchFor, applyAdapterPatch, assertAdapterPatched, PATCHED_FILE } from '../scripts/adapterPatch'
import { entitlementsFor } from '../scripts/entitlements'
import { fetchNode, NODE_ARCHIVES, NODE_VERSION, nodeArchive } from '../scripts/node'

const JIT = 'com.apple.security.cs.allow-jit'
const UNSIGNED_MEMORY = 'com.apple.security.cs.allow-unsigned-executable-memory'
const ANY_LIBRARY = 'com.apple.security.cs.disable-library-validation'
const MICROPHONE = 'com.apple.security.device.audio-input'

const frameworks = 'Contents/Frameworks'
const modules = 'Contents/Resources/app/node_modules'
const codex = `${modules}/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin`

describe('the packaged app', () => {
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
    for (const platform of ['darwin-arm64', 'linux-x64']) expect(NODE_ARCHIVES[platform]).toMatch(/^[0-9a-f]{64}$/)
    expect(nodeArchive('darwin', 'arm64').url).toBe(`https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-arm64.tar.gz`)
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
    mkdirSync(join(adapter, 'dist'), { recursive: true })
    const workspace = dirname(createRequire(import.meta.url).resolve('@agentclientprotocol/claude-agent-acp/package.json'))
    cpSync(join(workspace, PATCHED_FILE), join(adapter, PATCHED_FILE))
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
