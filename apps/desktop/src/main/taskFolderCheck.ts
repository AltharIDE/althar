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
  portal: 'That folder comes through the sandbox’s file portal, which task folders can’t use yet; choose one in your home folder.',
  kept: 'That folder is inside one Althar already keeps task folders in; choose another.',
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

/**
 * The folder task folders are made in, for a pick: always one of Althar's own inside it, even where the pick is named Althar, as Althar
 * clears runs and keeps the coordinator's copies in every folder of the root, and a folder of the person's own may be among them.
 */
export const taskRootIn = (picked: string): string => join(picked, ROOT_NAME)
const ROOT_NAME = 'Althar'

/** What Althar writes in a root it made, so a later pick inside it is known for one. */
export const ROOT_MARKER = '.althar-task-folders'

/** Whether `folder` is, or is inside, a root Althar made. */
const insideRoot = (folder: string, disk: Disk): boolean => {
  for (let at = disk.real(folder); ; at = dirname(at)) {
    if (disk.exists(join(at, ROOT_MARKER))) return true
    if (dirname(at) === at) return false
  }
}

/** Why a pick can't be used at all, before the folder of Althar's own is made in it: a portal path, or any refusal of `refusalOf`. */
export const taskFolderRefusal = (picked: string, profile: string, disk: Disk = onDisk, home: string = homedir()): string | null =>
  /^\/run\/flatpak\/doc(\/|$)/.test(picked)
    ? refusals.portal
    : (refusalOf(picked, profile, disk, home) ?? (insideRoot(picked, disk) ? refusals.kept : null))

/**
 * What it means that the folder the person chose can't be used now, in a line: what has happened, what it stops (new tasks are made in
 * `fallback` meanwhile) and the way out. `refusal` is why `refusalOf` refuses it.
 */
export const statusOf = (folder: string, refusal: string, fallback: string): string => {
  const what =
    refusal === refusals.missing
      ? `Althar can’t find ${folder}, perhaps a drive that isn’t connected`
      : refusal === refusals.readOnly
        ? `Althar can’t write to ${folder} any more`
        : `${folder} can’t hold task folders now`
  return `${what}, so new tasks are made in ${fallback} for now. Reconnect it, choose another folder, or use the default.`
}
