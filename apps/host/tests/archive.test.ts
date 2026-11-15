import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { c, Header } from 'tar'
import { describe, expect, it } from 'vitest'

import { extractRelease, inspectArchive } from '../src/updates/archive'
import { temporary } from './support'

const raw = (
  path: string,
  entries: ReadonlyArray<{ path: string; type?: 'File' | 'Directory' | 'SymbolicLink'; text?: string; linkpath?: string; mode?: number }>,
) => {
  const blocks: Uint8Array[] = []
  for (const entry of entries) {
    const bytes = Buffer.from(entry.text ?? '')
    const header = new Header({
      path: entry.path,
      type: entry.type ?? 'File',
      size: bytes.length,
      mode: entry.mode ?? 0o600,
      ...(entry.linkpath === undefined ? {} : { linkpath: entry.linkpath }),
    })
    header.encode()
    if (header.block === undefined) throw new Error('No tar header')
    blocks.push(header.block, bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512))
  }
  blocks.push(Buffer.alloc(1024))
  writeFileSync(path, Buffer.concat(blocks), { mode: 0o600 })
}

describe('private host release extraction', () => {
  it('validates, extracts and durably publishes regular files with private executable modes', async () => {
    const root = temporary()
    const source = join(root, 'source')
    mkdirSync(source)
    mkdirSync(join(source, 'dist'))
    writeFileSync(join(source, 'dist/app.js'), 'app')
    writeFileSync(join(source, 'node'), 'node', { mode: 0o755 })
    const archive = join(root, 'release.tar.gz')
    await c({ file: archive, cwd: source, gzip: true, portable: true, noMtime: true }, ['dist', 'node'])
    const destination = join(root, 'stage')
    await extractRelease(archive, destination, { files: 2, unpackedBytes: 7 })
    expect(readFileSync(join(destination, 'dist/app.js'), 'utf8')).toBe('app')
    await expect(extractRelease(archive, destination, { files: 2, unpackedBytes: 7 })).rejects.toMatchObject({ code: 'ReleaseRejected' })
  })

  it('rejects traversal, links, duplicates, path collisions, special modes and dishonest inventories before extraction', async () => {
    const root = temporary()
    const archive = join(root, 'release.tar')
    for (const entries of [
      [{ path: '../escape', text: 'x' }],
      [{ path: '/absolute', text: 'x' }],
      [{ path: 'a\\b', text: 'x' }],
      [{ path: 'bad\nname', text: 'x' }],
      [{ path: 'link', type: 'SymbolicLink' as const, linkpath: '../escape' }],
      [
        { path: 'a', text: 'x' },
        { path: 'a', text: 'x' },
      ],
      [
        { path: 'a', text: 'x' },
        { path: 'a/b', text: 'x' },
      ],
      [
        { path: 'a/b', text: 'x' },
        { path: 'a', text: 'x' },
      ],
      [{ path: 'privileged', text: 'x', mode: 0o4600 }],
    ]) {
      raw(archive, entries)
      const destination = join(root, 'unwritten')
      await expect(extractRelease(archive, destination, { files: 2, unpackedBytes: 2 })).rejects.toMatchObject({ code: 'ReleaseRejected' })
      expect(existsSync(destination)).toBe(false)
    }
    raw(archive, [{ path: 'a', text: 'large' }])
    await expect(inspectArchive(archive, { files: 1, unpackedBytes: 1 })).rejects.toThrow()
    await expect(inspectArchive(archive, { files: 2, unpackedBytes: 5 })).rejects.toThrow()
    writeFileSync(archive, 'malformed tar')
    await expect(inspectArchive(archive, { files: 1, unpackedBytes: 1 })).rejects.toThrow()
  })

  it('handles cancellation and refuses symlinked archive files', async () => {
    const root = temporary()
    const archive = join(root, 'release.tar')
    raw(archive, [{ path: 'a', text: 'x' }])
    const stop = new AbortController()
    stop.abort()
    await expect(inspectArchive(archive, { files: 1, unpackedBytes: 1 }, stop.signal)).rejects.toThrow()
    symlinkSync(archive, join(root, 'linked.tar'))
    await expect(inspectArchive(join(root, 'linked.tar'), { files: 1, unpackedBytes: 1 })).rejects.toThrow()
    expect(readdirSync(root).sort()).toEqual(['linked.tar', 'release.tar'])
  })
})
