import { accessSync, constants, existsSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative } from 'node:path'

import { TOOLCHAINS } from '@althar/runtime/locations'

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
  toolchain: 'That folder is inside a toolchain’s folder (such as ~/.bun); choose another.',
  profile: 'That folder is inside Althar’s own data; choose another.',
}

const inside = (folder: string, parent: string) => {
  const way = relative(parent, folder)
  return way === '' || (!way.startsWith('..') && !isAbsolute(way))
}

/** Why `folder` can't hold task folders, in a line; null where it can. */
export const refusalOf = (folder: string, profile: string, disk: Disk = onDisk, home: string = homedir()): string | null => {
  if (!isAbsolute(folder)) return refusals.relative
  if (!disk.isDirectory(folder)) return refusals.missing
  if (!disk.writable(folder)) return refusals.readOnly
  const real = disk.real(folder)
  if (inside(real, disk.real(profile))) return refusals.profile
  // The coordinator may read the toolchains in home, and a task folder there would be read with them.
  if (TOOLCHAINS.some((toolchain) => inside(real, disk.real(join(home, toolchain))))) return refusals.toolchain
  // A checkout has a .git (a folder, or a file in a worktree) in it or above it.
  for (let at = real; ; at = dirname(at)) {
    if (disk.exists(join(at, '.git'))) return refusals.repository
    if (dirname(at) === at) break
  }
  return null
}
