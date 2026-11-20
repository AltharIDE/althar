/** A repo path as a finding or a diff names it: forward slashes, no leading `./` or `/`. */
export const repoPath = (path: string): string => path.replace(/\\/g, '/').replace(/^(?:\.?\/)+/, '')

/**
 * Whether a changed file is one a finding named. Paths compare exactly as repo-relative paths: a finding located
 * only as `index.ts` names the root's `index.ts` and no same-named file in another directory.
 */
export const namedByFindings = (named: ReadonlyArray<string>, path: string): boolean => {
  const wanted = repoPath(path)
  return named.some((file) => repoPath(file) === wanted)
}
