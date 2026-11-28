import { generateKeyPairSync } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { assembleBundle, assembleWorkerBundle, copyDependencies, copyHostAssets, readReleaseKey } from '../src/updates/bundle'
import { temporary } from './support'

const pkg = (root: string, name: string, dependencies: Record<string, string> = {}) => {
  const folder = join(root, 'node_modules', name)
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'package.json'), JSON.stringify({ name, version: '1.0.0', dependencies }))
  writeFileSync(join(folder, 'index.js'), name)
  return folder
}

describe('locked host dependency bundles', () => {
  it('accepts a single-file build but refuses to overwrite a verifier in the destination', async () => {
    const root = temporary()
    const entry = join(root, 'althar-host.js')
    const destination = temporary()
    await copyHostAssets(entry, destination)
    expect(existsSync(join(destination, 'assets'))).toBe(false)
    mkdirSync(join(root, 'assets'))
    writeFileSync(join(root, 'assets/verifier.js'), 'new verifier')
    mkdirSync(join(destination, 'assets'))
    writeFileSync(join(destination, 'assets/verifier.js'), 'existing verifier')
    await expect(copyHostAssets(entry, destination)).rejects.toThrow()
    expect(readFileSync(join(destination, 'assets/verifier.js'), 'utf8')).toBe('existing verifier')
  })

  it('runs the relocated built entry and encodes a picture with its copied native dependencies', async () => {
    const destination = temporary()
    const entry = fileURLToPath(new URL('../dist/althar-host.js', import.meta.url))
    const relocated = join(destination, 'althar-host.mjs')
    writeFileSync(relocated, readFileSync(entry))
    await copyHostAssets(entry, destination)
    await copyDependencies(entry, destination, ['sharp'])
    const { stdout } = await promisify(execFile)(process.execPath, [relocated, '--help'])
    expect(stdout).toContain('althar-host')
    const probe = join(destination, 'picture.mjs')
    writeFileSync(
      probe,
      `import sharp from 'sharp'; console.log((await sharp({ create: { width: 16, height: 16, channels: 3, background: 'red' } }).jpeg().toBuffer()).length)`,
    )
    const encoded = await promisify(execFile)(process.execPath, [probe])
    expect(Number(encoded.stdout.trim())).toBeGreaterThan(0)
  })
  it('preserves resolution when a nested consumer needs the root version shadowed by its parent', async () => {
    const root = temporary()
    const shared = pkg(root, 'shared')
    pkg(root, 'd')
    const c = pkg(root, 'c', { shared: '2', d: '2' })
    const other = pkg(c, 'shared')
    writeFileSync(join(other, 'package.json'), JSON.stringify({ name: 'shared', version: '2.0.0' }))
    const external = temporary()
    const d = pkg(external, 'd', { shared: '1' })
    symlinkSync(shared, join(external, 'node_modules/shared'))
    symlinkSync(d, join(c, 'node_modules/d'))
    const destination = join(temporary(), 'release')
    mkdirSync(destination)
    await copyDependencies(join(root, 'package.json'), destination, ['shared', 'd', 'c'])
    const resolve = createRequire(join(destination, 'node_modules/c/node_modules/d/package.json'))
    const actual: unknown = JSON.parse(readFileSync(resolve.resolve('shared/package.json'), 'utf8'))
    expect(actual).toMatchObject({ version: '1.0.0' })
    expect(resolve.resolve('shared/package.json')).toContain('/c/node_modules/d/node_modules/shared/')
  })
  it('assembles Node, its license, the host entry and locked dependencies into a self-contained private tree', async () => {
    const root = temporary()
    const entry = join(root, 'entry.js')
    const node = join(root, 'node/bin/node')
    mkdirSync(join(root, 'node/bin'), { recursive: true })
    writeFileSync(entry, 'host code')
    mkdirSync(join(root, 'assets'))
    writeFileSync(join(root, 'assets/verifier.js'), 'export const verifier = true')
    writeFileSync(join(root, 'LICENSE'), 'Host license')
    writeFileSync(join(root, 'THIRD_PARTY_NOTICES.txt'), 'Bundled notices')
    writeFileSync(node, 'node binary')
    writeFileSync(join(root, 'node/LICENSE'), 'Node license')
    pkg(root, '@agentclientprotocol/claude-agent-acp')
    pkg(root, '@agentclientprotocol/codex-acp')
    pkg(root, 'sharp')
    // node-pty as npm leaves it on a Linux home: compiled into build/, beside node-gyp's link to Python and every
    // other platform's prebuilds and Windows' ConPTY.
    const pty = pkg(root, 'node-pty')
    const others = ['darwin-arm64', 'win32-x64', 'linux-riscv64'].filter((name) => name !== `${process.platform}-${process.arch}`)
    for (const other of others) {
      mkdirSync(join(pty, 'prebuilds', other), { recursive: true })
      writeFileSync(join(pty, 'prebuilds', other, 'pty.node'), 'other build')
    }
    mkdirSync(join(pty, 'third_party/conpty'), { recursive: true })
    writeFileSync(join(pty, 'third_party/conpty/conpty.dll'), 'windows')
    mkdirSync(join(pty, 'build/node_gyp_bins'), { recursive: true })
    symlinkSync(process.execPath, join(pty, 'build/node_gyp_bins/python3'))
    const withoutBuild = join(temporary(), 'release')
    await expect(assembleBundle({ entry, node, version: '1.2.3' }, withoutBuild)).rejects.toThrow()
    mkdirSync(join(pty, 'build/Release'), { recursive: true })
    writeFileSync(join(pty, 'build/Release/pty.node'), 'own build')
    const destination = join(temporary(), 'release')
    await assembleBundle({ entry, node, version: '1.2.3' }, destination)
    const shipped = join(destination, 'node_modules/node-pty')
    expect(readFileSync(join(shipped, 'build/Release/pty.node'), 'utf8')).toBe('own build')
    for (const gone of [...others.map((other) => `prebuilds/${other}`), 'third_party', 'build/node_gyp_bins'])
      expect(existsSync(join(shipped, gone)), gone).toBe(process.platform === 'win32' && gone === 'third_party')
    expect(readFileSync(join(destination, 'node/bin/node'), 'utf8')).toBe('node binary')
    expect(readFileSync(join(destination, 'node/LICENSE'), 'utf8')).toBe('Node license')
    expect(readFileSync(join(destination, 'dist/althar-host.js'), 'utf8')).toBe('host code')
    expect(readFileSync(join(destination, 'dist/assets/verifier.js'), 'utf8')).toBe('export const verifier = true')
    expect(readFileSync(join(destination, 'node_modules/sharp/index.js'), 'utf8')).toBe('sharp')
    expect(JSON.parse(readFileSync(join(destination, 'package.json'), 'utf8'))).toMatchObject({ type: 'module', version: '1.2.3' })
    const recaptured = join(temporary(), 'release')
    await assembleBundle(
      { entry: join(destination, 'dist/althar-host.js'), node: join(destination, 'node/bin/node'), version: '1.2.3' },
      recaptured,
    )
    expect(readFileSync(join(recaptured, 'LICENSE'), 'utf8')).toBe('Host license')
    // Without a worker, none; with one, the release carries it, for a worker to install from the same release.
    expect(existsSync(join(destination, 'althar-worker'))).toBe(false)
    writeFileSync(join(root, 'althar-worker'), 'worker binary')
    const withWorker = join(temporary(), 'release')
    await assembleBundle({ entry, node, version: '1.2.3', worker: join(root, 'althar-worker') }, withWorker)
    expect(readFileSync(join(withWorker, 'althar-worker'), 'utf8')).toBe('worker binary')
    expect(statSync(join(withWorker, 'althar-worker')).mode & 0o777).toBe(0o700)
    await expect(assembleBundle({ entry, node, version: '1.2.3' }, destination)).rejects.toThrow()
    await expect(
      assembleBundle({ entry, node, version: '1.2.3', license: join(root, 'missing-license') }, join(temporary(), 'release')),
    ).rejects.toThrow()
  })
  it('assembles a worker’s own release with its native program, its commands, its agents and its tools, and none of the home', async () => {
    const root = temporary()
    const entry = join(root, 'entry.js')
    const node = join(root, 'node/bin/node')
    mkdirSync(join(root, 'node/bin'), { recursive: true })
    writeFileSync(entry, 'host code')
    writeFileSync(join(root, 'LICENSE'), 'Host license')
    writeFileSync(join(root, 'THIRD_PARTY_NOTICES.txt'), 'Bundled notices')
    mkdirSync(join(root, 'worker'))
    const workerEntry = join(root, 'worker', 'althar-worker.js')
    writeFileSync(workerEntry, 'worker commands')
    writeFileSync(join(root, 'worker', 'LICENSE'), 'Worker license')
    writeFileSync(join(root, 'worker', 'THIRD_PARTY_NOTICES.txt'), 'Worker notices')
    writeFileSync(node, 'node binary')
    writeFileSync(join(root, 'node/LICENSE'), 'Node license')
    pkg(root, '@agentclientprotocol/claude-agent-acp')
    pkg(root, '@agentclientprotocol/codex-acp')
    pkg(root, 'sharp')
    writeFileSync(join(root, 'althar-worker'), 'worker binary')
    for (const part of ['bin', 'licenses']) mkdirSync(join(root, 'tools', part), { recursive: true })
    writeFileSync(join(root, 'tools/bin/socat'), 'socat')
    writeFileSync(join(root, 'tools/licenses/socat.COPYING'), 'GPL')
    const source = {
      entry,
      node,
      version: '1.2.3',
      worker: join(root, 'althar-worker'),
      workerTools: join(root, 'tools'),
      workerEntry,
    }
    const destination = join(temporary(), 'release')
    await assembleWorkerBundle(source, destination)
    expect(readFileSync(join(destination, 'dist/althar-worker.js'), 'utf8')).toBe('worker commands')
    expect(readFileSync(join(destination, 'THIRD_PARTY_NOTICES.txt'), 'utf8')).toBe('Worker notices')
    expect(readFileSync(join(destination, 'althar-worker'), 'utf8')).toBe('worker binary')
    expect(readFileSync(join(destination, 'tools/bin/socat'), 'utf8')).toBe('socat')
    expect(readFileSync(join(destination, 'node_modules/@agentclientprotocol/codex-acp/index.js'), 'utf8')).toBe(
      '@agentclientprotocol/codex-acp',
    )
    expect(JSON.parse(readFileSync(join(destination, 'package.json'), 'utf8'))).toMatchObject({ name: '@althar/worker-release' })
    for (const home of ['dist/althar-host.js', 'node_modules/sharp']) expect(existsSync(join(destination, home)), home).toBe(false)
    // Without its native program, its commands or its tools, it isn't a worker's release.
    for (const missing of ['worker', 'workerTools', 'workerEntry'] as const)
      await expect(assembleWorkerBundle({ ...source, [missing]: undefined }, join(temporary(), 'release'))).rejects.toThrow()
  })
  it('retains native optional dependencies and omits unavailable or other-platform variants', async () => {
    const root = temporary()
    const a = pkg(root, 'a')
    writeFileSync(
      join(a, 'package.json'),
      JSON.stringify({ name: 'a', version: '1.0.0', optionalDependencies: { native: '1', musl: '1', absent: '1', foreign: '1' } }),
    )
    const native = pkg(root, 'native')
    writeFileSync(
      join(native, 'package.json'),
      JSON.stringify({ name: 'native', version: '1.0.0', os: [process.platform], cpu: [process.arch], libc: ['glibc'] }),
    )
    const musl = pkg(root, 'musl')
    writeFileSync(join(musl, 'package.json'), JSON.stringify({ name: 'musl', version: '1.0.0', libc: ['musl'] }))
    const foreign = pkg(root, 'foreign')
    writeFileSync(join(foreign, 'package.json'), JSON.stringify({ name: 'foreign', version: '1.0.0', os: [`!${process.platform}`] }))
    const destination = join(temporary(), 'release')
    mkdirSync(destination)
    await copyDependencies(join(root, 'package.json'), destination, ['a'])
    expect(existsSync(join(destination, 'node_modules/native/index.js'))).toBe(true)
    expect(existsSync(join(destination, 'node_modules/musl'))).toBe(false)
    expect(existsSync(join(destination, 'node_modules/foreign'))).toBe(false)
    await expect(copyDependencies(join(root, 'package.json'), join(temporary(), 'failed'), ['musl'])).rejects.toThrow()
  })
  it('copies cycles once, preserves nested version resolution and omits unrelated packages', async () => {
    const root = temporary()
    const a = pkg(root, 'a', { b: '1', shared: '1' })
    pkg(root, 'b', { a: '1' })
    pkg(root, 'shared')
    pkg(root, 'unrelated')
    const c = pkg(root, 'c', { shared: '2' })
    pkg(c, 'shared')
    const destination = join(temporary(), 'release')
    mkdirSync(destination)
    await copyDependencies(join(root, 'package.json'), destination, ['a', 'c'])
    expect(readFileSync(join(destination, 'node_modules/a/index.js'), 'utf8')).toBe('a')
    expect(readFileSync(join(destination, 'node_modules/c/node_modules/shared/index.js'), 'utf8')).toBe('shared')
    const missing = join(temporary(), 'release')
    mkdirSync(missing)
    await expect(copyDependencies(join(a, 'package.json'), missing, ['not-installed'])).rejects.toThrow()
    await expect(copyDependencies(join(root, 'package.json'), missing, ['../unsafe'])).rejects.toThrow()
  })

  it('does not copy a dependency symlink that escapes its own package', async () => {
    const root = temporary()
    const a = pkg(root, 'a')
    const secret = join(root, 'private-key')
    writeFileSync(secret, 'must stay here')
    symlinkSync(secret, join(a, 'escape'))
    const destination = join(temporary(), 'release')
    mkdirSync(destination)
    await expect(copyDependencies(join(root, 'package.json'), destination, ['a'])).rejects.toThrow()
  })

  it('accepts a public readable trust key but refuses writable, linked, missing or oversized inputs', async () => {
    const root = temporary()
    const key = join(root, 'release.pub')
    const publicKey = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString()
    writeFileSync(key, publicKey, { mode: 0o644 })
    expect(await readReleaseKey(key)).toBe(publicKey)
    chmodSync(key, 0o666)
    await expect(readReleaseKey(key)).rejects.toThrow()
    chmodSync(key, 0o644)
    symlinkSync(key, join(root, 'link'))
    await expect(readReleaseKey(join(root, 'link'))).rejects.toThrow()
    await expect(readReleaseKey(join(root, 'missing'))).rejects.toThrow()
    writeFileSync(key, 'x'.repeat(4097))
    await expect(readReleaseKey(key)).rejects.toThrow()
  })
})
