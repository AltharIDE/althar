import { execFileSync } from 'node:child_process'
import { chmodSync, linkSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, parse } from 'node:path'

import { describe, expect, it } from 'vitest'

import { privateDirectory, readPrivate, removePrivate, writePrivate } from '../src/privateFiles'
import { temporary } from './support'

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
