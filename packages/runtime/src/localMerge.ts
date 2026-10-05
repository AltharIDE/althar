import { Effect } from 'effect'

import { commitOf, git, gitOutcome } from './git'

/*
 * Merging a task's branch into its repository's default branch on this Mac,
 * where the task has no pull request (docs/architecture/06). It is worked out
 * first, for every repository, and only then done, so a task of several
 * repositories merges all of them or none. The merge is found without any
 * working tree (`git merge-tree`), so nothing on disk changes for a merge
 * that can't happen. The default branch then moves to it: as a ref, where no
 * working tree has it checked out; or, where one does, by a fast-forward
 * there, only while that working tree has nothing uncommitted, so the
 * person's own work is never touched. Nothing is pushed.
 */

/** What merging a commit into a branch here would do. */
export type MergePlan =
  /** The branch has it already. */
  | { readonly kind: 'already' }
  /** The branch moves to `to`: the commit itself, or a merge commit made for it; from `from`, as it was. */
  | {
      readonly kind: 'move'
      readonly to: string
      readonly from: string
      readonly fastForward: boolean
      /** The working tree that has the branch checked out, which moves with it. */
      readonly checkout: string | null
    }
  /** It can't: the files that conflict. */
  | { readonly kind: 'conflicts'; readonly files: ReadonlyArray<string> }
  /** It can't now: the branch is checked out in a working tree with changes not committed. */
  | { readonly kind: 'busy'; readonly checkout: string }
  /** It can't: there's no such branch here. */
  | { readonly kind: 'missing' }

/** The working tree of `root`'s repository that has `branch` checked out, if any. */
export const checkedOut = (root: string, branch: string) =>
  Effect.map(git(root, 'worktree', 'list', '--porcelain'), (listing) => {
    let path: string | null = null
    for (const line of listing.split('\n')) {
      if (line.startsWith('worktree ')) path = line.slice('worktree '.length)
      else if (line === `branch refs/heads/${branch}`) return path
    }
    return null
  })

/** What merging `head` into `branch` in the repository at `root` would do, with `message` for a merge commit. Nothing moves. */
export const planMerge = (root: string, branch: string, head: string, message: string) =>
  Effect.gen(function* () {
    const tip = yield* commitOf(root, `refs/heads/${branch}`).pipe(Effect.orElseSucceed(() => ''))
    if (tip === '') return { kind: 'missing' } as const satisfies MergePlan
    const ancestor = (older: string, newer: string) =>
      Effect.map(gitOutcome(root, 'merge-base', '--is-ancestor', older, newer), (outcome) => outcome.code === 0)
    if (yield* ancestor(head, tip)) return { kind: 'already' } as const satisfies MergePlan
    const checkout = yield* checkedOut(root, branch)
    if (checkout !== null) {
      const changes = yield* git(checkout, 'status', '--porcelain', '--untracked-files=no')
      if (changes !== '') return { kind: 'busy', checkout } as const satisfies MergePlan
    }
    if (yield* ancestor(tip, head)) return { kind: 'move', to: head, from: tip, fastForward: true, checkout } as const satisfies MergePlan
    // Merged without a working tree: its tree, or the files that conflict.
    const merged = yield* gitOutcome(root, 'merge-tree', '--write-tree', '--name-only', '--no-messages', tip, head)
    const [tree, ...rest] = merged.stdout.split('\n')
    if (merged.code !== 0) return { kind: 'conflicts', files: rest.filter((line) => line !== '') } as const satisfies MergePlan
    const to = yield* git(root, 'commit-tree', tree ?? '', '-p', tip, '-p', head, '-m', message)
    return { kind: 'move', to, from: tip, fastForward: false, checkout } as const satisfies MergePlan
  })

/** Moves `branch` as `plan` says: as a ref, only from where it was; or by a fast-forward in the working tree that has it. */
export const applyMerge = (root: string, branch: string, plan: Extract<MergePlan, { kind: 'move' }>) =>
  plan.checkout === null
    ? git(root, 'update-ref', `refs/heads/${branch}`, plan.to, plan.from)
    : git(plan.checkout, 'merge', '--ff-only', '--quiet', plan.to)
