import type { TaskRepositoryHere } from '@althar/contracts'

import { device } from './device'

/*
 * Merging a task's repositories that have no pull request into their default
 * branches on this Mac: what the button says, and what it sends.
 */

/**
 * The button's words, the same in Outputs and on the board's dock: the
 * branch it merges into, or each one's where they differ, and that it stays
 * on this computer. Beside a pull request, which merges the rest, it names
 * the repositories it merges.
 */
export const mergeHereLabel = (here: ReadonlyArray<TaskRepositoryHere>, beside = false) => {
  const branches = [...new Set(here.map((repository) => repository.branch))]
  const into = branches.length === 1 ? `into ${branches[0] ?? 'main'}` : 'into each default branch'
  return `${beside ? `Merge ${andOf(here.map((repository) => repository.name))} ${into}` : `Merge ${into}`} on ${device.this}`
}

/** What merging here does that its button can't say: it pushes nothing, and no pull request's review comes first. */
export const mergeHereHint = 'Merging here doesn’t push, and skips review.'

/** Names in a sentence: api, web and docs. */
const andOf = (names: ReadonlyArray<string>) =>
  names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`

/** The heads it merges, as last read: none where a repository's branch couldn't be read, which then can't be merged. */
export const headsOf = (here: ReadonlyArray<TaskRepositoryHere>) =>
  here.flatMap((repository) => (repository.head === null ? [] : [{ repository: repository.repository, head: repository.head }]))
