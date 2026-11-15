/*
 * Where a path gives way. A path is its folders then what it ends with (a
 * file's name, or the last folder of a folder); a narrow room takes whole
 * folders off its start, "…/tests/Coordinator.test.ts", and never a part of
 * a name. The widths are what the browser drew, so this holds for any font.
 */

/** The marks a path is shown with where folders were dropped. */
export const ELLIPSIS = '…/'

export interface PathParts {
  /** The folders in front, each with its slash: ["packages/", "runtime/"]. */
  folders: string[]
  /** What the path ends with: "Coordinator.ts", or for a folder "src/". */
  end: string
}

/** A path in its folders and its end: a trailing slash makes the last folder the end. */
export function partsOf(path: string): PathParts {
  const body = path.endsWith('/') && path.length > 1 ? path.slice(0, -1) : path
  const at = body.lastIndexOf('/') + 1
  return { folders: body.slice(0, at).match(/[^/]*\//g) ?? [], end: path.slice(at) }
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
