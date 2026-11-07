import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

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

const read = (file: string): string | null => {
  try {
    return readFileSync(file, 'utf8').trim()
  } catch {
    return null
  }
}

/** The git directory a repository's worktrees share, from its main checkout: its `.git`, or what a `.git` file names, through its `commondir`. */
const commonDirOf = (root: string): string | null => {
  const dotGit = join(root, '.git')
  try {
    if (lstatSync(dotGit).isDirectory()) return dotGit
  } catch {
    return null
  }
  const named = /^gitdir:\s*(.+?)\s*$/m.exec(read(dotGit) ?? '')?.[1]
  if (named === undefined) return null
  const gitdir = resolve(root, named)
  const common = read(join(gitdir, 'commondir'))
  return common === null ? gitdir : resolve(gitdir, common)
}

/** The worktree a repository's record of one names, by its `gitdir` file: that worktree's `.git`. Null where it names none. */
const namedBy = (record: string): string | null => {
  const back = read(join(record, 'gitdir'))
  return back === null || back === '' ? null : resolve(record, back)
}

/**
 * The record in a repository that `git worktree repair` joins a broken
 * folder to: one whose `gitdir` names this folder, which git puts right
 * first; else the git directory its `.git` names, where that is there; else
 * the record by that git directory's name, which git infers it by. Null
 * where there is none, and git has nothing to join it to.
 */
const recordFor = (folder: string, link: Link, common: string): string | null => {
  const records = join(common, 'worktrees')
  let names: ReadonlyArray<string>
  try {
    names = readdirSync(records)
  } catch {
    names = []
  }
  const dotGit = join(folder, '.git')
  const own = names
    .map((name) => join(records, name))
    .find((record) => {
      const named = namedBy(record)
      return named !== null && same(named, dotGit)
    })
  if (own !== undefined) return own
  if (link.state !== 'broken' || link.gitdir === null) return null
  if (existsSync(join(link.gitdir, 'HEAD'))) return link.gitdir
  const byName = join(records, basename(link.gitdir))
  return existsSync(join(byName, 'HEAD')) ? byName : null
}

/** Why repairing a broken folder would take a record that is another's: the folder that has it, or the branch it is on. */
export type Taken = { readonly folder: string } | { readonly branch: string }

/**
 * Whether repairing a broken folder would join it to a record in its
 * repository that is another worktree's. Git names a repository's records
 * of its worktrees by their folders' names, and every task's worktree of a
 * repository has the same name, so they are `<name>`, `<name>1`, …; a prune
 * frees the name of one whose folder moved, and the next worktree made takes
 * it. A moved folder's `.git` then names another task's record, and git's
 * repair would point that record at it, with the other task's HEAD, branch
 * and index. A record is this folder's to take where it names this folder,
 * or a place whose folder isn't there (a folder that is there, its `.git`
 * gone or not, is another's, which a detached review's copy has no branch
 * to tell apart), and where `branch` says which branch the
 * folder is on, if it is on one, the record isn't on another; a review's
 * copy, which never is on a branch, is `branch` `false`. Null where the
 * record is free, or there is none.
 */
export const takenFrom = (folder: string, link: Link, root: string, branch: string | false | null): Taken | null => {
  const common = commonDirOf(root)
  if (common === null) return null
  const record = recordFor(folder, link, common)
  if (record === null) return null
  const named = namedBy(record)
  const owner = named === null ? null : dirname(named)
  if (owner !== null && !same(owner, folder) && existsSync(owner)) return { folder: owner }
  const on = /^ref:\s*refs\/heads\/(.+)$/.exec(read(join(record, 'HEAD')) ?? '')?.[1]
  if (on !== undefined && branch !== null && on !== branch) return { branch: on }
  return null
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
