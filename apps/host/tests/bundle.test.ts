import { generateKeyPairSync } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { copyDependencies, readReleaseKey } from '../src/updates/bundle'
import { temporary } from './support'

const pkg = (root: string, name: string, dependencies: Record<string, string> = {}) => {
  const folder = join(root, 'node_modules', name)
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'package.json'), JSON.stringify({ name, version: '1.0.0', dependencies }))
  writeFileSync(join(folder, 'index.js'), name)
  return folder
}

describe('locked host dependency bundles', () => {
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
