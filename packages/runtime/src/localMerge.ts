import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { Effect } from 'effect'

import { commitOf, git, gitExactly, gitOutcome, trackedStatus } from './git'

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
 * touched. A submodule's checkout never moves (the person runs `git
 * submodule update`), so only those whose recorded commit the merge changes
 * are read, and must be clean, at the commit recorded for them: any other is
 * left alone, whatever its state, even one git can't read. Refs move first
 * and checkouts last, since a checkout can still refuse; when one does, what
 * moved is put back. Nothing is pushed.
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
  /** It can't now: it moves the submodule checked out at `submodule`, which has changes not committed or isn't at the commit recorded for it. */
  | { readonly kind: 'submodule'; readonly checkout: string; readonly submodule: string }
  /** It can't safely read `checkout`, the checkout or a submodule the merge moves. Keep the complete diagnostic, not just its last line. */
  | { readonly kind: 'unreadable'; readonly checkout: string; readonly detail: string }
  /** It can't: there's no such branch here. */
  | { readonly kind: 'missing' }

/**
 * The working tree of `root`'s repository that has `branch` checked out, if
 * any. Asked of the branch alone, so nothing is parsed out of a listing where
 * a path could pass for something else: git 2.23 has it, where `worktree
 * list -z` needs 2.36, older than some installs' system git.
 */
export const checkedOut = (root: string, branch: string) =>
  Effect.map(gitExactly(root, 'for-each-ref', '--format=%(worktreepath)', `refs/heads/${branch}`), (said) => {
    const path = said.endsWith('\n') ? said.slice(0, -1) : said
    return path === '' ? null : path
  })

const checkCheckout = (checkout: string) =>
  trackedStatus(checkout).pipe(
    Effect.match({
      onFailure: (error) => ({ kind: 'unreadable', checkout, detail: error.stderr }) as const,
      onSuccess: (changes) => (changes === '' ? null : ({ kind: 'busy', checkout, untracked: [] } as const)),
    }),
  )

/** The paths of the submodules whose recorded commit moving from `from` to `to` changes, adds or removes: the only ones a merge touches. */
const submodulesMoved = (root: string, from: string, to: string) =>
  Effect.map(gitExactly(root, 'diff', '--raw', '--no-renames', '-z', from, to), (raw) => {
    const fields = raw.split('\0')
    const moved: Array<string> = []
    for (let at = 0; at + 1 < fields.length; at += 2) {
      const [before, after] = (fields[at] ?? '').slice(1).split(' ')
      if (before === '160000' || after === '160000') moved.push(fields[at + 1] ?? '')
    }
    return moved
  })

/** The commit a listing's first entry records for a submodule, its `column`: 2 in `git ls-tree -z`, 1 in `git ls-files -s -z`; '' for none. */
const recordedIn = (listing: string, column: number) => {
  const fields = (listing.split('\0')[0] ?? '').split(/[ \t]/)
  return fields[0] === '160000' ? (fields[column] ?? '') : ''
}

/**
 * Whether the submodules moving `checkout` from `from` to `to` changes can
 * be left where they are: each checked out there must be at the commit
 * `from` and the index record for it, with nothing not committed.
 */
const checkSubmodules = (root: string, checkout: string, from: string, to: string) =>
  Effect.gen(function* () {
    for (const path of yield* submodulesMoved(root, from, to)) {
      const submodule = join(checkout, path)
      // Not checked out here: there's nothing of it the merge could leave behind.
      if (!existsSync(join(submodule, '.git'))) continue
      const recorded = recordedIn(yield* gitExactly(root, '--literal-pathspecs', 'ls-tree', '-z', from, '--', path), 2)
      const indexed = recordedIn(yield* gitExactly(checkout, '--literal-pathspecs', 'ls-files', '-s', '-z', '--', path), 1)
      const problem = yield* Effect.all([git(submodule, 'rev-parse', 'HEAD'), trackedStatus(submodule, 'dirty')]).pipe(
        Effect.match({
          onFailure: (error) => ({ kind: 'unreadable', checkout: submodule, detail: error.stderr }) as const,
          onSuccess: ([head, changes]) =>
            head === recorded && indexed === recorded && changes === '' ? null : ({ kind: 'submodule', checkout, submodule } as const),
        }),
      )
      if (problem !== null) return problem
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
      const problem = yield* checkCheckout(checkout)
      if (problem !== null) return problem satisfies MergePlan
    }
    const merge = yield* mergeOf(root, tip, head, message)
    if (merge.kind === 'conflicts') return merge
    if (checkout !== null) {
      const problem = yield* checkSubmodules(root, checkout, tip, merge.to)
      if (problem !== null) return problem satisfies MergePlan
    }
    // A fast-forward in a working tree won't overwrite a file git doesn't track there, where the merge puts one.
    const untracked = checkout === null ? [] : yield* inTheWay(root, checkout, tip, merge.to)
    if (checkout !== null && untracked.length > 0) return { kind: 'busy', checkout, untracked } as const satisfies MergePlan
    return { ...merge, checkout } satisfies MergePlan
  })

/**
 * The files that conflict merging `head` into `branch` in the repository at
 * `root`: none where it merges cleanly, has it already, or there's no such
 * branch. Whatever the working tree that has the branch holds, since nothing
 * moves, and no commit is made.
 */
export const conflictsOf = (root: string, branch: string, head: string) =>
  Effect.gen(function* () {
    const tip = yield* commitOf(root, `refs/heads/${branch}`).pipe(Effect.orElseSucceed(() => ''))
    if (tip === '') return []
    const merged = yield* gitOutcome(root, 'merge-tree', '--write-tree', '--name-only', '--no-messages', tip, head)
    // 1 is git's word for a merge that conflicts; anything else, a merge it couldn't work out, says nothing of one.
    return merged.code === 1
      ? merged.stdout
          .split('\n')
          .slice(1)
          .filter((line) => line !== '')
      : []
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
    : git(plan.checkout, '-c', 'submodule.recurse=false', 'merge', '--ff-only', '--quiet', plan.to)

/** Whether `checkout` still has `branch` checked out, at `at`. */
const stillOn = (checkout: string, branch: string, at: string) =>
  Effect.gen(function* () {
    const on = yield* gitOutcome(checkout, 'symbolic-ref', '--quiet', 'HEAD')
    return on.stdout.trim() === `refs/heads/${branch}` && (yield* commitOf(checkout, 'HEAD')) === at
  })

/** Puts `branch` back where `plan` found it, only while it's where the merge left it, and, in a checkout, nothing changed since. */
export const undoMerge = (root: string, branch: string, plan: Move) =>
  Effect.gen(function* () {
    if (plan.checkout === null) return yield* git(root, 'update-ref', `refs/heads/${branch}`, plan.from, plan.to)
    if (!(yield* stillOn(plan.checkout, branch, plan.to))) return ''
    return yield* git(plan.checkout, '-c', 'submodule.recurse=false', 'reset', '--keep', '--quiet', plan.from)
  })

/**
 * Moves each branch as planned, refs first and checkouts last, since a
 * checkout can still refuse (something written there since the plan). When
 * one fails, those already moved are put back, and it is the one returned.
 */
export const applyMerges = <M extends { readonly root: string; readonly branch: string; readonly plan: Move }>(moves: ReadonlyArray<M>) =>
  Effect.gen(function* () {
    // Planning may take time across repositories. Read every checkout again
    // before any ref moves, so one with changes since stops them all, as does
    // a submodule it moves that has some, or can't be read, now; as does one
    // switched to another branch, or its branch moved, since: a fast-forward
    // there would move whatever it has now. A branch checked out nowhere must
    // still be: moving its ref would leave a checkout behind.
    for (const move of moves) {
      if (move.plan.checkout === null) {
        if ((yield* checkedOut(move.root, move.branch)) !== null) return { ...move, problem: { kind: 'moved' } as const }
        continue
      }
      if (!(yield* stillOn(move.plan.checkout, move.branch, move.plan.from))) return { ...move, problem: { kind: 'moved' } as const }
      const problem =
        (yield* checkCheckout(move.plan.checkout)) ?? (yield* checkSubmodules(move.root, move.plan.checkout, move.plan.from, move.plan.to))
      if (problem !== null) return { ...move, problem }
    }
    const done: Array<M> = []
    for (const move of moves.toSorted((one, other) => Number(one.plan.checkout !== null) - Number(other.plan.checkout !== null))) {
      const applied = yield* Effect.exit(applyMerge(move.root, move.branch, move.plan))
      if (applied._tag === 'Failure') {
        for (const undo of done.toReversed()) yield* Effect.ignore(undoMerge(undo.root, undo.branch, undo.plan))
        return { ...move, problem: null }
      }
      done.push(move)
    }
    return null
  })
