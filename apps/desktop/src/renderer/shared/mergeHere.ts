import type { TaskRepositoryHere } from '@althar/contracts'

/*
 * Merging a task that has no pull request into its repositories' default
 * branches on this Mac: what the button says, and what it sends.
 */

/** The button's words: the branch it merges into, or each one's where they differ. */
export const mergeHereLabel = (here: ReadonlyArray<TaskRepositoryHere>) => {
  const branches = [...new Set(here.map((repository) => repository.branch))]
  return branches.length === 1 ? `Merge into ${branches[0] ?? 'main'}` : 'Merge into each default branch'
}

/** The heads it merges, as last read: none where a repository's branch couldn't be read, which then can't be merged. */
export const headsOf = (here: ReadonlyArray<TaskRepositoryHere>) =>
  here.flatMap((repository) => (repository.head === null ? [] : [{ repository: repository.repository, head: repository.head }]))
