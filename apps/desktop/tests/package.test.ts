import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { ADAPTER_PATCH_MARKER, adapterPatchFor, applyAdapterPatch, assertAdapterPatched, PATCHED_FILE } from '../scripts/adapterPatch'
import { isMachO, LIPO_ARCH, macBuild, wrongArchs } from '../scripts/archs'
import { binariesFor, speechPackage } from '../scripts/binaries'
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
    // Intel's Node can't start under the hardened runtime without unsigned executable memory; nothing else differs.
    expect(entitlementsFor('Contents/Resources/node/bin/node', false, 'x64')).toEqual([JIT, UNSIGNED_MEMORY])
    expect(entitlementsFor('', false, 'x64')).toEqual([JIT, MICROPHONE])
    expect(entitlementsFor(`${codex}/bin/codex`, false, 'x64')).toEqual([JIT, UNSIGNED_MEMORY])
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
    expect(binariesFor('darwin', 'x64').map(({ name, file }) => `${name}/${file}`)).toEqual([
      '@openai/codex-darwin-x64/vendor/x86_64-apple-darwin/bin/codex',
      '@anthropic-ai/claude-agent-sdk-darwin-x64/claude',
      'sherpa-onnx-darwin-x64/sherpa-onnx.node',
    ])
    expect(speechPackage('linux', 'x64')).toBe('sherpa-onnx-linux-x64')
    expect(() => binariesFor('win32', 'ia32')).toThrow(/no build for win32-ia32/)
  })

  it('ships a Node for Intel Macs too, and names each Mac build with its processor', () => {
    expect(NODE_ARCHIVES['darwin-x64']).toMatch(/^[0-9a-f]{64}$/)
    expect(nodeArchive('darwin', 'x64').url).toBe(`https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-x64.tar.gz`)
    expect(macBuild('Althar', '0.7.0', 'arm64')).toEqual({
      folder: 'mac-arm64',
      dmg: 'Althar-0.7.0-arm64.dmg',
      zip: 'Althar-0.7.0-arm64-mac.zip',
    })
    expect(macBuild('Althar', '0.7.0', 'x64')).toEqual({ folder: 'mac', dmg: 'Althar-0.7.0-x64.dmg', zip: 'Althar-0.7.0-x64-mac.zip' })
    expect(LIPO_ARCH).toEqual({ arm64: 'arm64', x64: 'x86_64' })
  })

  it('tells a Mach-O program, thin or fat, from a Java class and anything else', () => {
    const bytes = (...words: ReadonlyArray<number>) => {
      const view = new DataView(new ArrayBuffer(words.length * 4))
      words.forEach((word, i) => view.setUint32(i * 4, word, false))
      return new Uint8Array(view.buffer)
    }
    // A 64-bit thin file as it lies on disk (little-endian), a 32-bit one, and a fat one with two slices.
    expect(isMachO(bytes(0xcffaedfe, 0x0c000001))).toBe(true)
    expect(isMachO(bytes(0xcefaedfe, 0x07000000))).toBe(true)
    expect(isMachO(bytes(0xcafebabe, 2))).toBe(true)
    // A class file for Java 8 has the same magic, then its version, 52.
    expect(isMachO(bytes(0xcafebabe, 52))).toBe(false)
    expect(isMachO(new TextEncoder().encode('#!/usr/bin/env node\n'))).toBe(false)
    expect(isMachO(bytes(0xcffaedfe))).toBe(false)
  })

  it.runIf(process.platform === 'darwin')('finds a program built for the other processor in an app', () => {
    const app = mkdtempSync(join(tmpdir(), 'althar-archs-'))
    mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true })
    // macOS's own lipo, thinned to Intel, and to arm64e, the system's own Apple silicon, which an arm64 app's programs aren't.
    execFileSync('lipo', ['/usr/bin/lipo', '-thin', 'arm64e', '-output', join(app, 'Contents', 'MacOS', 'arm64e')])
    execFileSync('lipo', ['/usr/bin/lipo', '-thin', 'x86_64', '-output', join(app, 'Contents', 'MacOS', 'intel')])
    expect(wrongArchs(app, 'x64')).toEqual({ read: 2, wrong: [{ path: 'Contents/MacOS/arm64e', archs: ['arm64e'] }] })
    expect(
      wrongArchs(app, 'arm64')
        .wrong.map(({ path }) => path)
        .sort(),
    ).toEqual(['Contents/MacOS/arm64e', 'Contents/MacOS/intel'])
    expect(() => wrongArchs(app, 'ia32')).toThrow(/No Mac build/)
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
