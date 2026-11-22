import { lstat, open } from 'node:fs/promises'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { readApprovalKeys } from '../src/approvalKeys'

vi.mock('node:fs/promises', async (original) => ({
  ...(await original<typeof import('node:fs/promises')>()),
  lstat: vi.fn(),
  open: vi.fn(),
}))

const origin = 'https://home.example:6769'
const path = '/etc/althar/approvals.json'
const manifest = { version: 1, homeId: 'home_' + '1'.repeat(32), origin, credentials: [] }
const directory = { uid: 0, mode: 0o755, isDirectory: () => true }
const file = { uid: 0, mode: 0o644, size: 200, isFile: () => true }
const handle = { stat: vi.fn(), readFile: vi.fn(), close: vi.fn() }

beforeEach(() => {
  vi.resetAllMocks()
  // Model ownership returned by Linux independently of the UID running the test.
  vi.mocked(lstat).mockResolvedValue(directory as Awaited<ReturnType<typeof lstat>>)
  vi.mocked(open).mockResolvedValue(handle as unknown as Awaited<ReturnType<typeof open>>)
  handle.stat.mockResolvedValue(file)
  handle.readFile.mockResolvedValue(Buffer.from(JSON.stringify(manifest)))
  handle.close.mockResolvedValue(undefined)
})

describe('the administrator’s approval keys', () => {
  it('reads the manifest only from a protected path and matches the complete network origin', async () => {
    expect(await readApprovalKeys(path, origin)).toEqual(manifest)
    expect(vi.mocked(lstat).mock.calls.map(([path]) => path)).toEqual(['/etc/althar', '/etc', '/'])
    await expect(readApprovalKeys(path, 'https://other.example:6769')).rejects.toMatchObject({ code: 'InvalidConfig' })
    expect(handle.close).toHaveBeenCalledTimes(2)
  })

  it('rejects a relative path, a symlink ancestor or an ancestor writable by a project user', async () => {
    await expect(readApprovalKeys('approvals.json', origin)).rejects.toMatchObject({ code: 'InvalidConfig' })
    await expect(readApprovalKeys('/etc/../approvals.json', origin)).rejects.toMatchObject({ code: 'InvalidConfig' })
    vi.mocked(lstat).mockResolvedValueOnce({ ...directory, isDirectory: () => false } as Awaited<ReturnType<typeof lstat>>)
    await expect(readApprovalKeys(path, origin)).rejects.toMatchObject({ code: 'InvalidConfig' })
    vi.mocked(lstat).mockResolvedValueOnce({ ...directory, uid: 1000 } as Awaited<ReturnType<typeof lstat>>)
    await expect(readApprovalKeys(path, origin)).rejects.toMatchObject({ code: 'InvalidConfig' })
    vi.mocked(lstat).mockResolvedValueOnce({ ...directory, mode: 0o775 } as Awaited<ReturnType<typeof lstat>>)
    await expect(readApprovalKeys(path, origin)).rejects.toMatchObject({ code: 'InvalidConfig' })
    expect(open).not.toHaveBeenCalled()
  })

  it('checks ownership, file type, size and content again on the opened file', async () => {
    for (const changed of [{ uid: 1000 }, { mode: 0o666 }, { size: 4_000_000 }, { isFile: () => false }]) {
      handle.stat.mockResolvedValueOnce({ ...file, ...changed })
      await expect(readApprovalKeys(path, origin)).rejects.toMatchObject({ code: 'InvalidConfig' })
    }
    handle.readFile.mockResolvedValueOnce(Buffer.alloc(400_000))
    await expect(readApprovalKeys(path, origin)).rejects.toMatchObject({ code: 'InvalidConfig' })
    handle.readFile.mockResolvedValueOnce(Buffer.from('{'))
    await expect(readApprovalKeys(path, origin)).rejects.toMatchObject({ code: 'InvalidConfig' })
    expect(handle.close).toHaveBeenCalledTimes(6)
  })
})
