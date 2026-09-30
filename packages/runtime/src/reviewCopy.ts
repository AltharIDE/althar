import { existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { Effect } from 'effect'

import { commitTree, git, treeOf } from './git'

/*
 * What a review reads (docs/architecture/04, 05): a throwaway copy of the
 * lead's worktree as it stood when the round began, not the worktree itself.
 * A reviewer only reads, but whatever gets past the rules and the agent's
 * sandbox lands in the copy rather than in the lead's work; and the copy
 * doesn't move if the person talks to the lead during the review. Each round
 * commits the worktree's tree (untracked files included) as a snapshot the
 * record keeps, and the copy checks it out.
 */

/** Where a task's reviews read: beside its worktree, `<task>/.review/<repository>`. */
export const reviewCopyOf = (worktree: string) => join(dirname(worktree), '.review', basename(worktree))

/** Snapshots the worktree as it stands and makes the review copy hold it: the snapshot's commit and tree. */
export const snapshotForReview = (worktree: string, round: number) =>
  Effect.gen(function* () {
    const tree = yield* treeOf(worktree)
    const head = yield* git(worktree, 'rev-parse', 'HEAD')
    const commit = yield* commitTree(worktree, tree, head, `What review round ${round + 1} reads`)
    const copy = reviewCopyOf(worktree)
    if (!existsSync(copy)) yield* git(worktree, 'worktree', 'add', '--detach', copy, commit)
    else {
      yield* git(copy, 'checkout', '--detach', '--force', commit)
      yield* git(copy, 'clean', '-fdq')
    }
    return { copy, commit, tree }
  })
