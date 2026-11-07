import { accessSync, constants, existsSync, realpathSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative } from 'node:path'

/*
 * Whether a folder the person chose can hold task folders: it must exist and
 * be writable, not be inside a repository's checkout (a task's worktree
 * there would sit inside another repository), and not be inside Althar's
 * profile (which Althar owns and cleans up). A refusal is one line the
 * person reads.
 */

export interface Disk {
  readonly isDirectory: (path: string) => boolean
  readonly writable: (path: string) => boolean
  readonly exists: (path: string) => boolean
  /** The path with links resolved; as it is where it can't be. */
  readonly real: (path: string) => string
}

export const onDisk: Disk = {
  isDirectory: (path) => {
    try {
      return statSync(path).isDirectory()
    } catch {
      return false
    }
  },
  writable: (path) => {
    try {
      accessSync(path, constants.W_OK | constants.X_OK)
      return true
    } catch {
      return false
    }
  },
  exists: existsSync,
  real: (path) => {
    try {
      return realpathSync(path)
    } catch {
      return path
    }
  },
}

export const refusals = {
  relative: 'Choose a full path.',
  missing: 'That folder doesn’t exist.',
  readOnly: 'Althar can’t write to that folder.',
  repository: 'That folder is inside a repository; choose one outside any checkout.',
  profile: 'That folder is inside Althar’s own data; choose another.',
}

const inside = (folder: string, parent: string) => {
  const way = relative(parent, folder)
  return way === '' || (!way.startsWith('..') && !isAbsolute(way))
}

/** Why `folder` can't hold task folders, in a line; null where it can. */
export const refusalOf = (folder: string, profile: string, disk: Disk = onDisk): string | null => {
  if (!isAbsolute(folder)) return refusals.relative
  if (!disk.isDirectory(folder)) return refusals.missing
  if (!disk.writable(folder)) return refusals.readOnly
  const real = disk.real(folder)
  if (inside(real, disk.real(profile))) return refusals.profile
  // A checkout has a .git (a folder, or a file in a worktree) in it or above it.
  for (let at = real; ; at = dirname(at)) {
    if (disk.exists(join(at, '.git'))) return refusals.repository
    if (dirname(at) === at) break
  }
  return null
}
