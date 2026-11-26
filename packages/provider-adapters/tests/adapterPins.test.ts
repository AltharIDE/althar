import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'

/*
 * Every package of the repository runs the same Claude Code and Codex
 * adapters, each with its patch. On 24 November 2026 apps/host and apps/cli
 * still pinned claude-agent-acp 0.108.0 and codex-acp 2.7.0 after the desktop
 * moved to 0.110.1 and 2.10.0: bun hoisted the older Agent SDK and Codex, with
 * their programs, where Node finds a package its own folder lacks. When an
 * install linked the new SDK before its 364 MB program arrived, the new
 * adapter found the hoisted Claude Code 2.1.326 instead, which refused the
 * newer SDK's `--initialize-fields=settings`, and every start failed with a
 * bare "Internal error" until the install finished. One version, hoisted or
 * not, can't be the wrong one.
 */

const root = join(import.meta.dirname, '..', '..', '..')
const ADAPTERS = ['@agentclientprotocol/claude-agent-acp', '@agentclientprotocol/codex-acp'] as const

interface Manifest {
  readonly name?: string
  readonly dependencies?: Readonly<Record<string, string>>
  readonly devDependencies?: Readonly<Record<string, string>>
  readonly patchedDependencies?: Readonly<Record<string, string>>
}

const read = (path: string): Manifest => JSON.parse(readFileSync(path, 'utf8')) as Manifest

const workspaces = ['apps', 'packages'].flatMap((group) =>
  readdirSync(join(root, group))
    .map((name) => join(root, group, name, 'package.json'))
    .filter((path) => existsSync(path)),
)

const pins = (adapter: string) =>
  workspaces.flatMap((path) => {
    const manifest = read(path)
    const version = manifest.dependencies?.[adapter] ?? manifest.devDependencies?.[adapter]
    return version === undefined ? [] : [{ name: manifest.name ?? path, version }]
  })

describe('the adapters every package runs', () => {
  it.each(ADAPTERS)('%s is one exact version in every package', (adapter) => {
    const found = pins(adapter)
    assert.isAtLeast(found.length, 2, `${adapter} is pinned by the desktop app and the provider adapters at least`)
    const versions = new Set(found.map((pin) => pin.version))
    assert.strictEqual(versions.size, 1, `${adapter}: ${found.map((pin) => `${pin.name} ${pin.version}`).join(', ')}`)
    assert.match([...versions][0]!, /^\d+\.\d+\.\d+$/, `${adapter} is pinned exactly, not as a range`)
  })

  it.each(ADAPTERS)('%s has its patch for the version pinned, and for no other', (adapter) => {
    const version = pins(adapter)[0]!.version
    const patched = Object.keys(read(join(root, 'package.json')).patchedDependencies ?? {}).filter((key) => key.startsWith(`${adapter}@`))
    assert.deepStrictEqual(patched, [`${adapter}@${version}`])
  })
})
