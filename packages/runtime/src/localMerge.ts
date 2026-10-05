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
 * there, only while that working tree has nothing uncommitted and no file git
 * doesn't track where the merge puts one, so the person's own work is never
 * touched. Refs move first and checkouts last, since a checkout can still
 * refuse; when one does, what moved is put back. Nothing is pushed.
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
  /** It can't now: the branch is checked out in a working tree with changes not committed, or files git doesn't track where the merge puts some. */
  | { readonly kind: 'busy'; readonly checkout: string; readonly untracked: ReadonlyArray<string> }
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
    if ((yield* gitOutcome(root, 'merge-base', '--is-ancestor', head, tip)).code === 0)
      return { kind: 'already' } as const satisfies MergePlan
    const checkout = yield* checkedOut(root, branch)
    if (checkout !== null) {
      const changes = yield* git(checkout, 'status', '--porcelain', '--untracked-files=no')
      if (changes !== '') return { kind: 'busy', checkout, untracked: [] } as const satisfies MergePlan
    }
    const merge = yield* mergeOf(root, tip, head, message)
    if (merge.kind === 'conflicts') return merge
    // A fast-forward in a working tree won't overwrite a file git doesn't track there, where the merge puts one.
    const untracked = checkout === null ? [] : yield* inTheWay(root, checkout, tip, merge.to)
    if (checkout !== null && untracked.length > 0) return { kind: 'busy', checkout, untracked } as const satisfies MergePlan
    return { ...merge, checkout } satisfies MergePlan
  })

/** `head` merged onto `tip`: a fast-forward to it, or a merge commit made without a working tree; or the files that conflict. */
const mergeOf = (root: string, tip: string, head: string, message: string) =>
  Effect.gen(function* () {
    const forward = yield* gitOutcome(root, 'merge-base', '--is-ancestor', tip, head)
    if (forward.code === 0) return { kind: 'move', to: head, from: tip, fastForward: true } as const
    const merged = yield* gitOutcome(root, 'merge-tree', '--write-tree', '--name-only', '--no-messages', tip, head)
    const [tree, ...rest] = merged.stdout.split('\n')
    if (merged.code !== 0) return { kind: 'conflicts', files: rest.filter((line) => line !== '') } as const
    const to = yield* git(root, 'commit-tree', tree ?? '', '-p', tip, '-p', head, '-m', message)
    return { kind: 'move', to, from: tip, fastForward: false } as const
  })

/** The files git doesn't track in `checkout` (ignored ones aside, which git replaces) where moving from `from` to `to` puts one. */
const inTheWay = (root: string, checkout: string, from: string, to: string) =>
  Effect.gen(function* () {
    const touched = new Set((yield* git(root, 'diff', '--name-only', '--no-renames', '-z', from, to)).split('\0'))
    const untracked = (yield* git(checkout, 'ls-files', '--others', '--exclude-standard', '-z')).split('\0')
    return untracked.filter((path) => path !== '' && touched.has(path))
  })

type Move = Extract<MergePlan, { kind: 'move' }>

/** Moves `branch` as `plan` says: as a ref, only from where it was; or by a fast-forward in the working tree that has it. */
export const applyMerge = (root: string, branch: string, plan: Move) =>
  plan.checkout === null
    ? git(root, 'update-ref', `refs/heads/${branch}`, plan.to, plan.from)
    : git(plan.checkout, 'merge', '--ff-only', '--quiet', plan.to)

/** Puts `branch` back where `plan` found it, only while it's where the merge left it, and, in a checkout, nothing changed since. */
export const undoMerge = (root: string, branch: string, plan: Move) =>
  Effect.gen(function* () {
    if (plan.checkout === null) return yield* git(root, 'update-ref', `refs/heads/${branch}`, plan.from, plan.to)
    const on = yield* gitOutcome(plan.checkout, 'symbolic-ref', '--quiet', 'HEAD')
    if (on.stdout.trim() !== `refs/heads/${branch}` || (yield* commitOf(plan.checkout, 'HEAD')) !== plan.to) return ''
    return yield* git(plan.checkout, 'reset', '--keep', '--quiet', plan.from)
  })

/**
 * Moves each branch as planned, refs first and checkouts last, since a
 * checkout can still refuse (something written there since the plan). When
 * one fails, those already moved are put back, and it is the one returned.
 */
export const applyMerges = <M extends { readonly root: string; readonly branch: string; readonly plan: Move }>(moves: ReadonlyArray<M>) =>
  Effect.gen(function* () {
    const done: Array<M> = []
    for (const move of moves.toSorted((one, other) => Number(one.plan.checkout !== null) - Number(other.plan.checkout !== null))) {
      const applied = yield* Effect.exit(applyMerge(move.root, move.branch, move.plan))
      if (applied._tag === 'Failure') {
        for (const undo of done.toReversed()) yield* Effect.ignore(undoMerge(undo.root, undo.branch, undo.plan))
        return move
      }
      done.push(move)
    }
    return null
  })
