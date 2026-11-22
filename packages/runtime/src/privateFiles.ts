import { constants } from 'node:fs'
import * as fs from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { dirname, parse, resolve } from 'node:path'

export const fileErrorCode = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : undefined

export class PrivateFileError extends Error {
  constructor(
    readonly code: 'UnsafePermissions' | 'NotInitialized' | 'CorruptVault',
    message: string,
  ) {
    super(message)
  }
}

const unsafe = () =>
  new PrivateFileError(
    'UnsafePermissions',
    'Host files must be owned by this user, private, and regular files or directories, without symbolic links.',
  )
const owned = (uid: number) => process.getuid === undefined || uid === process.getuid()

/** Only the final directory is tightened; never change permissions on an operator's ancestor directories. */
export const privateDirectory = async (path: string, create = false): Promise<string> => {
  try {
    // An operator running as root must never tighten / when given a profile,
    // worktree directory or key parent at the filesystem root.
    if (create && resolve(path) === parse(resolve(path)).root) throw unsafe()
    if (create) await fs.mkdir(path, { recursive: true, mode: 0o700 })
    const stat = await fs.lstat(path)
    if (!stat.isDirectory() || stat.isSymbolicLink() || !owned(stat.uid)) throw unsafe()
    if (create) await fs.chmod(path, 0o700)
    else if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) throw unsafe()
    return await fs.realpath(path)
  } catch (error) {
    if (fileErrorCode(error) === 'ENOENT') throw new PrivateFileError('NotInitialized', 'The private host directory does not exist.')
    throw error
  }
}

/** Reads at most maximum+1 bytes, even if the file grows after stat. Never follows a substituted link. */
export const readPrivate = async (path: string, maximum: number, links: boolean | 'snapshot' = false): Promise<Buffer | null> => {
  let handle: fs.FileHandle | undefined
  try {
    handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const stat = await handle.stat()
    if (process.platform === 'win32') {
      const named = await fs.lstat(path)
      if (named.isSymbolicLink() || stat.dev !== named.dev || stat.ino !== named.ino) throw unsafe()
    }
    // A published snapshot can be replaced after open. The old descriptor
    // still holds the complete, private file even when its last name is gone.
    const unexpectedLinks = links === 'snapshot' ? stat.nlink > 1 : links && stat.nlink !== 1
    if (!stat.isFile() || !owned(stat.uid) || (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) || unexpectedLinks) throw unsafe()
    if (stat.size > maximum) throw new PrivateFileError('CorruptVault', 'A private host file exceeds its size limit.')
    const buffer = Buffer.alloc(maximum + 1)
    let length = 0
    while (length < buffer.length) {
      const part = await handle.read(buffer, length, buffer.length - length, null)
      if (part.bytesRead === 0) break
      length += part.bytesRead
    }
    if (length > maximum) throw new PrivateFileError('CorruptVault', 'A private host file exceeds its size limit.')
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
  let created = true
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
        if (fileErrorCode(error) === 'EEXIST') created = false
        else throw error
      }
      await fs.unlink(temporary)
    }
    await syncDirectory(dirname(path))
    // A previous attempt may have published successfully but failed its directory
    // sync. Re-establish durability even when creation finds the destination there.
    return created
  } finally {
    await handle?.close().catch(() => undefined)
    await fs.rm(temporary, { force: true }).catch(() => undefined)
  }
}

export const removePrivate = async (path: string, maximum: number) => {
  if ((await readPrivate(path, maximum)) !== null) await fs.unlink(path)
  // A retry after a failed sync sees an absent file; it still owes the barrier.
  try {
    await syncDirectory(dirname(path))
  } catch (error) {
    if (fileErrorCode(error) !== 'ENOENT') throw error
  }
}
