import type { TaskRepositoryHere } from '@althar/contracts'

/*
 * Merging a task's repositories that have no pull request into their default
 * branches on this Mac: what the button says, and what it sends.
 */

/**
 * The button's words: the branch it merges into, or each one's where they
 * differ. Beside a pull request, which merges the rest, it names the
 * repositories it merges.
 */
export const mergeHereLabel = (here: ReadonlyArray<TaskRepositoryHere>, beside = false) => {
  const branches = [...new Set(here.map((repository) => repository.branch))]
  const into = branches.length === 1 ? `into ${branches[0] ?? 'main'}` : 'into each default branch'
  return beside ? `Merge ${here.map((repository) => repository.name).join(' and ')} ${into}` : `Merge ${into}`
}

/** The heads it merges, as last read: none where a repository's branch couldn't be read, which then can't be merged. */
export const headsOf = (here: ReadonlyArray<TaskRepositoryHere>) =>
  here.flatMap((repository) => (repository.head === null ? [] : [{ repository: repository.repository, head: repository.head }]))
