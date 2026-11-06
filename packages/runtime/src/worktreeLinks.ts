import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/*
 * Whether a linked worktree still reaches its repository, read from the
 * files git keeps, without running git: its `.git` file names the folder in
 * the repository's `.git/worktrees/` that is its git directory, and that
 * folder's `gitdir` file names the worktree's `.git` back. Either path may be
 * relative (`worktree.useRelativePaths`). Moving the repository, the
 * worktrees or the folders above them, as a profile moved from a Flatpak to
 * a native build does, leaves one side naming where things were.
 */

/** Why a worktree's link is broken: its `.git` file names no git directory, one that isn't there, or one whose back-link names another place. */
export type BrokenWhy = 'gitfile' | 'gitdir' | 'back_link'

export type Link =
  /** It reaches its repository, and its repository it. */
  | { readonly state: 'fine' }
  /** Its folder isn't there: nothing to repair here ("its folder isn't on this computer"). */
  | { readonly state: 'missing' }
  /** Not a linked worktree: no `.git`, or a `.git` folder of its own, a repository's main checkout. */
  | { readonly state: 'not_linked' }
  | { readonly state: 'broken'; readonly why: BrokenWhy; readonly gitdir: string | null }

const same = (one: string, other: string) => {
  try {
    return realpathSync(one) === realpathSync(other)
  } catch {
    return resolve(one) === resolve(other)
  }
}

/** The state of the link between a folder and the repository it is a worktree of. */
export const linkOf = (folder: string): Link => {
  if (!existsSync(folder)) return { state: 'missing' }
  const dotGit = join(folder, '.git')
  let file: string
  try {
    if (lstatSync(dotGit).isDirectory()) return { state: 'not_linked' }
    file = readFileSync(dotGit, 'utf8')
  } catch {
    return { state: 'not_linked' }
  }
  const named = /^gitdir:\s*(.+?)\s*$/m.exec(file)?.[1]
  if (named === undefined) return { state: 'broken', why: 'gitfile', gitdir: null }
  const gitdir = resolve(folder, named)
  if (!existsSync(join(gitdir, 'HEAD'))) return { state: 'broken', why: 'gitdir', gitdir }
  // A submodule's git directory names no worktree back; a worktree's does.
  const backFile = join(gitdir, 'gitdir')
  if (!existsSync(backFile)) return { state: 'fine' }
  let back: string
  try {
    back = readFileSync(backFile, 'utf8').trim()
  } catch {
    return { state: 'broken', why: 'back_link', gitdir }
  }
  return back !== '' && same(resolve(gitdir, back), dotGit) ? { state: 'fine' } : { state: 'broken', why: 'back_link', gitdir }
}

/**
 * The worktree a folder is in, at or above it but not above `within`: the
 * nearest folder with a `.git` in it. Null where there is none.
 */
export const worktreeAt = (folder: string, within: string): string | null => {
  const top = resolve(within)
  let at = resolve(folder)
  for (;;) {
    if (existsSync(join(at, '.git'))) return at
    if (at === top || !at.startsWith(`${top}`)) return null
    const up = dirname(at)
    if (up === at) return null
    at = up
  }
}

/** What git says when it can't open a worktree for its link, whichever side of it broke. */
export const BROKEN_LINK =
  /gitfile does not point to a valid repository|invalid gitfile format|not a git repository|\.git file broken|unable to locate repository|gitdir (?:incorrect|unreadable|file points to non-existent location)/i
