import { execFileSync } from 'node:child_process'
import { chmodSync, linkSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import { join, parse } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { privateDirectory, readPrivate, removePrivate, writePrivate } from '../src/privateFiles'
import { temporary } from './support'

vi.mock(import('node:fs/promises'), async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, open: vi.fn(actual.open) }
})

describe('private durable host files', () => {
  it('publishes a complete private file, never clobbers on creation, replaces atomically and removes idempotently', async () => {
    const root = temporary()
    const file = join(root, 'private')
    expect(await writePrivate(file, 'first', false)).toBe(true)
    expect(await writePrivate(file, 'second', false)).toBe(false)
    expect((await readPrivate(file, 10))?.toString()).toBe('first')
    expect(await writePrivate(file, 'second', true)).toBe(true)
    expect(readFileSync(file, 'utf8')).toBe('second')
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(readdirSync(root)).toEqual(['private'])
    await removePrivate(file, 10)
    await removePrivate(file, 10)
    await removePrivate(join(root, 'missing/file'), 10)
    expect(await readPrivate(file, 10)).toBeNull()
    await expect(writePrivate(join(root, 'missing/file'), 'value', false)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(readdirSync(root)).toEqual([])
  })

  it('tightens only its own directory and refuses non-directories and absent homes', async () => {
    const root = temporary()
    const directory = join(root, 'private')
    await expect(privateDirectory(parse(root).root, true)).rejects.toMatchObject({ code: 'UnsafePermissions' })
    mkdirSync(directory, { mode: 0o755 })
    await privateDirectory(directory, true)
    expect(statSync(directory).mode & 0o777).toBe(0o700)
    const file = join(root, 'file')
    writeFileSync(file, '')
    await expect(privateDirectory(file)).rejects.toMatchObject({ code: 'UnsafePermissions' })
    await expect(privateDirectory(join(root, 'missing'))).rejects.toMatchObject({ code: 'NotInitialized' })
  })

  it.skipIf(process.platform === 'win32')('reads a private checkpoint replaced while its descriptor is open', async () => {
    const root = temporary()
    const checkpoint = join(root, 'setup.json')
    const staged = join(root, 'new.json')
    const original = vi.mocked(fs.open).getMockImplementation()!
    for (const mode of ['snapshot', true] as const) {
      writeFileSync(checkpoint, 'previous', { mode: 0o600 })
      writeFileSync(staged, 'next', { mode: 0o600 })
      vi.mocked(fs.open).mockImplementationOnce(async (...args) => {
        const opened = await original(...args)
        renameSync(staged, checkpoint)
        return opened
      })
      if (mode === 'snapshot') expect((await readPrivate(checkpoint, 10, mode))?.toString()).toBe('previous')
      else await expect(readPrivate(checkpoint, 10, mode)).rejects.toMatchObject({ code: 'UnsafePermissions' })
      expect((await readPrivate(checkpoint, 10, mode))?.toString()).toBe('next')
    }
  })

  it.skipIf(process.platform === 'win32')(
    'rejects exposed files, symlinks, multiply-linked master keys, oversized data and FIFOs without blocking',
    async () => {
      const root = temporary()
      const file = join(root, 'file')
      writeFileSync(file, 'secret', { mode: 0o600 })
      await expect(readPrivate(file, 5)).rejects.toMatchObject({ code: 'CorruptVault' })
      chmodSync(file, 0o644)
      await expect(readPrivate(file, 10)).rejects.toMatchObject({ code: 'UnsafePermissions' })
      chmodSync(file, 0o600)
      linkSync(file, join(root, 'hardlink'))
      await expect(readPrivate(file, 10, true)).rejects.toMatchObject({ code: 'UnsafePermissions' })
      await expect(readPrivate(file, 10, 'snapshot')).rejects.toMatchObject({ code: 'UnsafePermissions' })
      symlinkSync(file, join(root, 'link'))
      await expect(readPrivate(join(root, 'link'), 10)).rejects.toMatchObject({ code: 'UnsafePermissions' })
      symlinkSync(root, join(root, 'directory-link'))
      await expect(privateDirectory(join(root, 'directory-link'))).rejects.toMatchObject({ code: 'UnsafePermissions' })
      chmodSync(root, 0o755)
      await expect(privateDirectory(root)).rejects.toMatchObject({ code: 'UnsafePermissions' })
      chmodSync(root, 0o700)
      execFileSync('mkfifo', [join(root, 'fifo')])
      await expect(readPrivate(join(root, 'fifo'), 10)).rejects.toMatchObject({ code: 'UnsafePermissions' })
      await expect(readPrivate(root, 10)).rejects.toMatchObject({ code: 'UnsafePermissions' })
    },
  )
})
