import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'

/*
 * What names a set of revisions in a repository stand on, as a stamp: the
 * files git reads them from, each by its inode, size and time, and what
 * HEAD and any symbolic ref says. Git writes a ref, HEAD and packed-refs by
 * renaming a new file over the old, so any change gives a new stamp, and an
 * answer kept under a stamp holds until it changes (git.ts `commitsOf`, which
 * the board, the home and a task's view ask for each of their worktrees on
 * every read). A commit named by its id stands on the objects it could be
 * among. Where Althar can't tell what a name stands on, as for an expression
 * (`HEAD~1`), a reftable, or objects borrowed from another repository, there
 * is no stamp, and git is asked each time.
 */

/** A plain ref's name as git reads it from a file: no expression, no `..`, nothing outside the ref folders. */
const NAME = /^(?!.*\.\.)(?!\/)[A-Za-z0-9._/-]+$/

/** A commit's id, which the objects alone answer for. */
const ID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/

/** Where git keeps a repository's own files and those its worktrees share: the same folder for the main worktree. */
interface Dirs {
  readonly git: string
  readonly common: string
}

const statOf = async (path: string) => {
  try {
    const found = await stat(path, { bigint: true })
    return `${found.ino}:${found.size}:${found.mtimeNs}`
  } catch {
    return '-'
  }
}

const textOf = async (path: string) => {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return undefined
  }
}

/** The folders git reads a worktree's refs from, from its `.git`; none where it isn't a repository Althar can read so. */
const dirsOf = async (cwd: string): Promise<Dirs | undefined> => {
  const dotGit = join(cwd, '.git')
  const pointer = await textOf(dotGit)
  const git =
    pointer === undefined
      ? (await statOf(join(dotGit, 'HEAD'))) === '-'
        ? undefined
        : dotGit
      : /^gitdir: (.+)$/m.exec(pointer)?.[1]?.trim()
  if (git === undefined) return undefined
  const gitDir = isAbsolute(git) ? git : resolve(cwd, git)
  const commonFile = await textOf(join(gitDir, 'commondir'))
  const common = commonFile === undefined ? gitDir : resolve(gitDir, commonFile.trim())
  return { git: gitDir, common }
}

/** Every file a ref's name could be read from, as git looks for it, in the worktree's folder and the shared one. */
const candidates = (dirs: Dirs, name: string) => {
  const forms = [name, `refs/${name}`, `refs/tags/${name}`, `refs/heads/${name}`, `refs/remotes/${name}`, `refs/remotes/${name}/HEAD`]
  return [...new Set([dirs.git, dirs.common])].flatMap((dir) => forms.map((form) => join(dir, form)))
}

/**
 * The stamp the revisions stand on in `cwd`, or none where Althar can't tell: the same stamp later means git would answer
 * the same.
 */
export const refStamp = async (cwd: string, revisions: ReadonlyArray<string>): Promise<string | undefined> => {
  const dirs = await dirsOf(cwd)
  if (dirs === undefined) return undefined
  // Refs kept in a reftable, or objects borrowed from elsewhere, aren't read from files Althar can stamp.
  const [reftable, alternates] = await Promise.all([
    statOf(join(dirs.common, 'reftable')),
    statOf(join(dirs.common, 'objects/info/alternates')),
  ])
  if (reftable !== '-' || alternates !== '-') return undefined
  const parts: Array<string> = [`git ${dirs.git} ${dirs.common}`, `packed ${await statOf(join(dirs.common, 'packed-refs'))}`]
  const seen = new Set<string>()
  const named: Array<string> = []
  for (const revision of revisions) {
    if (revision === '') continue
    if (ID.test(revision)) {
      // A commit by its id is there or not by the objects: a fetch brings a pack or loose objects, and changes these.
      parts.push(
        `id ${revision} ${await statOf(join(dirs.common, 'objects/pack'))} ${await statOf(join(dirs.common, 'objects', revision.slice(0, 2)))}`,
      )
      continue
    }
    if (!NAME.test(revision)) return undefined
    named.push(revision)
  }
  // Each name's files, and where a symbolic ref among them points, followed a few steps.
  for (let depth = 0; named.length > 0 && depth < 5; depth += 1) {
    const now = named.splice(0)
    for (const name of now) {
      if (seen.has(name)) continue
      seen.add(name)
      for (const path of candidates(dirs, name)) {
        const found = await statOf(path)
        parts.push(`${path} ${found}`)
        if (found === '-') continue
        const text = await textOf(path)
        if (text === undefined) continue
        parts.push(`= ${text.trim()}`)
        const target = /^ref: (.+)$/.exec(text.trim())?.[1]
        if (target !== undefined && NAME.test(target)) named.push(target)
      }
    }
  }
  return named.length > 0 ? undefined : parts.join('\n')
}
