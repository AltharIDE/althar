/**
 * Which other tasks a piece of work runs into, before it becomes a merge conflict. A plan names the repositories and
 * paths it expects to touch; a running task has the files it changed. Two outlines overlap where they share a file, a
 * folder one of them names, or a folder near the top of a repository; knowing only the repository is the weakest kind.
 */

export interface Touch {
  /** The project's repository binding. */
  readonly repository: string
  /** Files changed, or files and folders a plan names (a folder ends in `/`). Empty: somewhere in the repository. */
  readonly paths: ReadonlyArray<string>
}

export interface Outline {
  readonly task: string
  readonly owner: string
  readonly touches: ReadonlyArray<Touch>
}

export type Strength = 'same_files' | 'same_folder' | 'same_repository'

export interface Overlap {
  readonly task: string
  readonly owner: string
  readonly repository: string
  readonly strength: Strength
  /** The paths, from both sides, that meet. */
  readonly paths: ReadonlyArray<string>
}

const rank: Record<Strength, number> = { same_files: 0, same_folder: 1, same_repository: 2 }

const clean = (path: string): string => path.replace(/^\.?\/+/, '')

/** A path names the other, or a folder holding it. */
const meets = (a: string, b: string): boolean => {
  const [x, y] = [clean(a), clean(b)]
  if (x === y) return true
  return (x.endsWith('/') && y.startsWith(x)) || (y.endsWith('/') && x.startsWith(y))
}

const folderOf = (path: string, depth: number): string | undefined => {
  const parts = clean(path)
    .split('/')
    .filter((part) => part !== '')
  // A file directly in a folder of that depth or shallower has no folder at that depth to share.
  const folders = clean(path).endsWith('/') ? parts : parts.slice(0, -1)
  return folders.length >= depth ? folders.slice(0, depth).join('/') : undefined
}

const strongest = (mine: Touch, theirs: Touch, depth: number): { strength: Strength; paths: Array<string> } => {
  if (mine.paths.length === 0 || theirs.paths.length === 0) return { strength: 'same_repository', paths: [] }
  const files = new Set<string>()
  for (const a of mine.paths) for (const b of theirs.paths) if (meets(a, b)) files.add(clean(a)).add(clean(b))
  if (files.size > 0) return { strength: 'same_files', paths: [...files].sort() }
  const folders = new Set<string>()
  const theirFolders = new Set(theirs.paths.map((path) => folderOf(path, depth)).filter((folder) => folder !== undefined))
  for (const path of mine.paths) {
    const folder = folderOf(path, depth)
    if (folder !== undefined && theirFolders.has(folder)) folders.add(`${folder}/`)
  }
  if (folders.size > 0) return { strength: 'same_folder', paths: [...folders].sort() }
  return { strength: 'same_repository', paths: [] }
}

/**
 * The overlaps of one outline with others, strongest first. Two tasks in the same repository that touch far apart
 * folders don't overlap; two that only say the repository do, weakly.
 */
export const overlaps = (
  mine: Outline,
  others: ReadonlyArray<Outline>,
  options: { readonly folderDepth?: number } = {},
): ReadonlyArray<Overlap> => {
  const depth = options.folderDepth ?? 2
  const found: Array<Overlap> = []
  for (const other of others) {
    if (other.task === mine.task) continue
    for (const touch of mine.touches)
      for (const theirs of other.touches) {
        if (theirs.repository !== touch.repository) continue
        const met = strongest(touch, theirs, depth)
        const unknown = touch.paths.length === 0 || theirs.paths.length === 0
        if (met.strength === 'same_repository' && !unknown) continue
        found.push({ task: other.task, owner: other.owner, repository: touch.repository, ...met })
      }
  }
  // One entry per task and repository, its strongest.
  const best = new Map<string, Overlap>()
  for (const overlap of found) {
    const key = `${overlap.task}\u0000${overlap.repository}`
    const held = best.get(key)
    if (held === undefined || rank[overlap.strength] < rank[held.strength]) best.set(key, overlap)
  }
  return [...best.values()].sort((a, b) => rank[a.strength] - rank[b.strength] || a.task.localeCompare(b.task))
}
