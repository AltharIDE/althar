import { createHash } from 'node:crypto'

/** A skill's files by relative path (forward slashes). */
export type Files = ReadonlyMap<string, Uint8Array>

export const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

/** Each file's hash, in path order. */
export const fileHashes = (files: Files): Record<string, string> =>
  Object.fromEntries([...files.keys()].toSorted().map((path) => [path, sha256(files.get(path)!)]))

/** One hash for the whole tree: the same files give the same hash whatever order they were read in. */
export const treeHash = (files: Files): string => {
  const hash = createHash('sha256')
  for (const [path, digest] of Object.entries(fileHashes(files))) hash.update(`${path}\0${digest}\n`)
  return hash.digest('hex')
}
