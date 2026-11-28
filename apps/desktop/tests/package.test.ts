import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

import { ADAPTER_PATCH_MARKER, adapterPatchFor, applyAdapterPatch, assertAdapterPatched, PATCHED_FILE } from '../scripts/adapterPatch'
import { isMachO, LIPO_ARCH, macBuild, machOFiles, wrongArchs } from '../scripts/archs'
import {
  ADAPTERS,
  agentProgramsIn,
  assertNoAgentPrograms,
  binariesFor,
  NATIVE,
  pruneAgentPrograms,
  prunePrebuilds,
  speechPackage,
} from '../scripts/binaries'
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

  it('checks the speech engine and computer-use driver at their platform paths, and no agent’s own program', () => {
    expect(binariesFor('win32', 'x64')).toEqual([
      { parent: 'sherpa-onnx-node', name: 'sherpa-onnx-win-x64', file: 'sherpa-onnx.node' },
      { parent: '@trycua/cua-driver', name: '@trycua/cua-driver-win32-x64-msvc', file: 'cua_driver_node_runtime.node' },
      { parent: '@trycua/cua-driver', name: '@trycua/cua-driver-win32-x64-msvc', file: 'cua_driver_sdk.dll' },
    ])
    expect(binariesFor('darwin', 'arm64').map(({ name, file }) => `${name}/${file}`)).toEqual([
      'sherpa-onnx-darwin-arm64/sherpa-onnx.node',
      '@trycua/cua-driver-darwin-arm64/cua_driver_node_runtime.node',
      '@trycua/cua-driver-darwin-arm64/libcua_driver_sdk.dylib',
    ])
    expect(binariesFor('darwin', 'x64').map(({ name, file }) => `${name}/${file}`)).toEqual([
      'sherpa-onnx-darwin-x64/sherpa-onnx.node',
      '@trycua/cua-driver-darwin-x64/cua_driver_node_runtime.node',
      '@trycua/cua-driver-darwin-x64/libcua_driver_sdk.dylib',
    ])
    expect(binariesFor('linux', 'x64')).toContainEqual({
      parent: '@trycua/cua-driver',
      name: '@trycua/cua-driver-linux-x64-gnu',
      file: 'libcua_driver_sdk.so',
    })
    expect(speechPackage('linux', 'x64')).toBe('sherpa-onnx-linux-x64')
  })

  it('removes the agents’ own programs npm installed with their adapters, at any depth, and fails where one is left', () => {
    const app = mkdtempSync(join(tmpdir(), 'althar-stage-'))
    const pkg = (...path: string[]) => {
      mkdirSync(join(app, ...path), { recursive: true })
      writeFileSync(join(app, ...path, 'package.json'), '{}')
    }
    pkg('node_modules', '@anthropic-ai', 'claude-agent-sdk')
    pkg('node_modules', '@anthropic-ai', 'claude-agent-sdk-darwin-arm64')
    pkg('node_modules', '@openai', 'codex')
    pkg('node_modules', '@openai', 'codex-darwin-arm64')
    pkg('node_modules', '@agentclientprotocol', 'codex-acp', 'node_modules', '@openai', 'codex-darwin-arm64')
    pkg('node_modules', 'sharp')
    expect(agentProgramsIn(app).map((path) => relative(app, path).split(sep).join('/'))).toEqual([
      'node_modules/@agentclientprotocol/codex-acp/node_modules/@openai/codex-darwin-arm64',
      'node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64',
      'node_modules/@openai/codex-darwin-arm64',
    ])
    expect(() => assertNoAgentPrograms(app)).toThrow(/come on first use/)
    pruneAgentPrograms(app)
    expect(() => assertNoAgentPrograms(app)).not.toThrow()
    // The adapters' own packages, and everything else, stay.
    for (const kept of ['@anthropic-ai/claude-agent-sdk', '@openai/codex', 'sharp'])
      expect(existsSync(join(app, 'node_modules', kept))).toBe(true)
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

/*
 * The Mac app is packaged only for a release, where a program for the other
 * processor fails it. This finds one on any pull request, Linux's included:
 * a package npm doesn't pick by platform comes whole into both builds, so
 * what staging leaves of it must run on each.
 */
describe('the programs inside the packages every build gets', () => {
  /** Each shipped package and what it depends on, as the workspace has them, without those npm picks by `os` or `cpu`. */
  const everyBuilds = () => {
    const found = new Map<string, string>()
    const visit = (from: string, name: string) => {
      const folder = (createRequire(from).resolve.paths(name) ?? [])
        .map((each) => join(each, name))
        .find((each) => existsSync(join(each, 'package.json')))
      // An optional dependency for another platform isn't installed.
      if (folder === undefined) return
      const real = realpathSync(folder)
      if (found.has(real)) return
      const manifest = join(real, 'package.json')
      const own = JSON.parse(readFileSync(manifest, 'utf8')) as {
        readonly os?: ReadonlyArray<string>
        readonly cpu?: ReadonlyArray<string>
        readonly dependencies?: Record<string, string>
        readonly optionalDependencies?: Record<string, string>
      }
      if (own.os !== undefined || own.cpu !== undefined) return
      found.set(real, name)
      for (const next of Object.keys({ ...own.dependencies, ...own.optionalDependencies })) visit(manifest, next)
    }
    for (const name of [...ADAPTERS, ...NATIVE]) visit(join(import.meta.dirname, '..', 'package.json'), name)
    return found
  }

  /** The processors a Mach-O file holds, by their cputype, read here as only a Mac has lipo. */
  const processors = (path: string) => {
    const file = readFileSync(path)
    const magic = file.readUInt32BE(0)
    const types =
      magic === 0xcafebabe || magic === 0xcafebabf
        ? Array.from({ length: file.readUInt32BE(4) }, (_, i) => file.readUInt32BE(8 + i * (magic === 0xcafebabe ? 20 : 32)))
        : [magic === 0xcffaedfe || magic === 0xcefaedfe ? file.readUInt32LE(4) : file.readUInt32BE(4)]
    return types.map((type) => (type === 0x0100000c ? 'arm64' : type === 0x01000007 ? 'x64' : `cputype ${type}`))
  }

  it.each(['arm64', 'x64'])('all run on the %s Mac build once staged', (arch) => {
    const app = mkdtempSync(join(tmpdir(), 'althar-shipped-'))
    for (const [folder, name] of everyBuilds()) {
      // A package's own files: what it depends on is visited by itself.
      const programs = machOFiles(folder).filter((path) => !relative(folder, path).startsWith('node_modules'))
      for (const program of programs) cpSync(program, join(app, 'node_modules', name, relative(folder, program)))
    }
    prunePrebuilds(app, 'darwin', arch)
    const left = machOFiles(app)
    // node-pty's own two, so an empty app doesn't pass.
    expect(left.length).toBeGreaterThanOrEqual(2)
    expect(left.filter((path) => !processors(path).includes(arch)).map((path) => relative(app, path))).toEqual([])
  })

  it('keeps only the build’s own node-pty prebuild, and none on Linux, which compiles its own', () => {
    const staged = () => {
      const app = mkdtempSync(join(tmpdir(), 'althar-prebuilds-'))
      const source = join(dirname(createRequire(import.meta.url).resolve('node-pty/package.json')), 'prebuilds')
      cpSync(source, join(app, 'node_modules', 'node-pty', 'prebuilds'), { recursive: true })
      return app
    }
    const kept = (platform: string, arch: string) => {
      const app = staged()
      prunePrebuilds(app, platform, arch)
      return readdirSync(join(app, 'node_modules', 'node-pty', 'prebuilds'))
    }
    expect(kept('darwin', 'x64')).toEqual(['darwin-x64'])
    expect(kept('win32', 'x64')).toEqual(['win32-x64'])
    expect(kept('linux', 'x64')).toEqual([])
    expect(() => prunePrebuilds(staged(), 'darwin', 'ia32')).toThrow(/no prebuild for darwin-ia32/)
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
