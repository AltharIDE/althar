import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

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
