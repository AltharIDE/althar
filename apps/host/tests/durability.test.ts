import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { removePrivate, writePrivate } from '../src/privateFiles'
import { temporary } from './support'

const disk = vi.hoisted(() => ({ failDirectorySync: false, completedDirectorySyncs: 0 }))
// Real files and atomic publication, with one injected directory fsync failure:
// a retry must establish durability even when the earlier change is already visible.
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>()
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args)
      if ((await handle.stat()).isDirectory()) {
        const sync = handle.sync.bind(handle)
        handle.sync = async () => {
          if (disk.failDirectorySync) {
            disk.failDirectorySync = false
            throw Object.assign(new Error('Injected disk failure'), { code: 'EIO' })
          }
          await sync()
          disk.completedDirectorySyncs += 1
        }
      }
      return handle
    },
  }
})
beforeEach(() => {
  disk.failDirectorySync = false
  disk.completedDirectorySyncs = 0
})

describe.skipIf(process.platform === 'win32')('recovery after uncertain file durability', () => {
  it('syncs an already-published key on retry without replacing its bytes', async () => {
    const path = join(temporary(), 'master-key')
    disk.failDirectorySync = true
    await expect(writePrivate(path, 'original key', false)).rejects.toMatchObject({ code: 'EIO' })
    expect(readFileSync(path, 'utf8')).toBe('original key')
    const before = disk.completedDirectorySyncs
    expect(await writePrivate(path, 'replacement key', false)).toBe(false)
    expect(readFileSync(path, 'utf8')).toBe('original key')
    expect(disk.completedDirectorySyncs).toBeGreaterThan(before)
  })

  it('syncs an already-absent secret on retry after a failed deletion barrier', async () => {
    const path = join(temporary(), 'secret')
    await writePrivate(path, 'ciphertext', false)
    disk.failDirectorySync = true
    await expect(removePrivate(path, 100)).rejects.toMatchObject({ code: 'EIO' })
    expect(existsSync(path)).toBe(false)
    const before = disk.completedDirectorySyncs
    await removePrivate(path, 100)
    expect(disk.completedDirectorySyncs).toBeGreaterThan(before)
  })
})
