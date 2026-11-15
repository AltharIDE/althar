import { constants } from 'node:fs'
import * as fs from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { dirname } from 'node:path'

import { fileErrorCode, HostError } from './errors'

const unsafe = () =>
  new HostError({
    code: 'UnsafePermissions',
    message: 'Host files must be owned by this user, private, and regular files or directories, without symbolic links.',
  })
const owned = (uid: number) => process.getuid === undefined || uid === process.getuid()

/** Only the final directory is tightened; never change permissions on an operator's ancestor directories. */
export const privateDirectory = async (path: string, create = false): Promise<string> => {
  try {
    if (create) await fs.mkdir(path, { recursive: true, mode: 0o700 })
    const stat = await fs.lstat(path)
    if (!stat.isDirectory() || stat.isSymbolicLink() || !owned(stat.uid)) throw unsafe()
    if (create) await fs.chmod(path, 0o700)
    else if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) throw unsafe()
    return await fs.realpath(path)
  } catch (error) {
    if (fileErrorCode(error) === 'ENOENT')
      throw new HostError({ code: 'NotInitialized', message: 'This host has not been initialized. Run althar-host init first.' })
    throw error
  }
}

/** Reads at most maximum+1 bytes, even if the file grows after stat. Never follows a substituted link. */
export const readPrivate = async (path: string, maximum: number, singleLink = false): Promise<Buffer | null> => {
  let handle: fs.FileHandle | undefined
  try {
    handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const stat = await handle.stat()
    if (
      !stat.isFile() ||
      !owned(stat.uid) ||
      (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) ||
      (singleLink && stat.nlink !== 1)
    )
      throw unsafe()
    if (stat.size > maximum) throw new HostError({ code: 'CorruptVault', message: 'A private host file exceeds its size limit.' })
    const buffer = Buffer.alloc(maximum + 1)
    let length = 0
    while (length < buffer.length) {
      const part = await handle.read(buffer, length, buffer.length - length, null)
      if (part.bytesRead === 0) break
      length += part.bytesRead
    }
    if (length > maximum) throw new HostError({ code: 'CorruptVault', message: 'A private host file exceeds its size limit.' })
    return buffer.subarray(0, length)
  } catch (error) {
    if (fileErrorCode(error) === 'ENOENT') return null
    if (fileErrorCode(error) === 'ELOOP') throw unsafe()
    throw error
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

const syncDirectory = async (path: string) => {
  if (process.platform === 'win32') return
  const directory = await fs.open(path, constants.O_RDONLY | constants.O_DIRECTORY)
  try {
    await directory.sync()
  } finally {
    await directory.close()
  }
}

/** Fully write and sync before publication. Creating uses link's no-clobber guarantee, never an exists/rename race. */
export const writePrivate = async (path: string, value: Uint8Array | string, replace: boolean): Promise<boolean> => {
  const temporary = `${path}.${randomBytes(12).toString('hex')}.tmp`
  let handle: fs.FileHandle | undefined
  try {
    handle = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    await handle.writeFile(value)
    await handle.sync()
    await handle.close()
    handle = undefined
    if (replace) await fs.rename(temporary, path)
    else {
      try {
        await fs.link(temporary, path)
      } catch (error) {
        if (fileErrorCode(error) === 'EEXIST') return false
        throw error
      }
      await fs.unlink(temporary)
    }
    await syncDirectory(dirname(path))
    return true
  } finally {
    await handle?.close().catch(() => undefined)
    await fs.rm(temporary, { force: true }).catch(() => undefined)
  }
}

export const removePrivate = async (path: string, maximum: number) => {
  if ((await readPrivate(path, maximum)) === null) return
  await fs.unlink(path)
  await syncDirectory(dirname(path))
}
