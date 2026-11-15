/*
 * Where a path gives way. A path is its folders then what it ends with (a
 * file's name, or the last folder of a folder); a narrow room takes whole
 * folders off its start, "…/tests/Coordinator.test.ts", and never a part of
 * a name. The widths are what the browser drew, so this holds for any font.
 */

/** The mark a path is shown with where folders were dropped, with the separator its own folders use: "…/", or "…\\" on Windows. */
export const ellipsisOf = (folders: readonly string[]) => `…${folders[0]?.slice(-1) ?? '/'}`

export interface PathParts {
  /** The folders in front, each with its slash: ["packages/", "runtime/"]. */
  folders: string[]
  /** What the path ends with: "Coordinator.ts", or for a folder "src/". */
  end: string
}

/** A Windows path: by its drive or share, or by having backslashes and no forward slash. Elsewhere a backslash is part of a name. */
const isWindows = (path: string) => /^([A-Za-z]:[\\/]|\\\\)/.test(path) || (path.includes('\\') && !path.includes('/'))

/** A path in its folders and its end: a trailing separator makes the last folder the end. A Windows path parts at its backslashes as well as its slashes. */
export function partsOf(path: string): PathParts {
  const separators = isWindows(path) ? '/\\' : '/'
  const body = path.length > 1 && separators.includes(path.slice(-1)) ? path.slice(0, -1) : path
  let at = 0
  for (let i = body.length - 1; i >= 0; i--) {
    if (separators.includes(body[i]!)) {
      at = i + 1
      break
    }
  }
  const folders: string[] = []
  let start = 0
  for (let i = 0; i < at; i++) {
    if (separators.includes(body[i]!)) {
      folders.push(body.slice(start, i + 1))
      start = i + 1
    }
  }
  return { folders, end: path.slice(at) }
}

/**
 * How many folders to drop from the start so the path fits the room: none
 * where it all fits, else the fewest that do, and at most all of them (the
 * end alone, kept with its "…/", is as narrow as a path gets). `folders` are
 * the widths of the folders in front, `end` the width of what it ends with,
 * `ellipsis` the width of "…/".
 */
export function foldersToDrop(folders: readonly number[], end: number, ellipsis: number, room: number): number {
  const slack = 0.5
  let width = end + folders.reduce((sum, one) => sum + one, 0)
  if (width <= room + slack) return 0
  let dropped = 0
  while (dropped < folders.length) {
    width -= folders[dropped]!
    dropped += 1
    if (width + ellipsis <= room + slack) return dropped
  }
  return dropped
}
